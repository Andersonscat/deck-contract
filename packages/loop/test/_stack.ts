import type { Deck, DeckNode } from "@deck/contract";
import { makeDeck } from "../../core/test/_fixture.js";

/**
 * A column of N heading nodes that overruns the 720px frame by several headings.
 * Because each heading is a separate node, a trim-one-child-per-step solver shows a
 * multi-iteration, strictly-monotone descent to zero overflow (not a trivial one-shot).
 */
export function makeStackOverflowDeck(count = 12): Deck {
  const base = makeDeck();
  const children: DeckNode[] = Array.from({ length: count }, (_, i) => ({
    id: `heading_${String(i + 1).padStart(2, "0")}`,
    type: "heading",
    content: { text: `Section line number ${i + 1}` },
    style: { color: "token://color/text", font: "token://font/heading", size: "token://type/h1" },
  }));

  return {
    ...base,
    id: "deck_stack",
    slides: [
      {
        id: "slide_stack",
        type: "slide",
        role: "content",
        layout: { direction: "column", gap: "token://space/md", padding: "token://space/xl" },
        children,
      },
    ],
  };
}
