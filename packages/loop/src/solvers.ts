import { findNode, type Op } from "@deck/core";
import { IssueCode, type Deck, type Issue } from "@deck/contract";

/**
 * A deterministic baseline solver used to de-risk the loop machinery (NOT a quality
 * fix — that's the model's job later). On overflow it removes the last child of the
 * overflowing slide; on out-of-bounds it removes the offending element. Removing
 * content strictly reduces height, so the overflow scalar decreases every step and
 * the loop is guaranteed to converge and terminate. Pure.
 */
export function trimToFitSolver(deck: Deck, issues: Issue[]): Op[] | null {
  const overflow = issues.find((i) => i.code === IssueCode.OVERFLOW);
  if (overflow) {
    const slide = findNode(deck, overflow.slideId ?? "");
    const kids = slide?.children ?? [];
    const last = kids[kids.length - 1];
    if (last) return [{ op: "remove_node", nodeId: last.id }];
  }

  const oob = issues.find((i) => i.code === IssueCode.OUT_OF_BOUNDS);
  if (oob) return [{ op: "remove_node", nodeId: oob.nodeId }];

  return null;
}
