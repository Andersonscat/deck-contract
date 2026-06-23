/**
 * Issue codes are a STABLE, versioned enum — part of the contract. The render-and-check
 * loop and the model's self-correction both depend on these codes never changing meaning.
 * `detail`/`suggestedOps` are free for the model; `code` is the stable machine signal.
 */
export const IssueCode = {
  OVERFLOW: "OVERFLOW",
  OUT_OF_BOUNDS: "OUT_OF_BOUNDS",
  FONT_DRIFT: "FONT_DRIFT",
  UNKNOWN_TOKEN: "UNKNOWN_TOKEN",
  EMPTY_SLOT: "EMPTY_SLOT",
} as const;

export type IssueCode = (typeof IssueCode)[keyof typeof IssueCode];

export type Severity = "error" | "warning";

export interface Issue {
  code: IssueCode;
  nodeId: string;
  slideId?: string;
  severity: Severity;
  /** Human-readable, free-form. For the model to read. */
  detail: string;
  /** Measured facts the model must not have to guess (e.g. overflowPx). */
  measured?: Record<string, number | string>;
  /**
   * Discrete next steps (e.g. "drop to the next smaller type token"), NOT prose
   * like "make it smaller". Drives convergent self-correction.
   */
  suggestedOps?: string[];
}
