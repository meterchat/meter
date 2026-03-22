/**
 * Reconcile Engine — programmatic per-finding reconciliation.
 *
 * Takes the sync report's findings and processes each one by calling
 * /api/chat with a targeted prompt. The AI uses save_decision (with
 * supersedes for versioning) and save_artifact tools to update the
 * affected decisions and documents.
 *
 * Parses SSE tool_result events to update local stores (decisions +
 * artifacts) in real-time. Tracks progress and cost in the sync store.
 * Costs feed into the global session meter.
 *
 * Runs in background — the user can keep chatting.
 */

import { useSyncStore, type SyncFinding } from "./sync-store";
import { useDecisionsStore, type Decision } from "./decisions-store";
import { useArtifactsStore, type Artifact } from "./artifacts-store";
import { useMeterStore } from "./store";
import { authFetch } from "./auth-fetch";
import { readSSEResponse, computeCost, gatherContext, SYNC_MODEL } from "./sync-engine";

const RECONCILE_MODEL = SYNC_MODEL;

const RECONCILE_SYSTEM_PROMPT = `You are Meter's Reconcile engine. Your job is to fix a specific inconsistency found in the user's strategy.

You have tools available:
- save_decision: Create or update a decision. Use the "supersedes" field with the old decision's ID to create a new version that archives the old one. Always provide title, choice, reasoning, and category.
- save_artifact: Update a document/spec. Provide file_path and the full updated content. The system will version the old content automatically.
- list_decisions: Check existing decisions before saving to find the right one to supersede.

IMPORTANT:
- Be surgical — only change what the finding requires. Don't rewrite entire documents unless necessary.
- When updating a decision, always use "supersedes" with the old decision ID to maintain version history.
- When updating a document, include the FULL content (not just the changed parts) because save_artifact replaces the entire document.
- Explain what you changed in a brief summary before making tool calls.
- If a finding is about a gap (missing decision/doc), create the missing item.
- If a finding is about a stale assumption, update the decision with current reasoning.`;

/**
 * Build a prompt for reconciling a single finding.
 * Includes the finding details plus the full text of referenced decisions/docs.
 */
function buildReconcilePrompt(finding: SyncFinding): string {
  const parts: string[] = [];

  parts.push(`## Finding to Reconcile\n`);
  parts.push(`**Type:** ${finding.type}`);
  parts.push(`**Severity:** ${finding.severity}`);
  parts.push(`**Title:** ${finding.title}`);
  parts.push(`**Description:** ${finding.description}\n`);

  if (finding.references.length > 0) {
    parts.push(`**References:**`);
    for (const ref of finding.references) {
      parts.push(`- ${ref.kind}: ${ref.label} (id: ${ref.id})`);
    }
    parts.push("");
  }

  // Include full text of referenced decisions
  const decisions = useDecisionsStore.getState().decisions;
  for (const ref of finding.references) {
    if (ref.kind === "decision") {
      const d = decisions.find((dec: Decision) => dec.id === ref.id);
      if (d) {
        parts.push(`## Referenced Decision: ${d.title}`);
        parts.push(`ID: ${d.id}`);
        parts.push(`Status: ${d.status}`);
        parts.push(`Version: ${d.version ?? 1}`);
        if (d.choice) parts.push(`Choice: ${d.choice}`);
        if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
        if (d.category) parts.push(`Category: ${d.category}`);
        parts.push("");
      }
    }
  }

  // Include full text of referenced documents
  const artifacts = useArtifactsStore.getState().artifacts ?? [];
  for (const ref of finding.references) {
    if (ref.kind === "document") {
      const a = artifacts.find((art: Artifact) => art.id === ref.id || art.filePath === ref.label);
      if (a) {
        parts.push(`## Referenced Document: ${a.filePath}`);
        parts.push(`Category: ${a.category ?? "general"}`);
        parts.push(`Version: ${a.version ?? 1}`);
        parts.push(`Content:\n${a.content}`);
        parts.push("");
      }
    }
  }

  parts.push(`\nFix this ${finding.type} by calling the appropriate tools (save_decision with supersedes, or save_artifact with updated content). First call list_decisions to find existing decision IDs, then make your updates.`);

  return parts.join("\n");
}

/**
 * Run the reconcile engine. Processes each non-dismissed finding sequentially.
 * Updates local stores as tool results arrive. Tracks progress and cost.
 */
export async function runReconcile(): Promise<void> {
  const syncStore = useSyncStore.getState();
  if (syncStore.isReconciling || syncStore.isSyncing) return;

  const report = syncStore.lastReport;
  if (!report) return;

  const findings = report.findings.filter((f: SyncFinding) => !f.dismissed && !f.fixed);
  if (findings.length === 0) return;

  useSyncStore.getState().startReconcile(findings.length);

  const meterState = useMeterStore.getState();
  const activeSessionId = meterState.activeSessionId;
  const markupMultiplier = meterState.markupMultiplier;
  const incrementCurrentMessageCost = useMeterStore.getState().incrementCurrentMessageCost;

  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let lastCacheReadRate = 0.1;
  let totalRawCost = 0;

  const signal = useSyncStore.getState().abortController?.signal;

  try {
    for (let i = 0; i < findings.length; i++) {
      // Check if cancelled before each finding
      if (signal?.aborted) break;

      const finding = findings[i];
      const prompt = buildReconcilePrompt(finding);

      const response = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: RECONCILE_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          model: RECONCILE_MODEL,
          sessionId: activeSessionId,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Reconcile API error: ${response.status}`);
      }

      const result = await readSSEResponse(response);

      // Process tool results — update local stores
      for (const tr of result.toolResults) {
        if (tr.name === "save_decision" && tr.decision) {
          const d = tr.decision;
          useDecisionsStore.getState().addDecision({
            id: d.id || Math.random().toString(36).slice(2, 10),
            title: d.title,
            status: "decided",
            choice: d.choice,
            alternatives: d.alternatives,
            reasoning: d.reasoning ?? undefined,
            sessionId: activeSessionId,
          });
        }
        if (tr.name === "save_artifact" && tr.artifact) {
          const a = tr.artifact;
          useArtifactsStore.getState().upsertArtifact({
            id: a.id || `reconcile_${Date.now()}`,
            filePath: a.filePath,
            content: a.content || "",
            category: a.category || "other",
            status: (a.status as "draft" | "synced") || "draft",
            lastGeneratedAt: Date.now(),
          });
        }
      }

      // Track cost
      const findingCostRaw = computeCost(result.usage, RECONCILE_MODEL);
      const findingCost = findingCostRaw * markupMultiplier;
      totalCost += findingCost;
      totalRawCost += findingCostRaw;

      if (result.usage) {
        totalTokensIn += result.usage.tokensIn;
        totalTokensOut += result.usage.tokensOut;
        totalCacheCreation += result.usage.cacheCreationTokens;
        totalCacheRead += result.usage.cacheReadTokens;
        lastCacheReadRate = result.usage.cacheReadRate;
      }

      // Feed cost into global session meter
      incrementCurrentMessageCost(findingCostRaw, activeSessionId);

      // Capture fix summary from AI response
      if (result.content) {
        const summary = result.content.slice(0, 200).trim();
        if (summary) {
          useSyncStore.getState().setFixSummary(finding.id, summary);
        }
      }

      // Mark finding as fixed
      useSyncStore.getState().markFixed(finding.id);

      // Update progress
      useSyncStore.getState().updateReconcileProgress(i + 1, totalCost);
    }

    // Finalize global meter costs
    useMeterStore.getState().finalizeResponse(
      totalTokensIn,
      totalTokensOut,
      1.0,
      RECONCILE_MODEL,
      totalCacheCreation,
      totalCacheRead,
      lastCacheReadRate,
      totalRawCost,
      activeSessionId,
    );

    useSyncStore.getState().completeReconcile();
  } catch (err) {
    // Don't report abort as an error — it's intentional cancellation
    if (err instanceof DOMException && err.name === "AbortError") {
      useSyncStore.getState().completeReconcile();
      return;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    useSyncStore.getState().completeReconcile(msg);
  }
}
