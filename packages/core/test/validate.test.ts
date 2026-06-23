import { describe, it, expect } from "vitest";
import { IssueCode } from "@deck/contract";
import { validateTokens, apply, parseOps } from "@deck/core";
import { makeDeck } from "./_fixture.js";

describe("validateTokens (completes the token-only invariant)", () => {
  it("reports no issues for a deck whose tokens all resolve", () => {
    expect(validateTokens(makeDeck())).toEqual([]);
  });

  it("flags a dangling token ref as UNKNOWN_TOKEN", () => {
    // inject a token that has the right shape but does not exist in the theme
    const deck = makeDeck();
    deck.slides[0]!.children![0]!.children![0]!.style!.color = "token://color/nope";

    const issues = validateTokens(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(IssueCode.UNKNOWN_TOKEN);
    expect(issues[0]!.nodeId).toBe("title_main");
    expect(issues[0]!.slideId).toBe("slide_01");
  });

  it("also checks layout token refs (gap/padding)", () => {
    const deck = makeDeck();
    deck.slides[0]!.layout!.gap = "token://space/huge"; // not in theme.space
    const issues = validateTokens(deck);
    expect(issues.some((i) => i.code === IssueCode.UNKNOWN_TOKEN && i.nodeId === "slide_01")).toBe(
      true,
    );
  });
});

describe("op validation at the boundary (parse-don't-validate)", () => {
  it("parseOps rejects a malformed op", () => {
    expect(() => parseOps([{ op: "set_text", nodeId: "x" }])).toThrow(); // missing value
    expect(() => parseOps([{ op: "bogus", nodeId: "x" }])).toThrow();
    expect(() => parseOps([{ op: "set_text", nodeId: "x", value: "ok", extra: 1 }])).toThrow();
  });

  it("apply validates ops before touching the deck", () => {
    const deck = makeDeck();
    const snapshot = JSON.stringify(deck);
    expect(() => apply(deck, [{ op: "set_token", nodeId: "title_main", prop: "color", value: "red" } as never])).toThrow(
      /token-only/,
    );
    expect(JSON.stringify(deck)).toBe(snapshot);
  });
});
