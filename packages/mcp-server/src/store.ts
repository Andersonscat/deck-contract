import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { genId } from "@deck/core";
import type { Deck } from "@deck/contract";

/**
 * Handle-based session state (load-bearing decision #7): tools never rely on a
 * "current deck" in process memory — load_template returns an opaque deck_id and every
 * other tool takes it back. State lives behind the DeckStore interface, so moving from
 * a local file to S3/Redis (for a hosted, stateless-HTTP server) is a swap, not a rewrite.
 */
export interface DeckStore {
  create(deck: Deck): Promise<string>;
  get(id: string): Promise<Deck | undefined>;
  put(id: string, deck: Deck): Promise<void>;
}

export class InMemoryDeckStore implements DeckStore {
  private decks = new Map<string, Deck>();

  async create(deck: Deck): Promise<string> {
    const id = genId("dk");
    this.decks.set(id, structuredClone(deck));
    return id;
  }
  async get(id: string): Promise<Deck | undefined> {
    const d = this.decks.get(id);
    return d ? structuredClone(d) : undefined;
  }
  async put(id: string, deck: Deck): Promise<void> {
    this.decks.set(id, structuredClone(deck));
  }
}

/** Persists each deck as deck.json (atomic write) so a session survives a restart. */
export class FileDeckStore implements DeckStore {
  constructor(private readonly root: string) {}

  private path(id: string): string {
    return join(this.root, `${id}.json`);
  }

  async create(deck: Deck): Promise<string> {
    const id = genId("dk");
    await this.put(id, deck);
    return id;
  }
  async get(id: string): Promise<Deck | undefined> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as Deck;
    } catch {
      return undefined;
    }
  }
  async put(id: string, deck: Deck): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const tmp = this.path(`${id}.tmp`);
    await writeFile(tmp, JSON.stringify(deck, null, 2), "utf8");
    await rename(tmp, this.path(id));
  }
}
