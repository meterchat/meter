"use client";

import { useState, useEffect, useCallback, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import { SLASH_COMMANDS } from "@/lib/connectors";

export interface SlashCommandHandle {
  handleKey: (key: string) => boolean;
}

interface FlatCommand {
  connectorId: string;
  connectorName: string;
  connectorIcon: string;
  commandLabel: string;
  chatPrompt: string;
  description: string;
  connected: boolean;
  /** Top-level slash commands get special treatment */
  isSlashCommand?: boolean;
}

interface SlashCommandPopoverProps {
  open: boolean;
  query: string;
  connectedServices: Record<string, boolean>;
  onSelect: (chatPrompt: string) => void;
  onConnect: (providerId: string) => void;
  onFile: () => void;
  onClose: () => void;
}

export const SlashCommandPopover = forwardRef<SlashCommandHandle, SlashCommandPopoverProps>(
  function SlashCommandPopover({ open, query, connectedServices, onSelect, onConnect, onFile, onClose }, ref) {
    const [highlightIndex, setHighlightIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Click outside to close
    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [open, onClose]);

    // Top-level slash commands (/debate, /decide, /fork, etc.)
    const allCommands: FlatCommand[] = useMemo(() =>
      SLASH_COMMANDS.map((sc) => ({
        connectorId: sc.connectorId,
        connectorName: sc.label,
        connectorIcon: sc.iconPath,
        commandLabel: sc.label,
        chatPrompt: sc.chatPrompt,
        description: sc.command,
        connected: sc.connectorId === "_builtin" || !!connectedServices[sc.connectorId],
        isSlashCommand: true,
      })),
      [connectedServices]
    );

    // Filter by query (matches connector name, command label, or description)
    const filtered = useMemo(() => {
      if (!query) return allCommands;
      const q = query.toLowerCase();
      return allCommands.filter((cmd) =>
        cmd.connectorName.toLowerCase().includes(q) ||
        cmd.commandLabel.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
      );
    }, [allCommands, query]);

    // Reset highlight when query changes or popover opens/closes
    useEffect(() => {
      setHighlightIndex(0);
    }, [query, open]);

    // Keep highlight in bounds
    useEffect(() => {
      if (highlightIndex >= filtered.length) {
        setHighlightIndex(Math.max(0, filtered.length - 1));
      }
    }, [highlightIndex, filtered.length]);

    // Scroll highlighted item into view
    useEffect(() => {
      if (!listRef.current) return;
      const el = listRef.current.querySelector("[data-highlighted]");
      el?.scrollIntoView({ block: "nearest" });
    }, [highlightIndex]);

    const handleSelect = useCallback((index: number) => {
      const cmd = filtered[index];
      if (!cmd) return;
      if (cmd.connected) {
        onSelect(cmd.chatPrompt);
      } else {
        onConnect(cmd.connectorId);
      }
    }, [filtered, onSelect, onConnect]);

    // Expose keyboard handler to parent
    useImperativeHandle(ref, () => ({
      handleKey(key: string): boolean {
        if (!open) return false;
        const count = Math.max(1, filtered.length);
        switch (key) {
          case "ArrowDown":
            setHighlightIndex((i) => (i + 1) % count);
            return true;
          case "ArrowUp":
            setHighlightIndex((i) => (i - 1 + count) % count);
            return true;
          case "Enter":
            handleSelect(highlightIndex);
            return true;
          case "Escape":
            onClose();
            return true;
          default:
            return false;
        }
      },
    }), [open, filtered.length, highlightIndex, handleSelect, onClose]);

    if (!open || filtered.length === 0) return null;

    return (
      <div ref={popoverRef} className="absolute bottom-full left-0 right-0 mb-1 z-50">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {query ? `/${query}` : "/ Commands"}
              </span>
              <span className="ml-auto font-mono text-[9px] text-muted-foreground/30">
                {filtered.length} command{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Command list */}
            <div ref={listRef} className="max-h-[280px] overflow-y-auto py-0.5">
              {filtered.map((cmd, idx) => (
                <button
                  key={cmd.commandLabel}
                  data-highlighted={idx === highlightIndex ? "" : undefined}
                  onClick={() => handleSelect(idx)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                    idx === highlightIndex ? "bg-foreground/5" : "hover:bg-foreground/[0.03]"
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60 shrink-0">
                    <path d={cmd.connectorIcon} />
                  </svg>
                  <span className="font-mono text-[11px] text-foreground/80 shrink-0 font-semibold">
                    {cmd.commandLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
