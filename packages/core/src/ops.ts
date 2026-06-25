import { produce, current } from "immer";
import { z } from "zod";
import {
  NodeSchema,
  ContentSchema,
  FrameSchema,
  MarkSchema,
  MARK_PROPS,
  TOKEN_REF,
  normalizeMarks,
  setRangeStyle,
  type Content,
  type Deck,
  type DeckNode,
  type Frame,
  type Mark,
} from "@deck/contract";

/** Where a range op points: explicit char offsets, or a text match (the AI's path). */
export type RangeTarget = { from: number; to: number } | { match: string; nth?: number };
type MarkProp = (typeof MARK_PROPS)[number];

/**
 * A generic, INTENT-FREE predicate over nodes — the enumeration the bulk op (set_token_where)
 * runs in deterministic code so a weak model only has to choose the token, never loop over
 * nodes. It is a selector ("all text-bearing nodes on this slide"), not a per-intent function.
 */
export type NodeSelector = {
  types?: string[];
  roles?: string[];
  hasText?: boolean;
  slideId?: string;
};

function hasTextContent(n: DeckNode): boolean {
  const c = n.content;
  if (!c) return false;
  if (typeof c.text === "string" && c.text.trim() !== "") return true;
  if (Array.isArray(c.items) && c.items.length > 0) return true;
  for (const k of ["value", "label", "caption"] as const) {
    const v = (c as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() !== "") return true;
  }
  return false;
}

function matchesSelector(n: DeckNode, sel: NodeSelector): boolean {
  if (sel.types && !sel.types.includes(n.type)) return false;
  if (sel.roles && (!n.role || !sel.roles.includes(n.role))) return false;
  if (sel.hasText && !hasTextContent(n)) return false;
  return true;
}

/** Every node matching the selector, in document order. Pure. An empty selector matches nothing. */
export function selectNodes(deck: Deck, sel: NodeSelector): DeckNode[] {
  const out: DeckNode[] = [];
  if (!sel.types && !sel.roles && !sel.hasText) return out;
  const walk = (n: DeckNode) => {
    if (matchesSelector(n, sel)) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const s of deck.slides) {
    if (sel.slideId && s.id !== sel.slideId) continue;
    walk(s);
  }
  return out;
}

function resolveRange(text: string, target: RangeTarget, nodeId: string): { from: number; to: number } {
  if ("from" in target) return { from: target.from, to: target.to };
  const occ = target.nth ?? 1;
  let idx = -1;
  for (let n = 0; ; ) {
    idx = text.indexOf(target.match, idx + 1);
    if (idx < 0) break;
    if (++n === occ) return { from: idx, to: idx + target.match.length };
  }
  throw new Error(`range op: occurrence ${occ} of "${target.match}" not found in "${nodeId}"`);
}

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
  | { op: "set_content"; nodeId: string; content: Content }
  | { op: "set_token"; nodeId: string; prop: string; value: string }
  | { op: "set_token_where"; selector: NodeSelector; prop: string; value: string }
  | { op: "set_align"; nodeId: string; value: "left" | "center" | "right" }
  | { op: "set_frame"; nodeId: string; frame: Frame }
  | { op: "remove_frame"; nodeId: string }
  | { op: "move_to"; nodeId: string; x: number; y: number }
  | { op: "remove_token"; nodeId: string; prop: string }
  | { op: "insert_node"; parentId: string; index: number; node: DeckNode }
  | { op: "remove_node"; nodeId: string }
  | { op: "move_node"; nodeId: string; newParentId: string; index: number }
  | { op: "format_range"; nodeId: string; target: RangeTarget; prop: MarkProp; value: string }
  | { op: "clear_range"; nodeId: string; target: RangeTarget; prop: MarkProp }
  | { op: "set_marks"; nodeId: string; marks: Mark[] }
  | { op: "test"; nodeId: string; field: "text"; value: string };

/**
 * Runtime op validation (parse-don't-validate at the boundary). Ops arrive from an
 * untrusted source (the MCP tool call), so `apply` parses them before touching the
 * deck. The token-only invariant is enforced here too: set_token rejects non-token
 * values at parse time with a clear message.
 */
const idStr = z.string().min(1);
const RangeTargetSchema = z.union([
  z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict(),
  z.object({ match: z.string().min(1), nth: z.number().int().positive().optional() }).strict(),
]);
export const OpSchema: z.ZodType<Op> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_text"), nodeId: idStr, value: z.string() }).strict(),
  z.object({ op: z.literal("set_content"), nodeId: idStr, content: ContentSchema }).strict(),
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
  z
    .object({
      op: z.literal("set_token_where"),
      selector: z
        .object({
          types: z.array(z.string()).optional(),
          roles: z.array(z.string()).optional(),
          hasText: z.boolean().optional(),
          slideId: z.string().optional(),
        })
        .strict(),
      prop: z.string().min(1),
      value: z
        .string()
        .regex(TOKEN_REF, "set_token_where rejected: value must be a token ref (token-only invariant)"),
    })
    .strict(),
  z.object({ op: z.literal("set_align"), nodeId: idStr, value: z.enum(["left", "center", "right"]) }).strict(),
  z.object({ op: z.literal("set_frame"), nodeId: idStr, frame: FrameSchema }).strict(),
  z.object({ op: z.literal("remove_frame"), nodeId: idStr }).strict(),
  z.object({ op: z.literal("move_to"), nodeId: idStr, x: z.number(), y: z.number() }).strict(),
  z.object({ op: z.literal("remove_token"), nodeId: idStr, prop: z.string().min(1) }).strict(),
  z
    .object({ op: z.literal("insert_node"), parentId: idStr, index: z.number().int(), node: NodeSchema })
    .strict(),
  z.object({ op: z.literal("remove_node"), nodeId: idStr }).strict(),
  z
    .object({ op: z.literal("move_node"), nodeId: idStr, newParentId: idStr, index: z.number().int() })
    .strict(),
  z
    .object({
      op: z.literal("format_range"),
      nodeId: idStr,
      target: RangeTargetSchema,
      prop: z.enum(MARK_PROPS),
      value: z
        .string()
        .regex(TOKEN_REF, "format_range rejected: value must be a token ref (token-only invariant)"),
    })
    .strict(),
  z.object({ op: z.literal("clear_range"), nodeId: idStr, target: RangeTargetSchema, prop: z.enum(MARK_PROPS) }).strict(),
  z.object({ op: z.literal("set_marks"), nodeId: idStr, marks: z.array(MarkSchema) }).strict(),
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
          const oldContent = node.content ? (current(node.content) as Content) : undefined;
          if (!node.content) node.content = {};
          node.content.text = op.value;
          if (node.content.marks) {
            // the string changed -> old character offsets are invalid; reset formatting.
            delete node.content.marks;
            inverse.push({ op: "set_content", nodeId: op.nodeId, content: oldContent ?? {} });
          } else {
            inverse.push({ op: "set_text", nodeId: op.nodeId, value: old });
          }
          break;
        }
        case "format_range":
        case "clear_range": {
          const { node } = need(draft, op.nodeId);
          const text = node.content?.text ?? "";
          const { from, to } = resolveRange(text, op.target, op.nodeId);
          const old = node.content?.marks ? (current(node.content.marks) as Mark[]) : undefined;
          if (!node.content) node.content = {};
          const value = op.op === "format_range" ? op.value : null;
          const next = setRangeStyle(text, old, from, to, op.prop, value);
          if (next) node.content.marks = next;
          else delete node.content.marks;
          inverse.push({ op: "set_marks", nodeId: op.nodeId, marks: old ?? [] });
          break;
        }
        case "set_marks": {
          const { node } = need(draft, op.nodeId);
          const text = node.content?.text ?? "";
          const old = node.content?.marks ? (current(node.content.marks) as Mark[]) : undefined;
          if (!node.content) node.content = {};
          const next = normalizeMarks(text, op.marks);
          if (next) node.content.marks = next;
          else delete node.content.marks;
          inverse.push({ op: "set_marks", nodeId: op.nodeId, marks: old ?? [] });
          break;
        }
        case "set_content": {
          const { node } = need(draft, op.nodeId);
          const old = node.content ? (current(node.content) as Content) : {};
          node.content = op.content;
          inverse.push({ op: "set_content", nodeId: op.nodeId, content: old });
          break;
        }
        case "set_align": {
          const { node } = need(draft, op.nodeId);
          const old = node.textAlign ?? "left";
          node.textAlign = op.value;
          inverse.push({ op: "set_align", nodeId: op.nodeId, value: old });
          break;
        }
        case "set_frame": {
          const { node } = need(draft, op.nodeId);
          const old = node.frame ? (current(node.frame) as Frame) : undefined;
          node.frame = op.frame;
          inverse.push(
            old
              ? { op: "set_frame", nodeId: op.nodeId, frame: old }
              : { op: "remove_frame", nodeId: op.nodeId },
          );
          break;
        }
        case "remove_frame": {
          const { node } = need(draft, op.nodeId);
          if (node.frame) {
            const old = current(node.frame) as Frame;
            delete node.frame;
            inverse.push({ op: "set_frame", nodeId: op.nodeId, frame: old });
          }
          break;
        }
        case "move_to": {
          const { node } = need(draft, op.nodeId);
          if (!node.frame) {
            throw new Error(`move_to: node "${op.nodeId}" has no frame (set_frame first)`);
          }
          const oldX = node.frame.x;
          const oldY = node.frame.y;
          node.frame.x = op.x;
          node.frame.y = op.y;
          inverse.push({ op: "move_to", nodeId: op.nodeId, x: oldX, y: oldY });
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
        case "set_token_where": {
          if (!TOKEN_REF.test(op.value)) {
            throw new Error(
              `set_token_where rejected: "${op.value}" is not a token ref (token-only invariant)`,
            );
          }
          // The harness enumerates; one token choice fans out to every matching node, so a weak
          // model can't "forget" some. Per-node inverse keeps undo exact.
          const targets = selectNodes(draft as unknown as Deck, op.selector);
          for (const node of targets) {
            const old = node.style?.[op.prop];
            if (!node.style) node.style = {};
            node.style[op.prop] = op.value;
            inverse.push(
              old === undefined
                ? { op: "remove_token", nodeId: node.id, prop: op.prop }
                : { op: "set_token", nodeId: node.id, prop: op.prop, value: old },
            );
          }
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
