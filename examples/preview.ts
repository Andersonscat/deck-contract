/**
 * Dev-only: compile the sample deck and apply a couple of surgical edits, then
 * write a standalone HTML preview. Proves the pure pipeline end to end without a
 * browser dependency (rendering/measurement lands on Day 2 via Playwright).
 *
 *   pnpm preview   ->   examples/out/preview.html
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDeck } from "@deck/contract";
import { apply } from "@deck/core";
import { compileHtml } from "@deck/compile";
import { makeDeck } from "../packages/core/test/_fixture.js";

const deck = parseDeck(makeDeck());

// Surgical edits: change ONE metric value + recolor the title, nothing else moves.
const { deck: edited } = apply(deck, [
  { op: "set_text", nodeId: "title_main", value: "Revenue grew 4x in 12 months" },
  { op: "set_token", nodeId: "title_main", prop: "color", value: "token://color/accent" },
]);

const { html } = compileHtml(edited);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "preview.html");
writeFileSync(outFile, html, "utf8");
console.log(outFile);
