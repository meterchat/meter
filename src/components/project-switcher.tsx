"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useWorkspaceStore, Project } from "@/lib/workspace-store";

interface ProjectSwitcherProps {
  activeProject: Project | null;
  companyId: string;
}

export function ProjectSwitcher({ activeProject, companyId }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Stable selector: grab all projects, filter in useMemo to avoid new-ref-every-render
  const allProjects = useWorkspaceStore((s) => s.projects);
  const projects = useMemo(
    () => allProjects.filter((p) => p.companyId === companyId),
    [allProjects, companyId]
  );
  const createProject = useWorkspaceStore((s) => s.createProject);
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);

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

  const handleSelect = (id: string | null) => {
    setActiveProject(id);
    setOpen(false);
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    // Single store set — create + activate in one call
    createProject(companyId, name);
    setNewName("");
    setCreating(false);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{activeProject?.name ?? "All tracks"}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-md border border-border bg-popover p-2 shadow-md z-50">
          <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">
            Tracks
          </div>
          <button
            onClick={() => handleSelect(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
              !activeProject
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!activeProject ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
            All tracks
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
                p.id === activeProject?.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${p.id === activeProject?.id ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
              {p.name}
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
                placeholder="Track name..."
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
              New track
            </button>
          )}
        </div>
      )}
    </div>
  );
}
