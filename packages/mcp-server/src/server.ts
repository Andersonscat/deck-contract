import { readFile } from "node:fs/promises";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OpSchema } from "@deck/core";
import type { DeckService } from "./engine.js";

/**
 * The MCP transport binding — a thin wrapper. Each tool parses its args, calls one
 * DeckService method, and serializes the result. Domain errors come back as
 * `isError: true` with an actionable message (so the model can self-correct), never as
 * protocol errors. The core stays untouched if the transport ever changes.
 */
const ok = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const fail = (e: unknown): CallToolResult => ({
  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
  isError: true,
});

async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return fail(e);
  }
}

export function createServer(service: DeckService): McpServer {
  const server = new McpServer({ name: "deck-contract", version: "0.1.0" });

  server.registerTool(
    "list_templates",
    {
      description: "List installed deck templates you can load.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => ok(await service.listTemplates())),
  );

  server.registerTool(
    "load_template",
    {
      description: "Start a session from a template. Returns an opaque deck_id (pass it to every other tool) and the outline.",
      inputSchema: { template_id: z.string() },
    },
    ({ template_id }) => guard(async () => ok(await service.loadTemplate(template_id))),
  );

  server.registerTool(
    "get_outline",
    {
      description: "Flat list of every component (id, type, role, slide, text preview) for targeting edits.",
      inputSchema: { deck_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ deck_id }) => guard(async () => ok(await service.getOutline(deck_id))),
  );

  server.registerTool(
    "get_node",
    {
      description: "Read one component by id before editing it.",
      inputSchema: { deck_id: z.string(), node_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ deck_id, node_id }) => guard(async () => ok(await service.getNode(deck_id, node_id))),
  );

  server.registerTool(
    "apply_patch",
    {
      description:
        "Apply atomic, id-addressed edits (set_text, set_token, insert_node, remove_node, move_node, test). All-or-nothing; styles must be theme tokens.",
      inputSchema: { deck_id: z.string(), ops: z.array(OpSchema) },
    },
    ({ deck_id, ops }) => guard(async () => ok(await service.applyPatch(deck_id, ops))),
  );

  server.registerTool(
    "insert_block",
    {
      description: "Insert a library block (by id) into a container at an index. The block gets fresh ids.",
      inputSchema: {
        deck_id: z.string(),
        block_id: z.string(),
        parent_id: z.string(),
        index: z.number().int().default(0),
      },
    },
    ({ deck_id, block_id, parent_id, index }) =>
      guard(async () => ok(await service.insertBlock(deck_id, block_id, parent_id, index))),
  );

  server.registerTool(
    "render",
    {
      description: "Render the deck (or one slide) to PNG and return any overflow / out-of-bounds issues to fix.",
      inputSchema: { deck_id: z.string(), slide_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ deck_id, slide_id }) =>
      guard(async () => {
        const result = await service.render(deck_id, slide_id);
        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify({ issues: result.issues, slides: result.slides }) },
        ];
        // attach the first rendered slide as an image so the model can see it
        const first = result.slides[0];
        if (first) {
          const b64 = (await readFile(first.pngPath)).toString("base64");
          content.push({ type: "image", data: b64, mimeType: "image/png" });
        }
        return { content };
      }),
  );

  server.registerTool(
    "export_deck",
    {
      description: "Export the finished deck to a PDF file (vector text). Returns the file path.",
      inputSchema: { deck_id: z.string(), format: z.literal("pdf").default("pdf") },
      annotations: { readOnlyHint: true },
    },
    ({ deck_id, format }) => guard(async () => ok(await service.exportDeck(deck_id, format))),
  );

  return server;
}
