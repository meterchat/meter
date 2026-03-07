"use client";

import { useState, useEffect, useCallback, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import { CONNECTORS, SLASH_COMMANDS } from "@/lib/connectors";

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

    // Built-in "Add file" command — always first
    const fileCommand: FlatCommand = {
      connectorId: "__file__",
      connectorName: "Built-in",
      connectorIcon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6",
      commandLabel: "Add file",
      chatPrompt: "",
      description: "Attach an image or PDF to the conversation",
      connected: true,
    };

    // Top-level slash commands (/debate, /decide, /fork, etc.)
    const slashCommands: FlatCommand[] = useMemo(() =>
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

    // Connector sub-commands
    const connectorCommands: FlatCommand[] = useMemo(() =>
      CONNECTORS.flatMap((c) =>
        c.tools.map((t) => ({
          connectorId: c.id,
          connectorName: c.name,
          connectorIcon: c.iconPath,
          commandLabel: t.commandLabel,
          chatPrompt: t.chatPrompt,
          description: t.function.description,
          connected: !!connectedServices[c.id],
        }))
      ),
      [connectedServices]
    );

    // Build flat command list: file, slash commands, then connector tools
    const allCommands: FlatCommand[] = useMemo(() => [
      fileCommand,
      ...slashCommands,
      ...connectorCommands,
    ],
      [slashCommands, connectorCommands] // eslint-disable-line react-hooks/exhaustive-deps
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
      if (cmd.connectorId === "__file__") {
        onFile();
        return;
      }
      if (cmd.connected) {
        onSelect(cmd.chatPrompt);
      } else {
        onConnect(cmd.connectorId);
      }
    }, [filtered, onSelect, onConnect, onFile]);

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

    // Split into slash commands and regular commands for rendering
    const slashSection = filtered.filter((c) => c.isSlashCommand);
    const otherSection = filtered.filter((c) => !c.isSlashCommand);

    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
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
              {/* Slash commands section */}
              {slashSection.length > 0 && (
                <>
                  {slashSection.map((cmd) => {
                    const globalIdx = filtered.indexOf(cmd);
                    return (
                      <button
                        key={`slash-${cmd.commandLabel}`}
                        data-highlighted={globalIdx === highlightIndex ? "" : undefined}
                        onClick={() => handleSelect(globalIdx)}
                        onMouseEnter={() => setHighlightIndex(globalIdx)}
                        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                          globalIdx === highlightIndex ? "bg-foreground/5" : "hover:bg-foreground/[0.03]"
                        } ${!cmd.connected ? "opacity-60" : ""}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60 shrink-0">
                          <path d={cmd.connectorIcon} />
                        </svg>
                        <span className="font-mono text-[11px] text-foreground/80 shrink-0 font-semibold">
                          {cmd.commandLabel}
                        </span>
                      </button>
                    );
                  })}
                  {otherSection.length > 0 && (
                    <div className="mx-3 my-0.5 border-t border-border/30" />
                  )}
                </>
              )}

              {/* Regular commands */}
              {otherSection.map((cmd) => {
                const globalIdx = filtered.indexOf(cmd);
                return (
                  <button
                    key={`${cmd.connectorId}-${cmd.commandLabel}`}
                    data-highlighted={globalIdx === highlightIndex ? "" : undefined}
                    onClick={() => handleSelect(globalIdx)}
                    onMouseEnter={() => setHighlightIndex(globalIdx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                      globalIdx === highlightIndex ? "bg-foreground/5" : "hover:bg-foreground/[0.03]"
                    } ${!cmd.connected ? "opacity-60" : ""}`}
                  >
                    {cmd.connectorId === "__file__" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60 shrink-0">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/60 shrink-0">
                        <path d={cmd.connectorIcon} />
                      </svg>
                    )}
                    <span className="font-mono text-[11px] text-foreground/80 shrink-0">
                      {cmd.commandLabel}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/30 shrink-0">
                      {cmd.connectorName}
                    </span>
                    <div className="ml-auto shrink-0">
                      {cmd.connected ? (
                        <span className="font-mono text-[9px] text-emerald-500/50">
                          ready
                        </span>
                      ) : (
                        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                          connect
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
