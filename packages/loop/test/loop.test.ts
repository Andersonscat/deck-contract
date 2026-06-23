import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseDeck, type Deck, type Issue } from "@deck/contract";
import { type Op } from "@deck/core";
import { LocalChromiumRenderer } from "@deck/renderer";
import { runFixLoop, overflowScalar, trimToFitSolver } from "@deck/loop";
import { makeDeck } from "../../core/test/_fixture.js";
import { makeStackOverflowDeck } from "./_stack.js";

let renderer: LocalChromiumRenderer;
beforeAll(() => {
  renderer = new LocalChromiumRenderer();
});
afterAll(async () => {
  await renderer.close();
});

describe("render-and-check loop (the convergence claim)", () => {
  it(
    "converges on an overflowing deck with a strictly-monotone descent",
    async () => {
      const deck = parseDeck(makeStackOverflowDeck());
      const result = await runFixLoop(deck, renderer, trimToFitSolver, { maxIterations: 20 });

      expect(result.converged).toBe(true);
      expect(result.reason).toBe("converged");
      expect(result.finalIssues).toEqual([]);
      // multi-step, not a one-shot
      expect(result.history.length).toBeGreaterThan(1);
      // every accepted step strictly reduced the overflow scalar (monotone)
      for (const step of result.history) {
        expect(step.accepted).toBe(true);
        expect(step.scalarAfter).toBeLessThan(step.scalarBefore);
      }
      // converged deck genuinely has no overflow on a fresh render
      const fresh = await renderer.render(result.deck);
      expect(fresh.issues).toEqual([]);
    },
    120_000,
  );

  it(
    "is a no-op on a deck that already fits (zero iterations)",
    async () => {
      const deck = parseDeck(makeDeck());
      const result = await runFixLoop(deck, renderer, trimToFitSolver);
      expect(result.converged).toBe(true);
      expect(result.iterations).toBe(0);
      expect(result.history).toEqual([]);
    },
    60_000,
  );

  it(
    "TERMINATES (does not spin) when a solver makes no progress",
    async () => {
      const deck = parseDeck(makeStackOverflowDeck());
      // a bad solver that only recolors — never reduces height
      const uselessSolver = (_d: Deck, _i: Issue[]): Op[] => [
        { op: "set_token", nodeId: "heading_01", prop: "color", value: "token://color/accent" },
      ];
      const result = await runFixLoop(deck, renderer, uselessSolver, { maxIterations: 50 });

      expect(result.converged).toBe(false);
      expect(result.reason).toBe("no-progress");
      expect(result.iterations).toBeLessThan(2); // stopped immediately, no thrashing
    },
    60_000,
  );

  it("overflowScalar sums overflow magnitudes", () => {
    const issues = [
      { code: "OVERFLOW", nodeId: "a", severity: "error", detail: "", measured: { overflowPx: 40 } },
      { code: "OUT_OF_BOUNDS", nodeId: "b", severity: "error", detail: "", measured: { overflowPx: 12 } },
      { code: "OVERFLOW", nodeId: "c", severity: "error", detail: "" },
    ] as Issue[];
    expect(overflowScalar(issues)).toBe(52);
  });
});
