"use client";

import { useState, useRef, useEffect } from "react";
import { useWorkspaceStore, Workspace } from "@/lib/workspace-store";
import { useMeterStore } from "@/lib/store";
import { trackWorkspaceCreated, trackWorkspaceSwitched } from "@/lib/analytics";

interface WorkspaceSwitcherProps {
  activeWorkspace: Workspace | null;
}

export function WorkspaceSwitcher({ activeWorkspace }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const addSession = useMeterStore((s) => s.addSession);
  const setActiveSession = useMeterStore((s) => s.setActiveSession);
  const chatSessions = useMeterStore((s) => s.sessions);
  const sessionsLoaded = useMeterStore((s) => s.sessionsLoaded);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const [switchingName, setSwitchingName] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);

  const ensureSession = (sessionId: string, name: string) => {
    if (!chatSessions.some((p) => p.id === sessionId)) {
      addSession(name, sessionId);
    }
  };

  const switchToChatThread = (sessionId: string, name: string) => {
    ensureSession(sessionId, name);
    // Show splash with animated log lines
    setSwitchingName(name);
    setLogLines([]);
    setActiveSession(sessionId);

    const lines = [
      `loading workspace "${name}"...`,
      "resolving environment variables",
      "connecting to session store",
      "hydrating chat history",
      "ready",
    ];
    lines.forEach((line, i) => {
      setTimeout(() => setLogLines((prev) => [...prev, line]), 120 * (i + 1));
    });
    setTimeout(() => {
      setSwitchingName(null);
      setLogLines([]);
    }, 120 * lines.length + 500);
  };

  const setDebateMode = useMeterStore((s) => s.setDebateMode);

  const handleSelect = (id: string) => {
    if (id === activeWorkspace?.id) {
      setOpen(false);
      return;
    }
    const workspace = workspaces.find((w) => w.id === id);
    setActiveWorkspace(id);
    setDebateMode(false);
    setOpen(false);
    if (workspace) {
      trackWorkspaceSwitched({ workspaceId: workspace.id, workspaceName: workspace.name });
      const sessionId = workspace.sessionId ?? workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      switchToChatThread(sessionId, workspace.name);
    }
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const sessionId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    createWorkspace(name, sessionId);
    trackWorkspaceCreated({ name, source: "switcher" });
    switchToChatThread(sessionId, name);
    setNewName("");
    setCreating(false);
    setOpen(false);
  };

  return (
    <>
    {switchingName && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/90 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl border border-border bg-card px-8 py-6 text-center shadow-xl">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">Switching workspace</p>
            <p className="mt-2 text-xl text-foreground">{switchingName}</p>
          </div>
          <div className="flex flex-col items-start gap-0.5 font-mono text-[10px] text-muted-foreground/50">
            {logLines.map((line, i) => (
              <span key={i} className="animate-[fadeIn_0.15s_ease-out]">
                <span className="text-muted-foreground/30 mr-1.5">&gt;</span>
                {line}
              </span>
            ))}
          </div>
        </div>
      </div>
    )}
    <div ref={ref} className="relative">
      <button
        onClick={() => { if (sessionsLoaded) setOpen(!open); }}
        disabled={!sessionsLoaded}
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-wait"
      >
        <span>{!sessionsLoaded ? "Loading..." : activeWorkspace?.name ?? "No workspace"}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-md border border-border bg-popover p-2 shadow-md z-50">
          <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">
            Workspaces
          </div>
          {workspaces.length === 0 && !creating && (
            <div className="px-2 py-3 text-center font-mono text-[11px] text-muted-foreground/50">
              No workspaces yet
            </div>
          )}
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => handleSelect(w.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
                w.id === activeWorkspace?.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${w.id === activeWorkspace?.id ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
              {w.name}
            </button>
          ))}
          {creating ? (
            <div className="mt-1 flex items-center gap-1 px-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Workspace name..."
                className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              <button onClick={handleCreate} className="rounded-md bg-foreground px-2 py-1 font-mono text-[10px] text-background hover:bg-foreground/90">
                Add
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New workspace
            </button>
          )}
        </div>
      )}
    </div>
    </>
  );
}
