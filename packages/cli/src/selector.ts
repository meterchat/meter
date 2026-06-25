/**
 * SELECT — pick the winner from verified candidates.
 *
 * Reality already did the hard part (pass/fail). The selector just orders:
 *   1. Passing candidates beat failing ones.
 *   2. Among equals, more gates passed = more coverage = better.
 *   3. Then the smallest change wins (smaller diff, fewer files) — least risk.
 * When nothing passes, the best-ranked candidate is the repair target (the one
 * closest to green), not a winner.
 */
import type { Candidate, Send } from "./types.ts";
import { shortModelName } from "./providers/models.ts";

function gatesPassed(c: Candidate): number {
  return c.verify ? c.verify.gates.filter((g) => !g.skipped && g.passed).length : -1;
}

export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const ap = a.verify?.passed ? 1 : 0;
    const bp = b.verify?.passed ? 1 : 0;
    if (ap !== bp) return bp - ap; // passing first

    const ag = gatesPassed(a);
    const bg = gatesPassed(b);
    if (ag !== bg) return bg - ag; // more coverage first

    const ad = a.verify?.diffSize ?? Infinity;
    const bd = b.verify?.diffSize ?? Infinity;
    if (ad !== bd) return ad - bd; // smaller diff first

    const af = a.verify?.filesChanged ?? Infinity;
    const bf = b.verify?.filesChanged ?? Infinity;
    return af - bf; // fewer files first
  });
}

export interface Selection {
  /** A candidate that actually passed, or null. */
  winner: Candidate | null;
  /** Best-first ranking — winner === ranked[0] when one passed. */
  ranked: Candidate[];
  /** Best failing candidate to feed into repair when no winner yet. */
  repairTarget: Candidate | null;
}

export function select(candidates: Candidate[], send: Send): Selection {
  const ranked = rankCandidates(candidates);
  const winner = ranked.find((c) => c.verify?.passed) ?? null;
  const repairTarget = winner ? null : (ranked[0] ?? null);

  if (winner) {
    send({
      type: "select",
      winnerId: winner.id,
      model: shortModelName(winner.model),
      reason: `passed all gates · ${winner.verify!.filesChanged} file(s), ${winner.verify!.diffSize} lines changed`,
    });
  } else if (repairTarget) {
    send({
      type: "select",
      winnerId: null,
      model: shortModelName(repairTarget.model),
      reason: `no candidate passed yet — closest is ${repairTarget.id} (${gatesPassed(repairTarget)} gate(s) passing)`,
    });
  } else {
    send({ type: "select", winnerId: null, model: null, reason: "no viable candidates" });
  }

  return { winner, ranked, repairTarget };
}
