/**
 * Dev-only: run the render-and-check loop on an overflowing deck and show the
 * monotone descent to zero overflow, with before/after PNGs.
 *
 *   pnpm loop   ->   examples/out/loop-before.png, loop-after.png
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDeck } from "@deck/contract";
import { LocalChromiumRenderer } from "@deck/renderer";
import { runFixLoop, overflowScalar, trimToFitSolver } from "@deck/loop";
import { makeStackOverflowDeck } from "../packages/loop/test/_stack.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const deck = parseDeck(makeStackOverflowDeck());
const renderer = new LocalChromiumRenderer();
try {
  const before = await renderer.render(deck);
  writeFileSync(join(outDir, "loop-before.png"), before.slides[0]!.png);
  console.log(`start: overflow scalar = ${overflowScalar(before.issues)}px, ${before.issues.length} issues`);

  const result = await runFixLoop(deck, renderer, trimToFitSolver, { maxIterations: 20 });

  for (const step of result.history) {
    console.log(
      `  step ${step.iteration}: ${step.scalarBefore}px -> ${step.scalarAfter}px ` +
        `(${step.ops.map((o) => o.op).join(",")}) ${step.accepted ? "accepted" : "rejected"}`,
    );
  }
  console.log(`result: converged=${result.converged} reason=${result.reason} iterations=${result.iterations}`);

  const after = await renderer.render(result.deck);
  writeFileSync(join(outDir, "loop-after.png"), after.slides[0]!.png);
  console.log(`final issues: ${after.issues.length}`);
} finally {
  await renderer.close();
}
