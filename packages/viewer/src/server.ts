import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { parseDeck } from "@deck/contract";
import { compileSlides } from "@deck/compile";
import { apply, parseOps } from "@deck/core";
import { CHROME_CSS, CLIENT_JS } from "./client.js";

/**
 * Local interactive viewer — the human half of the loop. It renders the live deck,
 * lets the user click an element (see its stable id), edit text directly, or mark an
 * element as the "AI target". Edits go through the same ops/contract the model uses, so
 * user and AI share one deck.json. The deck file is watched, so AI edits (via MCP) and
 * user edits both push a live reload.
 */
export interface ViewerOptions {
  deckPath: string;
  /** Where "Set as AI target" writes the selection (read by the MCP get_selection tool). */
  selectionPath?: string;
  port?: number;
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

export function createViewerServer(opts: ViewerOptions) {
  const port = opts.port ?? 4321;
  const clients = new Set<ServerResponse>();
  const readDeck = async () => parseDeck(JSON.parse(await readFile(opts.deckPath, "utf8")));

  const http = createHttp(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    try {
      if (req.method === "GET" && (url === "/" || url.startsWith("/?"))) {
        const { css, slides } = compileSlides(await readDeck());
        const stage = slides
          .map((s, i) => '<div class="dc-frame' + (i === 0 ? " dc-on" : "") + '" data-idx="' + i + '">' + s.html + "</div>")
          .join("");
        const film = slides
          .map((s, i) => {
            const thumb = s.html
              .replace(/ data-cid="[^"]*"/g, "")
              .replace(/ data-type="[^"]*"/g, "")
              .replace(/ data-role="[^"]*"/g, "");
            return (
              '<button class="dc-thumb' + (i === 0 ? " dc-cur" : "") + '" data-idx="' + i + '">' +
              '<span class="dc-no">' + (i + 1) + "</span>" + thumb + "</button>"
            );
          })
          .join("");
        const page =
          '<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>deck-contract viewer</title><style>' +
          css + "\n" + CHROME_CSS + "</style></head><body class=\"dc-app\">" +
          '<div id="dc-bar">deck-contract viewer · click an element</div>' +
          '<div id="dc-nav"><button id="dc-prev" title="previous slide">‹</button>' +
          '<span id="dc-count"></span><button id="dc-next" title="next slide">›</button></div>' +
          '<div id="dc-stage">' + stage + "</div>" +
          '<div id="dc-film">' + film + "</div>" +
          '<div id="dc-panel">click an element to select it</div>' +
          '<div id="dc-flash"></div>' +
          "<script>" + CLIENT_JS + "</script></body></html>";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (req.method === "GET" && url === "/api/deck") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await readDeck()));
        return;
      }
      if (req.method === "GET" && url === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write("\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST" && url === "/api/op") {
        const { ops } = JSON.parse(await body(req));
        const deck = await readDeck();
        try {
          const next = apply(deck, parseOps(ops)).deck;
          await writeFile(opts.deckPath, JSON.stringify(next, null, 2), "utf8");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      if (req.method === "POST" && url === "/api/selection" && opts.selectionPath) {
        const { nodeId } = JSON.parse(await body(req));
        await writeFile(opts.selectionPath, JSON.stringify({ nodeId }), "utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
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
  const startWatch = () => {
    watcher = watch(opts.deckPath, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const c of clients) c.write("data: reload\n\n");
      }, 80);
    });
  };

  return {
    listen: () =>
      new Promise<number>((resolve) => {
        http.listen(port, () => {
          startWatch();
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
