import {
  IssueCode,
  type Deck,
  type DeckNode,
  type Issue,
  type Theme,
} from "@deck/contract";
import { buildIndex } from "./tree.js";

/**
 * Completes the token-only invariant. The schema guarantees a style value has the
 * SHAPE of a token ref; this checks it actually RESOLVES against the deck theme, so a
 * dangling `token://color/nope` is caught here instead of silently compiling to a
 * broken `var(--color-nope)`. Pure — no browser, no I/O.
 */
const REF = /^token:\/\/([a-z][a-z0-9]*)\/([A-Za-z0-9][A-Za-z0-9-]*)$/;

function refsOf(node: DeckNode): string[] {
  const refs: string[] = [];
  if (node.style) refs.push(...Object.values(node.style));
  if (node.layout?.gap) refs.push(node.layout.gap);
  if (node.layout?.padding) refs.push(node.layout.padding);
  return refs;
}

function resolves(theme: Theme, ns: string, name: string): boolean {
  const group = (theme as Record<string, Record<string, string> | undefined>)[ns];
  return !!group && group[name] !== undefined;
}

export function validateTokens(deck: Deck): Issue[] {
  const issues: Issue[] = [];
  for (const { node, slideId } of buildIndex(deck).values()) {
    for (const ref of refsOf(node)) {
      const m = REF.exec(ref);
      if (!m || !resolves(deck.theme, m[1]!, m[2]!)) {
        issues.push({
          code: IssueCode.UNKNOWN_TOKEN,
          nodeId: node.id,
          slideId,
          severity: "error",
          detail: `token "${ref}" does not resolve against the deck theme`,
          suggestedOps: [`define the token in theme, or point to an existing one`],
        });
      }
    }
  }
  return issues;
}
