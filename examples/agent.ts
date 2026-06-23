/**
 * Dev-only: drive the MCP tools exactly as a model would — load a template, make a
 * surgical edit, render, insert a block, export a PDF. Same DeckService the stdio
 * server exposes, so this is the end-to-end product in miniature.
 *
 *   pnpm agent   ->   examples/out/deck-*.png, deck.pdf
 */
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { LocalChromiumRenderer } from "@deck/renderer";
import { FileTemplateSource } from "@deck/loader";
import { DeckService, InMemoryDeckStore } from "@deck/mcp-server";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

const renderer = new LocalChromiumRenderer();
const service = new DeckService(
  new InMemoryDeckStore(),
  renderer,
  new FileTemplateSource(join(repoRoot, "registry")),
  outDir,
);

try {
  console.log("templates:", (await service.listTemplates()).map((t) => t.id).join(", "));

  const { deckId, outline } = await service.loadTemplate("minimal-dark");
  console.log(`loaded ${deckId} (${outline.length} components)`);

  // surgical edit: change one headline + recolor it; nothing else moves
  await service.applyPatch(deckId, [
    { op: "set_text", nodeId: "title_hero", value: "Acme grew 4x in 12 months" },
    { op: "set_token", nodeId: "title_hero", prop: "color", value: "token://color/accent" },
  ]);

  // insert a metric block into the metrics row
  const { newNodeId } = await service.insertBlock(deckId, "stat-callout", "metrics_row", 3);
  console.log(`inserted block ${newNodeId}`);

  const { issues, slides } = await service.render(deckId);
  for (let i = 0; i < slides.length; i++) {
    copyFileSync(slides[i]!.pngPath, join(outDir, `deck-${i + 1}.png`));
  }
  console.log(`rendered ${slides.length} slides, ${issues.length} issues`);

  const { path } = await service.exportDeck(deckId, "pdf");
  copyFileSync(path, join(outDir, "deck.pdf"));
  console.log(`exported PDF -> ${join(outDir, "deck.pdf")}`);
} finally {
  await renderer.close();
}
