import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { parseDeck, type Deck, type DeckNode } from "@deck/contract";
import { compileSlides } from "@deck/compile";
import { apply, parseOps, cloneWithNewIds, buildIndex, type Op } from "@deck/core";
import { CHROME_CSS, CLIENT_JS } from "./client.js";
import { runChat } from "./chat.js";

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

export function createViewerServer(opts: ViewerOptions) {
  const port = opts.port ?? 4570;
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const clients = new Set<ServerResponse>();

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
      '<button class="dc-tab" data-tab="elements"><span class="dc-ico">◆</span>Elements</button>' +
      '<button class="dc-tab" data-tab="text"><span class="dc-ico">T</span>Text</button>' +
      '<button class="dc-tab" data-tab="brand"><span class="dc-ico">✦</span>Brand</button>' +
      '</div><div class="dc-panels">' +
      '<div class="dc-panel2 dc-on" data-panel="slides"><h4>Slides</h4><div id="dc-thumbs">' + thumbs +
      '</div><button id="dc-add-slide"><span>+</span> New slide</button></div>' +
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
        const { message, currentSlideId, selectedId } = JSON.parse(await body(req));
        if (!apiKey) return json({ reply: "AI chat disabled: set ANTHROPIC_API_KEY.", applied: 0 });
        try {
          const deck = await readDeck();
          const selection = selectedId ? { nodeId: selectedId } : await readSelection();
          const { reply, ops } = await runChat(message, deck, selection, apiKey, currentSlideId);
          let applied = 0;
          if (ops.length) {
            await commit(ops);
            applied = ops.length;
          }
          return json({ reply, applied, ...hist() });
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
