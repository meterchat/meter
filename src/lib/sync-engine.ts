/**
 * Sync Engine — strategy coherence analyzer.
 *
 * Ingests all decisions, documents, and conversation history.
 * Runs multiple passes looking for contradictions, gaps, stale
 * assumptions, and conflicts. Uses Claude Opus 4.6 for maximum
 * intelligence. Streams progress updates back via the sync store.
 *
 * The engine runs in the background — the user can keep chatting.
 */

import { useSyncStore, type SyncFinding } from "./sync-store";
import { useDecisionsStore, type Decision } from "./decisions-store";
import { useArtifactsStore } from "./artifacts-store";
import { useMeterStore } from "./store";
import { authFetch } from "./auth-fetch";

/** The model used for sync analysis — most intelligent available */
const SYNC_MODEL = "anthropic/claude-opus-4-6";

const SYNC_SYSTEM_PROMPT = `You are Meter's Strategy Sync engine. Your job is to analyze a user's complete strategy — all decisions, documents, specs, and conversation history — and find internal inconsistencies.

You must find:
1. **Contradictions** — two decisions or docs that say opposite things
2. **Gaps** — important areas with no decision or coverage
3. **Stale assumptions** — decisions based on facts that may no longer be true
4. **Conflicts** — decisions that work against each other even if not directly contradictory

For each finding, output a JSON object on its own line with this exact shape:
{"type":"contradiction|gap|stale|conflict","severity":"high|medium|low","title":"Short title","description":"Detailed explanation with specific references","ref_decisions":["decision title 1"],"ref_docs":["doc name 1"]}

Do NOT output anything except finding JSON objects, one per line. If you find nothing, output nothing.
Be thorough but precise. Only flag real issues, not style preferences.`;

interface SyncContext {
  decisions: Decision[];
  documents: { id: string; filePath: string; content: string; category: string }[];
  recentMessages: { role: string; content: string }[];
}

function gatherContext(): SyncContext {
  const decisions = useDecisionsStore.getState().decisions.filter((d) => !d.archived);
  const artifacts = useArtifactsStore.getState().artifacts ?? [];
  const documents = artifacts.map((a) => ({
    id: a.id ?? a.filePath,
    filePath: a.filePath,
    content: a.content,
    category: a.category ?? "general",
  }));

  const meterState = useMeterStore.getState();
  const session = meterState.sessions.find((s) => s.id === meterState.activeSessionId);
  const allMessages = session?.messages ?? [];
  // Take last 100 messages for context (enough to catch recent strategy shifts)
  const recentMessages = allMessages.slice(-100).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return { decisions, documents, recentMessages };
}

function buildAnalysisPrompt(ctx: SyncContext, passNumber: number, totalPasses: number): string {
  const parts: string[] = [];

  parts.push(`=== SYNC PASS ${passNumber} of ${totalPasses} ===\n`);

  if (ctx.decisions.length > 0) {
    parts.push("## Decisions\n");
    for (const d of ctx.decisions) {
      parts.push(`### ${d.title} [${d.status}]`);
      if (d.choice) parts.push(`Choice: ${d.choice}`);
      if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
      if (d.alternatives?.length) parts.push(`Alternatives considered: ${d.alternatives.join(", ")}`);
      if (d.category) parts.push(`Category: ${d.category}`);
      parts.push("");
    }
  }

  if (ctx.documents.length > 0) {
    parts.push("## Documents & Specs\n");
    for (const doc of ctx.documents) {
      parts.push(`### ${doc.filePath} [${doc.category}]`);
      // Truncate very long documents to keep within context
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

  // Focus each pass on different aspects
  const focuses = [
    "Focus on direct contradictions between decisions.",
    "Focus on gaps — important strategic areas with no coverage.",
    "Focus on stale assumptions — decisions based on outdated information.",
    "Focus on subtle conflicts — decisions that undermine each other.",
    "Final sweep — catch anything missed in previous passes.",
  ];
  parts.push(`\n${focuses[(passNumber - 1) % focuses.length]}`);

  return parts.join("\n");
}

function parseFinding(line: string, decisions: Decision[], documents: { id: string; filePath: string }[]): SyncFinding | null {
  try {
    const obj = JSON.parse(line.trim());
    if (!obj.type || !obj.title || !obj.description) return null;

    const references: SyncFinding["references"] = [];

    // Match referenced decisions
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

    // Match referenced docs
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
 * Run the sync engine. Returns the report ID.
 * Runs in background — updates sync store as it progresses.
 */
export async function runSync(): Promise<string> {
  const store = useSyncStore.getState();
  if (store.isSyncing) return store.lastReport?.id ?? "";

  const reportId = store.startSync();
  const ctx = gatherContext();
  const totalPasses = 5;

  // Deduplicate findings across passes by title
  const seenTitles = new Set<string>();

  try {
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
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Sync API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? data.content ?? "";

      // Parse findings line by line
      const lines = content.split("\n").filter((l: string) => l.trim().startsWith("{"));
      for (const line of lines) {
        const finding = parseFinding(line, ctx.decisions, ctx.documents);
        if (finding && !seenTitles.has(finding.title.toLowerCase())) {
          seenTitles.add(finding.title.toLowerCase());
          useSyncStore.getState().addFinding(reportId, finding);
        }
      }

      // Update cost estimate (rough: ~$0.05 per pass for Opus)
      const currentReport = useSyncStore.getState().lastReport;
      if (currentReport) {
        useSyncStore.getState().updateProgress(reportId, {
          cost: (currentReport.cost ?? 0) + 0.05,
        });
      }
    }

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
    return "**Strategy Sync Complete**\n\nNo contradictions, gaps, or conflicts found. Your strategy is internally consistent.";
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
