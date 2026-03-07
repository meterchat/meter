"use client";

import { useState, useEffect, useRef } from "react";
import { useMeterStore, selectConnectedServices } from "@/lib/store";
import { CONNECTORS, type ConnectorDef } from "@/lib/connectors";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import {
  trackCommandBarToggled,
  trackConnectorInitiated,
  trackConnectorDisconnected,
} from "@/lib/analytics";

interface CommandBarProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  onSelectCommand: (prompt: string) => void;
}

export function CommandBar({ open, onToggle, onSelectCommand }: CommandBarProps) {
  const connectedServices = useMeterStore(selectConnectedServices);
  const userId = useMeterStore((s) => s.userId);
  const activeSessionId = useMeterStore((s) => s.activeSessionId);
  const disconnectServiceRemote = useMeterStore((s) => s.disconnectServiceRemote);

  const [drilledConnector, setDrilledConnector] = useState<ConnectorDef | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset drill-down when panel closes
  useEffect(() => {
    if (!open) setDrilledConnector(null);
  }, [open]);

  // Close on click outside the composer card
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const card = containerRef.current?.closest(".rounded-xl");
      if (card && !card.contains(e.target as Node)) {
        onToggle(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onToggle]);

  function handleToggleClick() {
    const willOpen = !open;
    trackCommandBarToggled({ open: willOpen });
    onToggle(willOpen);
    if (willOpen) {
      requestAnimationFrame(() => {
        const anchor = document.querySelector("[data-scroll-anchor]");
        anchor?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  function handleConnect(providerId: string) {
    if (!userId) return;
    trackConnectorInitiated({ provider: providerId, method: isApiKeyProvider(providerId) ? "api_key" : "oauth" });
    if (isApiKeyProvider(providerId)) {
      setApiKeyProvider(providerId);
    } else {
      initiateOAuthFlow(providerId, activeSessionId);
    }
  }

  return (
    <div ref={containerRef}>
      {/* Trigger bar */}
      <button
        onClick={handleToggleClick}
        className="flex w-full items-center gap-2 bg-foreground/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground/80 hover:bg-foreground/5"
      >
        Connections
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Panel content */}
      {open && (
        <div className="border-t border-border/50 bg-foreground/[0.03]">
          {drilledConnector ? (
            /* ─── Drill-down: single connector's commands ─── */
            <DrillDownView
              connector={drilledConnector}
              connected={!!connectedServices[drilledConnector.id]}
              onBack={() => setDrilledConnector(null)}
              onSelectCommand={(prompt) => {
                onSelectCommand(prompt);
                onToggle(false);
              }}
              onConnect={handleConnect}
              onDisconnect={disconnectServiceRemote}
            />
          ) : (
            /* ─── Connector list ─── */
            <div className="py-0.5">
              {CONNECTORS.map((connector) => {
                const connected = !!connectedServices[connector.id];
                return (
                  <button
                    key={connector.id}
                    onClick={() => setDrilledConnector(connector)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-foreground/5 transition-colors"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-muted-foreground shrink-0"
                    >
                      <path d={connector.iconPath} />
                    </svg>
                    <span className="text-[13px] text-foreground shrink-0">{connector.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/40 truncate">
                      {connector.description}
                    </span>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      {connected ? (
                        <>
                          <span className="font-mono text-[11px] text-emerald-500">Connected</span>
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              trackConnectorDisconnected({ provider: connector.id }); disconnectServiceRemote(connector.id);
                            }}
                            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                            title="Disconnect"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </span>
                        </>
                      ) : (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConnect(connector.id);
                          }}
                          className="rounded-md border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                        >
                          Connect
                        </span>
                      )}
                    </div>
                    <svg
                      width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="shrink-0 text-muted-foreground/30"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {apiKeyProvider && (
        <ApiKeyDialog
          provider={apiKeyProvider}
          onClose={() => setApiKeyProvider(null)}
        />
      )}
    </div>
  );
}

/* ─── Drill-down view: back button + commands ─── */

function DrillDownView({
  connector,
  connected,
  onBack,
  onSelectCommand,
  onConnect,
  onDisconnect,
}: {
  connector: ConnectorDef;
  connected: boolean;
  onBack: () => void;
  onSelectCommand: (prompt: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}) {
  return (
    <div className="py-0.5">
      {/* Back button + connector header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <span className="text-muted-foreground/30">|</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground shrink-0">
          <path d={connector.iconPath} />
        </svg>
        <span className="text-[12px] text-foreground">{connector.name}</span>
        {connected && (
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="font-mono text-[10px] text-emerald-500">Connected</span>
            <span
              role="button"
              onClick={() => onDisconnect(connector.id)}
              className="text-muted-foreground/40 hover:text-red-400 transition-colors"
              title="Disconnect"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          </div>
        )}
      </div>

      {/* Command list */}
      {connector.tools.map((tool) => (
        connected ? (
          <button
            key={tool.function.name}
            onClick={() => onSelectCommand(tool.chatPrompt)}
            className="flex w-full items-center gap-2 px-3 py-1.5 pl-10 text-left hover:bg-foreground/5 transition-colors"
          >
            <span className="font-mono text-[11px] text-foreground/80">
              {tool.commandLabel}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/30 truncate">
              {tool.function.description}
            </span>
          </button>
        ) : (
          <div
            key={tool.function.name}
            className="flex items-center gap-2 px-3 py-1.5 pl-10 opacity-40 cursor-not-allowed"
          >
            <span className="font-mono text-[11px] text-foreground/80">
              {tool.commandLabel}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/30 truncate">
              {tool.function.description}
            </span>
          </div>
        )
      ))}

      {/* Connect prompt for disconnected services */}
      {!connected && (
        <div className="flex items-center justify-between px-3 py-2 pl-10 border-t border-border/30">
          <span className="font-mono text-[10px] text-muted-foreground/50">
            Connect to use these commands
          </span>
          <button
            onClick={() => onConnect(connector.id)}
            className="rounded-md border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            Connect {connector.name}
          </button>
        </div>
      )}
    </div>
  );
}
