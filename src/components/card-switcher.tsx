"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useMeterStore } from "@/lib/store";
import { trackCardDefaultChanged } from "@/lib/analytics";

export function CardSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cards = useMeterStore((s) => s.cards);
  const cardsLoading = useMeterStore((s) => s.cardsLoading);
  const fetchCards = useMeterStore((s) => s.fetchCards);
  const setDefaultCard = useMeterStore((s) => s.setDefaultCard);
  const cardLast4 = useMeterStore((s) => s.cardLast4);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (cards.length === 0 && !cardsLoading) {
      fetchCards();
    }
  }, [open, cards.length, cardsLoading, fetchCards]);

  const defaultCard = useMemo(
    () => cards.find((c) => c.isDefault) ?? cards[0] ?? null,
    [cards]
  );

  const displayLast4 = defaultCard?.last4 ?? cardLast4;

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 font-mono text-[11px] transition-colors ${displayLast4 ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        <span>{displayLast4 ?? "••••"}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-56 rounded-md border border-border bg-popover p-2 shadow-md z-50">
          <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">
            Cards
          </div>
          {cardsLoading && cards.length === 0 ? (
            <div className="px-2 py-2 font-mono text-[10px] text-muted-foreground/40">
              Loading cards...
            </div>
          ) : cards.length === 0 ? (
            <div className="px-2 py-2 font-mono text-[10px] text-muted-foreground/40">
              No cards on file
            </div>
          ) : (
            <div className="space-y-1">
              {cards.map((card) => {
                const brandLabel = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
                return (
                  <button
                    key={card.id}
                    onClick={() => { if (!card.isDefault) { trackCardDefaultChanged({ cardId: card.id }); setDefaultCard(card.id); } }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
                      card.isDefault ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${card.isDefault ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <span className="tabular-nums">{card.last4}</span>
                    <span className="text-[10px] text-muted-foreground/60">{brandLabel}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60">
                      {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
