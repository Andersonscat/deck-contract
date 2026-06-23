import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { parseDeck, type Deck, type DeckNode } from "@deck/contract";
import { compileSlides } from "@deck/compile";
import { apply, parseOps, cloneWithNewIds, buildIndex } from "@deck/core";
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
  heading: "Heading",
  subtitle: "Subheading",
};
const ELEMENT_BLOCKS = ["stat-callout", "bullet-list", "quote", "image-caption"];
const TEXT_BLOCKS = ["heading", "subtitle"];

const BULLET_ROW =
  '<div style="display:flex;gap:6px;align-items:center"><span style="width:5px;height:5px;border-radius:50%;background:var(--color-accent)"></span><span style="height:5px;width:74px;background:#5a6172;border-radius:3px"></span></div>';
const PREVIEW: Record<string, string> = {
  "stat-callout": '<div style="font:700 26px/1 sans-serif;color:var(--color-accent)">3×</div><div style="font-size:10px;color:var(--color-muted)">metric</div>',
  "bullet-list": BULLET_ROW + BULLET_ROW + BULLET_ROW,
  quote: '<div style="font:700 32px/1 Georgia,serif;color:var(--color-accent)">“</div><div style="height:6px;width:84px;background:#5a6172;border-radius:3px;margin-top:2px"></div>',
  "image-caption": '<div style="width:100%;height:50px;background:#3a4150;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#8b93a4;font-size:22px">▧</div>',
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
          '<button class="dc-slidethumb' + (i === 0 ? " dc-cur" : "") + '" data-idx="' + i + '">' +
          '<span class="dc-no">' + (i + 1) + "</span>" + strip(s.html) + "</button>",
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
      '<style id="dc-theme">' + css + "</style><style>" + CHROME_CSS + "</style></head><body class=\"dc-app\">" +
      '<div id="dc-left"><div class="dc-rail">' +
      '<button class="dc-tab dc-act" data-tab="slides"><span class="dc-ico">▤</span>Slides</button>' +
      '<button class="dc-tab" data-tab="elements"><span class="dc-ico">◆</span>Elements</button>' +
      '<button class="dc-tab" data-tab="text"><span class="dc-ico">T</span>Text</button>' +
      '<button class="dc-tab" data-tab="brand"><span class="dc-ico">✦</span>Brand</button>' +
      '</div><div class="dc-panels">' +
      '<div class="dc-panel2 dc-on" data-panel="slides"><h4>Slides</h4>' + thumbs + "</div>" +
      '<div class="dc-panel2" data-panel="elements"><h4>Elements</h4>' + elGrid(ELEMENT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="text"><h4>Text</h4>' + elGrid(TEXT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="brand"><h4>Theme colors</h4><div class="dc-swatches">' + swatches + "</div></div>" +
      "</div></div>" +
      '<div id="dc-center">' +
      '<div id="dc-topbar"><div id="dc-tool" class="dc-empty">Select an element to edit it</div></div>' +
      '<div id="dc-stage">' + frames + "</div>" +
      '<div id="dc-flash"></div>' +
      "</div>" +
      '<div id="dc-right"><div id="dc-chat-head">AI assistant</div>' +
      '<div id="dc-chat"><div class="dc-msg sys">' +
      (apiKey ? "Describe a change — e.g. “make the title shorter” or “change the metric to 4x”." : "Chat disabled: no ANTHROPIC_API_KEY.") +
      "</div></div>" +
      '<form id="dc-chat-form"><textarea id="dc-chat-input" rows="2" placeholder="Ask to change a slide…"></textarea><button id="dc-chat-send" type="submit">↑</button></form>' +
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
          const next = apply(await readDeck(), parseOps(ops)).deck;
          await writeFile(opts.deckPath, JSON.stringify(next, null, 2), "utf8");
          return json({ ok: true });
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
          const next = apply(await readDeck(), [{ op: "insert_node", parentId, index: index ?? 999, node }]).deck;
          await writeFile(opts.deckPath, JSON.stringify(next, null, 2), "utf8");
          return json({ ok: true, newNodeId: node.id });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
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
            const next = apply(deck, parseOps(ops)).deck;
            await writeFile(opts.deckPath, JSON.stringify(next, null, 2), "utf8");
            applied = ops.length;
          }
          return json({ reply, applied });
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
