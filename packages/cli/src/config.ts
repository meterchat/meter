/**
 * Run configuration + defaults.
 *
 * The panel reuses Meter's debate roster (frontier diversity across labs), the
 * plan is drafted by the strongest model, and the budget ceiling comes from the
 * environment. CLI flags override everything in bin/meter.tsx.
 */
import { DEFAULT_DEBATE_MODELS, META_MODEL } from "./providers/models.ts";
import type { MeterConfig } from "./types.ts";

export function defaultConfig(): MeterConfig {
  const budgetEnv = process.env.METER_BUDGET_USD;
  const budgetUsd = budgetEnv && !Number.isNaN(Number(budgetEnv)) ? Number(budgetEnv) : null;
  return {
    panel: [...DEFAULT_DEBATE_MODELS],
    planModel: META_MODEL,
    candidates: 3,
    maxRepairs: 2,
    budgetUsd,
    skipDebate: false,
  };
}
