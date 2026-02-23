/* ─── Agent Modes ──────────────────────────────────────────────── */

export type AgentMode = "planner" | "coder" | "banker";

export interface ModeDefinition {
  id: AgentMode;
  name: string;
  description: string;
  /** Connector IDs this mode can access */
  connectorIds: string[];
  /** Concrete artifacts this mode produces */
  artifacts: string[];
  color: string;
}

export const MODES: ModeDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    description: "strategy docs, decision logs, debates, follow-ups",
    connectorIds: ["gmail", "linear", "calendar"],
    artifacts: ["Strategy docs", "Decision logs", "Debates", "Follow-ups"],
    color: "#3B82F6",
  },
  {
    id: "coder",
    name: "Coder",
    description: "branches, PRs, deploys, live URLs",
    connectorIds: ["github", "vercel", "porkbun"],
    artifacts: ["Branches", "Pull requests", "Deploys", "Live URLs"],
    color: "#10B981",
  },
  {
    id: "banker",
    name: "Banker",
    description: "runway, burn, revenue, spend reviews",
    connectorIds: ["stripe", "mercury", "puzzle", "gusto"],
    artifacts: ["Runway reports", "Burn analysis", "Revenue tracking", "Spend reviews"],
    color: "#F59E0B",
  },
];

export function getMode(id: AgentMode): ModeDefinition {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** Get connector IDs allowed for a given mode */
export function getConnectorIdsForMode(modeId: AgentMode): string[] {
  return getMode(modeId).connectorIds;
}
