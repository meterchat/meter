"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useWorkspaceStore, Project } from "@/lib/workspace-store";
import { useMeterStore } from "@/lib/store";

interface ProjectSwitcherProps {
  activeProject: Project | null;
  companyId: string;
}

export function ProjectSwitcher({ activeProject, companyId }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const allProjects = useWorkspaceStore((s) => s.projects);
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject);
  const sessionsLoaded = useMeterStore((s) => s.sessionsLoaded);

  // Regular tracks (non-subtracks) for this company
  const regularTracks = useMemo(
    () => allProjects.filter((p) => p.companyId === companyId && !p.isSubtrack),
    [allProjects, companyId]
  );

  // Active subtracks (forked from main, i.e. parentTrackId is null or undefined)
  const activeSubtracks = useMemo(
    () => allProjects.filter(
      (p) => p.companyId === companyId && p.isSubtrack && p.status === "active"
    ),
    [allProjects, companyId]
  );

  // Archived subtracks
  const archivedSubtracks = useMemo(
    () => allProjects.filter(
      (p) => p.companyId === companyId && p.isSubtrack && p.status === "archived"
    ),
    [allProjects, companyId]
  );

  const [showArchived, setShowArchived] = useState(false);

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

  const handleSelect = (id: string | null) => {
    setActiveProject(id);
    setOpen(false);
  };

  // Determine display label
  const displayLabel = activeProject?.isSubtrack
    ? `↳ ${activeProject.name}`
    : activeProject?.name ?? "Main";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { if (sessionsLoaded) setOpen(!open); }}
        disabled={!sessionsLoaded}
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-wait"
      >
        <span>{displayLabel}</span>
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
            Tracks
          </div>

          {/* Main track */}
          <button
            onClick={() => handleSelect(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
              !activeProject
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!activeProject ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
            Main
          </button>

          {/* Regular tracks */}
          {regularTracks.map((p) => (
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

          {/* Active subtracks */}
          {activeSubtracks.length > 0 && (
            <>
              <div className="mt-2 mb-1 font-mono text-[9px] text-muted-foreground/40 uppercase tracking-wider px-2">
                Exploring
              </div>
              {activeSubtracks.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
                    p.id === activeProject?.id
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  <span className="text-muted-foreground/40 text-[10px]">↳</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${p.id === activeProject?.id ? "bg-amber-500" : "bg-muted-foreground/30"}`} />
                  {p.name}
                </button>
              ))}
            </>
          )}

          {/* Archived subtracks (collapsed by default) */}
          {archivedSubtracks.length > 0 && (
            <>
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="mt-2 flex w-full items-center gap-1 px-2 py-1 font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider hover:text-muted-foreground/50 transition-colors"
              >
                <svg
                  width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform duration-200 ${showArchived ? "rotate-90" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Archived ({archivedSubtracks.length})
              </button>
              {showArchived && archivedSubtracks.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[10px] transition-colors ${
                    p.id === activeProject?.id
                      ? "bg-foreground/5 text-muted-foreground/60"
                      : "text-muted-foreground/30 hover:bg-foreground/5 hover:text-muted-foreground/50"
                  }`}
                >
                  <span className="text-muted-foreground/20 text-[10px]">↳</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/15" />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto text-[8px] text-muted-foreground/20">archived</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
