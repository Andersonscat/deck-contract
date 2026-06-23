#!/usr/bin/env -S npx tsx
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalChromiumRenderer } from "@deck/renderer";
import { FileTemplateSource } from "@deck/loader";
import { FileDeckStore } from "./store.js";
import { DeckService } from "./engine.js";
import { createServer } from "./server.js";

/**
 * Local stdio entrypoint. Wires the real side-effecting deps (file store, Chromium
 * renderer, file template source) and connects over stdio. Registry path defaults to
 * the repo's registry/ but can be overridden with DECK_REGISTRY.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../.."); // packages/mcp-server/src -> repo root
  const registryDir = process.env.DECK_REGISTRY ?? join(repoRoot, "registry");
  const decksDir = process.env.DECK_STORE ?? join(homedir(), ".deck-contract", "decks");

  const store = new FileDeckStore(decksDir);
  const renderer = new LocalChromiumRenderer();
  const templates = new FileTemplateSource(registryDir);
  const service = new DeckService(store, renderer, templates);

  const server = createServer(service);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`deck-contract MCP server ready (registry: ${registryDir})\n`);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
