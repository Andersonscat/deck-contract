import type { DeckNode } from "@deck/contract";
import { genId, type IdGen } from "./ids.js";

/**
 * Copy a node subtree with FRESH ids for every node (load-bearing decision #1: a copy
 * never shares identity with its source). Used by insert_block to drop a library block
 * into a deck without id collisions. Returns the clone plus an old->new id map.
 */
export function cloneWithNewIds(
  node: DeckNode,
  gen: IdGen = genId,
): { node: DeckNode; idMap: Map<string, string> } {
  const copy = JSON.parse(JSON.stringify(node)) as DeckNode;
  const idMap = new Map<string, string>();
  const walk = (n: DeckNode): void => {
    const nid = gen(n.role ?? n.type);
    idMap.set(n.id, nid);
    n.id = nid;
    for (const c of n.children ?? []) walk(c);
  };
  walk(copy);
  return { node: copy, idMap };
}
