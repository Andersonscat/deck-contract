import type { Deck, DeckNode } from "@deck/contract";

export interface IndexEntry {
  node: DeckNode;
  /** null for top-level slides (their container is the deck). */
  parent: DeckNode | null;
  /** index within its parent's children (or within deck.slides). */
  index: number;
  slideId: string;
}

/**
 * Walk the whole deck and build an id -> entry index. Throws on duplicate ids:
 * uniqueness is an invariant the surgical-edit model relies on. O(n), one pass.
 */
export function buildIndex(deck: Deck): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();

  const visit = (
    node: DeckNode,
    parent: DeckNode | null,
    i: number,
    slideId: string,
  ): void => {
    if (index.has(node.id)) {
      throw new Error(`duplicate node id "${node.id}" — ids must be unique`);
    }
    index.set(node.id, { node, parent, index: i, slideId });
    const kids = node.children ?? [];
    for (let k = 0; k < kids.length; k++) {
      visit(kids[k]!, node, k, slideId);
    }
  };

  for (let s = 0; s < deck.slides.length; s++) {
    const slide = deck.slides[s]!;
    visit(slide, null, s, slide.id);
  }
  return index;
}

export function findNode(deck: Deck, id: string): DeckNode | undefined {
  return buildIndex(deck).get(id)?.node;
}

/** All ids currently in the deck (for collision checks and diagnostics). */
export function collectIds(deck: Deck): Set<string> {
  return new Set(buildIndex(deck).keys());
}
