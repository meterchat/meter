"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";

/* ─── Relative time helper ──────────────────────────────────── */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── Decision Card ─────────────────────────────────────────── */
function DecisionCard({
  decision,
  onRevisit,
}: {
  decision: Decision;
  onRevisit: (d: Decision) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(decision.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { updateDecision, deleteDecision, resolveDecision, reopenDecision } = useDecisionsStore();

  const handleSaveTitle = () => {
    const title = editTitle.trim();
    if (title && title !== decision.title) {
      updateDecision(decision.id, { title });
    }
    setEditing(false);
  };

  const isDecided = decision.status === "decided";

  return (
    <div
      className={`group border-b border-border/30 last:border-b-0 ${isDecided ? "opacity-60" : ""}`}
    >
      {/* Collapsed row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot */}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isDecided ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />

        {/* Title */}
        <span className="flex-1 truncate font-mono text-[11px] text-foreground">
          {decision.title}
        </span>

        {/* Badge */}
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            isDecided
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {isDecided ? "decided" : "undecided"}
        </span>

        {/* Revisit button (hover only, decided items only) */}
        {isDecided && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRevisit(decision);
            }}
            className="hidden group-hover:flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
            title="Revisit this decision"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            revisit
          </button>
        )}

        {/* Time */}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
          {relativeTime(decision.updatedAt)}
        </span>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2">
              {/* Choice */}
              {decision.choice && (
                <div>
                  <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">
                    Choice
                  </div>
                  <div className="font-mono text-[11px] text-foreground">
                    {decision.choice}
                  </div>
                </div>
              )}

              {/* Alternatives */}
              {decision.alternatives && decision.alternatives.length > 0 && (
                <div>
                  <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">
                    Considered
                  </div>
                  <div className="space-y-0.5">
                    {decision.alternatives.map((alt, i) => (
                      <div key={i} className="font-mono text-[11px] text-muted-foreground/60">
                        {alt}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              {decision.reasoning && (
                <div>
                  <div className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">
                    Reasoning
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/80 leading-relaxed">
                    {decision.reasoning}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {/* Edit title */}
                {editing ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveTitle();
                        if (e.key === "Escape") { setEditing(false); setEditTitle(decision.title); }
                      }}
                      className="flex-1 rounded border border-border bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-foreground focus:outline-none"
                    />
                    <button onClick={handleSaveTitle} className="font-mono text-[10px] text-emerald-500 hover:text-emerald-400">
                      save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="font-mono text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    edit
                  </button>
                )}

                {/* Delete */}
                {confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] text-red-400">delete?</span>
                    <button
                      onClick={() => deleteDecision(decision.id)}
                      className="font-mono text-[10px] text-red-400 hover:text-red-300"
                    >
                      yes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="font-mono text-[10px] text-muted-foreground/50 hover:text-foreground"
                    >
                      no
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="font-mono text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors"
                  >
                    delete
                  </button>
                )}

                {/* Resolve / Reopen */}
                {isDecided ? (
                  <button
                    onClick={() => reopenDecision(decision.id)}
                    className="font-mono text-[10px] text-muted-foreground/50 hover:text-amber-500 transition-colors"
                  >
                    reopen
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const choice = prompt("What did you decide?");
                      if (choice) {
                        const reasoning = prompt("Why? (optional)") || undefined;
                        resolveDecision(decision.id, choice, reasoning);
                      }
                    }}
                    className="font-mono text-[10px] text-muted-foreground/50 hover:text-emerald-500 transition-colors"
                  >
                    resolve
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── New Decision Form ─────────────────────────────────────── */
function NewDecisionForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const addDecision = useDecisionsStore((s) => s.addDecision);

  const handleSubmit = () => {
    const t = title.trim();
    if (!t) return;
    addDecision({ title: t, status: "undecided" });
    setTitle("");
    onClose();
  };

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border/30">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="What needs deciding?"
        className="flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
      />
      <button
        onClick={handleSubmit}
        className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[10px] text-background hover:bg-foreground/90"
      >
        Add
      </button>
      <button
        onClick={onClose}
        className="font-mono text-[10px] text-muted-foreground/50 hover:text-foreground"
      >
        cancel
      </button>
    </div>
  );
}

/* ─── Main Panel ────────────────────────────────────────────── */
export function DecisionsPanel({
  onRevisit,
}: {
  onRevisit: (d: Decision) => void;
}) {
  const { decisions, panelOpen, filter, setFilter } = useDecisionsStore();
  const [showNewForm, setShowNewForm] = useState(false);

  const filtered = decisions
    .filter((d) => filter === "all" || d.status === filter)
    .sort((a, b) => {
      // Undecided first, then by updatedAt desc
      if (a.status !== b.status) return a.status === "undecided" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

  return (
    <AnimatePresence>
      {panelOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="overflow-hidden"
        >
          <div className="max-h-[50vh] overflow-y-auto border-t border-border/30">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilter("all")}
                  className={`font-mono text-[10px] transition-colors ${filter === "all" ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                >
                  all
                </button>
                <button
                  onClick={() => setFilter("undecided")}
                  className={`font-mono text-[10px] transition-colors ${filter === "undecided" ? "text-amber-500" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                >
                  open
                </button>
                <button
                  onClick={() => setFilter("decided")}
                  className={`font-mono text-[10px] transition-colors ${filter === "decided" ? "text-emerald-500" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                >
                  decided
                </button>
              </div>
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                new
              </button>
            </div>

            {/* New decision form */}
            {showNewForm && <NewDecisionForm onClose={() => setShowNewForm(false)} />}

            {/* Decision list */}
            {filtered.length === 0 && !showNewForm && (
              <div className="px-3 py-6 text-center">
                <div className="font-mono text-[11px] text-muted-foreground/30">
                  No decisions yet
                </div>
                <div className="font-mono text-[10px] text-muted-foreground/20 mt-1">
                  Decisions are logged as you chat
                </div>
              </div>
            )}

            {filtered.map((d) => (
              <DecisionCard key={d.id} decision={d} onRevisit={onRevisit} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
