import { apply, type Op } from "@deck/core";
import type { Deck, Issue } from "@deck/contract";

/**
 * The render-and-check loop — the agentic harness, with the model replaced by a
 * pluggable `Solver`. This is the riskiest claim of the whole project: that the loop
 * CONVERGES rather than oscillates. So convergence is engineered structurally, not
 * hoped for:
 *
 *   1. Monotone progress gate — a step is accepted ONLY if the total-overflow scalar
 *      strictly decreases. A step that doesn't help is rejected and the loop stops
 *      (no thrashing).
 *   2. Anti-oscillation visited-set — the same (op, nodeId) signature can't be tried
 *      twice (kills A -> B -> A cycles).
 *   3. Bounded iterations — a hard backstop.
 *
 * A real LLM is just another Solver; proving the harness with a deterministic solver
 * first means any later non-convergence is the model's fault, not the loop's.
 */

export type Renderable = { render(deck: Deck): Promise<{ issues: Issue[] }> };

/** Returns ops to try, or null/[] to give up. Pure; never mutates the deck. */
export type Solver = (deck: Deck, issues: Issue[]) => Op[] | null;

export type StopReason =
  | "converged"
  | "max-iterations"
  | "solver-gave-up"
  | "no-progress"
  | "oscillation"
  | "apply-error";

export interface LoopStep {
  iteration: number;
  ops: Op[];
  scalarBefore: number;
  scalarAfter: number;
  accepted: boolean;
}

export interface LoopResult {
  deck: Deck;
  converged: boolean;
  reason: StopReason;
  iterations: number;
  finalIssues: Issue[];
  history: LoopStep[];
}

export interface LoopOptions {
  maxIterations?: number;
}

/** Sum of overflow magnitudes — the monotone scalar the loop must drive to zero. */
export function overflowScalar(issues: Issue[]): number {
  let total = 0;
  for (const i of issues) {
    const px = i.measured?.overflowPx;
    if (typeof px === "number") total += px;
    else if (typeof px === "string") total += Number(px) || 0;
  }
  return total;
}

function signature(ops: Op[]): string {
  return ops
    .map((o) => `${o.op}:${"nodeId" in o ? o.nodeId : "parentId" in o ? o.parentId : ""}`)
    .join("|");
}

export async function runFixLoop(
  deck: Deck,
  renderer: Renderable,
  solver: Solver,
  opts: LoopOptions = {},
): Promise<LoopResult> {
  const maxIterations = opts.maxIterations ?? 20;
  const history: LoopStep[] = [];
  const visited = new Set<string>();

  let current = deck;
  let issues = (await renderer.render(current)).issues;
  let scalar = overflowScalar(issues);

  for (let i = 0; i < maxIterations; i++) {
    if (issues.length === 0) {
      return { deck: current, converged: true, reason: "converged", iterations: i, finalIssues: issues, history };
    }

    const ops = solver(current, issues);
    if (!ops || ops.length === 0) {
      return { deck: current, converged: false, reason: "solver-gave-up", iterations: i, finalIssues: issues, history };
    }

    const sig = signature(ops);
    if (visited.has(sig)) {
      return { deck: current, converged: false, reason: "oscillation", iterations: i, finalIssues: issues, history };
    }
    visited.add(sig);

    let candidate: Deck;
    try {
      candidate = apply(current, ops).deck;
    } catch {
      return { deck: current, converged: false, reason: "apply-error", iterations: i, finalIssues: issues, history };
    }

    const candidateIssues = (await renderer.render(candidate)).issues;
    const candidateScalar = overflowScalar(candidateIssues);
    const accepted = candidateScalar < scalar;
    history.push({ iteration: i, ops, scalarBefore: scalar, scalarAfter: candidateScalar, accepted });

    if (!accepted) {
      // Monotone gate: a non-improving step is rejected and we stop rather than thrash.
      return { deck: current, converged: false, reason: "no-progress", iterations: i, finalIssues: issues, history };
    }

    current = candidate;
    issues = candidateIssues;
    scalar = candidateScalar;
  }

  const converged = issues.length === 0;
  return {
    deck: current,
    converged,
    reason: converged ? "converged" : "max-iterations",
    iterations: maxIterations,
    finalIssues: issues,
    history,
  };
}
