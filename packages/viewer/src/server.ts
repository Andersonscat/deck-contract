import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, dirname } from "node:path";
import { parseDeck, type Deck, type DeckNode } from "@deck/contract";
import { compileSlides } from "@deck/compile";
import { apply, parseOps, cloneWithNewIds, buildIndex, type Op } from "@deck/core";
import { CHROME_CSS, CLIENT_JS } from "./client.js";
import { runChat } from "./chat.js";
import { generateImage, verifyImage } from "./imagegen.js";
import { LocalChromiumRenderer, type Observation } from "@deck/renderer";

/**
 * Local Canva-style editor: left rail/panels, center slide canvas, right AI chat.
 * The deck.json is the single source of truth; the user (direct edits, inserts, recolor)
 * and the AI chat both mutate it through the same id-addressed ops. The file is watched,
 * so every change — from the user, the chat, or the MCP server — pushes a live reload.
 */
export interface ViewerOptions {
  deckPath: string;
  selectionPath?: string;
  /** template.json whose `blocks` populate the Elements / Text panels. */
  blocksPath?: string;
  apiKey?: string;
  port?: number;
}

const LABELS: Record<string, string> = {
  "stat-callout": "Metric",
  "bullet-list": "List",
  quote: "Quote",
  "image-caption": "Image",
  "bar-chart": "Bar chart",
  table: "Table",
  "two-column": "Two columns",
  heading: "Heading",
  subtitle: "Subheading",
};
const ELEMENT_BLOCKS = ["image-caption", "bar-chart", "table", "two-column"];
const TEXT_BLOCKS = ["heading", "subtitle"];

const BULLET_ROW =
  '<div style="display:flex;gap:6px;align-items:center"><span style="width:5px;height:5px;border-radius:50%;background:var(--color-accent)"></span><span style="height:5px;width:74px;background:#5a6172;border-radius:3px"></span></div>';
const PREVIEW: Record<string, string> = {
  "stat-callout": '<div style="font:700 26px/1 sans-serif;color:var(--color-accent)">3×</div><div style="font-size:10px;color:var(--color-muted)">metric</div>',
  "bullet-list": BULLET_ROW + BULLET_ROW + BULLET_ROW,
  quote: '<div style="font:700 32px/1 Georgia,serif;color:var(--color-accent)">“</div><div style="height:6px;width:84px;background:#5a6172;border-radius:3px;margin-top:2px"></div>',
  "image-caption": '<div style="width:100%;height:50px;background:#3a4150;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8b93a4;font-size:22px">▧</div>',
  "bar-chart": '<div style="display:flex;align-items:flex-end;gap:5px;height:48px">' +
    '<div style="width:10px;height:40%;background:var(--color-accent);border-radius:3px 3px 0 0"></div>' +
    '<div style="width:10px;height:62%;background:var(--color-accent);border-radius:3px 3px 0 0"></div>' +
    '<div style="width:10px;height:82%;background:var(--color-accent);border-radius:3px 3px 0 0"></div>' +
    '<div style="width:10px;height:100%;background:var(--color-accent);border-radius:3px 3px 0 0"></div></div>',
  table: '<div style="width:100%;font-size:9px;color:var(--color-muted)">' +
    '<div style="display:flex;gap:6px;color:var(--color-accent);font-weight:700;border-bottom:1px solid #3a4150;padding-bottom:3px"><span style="flex:1">Plan</span><span>$</span></div>' +
    '<div style="display:flex;gap:6px;padding-top:3px"><span style="flex:1">Team</span><span>29</span></div>' +
    '<div style="display:flex;gap:6px"><span style="flex:1">Scale</span><span>99</span></div></div>',
  "two-column": '<div style="display:flex;gap:6px;width:100%">' +
    '<div style="flex:1;height:44px;background:#3a4150;border-radius:6px"></div>' +
    '<div style="flex:1;height:44px;background:#3a4150;border-radius:6px"></div></div>',
  heading: '<div style="font:800 22px/1 sans-serif;color:var(--color-text)">Heading</div>',
  subtitle: '<div style="font:600 15px/1 sans-serif;color:var(--color-muted)">Subheading</div>',
};

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

// A token value points at a token that ACTUALLY exists in the theme (not just token-shaped).
function tokenExists(deck: Deck, value: string): boolean {
  const m = /^token:\/\/([a-z]+)\/(.+)$/.exec(value);
  if (!m) return false;
  const ns = (deck.theme as unknown as Record<string, Record<string, unknown>>)[m[1]!];
  return !!ns && ns[m[2]!] !== undefined;
}

/**
 * Constrained-ops hygiene: reject any op that targets a node id or a theme token that does not
 * exist BEFORE it touches the deck, so a loosely-formed op can't silently corrupt a sibling.
 * Returns the clean ops and the rejected ones with reasons (for a single cheap retry).
 */
function validateOps(deck: Deck, ops: unknown[]): { valid: unknown[]; invalid: { op: unknown; reason: string }[] } {
  const idx = buildIndex(deck);
  const valid: unknown[] = [];
  const invalid: { op: unknown; reason: string }[] = [];
  for (const raw of ops) {
    const op = raw as { op?: string; nodeId?: string; parentId?: string; newParentId?: string; value?: string };
    if (op.op === "generate_image") { valid.push(raw); continue; } // expanded + checked separately
    const reasons: string[] = [];
    for (const t of [op.nodeId, op.parentId, op.newParentId]) {
      if (t && t !== "@slides" && !idx.has(t)) reasons.push(`node "${t}" does not exist`);
    }
    if (typeof op.value === "string" && op.value.startsWith("token://") && !tokenExists(deck, op.value)) {
      reasons.push(`token "${op.value}" is not in the theme`);
    }
    if (reasons.length) invalid.push({ op: raw, reason: reasons.join("; ") });
    else valid.push(raw);
  }
  return { valid, invalid };
}

// WCAG contrast helpers (server-side mirror of the renderer's, for the deterministic fallback).
function hexToRgb(h: string): { r: number; g: number; b: number } {
  let s = h.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}
function relLum({ r, g, b }: { r: number; g: number; b: number }): number {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastHex(a: string, b: string): number {
  const L1 = relLum(hexToRgb(a)), L2 = relLum(hexToRgb(b));
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
/** The palette token whose colour contrasts MOST with a given background hex. */
function bestContrastToken(colors: Record<string, string>, bgHex: string): { token: string; contrast: number } | null {
  let best: string | null = null, bc = 0;
  for (const [k, v] of Object.entries(colors)) {
    if (!/^#[0-9a-fA-F]{3,6}$/.test(v)) continue;
    const c = contrastHex(v, bgHex);
    if (c > bc) { bc = c; best = k; }
  }
  return best ? { token: best, contrast: bc } : null;
}

// Ancestor path to a node id (root slide ... node), for working out where a flow element sits.
function pathTo(deck: Deck, id: string): DeckNode[] | null {
  const walk = (node: DeckNode, acc: DeckNode[]): DeckNode[] | null => {
    acc.push(node);
    if (node.id === id) return acc;
    for (const c of node.children ?? []) {
      const r = walk(c, acc);
      if (r) return r;
    }
    acc.pop();
    return null;
  };
  for (const s of deck.slides) {
    const p = walk(s, []);
    if (p) return p;
  }
  return null;
}

// If `id` is (inside) a bar of a framed bar-chart, the on-slide box of that bar's column —
// so replacing a bar with an image can land roughly where the bar was, even with no selection.
function barColumnBox(deck: Deck, id: string): { x: number; y: number; w: number; h: number } | undefined {
  const path = pathTo(deck, id);
  if (!path) return undefined;
  let chart: DeckNode | undefined, chartIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]!.type === "bar-chart" && path[i]!.frame) { chart = path[i]; chartIdx = i; break; }
  }
  if (!chart || !chart.frame) return undefined;
  const bars = (chart.children ?? []).filter((c) => c.type === "bar");
  const barNode = path[chartIdx + 1];
  const idx = bars.findIndex((b) => b.id === barNode?.id);
  if (idx < 0 || bars.length === 0) return undefined;
  const f = chart.frame;
  const cw = (f.w ?? 100) / bars.length;
  return { x: (f.x ?? 0) + idx * cw, y: f.y ?? 0, w: cw, h: f.h ?? 40 };
}

export function createViewerServer(opts: ViewerOptions) {
  const port = opts.port ?? 4570;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const clients = new Set<ServerResponse>();

  // A warm headless renderer, started lazily — only readability-verified chats need it. It is the
  // perception oracle: it returns the MEASURED contrast a "done" claim must be backed by.
  let rendererP: Promise<LocalChromiumRenderer> | undefined;
  const renderer = () => (rendererP ??= Promise.resolve(new LocalChromiumRenderer()));
  const READABLE_MIN = 4.5; // the user's "make it visible" maps to the standard legibility target

  const lowContrastOnSlide = async (slideId?: string): Promise<Observation[]> => {
    const { observations } = await (await renderer()).render(await readDeck());
    return observations.filter((o) => (!slideId || o.slideId === slideId) && o.contrast < READABLE_MIN);
  };

  // Generated images are cached next to the deck and served from /assets, so the deck just
  // stores a stable local src (compile stays pure).
  const assetsDir = join(dirname(opts.deckPath), "assets");
  let assetSeq = 0;
  const saveAsset = async (buf: Buffer): Promise<string> => {
    await mkdir(assetsDir, { recursive: true });
    const file = "gen_" + Date.now().toString(36) + "_" + (assetSeq++).toString(36) + ".png";
    await writeFile(join(assetsDir, file), buf);
    return "/assets/" + file;
  };

  const readDeck = async () => parseDeck(JSON.parse(await readFile(opts.deckPath, "utf8")));
  const readBlocks = async (): Promise<Record<string, DeckNode>> => {
    if (!opts.blocksPath) return {};
    try {
      return (JSON.parse(await readFile(opts.blocksPath, "utf8")).blocks ?? {}) as Record<string, DeckNode>;
    } catch {
      return {};
    }
  };
  const readSelection = async (): Promise<{ nodeId: string } | null> => {
    if (!opts.selectionPath) return null;
    try {
      return JSON.parse(await readFile(opts.selectionPath, "utf8"));
    } catch {
      return null;
    }
  };

  // Undo/redo history. Every mutation funnels through commit(), which records the
  // inverse (returned by apply) so it can be replayed. Local single-deck session.
  const undoStack: Op[][] = [];
  const redoStack: Op[][] = [];
  const writeDeck = (deck: unknown) => writeFile(opts.deckPath, JSON.stringify(deck, null, 2), "utf8");
  const hist = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
  const commit = async (ops: unknown) => {
    const { deck: next, inverse } = apply(await readDeck(), parseOps(ops));
    await writeDeck(next);
    undoStack.push(inverse);
    redoStack.length = 0;
  };

  // Expand any high-level `generate_image` ops the AI emitted into real image-caption
  // inserts/replaces, calling the image model and caching the bytes. Other ops pass through.
  const expandGenOps = async (
    ops: unknown[],
    deck: Deck,
    currentSlideId?: string,
    selBox?: unknown,
    selId?: string,
  ): Promise<{ ops: unknown[]; notes: string[] }> => {
    const out: unknown[] = [];
    const notes: string[] = [];
    const idx = buildIndex(deck);
    for (const raw of ops) {
      const op = raw as { op?: string; prompt?: string; target?: string; mode?: string; parentId?: string; index?: number; frame?: unknown };
      if (op && op.op === "generate_image") {
        if (!openaiKey) throw new Error("image generation needs OPENAI_API_KEY");
        const prompt = String(op.prompt ?? "").trim();
        if (!prompt) continue;
        const buf = await generateImage(prompt, openaiKey);
        // Tier-2 perceptual check: confirm the picture is actually what was asked for (fail-open).
        if (apiKey) {
          const v = await verifyImage(buf, prompt, apiKey);
          if (!v.matches) notes.push(`heads up: the generated image may not match "${prompt}"${v.sees ? ` — it looks like ${v.sees}` : ""}.`);
        }
        const src = await saveAsset(buf);
        const newId = "img_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e7).toString(36);
        // For a replace, TRUST the user's actual selection over the AI's guessed target (haiku
        // sometimes returns the slide id). Never replace a whole slide.
        let repId = op.mode === "replace" ? selId ?? op.target : undefined;
        let repEntry = repId ? idx.get(repId) : undefined;
        if (repEntry && (repEntry.node.type === "slide" || repId === currentSlideId)) {
          repEntry = undefined;
          repId = undefined;
        }
        // Replacing a whole bar would drop its column and reflow the chart (the image then lands
        // on a shifted neighbour). Swap only the fill so the column slot — and the layout — stay put.
        if (repEntry && repEntry.node.type === "bar") {
          const fill = (repEntry.node.children ?? []).find((c) => c.type === "bar-fill");
          if (fill) { repId = fill.id; repEntry = idx.get(fill.id); }
        }
        // Where to put it: the user's pointed-at box (selBox) if they had a selection; else, for a
        // bar, the computed column box; else the node's own frame; else a default.
        const replacedBox = repId ? (selBox as object) ?? barColumnBox(deck, repId) : undefined;
        const rawFrame = (op.frame as object) ?? replacedBox ?? repEntry?.node.frame ?? { x: 34, y: 28, w: 32, h: 40 };
        // A thin element (e.g. a bar) would crush a contained image to a sliver; grow the box to a
        // visible minimum, centered on where the element was, clamped to the slide.
        const ensureVisible = (f: { x?: number; y?: number; w?: number; h?: number }) => {
          const minW = 14, minH = 22;
          let x = f.x ?? 30, y = f.y ?? 26, w = f.w ?? minW, h = f.h ?? minH;
          if (w < minW) { x += w / 2 - minW / 2; w = minW; }
          if (h < minH) { y += h / 2 - minH / 2; h = minH; }
          x = Math.max(0, Math.min(x, 100 - w));
          y = Math.max(0, Math.min(y, 100 - h));
          const r = (n: number) => Math.round(n * 1000) / 1000;
          return { x: r(x), y: r(y), w: r(w), h: r(h) };
        };
        const frame = ensureVisible(rawFrame as { x?: number; y?: number; w?: number; h?: number });
        const alt = prompt.slice(0, 80);
        // role "sticker" => the compiler shows the whole transparent cutout (object-fit:contain).
        const imgNode: DeckNode = { id: newId, type: "image-caption", role: "sticker", content: { src, alt }, frame } as DeckNode;
        if (repEntry && repId) {
          if (repEntry.node.type === "image-caption") {
            out.push({ op: "set_content", nodeId: repId, content: { src, alt } });
          } else {
            // swap the element for the image, placed where it lived (on its slide as a free node)
            out.push({ op: "remove_node", nodeId: repId });
            out.push({ op: "insert_node", parentId: repEntry.slideId, index: 999, node: imgNode });
          }
        } else {
          const parentId = op.parentId ?? currentSlideId ?? deck.slides[0]?.id;
          out.push({ op: "insert_node", parentId, index: op.index ?? 999, node: imgNode });
        }
      } else out.push(raw);
    }
    return { ops: out, notes };
  };

  async function buildPage(): Promise<string> {
    const deck = await readDeck();
    const blocks = await readBlocks();
    const { css, slides } = compileSlides(deck);
    const strip = (h: string) =>
      h.replace(/ data-cid="[^"]*"/g, "").replace(/ data-type="[^"]*"/g, "").replace(/ data-role="[^"]*"/g, "");

    const frames = slides
      .map((s, i) => '<div class="dc-frame' + (i === 0 ? " dc-on" : "") + '">' + s.html + "</div>")
      .join("");
    const thumbs = slides
      .map(
        (s, i) =>
          '<div class="dc-thumbrow' + (i === 0 ? " dc-cur" : "") + '"><span class="dc-no">' + (i + 1) + "</span>" +
          '<button class="dc-slidethumb" draggable="true" data-idx="' + i + '" data-sid="' + s.id + '">' +
          strip(s.html) + "</button></div>",
      )
      .join("");
    const elGrid = (ids: string[]) => {
      const cards = ids
        .filter((id) => blocks[id])
        .map(
          (id) =>
            '<button class="dc-el" data-block="' + id + '"><div class="dc-prev">' +
            (PREVIEW[id] ?? "") + '</div><span class="dc-lbl">' + (LABELS[id] ?? id) + "</span></button>",
        )
        .join("");
      return cards ? '<div class="dc-grid">' + cards + "</div>" : '<div style="color:#9298a3;font-size:12px">no blocks loaded</div>';
    };
    const swatches = Object.keys(deck.theme.color)
      .map((k) => '<button class="dc-swatch" data-token="token://color/' + k + '" title="' + k + '" style="background:var(--color-' + k + ')"></button>')
      .join("");

    return (
      '<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>deck-contract</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Roboto:wght@400;500;700&family=Poppins:wght@400;500;600;700&family=Montserrat:wght@400;600;700;800&family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;700&family=Playfair+Display:wght@400;600;700;800&family=Lora:wght@400;600;700&family=Merriweather:wght@400;700&family=Oswald:wght@400;500;700&display=swap">' +
      '<style id="dc-theme">' + css + "</style><style>" + CHROME_CSS + "</style></head><body class=\"dc-app\">" +
      '<div id="dc-left"><div class="dc-rail">' +
      '<button class="dc-tab dc-act" data-tab="slides"><span class="dc-ico">▤</span>Slides</button>' +
      '<button class="dc-tab" data-tab="layers"><span class="dc-ico">⧉</span>Layers</button>' +
      '<button class="dc-tab" data-tab="elements"><span class="dc-ico">◆</span>Elements</button>' +
      '<button class="dc-tab" data-tab="text"><span class="dc-ico">T</span>Text</button>' +
      '<button class="dc-tab" data-tab="brand"><span class="dc-ico">✦</span>Brand</button>' +
      '</div><div class="dc-panels">' +
      '<div class="dc-panel2 dc-on" data-panel="slides"><h4>Slides</h4><div id="dc-thumbs">' + thumbs +
      '</div><button id="dc-add-slide"><span>+</span> New slide</button></div>' +
      '<div class="dc-panel2" data-panel="layers"><h4>Layers</h4><div id="dc-layers"></div></div>' +
      '<div class="dc-panel2" data-panel="elements"><h4>Elements</h4>' + elGrid(ELEMENT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="text"><h4>Text</h4>' + elGrid(TEXT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="brand"><h4>Theme colors</h4><div class="dc-swatches">' + swatches + "</div></div>" +
      "</div></div>" +
      '<div id="dc-center">' +
      '<div id="dc-topbar"><div id="dc-history">' +
      '<button id="dc-undo" title="Undo (Cmd/Ctrl+Z)" disabled><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg></button>' +
      '<button id="dc-redo" title="Redo (Cmd/Ctrl+Shift+Z)" disabled><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg></button>' +
      '</div><div id="dc-tool" class="dc-empty">Select an element to edit it</div></div>' +
      '<div id="dc-stage">' + frames + "</div>" +
      '<div id="dc-flash"></div>' +
      "</div>" +
      '<div id="dc-right"><div id="dc-chat-head">AI assistant</div>' +
      '<div id="dc-chat"></div>' +
      '<form id="dc-chat-form"><div class="dc-inwrap"><textarea id="dc-chat-input" rows="1" placeholder="Ask to change a slide…"></textarea>' +
      '<button id="dc-chat-send" type="submit" title="send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>' +
      "</div><script>window.DC_THEME=" +
      JSON.stringify({
        font: Object.keys(deck.theme.font),
        type: Object.fromEntries(Object.entries(deck.theme.type).map(([k, v]) => [k, parseInt(v, 10) || v])),
        color: deck.theme.color,
      }) +
      ";</script><script>" + CLIENT_JS + "</script></body></html>"
    );
  }

  const http = createHttp(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const json = (data: unknown, code = 200) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === "GET" && (url === "/" || url.startsWith("/?"))) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await buildPage());
        return;
      }
      if (req.method === "GET" && url.startsWith("/assets/")) {
        const name = url.slice("/assets/".length).split("?")[0]!;
        if (/[^a-zA-Z0-9._-]/.test(name)) return json({ error: "bad asset" }, 400);
        try {
          const buf = await readFile(join(assetsDir, name));
          res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=31536000" });
          res.end(buf);
        } catch {
          res.writeHead(404);
          res.end("not found");
        }
        return;
      }
      if (req.method === "GET" && url === "/api/deck") return json(await readDeck());
      if (req.method === "GET" && url === "/api/slides") {
        const { css, slides } = compileSlides(await readDeck());
        return json({ css, slides });
      }
      if (req.method === "GET" && url.startsWith("/api/node")) {
        const id = new URL(url, "http://x").searchParams.get("id") ?? "";
        const node = buildIndex(await readDeck()).get(id)?.node;
        return node ? json(node) : json({ error: "not found" }, 404);
      }
      if (req.method === "GET" && url === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write("\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST" && url === "/api/op") {
        const { ops } = JSON.parse(await body(req));
        try {
          await commit(ops);
          // Return the recompiled slides so the client can reconcile its cache without the
          // SSE round-trip rebuilding (and flashing) the slide it already updated optimistically.
          const { slides } = compileSlides(await readDeck());
          return json({ ok: true, ...hist(), slides });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === "POST" && url === "/api/set_size") {
        const { nodeId, prop, px, range } = JSON.parse(await body(req));
        try {
          const n = Math.max(4, Math.min(400, Math.round(Number(px))));
          if (!n) return json({ error: "set_size: bad px" });
          // Mint a theme token for this exact size on the fly, so the node still references a
          // token (token-only invariant holds) rather than a raw px value.
          const key = String(n);
          const deck = await readDeck();
          if (deck.theme.type[key] !== `${n}px`) {
            deck.theme.type[key] = `${n}px`;
            await writeDeck(deck);
          }
          const value = `token://type/${key}`;
          const op =
            range && prop === "size"
              ? { op: "format_range", nodeId, target: range, prop: "size", value }
              : { op: "set_token", nodeId, prop: prop ?? "size", value };
          await commit([op]);
          const next = await readDeck();
          const { css, slides } = compileSlides(next);
          const type = Object.fromEntries(
            Object.entries(next.theme.type).map(([k, v]) => [k, parseInt(v as string, 10) || v]),
          );
          return json({ ok: true, ...hist(), slides, css, type });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === "POST" && url === "/api/add_slide") {
        try {
          const deck = await readDeck();
          // Reuse the deck's own layout + a real title style so the new slide is on-theme.
          const findType = (n: DeckNode, t: string): DeckNode | null => {
            if (n.type === t) return n;
            for (const c of n.children ?? []) { const r = findType(c, t); if (r) return r; }
            return null;
          };
          let titleStyle: Record<string, string> = {};
          for (const s of deck.slides) { const t = findType(s, "title"); if (t?.style) { titleStyle = t.style; break; } }
          const first = deck.slides[0];
          const tmpl = {
            id: "slide_blank", type: "slide",
            layout: first?.layout ?? { direction: "column", padding: "token://space/xl", justify: "center" },
            style: first?.style ?? {},
            children: [{ id: "blank_title", type: "title", content: { text: "New slide" }, style: titleStyle }],
          } as unknown as DeckNode;
          const { node } = cloneWithNewIds(tmpl);
          await commit([{ op: "insert_node", parentId: "@slides", index: deck.slides.length, node }]);
          const { slides } = compileSlides(await readDeck());
          return json({ ok: true, ...hist(), slides, newId: node.id });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === "POST" && url === "/api/paste") {
        const { node: pasted, parentId, index } = JSON.parse(await body(req));
        try {
          if (!pasted || typeof pasted !== "object") return json({ error: "paste: no node" });
          const { node } = cloneWithNewIds(pasted as DeckNode); // fresh ids so it never collides with the source
          await commit([{ op: "insert_node", parentId, index: index ?? 999, node }]);
          const { slides } = compileSlides(await readDeck());
          return json({ ok: true, ...hist(), slides, newId: node.id });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === "POST" && url === "/api/insert_block") {
        const { blockId, parentId, index } = JSON.parse(await body(req));
        try {
          const block = (await readBlocks())[blockId];
          if (!block) return json({ error: 'unknown block "' + blockId + '"' });
          const { node } = cloneWithNewIds(block);
          await commit([{ op: "insert_node", parentId, index: index ?? 999, node }]);
          return json({ ok: true, newNodeId: node.id, ...hist() });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (req.method === "POST" && url === "/api/undo") {
        const inv = undoStack.pop();
        if (!inv) return json({ ok: false, ...hist() });
        const { deck: next, inverse } = apply(await readDeck(), inv);
        await writeDeck(next);
        redoStack.push(inverse);
        return json({ ok: true, ...hist() });
      }
      if (req.method === "POST" && url === "/api/redo") {
        const r = redoStack.pop();
        if (!r) return json({ ok: false, ...hist() });
        const { deck: next, inverse } = apply(await readDeck(), r);
        await writeDeck(next);
        undoStack.push(inverse);
        return json({ ok: true, ...hist() });
      }
      if (req.method === "GET" && url === "/api/history") return json(hist());
      if (req.method === "POST" && url === "/api/selection" && opts.selectionPath) {
        const { nodeId } = JSON.parse(await body(req));
        await writeFile(opts.selectionPath, JSON.stringify({ nodeId }), "utf8");
        return json({ ok: true });
      }
      if (req.method === "POST" && url === "/api/chat") {
        const { message, currentSlideId, selectedId, selBox } = JSON.parse(await body(req));
        if (!apiKey) return json({ reply: "AI chat disabled: set ANTHROPIC_API_KEY.", applied: 0 });
        try {
          const deck = await readDeck();
          const selection = selectedId ? { nodeId: selectedId } : await readSelection();
          const { reply, ops, verify } = await runChat(message, deck, selection, apiKey, currentSlideId, undefined, !!openaiKey);

          // Constrained-ops hygiene: drop edits that target a non-existent id/token, with ONE cheap
          // retry feeding the rejections back — so a mis-aimed op can't corrupt a sibling.
          let useOps = ops;
          const v0 = validateOps(deck, ops);
          if (v0.invalid.length) {
            const errMsg =
              "Some of your edits were REJECTED because they referenced things that don't exist:\n" +
              v0.invalid.map((x) => `- ${x.reason}`).join("\n") +
              "\nAddress only real node ids from the components list above. Valid colour tokens: " +
              Object.keys(deck.theme.color).map((k) => `token://color/${k}`).join(", ") +
              "\nRe-issue ONLY the corrected edits.";
            const retry = await runChat(errMsg, deck, selection, apiKey, currentSlideId, undefined, !!openaiKey);
            useOps = [...v0.valid, ...validateOps(deck, retry.ops).valid];
          }

          const { ops: expanded, notes: genNotes } = await expandGenOps(useOps, deck, currentSlideId, selBox, selectedId);
          let applied = 0;
          if (expanded.length) {
            await commit(expanded);
            applied = expanded.length;
          }

          // Readability loop: the user asked for legible text, so MEASURE it and keep correcting
          // until the renderer says it's legible (or the budget runs out). The threshold comes
          // from the user's intent ("visible"), not a system rule — black-on-black isn't verified.
          let finalReply = genNotes.length ? reply + " " + genNotes.join(" ") : reply;
          if (verify === "readability") {
            const palette = (await readDeck()).theme.color as Record<string, string>;
            const tokenList = Object.entries(palette).map(([k, v]) => `${k} (${v})`).join(", ");
            for (let pass = 0; pass < 2; pass++) {
              const low = await lowContrastOnSlide(currentSlideId);
              if (!low.length) break;
              const fixMsg =
                "Some text on this slide is still hard to read against its background. Recolor ONLY these nodes to a token whose colour clearly CONTRASTS with the listed background so each becomes legible (use set_token or set_token_where). A light background needs a dark token and vice-versa.\n" +
                "Available colour tokens and their hex: " + tokenList + "\n" +
                "Nodes — id : current text colour on background, contrast:\n" +
                low.map((o) => `${o.nodeId} : ${o.fg} on ${o.bg}, contrast ${o.contrast}`).join("\n");
              const fix = await runChat(fixMsg, await readDeck(), null, apiKey, currentSlideId, undefined, false);
              const fixOps = (await expandGenOps(fix.ops, await readDeck(), currentSlideId)).ops;
              if (!fixOps.length) break;
              await commit(fixOps);
              applied += fixOps.length;
            }
            // Deterministic last resort: the user explicitly asked for legible text, so if the model
            // still hasn't reached it, pick the highest-contrast palette token per node (token-only
            // preserved). This fulfils the stated goal; it is not a system style opinion.
            const stuck = await lowContrastOnSlide(currentSlideId);
            if (stuck.length) {
              const fixOps = stuck
                .map((o) => {
                  const best = bestContrastToken(palette, o.bg);
                  return best ? { op: "set_token" as const, nodeId: o.nodeId, prop: "color", value: `token://color/${best.token}` } : null;
                })
                .filter(Boolean) as unknown[];
              if (fixOps.length) {
                await commit(fixOps);
                applied += fixOps.length;
              }
            }
            const residual = await lowContrastOnSlide(currentSlideId);
            if (residual.length) {
              finalReply =
                reply +
                ` (Note: ${residual.length} text element${residual.length > 1 ? "s" : ""} still measure below the legibility target: ${residual
                  .map((o) => o.nodeId)
                  .join(", ")}. I couldn't make ${residual.length > 1 ? "them" : "it"} legible automatically.)`;
            }
          }

          const { slides } = compileSlides(await readDeck());
          return json({ reply: finalReply, applied, ...hist(), slides });
        } catch (e) {
          return json({ reply: "error: " + (e instanceof Error ? e.message : String(e)), applied: 0 });
        }
      }
      res.writeHead(404);
      res.end("not found");
    } catch (e) {
      res.writeHead(500);
      res.end(e instanceof Error ? e.message : String(e));
    }
  });

  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  return {
    listen: () =>
      new Promise<number>((resolve) => {
        http.listen(port, () => {
          watcher = watch(opts.deckPath, () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              for (const c of clients) c.write("data: reload\n\n");
            }, 80);
          });
          resolve(port);
        });
      }),
    close: () => {
      watcher?.close();
      for (const c of clients) c.end();
      http.close();
    },
  };
}
