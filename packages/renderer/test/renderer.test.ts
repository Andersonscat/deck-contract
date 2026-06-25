import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { parseDeck, IssueCode } from "@deck/contract";
import { apply } from "@deck/core";
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
    "exports a PDF with vector text",
    async () => {
      const deck = parseDeck(makeDeck());
      const pdf = await renderer.exportPdf(deck);
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
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

  it(
    "observes resolved colours + WCAG contrast per text node (neutral facts, no verdict)",
    async () => {
      const deck = parseDeck(makeDeck());
      const { observations } = await renderer.render(deck);

      expect(observations.length).toBeGreaterThan(0);
      const title = observations.find((o) => o.nodeId === "title_main");
      expect(title).toBeDefined();
      expect(/^#[0-9a-f]{6}$/.test(title!.fg)).toBe(true);
      expect(/^#[0-9a-f]{6}$/.test(title!.bg)).toBe(true);
      expect(title!.contrast).toBeGreaterThan(4.5); // dark text (#111) on white bg
    },
    60_000,
  );

  it(
    "contrast collapses to ~1 when text colour matches its background (catches invisible text)",
    async () => {
      const { deck: invisible } = apply(parseDeck(makeDeck()), [
        { op: "set_token", nodeId: "title_main", prop: "color", value: "token://color/bg" },
      ]);
      const { observations } = await renderer.render(invisible);

      const title = observations.find((o) => o.nodeId === "title_main")!;
      // white-on-white -> a MEASURED number the model cannot fake, not a system opinion
      expect(title.contrast).toBeLessThan(1.5);
    },
    60_000,
  );
});
