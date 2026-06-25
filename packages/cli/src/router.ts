/**
 * ROUTER — the difficulty gate.
 *
 * Fusing N frontier models + verification is 3-10× the cost/latency of a single
 * shot. The doc is blunt: gating is survival, not polish. So Meter scales effort
 * to difficulty — trivial turns run lean (one candidate, no debate); substantive
 * turns get the full panel + cross-examination.
 *
 * v0.1 uses a cheap, transparent heuristic (no extra model call). A model-based
 * classifier is the obvious fast-follow, behind this same interface.
 */
import type { MeterConfig } from "./types.ts";

const TRIVIAL_HINTS = [
  /\btypo\b/i,
  /\brename\b/i,
  /\bcomment(s)?\b/i,
  /\bbump (the )?version\b/i,
  /\bformat(ting)?\b/i,
  /\bone[- ]?liner\b/i,
];

const HARD_HINTS = [
  /\brefactor\b/i,
  /\bmigrat(e|ion)\b/i,
  /\bredesign\b/i,
  /\bconcurren|race|deadlock/i,
  /\bsecurity|auth|crypto/i,
  /\bperformance|optimi[sz]e\b/i,
  /\bacross (the )?(repo|codebase)\b/i,
];

export interface RouteDecision {
  candidates: number;
  skipDebate: boolean;
  rationale: string;
}

/** Decide effort for a task. Returns overrides merged onto the base config. */
export function route(task: string, base: MeterConfig): RouteDecision {
  const words = task.trim().split(/\s+/).length;
  const trivial = words <= 14 && TRIVIAL_HINTS.some((re) => re.test(task));
  const hard = HARD_HINTS.some((re) => re.test(task)) || words > 60;

  if (trivial) {
    return { candidates: 1, skipDebate: true, rationale: "trivial edit — single candidate, no debate" };
  }
  if (hard) {
    return {
      candidates: Math.max(base.candidates, 3),
      skipDebate: false,
      rationale: "hard task — full panel + cross-examination",
    };
  }
  return {
    candidates: Math.min(base.candidates, 2),
    skipDebate: false,
    rationale: "standard task — 2 candidates with debate",
  };
}
