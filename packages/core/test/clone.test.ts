import { describe, it, expect } from "vitest";
import { cloneWithNewIds, collectIds, sequentialIdGen } from "@deck/core";
import type { DeckNode } from "@deck/contract";

const block: DeckNode = {
  id: "stat",
  type: "stat-callout",
  role: "key-metric",
  content: { value: "3x", label: "growth" },
  children: [{ id: "inner", type: "heading", content: { text: "x" } }],
};

describe("cloneWithNewIds", () => {
  it("produces fresh ids for every node and shares none with the source", () => {
    const { node, idMap } = cloneWithNewIds(block, sequentialIdGen());
    const oldIds = new Set(["stat", "inner"]);
    const newIds = new Set<string>();
    const walk = (n: DeckNode) => {
      newIds.add(n.id);
      for (const c of n.children ?? []) walk(c);
    };
    walk(node);

    for (const id of newIds) expect(oldIds.has(id)).toBe(false);
    expect(idMap.get("stat")).toBe(node.id);
    expect(idMap.size).toBe(2);
    // structure + content preserved
    expect(node.type).toBe("stat-callout");
    expect(node.content!.value).toBe("3x");
    expect(node.children![0]!.content!.text).toBe("x");
  });

  it("does not mutate the source node", () => {
    const snapshot = JSON.stringify(block);
    cloneWithNewIds(block);
    expect(JSON.stringify(block)).toBe(snapshot);
  });
});
