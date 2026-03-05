"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useMeterStore, selectConnectedServices, selectWorkspaceCardReady, ChatMessage, type DebateTurn, type DissectorTurn, type Attachment, type DocumentPreview, type ClarifyingQuestion } from "@/lib/store";
import {
  trackMessageSent,
  trackMessageCopied,
  trackMessagePinned,
  trackMessageUnpinned,
  trackResponseStopped,
  trackFileUploaded,
  trackChatBlocked,
  trackDebateStarted,
  trackDebateCompleted,
  trackDecideClicked,
  trackDissectClicked,
  trackDecisionCreated,
  trackDecisionResolved,
  trackDecisionStaged,
  trackPerTxnLimitHit,
  trackConnectorInitiated,
  trackWorkspaceCreated,
  trackCardAssignedToWorkspace,
  trackOnboardingStepViewed,
  trackSlashCommandUsed,
  trackInspectorToggled,
  resetUser,
} from "@/lib/analytics";
import { MeterPill } from "@/components/meter-pill";
import { HeaderMeter } from "@/components/header-meter";
// CommitButton removed from header — decisions now log directly
import { ModelSelectorBar, ModelPickerPanel } from "@/components/model-picker";
import { Inspector } from "@/components/inspector";
import { ProfileSettings } from "@/components/profile-settings";
import { ActionCard } from "@/components/action-card";
import { DomainCard } from "@/components/domain-card";
// CommandBar removed — model selector bar replaces connections in the chat box
import { SlashCommandPopover, type SlashCommandHandle } from "@/components/slash-command";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { WorkspaceBar } from "@/components/workspace-bar";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { InlineCardForm } from "@/components/inline-card-form";
import { getModel, shortModelName, DEBATE_MODELS } from "@/lib/models";
import { useSessionSync } from "@/lib/use-session-sync";
import { useDecisionsStore } from "@/lib/decisions-store";
import { apiUrl } from "@/lib/api-url";
import { useArtifactsStore } from "@/lib/artifacts-store";
import { useStagingStore } from "@/lib/staging-store";
import { DebateTrace, DebateModelDots } from "@/components/debate-trace";
import { ClarifyingCard } from "@/components/clarifying-card";
import { DissectorTrace } from "@/components/dissector-trace";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DRAFT_KEY = (id: string) => `meter:draft:${id}`;

function statusLabel(msg: ChatMessage) {
  if (msg.receiptStatus === "settled") return "Settled";
  if (msg.receiptStatus === "signed") return "Signed";
  return "Signing";
}

function ErrorCard({ payload }: { payload: string }) {
  let model = "";
  try {
    const parsed = JSON.parse(payload);
    model = parsed.model ?? "";
  } catch { /* ignore */ }

  const modelLabel = model ? shortModelName(model) : "This model";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <p className="font-mono text-[11px] text-foreground/70">
          {modelLabel} is temporarily unavailable across all providers. Please try again in a moment.
        </p>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 animate-pulse">
      {/* Simulated user message */}
      <div className="mb-4 flex justify-end">
        <div className="max-w-[65%] rounded-xl bg-foreground/[0.04] dark:bg-foreground/10 px-4 py-3">
          <div className="h-3 w-48 rounded bg-muted-foreground/10" />
        </div>
      </div>
      {/* Simulated assistant response */}
      <div className="mb-4 flex justify-start">
        <div className="max-w-[75%] rounded-xl px-4 py-3 space-y-2">
          <div className="h-3 w-full rounded bg-muted-foreground/10" />
          <div className="h-3 w-[90%] rounded bg-muted-foreground/10" />
          <div className="h-3 w-[70%] rounded bg-muted-foreground/10" />
        </div>
      </div>
      {/* Simulated user message */}
      <div className="mb-4 flex justify-end">
        <div className="max-w-[55%] rounded-xl bg-foreground/[0.04] dark:bg-foreground/10 px-4 py-3">
          <div className="h-3 w-32 rounded bg-muted-foreground/10" />
        </div>
      </div>
      {/* Simulated assistant response */}
      <div className="mb-4 flex justify-start">
        <div className="max-w-[75%] rounded-xl px-4 py-3 space-y-2">
          <div className="h-3 w-full rounded bg-muted-foreground/10" />
          <div className="h-3 w-[85%] rounded bg-muted-foreground/10" />
          <div className="h-3 w-[60%] rounded bg-muted-foreground/10" />
          <div className="h-3 w-[75%] rounded bg-muted-foreground/10" />
        </div>
      </div>
      <div className="flex justify-center pt-4">
        <span className="font-mono text-[10px] text-muted-foreground/30">Loading chat history...</span>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    trackMessageCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="mobile-sm-ok absolute right-2 top-2 rounded-md p-1 text-muted-foreground/0 transition-all group-hover/msg:text-muted-foreground/40 hover:!text-muted-foreground hover:bg-foreground/5 max-md:text-muted-foreground/30"
      title={copied ? "Copied!" : "Copy message"}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

function PinButton({ messageId, pinned }: { messageId: string; pinned?: boolean }) {
  const togglePinMessage = useMeterStore((s) => s.togglePinMessage);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (pinned) trackMessageUnpinned({ messageId });
        else trackMessagePinned({ messageId });
        togglePinMessage(messageId);
      }}
      className={`mobile-sm-ok absolute right-2 top-9 rounded-md p-1 transition-all ${
        pinned
          ? "text-amber-500/70 hover:text-amber-500"
          : "text-muted-foreground/0 group-hover/msg:text-muted-foreground/40 hover:!text-muted-foreground hover:bg-foreground/5 max-md:text-muted-foreground/30"
      }`}
      title={pinned ? "Unpin" : "Pin"}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="17" x2="12" y2="22" />
        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
      </svg>
    </button>
  );
}

function DecisionPill({ decisionId, onOpen }: { decisionId: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 font-mono text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/10"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      Decision logged
    </button>
  );
}

/* ─── Decision-point buttons (Decide / Debate / Dissect) ─── */

/**
 * Context-aware action buttons:
 * - [decision-point]: dual-nature / A-vs-B → Decide + Debate
 * - [dissect-point]: singular idea under question → Dissect only
 */
function ActionPointButtons({
  variant,
  onDecide,
  onDebate,
  onDissect,
  disabled,
}: {
  variant: "decision" | "dissect";
  onDecide: () => void;
  onDebate: () => void;
  onDissect: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {variant === "decision" && (
        <>
          <button
            onClick={onDecide}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-400 active:bg-emerald-500/20 active:text-emerald-400 disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            Decide
          </button>
          <button
            onClick={onDebate}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400 active:bg-amber-500/20 active:text-amber-400 disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Debate
          </button>
        </>
      )}
      {variant === "dissect" && (
        <button
          onClick={onDissect}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-400 active:bg-blue-500/20 active:text-blue-400 disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h-4l-2 4 4 4-4 4 2 4h4l2-4-4-4 4-4z" />
          </svg>
          Dissect
        </button>
      )}
    </div>
  );
}

/* ─── Discuss / Debate toggle ─── */

function DiscussDebateToggle() {
  const debateMode = useMeterStore((s) => s.debateMode);
  const toggleDebateMode = useMeterStore((s) => s.toggleDebateMode);

  return (
    <button
      onClick={toggleDebateMode}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
        debateMode
          ? "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
          : "text-muted-foreground/60 hover:bg-foreground/5 hover:text-muted-foreground"
      }`}
      title={debateMode ? "Switch to single-model chat" : "Switch to multi-model debate"}
    >
      {debateMode ? (
        /* Lucide messages-square — two overlapping square bubbles */
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
          <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
        </svg>
      ) : (
        /* Single chat bubble */
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )}
      {debateMode ? "Debate" : "Discuss"}
    </button>
  );
}

/** Check if a message contains the [decision-point] tag (dual-nature A-vs-B decisions) */
function hasDecisionPoint(content: string): boolean {
  return content.includes("[decision-point]");
}

/** Check if a message contains the [dissect-point] tag (singular idea to analyze) */
function hasDissectPoint(content: string): boolean {
  return content.includes("[dissect-point]");
}

/** Strip action-point tags from content for display */
function stripDecisionPoint(content: string): string {
  return content.replace(/\s*\[(decision|dissect)-point\]\s*/g, "").trim();
}

/* ─── Document preview card (shown inline in chat) ─── */

function DocumentPreviewCard({
  doc,
  messageId,
  onSave,
}: {
  doc: DocumentPreview;
  messageId: string;
  onSave: (messageId: string, docId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 w-full max-w-[600px] rounded-lg border border-border overflow-hidden">
      {/* Title bar — matches the PDF attachment header style */}
      <div className="flex items-center gap-2 bg-foreground/5 px-3 py-1.5 border-b border-border">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span className="flex-1 truncate text-[11px] text-foreground/70">{doc.filePath}</span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 font-mono text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          {expanded ? "collapse" : "expand"}
        </button>
      </div>

      {/* Document body — white background, rendered markdown */}
      <div
        className={`relative bg-white dark:bg-[#fafafa] overflow-y-auto transition-[max-height] duration-200 ${expanded ? "max-h-[480px]" : "max-h-[180px]"}`}
        onClick={() => !expanded && setExpanded(true)}
        style={{ cursor: expanded ? "default" : "pointer" }}
      >
        <div className="px-5 py-4 prose prose-sm max-w-none text-[#1c1917] prose-headings:text-[#1c1917] prose-headings:font-semibold prose-h1:text-base prose-h2:text-sm prose-h3:text-xs prose-p:text-[12px] prose-p:leading-relaxed prose-p:text-[#44403c] prose-li:text-[12px] prose-li:text-[#44403c] prose-strong:text-[#1c1917] prose-a:text-blue-600 prose-pre:bg-[#f5f5f4] prose-pre:text-[11px] prose-code:text-[11px] prose-code:text-[#c2410c]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{doc.content}</ReactMarkdown>
        </div>
        {/* Fade overlay when collapsed */}
        {!expanded && (
          <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-10 -mt-10 bg-gradient-to-t from-white dark:from-[#fafafa] to-transparent" />
        )}
      </div>

      {/* Footer — save, copy, download actions */}
      <div className="flex items-center gap-2 border-t border-border bg-foreground/[0.02] px-3 py-1.5">
        {!doc.saved ? (
          <button
            onClick={() => onSave(messageId, doc.id)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-emerald-500 transition-colors hover:bg-emerald-500/10"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save to Documents
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-500/70">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Saved
          </span>
        )}
        <div className="flex-1" />
        {/* Copy content */}
        <button
          onClick={() => navigator.clipboard.writeText(doc.content)}
          className="inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
          title="Copy content"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        {/* Download */}
        <button
          onClick={() => {
            const blob = new Blob([doc.content], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = doc.filePath.split("/").pop() ?? "document.md";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
          title="Download file"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const mdComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-foreground/5 text-left text-xs font-medium text-muted-foreground">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 font-medium">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-t border-border px-3 py-2">{children}</td>
  ),
};

function MessageFooter({ msg, projectId }: { msg: ChatMessage; projectId: string }) {
  const hasCost = msg.cost !== undefined;

  const modelName = msg.model ? shortModelName(msg.model) : "—";
  const cost = msg.cost ?? 0;
  const totalTokens = (msg.tokensIn ?? 0) + (msg.tokensOut ?? 0);
  const isSigned = msg.receiptStatus === "signed" || msg.receiptStatus === "settled";

  if (!hasCost) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground/70">
      <span className="inline-flex items-center" style={{ color: msg.model ? getModel(msg.model).color : undefined }}>
        {modelName}
        {msg.model === "debate" && <DebateModelDots />}
      </span>
      <span className="text-muted-foreground/30">&middot;</span>
      <span>{totalTokens.toLocaleString()} tokens</span>
      <span className="text-muted-foreground/30">&middot;</span>
      <span>${cost.toFixed(cost < 0.01 ? 4 : 3)}</span>
      <span className="text-muted-foreground/30">&middot;</span>
      {isSigned ? (
        <a
          href={`/receipt/${msg.id}?project=${projectId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 transition-colors ${msg.receiptStatus === "settled" ? "text-emerald-500/80 hover:text-emerald-400" : "text-muted-foreground hover:text-foreground"}`}
          title="Open receipt"
        >
          {statusLabel(msg)}
          <span>↗</span>
        </a>
      ) : (
        <span className="text-yellow-500/80">{statusLabel(msg)}</span>
      )}
    </div>
  );
}

/* ─── Thinking / tool-use indicator with shimmer ─── */
const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  save_decision: "Saving decision",
  save_artifact: "Writing document",
  list_decisions: "Recalling decisions",
  get_current_datetime: "Checking date",
  search_emails: "Searching emails",
  read_email: "Reading email",
  github_create_repo: "Creating repo",
  github_list_repos: "Listing repos",
  github_create_issue: "Creating issue",
  vercel_deploy: "Deploying",
  vercel_list_deployments: "Listing deployments",
  stripe_list_payments: "Checking payments",
  stripe_get_balance: "Checking balance",
  stripe_list_subscriptions: "Listing subscriptions",
  mercury_get_accounts: "Checking accounts",
  mercury_list_transactions: "Listing transactions",
  ramp_list_transactions: "Listing expenses",
  ramp_get_spending_summary: "Summarizing spending",
  supabase_query: "Querying database",
  supabase_list_tables: "Listing tables",
};

function getHintPool(
  elapsedS: number,
  hasImage: boolean,
  hasPdf: boolean,
  modelId: string | undefined,
  toolName: string | null | undefined,
): string[] {
  if (toolName) {
    const toolHints: Record<string, string[]> = {
      web_search: ["Scanning results", "Reading sources"],
      search_emails: ["Searching inbox", "Filtering results"],
      read_email: ["Parsing email content"],
      supabase_query: ["Executing query", "Fetching rows"],
      save_decision: ["Writing to memory"],
      save_artifact: ["Drafting document", "Formatting content"],
      list_decisions: ["Recalling past decisions"],
    };
    return toolHints[toolName] ?? ["Processing"];
  }

  if (elapsedS < 5) {
    if (hasImage) return ["Analyzing image"];
    if (hasPdf) return ["Reading document"];
    return ["Understanding your request"];
  }
  if (elapsedS < 15) {
    const hints = hasImage
      ? ["Processing visual details", "Interpreting image content"]
      : hasPdf
        ? ["Extracting text from PDF", "Analyzing document"]
        : ["Reasoning through this", "Considering the details"];
    const modelName = modelId ? shortModelName(modelId) : null;
    if (modelName && modelName !== "Auto") hints.push(`${modelName} is working`);
    return hints;
  }
  if (elapsedS < 45) {
    const hints = ["Working through the problem", "Crafting a thorough response", "Almost there"];
    if (hasImage) hints.unshift("Deep image analysis in progress");
    if (hasPdf) hints.unshift("Cross-referencing document sections");
    return hints;
  }
  if (elapsedS < 120) {
    return ["This is a complex one", "Still working on it", "Taking extra care with this response"];
  }
  return ["Still processing — complex tasks take longer", "Working through it carefully", "Large inputs need more time", "Hang tight — generating response"];
}

const HINT_CYCLE_MS = 3500;

function ThinkingIndicator({
  toolName,
  rerouting,
  thinkingStartedAt,
  hasImageAttachment,
  hasPdfAttachment,
  modelId,
  thinkingText,
}: {
  toolName?: string | null;
  rerouting?: { provider: string; toModel: string } | null;
  thinkingStartedAt: number;
  hasImageAttachment?: boolean;
  hasPdfAttachment?: boolean;
  modelId?: string;
  thinkingText?: string;
}) {
  let label: string;
  if (rerouting) {
    const toLabel = shortModelName(rerouting.toModel);
    label = `Re-routing to ${toLabel}`;
  } else {
    label = toolName ? TOOL_LABELS[toolName] ?? toolName : "Thinking";
  }

  const hasRealThinking = !!thinkingText && thinkingText.length > 0;

  // --- Cycling sublabel (fallback when no real thinking) ---
  const [elapsedS, setElapsedS] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const prevToolRef = useRef(toolName);

  useEffect(() => {
    if (hasRealThinking) return; // no need to tick when real thinking is streaming
    const t = setInterval(() => setElapsedS(Math.floor((Date.now() - thinkingStartedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [thinkingStartedAt, hasRealThinking]);

  const hintPool = useMemo(
    () => getHintPool(elapsedS, hasImageAttachment ?? false, hasPdfAttachment ?? false, modelId, toolName),
    [elapsedS, hasImageAttachment, hasPdfAttachment, modelId, toolName],
  );

  useEffect(() => {
    if (hasRealThinking) return; // no cycling when real thinking is streaming
    const cycler = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setHintIndex((i) => (i + 1) % Math.max(hintPool.length, 1));
        setVisible(true);
      }, 200);
    }, HINT_CYCLE_MS);
    return () => clearInterval(cycler);
  }, [hintPool.length, hasRealThinking]);

  useEffect(() => {
    if (toolName !== prevToolRef.current) {
      prevToolRef.current = toolName;
      setHintIndex(0);
      setVisible(true);
    }
  }, [toolName]);

  // Real thinking: show last ~80 chars. Fallback: cycling hints.
  const displaySublabel = hasRealThinking
    ? thinkingText.split("\n").filter(l => l.trim()).slice(-2).join(" ").slice(-80)
    : hintPool[hintIndex % hintPool.length] ?? null;

  return (
    <div className="flex items-center gap-2 px-4 py-3 mb-4">
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="meter-spinning text-muted-foreground/50"
      >
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="20 14" />
      </svg>
      <div className="flex flex-col">
        <span className="thinking-shimmer text-sm font-medium select-none">
          {label}
        </span>
        {displaySublabel && (
          <span className={`text-[10px] font-mono text-muted-foreground/50 truncate max-w-[300px] max-md:max-w-[200px] sublabel-fade ${hasRealThinking || visible ? "" : "sublabel-fade-hidden"}`}>
            {displaySublabel}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Main ChatView ────────────────────────────────────────────── */
export function ChatView() {
  // Sync sessions to Supabase for eternal persistence
  useSessionSync();

  const isMobile = useIsMobile();
  const sessionsLoaded = useMeterStore((s) => s.sessionsLoaded);

  const {
    projects,
    activeProjectId,
    setActiveProject,
    addMessage,
    updateLastAssistantMessage,
    finalizeResponse,
    setStreaming,
    incrementCurrentMessageCost,
    inspectorOpen,
    toggleInspector,
    spendingCap,
    spendingCapEnabled,
    selectedModelId,
    setSelectedModelId,
    approveCard,
    rejectCard,
    spendLimits,
    markupMultiplier,
  } = useMeterStore();

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const messages = activeProject?.messages ?? [];
  const visibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  const isStreaming = activeProject?.isStreaming ?? false;
  const todayCost = activeProject?.todayCost ?? 0;
  const todayMessageCount = activeProject?.todayMessageCount ?? 0;

  // Fetch spend limits on mount and when project changes — can't rely on
  // Inspector since it's unmounted when closed, and limits aren't persisted
  // across page reloads without this.
  const fetchSpendLimits = useMeterStore((s) => s.fetchSpendLimits);
  useEffect(() => {
    if (activeProjectId) fetchSpendLimits(activeProjectId);
  }, [activeProjectId, fetchSpendLimits]);

  const decisions = useDecisionsStore((s) => s.decisions);
  const updateDecision = useDecisionsStore((s) => s.updateDecision);

  const defaultProjectId = useMemo(() => {
    const match = projects.find(
      (p) => p.id === "default" || p.id === "meter" || p.name?.toLowerCase() === "meter"
    );
    return match?.id ?? projects[0]?.id ?? null;
  }, [projects]);

  useEffect(() => {
    if (!defaultProjectId) return;
    const unassigned = decisions.filter((d) => !d.projectId);
    if (unassigned.length === 0) return;
    unassigned.forEach((d) => {
      updateDecision(d.id, { projectId: defaultProjectId });
    });
  }, [decisions, defaultProjectId, updateDecision]);

  const userId = useMeterStore((s) => s.userId);
  const cardOnFile = useMeterStore((s) => s.cardOnFile);
  const cardLast4 = useMeterStore((s) => s.cardLast4);
  const cardBrand = useMeterStore((s) => s.cardBrand);
  const workspaceCardReady = useMeterStore(selectWorkspaceCardReady);
  const setCardAssigned = useMeterStore((s) => s.setCardAssigned);
  const chatBlocked = activeProject?.chatBlocked ?? false;

  const sourceWorkspaceName = useMemo(() => {
    if (workspaceCardReady || !cardOnFile) return null;
    const source = projects.find(
      (p) => p.id !== activeProjectId && p.cardAssigned === true
    );
    return source?.name ?? null;
  }, [workspaceCardReady, cardOnFile, projects, activeProjectId]);

  // Onboarding state: first-time users go name → card → explainer
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState(
    activeProject?.name ?? "My Workspace"
  );
  const [onboardingStep, setOnboardingStep] = useState<"name" | "card">("name");
  const [showExplainer, setShowExplainer] = useState(false);
  const createCompany = useWorkspaceStore((s) => s.createCompany);
  const renameProject = useMeterStore((s) => s.renameProject);
  const addProject = useMeterStore((s) => s.addProject);
  const setActiveProjectChat = useMeterStore((s) => s.setActiveProject);

  // First-workspace onboarding: rename existing default workspace
  const handleOnboardingRenameWorkspace = () => {
    const name = onboardingWorkspaceName.trim() || "My Workspace";
    renameProject(activeProjectId, name);
    // Create company in workspace store to link with this project
    createCompany(name, activeProjectId);
    trackWorkspaceCreated({ name, source: "chat_onboarding" });
    trackOnboardingStepViewed({ step: "card" });
    setOnboardingStep("card");
  };

  // Legacy: create new workspace (for non-first workspaces added later)
  const handleOnboardingCreateWorkspace = () => {
    const name = onboardingWorkspaceName.trim();
    if (!name) return;
    const sessionId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    createCompany(name, sessionId);
    addProject(name, sessionId);
    setActiveProjectChat(sessionId);
    trackWorkspaceCreated({ name, source: "chat_onboarding" });
  };

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [switchingProjectName, setSwitchingProjectName] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState<{ provider: string; toModel: string } | null>(null);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number>(0);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const logoMenuRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  // commandBarOpen removed — connections bar replaced by model selector bar
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  // Debate mode state
  const [debateTrace, setDebateTraceLocal] = useState<DebateTurn[]>([]);
  const [activeDebateTurn, setActiveDebateTurn] = useState<{ model: string; phase: string; content: string } | null>(null);
  const [debatePhase, setDebatePhase] = useState<"debating" | "synthesizing" | null>(null);
  // Dissector mode state
  const [dissectorTraceLocal, setDissectorTraceLocal] = useState<DissectorTurn[]>([]);
  const [activeDissectorTurn, setActiveDissectorTurn] = useState<{ persona: string; content: string } | null>(null);
  const [dissectorPhase, setDissectorPhase] = useState<"dissecting" | "synthesizing" | null>(null);
  const slashRef = useRef<SlashCommandHandle>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isNearBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const scrollAwayAtRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const hasInitialScrolled = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(apiUrl("/api/attachments/upload"), { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Upload failed:", body.error);
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const valid = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    if (valid.length === 0) return;
    setUploading(true);
    const results = await Promise.all(valid.map(uploadFile));
    const uploaded = results.filter((a): a is Attachment => a !== null);
    if (uploaded.length > 0) {
      trackFileUploaded({
        mimeType: uploaded[0].mimeType,
        count: uploaded.length,
      });
    }
    setPendingAttachments((prev) => [...prev, ...uploaded]);
    setUploading(false);
  }, [uploadFile]);

  const removePendingAttachment = useCallback((url: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.url !== url));
  }, []);

  useEffect(() => {
    hasInitialScrolled.current = false;
  }, [activeProjectId]);

  // Restore draft from localStorage on mount / project switch
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY(activeProjectId));
    if (saved && inputRef.current) {
      inputRef.current.value = saved;
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [activeProjectId]);

  const pendingInput = useMeterStore((s) => s.pendingInput);
  const setPendingInput = useMeterStore((s) => s.setPendingInput);
  const setInspectorOpen = useMeterStore((s) => s.setInspectorOpen);
  const setInspectorTab = useMeterStore((s) => s.setInspectorTab);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!logoMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (logoMenuRef.current && !logoMenuRef.current.contains(e.target as Node)) {
        setLogoMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [logoMenuOpen]);

  // Inspector starts closed; user can open it manually

  const handleProjectSwitch = (projectId: string) => {
    if (projectId === activeProjectId) {
      setShowProjectDropdown(false);
      return;
    }
    const next = projects.find((p) => p.id === projectId);
    if (!next) return;
    setShowProjectDropdown(false);
    setSwitchingProjectName(next.name);
    setActiveProject(projectId);
    setTimeout(() => setSwitchingProjectName(null), 700);
  };

  // Detect user-initiated scroll-up via wheel / touch to pause auto-scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledAwayRef.current = true;
        scrollAwayAtRef.current = Date.now();
      }
    };
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0].clientY > touchStartY) {
        userScrolledAwayRef.current = true;
        scrollAwayAtRef.current = Date.now();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom);
    if (nearBottom && Date.now() - scrollAwayAtRef.current > 500) {
      userScrolledAwayRef.current = false;
    }
  }, []);

  // Auto-scroll using instant scrollTop (no smooth animation that fights
  // with user scroll). Guarded by isProgrammaticScrollRef so our own scroll
  // doesn't re-enter handleScroll and clear userScrolledAway.
  useEffect(() => {
    if (userScrolledAwayRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!hasInitialScrolled.current) {
      hasInitialScrolled.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, [messages]);

  // Scroll-to-message triggered from inspector pin clicks
  const scrollToMessageId = useMeterStore((s) => s.scrollToMessageId);
  const setScrollToMessageId = useMeterStore((s) => s.setScrollToMessageId);
  useEffect(() => {
    if (!scrollToMessageId) return;
    const el = document.getElementById(`msg-${scrollToMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-amber-500/40", "rounded-xl");
      setTimeout(() => el.classList.remove("ring-2", "ring-amber-500/40", "rounded-xl"), 2000);
    }
    setScrollToMessageId(null);
  }, [scrollToMessageId, setScrollToMessageId]);

  /** Core streaming function shared by handleSend, handleDebate, and handleDissect */
  const streamResponse = async (userContent: string, modelOverride?: string, userAttachments?: Attachment[], options?: { hiddenUser?: boolean }) => {
    // Pin the project ID at stream start so all mutations target the correct
    // workspace even if the user switches workspaces mid-stream.
    const streamProjectId = activeProjectId;

    isNearBottomRef.current = true;
    userScrolledAwayRef.current = false;
    setRerouting(null); // Clear any previous reroute

    // Client-side daily limit check — Supabase sync is delayed (2-10s), so the
    // server pre-flight can read stale cost and let overspend through. The client
    // store has the authoritative todayCost since it tracks every message.
    if (spendLimits.dailyLimit != null && spendLimits.dailyLimit > 0) {
      const state = useMeterStore.getState();
      const active = state.projects.find((p) => p.id === streamProjectId);
      const todayCost = active?.todayCost ?? 0;
      if (todayCost >= spendLimits.dailyLimit) {
        addMessage({
          id: Math.random().toString(36).slice(2, 10),
          role: "assistant",
          content: `Daily spend limit reached ($${todayCost.toFixed(2)} / $${spendLimits.dailyLimit.toFixed(2)}). Adjust your limit or wait until tomorrow.`,
          timestamp: Date.now(),
        }, streamProjectId);
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2, 10),
      role: "user",
      content: userContent,
      timestamp: Date.now(),
      ...(userAttachments?.length ? { attachments: userAttachments } : {}),
      ...(options?.hiddenUser ? { hidden: true } : {}),
    };
    addMessage(userMsg, streamProjectId);

    const assistantMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2, 10),
      role: "assistant",
      content: "",
      tokensOut: 0,
      receiptStatus: "signing",
      timestamp: Date.now(),
    };
    addMessage(assistantMsg, streamProjectId);
    setStreaming(true, streamProjectId);
    setThinkingStartedAt(Date.now());

    // If debate mode is on and no explicit override, route to debate
    const debateMode = useMeterStore.getState().debateMode;
    const effectiveModel = modelOverride ?? (debateMode ? "debate" : selectedModelId);
    const isDebateMode = effectiveModel === "debate";
    const isDissectorMode = effectiveModel === "dissect";

    // Reset debate state
    if (isDebateMode) {
      setDebateTraceLocal([]);
      setActiveDebateTurn(null);
      setDebatePhase("debating");
    }

    // Reset dissector state
    if (isDissectorMode) {
      setDissectorTraceLocal([]);
      setActiveDissectorTurn(null);
      setDissectorPhase("dissecting");
    }

    // Track traces locally during streaming
    const localTrace: DebateTurn[] = [];
    const localDissTrace: DissectorTurn[] = [];
    let currentDissTurn: { persona: string; content: string } | null = null;
    let finalUsage: { tokensIn: number; tokensOut: number; confidence: number; cacheCreationTokens: number; cacheReadTokens: number; cacheReadRate: number; actualCost?: number } | null = null;
    let actualModelUsed: string | null = null;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const allMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userContent },
      ];

      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: allMessages,
          model: effectiveModel,
          projectId: streamProjectId,
          connectedServices: Object.keys(connectedServices).filter(
            (k) => connectedServices[k]
          ),
          ...(userAttachments?.length ? { attachments: userAttachments } : {}),
          ...(effectiveModel === "debate" ? { debateRoster: useMeterStore.getState().debateRoster } : {}),
        }),
      });

      // Pre-estimate input cost for limit checking. This is NOT added to
      // the store (which would pollute todayCost) — it's only used as a local
      // adjustment inside checkSpendLimits. finalizeResponse handles the real
      // cost reconciliation when actual token counts arrive from the API.
      //
      // Cap at 30K tokens to match the server's MAX_CONTEXT_TOKENS truncation.
      // Without the cap, long conversations would over-estimate 10x+ and
      // falsely trigger limits.
      const SERVER_MAX_CONTEXT_TOKENS = 30_000;
      const rawEstimatedTokens = allMessages.reduce(
        (sum, m) => sum + Math.ceil((typeof m.content === "string" ? m.content.length : 0) / 4),
        0,
      );
      const estimatedInputTokens = Math.min(rawEstimatedTokens, SERVER_MAX_CONTEXT_TOKENS);
      const inputModel = getModel(isDebateMode ? DEBATE_MODELS[0] : effectiveModel);
      const estimatedInputCost = (isDebateMode
        // Debate sends context to each model per phase; sum of rates is a
        // reasonable approximation for one round of input across all models.
        ? estimatedInputTokens * DEBATE_MODELS.reduce((sum, id) => sum + getModel(id).inputPrice, 0)
        : estimatedInputTokens * inputModel.inputPrice) * markupMultiplier;

      if (res.status === 429) {
        const body = await res.json().catch(() => ({ error: "Spend limit reached" }));
        updateLastAssistantMessage(body.error ?? "Spend limit reached. Please adjust your limits or wait for the next period.", 0, streamProjectId);
        return;
      }
      if (!res.ok) throw new Error(`Chat API failed (${res.status})`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullContent = "";
      let thinkingContent = "";
      let buffer = "";
      let currentTurn: { model: string; phase: string; content: string } | null = null;

      /** Abort the stream if per-txn or daily limit is exceeded.
       *  Adds estimatedInputCost (from closure) on top of the store's
       *  currentMessageCost so the check accounts for input tokens without
       *  polluting todayCost in the store. */
      const checkSpendLimits = (): boolean => {
        const state = useMeterStore.getState();
        const active = state.projects.find((p) => p.id === streamProjectId);
        // currentMessageCost tracks output cost accumulated during streaming.
        // Add the local input estimate for a more accurate per-txn check.
        const cost = (active?.currentMessageCost ?? 0) + estimatedInputCost;

        // Per-transaction limit
        const txnLimit = spendLimits.perTxnLimit;
        if (txnLimit != null && txnLimit > 0 && cost >= txnLimit) {
          const notice = `\n\n---\n*Per-transaction limit ($${txnLimit.toFixed(2)}) reached. Response stopped at ~$${cost.toFixed(2)}.*`;
          fullContent += notice;
          const lastMsg = (active?.messages ?? []).at(-1);
          updateLastAssistantMessage(fullContent, lastMsg?.tokensOut ?? 0, streamProjectId);
          trackPerTxnLimitHit({ projectId: streamProjectId, limit: txnLimit, actualCost: cost, model: effectiveModel });
          abort.abort();
          return true;
        }

        // Daily limit — also enforce mid-stream so a single expensive
        // response can't blow through the daily budget.
        const dailyLimit = spendLimits.dailyLimit;
        const todayCost = (active?.todayCost ?? 0) + estimatedInputCost;
        if (dailyLimit != null && dailyLimit > 0 && todayCost >= dailyLimit) {
          const notice = `\n\n---\n*Daily limit ($${dailyLimit.toFixed(2)}) reached. Response stopped at ~$${todayCost.toFixed(2)} today.*`;
          fullContent += notice;
          const lastMsg = (active?.messages ?? []).at(-1);
          updateLastAssistantMessage(fullContent, lastMsg?.tokensOut ?? 0, streamProjectId);
          abort.abort();
          return true;
        }

        return false;
      };

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

            // ── Debate-specific events ────────────────────────
            if (data.type === "debate_start") {
              // Debate started — UI already set above
            } else if (data.type === "debate_turn_start") {
              currentTurn = { model: data.model as string, phase: data.phase as string, content: "" };
              setActiveDebateTurn(currentTurn);
            } else if (data.type === "debate_turn_delta") {
              if (currentTurn) {
                currentTurn = { model: currentTurn.model, phase: currentTurn.phase, content: currentTurn.content + (data.content as string) };
                setActiveDebateTurn(currentTurn);
                // Track output cost incrementally using the actual model's rate
                const deltaText = data.content as string;
                const estTokens = Math.ceil(deltaText.length / 4);
                const turnModel = getModel(currentTurn.model);
                incrementCurrentMessageCost(estTokens * turnModel.outputPrice, streamProjectId);
                if (checkSpendLimits()) break;
              }
            } else if (data.type === "debate_turn_end") {
              if (currentTurn) {
                localTrace.push({
                  model: currentTurn.model,
                  phase: currentTurn.phase as "opening" | "challenge" | "rebuttal" | "vote",
                  content: currentTurn.content,
                });
                setDebateTraceLocal([...localTrace]);
                setActiveDebateTurn(null);
                currentTurn = null;
              }
            } else if (data.type === "debate_synthesis_start") {
              setDebatePhase("synthesizing");
              setActiveDebateTurn(null);

            // ── Dissector events ──────────────────────────────
            } else if (data.type === "dissector_start") {
              // Dissector started — state already reset above
            } else if (data.type === "dissector_questions") {
              const rawQuestions = data.questions as string[];
              const questions: ClarifyingQuestion[] = rawQuestions.map((q, i) => ({
                id: `dq_${i}`,
                question: q,
              }));
              setDissectorPhase(null);
              useMeterStore.getState().addClarifyingQuestions(questions, streamProjectId);
            } else if (data.type === "dissector_turn_start") {
              currentDissTurn = { persona: data.persona as string, content: "" };
              setActiveDissectorTurn(currentDissTurn);
            } else if (data.type === "dissector_turn_delta") {
              if (currentDissTurn) {
                currentDissTurn = { persona: currentDissTurn.persona, content: currentDissTurn.content + (data.content as string) };
                setActiveDissectorTurn(currentDissTurn);
                const deltaText = data.content as string;
                const estTokens = Math.ceil(deltaText.length / 4);
                const dissModel = getModel("anthropic/claude-opus-4.6");
                incrementCurrentMessageCost(estTokens * dissModel.outputPrice, streamProjectId);
                if (checkSpendLimits()) break;
              }
            } else if (data.type === "dissector_turn_end") {
              if (currentDissTurn) {
                localDissTrace.push({
                  persona: currentDissTurn.persona as "first-principles" | "inversion" | "pre-mortem" | "verdict",
                  content: currentDissTurn.content,
                });
                setDissectorTraceLocal([...localDissTrace]);
                setActiveDissectorTurn(null);
                currentDissTurn = null;
              }
            } else if (data.type === "dissector_synthesis_start") {
              setDissectorPhase("synthesizing");
              setActiveDissectorTurn(null);

            // ── Standard events ───────────────────────────────
            } else if (data.type === "thinking_delta") {
              thinkingContent += data.content;
              useMeterStore.getState().updateLastAssistantThinking(thinkingContent, streamProjectId);
            } else if (data.type === "delta") {
              fullContent += data.content;
              setActiveTool(null);
              setRerouting(null);
              updateLastAssistantMessage(fullContent, data.tokensOut, streamProjectId);
              if (checkSpendLimits()) break;
            } else if (data.type === "tool_call") {
              setActiveTool(data.name as string);
            } else if (data.type === "tool_result") {
              if (data.name === "save_decision" && data.decision) {
                const d = data.decision as { id?: string; title: string; status: string; choice: string; alternatives?: string[]; reasoning?: string };
                const decId = d.id || Math.random().toString(36).slice(2, 10);
                // Log directly to decisions store (no staging step)
                useDecisionsStore.getState().addDecision({
                  id: decId,
                  title: d.title,
                  status: "decided",
                  choice: d.choice,
                  alternatives: d.alternatives,
                  reasoning: d.reasoning ?? undefined,
                  projectId: streamProjectId,
                });
                useMeterStore.getState().setMessageDecisionId(decId, streamProjectId);
                trackDecisionStaged({ decisionId: decId, title: d.title, projectId: streamProjectId });
              }
              if (data.name === "save_artifact" && data.artifact) {
                const a = data.artifact as { id?: string; filePath: string; content?: string; category?: string; status: string };
                const artId = a.id || `temp_${Date.now()}`;
                useArtifactsStore.getState().upsertArtifact({
                  id: artId,
                  filePath: a.filePath,
                  content: a.content || "",
                  category: a.category || "other",
                  status: (a.status as "draft" | "synced") || "draft",
                  lastGeneratedAt: Date.now(),
                });
                // Add preview card to the current message
                if (a.content) {
                  useMeterStore.getState().addDocumentToLastMessage({
                    id: artId,
                    filePath: a.filePath,
                    content: a.content,
                    category: a.category || "other",
                  }, streamProjectId);
                }
              }
              if (data.name === "porkbun_check_domain" && data.domainCard) {
                const dc = data.domainCard as {
                  id: string;
                  type: string;
                  title: string;
                  description: string;
                  cost?: number;
                  status: string;
                  metadata?: Record<string, string>;
                };
                useMeterStore.getState().addCardToLastMessage(
                  {
                    id: dc.id,
                    type: dc.type as "domain",
                    title: dc.title,
                    description: dc.description,
                    cost: dc.cost,
                    status: dc.status as "pending" | "rejected",
                    metadata: dc.metadata,
                  },
                  streamProjectId
                );
              }
            } else if (data.type === "rerouting") {
              setRerouting({ provider: data.provider as string, toModel: data.to as string });
            } else if (data.type === "error") {
              const errorPayload = JSON.stringify({ code: data.code, model: data.model });
              fullContent = `__error__${errorPayload}`;
              updateLastAssistantMessage(fullContent, 0, streamProjectId);
            } else if (data.type === "done") {
              if (data.actualModel) actualModelUsed = data.actualModel as string;
            } else if (data.type === "usage") {
              finalUsage = {
                tokensIn: data.tokensIn,
                tokensOut: data.tokensOut,
                confidence: data.confidence ?? 0,
                cacheCreationTokens: data.cacheCreationTokens ?? 0,
                cacheReadTokens: data.cacheReadTokens ?? 0,
                cacheReadRate: data.cacheReadRate ?? 0,
                actualCost: data.actualCost ?? undefined,
              };
            }
          } catch {
            // noop
          }
        }
      }

      // Persist debate trace to the message
      if (isDebateMode && localTrace.length > 0) {
        useMeterStore.getState().setDebateTrace(localTrace, streamProjectId);
        trackDebateCompleted({ projectId: streamProjectId, turnCount: localTrace.length });
      }
      // Persist dissector trace to the message
      if (isDissectorMode && localDissTrace.length > 0) {
        useMeterStore.getState().setDissectorTrace(localDissTrace, streamProjectId);
      }

      if (finalUsage) {
        finalizeResponse(
          finalUsage.tokensIn,
          finalUsage.tokensOut,
          finalUsage.confidence,
          actualModelUsed ?? undefined,
          finalUsage.cacheCreationTokens,
          finalUsage.cacheReadTokens,
          finalUsage.cacheReadRate,
          finalUsage.actualCost,
          streamProjectId,
        );
      }
    } catch {
      // Abort or network error — persist whatever we have so far.
      // Partial responses are still billed upstream (industry standard).
      if (isDebateMode && localTrace.length > 0) {
        useMeterStore.getState().setDebateTrace(localTrace, streamProjectId);
      }
      if (isDissectorMode && localDissTrace.length > 0) {
        useMeterStore.getState().setDissectorTrace(localDissTrace, streamProjectId);
      }
      if (finalUsage) {
        finalizeResponse(
          finalUsage.tokensIn,
          finalUsage.tokensOut,
          finalUsage.confidence,
          actualModelUsed ?? undefined,
          finalUsage.cacheCreationTokens,
          finalUsage.cacheReadTokens,
          finalUsage.cacheReadRate,
          finalUsage.actualCost,
          streamProjectId,
        );
      }
    } finally {
      abortRef.current = null;
      setActiveTool(null);
      setDebatePhase(null);
      setActiveDebateTurn(null);
      setDissectorPhase(null);
      setActiveDissectorTurn(null);
      // Delay setStreaming(false) so the meter pill slot animation has
      // time to roll to the final cost value before locking.
      setTimeout(() => setStreaming(false, streamProjectId), 350);
    }
  };

  const handleSend = async () => {
    const input = inputRef.current;
    const hasText = input && input.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!input || (!hasText && !hasAttachments) || isStreaming || !workspaceCardReady) return;

    if (chatBlocked) {
      trackChatBlocked({ projectId: activeProjectId });
      const userContent = input.value.trim();
      input.value = "";
      input.style.height = "auto";
      localStorage.removeItem(DRAFT_KEY(activeProjectId));
      isNearBottomRef.current = true;
      userScrolledAwayRef.current = false;
      addMessage({
        id: Math.random().toString(36).slice(2, 10),
        role: "user",
        content: userContent,
        timestamp: Date.now(),
      });
      addMessage({
        id: Math.random().toString(36).slice(2, 10),
        role: "assistant",
        content: "Chat is paused. Please update your payment method or settle your outstanding balance to continue.",
        timestamp: Date.now(),
      });
      return;
    }

    if (spendingCapEnabled && todayCost >= spendingCap) return;

    const userContent = input.value.trim() || (pendingAttachments.length > 0 ? "What's in this file?" : "");
    const attachmentsToSend = pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;

    trackMessageSent({
      model: selectedModelId,
      projectId: activeProjectId,
      hasAttachments: !!attachmentsToSend,
      attachmentCount: attachmentsToSend?.length ?? 0,
      messageLength: userContent.length,
    });

    input.value = "";
    input.style.height = "auto";
    localStorage.removeItem(DRAFT_KEY(activeProjectId));
    setPendingAttachments([]);

    await streamResponse(userContent, undefined, attachmentsToSend);
  };

  /** Stop the current streaming response */
  const handleStop = () => {
    trackResponseStopped();
    if (abortRef.current) {
      abortRef.current.abort();
    } else {
      // No active stream (e.g. stuck after refresh) — force reset
      setStreaming(false);
    }
  };

  /** Triggered by the "Debate" button on a decision-point message */
  const handleDebate = async () => {
    if (isStreaming || !workspaceCardReady) return;
    trackDebateStarted({ projectId: activeProjectId });
    await streamResponse("Debate this.", "debate");
  };

  /** Triggered by the "Dissect" button on a decision-point message */
  const handleDissect = async () => {
    if (isStreaming || !workspaceCardReady) return;
    trackDissectClicked({ projectId: activeProjectId });
    await streamResponse("Dissect this.", "dissect");
  };

  /** Triggered when user submits answers to a clarifying question (dissector Q&A) */
  const handleClarifyingSubmit = async (answers: Record<string, string>) => {
    if (isStreaming) return;
    // Update the card to show answered state
    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    if (lastAssistant?.clarifyingQuestions) {
      for (const q of lastAssistant.clarifyingQuestions) {
        if (answers[q.id]) {
          useMeterStore.getState().updateClarifyingAnswer(lastAssistant.id, q.id, answers[q.id]);
        }
      }
    }
    // Format answers as a hidden user message → triggers analysis
    const formatted = Object.entries(answers)
      .map(([, a], i) => `${i + 1}. ${a}`)
      .join("\n");
    const answersContent = `Here are my answers to your clarifying questions:\n${formatted}`;
    await streamResponse(answersContent, "dissect", undefined, { hiddenUser: true });
  };

  /** Triggered by the "Decide" button on a decision-point message */
  const handleDecide = async () => {
    if (isStreaming || !workspaceCardReady) return;
    trackDecideClicked({ projectId: activeProjectId });
    await streamResponse("Yes, log that as a decision.");
  };

  /** Save a document preview to the Documents folder (commit the artifact) */
  const handleSaveDocument = useCallback((messageId: string, docId: string) => {
    const store = useArtifactsStore.getState();
    store.commitArtifact(docId);
    useMeterStore.getState().markDocumentSaved(messageId, docId);
    // Refresh artifacts so the Documents tab picks up the change
    store.fetchArtifacts(activeProjectId);
  }, [activeProjectId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When slash popover is open, forward navigation keys
    if (slashOpen && slashRef.current) {
      const consumed = slashRef.current.handleKey(e.key);
      if (consumed) { e.preventDefault(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.startsWith("/")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      // Close model picker when slash popover opens
      if (modelPickerOpen) setModelPickerOpen(false);
    } else {
      if (slashOpen) { setSlashOpen(false); setSlashQuery(""); }
    }

    // Debounced draft save
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const v = inputRef.current?.value ?? "";
      if (v) localStorage.setItem(DRAFT_KEY(activeProjectId), v);
      else localStorage.removeItem(DRAFT_KEY(activeProjectId));
    }, 250);
  };

  const handleCommandSelect = useCallback((chatPrompt: string) => {
    if (!inputRef.current) return;
    trackSlashCommandUsed({ command: chatPrompt.slice(0, 50) });
    inputRef.current.value = chatPrompt;
    setSlashOpen(false);
    setSlashQuery("");
    // Need a tick for the value to settle before handleSend reads it
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || !input.value.trim() || isStreaming || !workspaceCardReady) return;
      // Trigger send by dispatching keydown
      handleSend();
    });
  }, [isStreaming, workspaceCardReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSlashConnect = useCallback((providerId: string) => {
    if (!userId) return;
    trackConnectorInitiated({ provider: providerId, method: isApiKeyProvider(providerId) ? "api_key" : "oauth" });
    if (isApiKeyProvider(providerId)) {
      setApiKeyProvider(providerId);
    } else {
      initiateOAuthFlow(providerId, activeProjectId);
    }
    setSlashOpen(false);
    setSlashQuery("");
  }, [userId, activeProjectId]);

  const handleSlashFile = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    if (inputRef.current) inputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  // Consume pendingInput from store (e.g. decision revisit) — send directly
  useEffect(() => {
    if (pendingInput && inputRef.current && !isStreaming) {
      inputRef.current.value = pendingInput;
      setPendingInput(null);
      handleSend();
    }
  }, [pendingInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectedServices = useMeterStore(selectConnectedServices);
  const logout = useMeterStore((s) => s.logout);

  const scrollToBottom = useCallback(() => {
    userScrolledAwayRef.current = false;
    setShowScrollBtn(false);
    const el = scrollRef.current;
    if (el) {
      isProgrammaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
    }
  }, []);

  const lastMsg = messages[messages.length - 1];
  const showThinking = isStreaming && (rerouting || activeTool || (lastMsg?.role === "assistant" && lastMsg.content === ""));
  const lastUserMsg = messages.length >= 2 ? messages[messages.length - 2] : null;
  const hasImageAttachment = lastUserMsg?.attachments?.some(a => a.mimeType.startsWith("image/")) ?? false;
  const hasPdfAttachment = lastUserMsg?.attachments?.some(a => a.mimeType === "application/pdf") ?? false;

  return (
    <div className="flex h-screen bg-background">
      <ProfileSettings open={profileOpen} onClose={() => setProfileOpen(false)} />
      {switchingProjectName && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="rounded-2xl border border-border bg-card px-8 py-6 text-center shadow-xl">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">Switching workspace</p>
            <p className="mt-2 text-xl text-foreground">{switchingProjectName}</p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`relative flex flex-1 flex-col transition-all duration-300 ${inspectorOpen && !isMobile ? "mr-[420px]" : ""}`}
      >
        <header className="flex h-12 items-center justify-between border-b border-border px-4" style={{ paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined, height: isMobile ? "calc(3rem + env(safe-area-inset-top, 0px))" : undefined }}>
          <div className="relative flex items-center gap-2" ref={logoMenuRef}>
            <button
              onClick={() => setLogoMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-foreground/5"
            >
              <img src="/logo-dark-copy.webp" alt="Meter" width={72} height={20} className="hidden dark:block" />
              <img src="/logo-light.webp" alt="Meter" width={72} height={20} className="block dark:hidden" />
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-muted-foreground/40"
              >
                <polyline points="7 10 12 5 17 10" />
                <polyline points="7 14 12 19 17 14" />
              </svg>
            </button>
            {logoMenuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card shadow-xl py-1">
                <button
                  onClick={() => { setLogoMenuOpen(false); setProfileOpen(true); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile Settings
                </button>
                <div className="mx-2 my-1 h-px bg-border" />
                <button
                  onClick={() => { setLogoMenuOpen(false); resetUser(); logout(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
          <div className="relative flex items-center gap-2">
            <HeaderMeter />
            <button
              onClick={toggleInspector}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2 transition-colors hover:bg-foreground/5"
              title="Open panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto min-h-0">
          {/* Skeleton while sessions load from server */}
          {!sessionsLoaded && messages.length === 0 ? (
            <ChatSkeleton />
          ) : (
          <div className="mx-auto max-w-2xl px-4 py-6 max-md:px-3">
            {/* ── First-workspace onboarding: name → card → explainer ── */}
            {messages.length === 0 && !workspaceCardReady && !cardOnFile && onboardingStep === "name" && (
              <div className="mb-4">
                <div className="flex gap-3 justify-start">
                  <div className="relative max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed text-foreground">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Welcome to <strong>Meter</strong>. Name your workspace to get started.</p>
                    </div>
                    <div className="mt-3 max-w-sm">
                      <input
                        type="text"
                        value={onboardingWorkspaceName}
                        onChange={(e) => setOnboardingWorkspaceName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleOnboardingRenameWorkspace(); }}
                        placeholder="e.g. Acme, Personal, Side Project..."
                        className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/20"
                        autoFocus
                      />
                      <button
                        onClick={handleOnboardingRenameWorkspace}
                        className="mt-2 w-full rounded-lg bg-foreground py-2.5 font-mono text-xs text-background transition-colors hover:bg-foreground/90"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.length === 0 && !workspaceCardReady && !cardOnFile && onboardingStep === "card" && (
              <div className="mb-4">
                <div className="flex gap-3 justify-start">
                  <div className="relative max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed text-foreground">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Add a payment card to start chatting. A small hold verifies your card — you won&apos;t be charged for usage until your balance reaches $10.</p>
                    </div>
                    <InlineCardForm onComplete={() => setShowExplainer(true)} />
                  </div>
                </div>
              </div>
            )}

            {/* ── New workspace — has card globally but not assigned here ── */}
            {messages.length === 0 && !workspaceCardReady && cardOnFile && (
              <div className="mb-4">
                <div className="flex gap-3 justify-start">
                  <div className="relative max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed text-foreground">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Welcome to <strong>{activeProject?.name ?? "this workspace"}</strong>. Use your existing card or add a new one.</p>
                    </div>
                    <button
                      onClick={() => { trackCardAssignedToWorkspace({ projectId: activeProjectId }); setCardAssigned(activeProjectId); }}
                      className="mt-3 w-full rounded-lg border border-foreground/20 bg-foreground/5 py-2.5 font-mono text-xs text-foreground transition-colors hover:bg-foreground/10"
                    >
                      Use {cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : "card"} ****{cardLast4 ?? ""}{sourceWorkspaceName ? ` from ${sourceWorkspaceName}` : ""}
                    </button>
                    <div className="my-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="font-mono text-[10px] text-muted-foreground/40">or add a new card</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <InlineCardForm />
                  </div>
                </div>
              </div>
            )}

            {/* ── Workspace ready — explainer or standard prompt ── */}
            {messages.length === 0 && workspaceCardReady && showExplainer && (
              <div className="mb-4">
                <div className="flex gap-3 justify-start">
                  <div className="relative max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed text-foreground">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>You&apos;re all set. Here&apos;s how Meter works:</p>
                      <p><strong>Pay per thought.</strong> Every response costs a few cents. The exact price shows in real time — no subscriptions, no surprises.</p>
                      <p><strong>Pick your model.</strong> Choose from Claude, GPT, Gemini, Grok, DeepSeek and more. Each has its own per-token price.</p>
                      <p><strong>Autopay.</strong> Your card is charged automatically when your balance reaches $10. You can also settle anytime manually. You only pay for what you use.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {messages.length === 0 && workspaceCardReady && !showExplainer && (
              <div className="flex flex-col items-center justify-center gap-3 py-24">
                <p className="text-sm text-muted-foreground">What are you building in {activeProject?.name ?? "this workspace"}?</p>
                <p className="font-mono text-[10px] text-muted-foreground/40">Every model available. The meter runs in dollars.</p>
              </div>
            )}

            {visibleMessages.map((msg, msgIdx) => {
              const isLastAssistant = msg.role === "assistant" && msgIdx === visibleMessages.length - 1;
              const displayContent = msg.role === "assistant" ? stripDecisionPoint(msg.content) : msg.content;
              const isDecisionPoint = hasDecisionPoint(msg.content);
              const isDissectPoint = hasDissectPoint(msg.content);
              const showActionButtons = msg.role === "assistant"
                && (isDecisionPoint || isDissectPoint)
                && !msg.decisionId
                && !isStreaming;
              const actionVariant: "decision" | "dissect" = isDecisionPoint ? "decision" : "dissect";
              // Show live debate trace on the last assistant message while streaming
              const showLiveDebate = isLastAssistant && isStreaming && debatePhase;
              // Show persisted debate trace on any message that has one
              const showPersistedDebate = msg.debateTrace && msg.debateTrace.length > 0 && !showLiveDebate;
              // Show live dissector trace on the last assistant message while streaming
              const showLiveDissector = isLastAssistant && isStreaming && dissectorPhase;
              // Show persisted dissector trace on any message that has one
              const showPersistedDissector = msg.dissectorTrace && msg.dissectorTrace.length > 0 && !showLiveDissector;

              return (
                <div key={msg.id} id={`msg-${msg.id}`} className="group/msg relative mb-4 transition-all duration-300">
                  <div className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`relative rounded-xl px-4 py-3 text-sm leading-relaxed max-w-[85%] md:max-w-[85%] max-md:max-w-[92%] ${msg.role === "user" ? "bg-foreground/[0.04] dark:bg-foreground/10 text-foreground" : "text-foreground"} ${msg.pinned ? "border-l-2 border-amber-500/40" : ""}`}>
                      {displayContent && !displayContent.startsWith("__error__") && (
                        <>
                          <CopyButton text={msg.role === "user" ? msg.content : displayContent} />
                          <PinButton messageId={msg.id} pinned={msg.pinned} />
                        </>
                      )}

                      {/* Debate trace — live or persisted */}
                      {showLiveDebate && (
                        <DebateTrace
                          trace={debateTrace}
                          activeTurn={activeDebateTurn}
                          phase={debatePhase}
                        />
                      )}
                      {showPersistedDebate && (
                        <DebateTrace trace={msg.debateTrace!} />
                      )}

                      {/* Dissector trace — live or persisted */}
                      {showLiveDissector && (
                        <DissectorTrace
                          trace={dissectorTraceLocal}
                          activeTurn={activeDissectorTurn}
                          phase={dissectorPhase}
                        />
                      )}
                      {showPersistedDissector && (
                        <DissectorTrace trace={msg.dissectorTrace!} />
                      )}

                      {/* Inline attachment viewers */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {msg.attachments.map((att) =>
                            att.mimeType.startsWith("image/") ? (
                              <img
                                key={att.url}
                                src={att.url}
                                alt={att.name}
                                className="max-w-[320px] max-h-[240px] rounded-lg border border-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(att.url, "_blank")}
                              />
                            ) : att.mimeType === "application/pdf" ? (
                              <div key={att.url} className="w-full max-w-[400px] rounded-lg border border-border overflow-hidden">
                                <div className="flex items-center gap-2 bg-foreground/5 px-3 py-1.5 border-b border-border">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <span className="font-mono text-[11px] text-foreground/70 truncate">{att.name}</span>
                                  <a href={att.url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors">
                                    open
                                  </a>
                                </div>
                                <iframe src={att.url} className="w-full h-[300px] bg-white" title={att.name} />
                              </div>
                            ) : null
                          )}
                        </div>
                      )}

                      {msg.role === "assistant" && displayContent.startsWith("__error__") ? (
                        <ErrorCard payload={displayContent.slice("__error__".length)} />
                      ) : msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-a:text-blue-400 dark:prose-a:text-blue-400 prose-a:text-blue-600">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{displayContent}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}

                      {msg.role === "assistant" && msg.thinking && !isStreaming && (
                        <details className="mt-2 text-[11px] text-muted-foreground/60">
                          <summary className="cursor-pointer font-mono hover:text-muted-foreground transition-colors">
                            Show thinking
                          </summary>
                          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
                            {msg.thinking}
                          </pre>
                        </details>
                      )}

                      {msg.cards && msg.cards.length > 0 && (
                        <div className="mt-2">
                          {msg.cards.map((card) =>
                            card.type === "domain" ? (
                              <DomainCard
                                key={card.id}
                                card={card}
                                messageId={msg.id}
                              />
                            ) : (
                              <ActionCard
                                key={card.id}
                                card={card}
                                onApprove={() => approveCard(msg.id, card.id)}
                                onReject={() => rejectCard(msg.id, card.id)}
                              />
                            )
                          )}
                        </div>
                      )}

                      {/* Document previews */}
                      {msg.documents && msg.documents.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {msg.documents.map((doc) => (
                            <DocumentPreviewCard
                              key={doc.id}
                              doc={doc}
                              messageId={msg.id}
                              onSave={handleSaveDocument}
                            />
                          ))}
                        </div>
                      )}

                      {/* Clarifying question card (dissector Q&A) */}
                      {msg.clarifyingQuestions && msg.clarifyingQuestions.length > 0 && (
                        <ClarifyingCard
                          questions={msg.clarifyingQuestions}
                          messageId={msg.id}
                          onSubmit={handleClarifyingSubmit}
                          disabled={msg.clarifyingQuestions.every((q) => !!q.answer)}
                        />
                      )}

                      {/* Context-aware action buttons */}
                      {showActionButtons && (
                        <ActionPointButtons
                          variant={actionVariant}
                          onDecide={handleDecide}
                          onDebate={handleDebate}
                          onDissect={handleDissect}
                          disabled={isStreaming}
                        />
                      )}

                      {msg.role === "assistant" && msg.decisionId && (
                        <DecisionPill decisionId={msg.decisionId} onOpen={() => { trackInspectorToggled({ open: true }); setInspectorOpen(true); setInspectorTab("decisions"); }} />
                      )}
                      {msg.role === "assistant" && <MessageFooter msg={msg} projectId={activeProjectId} />}
                    </div>
                  </div>
                </div>
              );
            })}

            {showThinking && !debatePhase && !dissectorPhase && (
              <ThinkingIndicator
                toolName={activeTool}
                rerouting={rerouting}
                thinkingStartedAt={thinkingStartedAt}
                hasImageAttachment={hasImageAttachment}
                hasPdfAttachment={hasPdfAttachment}
                modelId={selectedModelId}
                thinkingText={lastMsg?.thinking}
              />
            )}

            <div ref={bottomRef} data-scroll-anchor />
          </div>
          )}
        </div>

        {/* Composer area */}
        <div className="p-4 md:pb-4" style={{ paddingBottom: isMobile ? "calc(1rem + env(safe-area-inset-bottom, 0px))" : undefined }}>
          <div className="relative mx-auto max-w-2xl">
            {/* Scroll-to-bottom button — positioned above the composer */}
            {showScrollBtn && (
              <div className="pointer-events-none absolute bottom-full left-0 right-0 flex justify-center pb-3" style={{ zIndex: 20 }}>
                <button
                  onClick={scrollToBottom}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-foreground/5"
                  title="Scroll to bottom"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Slash command popover — positioned above the composer */}
            <SlashCommandPopover
              ref={slashRef}
              open={slashOpen}
              query={slashQuery}
              connectedServices={connectedServices}
              onSelect={handleCommandSelect}
              onConnect={handleSlashConnect}
              onFile={handleSlashFile}
              onClose={() => { setSlashOpen(false); setSlashQuery(""); if (inputRef.current) inputRef.current.value = ""; }}
            />

            {/* Unified box */}
            <div
              className={`relative rounded-xl border bg-card overflow-hidden transition-colors ${dragOver ? "border-foreground/30 ring-1 ring-foreground/10" : "border-border"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
            >
              {/* Drop overlay */}
              {dragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-card/90 backdrop-blur-sm rounded-xl pointer-events-none">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p className="font-mono text-xs text-muted-foreground">Drop images or PDFs</p>
                  </div>
                </div>
              )}
              {/* Model selector bar — top section (replaces connections bar) */}
              <ModelSelectorBar
                open={modelPickerOpen}
                onToggle={() => setModelPickerOpen(!modelPickerOpen)}
                overrideModelId={rerouting?.toModel ?? null}
              />

              {/* Model picker + composer area */}
              <div ref={modelPickerRef}>
                {/* Model picker panel (expands inline) */}
                {modelPickerOpen && (
                  <>
                    <ModelPickerPanel onClose={() => setModelPickerOpen(false)} />
                    <div className="h-px bg-border" />
                  </>
                )}

                {/* Attachment preview strip */}
                {(pendingAttachments.length > 0 || uploading) && (
                  <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2 overflow-x-auto">
                    {pendingAttachments.map((a) => (
                      <div key={a.url} className="group/att relative shrink-0">
                        {a.mimeType.startsWith("image/") ? (
                          <img src={a.url} alt={a.name} className="h-16 w-16 rounded-lg object-cover border border-border" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-foreground/5">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[8px] text-muted-foreground/60 truncate px-1">PDF</span>
                          </div>
                        )}
                        <button
                          onClick={() => removePendingAttachment(a.url)}
                          className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-foreground text-background text-[10px] group-hover/att:flex"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    {uploading && (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border border-dashed">
                        <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                    )}
                  </div>
                )}

                {/* Composer — input row */}
                <div className="flex items-end gap-2 border-t border-border/50 p-2">
                  <textarea
                    ref={inputRef}
                    onKeyDown={handleKeyDown}
                    onChange={handleInputChange}
                    onPaste={handlePaste}
                    onFocus={() => { if (modelPickerOpen) setModelPickerOpen(false); }}
                    placeholder={!sessionsLoaded ? "Loading chat..." : workspaceCardReady ? "Say something... (type / for commands)" : "Add a card to start chatting..."}
                    disabled={!workspaceCardReady || !sessionsLoaded}
                    rows={1}
                    className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ maxHeight: "120px" }}
                    onInput={(e) => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = Math.min(t.scrollHeight, 120) + "px";
                    }}
                  />
                </div>

                {/* Action bar — +, Discuss/Debate, meter icon, send */}
                <div className="flex items-center gap-1.5 border-t border-border/10 px-2 py-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center rounded-md h-7 w-7 text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground shrink-0"
                    title="Add file"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                  <DiscussDebateToggle />
                  <div className="flex-1" />
                  <MeterPill />
                  {isStreaming ? (
                    <button
                      onClick={handleStop}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/80"
                      title="Stop generating"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!workspaceCardReady || !sessionsLoaded}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Workspace picker — plain text below the box */}
            <WorkspaceBar />
          </div>
        </div>
      </div>

      <Inspector />

      {apiKeyProvider && (
        <ApiKeyDialog
          provider={apiKeyProvider}
          onClose={() => setApiKeyProvider(null)}
        />
      )}
    </div>
  );
}
