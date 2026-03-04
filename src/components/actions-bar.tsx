"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMeterStore } from "@/lib/store";

export function ActionsBar() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const projects = useMeterStore((s) => s.projects);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const approveCard = useMeterStore((s) => s.approveCard);
  const rejectCard = useMeterStore((s) => s.rejectCard);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  // Pending approvals from meter agent (action cards)
  const pendingApprovals = useMemo(() => {
    const actions: Array<{ messageId: string; card: { id: string; title: string; description: string; cost?: number; status: string } }> = [];
    if (!activeProject) return actions;
    for (const msg of activeProject.messages) {
      if (!msg.cards) continue;
      for (const c of msg.cards) {
        if (c.status === "pending") {
          actions.push({ messageId: msg.id, card: c });
        }
      }
    }
    return actions;
  }, [activeProject]);

  // Follow-ups identified from Gmail (from assistant messages mentioning follow-ups)
  const followUps = useMemo(() => {
    if (!activeProject) return [];
    const items: Array<{ id: string; text: string }> = [];
    for (const msg of activeProject.messages) {
      if (msg.role !== "assistant" || !msg.content) continue;
      // Look for follow-up markers the AI leaves in responses
      const followUpMatch = msg.content.match(/\[follow-up\]([\s\S]*?)\[\/follow-up\]/g);
      if (followUpMatch) {
        for (const match of followUpMatch) {
          const text = match.replace(/\[\/?follow-up\]/g, "").trim();
          if (text) items.push({ id: `fu-${msg.id}-${items.length}`, text });
        }
      }
    }
    return items;
  }, [activeProject]);

  // Pending subscriptions (from assistant messages)
  const pendingSubscriptions = useMemo(() => {
    if (!activeProject) return [];
    const items: Array<{ id: string; text: string }> = [];
    for (const msg of activeProject.messages) {
      if (msg.role !== "assistant" || !msg.content) continue;
      const subMatch = msg.content.match(/\[subscription\]([\s\S]*?)\[\/subscription\]/g);
      if (subMatch) {
        for (const match of subMatch) {
          const text = match.replace(/\[\/?subscription\]/g, "").trim();
          if (text) items.push({ id: `sub-${msg.id}-${items.length}`, text });
        }
      }
    }
    return items;
  }, [activeProject]);

  // Pending purchases (from assistant messages)
  const pendingPurchases = useMemo(() => {
    if (!activeProject) return [];
    const items: Array<{ id: string; text: string }> = [];
    for (const msg of activeProject.messages) {
      if (msg.role !== "assistant" || !msg.content) continue;
      const purchaseMatch = msg.content.match(/\[purchase\]([\s\S]*?)\[\/purchase\]/g);
      if (purchaseMatch) {
        for (const match of purchaseMatch) {
          const text = match.replace(/\[\/?purchase\]/g, "").trim();
          if (text) items.push({ id: `pur-${msg.id}-${items.length}`, text });
        }
      }
    }
    return items;
  }, [activeProject]);

  const totalPending = pendingApprovals.length + followUps.length + pendingSubscriptions.length + pendingPurchases.length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-foreground/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground/80"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Review
        {totalPending > 0 && (
          <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500/20 px-1 font-mono text-[9px] text-amber-400">
            {totalPending}
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`ml-1 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border/50 bg-foreground/[0.03] py-1">
          {followUps.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                Follow-ups
              </div>
              <div className="space-y-1">
                {followUps.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    <span className="font-mono text-[11px] text-foreground/80 leading-relaxed">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingSubscriptions.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                Pending Subscriptions
              </div>
              <div className="space-y-1">
                {pendingSubscriptions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span className="font-mono text-[11px] text-foreground/80 leading-relaxed">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingPurchases.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                Pending Purchases
              </div>
              <div className="space-y-1">
                {pendingPurchases.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                    <span className="font-mono text-[11px] text-foreground/80 leading-relaxed">{p.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingApprovals.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                Approvals
              </div>
              <div className="space-y-2">
                {pendingApprovals.map(({ messageId, card }) => (
                  <div key={card.id} className="rounded-lg border border-border/50 p-2.5 bg-background/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-foreground truncate">{card.title}</p>
                        <p className="font-mono text-[10px] text-muted-foreground/50 truncate">{card.description}</p>
                      </div>
                      {card.cost != null && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">${card.cost.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={() => { approveCard(messageId, card.id); }}
                        className="flex-1 rounded-md bg-emerald-500/10 py-1 font-mono text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/20"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { rejectCard(messageId, card.id); }}
                        className="flex-1 rounded-md bg-red-500/10 py-1 font-mono text-[10px] text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalPending === 0 && (
            <div className="px-3 py-4 text-center">
              <p className="font-mono text-[11px] text-muted-foreground/40">Nothing to review</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/30">
                Follow-ups, subscriptions, purchases, and approvals appear here
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
