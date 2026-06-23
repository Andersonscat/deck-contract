import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { parseDeck, IssueCode } from "@deck/contract";
import { LocalChromiumRenderer } from "@deck/renderer";
import { makeDeck } from "../../core/test/_fixture.js";
import { makeOverflowingDeck } from "./_overflow.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let renderer: LocalChromiumRenderer;
beforeAll(() => {
  renderer = new LocalChromiumRenderer();
});
afterAll(async () => {
  await renderer.close();
});

describe("LocalChromiumRenderer", () => {
  it(
    "renders the well-formed sample deck with no overflow and one PNG per slide",
    async () => {
      const deck = parseDeck(makeDeck());
      const { slides, issues } = await renderer.render(deck);

      expect(issues).toEqual([]);
      expect(slides).toHaveLength(deck.slides.length);
      expect(slides[0]!.slideId).toBe("slide_01");
      // PNG magic bytes + retina dimensions reported logically
      expect(slides[0]!.png.subarray(0, 4).toString("hex")).toBe("89504e47");
      expect(slides[0]!.width).toBe(1280);
    },
    60_000,
  );

  it(
    "is deterministic: same deck -> identical issues and identical PNG bytes",
    async () => {
      const deck = parseDeck(makeDeck());
      const a = await renderer.render(deck);
      const b = await renderer.render(deck);

      expect(JSON.stringify(a.issues)).toBe(JSON.stringify(b.issues));
      expect(sha(a.slides[0]!.png)).toBe(sha(b.slides[0]!.png));
    },
    60_000,
  );

  it(
    "detects overflow on an overloaded slide (the measurer actually works)",
    async () => {
      const deck = parseDeck(makeOverflowingDeck());
      const { issues } = await renderer.render(deck);

      const overflow = issues.find(
        (i) => i.code === IssueCode.OVERFLOW && i.nodeId === "slide_over",
      );
      expect(overflow).toBeDefined();
      expect(Number(overflow!.measured!.overflowPx)).toBeGreaterThan(0);
      // the bullet list overruns the slide edge too
      expect(
        issues.some((i) => i.code === IssueCode.OUT_OF_BOUNDS && i.nodeId === "bullets_over"),
      ).toBe(true);
    },
    60_000,
  );
});
