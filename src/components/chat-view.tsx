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
import { emitLogEvent } from "@/lib/log-event";
import { MeterPill } from "@/components/meter-pill";
import { HeaderMeter } from "@/components/header-meter";
import { SyncButton } from "@/components/sync-button";
// CommitButton removed from header — decisions now log directly
import { ModelSelectorBar, ModelPickerPanel } from "@/components/model-picker";
import { Inspector } from "@/components/inspector";
import { ProfileSettings } from "@/components/profile-settings";
import { ActionCard } from "@/components/action-card";
import { DomainCard } from "@/components/domain-card";
// CommandBar removed — model selector bar replaces connections in the chat box
import { SlashCommandPopover, type SlashCommandHandle } from "@/components/slash-command";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { runReconcile } from "@/lib/reconcile-engine";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { WorkspaceBar } from "@/components/workspace-bar";
import { useWorkspaceStore, resolveWorkspaceSessionId } from "@/lib/workspace-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { InlineCardForm } from "@/components/inline-card-form";
import { getModel, shortModelName, DEBATE_MODELS, DEBATE_MODEL } from "@/lib/models";
import { useSessionSync, requestImmediateSync } from "@/lib/use-session-sync";
import { useDecisionsStore } from "@/lib/decisions-store";
import { authFetch } from "@/lib/auth-fetch";
import { useArtifactsStore } from "@/lib/artifacts-store";
import { useStagingStore } from "@/lib/staging-store";
import { DebateTrace, DebateModelDots } from "@/components/debate-trace";
import { Brainwave, type BrainwaveHandle } from "@/components/brainwave";
import { ClarifyingCard } from "@/components/clarifying-card";
import { DissectorTrace } from "@/components/dissector-trace";
import { Spinner } from "@/components/ui/spinner";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const DRAFT_KEY = (id: string) => `meter:draft:${id}`;

/** Path color scheme — each forked path gets a distinct color (up to 4) */
const PATH_COLORS = [
  { name: "teal", dot: "bg-teal-500", dotMuted: "bg-teal-500/30", text: "text-teal-400", border: "border-teal-500/30", bg: "bg-teal-500/10", bgHover: "hover:bg-teal-500/20" },
  { name: "indigo", dot: "bg-indigo-500", dotMuted: "bg-indigo-500/30", text: "text-indigo-400", border: "border-indigo-500/30", bg: "bg-indigo-500/10", bgHover: "hover:bg-indigo-500/20" },
  { name: "amber", dot: "bg-amber-500", dotMuted: "bg-amber-500/30", text: "text-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/10", bgHover: "hover:bg-amber-500/20" },
  { name: "rose", dot: "bg-rose-500", dotMuted: "bg-rose-500/30", text: "text-rose-400", border: "border-rose-500/30", bg: "bg-rose-500/10", bgHover: "hover:bg-rose-500/20" },
] as const;

function getPathColor(index: number) {
  return PATH_COLORS[Math.abs(index) % PATH_COLORS.length];
}

function statusLabel(msg: ChatMessage) {
  if (msg.receiptStatus === "settled") return "Settled";
  if (msg.receiptStatus === "metered") return "Metered";
  return "Metering";
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
  onFork,
  disabled,
  forkDisabled,
}: {
  variant: "decision" | "dissect" | "fork";
  onDecide: () => void;
  onDebate: () => void;
  onDissect: () => void;
  onFork: () => void;
  disabled?: boolean;
  forkDisabled?: boolean;
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
      {variant === "fork" && (
        <button
          onClick={onFork}
          disabled={disabled || forkDisabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-teal-500/40 hover:bg-teal-500/10 hover:text-teal-400 active:bg-teal-500/20 active:text-teal-400 disabled:opacity-40"
          title={forkDisabled ? "Cannot explore paths while already exploring" : "Fork into separate paths to explore each option"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          Explore paths
        </button>
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

/* ─── Sync Report Actions (Reconcile / Dismiss) ─── */

function SyncReportActions({ onReconcile }: { onReconcile: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        onClick={onReconcile}
        className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400 active:bg-amber-500/20 active:text-amber-400"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
        </svg>
        Reconcile all
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 bg-transparent px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/5 hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}

/* ─── Fork Point Divider ─── */

function ForkPointDivider({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-teal-500/20" />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400/60">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="font-mono text-[10px] text-teal-400/60">Forked into paths &middot; {label}</span>
      </div>
      <div className="flex-1 h-px bg-teal-500/20" />
    </div>
  );
}

/* ─── Branch Divider (shown in subtracks) ─── */

function BranchDivider({ timestamp, colorIndex }: { timestamp: number; colorIndex: number }) {
  const date = new Date(timestamp);
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const color = getPathColor(colorIndex);
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: `currentColor`, opacity: 0.15 }} />
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} style={{ opacity: 0.6 }} />
        <span className={`font-mono text-[10px] ${color.text}`} style={{ opacity: 0.5 }}>Branched from main &middot; {label}</span>
      </div>
      <div className="flex-1 h-px" style={{ background: `currentColor`, opacity: 0.15 }} />
    </div>
  );
}

/* ─── Resolved Fork Divider (shown after merge or close) ─── */

function ResolvedForkDivider({ timestamp, resolution }: { timestamp: number; resolution: "merged" | "closed" }) {
  const date = new Date(timestamp);
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const isMerged = resolution === "merged";
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-foreground/10" />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
          {isMerged ? (
            <>
              <circle cx="12" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M6 9v3a6 6 0 0 0 6 6" />
              <path d="M18 9v3a6 6 0 0 1-6 6" />
            </>
          ) : (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          )}
        </svg>
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {isMerged ? "Paths merged" : "Paths closed without merge"} &middot; {label}
        </span>
      </div>
      <div className="flex-1 h-px bg-foreground/10" />
    </div>
  );
}

function MergeEndDivider() {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-foreground/10" />
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="font-mono text-[10px] text-muted-foreground/40">End of merged path</span>
      </div>
      <div className="flex-1 h-px bg-foreground/10" />
    </div>
  );
}

/* ─── Frozen Main Banner ─── */

function FrozenMainBanner({
  subtracks,
  onSelectTrack,
  onCloseAll,
}: {
  subtracks: { id: string; name: string }[];
  onSelectTrack: (id: string) => void;
  onCloseAll: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <div className="rounded-xl border border-border/30 bg-foreground/[0.02] p-4">
      <div className="text-center">
        <div className="font-mono text-[12px] text-foreground/70 mb-1">
          Conversation forked into {subtracks.length} paths
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/50 mb-3">
          Continue in a path or close all to resume main
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {subtracks.map((st, idx) => {
            const color = getPathColor(idx);
            return (
              <button
                key={st.id}
                onClick={() => onSelectTrack(st.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border ${color.border} ${color.bg} px-3 py-1.5 font-mono text-[11px] ${color.text} transition-colors ${color.bgHover}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                {st.name}
              </button>
            );
          })}
          <div className="w-px h-5 bg-border/30 mx-1" />
          {!confirmClose ? (
            <button
              onClick={() => setConfirmClose(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/50 transition-colors hover:border-foreground/20 hover:text-foreground/60"
            >
              Close all paths
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground/50">Archive all paths?</span>
              <button
                onClick={onCloseAll}
                className="rounded-md bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Yes, close
              </button>
              <button
                onClick={() => setConfirmClose(false)}
                className="rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Subtrack Commit Bar ─── */

/** Color-coded fork icon (the git-branch style icon from the footer) */
function ForkIcon({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function SubtrackCommitBar({
  trackName,
  siblingNames,
  onCommit,
  onReturnToMain,
  colorIndex,
}: {
  trackName: string;
  siblingNames: string[];
  onCommit: () => void;
  onReturnToMain: () => void;
  colorIndex: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const color = getPathColor(colorIndex);

  return (
    <div className={`rounded-lg border ${color.border} ${color.bg} px-3 py-2`}>
      <div className="flex items-center gap-2">
        {/* Fork icon + path name */}
        <div className="min-w-0 flex items-center gap-1.5">
          <ForkIcon className={color.text} />
          <span className={`font-mono text-[11px] ${color.text} truncate`}>
            {trackName}
          </span>
        </div>

        {/* Arrow → main (clickable) */}
        <button
          onClick={onReturnToMain}
          className="shrink-0 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/40 hover:text-foreground/70 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <span>main</span>
        </button>

        {/* Commit button — right side */}
        <div className="ml-auto shrink-0">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className={`inline-flex items-center gap-1.5 rounded-md ${color.bg} px-2.5 py-1 font-mono text-[11px] ${color.text} transition-colors ${color.bgHover}`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Commit
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] text-muted-foreground/50">
                Archive {siblingNames.join(", ")}?
              </span>
              <button
                onClick={onCommit}
                className={`rounded-md ${color.bg} px-2 py-0.5 font-mono text-[10px] ${color.text} ${color.bgHover} transition-colors`}
              >
                Yes
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-0.5 font-mono text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Stacked Fork Cards ─── */
/* Apple Pay-style stacked cards: siblings peek behind the active card */

function StackedForkCards({
  activeTrackName,
  activeColorIndex,
  siblingNames,
  siblings,
  onCommit,
  onReturnToMain,
  onSwitchTrack,
}: {
  activeTrackName: string;
  activeColorIndex: number;
  siblingNames: string[];
  siblings: { id: string; name: string; colorIndex: number }[];
  onCommit: () => void;
  onReturnToMain: () => void;
  onSwitchTrack: (id: string) => void;
}) {
  return (
    <div className="mb-2">
      {/* Background cards — narrower to look "behind", greyed out until hover */}
      {siblings.map((sib, i) => {
        const color = getPathColor(sib.colorIndex);
        return (
          <div key={sib.id} className="flex justify-center" style={{ zIndex: siblings.length - i, position: "relative" }}>
            <button
              onClick={() => onSwitchTrack(sib.id)}
              className="block rounded-t-lg border border-border/40 px-3 py-1.5 cursor-pointer group transition-all duration-200 hover:border-border/60"
              style={{
                backgroundColor: "var(--card)",
                width: `${100 - (siblings.length - i) * 3}%`,
              }}
            >
              <div className="flex items-center gap-1.5">
                <ForkIcon className="text-muted-foreground/30 group-hover:hidden" />
                <ForkIcon className={`${color.text} hidden group-hover:block`} />
                <span className="font-mono text-[11px] text-muted-foreground/50 group-hover:text-foreground/80 truncate transition-colors">
                  {sib.name}
                </span>
                <span className="ml-auto shrink-0 rounded-md border border-transparent px-2 py-0.5 font-mono text-[10px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 group-hover:border-foreground/10 group-hover:text-foreground/60 transition-all">
                  Switch
                </span>
              </div>
            </button>
          </div>
        );
      })}

      {/* Front card — the active track's commit bar, always on top */}
      <div className="relative rounded-lg" style={{ zIndex: siblings.length + 1, backgroundColor: "var(--card)" }}>
        <SubtrackCommitBar
          trackName={activeTrackName}
          siblingNames={siblingNames}
          onCommit={onCommit}
          onReturnToMain={onReturnToMain}
          colorIndex={activeColorIndex}
        />
      </div>
    </div>
  );
}

/* ─── Archived Subtrack Banner ─── */

function ArchivedSubtrackBanner({ committed, onReturnToMain }: { committed?: boolean; onReturnToMain: () => void }) {
  return (
    <div className="rounded-xl border border-border/30 bg-foreground/[0.02] p-4 text-center">
      <div className="font-mono text-[11px] text-muted-foreground/40 mb-2">
        {committed ? "This path was merged into main" : "This path was archived"}
      </div>
      <button
        onClick={onReturnToMain}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/50 transition-colors hover:border-foreground/20 hover:text-foreground/60"
      >
        Return to main
      </button>
    </div>
  );
}

/* ─── Inline Fork Form (confirmation before forking) ─── */

function InlineForkForm({
  pathNames,
  onConfirm,
  onCancel,
}: {
  pathNames: string[];
  onConfirm: (names: string[]) => void;
  onCancel: () => void;
}) {
  const [names, setNames] = useState(pathNames);

  return (
    <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400/60">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="font-mono text-[12px] text-teal-400/80">Fork into paths</span>
      </div>
      <div className="space-y-2 mb-3">
        {names.map((name, idx) => {
          const color = getPathColor(idx);
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  const updated = [...names];
                  updated[idx] = e.target.value;
                  setNames(updated);
                }}
                className={`flex-1 bg-transparent border-b ${color.border} font-mono text-[11px] ${color.text} py-1 px-1 focus:outline-none focus:border-opacity-60`}
                placeholder={`Path ${idx + 1}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 font-mono text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const valid = names.filter((n) => n.trim());
            if (valid.length >= 2) onConfirm(valid);
          }}
          disabled={names.filter((n) => n.trim()).length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 font-mono text-[11px] text-teal-400 transition-colors hover:bg-teal-500/20 disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          Fork
        </button>
      </div>
    </div>
  );
}

/* ─── Debate toggle ─── */

function DiscussDebateToggle() {
  const debateMode = useMeterStore((s) => s.debateMode);
  const toggleDebateMode = useMeterStore((s) => s.toggleDebateMode);
  const isStreaming = useMeterStore((s) => {
    const project = s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0];
    return project?.isStreaming ?? false;
  });

  return (
    <button
      onClick={toggleDebateMode}
      disabled={isStreaming}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] transition-all disabled:opacity-40 disabled:pointer-events-none ${
        debateMode
          ? "text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
          : "text-muted-foreground/60 hover:bg-foreground/5 hover:text-muted-foreground"
      }`}
      title={debateMode ? "Exit debate mode" : "Enter debate mode"}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
      </svg>
      Debate
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

/** Check if a message contains the [fork-paths] tag (crossroads requiring parallel exploration) */
function hasForkPathsPoint(content: string): boolean {
  return content.includes("[fork-paths]");
}

/** Strip action-point tags from content for display */
function stripDecisionPoint(content: string): string {
  return content.replace(/\s*\[(decision|dissect|fork)-point\]\s*/g, "").replace(/\s*\[fork-paths\]\s*/g, "").trim();
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
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{doc.content}</ReactMarkdown>
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

function MessageFooter({ msg, sessionId }: { msg: ChatMessage; sessionId: string }) {
  const hasCost = msg.cost !== undefined;

  const modelName = msg.model ? shortModelName(msg.model) : "—";
  const cost = msg.cost ?? 0;
  const totalTokens = (msg.tokensIn ?? 0) + (msg.tokensOut ?? 0);
  const isMetered = msg.receiptStatus === "metered" || msg.receiptStatus === "settled";

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
      {isMetered ? (
        <a
          href={`/receipt/${msg.id}?session=${sessionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 transition-colors ${msg.receiptStatus === "settled" ? "text-emerald-500/80 hover:text-emerald-400" : "text-emerald-500/80 hover:text-emerald-400"}`}
          title="Open receipt"
        >
          {statusLabel(msg)}
          <span>↗</span>
        </a>
      ) : (
        <span className="text-amber-500/80">{statusLabel(msg)}</span>
      )}
    </div>
  );
}

/* ─── Thinking / tool-use indicator with shimmer ─── */
const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  save_decision: "Saving decision",
  fork_paths: "Forking paths",
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

  // Auto-scroll the thinking stream to the bottom
  const thinkingStreamRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (hasRealThinking && thinkingStreamRef.current) {
      thinkingStreamRef.current.scrollTop = thinkingStreamRef.current.scrollHeight;
    }
  }, [thinkingText, hasRealThinking]);

  return (
    <div className="px-4 py-3 mb-4">
      <div className="flex items-center gap-2">
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
      {hasRealThinking && (
        <pre
          ref={thinkingStreamRef}
          className="mt-2 ml-[22px] max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground/40 leading-relaxed border-l border-border/30 pl-3"
        >
          {thinkingText}
          <span className="inline-block w-[5px] h-[10px] bg-muted-foreground/30 animate-pulse ml-0.5 align-middle" />
        </pre>
      )}
    </div>
  );
}

/* ─── Main ChatView ────────────────────────────────────────────── */
export function ChatView() {
  // Sync sessions to Supabase for eternal persistence
  useSessionSync();

  const isMobile = useIsMobile();
  const sessionsLoaded = useMeterStore((s) => s.sessionsLoaded);

  const activeSessionId = useMeterStore((s) => s.activeSessionId);
  const activeSession = useMeterStore((s) => s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0]);
  // Full sessions list — only used for infrequent lookups (defaultSessionId, sourceWorkspace, session switching).
  // Avoid using for hot-path renders.
  const sessions = useMeterStore((s) => s.sessions);
  const setActiveSession = useMeterStore((s) => s.setActiveSession);
  const addMessage = useMeterStore((s) => s.addMessage);
  const updateLastAssistantMessage = useMeterStore((s) => s.updateLastAssistantMessage);
  const finalizeResponse = useMeterStore((s) => s.finalizeResponse);
  const setStreaming = useMeterStore((s) => s.setStreaming);
  const incrementCurrentMessageCost = useMeterStore((s) => s.incrementCurrentMessageCost);
  const inspectorOpen = useMeterStore((s) => s.inspectorOpen);
  const toggleInspector = useMeterStore((s) => s.toggleInspector);
  const spendingCap = useMeterStore((s) => s.spendingCap);
  const spendingCapEnabled = useMeterStore((s) => s.spendingCapEnabled);
  const selectedModelId = useMeterStore((s) => s.selectedModelId);
  const setSelectedModelId = useMeterStore((s) => s.setSelectedModelId);
  const debateMode = useMeterStore((s) => s.debateMode);
  const approveCard = useMeterStore((s) => s.approveCard);
  const rejectCard = useMeterStore((s) => s.rejectCard);
  const spendLimits = useMeterStore((s) => s.spendLimits);
  const markupMultiplier = useMeterStore((s) => s.markupMultiplier);

  const messages = activeSession?.messages ?? [];
  const allVisibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  // Render only the last RENDER_WINDOW messages for performance.
  // Users with 5000+ messages would freeze the UI if all were in the DOM.
  // Scrolling up reveals more via the existing fetchOlderMessages mechanism.
  const RENDER_WINDOW = 200;
  const [renderLimit, setRenderLimit] = useState(RENDER_WINDOW);
  // Reset render limit when switching sessions
  useEffect(() => { setRenderLimit(RENDER_WINDOW); }, [activeSessionId]);
  const visibleMessages = useMemo(() => {
    if (allVisibleMessages.length <= renderLimit) return allVisibleMessages;
    return allVisibleMessages.slice(allVisibleMessages.length - renderLimit);
  }, [allVisibleMessages, renderLimit]);
  const isStreaming = activeSession?.isStreaming ?? false;
  const todayCost = activeSession?.todayCost ?? 0;
  const todayMessageCount = activeSession?.todayMessageCount ?? 0;

  // Fetch spend limits on mount and when session changes — can't rely on
  // Inspector since it's unmounted when closed, and limits aren't persisted
  // across page reloads without this.
  const fetchSpendLimits = useMeterStore((s) => s.fetchSpendLimits);
  useEffect(() => {
    if (activeSessionId) fetchSpendLimits(activeSessionId);
  }, [activeSessionId, fetchSpendLimits]);

  const decisions = useDecisionsStore((s) => s.decisions);
  const updateDecision = useDecisionsStore((s) => s.updateDecision);

  const defaultSessionId = useMemo(() => {
    const match = sessions.find(
      (p) => p.id === "default" || p.id === "meter" || p.name?.toLowerCase() === "meter"
    );
    return match?.id ?? sessions[0]?.id ?? null;
  }, [sessions]);

  useEffect(() => {
    if (!defaultSessionId) return;
    const unassigned = decisions.filter((d) => !d.sessionId);
    if (unassigned.length === 0) return;
    unassigned.forEach((d) => {
      updateDecision(d.id, { sessionId: defaultSessionId });
    });
  }, [decisions, defaultSessionId, updateDecision]);

  const userId = useMeterStore((s) => s.userId);
  const userHandle = useMeterStore((s) => s.handle);
  const cardOnFile = useMeterStore((s) => s.cardOnFile);
  const cardLast4 = useMeterStore((s) => s.cardLast4);
  const cardBrand = useMeterStore((s) => s.cardBrand);
  const workspaceCardReady = useMeterStore(selectWorkspaceCardReady);
  const setCardAssigned = useMeterStore((s) => s.setCardAssigned);
  const chatBlocked = activeSession?.chatBlocked ?? false;

  const sourceWorkspaceName = useMemo(() => {
    if (workspaceCardReady || !cardOnFile) return null;
    const source = sessions.find(
      (p) => p.id !== activeSessionId && p.cardAssigned === true
    );
    return source?.name ?? null;
  }, [workspaceCardReady, cardOnFile, sessions, activeSessionId]);

  // Onboarding state: first-time users go name → card → explainer
  const [onboardingWorkspaceName, setOnboardingWorkspaceName] = useState(
    activeSession?.name ?? "My Workspace"
  );
  const [onboardingStep, setOnboardingStep] = useState<"name" | "card">("name");
  const [onboardingIdCopied, setOnboardingIdCopied] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const renameSession = useMeterStore((s) => s.renameSession);
  const addSession = useMeterStore((s) => s.addSession);
  const setActiveSessionChat = useMeterStore((s) => s.setActiveSession);

  // First-workspace onboarding: rename existing default workspace
  const handleOnboardingRenameWorkspace = () => {
    const name = onboardingWorkspaceName.trim() || "My Workspace";
    renameSession(activeSessionId, name);
    // Create workspace in workspace store to link with this session
    createWorkspace(name, activeSessionId);
    trackWorkspaceCreated({ name, source: "chat_onboarding" });
    trackOnboardingStepViewed({ step: "card" });
    setOnboardingStep("card");
  };

  // Legacy: create new workspace (for non-first workspaces added later)
  const handleOnboardingCreateWorkspace = () => {
    const name = onboardingWorkspaceName.trim();
    if (!name) return;
    const sessionId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    createWorkspace(name, sessionId);
    addSession(name, sessionId);
    setActiveSessionChat(sessionId);
    trackWorkspaceCreated({ name, source: "chat_onboarding" });
  };

  // --- Track branching state ---
  const wsTracks = useWorkspaceStore((s) => s.tracks);
  const wsWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const wsActiveTrackId = useWorkspaceStore((s) => s.activeTrackId);
  const forkTrack = useWorkspaceStore((s) => s.forkTrack);
  const commitSubtrackWs = useWorkspaceStore((s) => s.commitSubtrack);
  const closeAllSubtracksWs = useWorkspaceStore((s) => s.closeAllSubtracks);
  const setActiveTrackWs = useWorkspaceStore((s) => s.setActiveTrack);
  const createSubtrackSession = useMeterStore((s) => s.createSubtrackSession);
  const mergeSubtrackIntoParent = useMeterStore((s) => s.mergeSubtrackIntoParent);
  const clearForkPoint = useMeterStore((s) => s.clearForkPoint);
  const addDecision = useDecisionsStore((s) => s.addDecision);

  // Sync workspace store's active track to main store's active session.
  // When switching to a subtrack, main store must also switch so messages route correctly.
  // When switching to null (main), main store should use the workspace's sessionId.
  useEffect(() => {
    if (wsActiveTrackId) {
      // Subtrack selected — switch main store to the subtrack's Session
      const mainSessions = useMeterStore.getState().sessions;
      const subtrackThread = mainSessions.find((p) => p.id === wsActiveTrackId);
      if (subtrackThread) {
        // If subtrack has 0 messages (lost after refresh), re-clone from parent
        if (subtrackThread.messages.length === 0) {
          const wsTrack = wsTracks.find((p) => p.id === wsActiveTrackId);
          if (wsTrack?.isSubtrack && wsTrack.forkMessageId) {
            const workspace = wsWorkspaces.find((c) => c.id === wsTrack.workspaceId);
            if (workspace?.sessionId) {
              createSubtrackSession(wsActiveTrackId, workspace.sessionId, wsTrack.forkMessageId);
            }
          }
        }
        setActiveSessionChat(wsActiveTrackId);
        // Fire pending auto-analyze after session is synced.
        // Use setTimeout to yield to React so activeSessionId reflects the new track.
        if (pendingAutoAnalyzeNameRef.current) {
          const name = pendingAutoAnalyzeNameRef.current;
          pendingAutoAnalyzeNameRef.current = null;
          setTimeout(() => {
            handleAutoAnalyzeRef.current(name);
          }, 50);
        }
      }
    } else if (activeWorkspaceId) {
      // Main selected (null) — switch main store to workspace's session thread
      const workspace = wsWorkspaces.find((c) => c.id === activeWorkspaceId);
      if (workspace?.sessionId) {
        setActiveSessionChat(workspace.sessionId);
      }
    }
  }, [wsActiveTrackId, activeWorkspaceId, wsWorkspaces, wsTracks, setActiveSessionChat, createSubtrackSession]);

  // Current workspace track (from workspace store, has branching metadata)
  const currentWsTrack = useMemo(
    () => wsTracks.find((p) => p.id === wsActiveTrackId) ?? null,
    [wsTracks, wsActiveTrackId]
  );
  const isSubtrack = currentWsTrack?.isSubtrack ?? false;
  const isArchivedSubtrack = isSubtrack && currentWsTrack?.status === "archived";
  const parentTrackId = currentWsTrack?.parentTrackId ?? null;
  const forkMessageId = currentWsTrack?.forkMessageId ?? null;

  // Active subtracks for the current parent — scoped to current workspace, sorted by creation for consistent color assignment
  const activeSubtracks = useMemo(
    () => wsTracks.filter(
      (p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && (p.parentTrackId ?? null) === (isSubtrack ? parentTrackId : wsActiveTrackId)
    ).sort((a, b) => a.createdAt - b.createdAt),
    [wsTracks, activeWorkspaceId, isSubtrack, parentTrackId, wsActiveTrackId]
  );

  // Fork message IDs from active subtracks — used to show ForkPointDivider on main track
  // without relying on the isForkPoint flag (which doesn't survive refresh)
  const forkMessageIds = useMemo(
    () => new Set(
      wsTracks
        .filter((p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active")
        .map((p) => p.forkMessageId)
        .filter(Boolean) as string[]
    ),
    [wsTracks, activeWorkspaceId]
  );

  // Is main frozen? (has active subtracks pointing to it) — scoped to current workspace
  const isMainFrozen = useMemo(() => {
    if (isSubtrack) return false;
    return wsTracks.some(
      (p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && (p.parentTrackId ?? null) === (wsActiveTrackId ?? null)
    );
  }, [wsTracks, activeWorkspaceId, isSubtrack, wsActiveTrackId]);

  // Sibling subtracks (other active subtracks sharing same parent) — scoped to current workspace
  const siblingSubtracks = useMemo(() => {
    if (!isSubtrack || !currentWsTrack) return [];
    return wsTracks.filter(
      (p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && p.id !== currentWsTrack.id && (p.parentTrackId ?? null) === parentTrackId
    );
  }, [wsTracks, activeWorkspaceId, isSubtrack, currentWsTrack, parentTrackId]);

  // Color index for current subtrack (based on creation order among active subtracks with same parent)
  const currentPathColorIndex = useMemo(() => {
    if (!isSubtrack || !currentWsTrack) return 0;
    const allSiblings = wsTracks
      .filter((p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && (p.parentTrackId ?? null) === parentTrackId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const idx = allSiblings.findIndex((p) => p.id === currentWsTrack.id);
    return idx >= 0 ? idx : 0;
  }, [wsTracks, activeWorkspaceId, isSubtrack, currentWsTrack, parentTrackId]);

  // Sibling subtracks with their color indices (for stacked fork cards)
  const siblingCardsInfo = useMemo(() => {
    if (!isSubtrack || !currentWsTrack) return [];
    const allSibs = wsTracks
      .filter((p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && (p.parentTrackId ?? null) === parentTrackId)
      .sort((a, b) => a.createdAt - b.createdAt);
    return siblingSubtracks.map((s) => {
      const idx = allSibs.findIndex((p) => p.id === s.id);
      return { id: s.id, name: s.name, colorIndex: idx >= 0 ? idx : 0 };
    });
  }, [wsTracks, activeWorkspaceId, isSubtrack, currentWsTrack, parentTrackId, siblingSubtracks]);

  // Ref for fork handler — assigned after streamResponse is defined
  const handleForkPathsRef = useRef<() => void>(() => {});
  // Ref for auto-analyze path handler — assigned after streamResponse is defined
  const handleAutoAnalyzeRef = useRef<(name: string) => void>(() => {});
  // Ref for pending auto-analyze — set before track switch, consumed after session sync
  const pendingAutoAnalyzeNameRef = useRef<string | null>(null);

  const handleCommitSubtrack = () => {
    if (!currentWsTrack || !isSubtrack) return;
    const subtrackId = currentWsTrack.id;
    // Resolve the parent meter-store session ID — parentTrackId is null for root-level subtracks,
    // so fall back to the workspace's sessionId (the actual meter-store session ID for the workspace).
    let parent = parentTrackId;
    if (!parent) {
      const workspace = wsWorkspaces.find((c) => c.id === currentWsTrack.workspaceId);
      parent = workspace?.sessionId ?? "default";
    }
    const fork = forkMessageId;
    if (!fork) return;
    // Merge messages into parent thread
    mergeSubtrackIntoParent(subtrackId, parent, fork);
    // Archive all subtracks in workspace store
    commitSubtrackWs(subtrackId);
    // Auto-log decision
    addDecision({
      title: `Committed to "${currentWsTrack.name}"`,
      status: "decided",
      choice: currentWsTrack.name,
      alternatives: siblingSubtracks.map((s) => s.name),
      reasoning: "Explored multiple paths and committed to this one.",
      sessionId: parent,
    });
  };

  const handleCloseAllPaths = () => {
    const wsParent = isSubtrack ? parentTrackId : (wsActiveTrackId ?? null);
    // Find the fork message to clear — scoped to current workspace
    const subtracks = wsTracks.filter(
      (p) => p.workspaceId === activeWorkspaceId && p.isSubtrack && p.status === "active" && (p.parentTrackId ?? null) === wsParent
    );
    const fork = subtracks[0]?.forkMessageId;
    // Archive all subtracks
    closeAllSubtracksWs(wsParent);
    // Resolve to meter-store session ID for clearing fork point
    let meterParent = wsParent;
    if (!meterParent && activeWorkspaceId) {
      const workspace = wsWorkspaces.find((c) => c.id === activeWorkspaceId);
      meterParent = workspace?.sessionId ?? "default";
    }
    // Clear fork point marker
    if (fork) {
      clearForkPoint(meterParent ?? "default", fork);
    }
  };

  const handleReturnToMain = () => {
    setActiveTrackWs(parentTrackId ?? null);
  };

  const handleConfirmFork = (names: string[]) => {
    const sessionId = pendingForkSessionId ?? activeSessionId;
    const store = useMeterStore.getState();
    const session = store.sessions.find((p) => p.id === sessionId);
    const lastAssistantMsg = session?.messages.filter((m) => m.role === "assistant").pop();
    if (lastAssistantMsg && activeWorkspaceId) {
      const parentId = wsActiveTrackId ?? null;
      const ids = forkTrack(activeWorkspaceId, parentId, lastAssistantMsg.id, names);
      for (const id of ids) {
        createSubtrackSession(id, sessionId, lastAssistantMsg.id);
      }
    }
    setPendingForkNames(null);
    setPendingForkSessionId(null);
  };

  const handleCancelFork = () => {
    setPendingForkNames(null);
    setPendingForkSessionId(null);
  };

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const brainwaveRef = useRef<BrainwaveHandle | null>(null);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [switchingSessionName, setSwitchingSessionName] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState<{ provider: string; toModel: string } | null>(null);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number>(0);

  // When streaming resumes after reconnect (e.g. page refresh during thinking),
  // thinkingStartedAt is 0 because the original streamResponse didn't set it.
  // Detect this case and seed the timestamp so the ThinkingIndicator renders.
  useEffect(() => {
    if (isStreaming && thinkingStartedAt === 0) {
      setThinkingStartedAt(Date.now());
    }
    if (!isStreaming && thinkingStartedAt !== 0) {
      setThinkingStartedAt(0);
    }
  }, [isStreaming, thinkingStartedAt]);

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
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const activeStreamsRef = useRef<Set<string>>(new Set());
  const pendingForkRef = useRef<string[] | null>(null);
  const [pendingForkNames, setPendingForkNames] = useState<string[] | null>(null);
  const [pendingForkSessionId, setPendingForkSessionId] = useState<string | null>(null);

  // Clear fork confirmation when switching workspaces/sessions — prevents
  // fork UI from leaking into a different workspace.
  useEffect(() => {
    if (pendingForkSessionId && pendingForkSessionId !== activeSessionId) {
      setPendingForkNames(null);
      setPendingForkSessionId(null);
    }
  }, [activeSessionId, pendingForkSessionId]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await authFetch("/api/attachments/upload", { method: "POST", body: formData });
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
    userScrolledAwayRef.current = false;
    // Reset debate/dissector state so it doesn't leak across sessions/tracks.
    // If the new session has an active stream with a debate in progress,
    // restore the trace from the store so the UI picks up where it left off.
    const switchedSession = useMeterStore.getState().sessions.find((p) => p.id === activeSessionId);
    const hasActiveDebateStream = switchedSession?.isStreaming && activeStreamsRef.current.has(activeSessionId);
    const lastMsg = switchedSession?.messages[switchedSession.messages.length - 1];
    if (hasActiveDebateStream && lastMsg?.debateTrace && lastMsg.debateTrace.length > 0) {
      setDebateTraceLocal(lastMsg.debateTrace);
      setDebatePhase("debating");
    } else {
      setDebateTraceLocal([]);
      setDebatePhase(null);
    }
    setActiveDebateTurn(null);
    if (hasActiveDebateStream && lastMsg?.dissectorTrace && lastMsg.dissectorTrace.length > 0) {
      setDissectorTraceLocal(lastMsg.dissectorTrace);
      setDissectorPhase("dissecting");
    } else {
      setDissectorTraceLocal([]);
      setDissectorPhase(null);
    }
    setActiveDissectorTurn(null);
    setActiveTool(null);
    // Snap to bottom on session switch
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [activeSessionId]);

  // Restore draft from localStorage on mount / session switch
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY(activeSessionId));
    if (saved && inputRef.current) {
      inputRef.current.value = saved;
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [activeSessionId]);

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
      if (logoMenuRef.current && !logoMenuRef.current.contains(e.target as Node) && !useMeterStore.getState().loggingOut) {
        setLogoMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [logoMenuOpen]);

  // Inspector starts closed; user can open it manually

  const handleSessionSwitch = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      setShowSessionDropdown(false);
      return;
    }
    const next = sessions.find((p) => p.id === sessionId);
    if (!next) return;
    setShowSessionDropdown(false);
    setSwitchingSessionName(next.name);
    setActiveSession(sessionId);
    setTimeout(() => setSwitchingSessionName(null), 700);
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

  const fetchOlderMessages = useMeterStore((s) => s.fetchOlderMessages);

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

    // Pagination: reveal more locally-loaded messages or fetch from server
    if (el.scrollTop < 100) {
      // First, expand the client-side render window to show more already-loaded messages
      if (renderLimit < allVisibleMessages.length) {
        const prevScrollHeight = el.scrollHeight;
        setRenderLimit((prev) => Math.min(prev + RENDER_WINDOW, allVisibleMessages.length));
        requestAnimationFrame(() => {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = newScrollHeight - prevScrollHeight;
        });
      } else if (
        activeSession?.hasOlderMessages &&
        !activeSession?.loadingOlderMessages
      ) {
        // All locally loaded messages are rendered — fetch more from server
        const prevScrollHeight = el.scrollHeight;
        fetchOlderMessages(activeSessionId).then(() => {
          requestAnimationFrame(() => {
            const newScrollHeight = el.scrollHeight;
            el.scrollTop = newScrollHeight - prevScrollHeight;
          });
        });
      }
    }
  }, [activeSession?.hasOlderMessages, activeSession?.loadingOlderMessages, activeSessionId, fetchOlderMessages, renderLimit, allVisibleMessages.length]);

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
    // Pin the session ID at stream start so all mutations target the correct
    // session even if the user switches sessions mid-stream.
    const streamSessionId = activeSessionId;
    activeStreamsRef.current.add(streamSessionId);

    // Guard: only update local UI state (debate trace, phase, etc.) if this
    // stream's session is still the active one. Prevents cross-track contamination
    // when multiple tracks stream concurrently.
    const isActiveStream = () => activeStreamsRef.current.has(streamSessionId) && useMeterStore.getState().activeSessionId === streamSessionId;

    isNearBottomRef.current = true;
    userScrolledAwayRef.current = false;
    setRerouting(null); // Clear any previous reroute

    // Client-side daily limit check — Supabase sync is delayed (2-10s), so the
    // server pre-flight can read stale cost and let overspend through. The client
    // store has the authoritative todayCost since it tracks every message.
    if (spendLimits.dailyLimit != null && spendLimits.dailyLimit > 0) {
      const state = useMeterStore.getState();
      const active = state.sessions.find((p) => p.id === streamSessionId);
      const todayCost = active?.todayCost ?? 0;
      if (todayCost >= spendLimits.dailyLimit) {
        addMessage({
          id: Math.random().toString(36).slice(2, 10),
          role: "assistant",
          content: `Daily spend limit reached ($${todayCost.toFixed(2)} / $${spendLimits.dailyLimit.toFixed(2)}). Adjust your limit or wait until tomorrow.`,
          timestamp: Date.now(),
        }, streamSessionId);
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
    addMessage(userMsg, streamSessionId);
    // Immediately sync user message to server — don't wait for 2s debounce.
    // This ensures the message survives a page refresh even if done instantly.
    requestImmediateSync();

    const assistantMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2, 10),
      role: "assistant",
      content: "",
      tokensOut: 0,
      receiptStatus: "metering",
      timestamp: Date.now(),
    };
    addMessage(assistantMsg, streamSessionId);
    setStreaming(true, streamSessionId);
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
    // Track whether ANY content was received (accessible in catch for zombie cleanup)
    let receivedAnyContent = false;

    const abort = new AbortController();
    abortControllersRef.current.set(streamSessionId, abort);

    try {
      const allMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userContent },
      ];

      const res = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: allMessages,
          model: effectiveModel,
          sessionId: streamSessionId,
          userMessageId: userMsg.id,
          assistantMessageId: assistantMsg.id,
          markupMultiplier,
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
        updateLastAssistantMessage(body.error ?? "Spend limit reached. Please adjust your limits or wait for the next period.", 0, streamSessionId);
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
        const active = state.sessions.find((p) => p.id === streamSessionId);
        // currentMessageCost tracks output cost accumulated during streaming.
        // Add the local input estimate for a more accurate per-txn check.
        const cost = (active?.currentMessageCost ?? 0) + estimatedInputCost;

        // Per-transaction limit
        const txnLimit = spendLimits.perTxnLimit;
        if (txnLimit != null && txnLimit > 0 && cost >= txnLimit) {
          const notice = `\n\n---\n*Per-transaction limit ($${txnLimit.toFixed(2)}) reached. Response stopped at ~$${cost.toFixed(2)}.*`;
          fullContent += notice;
          const lastMsg = (active?.messages ?? []).at(-1);
          updateLastAssistantMessage(fullContent, lastMsg?.tokensOut ?? 0, streamSessionId);
          trackPerTxnLimitHit({ projectId: streamSessionId, limit: txnLimit, actualCost: cost, model: effectiveModel });
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
          updateLastAssistantMessage(fullContent, lastMsg?.tokensOut ?? 0, streamSessionId);
          abort.abort();
          return true;
        }

        return false;
      };

      // Abort the stream if the page becomes hidden (iOS tab switch).
      // iOS suspends JS execution on tab switch, breaking the stream reader.
      // Without this, the UI stays stuck in "thinking" when the user returns.
      const handleVisibilityAbort = () => {
        if (document.visibilityState === "hidden" && !abort.signal.aborted) {
          abort.abort();
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityAbort);

      try {
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
              if (isActiveStream()) setActiveDebateTurn(currentTurn);
            } else if (data.type === "debate_turn_delta") {
              if (currentTurn) {
                currentTurn = { model: currentTurn.model, phase: currentTurn.phase, content: currentTurn.content + (data.content as string) };
                if (isActiveStream()) setActiveDebateTurn(currentTurn);
                // Track output cost incrementally using the actual model's rate
                const deltaText = data.content as string;
                const estTokens = Math.ceil(deltaText.length / 4);
                if (isActiveStream()) brainwaveRef.current?.push(estTokens);
                const turnModel = getModel(currentTurn.model);
                incrementCurrentMessageCost(estTokens * turnModel.outputPrice, streamSessionId);
                if (checkSpendLimits()) break;
              }
            } else if (data.type === "debate_turn_end") {
              if (currentTurn) {
                localTrace.push({
                  model: currentTurn.model,
                  phase: currentTurn.phase as "opening" | "challenge" | "rebuttal" | "vote",
                  content: currentTurn.content,
                });
                // Always persist trace to the store (session-scoped) so it
                // survives track switches — not just local React state.
                useMeterStore.getState().setDebateTrace([...localTrace], streamSessionId);
                if (isActiveStream()) { setDebateTraceLocal([...localTrace]); setActiveDebateTurn(null); }
                currentTurn = null;
              }
            } else if (data.type === "debate_synthesis_start") {
              if (isActiveStream()) { setDebatePhase("synthesizing"); setActiveDebateTurn(null); }

            // ── Dissector events ──────────────────────────────
            } else if (data.type === "dissector_start") {
              // Dissector started — state already reset above
            } else if (data.type === "dissector_questions") {
              const rawQuestions = data.questions as string[];
              const questions: ClarifyingQuestion[] = rawQuestions.map((q, i) => ({
                id: `dq_${i}`,
                question: q,
              }));
              if (isActiveStream()) setDissectorPhase(null);
              useMeterStore.getState().addClarifyingQuestions(questions, streamSessionId);
            } else if (data.type === "dissector_turn_start") {
              currentDissTurn = { persona: data.persona as string, content: "" };
              if (isActiveStream()) setActiveDissectorTurn(currentDissTurn);
            } else if (data.type === "dissector_turn_delta") {
              if (currentDissTurn) {
                currentDissTurn = { persona: currentDissTurn.persona, content: currentDissTurn.content + (data.content as string) };
                if (isActiveStream()) setActiveDissectorTurn(currentDissTurn);
                const deltaText = data.content as string;
                const estTokens = Math.ceil(deltaText.length / 4);
                if (isActiveStream()) brainwaveRef.current?.push(estTokens);
                const dissModel = getModel("anthropic/claude-opus-4.6");
                incrementCurrentMessageCost(estTokens * dissModel.outputPrice, streamSessionId);
                if (checkSpendLimits()) break;
              }
            } else if (data.type === "dissector_turn_end") {
              if (currentDissTurn) {
                localDissTrace.push({
                  persona: currentDissTurn.persona as "first-principles" | "inversion" | "pre-mortem" | "verdict",
                  content: currentDissTurn.content,
                });
                // Always persist trace to the store (session-scoped)
                useMeterStore.getState().setDissectorTrace([...localDissTrace], streamSessionId);
                if (isActiveStream()) { setDissectorTraceLocal([...localDissTrace]); setActiveDissectorTurn(null); }
                currentDissTurn = null;
              }
            } else if (data.type === "dissector_synthesis_start") {
              if (isActiveStream()) { setDissectorPhase("synthesizing"); setActiveDissectorTurn(null); }

            // ── Standard events ───────────────────────────────
            } else if (data.type === "thinking_delta") {
              thinkingContent += data.content;
              useMeterStore.getState().updateLastAssistantThinking(thinkingContent, streamSessionId);
            } else if (data.type === "delta") {
              fullContent += data.content;
              receivedAnyContent = true;
              if (isActiveStream()) setRerouting(null);
              updateLastAssistantMessage(fullContent, data.tokensOut, streamSessionId);
              // Feed brainwave with estimated token count from this chunk
              if (isActiveStream()) brainwaveRef.current?.push(Math.ceil((data.content as string).length / 4));
              if (checkSpendLimits()) break;
            } else if (data.type === "tool_call") {
              if (isActiveStream()) setActiveTool(data.name as string);
            } else if (data.type === "tool_result") {
              // Delay clearing so the spinner is visible for at least 600ms.
              // Only clear if the tool hasn't changed (prevents race with a new tool_call).
              const finishedTool = data.name as string;
              if (isActiveStream()) setTimeout(() => {
                setActiveTool((current) => current === finishedTool ? null : current);
              }, 600);
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
                  sessionId: streamSessionId,
                });
                useMeterStore.getState().setMessageDecisionId(decId, streamSessionId);
                trackDecisionStaged({ decisionId: decId, title: d.title, projectId: streamSessionId });
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
                  }, streamSessionId);
                }
              }
              if (data.name === "fork_paths" && data.forkPaths) {
                const paths = data.forkPaths as { name: string }[];
                if (paths.length >= 2) {
                  // Store pending fork — will be executed after stream completes
                  pendingForkRef.current = paths.map((p) => p.name);
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
                  streamSessionId
                );
              }
            } else if (data.type === "rerouting") {
              if (isActiveStream()) setRerouting({ provider: data.provider as string, toModel: data.to as string });
            } else if (data.type === "error") {
              const errorPayload = JSON.stringify({ code: data.code, model: data.model });
              fullContent = `__error__${errorPayload}`;
              updateLastAssistantMessage(fullContent, 0, streamSessionId);
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
      } finally {
        document.removeEventListener("visibilitychange", handleVisibilityAbort);
      }

      // Persist debate trace to the message
      if (isDebateMode && localTrace.length > 0) {
        useMeterStore.getState().setDebateTrace(localTrace, streamSessionId);
        trackDebateCompleted({ projectId: streamSessionId, turnCount: localTrace.length });
        emitLogEvent("debate_completed", userId);
      }
      // Persist dissector trace to the message
      if (isDissectorMode && localDissTrace.length > 0) {
        useMeterStore.getState().setDissectorTrace(localDissTrace, streamSessionId);
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
          streamSessionId,
        );
      }
      // Immediately sync the finalized message to the server so it
      // survives a page refresh (don't wait for the 2s debounce).
      requestImmediateSync();
    } catch {
      // Abort or network error — persist whatever we have so far.
      // Partial responses are still billed upstream (industry standard).
      if (!receivedAnyContent && !finalUsage) {
        // Stream failed before any content arrived. Show an error in the
        // assistant message rather than leaving it empty or deleting it.
        const errorPayload = JSON.stringify({ code: "stream_failed", model: actualModelUsed ?? "unknown" });
        updateLastAssistantMessage(`__error__${errorPayload}`, 0, streamSessionId);
      } else {
        // Partial or complete response — persist what we have
        if (isDebateMode && localTrace.length > 0) {
          useMeterStore.getState().setDebateTrace(localTrace, streamSessionId);
        }
        if (isDissectorMode && localDissTrace.length > 0) {
          useMeterStore.getState().setDissectorTrace(localDissTrace, streamSessionId);
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
            streamSessionId,
          );
        }
        // Best-effort sync on error path too
        requestImmediateSync();
      }
    } finally {
      activeStreamsRef.current.delete(streamSessionId);
      abortControllersRef.current.delete(streamSessionId);
      // Always reset local UI state if this stream's session is still the viewed one
      if (useMeterStore.getState().activeSessionId === streamSessionId) {
        setActiveTool(null);
        setDebatePhase(null);
        setActiveDebateTurn(null);
        setDissectorPhase(null);
        setActiveDissectorTurn(null);
      }
      // Delay setStreaming(false) so the meter pill slot animation has
      // time to roll to the final cost value before locking.
      setTimeout(() => setStreaming(false, streamSessionId), 350);

      // Show fork confirmation form if the AI called fork_paths
      if (pendingForkRef.current && pendingForkRef.current.length >= 2) {
        const pathNames = pendingForkRef.current;
        pendingForkRef.current = null;
        setPendingForkNames(pathNames);
        setPendingForkSessionId(streamSessionId);
      }
    }
  };


  const handleSend = async () => {
    const input = inputRef.current;
    const hasText = input && input.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!input || (!hasText && !hasAttachments) || isStreaming || !workspaceCardReady) return;

    if (chatBlocked) {
      trackChatBlocked({ projectId: activeSessionId });
      const userContent = input.value.trim();
      input.value = "";
      input.style.height = "auto";
      localStorage.removeItem(DRAFT_KEY(activeSessionId));
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
      projectId: activeSessionId,
      hasAttachments: !!attachmentsToSend,
      attachmentCount: attachmentsToSend?.length ?? 0,
      messageLength: userContent.length,
    });
    emitLogEvent("message_sent", userId, { preview: userContent.slice(0, 120) });

    input.value = "";
    input.style.height = "auto";
    localStorage.removeItem(DRAFT_KEY(activeSessionId));
    setPendingAttachments([]);

    await streamResponse(userContent, undefined, attachmentsToSend);
  };

  /** Stop the current streaming response */
  const handleStop = () => {
    trackResponseStopped();
    // Abort the stream for the currently viewed session
    const currentSessionId = useMeterStore.getState().activeSessionId;
    const controller = abortControllersRef.current.get(currentSessionId);
    if (controller) {
      controller.abort();
    } else {
      // No active stream (e.g. stuck after refresh) — force reset
      setStreaming(false, currentSessionId);
    }
  };

  /** Triggered by the "Debate" button on a decision-point message */
  const handleDebate = async () => {
    if (isStreaming || !workspaceCardReady) return;
    trackDebateStarted({ projectId: activeSessionId });
    emitLogEvent("debate_started", userId);
    await streamResponse("Debate this.", "debate");
  };

  /** Triggered by "Reconcile all" on a sync report message */
  const runReconcileFromChat = () => {
    runReconcile();
  };

  /** Triggered by the "Dissect" button on a decision-point message */
  const handleDissect = async () => {
    if (isStreaming || !workspaceCardReady) return;
    trackDissectClicked({ projectId: activeSessionId });
    await streamResponse("Dissect this.", "dissect");
  };

  /** Triggered by "Explore paths" button — AI auto-names and creates paths.
   *  Always uses the standard model (never debate/dissect) regardless of toggle state. */
  handleForkPathsRef.current = async () => {
    if (isStreaming || !workspaceCardReady || isMainFrozen || isSubtrack) return;
    const forkModel = selectedModelId === "auto" ? "openai/gpt-5.4" : selectedModelId;
    await streamResponse("Fork this into paths.", forkModel);
  };
  const handleForkPaths = () => handleForkPathsRef.current();

  // Listen for manual "Explore paths" trigger from track-switcher dropdown
  useEffect(() => {
    const handler = () => { handleForkPathsRef.current(); };
    window.addEventListener("meter:explore-paths", handler);
    return () => window.removeEventListener("meter:explore-paths", handler);
  }, []);

  // Auto-analyze when switching to a fresh fork path
  handleAutoAnalyzeRef.current = async (name: string) => {
    if (isStreaming || !workspaceCardReady) return;
    await streamResponse(
      `Analyze the "${name}" pathway in detail. Cover the key trade-offs, risks, implementation specifics, and why this path might be the right choice.`
    );
  };
  // Listen for pending auto-analyze signals from track-switcher (sets ref, useEffect fires after session sync)
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent).detail?.name;
      if (name) pendingAutoAnalyzeNameRef.current = name;
    };
    window.addEventListener("meter:pending-auto-analyze", handler);
    return () => window.removeEventListener("meter:pending-auto-analyze", handler);
  }, []);

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
    trackDecideClicked({ projectId: activeSessionId });
    await streamResponse("Yes, log that as a decision.");
  };

  /** Save a document preview to the Documents folder (commit the artifact) */
  const handleSaveDocument = useCallback((messageId: string, docId: string) => {
    const store = useArtifactsStore.getState();
    store.commitArtifact(docId);
    useMeterStore.getState().markDocumentSaved(messageId, docId);
    // Refresh artifacts so the Documents tab picks up the change
    store.fetchArtifacts(resolveWorkspaceSessionId(activeSessionId));
  }, [activeSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When slash popover is open, forward navigation keys
    if (slashOpen && slashRef.current) {
      const consumed = slashRef.current.handleKey(e.key);
      if (consumed) { e.preventDefault(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
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
      if (v) localStorage.setItem(DRAFT_KEY(activeSessionId), v);
      else localStorage.removeItem(DRAFT_KEY(activeSessionId));
    }, 250);
  };

  const handleCommandSelect = useCallback((chatPrompt: string) => {
    if (!inputRef.current) return;
    trackSlashCommandUsed({ command: chatPrompt.slice(0, 50) });

    // /sync command — triggers the sync engine directly, not a chat message
    if (chatPrompt === "__SYNC__") {
      setSlashOpen(false);
      setSlashQuery("");
      // Import dynamically to avoid circular deps
      import("@/lib/sync-engine").then(({ runSync }) => runSync());
      return;
    }

    // Switch modes to match the command: /debate activates debate mode,
    // any other command drops back to discuss mode.
    const isDebateCommand = chatPrompt === "Debate this.";
    if (isDebateCommand && !useMeterStore.getState().debateMode) {
      useMeterStore.getState().toggleDebateMode();
    } else if (!isDebateCommand && useMeterStore.getState().debateMode) {
      useMeterStore.getState().setDebateMode(false);
    }

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
      initiateOAuthFlow(providerId, activeSessionId);
    }
    setSlashOpen(false);
    setSlashQuery("");
  }, [userId, activeSessionId]);

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
  const loggingOut = useMeterStore((s) => s.loggingOut);

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
    <div className="flex h-dvh overflow-hidden bg-background">
      <ProfileSettings open={profileOpen} onClose={() => setProfileOpen(false)} />
      {switchingSessionName && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="rounded-2xl border border-border bg-card px-8 py-6 text-center shadow-xl">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">Switching workspace</p>
            <p className="mt-2 text-xl text-foreground">{switchingSessionName}</p>
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
        className={`relative flex flex-1 flex-col min-w-0 transition-all duration-300 ${inspectorOpen && !isMobile ? "mr-[420px]" : ""}`}
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
            {logoMenuOpen && !isMobile && (
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
                  onClick={() => { resetUser(); logout(); }}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2.5 px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
                >
                  {loggingOut ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  )}
                  {loggingOut ? "Signing Out…" : "Sign Out"}
                </button>
              </div>
            )}
            <Drawer open={logoMenuOpen && isMobile} onOpenChange={(v) => { if (!v) setLogoMenuOpen(false); }}>
              <DrawerContent className="bg-card">
                <DrawerHeader>
                  <DrawerTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground/60">Menu</DrawerTitle>
                </DrawerHeader>
                <div className="px-4 pb-6 space-y-1">
                  <button
                    onClick={() => { setLogoMenuOpen(false); setProfileOpen(true); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 font-mono text-sm text-foreground transition-colors hover:bg-foreground/5"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Profile Settings
                  </button>
                  <div className="mx-3 h-px bg-border" />
                  <button
                    onClick={() => { resetUser(); logout(); }}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 font-mono text-sm text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
                  >
                    {loggingOut ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    )}
                    {loggingOut ? "Signing Out…" : "Sign Out"}
                  </button>
                </div>
              </DrawerContent>
            </Drawer>
          </div>
          <div className="relative flex items-center gap-2">
            {!isMobile && <SyncButton />}
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
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 min-w-0">
          {/* Skeleton while sessions load from server */}
          {!sessionsLoaded && messages.length === 0 ? (
            <ChatSkeleton />
          ) : (
          <div className="mx-auto max-w-2xl px-4 py-6 max-md:px-3 overflow-hidden">
            {/* ── First-workspace onboarding: welcome with ID → name → card → explainer ── */}
            {messages.length === 0 && !workspaceCardReady && !cardOnFile && onboardingStep === "name" && (
              <div className="mb-4">
                <div className="flex gap-3 justify-start">
                  <div className="relative max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed text-foreground">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Welcome to <strong>Meter</strong>. Your user ID is:</p>
                    </div>
                    {userHandle && (
                      <div className="my-3 flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-3">
                        <code className="flex-1 font-mono text-[15px] tracking-wider text-foreground">{userHandle}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(userHandle); setOnboardingIdCopied(true); setTimeout(() => setOnboardingIdCopied(false), 2000); }}
                          className={`shrink-0 rounded-md border border-border/50 bg-card/50 px-2 py-1 font-mono text-[10px] transition-colors ${onboardingIdCopied ? "text-emerald-500" : "text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}
                        >
                          {onboardingIdCopied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Passkey login is extremely robust and safe, and allows us to give you fully anonymized and private access to the top frontier models. Save your ID offline, in case you need to recover your account.</p>
                    </div>
                    <div className="mt-4 prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
                      <p>Name your workspace to get started.</p>
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
                      <p>Welcome to <strong>{activeSession?.name ?? "this workspace"}</strong>. Use your existing card or add a new one.</p>
                    </div>
                    <button
                      onClick={() => { trackCardAssignedToWorkspace({ projectId: activeSessionId }); setCardAssigned(activeSessionId); }}
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
                <p className="text-sm text-muted-foreground">What are you building in {activeSession?.name ?? "this workspace"}?</p>
                <p className="font-mono text-[10px] text-muted-foreground/40">Every model available. The meter runs in dollars.</p>
              </div>
            )}

            {activeSession?.loadingOlderMessages && (
              <div className="flex items-center justify-center py-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
              </div>
            )}
            {(renderLimit < allVisibleMessages.length || (activeSession?.hasOlderMessages && !activeSession?.loadingOlderMessages)) && (
              <div className="flex items-center justify-center py-2">
                <span className="text-[10px] text-muted-foreground/40">Scroll up for older messages</span>
              </div>
            )}

            {visibleMessages.map((msg, msgIdx) => {
              const isLastAssistant = msg.role === "assistant" && msgIdx === visibleMessages.length - 1;
              const displayContent = msg.role === "assistant" ? stripDecisionPoint(msg.content) : msg.content;
              const isDecisionPoint = hasDecisionPoint(msg.content);
              const isDissectPoint = hasDissectPoint(msg.content);
              const isForkPathsPoint = hasForkPathsPoint(msg.content);
              const showActionButtons = msg.role === "assistant"
                && (isDecisionPoint || isDissectPoint || isForkPathsPoint)
                && !msg.decisionId
                && !isStreaming;
              const actionVariant: "decision" | "dissect" | "fork" = isForkPathsPoint ? "fork" : isDecisionPoint ? "decision" : "dissect";
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
                  <div className={`flex gap-3 min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`relative rounded-xl px-4 py-3 text-sm leading-relaxed overflow-hidden max-w-[85%] md:max-w-[85%] max-md:max-w-[92%] ${msg.role === "user" ? "bg-foreground/[0.04] dark:bg-foreground/10 text-foreground" : "text-foreground"} ${msg.pinned ? "border-l-2 border-amber-500/40" : ""}`}>
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
                              <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 max-w-[320px] rounded-lg border border-border bg-foreground/5 px-3 py-2.5 hover:bg-foreground/10 transition-colors">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                                </svg>
                                <div className="min-w-0">
                                  <span className="block font-mono text-[11px] text-foreground/70 truncate">{att.name}</span>
                                  <span className="block font-mono text-[9px] text-muted-foreground/50">PDF · click to open</span>
                                </div>
                              </a>
                            ) : null
                          )}
                        </div>
                      )}

                      {msg.role === "assistant" && displayContent.startsWith("__error__") ? (
                        <ErrorCard payload={displayContent.slice("__error__".length)} />
                      ) : msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-a:text-blue-400 dark:prose-a:text-blue-400 prose-a:text-blue-600">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{displayContent}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}

                      {msg.role === "assistant" && msg.thinking && (
                        <details
                          open={isStreaming && msgIdx === visibleMessages.length - 1}
                          className="mt-2 text-[11px] text-muted-foreground/60"
                        >
                          <summary className="cursor-pointer font-mono hover:text-muted-foreground transition-colors">
                            {isStreaming && msgIdx === visibleMessages.length - 1 ? "Thinking" : "Show thinking"}
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
                          onFork={handleForkPaths}
                          disabled={isStreaming || isMainFrozen || isArchivedSubtrack}
                          forkDisabled={isMainFrozen || isSubtrack}
                        />
                      )}

                      {msg.role === "assistant" && msg.decisionId && (
                        <DecisionPill decisionId={msg.decisionId} onOpen={() => { trackInspectorToggled({ open: true }); setInspectorOpen(true); setInspectorTab("decisions"); }} />
                      )}
                      {msg.role === "assistant" && msg.id.startsWith("sync-report-") && (
                        <SyncReportActions onReconcile={() => {
                          runReconcileFromChat();
                        }} />
                      )}
                      {msg.role === "assistant" && <MessageFooter msg={msg} sessionId={activeSessionId} />}
                    </div>
                  </div>

                  {/* Fork point divider — shown on main when active subtracks exist, and on all subtracks at the fork boundary.
                      Derived from workspace store (forkMessageIds) so it survives refresh.
                      Also shown permanently for resolved forks (merged/closed) via isForkPoint flag. */}
                  {(forkMessageIds.has(msg.id) || (isSubtrack && forkMessageId === msg.id) || (msg.isForkPoint && !forkMessageIds.has(msg.id))) && <ForkPointDivider timestamp={msg.timestamp} />}

                  {/* Resolved fork divider — permanently marks where paths were merged or closed */}
                  {msg.isForkPoint && msg.forkResolution && <ResolvedForkDivider timestamp={msg.timestamp} resolution={msg.forkResolution} />}

                  {/* Branch divider — shown in subtracks at the fork boundary, after the fork divider */}
                  {isSubtrack && forkMessageId === msg.id && <BranchDivider timestamp={msg.timestamp} colorIndex={currentPathColorIndex} />}

                  {/* Merge-end divider — marks where merged path content ends */}
                  {msg.isMergeEnd && <MergeEndDivider />}
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
              onClose={() => { setSlashOpen(false); setSlashQuery(""); }}
            />

            {/* Fork confirmation form — shown when AI suggests paths */}
            {pendingForkNames && (
              <InlineForkForm
                pathNames={pendingForkNames}
                onConfirm={handleConfirmFork}
                onCancel={handleCancelFork}
              />
            )}

            {/* Stacked fork cards — active path card with siblings peeking behind */}
            {isSubtrack && !isArchivedSubtrack && currentWsTrack && (
              <StackedForkCards
                activeTrackName={currentWsTrack.name}
                activeColorIndex={currentPathColorIndex}
                siblingNames={siblingSubtracks.map((s) => s.name)}
                siblings={siblingCardsInfo}
                onCommit={handleCommitSubtrack}
                onReturnToMain={handleReturnToMain}
                onSwitchTrack={(id) => {
                  const track = wsTracks.find((t) => t.id === id);
                  if (track?.isSubtrack && track.forkMessageId) {
                    const session = useMeterStore.getState().sessions.find((s) => s.id === id);
                    if (session) {
                      const forkIdx = session.messages.findIndex((m) => m.id === track.forkMessageId);
                      const hasUserMessagesAfterFork = session.messages.slice(forkIdx + 1).some((m) => m.role === "user");
                      if (!hasUserMessagesAfterFork) {
                        pendingAutoAnalyzeNameRef.current = track.name;
                      }
                    }
                  }
                  setActiveTrackWs(id);
                }}
              />
            )}

            {/* Frozen main banner — replaces composer when main has active subtracks */}
            {isMainFrozen && !isSubtrack && (
              <FrozenMainBanner
                subtracks={activeSubtracks.map((s) => ({ id: s.id, name: s.name }))}
                onSelectTrack={(id) => {
                  // Check if this is a fresh subtrack (no user messages after fork point) — auto-analyze if so
                  const track = wsTracks.find((t) => t.id === id);
                  if (track?.isSubtrack && track.forkMessageId) {
                    const session = useMeterStore.getState().sessions.find((s) => s.id === id);
                    if (session) {
                      const forkIdx = session.messages.findIndex((m) => m.id === track.forkMessageId);
                      const hasUserMessagesAfterFork = session.messages.slice(forkIdx + 1).some((m) => m.role === "user");
                      if (!hasUserMessagesAfterFork) {
                        pendingAutoAnalyzeNameRef.current = track.name;
                      }
                    }
                  }
                  setActiveTrackWs(id);
                }}
                onCloseAll={handleCloseAllPaths}
              />
            )}

            {/* Archived subtrack banner — replaces composer for archived subtracks */}
            {isArchivedSubtrack && (
              <ArchivedSubtrackBanner committed={currentWsTrack?.committed} onReturnToMain={handleReturnToMain} />
            )}

            {/* Unified box — normal composer (hidden when frozen or archived) */}
            {!isMainFrozen && !isArchivedSubtrack && (
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
              {/* Model selector bar — top section */}
              <ModelSelectorBar
                open={modelPickerOpen}
                onToggle={() => setModelPickerOpen(!modelPickerOpen)}
                overrideModelId={rerouting?.toModel ?? null}
              />
              {/* Brainwave — AI activity pulse, colored by active model */}
              <Brainwave
                key={activeSessionId}
                handleRef={brainwaveRef}
                streaming={isStreaming}
                activeColor={
                  debateMode
                    ? DEBATE_MODEL.color
                    : getModel(rerouting?.toModel ?? selectedModelId).color
                }
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
                <div className="flex items-end gap-2 p-2">
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
            )}

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
