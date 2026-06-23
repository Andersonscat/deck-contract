import type { Deck } from "@deck/contract";
import { makeDeck } from "../../core/test/_fixture.js";

/**
 * A deliberately overloaded slide: a single column whose stacked content is far
 * taller than the 720px frame. Used as a golden fixture to prove the measurer
 * actually detects overflow (and, on Day 3, that the fix loop converges).
 */
export function makeOverflowingDeck(): Deck {
  const base = makeDeck();
  const items = Array.from(
    { length: 40 },
    (_, i) => `Supporting point number ${i + 1} that is intentionally quite long to consume vertical space`,
  );
  return {
    ...base,
    id: "deck_overflow",
    slides: [
      {
        id: "slide_over",
        type: "slide",
        role: "content",
        layout: { direction: "column", gap: "token://space/md", padding: "token://space/xl" },
        children: [
          {
            id: "title_over",
            type: "title",
            content: { text: "A slide carrying far too much content to ever fit" },
            style: { color: "token://color/text", font: "token://font/heading", size: "token://type/display" },
          },
          {
            id: "bullets_over",
            type: "bullet-list",
            content: { items },
            style: { color: "token://color/text", size: "token://type/body" },
          },
        ],
      },
    ],
  };
}
