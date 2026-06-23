import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewerServer } from "@deck/viewer";
import { makeDeck } from "../../core/test/_fixture.js";

let dir: string;
let deckPath: string;
let selectionPath: string;
let viewer: ReturnType<typeof createViewerServer>;
const PORT = 4399;
const base = `http://localhost:${PORT}`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "deck-viewer-"));
  deckPath = join(dir, "working.deck.json");
  selectionPath = join(dir, "selection.json");
  await writeFile(deckPath, JSON.stringify(makeDeck()), "utf8");
  viewer = createViewerServer({ deckPath, selectionPath, port: PORT });
  await viewer.listen();
});
afterAll(() => viewer.close());

describe("viewer server", () => {
  it("serves the live deck with the interaction layer injected", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain('data-cid="title_main"');
    expect(html).toContain('data-type="title"');
    expect(html).toContain('id="dc-stage"'); // editor chrome injected
    expect(html).toContain('id="dc-chat-form"'); // AI chat present
    expect(html).toContain("set_text"); // client editing wired
  });

  it("applies a user text edit through the same ops/contract", async () => {
    const res = await fetch(base + "/api/op", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [{ op: "set_text", nodeId: "title_main", value: "Edited by user" }] }),
    });
    expect(await res.json()).toEqual({ ok: true });
    const deck = JSON.parse(await readFile(deckPath, "utf8"));
    expect(deck.slides[0].children[0].children[0].content.text).toBe("Edited by user");
  });

  it("rejects an invalid edit without corrupting the file", async () => {
    const before = await readFile(deckPath, "utf8");
    const res = await fetch(base + "/api/op", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [{ op: "set_token", nodeId: "title_main", prop: "color", value: "#fff" }] }),
    });
    expect((await res.json()).error).toMatch(/token-only/);
    expect(await readFile(deckPath, "utf8")).toBe(before);
  });

  it("records the user's AI-target selection for the MCP server to read", async () => {
    await fetch(base + "/api/selection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: "metric_rev" }),
    });
    expect(JSON.parse(await readFile(selectionPath, "utf8"))).toEqual({ nodeId: "metric_rev" });
  });
});
