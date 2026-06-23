import { produce, current } from "immer";
import { z } from "zod";
import { NodeSchema, TOKEN_REF, type Deck, type DeckNode } from "@deck/contract";

/**
 * Mutation layer. Ops address nodes by STABLE id (never by JSON Pointer / index),
 * so inserting/removing siblings never makes the model miss its target. `apply` is
 * transactional all-or-nothing: it runs on an immer draft and any failure throws,
 * leaving the input deck untouched (referential equality preserved). Every op
 * yields an inverse, so undo is free even before there's an undo UI.
 *
 * "@slides" is the sentinel parent id meaning the top-level slide list.
 */
export const SLIDES_PARENT = "@slides";

export type Op =
  | { op: "set_text"; nodeId: string; value: string }
  | { op: "set_token"; nodeId: string; prop: string; value: string }
  | { op: "remove_token"; nodeId: string; prop: string }
  | { op: "insert_node"; parentId: string; index: number; node: DeckNode }
  | { op: "remove_node"; nodeId: string }
  | { op: "move_node"; nodeId: string; newParentId: string; index: number }
  | { op: "test"; nodeId: string; field: "text"; value: string };

/**
 * Runtime op validation (parse-don't-validate at the boundary). Ops arrive from an
 * untrusted source (the MCP tool call), so `apply` parses them before touching the
 * deck. The token-only invariant is enforced here too: set_token rejects non-token
 * values at parse time with a clear message.
 */
const idStr = z.string().min(1);
export const OpSchema: z.ZodType<Op> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_text"), nodeId: idStr, value: z.string() }).strict(),
  z
    .object({
      op: z.literal("set_token"),
      nodeId: idStr,
      prop: z.string().min(1),
      value: z
        .string()
        .regex(TOKEN_REF, "set_token rejected: value must be a token ref (token-only invariant)"),
    })
    .strict(),
  z.object({ op: z.literal("remove_token"), nodeId: idStr, prop: z.string().min(1) }).strict(),
  z
    .object({ op: z.literal("insert_node"), parentId: idStr, index: z.number().int(), node: NodeSchema })
    .strict(),
  z.object({ op: z.literal("remove_node"), nodeId: idStr }).strict(),
  z
    .object({ op: z.literal("move_node"), nodeId: idStr, newParentId: idStr, index: z.number().int() })
    .strict(),
  z.object({ op: z.literal("test"), nodeId: idStr, field: z.literal("text"), value: z.string() }).strict(),
]) as z.ZodType<Op>;

/** Parse an untrusted op list into validated Ops (throws ZodError on bad input). */
export function parseOps(input: unknown): Op[] {
  return z.array(OpSchema).parse(input);
}

export interface ApplyResult {
  deck: Deck;
  /** Inverse ops in the order needed to undo (already reversed). */
  inverse: Op[];
}

interface Loc {
  node: DeckNode;
  siblings: DeckNode[];
  index: number;
  parentId: string;
}

function childrenOf(draft: Deck, parentId: string): DeckNode[] {
  if (parentId === SLIDES_PARENT) return draft.slides;
  const loc = locate(draft, parentId);
  if (!loc) throw new Error(`parent node "${parentId}" not found`);
  if (!loc.node.children) loc.node.children = [];
  return loc.node.children;
}

function locate(draft: Deck, id: string): Loc | undefined {
  const search = (siblings: DeckNode[], parentId: string): Loc | undefined => {
    for (let i = 0; i < siblings.length; i++) {
      const node = siblings[i]!;
      if (node.id === id) return { node, siblings, index: i, parentId };
      if (node.children) {
        const hit = search(node.children, node.id);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return search(draft.slides, SLIDES_PARENT);
}

function* walkIds(node: DeckNode): Generator<string> {
  yield node.id;
  for (const c of node.children ?? []) yield* walkIds(c);
}

function allIds(draft: Deck): Set<string> {
  const set = new Set<string>();
  for (const s of draft.slides) for (const id of walkIds(s)) set.add(id);
  return set;
}

function need(draft: Deck, id: string): Loc {
  const loc = locate(draft, id);
  if (!loc) throw new Error(`node "${id}" not found`);
  return loc;
}

/** Apply ops transactionally. Throws (input unchanged) on any validation failure. */
export function apply(deck: Deck, ops: Op[]): ApplyResult {
  const validated = parseOps(ops);
  const inverse: Op[] = [];

  const next = produce(deck, (draft) => {
    for (const op of validated) {
      switch (op.op) {
        case "test": {
          const { node } = need(draft, op.nodeId);
          const actual = node.content?.text;
          if (actual !== op.value) {
            throw new Error(
              `test failed on "${op.nodeId}".text: expected ${JSON.stringify(
                op.value,
              )}, got ${JSON.stringify(actual)}`,
            );
          }
          break;
        }
        case "set_text": {
          const { node } = need(draft, op.nodeId);
          const old = node.content?.text ?? "";
          if (!node.content) node.content = {};
          node.content.text = op.value;
          inverse.push({ op: "set_text", nodeId: op.nodeId, value: old });
          break;
        }
        case "set_token": {
          if (!TOKEN_REF.test(op.value)) {
            throw new Error(
              `set_token rejected: "${op.value}" is not a token ref (token-only invariant)`,
            );
          }
          const { node } = need(draft, op.nodeId);
          const old = node.style?.[op.prop];
          if (!node.style) node.style = {};
          node.style[op.prop] = op.value;
          inverse.push(
            old === undefined
              ? { op: "remove_token", nodeId: op.nodeId, prop: op.prop }
              : { op: "set_token", nodeId: op.nodeId, prop: op.prop, value: old },
          );
          break;
        }
        case "remove_token": {
          const { node } = need(draft, op.nodeId);
          const old = node.style?.[op.prop];
          if (old === undefined) {
            throw new Error(`remove_token: "${op.prop}" not set on "${op.nodeId}"`);
          }
          delete node.style![op.prop];
          inverse.push({ op: "set_token", nodeId: op.nodeId, prop: op.prop, value: old });
          break;
        }
        case "insert_node": {
          const parsed = NodeSchema.parse(op.node);
          const existing = allIds(draft);
          for (const id of walkIds(parsed)) {
            if (existing.has(id)) throw new Error(`insert_node: id "${id}" already exists`);
          }
          const siblings = childrenOf(draft, op.parentId);
          const at = Math.max(0, Math.min(op.index, siblings.length));
          siblings.splice(at, 0, parsed);
          inverse.push({ op: "remove_node", nodeId: parsed.id });
          break;
        }
        case "remove_node": {
          const loc = need(draft, op.nodeId);
          const [removed] = loc.siblings.splice(loc.index, 1);
          // Snapshot the draft into a plain object; the draft proxy is revoked
          // once produce() finishes, so the inverse must not hold a reference to it.
          inverse.push({
            op: "insert_node",
            parentId: loc.parentId,
            index: loc.index,
            node: current(removed!),
          });
          break;
        }
        case "move_node": {
          const loc = need(draft, op.nodeId);
          const fromParent = loc.parentId;
          const fromIndex = loc.index;
          const [moved] = loc.siblings.splice(loc.index, 1);
          const dest = childrenOf(draft, op.newParentId);
          const at = Math.max(0, Math.min(op.index, dest.length));
          dest.splice(at, 0, moved!);
          inverse.push({
            op: "move_node",
            nodeId: op.nodeId,
            newParentId: fromParent,
            index: fromIndex,
          });
          break;
        }
        default: {
          const _exhaustive: never = op;
          throw new Error(`unknown op ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
  });

  inverse.reverse();
  return { deck: next, inverse };
}
