/**
 * Contract versioning. Load-bearing: every artifact pins the major spec line so
 * old packages keep loading as the standard grows. Reader is tolerant of unknown
 * fields (open on read), strict on write.
 */
export const CONTRACT_MAJOR = 1 as const;
export const SPEC_ID = `deck-contract/${CONTRACT_MAJOR}` as const;
export type SpecId = typeof SPEC_ID;

/** Matches the current major line, ignoring any future minor suffix. */
export function isSupportedSpec(spec: string): boolean {
  return spec === SPEC_ID || spec.startsWith(`deck-contract/${CONTRACT_MAJOR}.`);
}
