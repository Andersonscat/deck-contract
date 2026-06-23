import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  apply,
  buildIndex,
  cloneWithNewIds,
  findNode,
  type Op,
} from "@deck/core";
import { parseDeck, type Deck, type DeckNode, type Issue } from "@deck/contract";
import { LocalChromiumRenderer } from "@deck/renderer";
import type { TemplateMeta, TemplateSource } from "@deck/loader";
import type { DeckStore } from "./store.js";

export interface OutlineEntry {
  id: string;
  type: string;
  role?: string;
  slideId: string;
  preview: string;
}

export interface RenderToolResult {
  issues: Issue[];
  slides: { slideId: string; pngPath: string }[];
}

function previewOf(node: DeckNode): string {
  const c = node.content ?? {};
  const text = c.text ?? c.items?.[0] ?? c.value ?? c.caption ?? "";
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}

function outlineOf(deck: Deck): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const { node, slideId } of buildIndex(deck).values()) {
    out.push({ id: node.id, type: node.type, role: node.role, slideId, preview: previewOf(node) });
  }
  return out;
}

/**
 * DeckService — the 7 MCP tools as plain async methods (the functional shell). The MCP
 * transport binding in server.ts is a thin wrapper over these, so the whole tool surface
 * is testable without spawning a process.
 */
export class DeckService {
  /** Per-session insertable blocks, loaded with the template. */
  private blocks = new Map<string, Record<string, DeckNode>>();
  /** deck_id -> external file path, for sessions shared live with the viewer. */
  private fileBacked = new Map<string, string>();
  private outDir: string;

  constructor(
    private readonly store: DeckStore,
    private readonly renderer: LocalChromiumRenderer,
    private readonly templates: TemplateSource,
    outDir?: string,
    /** Shared with the viewer: where the user's "AI target" selection is written. */
    private readonly selectionPath?: string,
  ) {
    this.outDir = outDir ?? join(tmpdir(), "deck-contract-out");
  }

  listTemplates(): Promise<TemplateMeta[]> {
    return this.templates.list();
  }

  /** The element the user pointed at in the viewer (the thing they want changed). */
  async getSelection(): Promise<{ nodeId: string } | null> {
    if (!this.selectionPath) return null;
    try {
      return JSON.parse(await readFile(this.selectionPath, "utf8")) as { nodeId: string };
    } catch {
      return null;
    }
  }

  async loadTemplate(templateId: string): Promise<{ deckId: string; title: string; outline: OutlineEntry[] }> {
    const deck = await this.templates.load(templateId);
    const manifest = await this.templates.manifest(templateId);
    const deckId = await this.store.create(deck);
    this.blocks.set(deckId, manifest.blocks);
    return { deckId, title: deck.title ?? deck.id, outline: outlineOf(deck) };
  }

  /** Open a deck file as a live session shared with the viewer (the same deck.json). */
  async openDeck(path: string): Promise<{ deckId: string; title: string; outline: OutlineEntry[] }> {
    const deck = parseDeck(JSON.parse(await readFile(path, "utf8")));
    const deckId = await this.store.create(deck);
    this.fileBacked.set(deckId, path);
    return { deckId, title: deck.title ?? deck.id, outline: outlineOf(deck) };
  }

  /** For file-backed sessions the FILE is the source of truth (so user + AI stay in sync). */
  private async require(deckId: string): Promise<Deck> {
    const path = this.fileBacked.get(deckId);
    if (path) return parseDeck(JSON.parse(await readFile(path, "utf8")));
    const deck = await this.store.get(deckId);
    if (!deck) throw new Error(`unknown deck_id "${deckId}" (call load_template or open_deck first)`);
    return deck;
  }

  private async persist(deckId: string, deck: Deck): Promise<void> {
    const path = this.fileBacked.get(deckId);
    if (path) await writeFile(path, JSON.stringify(deck, null, 2), "utf8");
    else await this.store.put(deckId, deck);
  }

  async getOutline(deckId: string): Promise<OutlineEntry[]> {
    return outlineOf(await this.require(deckId));
  }

  async getNode(deckId: string, nodeId: string): Promise<DeckNode> {
    const node = findNode(await this.require(deckId), nodeId);
    if (!node) throw new Error(`node "${nodeId}" not found`);
    return node;
  }

  async applyPatch(deckId: string, ops: Op[]): Promise<{ ok: true }> {
    const deck = await this.require(deckId);
    const { deck: next } = apply(deck, ops); // validates ops; throws -> deck untouched
    await this.persist(deckId, next);
    return { ok: true };
  }

  async insertBlock(
    deckId: string,
    blockId: string,
    parentId: string,
    index: number,
  ): Promise<{ newNodeId: string }> {
    const deck = await this.require(deckId);
    const block = this.blocks.get(deckId)?.[blockId];
    if (!block) throw new Error(`unknown block "${blockId}" for this template`);
    const { node } = cloneWithNewIds(block);
    const { deck: next } = apply(deck, [{ op: "insert_node", parentId, index, node }]);
    await this.persist(deckId, next);
    return { newNodeId: node.id };
  }

  async render(deckId: string, slideId?: string): Promise<RenderToolResult> {
    const deck = await this.require(deckId);
    const { slides, issues } = await this.renderer.render(deck);
    await mkdir(this.outDir, { recursive: true });
    const out: { slideId: string; pngPath: string }[] = [];
    for (const s of slides) {
      if (slideId && s.slideId !== slideId) continue;
      const p = join(this.outDir, `${deckId}-${s.slideId}.png`);
      await writeFile(p, s.png);
      out.push({ slideId: s.slideId, pngPath: p });
    }
    const scoped = slideId ? issues.filter((i) => i.slideId === slideId) : issues;
    return { issues: scoped, slides: out };
  }

  async exportDeck(deckId: string, format: "pdf"): Promise<{ path: string }> {
    const deck = await this.require(deckId);
    await mkdir(this.outDir, { recursive: true });
    const path = join(this.outDir, `${deckId}.${format}`);
    const pdf = await this.renderer.exportPdf(deck);
    await writeFile(path, pdf);
    return { path };
  }
}
