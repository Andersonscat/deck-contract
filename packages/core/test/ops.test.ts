import { describe, it, expect } from "vitest";
import { parseDeck } from "@deck/contract";
import { apply, buildIndex, collectIds, type Op } from "@deck/core";
import { makeDeck } from "./_fixture.js";

describe("buildIndex", () => {
  it("indexes every node and detects duplicate ids", () => {
    const deck = makeDeck();
    const idx = buildIndex(deck);
    expect(idx.has("title_main")).toBe(true);
    expect(idx.get("title_main")!.slideId).toBe("slide_01");

    const dup = makeDeck();
    dup.slides[0]!.children![0]!.children![0]!.id = "bullets_main"; // collide
    expect(() => buildIndex(dup)).toThrow(/duplicate node id/);
  });
});

describe("id stability (rewrite-forcing decision #1)", () => {
  it("inserting a node at index 0 changes NO existing id", () => {
    const deck = makeDeck();
    const before = collectIds(deck);

    const { deck: after } = apply(deck, [
      {
        op: "insert_node",
        parentId: "col_left",
        index: 0,
        node: { id: "eyebrow_new", type: "heading", content: { text: "NEW" } },
      },
    ]);

    const afterIds = collectIds(after);
    for (const id of before) expect(afterIds.has(id)).toBe(true);
    expect(afterIds.has("eyebrow_new")).toBe(true);
    // the new node is first; the previously-first node kept its id and moved to index 1
    expect(after.slides[0]!.children![0]!.children![0]!.id).toBe("eyebrow_new");
    expect(after.slides[0]!.children![0]!.children![1]!.id).toBe("title_main");
  });
});

describe("token-only invariant", () => {
  it("set_token rejects a raw value", () => {
    const deck = makeDeck();
    expect(() =>
      apply(deck, [{ op: "set_token", nodeId: "title_main", prop: "color", value: "#ff0000" }]),
    ).toThrow(/token-only/);
  });

  it("set_token accepts a token ref", () => {
    const deck = makeDeck();
    const { deck: after } = apply(deck, [
      { op: "set_token", nodeId: "title_main", prop: "color", value: "token://color/accent" },
    ]);
    expect(buildIndex(after).get("title_main")!.node.style!.color).toBe("token://color/accent");
  });
});

describe("transactional atomicity", () => {
  it("a failing op in the batch leaves the input deck completely unchanged", () => {
    const deck = makeDeck();
    const snapshot = JSON.stringify(deck);

    expect(() =>
      apply(deck, [
        { op: "set_text", nodeId: "title_main", value: "Changed" }, // would succeed
        { op: "set_text", nodeId: "does_not_exist", value: "x" }, // fails -> rollback all
      ]),
    ).toThrow(/not found/);

    // input object is byte-identical: no partial application
    expect(JSON.stringify(deck)).toBe(snapshot);
  });

  it("apply does not mutate the input (immutable, returns a new deck)", () => {
    const deck = makeDeck();
    const snapshot = JSON.stringify(deck);
    const { deck: after } = apply(deck, [
      { op: "set_text", nodeId: "title_main", value: "New title" },
    ]);
    expect(JSON.stringify(deck)).toBe(snapshot); // input untouched
    expect(after).not.toBe(deck);
    expect(buildIndex(after).get("title_main")!.node.content!.text).toBe("New title");
  });
});

describe("inverse round-trip (free undo)", () => {
  it("applying the inverse restores the original deck exactly", () => {
    const deck = parseDeck(makeDeck());
    const ops: Op[] = [
      { op: "set_text", nodeId: "title_main", value: "Totally new headline" },
      { op: "set_content", nodeId: "metric_rev", content: { value: "9x", label: "new label", delta: "+800%" } },
      { op: "set_token", nodeId: "title_main", prop: "color", value: "token://color/accent" },
      { op: "move_node", nodeId: "metric_rev", newParentId: "slide_01", index: 0 },
      {
        op: "insert_node",
        parentId: "col_left",
        index: 1,
        node: { id: "quote_x", type: "heading", content: { text: "inserted" } },
      },
      { op: "remove_node", nodeId: "bullets_main" },
    ];

    const { deck: edited, inverse } = apply(deck, ops);
    expect(JSON.stringify(edited)).not.toBe(JSON.stringify(deck));

    const { deck: restored } = apply(edited, inverse);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(deck));
  });
});

describe("free positioning (frames)", () => {
  it("set_frame adds a frame; inverse removes it back to flow", () => {
    const deck = makeDeck();
    const { deck: after, inverse } = apply(deck, [
      { op: "set_frame", nodeId: "title_main", frame: { x: 10, y: 20, w: 30, h: 8 } },
    ]);
    expect(buildIndex(after).get("title_main")!.node.frame).toEqual({ x: 10, y: 20, w: 30, h: 8 });
    const { deck: back } = apply(after, inverse);
    expect(buildIndex(back).get("title_main")!.node.frame).toBeUndefined();
    expect(JSON.stringify(back)).toBe(JSON.stringify(makeDeck()));
  });

  it("move_to requires a frame and patches x,y with inverse", () => {
    const deck = makeDeck();
    expect(() => apply(deck, [{ op: "move_to", nodeId: "title_main", x: 5, y: 5 }])).toThrow(/no frame/);

    const { deck: framed } = apply(deck, [{ op: "set_frame", nodeId: "title_main", frame: { x: 1, y: 2 } }]);
    const { deck: moved, inverse } = apply(framed, [{ op: "move_to", nodeId: "title_main", x: 40, y: 60 }]);
    expect(buildIndex(moved).get("title_main")!.node.frame).toMatchObject({ x: 40, y: 60 });
    const { deck: back } = apply(moved, inverse);
    expect(buildIndex(back).get("title_main")!.node.frame).toMatchObject({ x: 1, y: 2 });
  });
});

describe("test guard op", () => {
  it("passes when the value matches and blocks when it does not", () => {
    const deck = makeDeck();
    expect(() =>
      apply(deck, [
        { op: "test", nodeId: "title_main", field: "text", value: "Revenue grew 3x" },
        { op: "set_text", nodeId: "title_main", value: "ok" },
      ]),
    ).not.toThrow();

    expect(() =>
      apply(deck, [{ op: "test", nodeId: "title_main", field: "text", value: "wrong" }]),
    ).toThrow(/test failed/);
  });
});
