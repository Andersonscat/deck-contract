import { customAlphabet } from "nanoid";

/**
 * Stable string ids are the system's identity (load-bearing, decision #1).
 * Format: `<role>_<nanoid(10)>`. The role prefix makes ids human/model-readable;
 * the suffix guarantees uniqueness. Ids are minted ONCE when a node is created and
 * never change across move/reorder/split. Deleted ids are burned (never reused).
 *
 * Randomness is confined to this module (the imperative edge of the otherwise pure
 * ops layer). Tests inject a deterministic IdGen so compile/render stay reproducible.
 */
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 10);

export type IdGen = (role: string) => string;

function slug(role: string): string {
  const s = role.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return s.length > 0 ? s : "nd";
}

export const genId: IdGen = (role = "nd") => `${slug(role)}_${nano()}`;

/** Deterministic generator for tests: `<role>_<seq>` with a zero-padded counter. */
export function sequentialIdGen(prefix = ""): IdGen {
  let n = 0;
  return (role = "nd") => `${prefix}${slug(role)}_${String(++n).padStart(4, "0")}`;
}

export const ID_RE = /^[a-z0-9]+_[A-Za-z0-9]+$/;
export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}
