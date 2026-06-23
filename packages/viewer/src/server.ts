import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { parseDeck, type Deck, type DeckNode } from "@deck/contract";
import { compileSlides } from "@deck/compile";
import { apply, parseOps, cloneWithNewIds } from "@deck/core";
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
  /** template.json whose `blocks` populate the Элементы / Текст panels. */
  blocksPath?: string;
  apiKey?: string;
  port?: number;
}

const LABELS: Record<string, string> = {
  "stat-callout": "Метрика",
  "bullet-list": "Список",
  quote: "Цитата",
  "image-caption": "Картинка",
  heading: "Заголовок",
  subtitle: "Подзаголовок",
};
const ELEMENT_BLOCKS = ["stat-callout", "bullet-list", "quote", "image-caption"];
const TEXT_BLOCKS = ["heading", "subtitle"];

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
    const blockBtns = (ids: string[]) =>
      ids.filter((id) => blocks[id]).map((id) => '<button class="dc-block" data-block="' + id + '">' + (LABELS[id] ?? id) + "</button>").join("") ||
      '<div class="dc-note" style="color:#9298a3;font-size:12px">no blocks loaded</div>';
    const swatches = Object.keys(deck.theme.color)
      .map((k) => '<button class="dc-swatch" data-token="token://color/' + k + '" title="' + k + '" style="background:var(--color-' + k + ')"></button>')
      .join("");

    return (
      '<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>deck-contract</title><style>' +
      css + "\n" + CHROME_CSS + "</style></head><body class=\"dc-app\">" +
      '<div id="dc-left"><div class="dc-rail">' +
      '<button class="dc-tab dc-act" data-tab="slides"><span class="dc-ico">▤</span>Слайды</button>' +
      '<button class="dc-tab" data-tab="elements"><span class="dc-ico">◆</span>Элементы</button>' +
      '<button class="dc-tab" data-tab="text"><span class="dc-ico">T</span>Текст</button>' +
      '<button class="dc-tab" data-tab="brand"><span class="dc-ico">✦</span>Бренд</button>' +
      '</div><div class="dc-panels">' +
      '<div class="dc-panel2 dc-on" data-panel="slides"><h4>Слайды</h4>' + thumbs + "</div>" +
      '<div class="dc-panel2" data-panel="elements"><h4>Элементы</h4>' + blockBtns(ELEMENT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="text"><h4>Текст</h4>' + blockBtns(TEXT_BLOCKS) + "</div>" +
      '<div class="dc-panel2" data-panel="brand"><h4>Цвета темы</h4><div class="dc-swatches">' + swatches + "</div></div>" +
      "</div></div>" +
      '<div id="dc-center">' +
      '<div id="dc-stage">' + frames + "</div>" +
      '<div id="dc-panel">click an element to select it</div><div id="dc-flash"></div>' +
      "</div>" +
      '<div id="dc-right"><div id="dc-chat-head">ИИ ассистент</div>' +
      '<div id="dc-chat"><div class="dc-msg sys">' +
      (apiKey ? "Опишите, что изменить — например «сделай заголовок короче» или «поменяй метрику на 4x»." : "Чат выключен: нет ANTHROPIC_API_KEY.") +
      "</div></div>" +
      '<form id="dc-chat-form"><textarea id="dc-chat-input" rows="2" placeholder="Попросите изменить слайд…"></textarea><button id="dc-chat-send" type="submit">↑</button></form>' +
      "</div><script>" + CLIENT_JS + "</script></body></html>"
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
        const { message, currentSlideId } = JSON.parse(await body(req));
        if (!apiKey) return json({ reply: "AI chat disabled: set ANTHROPIC_API_KEY.", applied: 0 });
        try {
          const deck = await readDeck();
          const { reply, ops } = await runChat(message, deck, await readSelection(), apiKey, currentSlideId);
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
