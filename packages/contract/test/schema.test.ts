import { describe, it, expect } from "vitest";
import { parseDeck, DeckSchema, NodeSchema, isSupportedSpec, SPEC_ID } from "@deck/contract";
import { makeDeck } from "../../core/test/_fixture.js";

describe("DeckSchema", () => {
  it("accepts a well-formed deck", () => {
    expect(() => parseDeck(makeDeck())).not.toThrow();
  });

  it("rejects an unsupported spec version", () => {
    const bad = { ...makeDeck(), spec: "deck-contract/2" };
    expect(() => parseDeck(bad)).toThrow();
    expect(isSupportedSpec(SPEC_ID)).toBe(true);
    expect(isSupportedSpec("deck-contract/1.3")).toBe(true);
    expect(isSupportedSpec("deck-contract/2")).toBe(false);
  });
});

describe("token-only invariant at the schema boundary", () => {
  it("rejects a raw hex value in a node style", () => {
    const r = NodeSchema.safeParse({
      id: "x_1",
      type: "title",
      content: { text: "hi" },
      style: { color: "#ff0000" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a raw px value in a node style", () => {
    const r = NodeSchema.safeParse({
      id: "x_1",
      type: "title",
      style: { size: "44px" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a token ref in a node style", () => {
    const r = NodeSchema.safeParse({
      id: "x_1",
      type: "title",
      content: { text: "hi" },
      style: { color: "token://color/accent", size: "token://type/h1" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown extra fields on a node (strict)", () => {
    const r = NodeSchema.safeParse({ id: "x_1", type: "title", bogus: 1 });
    expect(r.success).toBe(false);
  });
});

describe("tolerant spec / strict shape", () => {
  it("requires at least one slide", () => {
    const bad = { ...makeDeck(), slides: [] };
    expect(DeckSchema.safeParse(bad).success).toBe(false);
  });
});
