import { describe, it, expect } from "vitest";
import { genId, isValidId, sequentialIdGen } from "@deck/core";

describe("ids", () => {
  it("genId produces a valid, role-prefixed id", () => {
    const id = genId("slide-title");
    expect(id.startsWith("slidetitle_")).toBe(true);
    expect(isValidId(id)).toBe(true);
  });

  it("genId is collision-resistant across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(genId("nd"));
    expect(seen.size).toBe(5000);
  });

  it("sequentialIdGen is deterministic (for reproducible tests)", () => {
    const gen = sequentialIdGen();
    expect(gen("title")).toBe("title_0001");
    expect(gen("title")).toBe("title_0002");
    expect(gen("bullet list")).toBe("bulletlist_0003");
  });
});
