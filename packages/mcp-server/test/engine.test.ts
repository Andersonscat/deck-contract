import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LocalChromiumRenderer } from "@deck/renderer";
import { FileTemplateSource } from "@deck/loader";
import { DeckService, InMemoryDeckStore } from "@deck/mcp-server";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const registryDir = join(repoRoot, "registry");

let renderer: LocalChromiumRenderer;
let service: DeckService;

beforeAll(() => {
  renderer = new LocalChromiumRenderer();
  service = new DeckService(
    new InMemoryDeckStore(),
    renderer,
    new FileTemplateSource(registryDir),
    join(tmpdir(), `deck-test-${Date.now()}`),
  );
});
afterAll(async () => {
  await renderer.close();
});

describe("DeckService — the full model-driven tool flow", () => {
  it(
    "loads, surgically edits, renders, inserts a block, and exports a PDF",
    async () => {
      // discover
      const templates = await service.listTemplates();
      expect(templates.some((t) => t.id === "minimal-dark")).toBe(true);

      // load -> opaque deck_id
      const { deckId, outline } = await service.loadTemplate("minimal-dark");
      expect(deckId).toMatch(/^dk_/);
      expect(outline.some((o) => o.id === "title_hero")).toBe(true);

      // read one node, then surgically edit only it
      const before = await service.getNode(deckId, "title_hero");
      expect(before.content!.text).toContain("Acme");

      await service.applyPatch(deckId, [
        { op: "set_text", nodeId: "title_hero", value: "Acme grew 4x" },
        { op: "set_token", nodeId: "title_hero", prop: "color", value: "token://color/accent" },
      ]);
      const after = await service.getNode(deckId, "title_hero");
      expect(after.content!.text).toBe("Acme grew 4x");
      // everything else untouched
      const otherStill = await service.getNode(deckId, "title_sub");
      expect(otherStill.content!.text).toBe("Seed deck · 2026");

      // render -> 4 slides, no overflow on the well-formed template
      const rendered = await service.render(deckId);
      expect(rendered.slides).toHaveLength(4);
      expect(rendered.issues.filter((i) => i.code === "OVERFLOW")).toEqual([]);
      expect(rendered.slides[0]!.pngPath).toMatch(/\.png$/);

      // insert a library block -> fresh id, shows up in the outline
      const { newNodeId } = await service.insertBlock(deckId, "stat-callout", "metrics_row", 0);
      expect(newNodeId).toMatch(/^keymetric_|^stat/);
      const outline2 = await service.getOutline(deckId);
      expect(outline2.some((o) => o.id === newNodeId)).toBe(true);

      // export -> real PDF on disk
      const { path } = await service.exportDeck(deckId, "pdf");
      const pdf = await readFile(path);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    },
    120_000,
  );

  it("rejects edits to an unknown deck and bad tokens", async () => {
    await expect(service.getOutline("dk_nope")).rejects.toThrow(/unknown deck_id/);

    const { deckId } = await service.loadTemplate("minimal-dark");
    await expect(
      service.applyPatch(deckId, [
        { op: "set_token", nodeId: "title_hero", prop: "color", value: "#fff" } as never,
      ]),
    ).rejects.toThrow(/token-only/);
  }, 60_000);
});
