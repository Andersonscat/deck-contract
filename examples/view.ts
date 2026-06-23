/**
 * Launch the interactive viewer on a working copy of the minimal-dark deck.
 *
 *   pnpm view   ->   http://localhost:4321
 *
 * Click an element to select it (see its id), double-click a title/heading to edit text,
 * or "Set as AI target" and ask Claude (via the MCP server, sharing this same file +
 * selection) to change exactly what you pointed at. Edits reload live.
 */
import { mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createViewerServer } from "@deck/viewer";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });

const deckPath = join(outDir, "working.deck.json");
copyFileSync(join(repoRoot, "registry", "minimal-dark", "deck.json"), deckPath);

const selectionDir = join(homedir(), ".deck-contract");
mkdirSync(selectionDir, { recursive: true });
const selectionPath = join(selectionDir, "selection.json");

const port0 = Number(process.env.DECK_VIEWER_PORT ?? 4570);
const viewer = createViewerServer({ deckPath, selectionPath, port: port0 });
const port = await viewer.listen();
console.log(`viewer:    http://localhost:${port}`);
console.log(`deck file: ${deckPath}`);
console.log(`selection: ${selectionPath}`);
console.log("the MCP server can open_deck this file to edit it live alongside you.");
console.log("Ctrl+C to stop.");
