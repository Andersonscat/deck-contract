import { z } from "zod";
import { isSupportedSpec } from "./version.js";

/**
 * TOKEN-ONLY INVARIANT (load-bearing).
 * Node style values may ONLY be token references (`token://<ns>/<name>`).
 * Raw hex/px/font names are rejected at the schema boundary, so "font drift"
 * has nothing to drift TO. Raw values live exclusively in the theme.
 */
export const TOKEN_REF = /^token:\/\/[a-z][a-z0-9]*\/[A-Za-z0-9][A-Za-z0-9-]*$/;

export const TokenRefSchema = z
  .string()
  .regex(
    TOKEN_REF,
    "style values must be theme token refs like 'token://color/accent', not raw values",
  );
export type TokenRef = z.infer<typeof TokenRefSchema>;

/** Theme is the ONLY place raw values are allowed. */
export const ThemeSchema = z
  .object({
    color: z.record(z.string(), z.string()),
    font: z.record(z.string(), z.string()),
    /** type scale: token name -> css size, e.g. { h1: "44px", body: "18px" } */
    type: z.record(z.string(), z.string()),
    space: z.record(z.string(), z.string()),
    radius: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type Theme = z.infer<typeof ThemeSchema>;

export const SizingSchema = z
  .object({
    width: z.enum(["hug", "fill", "fixed"]).optional(),
    height: z.enum(["hug", "fill", "fixed"]).optional(),
  })
  .strict();

export const LayoutSchema = z
  .object({
    direction: z.enum(["row", "column"]).optional(),
    gap: TokenRefSchema.optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    padding: TokenRefSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

export const ConstraintsSchema = z
  .object({
    maxChars: z.number().int().positive().optional(),
    maxLines: z.number().int().positive().optional(),
    maxItems: z.number().int().positive().optional(),
    overflow: z.enum(["shrink-to-fit", "clip-warn", "error"]).optional(),
  })
  .strict();

/**
 * Sub-text styling. Instead of making each word/letter its own node (which would break
 * reflow, typing, selection, and explode the tree — no serious editor does it), a text
 * node keeps ONE plain `content.text` and overlays interval marks on it. A mark styles a
 * [from,to) character range with TOKEN-ONLY style (same invariant as node.style). A word
 * or a letter is simply a range, so the AI can recolour "build" by addressing its offsets.
 */
export const MARK_PROPS = ["color", "font", "size"] as const;
export const MarkSchema = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
    style: z.record(z.enum(MARK_PROPS), TokenRefSchema),
  })
  .strict()
  .refine((m) => m.from < m.to, { message: "mark range is empty (from >= to)" });
export type Mark = z.infer<typeof MarkSchema>;

/**
 * Content holds DATA only (no styles). Loose by design — which fields a given
 * node `type` understands is enforced by domain handlers (the `presentation`
 * package), not here. Node `type` is an OPEN string, not a closed enum: that is
 * the seam that lets docs/resume/latex domains plug in without a schema rewrite.
 */
export const ContentSchema = z
  .object({
    text: z.string().optional(),
    /** sub-text styling overlaid on `text` (token-only). See MarkSchema. */
    marks: z.array(MarkSchema).optional(),
    items: z.array(z.string()).optional(),
    value: z.string().optional(),
    label: z.string().optional(),
    delta: z.string().optional(),
    src: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    /** bar-chart: ordered categories with numeric values. */
    data: z.array(z.object({ label: z.string(), value: z.number() }).strict()).optional(),
    /** bar (one column of a decomposed bar-chart): its height as a 0..100 percentage. */
    barValue: z.number().optional(),
    /** table: header cells + body rows (rows are arrays of string cells). */
    columns: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())).optional(),
  })
  .strict();
export type Content = z.infer<typeof ContentSchema>;

type MarkProp = (typeof MARK_PROPS)[number];

/** Per-character resolved style: later marks win per-property. The shared basis below. */
function perCharStyles(text: string, marks?: Mark[]): Array<Record<string, string>> {
  const len = text.length;
  const per: Array<Record<string, string>> = [];
  for (let i = 0; i < len; i++) per.push({});
  for (const m of marks ?? []) {
    const from = Math.max(0, Math.min(Math.trunc(m.from), len));
    const to = Math.max(0, Math.min(Math.trunc(m.to), len));
    for (let i = from; i < to; i++) Object.assign(per[i]!, m.style);
  }
  return per;
}

/** Coalesce equal-styled adjacent chars into maximal sorted runs (skip unstyled). Canonical. */
function coalesce(per: Array<Record<string, string>>): Mark[] | undefined {
  const keyOf = (s: Record<string, string>) =>
    Object.keys(s).sort().map((k) => `${k}=${s[k]}`).join("|");
  const out: Mark[] = [];
  let i = 0;
  while (i < per.length) {
    const k = keyOf(per[i]!);
    if (k === "") { i++; continue; }
    let j = i + 1;
    while (j < per.length && keyOf(per[j]!) === k) j++;
    const style: Record<string, string> = {};
    for (const key of Object.keys(per[i]!).sort()) style[key] = per[i]![key]!;
    out.push({ from: i, to: j, style: style as Mark["style"] });
    i = j;
  }
  return out.length ? out : undefined;
}

/**
 * Canonicalise marks against the text: clamp, resolve overlaps (later wins per prop), drop
 * empties, coalesce equal-styled runs, sort. One logical styling -> one canonical marks array
 * -> byte-identical compile. Every mark-editing op and the compiler funnel text through this.
 */
export function normalizeMarks(text: string, marks?: Mark[]): Mark[] | undefined {
  if (!marks || !marks.length || text.length === 0) return undefined;
  return coalesce(perCharStyles(text, marks));
}

/** Set (tokenRef) or clear (null) ONE property over [from,to); returns canonical marks. */
export function setRangeStyle(
  text: string,
  marks: Mark[] | undefined,
  from: number,
  to: number,
  prop: MarkProp,
  value: string | null,
): Mark[] | undefined {
  const per = perCharStyles(text, marks);
  const len = text.length;
  const f = Math.max(0, Math.min(Math.trunc(from), len));
  const t = Math.max(0, Math.min(Math.trunc(to), len));
  for (let i = f; i < t; i++) {
    if (value === null) delete per[i]![prop];
    else per[i]![prop] = value;
  }
  return coalesce(per);
}

/**
 * Free positioning (Figma-style absolute escape hatch over flow). A node with a frame
 * is taken out of the flex flow and placed absolutely on the slide. Coordinates are
 * PERCENT of the canvas (0..100), origin = the slide's top-left — resolution-independent
 * and easy to reason about (center = 50,50; off-canvas = x+w>100). w/h optional (omit =
 * hug content). Geometry is raw numbers (unlike token-only color/font): the safety net
 * for position is the renderer's OUT_OF_BOUNDS check, not the schema.
 */
export const FrameSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    rotation: z.number().optional(),
    z: z.number().int().optional(),
  })
  .strict();
export type Frame = z.infer<typeof FrameSchema>;

export interface DeckNode {
  id: string;
  type: string;
  role?: string;
  content?: z.infer<typeof ContentSchema>;
  style?: Record<string, TokenRef>;
  layout?: z.infer<typeof LayoutSchema>;
  constraints?: z.infer<typeof ConstraintsSchema>;
  textAlign?: "left" | "center" | "right";
  frame?: Frame;
  children?: DeckNode[];
}

export const NodeSchema: z.ZodType<DeckNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      type: z.string().min(1),
      role: z.string().optional(),
      content: ContentSchema.optional(),
      style: z.record(z.string(), TokenRefSchema).optional(),
      layout: LayoutSchema.optional(),
      constraints: ConstraintsSchema.optional(),
      textAlign: z.enum(["left", "center", "right"]).optional(),
      frame: FrameSchema.optional(),
      children: z.array(NodeSchema).optional(),
    })
    .strict(),
);

export const DeckSchema = z
  .object({
    spec: z.string().refine(isSupportedSpec, {
      message: "unsupported contract spec version",
    }),
    id: z.string().min(1),
    title: z.string().optional(),
    theme: ThemeSchema,
    canvas: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict(),
    slides: z.array(NodeSchema).min(1),
  })
  .strict();
export type Deck = z.infer<typeof DeckSchema>;

/** Parse-don't-validate at the boundary: throws on any contract violation. */
export function parseDeck(input: unknown): Deck {
  return DeckSchema.parse(input);
}
