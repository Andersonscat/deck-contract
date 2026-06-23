import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { NodeSchema, parseDeck, type Deck, type DeckNode } from "@deck/contract";

/**
 * Template resolution. The MVP source is a flat directory of self-contained packages
 * (each = template.json manifest + deck.json). The TemplateSource interface is the
 * seam: a future git/registry/CDN source implements the same shape, so the loader and
 * the eventual registry share one resolution path (no rewrite).
 */
export interface TemplateMeta {
  id: string;
  name: string;
  version: string;
  domain: string;
}

export interface TemplateManifest extends TemplateMeta {
  /** Insertable library blocks, keyed by block id. */
  blocks: Record<string, DeckNode>;
}

export interface TemplateSource {
  list(): Promise<TemplateMeta[]>;
  load(id: string): Promise<Deck>;
  manifest(id: string): Promise<TemplateManifest>;
}

const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  domain: z.string().default("presentation"),
  blocks: z.record(z.string(), NodeSchema).default({}),
});

export class FileTemplateSource implements TemplateSource {
  constructor(private readonly root: string) {}

  async list(): Promise<TemplateMeta[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const metas: TemplateMeta[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const m = await this.manifest(e.name);
        metas.push({ id: m.id, name: m.name, version: m.version, domain: m.domain });
      } catch {
        // skip folders that aren't valid template packages
      }
    }
    return metas.sort((a, b) => a.id.localeCompare(b.id));
  }

  async manifest(id: string): Promise<TemplateManifest> {
    const raw = await readFile(join(this.root, id, "template.json"), "utf8");
    return ManifestSchema.parse(JSON.parse(raw));
  }

  async load(id: string): Promise<Deck> {
    const raw = await readFile(join(this.root, id, "deck.json"), "utf8");
    return parseDeck(JSON.parse(raw));
  }
}
