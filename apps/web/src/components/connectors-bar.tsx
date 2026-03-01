"use client";

import { useState, useEffect, useRef } from "react";
import { useMeterStore, selectConnectedServices } from "@/lib/store";
import { CONNECTORS } from "@/lib/connectors";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { ApiKeyDialog } from "@/components/api-key-dialog";

export function ConnectorsBar() {
  const connectedServices = useMeterStore(selectConnectedServices);
  const userId = useMeterStore((s) => s.userId);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const disconnectServiceRemote = useMeterStore((s) => s.disconnectServiceRemote);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside the composer card
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const card = containerRef.current?.closest(".rounded-xl");
      if (card && !card.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    // When expanding, scroll chat to bottom so it visibly pushes up
    if (willOpen) {
      requestAnimationFrame(() => {
        const anchor = document.querySelector("[data-scroll-anchor]");
        anchor?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  function handleConnect(providerId: string) {
    if (!userId) return;
    if (isApiKeyProvider(providerId)) {
      setApiKeyProvider(providerId);
    } else {
      initiateOAuthFlow(providerId, activeProjectId);
    }
  }

  return (
    <div ref={containerRef}>
      {/* Trigger bar */}
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-1.5 bg-foreground/[0.03] px-3 py-2 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider hover:text-muted-foreground/80 transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Connections
      </button>

      {/* Expanded connector list */}
      {open && (
        <div className="border-t border-border/50 bg-foreground/[0.03] py-0.5">
          {CONNECTORS.map((connector) => {
            const connected = !!connectedServices[connector.id];
            return (
              <div
                key={connector.id}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-foreground/5 transition-colors"
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
                <div className="ml-auto shrink-0">
                  {connected ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-emerald-500">
                        Connected
                      </span>
                      <button
                        onClick={() => disconnectServiceRemote(connector.id)}
                        className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                        title="Disconnect"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnect(connector.id)}
                      className="rounded-md border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
