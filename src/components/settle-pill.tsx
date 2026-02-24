"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMeterStore } from "@/lib/store";
import { posthog } from "@/lib/posthog";

export function SettlePill() {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const projects = useMeterStore((s) => s.projects);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const pendingCharges = useMeterStore((s) => s.pendingCharges);
  const isSettling = useMeterStore((s) => s.isSettling);
  const settleAll = useMeterStore((s) => s.settleAll);
  const cardLast4 = useMeterStore((s) => s.cardLast4);
  const cardBrand = useMeterStore((s) => s.cardBrand);
  const clearSettlementError = useMeterStore((s) => s.clearSettlementError);
  const accountType = useMeterStore((s) => s.accountType);

  const isSuperAdmin = accountType === "superadmin";

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const settlementError = activeProject?.settlementError ?? null;

  const pendingBalance = useMemo(() => {
    if (!activeProject) return 0;
    const msgCost = activeProject.messages
      .filter((m) => m.role === "assistant" && m.cost !== undefined && !m.settled)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const cardCost = pendingCharges
      .filter((c) => c.workspaceId === activeProject.id)
      .reduce((sum, c) => sum + c.cost, 0);
    return msgCost + cardCost;
  }, [activeProject, pendingCharges]);

  // For superadmin, calculate total cost (all messages, settled or not)
  const totalCost = useMemo(() => {
    if (!activeProject) return 0;
    return activeProject.messages
      .filter((m) => m.role === "assistant" && m.cost !== undefined)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
  }, [activeProject]);

  const lineItems = useMemo(() => {
    const unsettledMsgs = activeProject
      ? activeProject.messages.filter(
          (m) => m.role === "assistant" && m.cost !== undefined && !m.settled
        )
      : [];
    const totalMsgCost = unsettledMsgs.reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const msgCount = unsettledMsgs.length;

    const items: {
      id: string;
      title: string;
      subtitle: string;
      cost: number;
      type: "usage" | "card";
      paidAt?: number;
    }[] = [];

    if (msgCount > 0) {
      items.push({
        id: "ai-usage-grouped",
        title: "Metered AI Usage",
        subtitle: `${msgCount} message${msgCount !== 1 ? "s" : ""}`,
        cost: totalMsgCost,
        type: "usage",
      });
    }

    for (const c of pendingCharges.filter((c) => c.workspaceId === activeProject?.id)) {
      items.push({
        id: c.id,
        title: c.title,
        subtitle: "",
        cost: c.cost,
        type: "card",
        paidAt: c.paidAt,
      });
    }

    return items;
  }, [activeProject, pendingCharges]);

  const handleSettle = async () => {
    posthog.capture("settlement_initiated", { amount: pendingBalance });
    const result = await settleAll();
    if (result.success) {
      posthog.capture("settlement_completed", { amount: pendingBalance });
      setSettled(true);
      setTimeout(() => {
        setSettled(false);
        setOpen(false);
      }, 1200);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    if (settlementError) clearSettlementError();
    setOpen((v) => !v);
  };

  const brandLabel = cardBrand
    ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)
    : "Card";

  const hasError = !!settlementError;

  // ── Superadmin pill: shows running total with "Creator" badge ──
  if (isSuperAdmin) {
    const displayCost = totalCost || pendingBalance;
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={handleOpen}
          className="flex h-8 items-center rounded-lg border border-amber-500/20 bg-amber-500/5 transition-colors font-mono text-[11px]"
        >
          <span className="px-2.5 tabular-nums text-foreground">
            ${displayCost.toFixed(2)}
          </span>
          <span className="h-4 w-px bg-amber-500/20" />
          <span className="px-2.5 text-amber-400">
            Creator
          </span>
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-[340px] rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400/60">
                Creator Account
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto">
              {lineItems.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className="font-mono text-[11px] text-muted-foreground/40">
                    No usage yet
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {lineItems.map((item) => (
                    <div key={item.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <span className="block truncate font-mono text-[11px] text-foreground/80">
                            {item.title}
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground/40">
                            {item.subtitle}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
                          ${item.cost.toFixed(item.cost < 0.01 ? 4 : 2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-muted-foreground">Running Total</span>
                <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                  ${displayCost.toFixed(2)}
                </span>
              </div>
              <div className="text-center font-mono text-[9px] text-amber-400/50">
                Settlement waived — creator account
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Standard user pill ──
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className={`flex h-8 items-center rounded-lg border transition-colors font-mono text-[11px] ${
          settled
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : hasError
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : pendingBalance > 0
                ? "border-border hover:border-foreground/20"
                : "border-border text-muted-foreground"
        }`}
      >
        <span className="px-2.5 tabular-nums text-foreground">
          ${pendingBalance.toFixed(2)}
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="px-2.5 text-muted-foreground hover:text-foreground transition-colors">
          {settled ? "Settled" : hasError ? "Failed" : isSettling ? "Settling..." : "Settle"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Pending Charges
            </div>
          </div>

          <div className="max-h-[280px] overflow-y-auto">
            {lineItems.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-muted-foreground/40">
                  No pending charges
                </span>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {lineItems.map((item) => (
                  <div key={item.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-foreground/80">
                          {item.title}
                        </span>
                        <span className="font-mono text-[9px] text-muted-foreground/40">
                          {item.subtitle}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
                        ${item.cost.toFixed(item.cost < 0.01 ? 4 : 2)}
                      </span>
                    </div>
                    {item.type === "card" && (
                      <div className="mt-1 font-mono text-[9px] text-muted-foreground/50">
                        Paid{item.paidAt ? ` on ${new Date(item.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} with Virtual Card{cardLast4 ? ` ${cardLast4}` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-muted-foreground">Total</span>
              <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                ${pendingBalance.toFixed(2)}
              </span>
            </div>

            {settlementError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                <span className="font-mono text-[10px] text-red-400">{settlementError}</span>
                <p className="mt-1 font-mono text-[9px] text-red-400/60">
                  Please update your card or try again.
                </p>
              </div>
            )}

            <button
              onClick={handleSettle}
              disabled={isSettling || pendingBalance <= 0}
              className={`w-full rounded-lg py-2 font-mono text-[11px] transition-colors ${
                settled
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
              }`}
            >
              {settled
                ? "Settled"
                : isSettling
                  ? "Processing..."
                  : `Pay & Settle $${pendingBalance.toFixed(2)}`}
            </button>

            {cardLast4 && (
              <div className="text-center font-mono text-[9px] text-muted-foreground/40">
                Charged to {brandLabel} {cardLast4}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
