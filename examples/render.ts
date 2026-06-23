/**
 * Dev-only: surgically edit the sample deck, render it to real PNGs via headless
 * Chromium, and report any overflow issues. Proves the full Day-2 pipeline end to end.
 *
 *   pnpm render   ->   examples/out/slide-*.png
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDeck } from "@deck/contract";
import { apply } from "@deck/core";
import { LocalChromiumRenderer } from "@deck/renderer";
import { makeDeck } from "../packages/core/test/_fixture.js";

const deck = parseDeck(makeDeck());

// One surgical edit: change the metric, recolor the title. Nothing else moves.
const { deck: edited } = apply(deck, [
  { op: "set_text", nodeId: "title_main", value: "Revenue grew 4x in 12 months" },
  { op: "set_token", nodeId: "title_main", prop: "color", value: "token://color/accent" },
]);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const renderer = new LocalChromiumRenderer();
try {
  const { slides, issues } = await renderer.render(edited);
  const paths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const p = join(outDir, `slide-${i + 1}.png`);
    writeFileSync(p, slides[i]!.png);
    paths.push(p);
  }
  console.log(`rendered ${slides.length} slide(s):`);
  for (const p of paths) console.log("  " + p);
  console.log(issues.length === 0 ? "no overflow issues" : `issues: ${JSON.stringify(issues, null, 2)}`);
} finally {
  await renderer.close();
}
