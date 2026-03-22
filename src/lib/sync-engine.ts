/**
 * Sync Engine — strategy coherence analyzer.
 *
 * Ingests all decisions (including archived/superseded versions),
 * documents (with version history), and conversation history.
 * Runs 5 passes with different analytical lenses looking for
 * contradictions, gaps, stale assumptions, and conflicts.
 * Uses Sonnet 4.6 for cost-efficient structured analysis.
 * Streams progress updates back via the sync store.
 *
 * Version-aware: understands decision chains (v1 → v2 → v3) and
 * doc revisions. Flags when a decision was rethought but downstream
 * docs or dependent decisions were never updated to match.
 *
 * Costs feed into the global session meter so sync spend appears
 * in the header counter alongside regular chat costs.
 *
 * The engine runs in the background — the user can keep chatting.
 */

import { useSyncStore, type SyncFinding } from "./sync-store";
import { useDecisionsStore, type Decision } from "./decisions-store";
import { useArtifactsStore, type Artifact } from "./artifacts-store";
import { useMeterStore } from "./store";
import { authFetch } from "./auth-fetch";
import { getModel } from "./models";

/** The model used for sync analysis — cost-efficient structured extraction */
export const SYNC_MODEL = "anthropic/claude-sonnet-4.6";

export interface SSEResult {
  content: string;
  usage: { tokensIn: number; tokensOut: number; cacheCreationTokens: number; cacheReadTokens: number; cacheReadRate: number } | null;
}

/** Tool result extracted from SSE stream */
export interface SSEToolResult {
  name: string;
  decision?: { id?: string; title: string; status: string; choice: string; alternatives?: string[]; reasoning?: string };
  artifact?: { id?: string; filePath: string; content?: string; category?: string; status: string };
}

/**
 * Read a full SSE response from /api/chat and return accumulated text + usage + tool results.
 * The API returns text/event-stream with `data: {...}` lines.
 */
export async function readSSEResponse(response: Response): Promise<SSEResult & { toolResults: SSEToolResult[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader on response");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let usage: SSEResult["usage"] = null;
  const toolResults: SSEToolResult[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const data = JSON.parse(payload);
        if (data.type === "delta" && typeof data.content === "string") {
          fullContent += data.content;
        }
        if (data.type === "usage") {
          usage = {
            tokensIn: data.tokensIn ?? 0,
            tokensOut: data.tokensOut ?? 0,
            cacheCreationTokens: data.cacheCreationTokens ?? 0,
            cacheReadTokens: data.cacheReadTokens ?? 0,
            cacheReadRate: data.cacheReadRate ?? 0.1,
          };
        }
        if (data.type === "tool_result") {
          const tr: SSEToolResult = { name: data.name };
          if (data.decision) tr.decision = data.decision;
          if (data.artifact) tr.artifact = data.artifact;
          toolResults.push(tr);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return { content: fullContent, usage, toolResults };
}

const SYNC_SYSTEM_PROMPT = `You are Meter's Strategy Sync engine. You analyze a user's complete strategy — all decisions (including version history), documents (including past versions), and conversation — to find internal inconsistencies.

CRITICAL: Decisions and documents are VERSIONED. When you see a decision chain (v1 → v2 → v3), the LATEST version is the current truth. Earlier versions show what was previously decided. Your job includes:

1. **Contradictions** — two active decisions or docs that say opposite things
2. **Gaps** — important areas with no decision or coverage
3. **Stale assumptions** — decisions based on facts that may no longer be true
4. **Conflicts** — decisions that work against each other even if not directly contradictory
5. **Superseded but not propagated** — a decision was updated (v1→v2) but documents, specs, or dependent decisions still reference or assume the OLD version. This is the most important category.

When analyzing version chains:
- Compare current (active) decisions against what docs/specs say
- If a decision was revised (has parentDecisionId or version > 1), check if all docs that reference the topic were updated AFTER the decision changed
- If a doc still contains language matching an archived decision's choice but not the current version's choice, that is a propagation failure

For each finding, output a JSON object on its own line with this exact shape:
{"type":"contradiction|gap|stale|conflict","severity":"high|medium|low","title":"Short title","description":"Detailed explanation with specific references to decision titles, doc names, and version numbers","ref_decisions":["decision title 1"],"ref_docs":["doc name 1"]}

Do NOT output anything except finding JSON objects, one per line. If you find nothing, output nothing.
Be thorough but precise. Only flag real issues, not style preferences.`;

interface SyncContext {
  /** Active (non-archived) decisions — the current truth */
  activeDecisions: Decision[];
  /** Archived decisions — previous versions, grouped by title for chain analysis */
  archivedDecisions: Decision[];
  /** Current documents with version numbers */
  documents: { id: string; filePath: string; content: string; category: string; version: number; updatedAt?: number }[];
  /** Recent conversation messages */
  recentMessages: { role: string; content: string }[];
}

/** Exported so the reconcile engine can reuse context gathering */
export async function gatherContext(): Promise<SyncContext> {
  const meterState = useMeterStore.getState();
  const workspaceSessionId = meterState.activeSessionId;

  // Fetch ALL decisions from server (including archived/superseded),
  // scoped to the current workspace session
  const allDecisions = await useDecisionsStore.getState().fetchAllDecisions(workspaceSessionId);
  // Fall back to local store if server fetch fails (filter to current session)
  const decisions = allDecisions.length > 0
    ? allDecisions
    : useDecisionsStore.getState().decisions.filter(
        (d) => !d.sessionId || d.sessionId === workspaceSessionId
      );
  const activeDecisions = decisions.filter((d) => !d.archived);
  const archivedDecisions = decisions.filter((d) => d.archived);

  // Artifacts store is already scoped to the current workspace session
  const artifacts = useArtifactsStore.getState().artifacts ?? [];
  const documents = artifacts.map((a: Artifact) => ({
    id: a.id ?? a.filePath,
    filePath: a.filePath,
    content: a.content,
    category: a.category ?? "general",
    version: a.version ?? 1,
    updatedAt: a.lastGeneratedAt,
  }));

  const session = meterState.sessions.find((s) => s.id === workspaceSessionId);
  const allMessages = session?.messages ?? [];
  const recentMessages = allMessages.slice(-100).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return { activeDecisions, archivedDecisions, documents, recentMessages };
}

/**
 * Build decision version chains for analysis.
 * Groups decisions by title, ordered by version, showing the evolution.
 */
function buildDecisionChains(active: Decision[], archived: Decision[]): string {
  // Group by title
  const byTitle = new Map<string, Decision[]>();
  for (const d of [...archived, ...active]) {
    const key = d.title.toLowerCase();
    const list = byTitle.get(key) ?? [];
    list.push(d);
    byTitle.set(key, list);
  }

  const parts: string[] = [];

  for (const [, chain] of byTitle) {
    // Sort by version ascending
    chain.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));

    if (chain.length === 1) {
      // Single version — no chain
      const d = chain[0];
      parts.push(`### ${d.title} [${d.status}] (v${d.version ?? 1})`);
      if (d.choice) parts.push(`Choice: ${d.choice}`);
      if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
      if (d.category) parts.push(`Category: ${d.category}`);
      parts.push(`Created: ${new Date(d.createdAt).toISOString().split("T")[0]}`);
      parts.push("");
    } else {
      // Multi-version chain — show evolution
      const current = chain[chain.length - 1];
      parts.push(`### ${current.title} [${current.status}] (CURRENT: v${current.version ?? 1}, ${chain.length} versions)`);
      parts.push(`**Current choice:** ${current.choice ?? "undecided"}`);
      if (current.reasoning) parts.push(`**Current reasoning:** ${current.reasoning}`);
      parts.push("");
      parts.push("**Version history (oldest → newest):**");
      for (const d of chain) {
        const label = d.archived ? "SUPERSEDED" : "ACTIVE";
        parts.push(`  v${d.version ?? 1} [${label}]: ${d.choice ?? "undecided"} (${new Date(d.createdAt).toISOString().split("T")[0]})`);
        if (d.reasoning) parts.push(`    Reasoning: ${d.reasoning}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

function buildAnalysisPrompt(ctx: SyncContext, passNumber: number, totalPasses: number): string {
  const parts: string[] = [];

  parts.push(`=== SYNC PASS ${passNumber} of ${totalPasses} ===\n`);

  if (ctx.activeDecisions.length > 0 || ctx.archivedDecisions.length > 0) {
    parts.push("## Decisions (with version history)\n");
    parts.push(buildDecisionChains(ctx.activeDecisions, ctx.archivedDecisions));
  }

  if (ctx.documents.length > 0) {
    parts.push("## Documents & Specs\n");
    for (const doc of ctx.documents) {
      parts.push(`### ${doc.filePath} [${doc.category}] (v${doc.version})`);
      if (doc.updatedAt) {
        parts.push(`Last updated: ${new Date(doc.updatedAt).toISOString().split("T")[0]}`);
      }
      const content = doc.content.length > 3000
        ? doc.content.slice(0, 3000) + "\n[... truncated ...]"
        : doc.content;
      parts.push(content);
      parts.push("");
    }
  }

  if (ctx.recentMessages.length > 0) {
    parts.push("## Recent Conversation (last 100 messages)\n");
    for (const msg of ctx.recentMessages) {
      parts.push(`[${msg.role}]: ${msg.content.slice(0, 500)}`);
    }
  }

  const focuses = [
    "Focus on direct contradictions between active decisions. Check if any two current decisions say opposite things.",
    "Focus on superseded-but-not-propagated: decisions that were updated (v1→v2) but documents still reflect the old version's choice. Compare document content against current decision choices.",
    "Focus on gaps — important strategic areas discussed in conversation but with no formal decision or document coverage.",
    "Focus on stale assumptions — decisions based on information that may have changed, and subtle conflicts where decisions undermine each other.",
    "Final sweep — check every document against every active decision. Flag any doc that references or assumes a choice that was later superseded.",
  ];
  parts.push(`\n${focuses[(passNumber - 1) % focuses.length]}`);

  return parts.join("\n");
}

export function parseFinding(line: string, decisions: Decision[], documents: { id: string; filePath: string }[]): SyncFinding | null {
  try {
    const obj = JSON.parse(line.trim());
    if (!obj.type || !obj.title || !obj.description) return null;

    const references: SyncFinding["references"] = [];

    if (obj.ref_decisions) {
      for (const refTitle of obj.ref_decisions) {
        const match = decisions.find((d) =>
          d.title.toLowerCase().includes(refTitle.toLowerCase()) ||
          refTitle.toLowerCase().includes(d.title.toLowerCase())
        );
        if (match) {
          references.push({ kind: "decision", id: match.id, label: match.title });
        }
      }
    }

    if (obj.ref_docs) {
      for (const refDoc of obj.ref_docs) {
        const match = documents.find((d) =>
          d.filePath.toLowerCase().includes(refDoc.toLowerCase()) ||
          refDoc.toLowerCase().includes(d.filePath.toLowerCase())
        );
        if (match) {
          references.push({ kind: "document", id: match.id, label: match.filePath });
        }
      }
    }

    return {
      id: Math.random().toString(36).slice(2, 10),
      type: obj.type as SyncFinding["type"],
      severity: obj.severity ?? "medium",
      title: obj.title,
      description: obj.description,
      references,
    };
  } catch {
    return null;
  }
}

/**
 * Compute actual API cost from usage data and model pricing.
 */
export function computeCost(usage: SSEResult["usage"], modelId: string = SYNC_MODEL): number {
  if (!usage) return 0;
  const model = getModel(modelId);
  const cacheWrite = usage.cacheCreationTokens;
  const cacheHit = usage.cacheReadTokens;
  const readRate = usage.cacheReadRate || 0.1;

  let inputCost: number;
  if (cacheWrite > 0 || cacheHit > 0) {
    const uncachedIn = usage.tokensIn - cacheWrite - cacheHit;
    inputCost =
      uncachedIn * model.inputPrice +
      cacheWrite * model.inputPrice * 1.25 +
      cacheHit * model.inputPrice * readRate;
  } else {
    inputCost = usage.tokensIn * model.inputPrice;
  }

  return inputCost + usage.tokensOut * model.outputPrice;
}

/**
 * Run the sync engine. Returns the report ID.
 * Runs in background — updates sync store as it progresses.
 * Costs feed into the global session meter.
 */
export async function runSync(): Promise<string> {
  const store = useSyncStore.getState();
  if (store.isSyncing) return store.lastReport?.id ?? "";

  const reportId = store.startSync();
  const ctx = await gatherContext();
  const totalPasses = 5;

  const seenTitles = new Set<string>();
  const allDecisions = [...ctx.activeDecisions, ...ctx.archivedDecisions];

  // Accumulators for global meter finalization
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let lastCacheReadRate = 0.1;
  let totalRawCost = 0;
  let totalSyncCost = 0;

  try {
    const meterState = useMeterStore.getState();
    const activeSessionId = meterState.activeSessionId;
    const markupMultiplier = meterState.markupMultiplier;
    const incrementCurrentMessageCost = useMeterStore.getState().incrementCurrentMessageCost;

    for (let pass = 1; pass <= totalPasses; pass++) {
      useSyncStore.getState().updateProgress(reportId, { currentPass: pass });

      const prompt = buildAnalysisPrompt(ctx, pass, totalPasses);

      const response = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYNC_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          model: SYNC_MODEL,
          sessionId: activeSessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Sync API error: ${response.status}`);
      }

      const result = await readSSEResponse(response);

      const lines = result.content.split("\n").filter((l: string) => l.trim().startsWith("{"));
      for (const line of lines) {
        const finding = parseFinding(line, allDecisions, ctx.documents);
        if (finding && !seenTitles.has(finding.title.toLowerCase())) {
          seenTitles.add(finding.title.toLowerCase());
          useSyncStore.getState().addFinding(reportId, finding);
        }
      }

      // Track cost per pass
      const passCostRaw = computeCost(result.usage);
      const passCost = passCostRaw * markupMultiplier;
      totalRawCost += passCostRaw;
      totalSyncCost += passCost;

      // Accumulate token counts for finalization
      if (result.usage) {
        totalTokensIn += result.usage.tokensIn;
        totalTokensOut += result.usage.tokensOut;
        totalCacheCreation += result.usage.cacheCreationTokens;
        totalCacheRead += result.usage.cacheReadTokens;
        lastCacheReadRate = result.usage.cacheReadRate;
      }

      // Feed cost into global session meter in real-time
      incrementCurrentMessageCost(passCostRaw, activeSessionId);

      // Update sync report cost
      useSyncStore.getState().updateProgress(reportId, { cost: totalSyncCost });
    }

    // Finalize: snap global meter to ground truth
    useMeterStore.getState().finalizeResponse(
      totalTokensIn,
      totalTokensOut,
      1.0, // confidence
      SYNC_MODEL,
      totalCacheCreation,
      totalCacheRead,
      lastCacheReadRate,
      totalRawCost,
      activeSessionId,
    );

    useSyncStore.getState().completeSync(reportId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    useSyncStore.getState().completeSync(reportId, msg);
  }

  return reportId;
}

/**
 * Format a sync report as a chat message for posting into the conversation.
 */
export function formatSyncReport(): string {
  const report = useSyncStore.getState().lastReport;
  if (!report) return "No sync report available.";

  const findings = report.findings.filter((f) => !f.dismissed);

  if (findings.length === 0) {
    return "**Strategy Sync Complete**\n\nNo contradictions, gaps, or conflicts found. Your strategy is internally consistent across all decisions and documents.";
  }

  const contradictions = findings.filter((f) => f.type === "contradiction");
  const gaps = findings.filter((f) => f.type === "gap");
  const stale = findings.filter((f) => f.type === "stale");
  const conflicts = findings.filter((f) => f.type === "conflict");

  const parts: string[] = [];
  parts.push("**Strategy Sync Report**\n");
  parts.push(`Found **${findings.length} issues**: ${[
    contradictions.length > 0 ? `${contradictions.length} contradiction${contradictions.length > 1 ? "s" : ""}` : "",
    gaps.length > 0 ? `${gaps.length} gap${gaps.length > 1 ? "s" : ""}` : "",
    stale.length > 0 ? `${stale.length} stale assumption${stale.length > 1 ? "s" : ""}` : "",
    conflicts.length > 0 ? `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(", ")}.\n`);

  const renderGroup = (title: string, items: SyncFinding[], icon: string) => {
    if (items.length === 0) return;
    parts.push(`### ${icon} ${title}\n`);
    for (const f of items) {
      const severityBadge = f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🟢";
      parts.push(`**${severityBadge} ${f.title}**`);
      parts.push(f.description);
      if (f.references.length > 0) {
        parts.push(`*References: ${f.references.map((r) => r.label).join(", ")}*`);
      }
      parts.push("");
    }
  };

  renderGroup("Contradictions", contradictions, "⚔️");
  renderGroup("Gaps", gaps, "🕳️");
  renderGroup("Stale Assumptions", stale, "⏰");
  renderGroup("Conflicts", conflicts, "⚡");

  return parts.join("\n");
}
