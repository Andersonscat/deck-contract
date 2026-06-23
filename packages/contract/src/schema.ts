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
 * Content holds DATA only (no styles). Loose by design — which fields a given
 * node `type` understands is enforced by domain handlers (the `presentation`
 * package), not here. Node `type` is an OPEN string, not a closed enum: that is
 * the seam that lets docs/resume/latex domains plug in without a schema rewrite.
 */
export const ContentSchema = z
  .object({
    text: z.string().optional(),
    items: z.array(z.string()).optional(),
    value: z.string().optional(),
    label: z.string().optional(),
    delta: z.string().optional(),
    src: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
  })
  .strict();

export interface DeckNode {
  id: string;
  type: string;
  role?: string;
  content?: z.infer<typeof ContentSchema>;
  style?: Record<string, TokenRef>;
  layout?: z.infer<typeof LayoutSchema>;
  constraints?: z.infer<typeof ConstraintsSchema>;
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
