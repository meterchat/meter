"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useStagingStore } from "@/lib/staging-store";
import { useArtifactsStore } from "@/lib/artifacts-store";
import { useMeterStore } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  trackCommitDropdownOpened,
  trackCommitExecuted,
  trackDecisionUnstaged,
} from "@/lib/analytics";

const BLUEPRINT_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "DESIGN.md",
  "DECISIONS.md",
  "CLAUDE.md",
  "BRAND.md",
  ".cursorrules",
];

export function CommitButton() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const stagedDecisions = useStagingStore((s) => s.stagedDecisions);
  const unstageDecision = useStagingStore((s) => s.unstageDecision);
  const commit = useStagingStore((s) => s.commit);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);

  const artifacts = useArtifactsStore((s) => s.artifacts);

  const modifiedArtifacts = useMemo(() => {
    return artifacts
      .map((a) => {
        if (!a.lastCommittedContent && a.content) {
          return { filePath: a.filePath, status: "new" as const };
        }
        if (a.content && a.content !== a.lastCommittedContent) {
          return { filePath: a.filePath, status: "modified" as const };
        }
        return { filePath: a.filePath, status: "unchanged" as const };
      })
      .filter((a) => a.status !== "unchanged");
  }, [artifacts]);

  // Also show blueprint files that exist but have no changes
  const unchangedBlueprints = useMemo(() => {
    const modifiedPaths = new Set(modifiedArtifacts.map((a) => a.filePath));
    return artifacts
      .filter((a) => BLUEPRINT_FILES.includes(a.filePath) && !modifiedPaths.has(a.filePath))
      .map((a) => ({ filePath: a.filePath, status: "unchanged" as const }));
  }, [artifacts, modifiedArtifacts]);

  const hasChanges = stagedDecisions.length > 0 || modifiedArtifacts.length > 0;

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
    setOpen((v) => !v);
    if (!open) trackCommitDropdownOpened();
  };

  const handleCommit = () => {
    const decisionCount = stagedDecisions.length;
    const artifactCount = modifiedArtifacts.length;
    trackCommitExecuted({ decisionCount, artifactCount, projectId: activeProjectId });
    commit(activeProjectId);
    setOpen(false);
  };

  const handleUnstage = (id: string) => {
    trackDecisionUnstaged({ decisionId: id });
    unstageDecision(id);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-all ${
          hasChanges
            ? "border-emerald-500/30 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/5"
            : "border-border text-muted-foreground/50 hover:border-foreground/20 hover:text-muted-foreground"
        }`}
        title={hasChanges ? `${stagedDecisions.length} decisions staged` : "Nothing to commit"}
      >
        {/* Git commit icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <line x1="1.05" y1="12" x2="7" y2="12" />
          <line x1="17.01" y1="12" x2="22.96" y2="12" />
        </svg>
        <span>Commit</span>
        {hasChanges && (
          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500/20 px-1 font-mono text-[9px] text-emerald-400">
            {stagedDecisions.length + modifiedArtifacts.length}
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full z-50 mt-2 rounded-xl border border-border bg-card shadow-xl ${
            isMobile ? "fixed left-2 right-2 w-auto" : "right-0 w-[340px]"
          }`}
        >
          {!hasChanges ? (
            /* Empty state */
            <div className="px-4 py-6 text-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mx-auto mb-2 text-muted-foreground/20"
              >
                <circle cx="12" cy="12" r="4" />
                <line x1="1.05" y1="12" x2="7" y2="12" />
                <line x1="17.01" y1="12" x2="22.96" y2="12" />
              </svg>
              <p className="font-mono text-[12px] text-muted-foreground/50">
                Nothing to commit
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/30">
                Decisions will appear here as you chat
              </p>
            </div>
          ) : (
            <>
              {/* Staged decisions */}
              {stagedDecisions.length > 0 && (
                <div className="border-b border-border/50 px-4 py-3">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                    {stagedDecisions.length} decision{stagedDecisions.length !== 1 ? "s" : ""} staged
                  </div>
                  <div className="flex flex-col gap-1">
                    {stagedDecisions.map((d) => (
                      <div
                        key={d.id}
                        className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[12px] text-foreground/80 truncate">
                            {d.title}
                          </div>
                          {d.choice && (
                            <div className="font-mono text-[10px] text-muted-foreground/50 truncate mt-0.5">
                              {d.choice}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleUnstage(d.id)}
                          className="shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-foreground/10 transition-all"
                          title="Unstage"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blueprint changes */}
              <div className="px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                  Blueprint
                </div>
                <div className="flex flex-col gap-0.5">
                  {modifiedArtifacts.map((a) => (
                    <div key={a.filePath} className="flex items-center gap-2 py-1">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-muted-foreground/50"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="flex-1 font-mono text-[12px] text-foreground/80">
                        {a.filePath}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          a.status === "new"
                            ? "text-emerald-500"
                            : "text-amber-500"
                        }`}
                      >
                        {a.status === "new" ? "+new" : "modified"}
                      </span>
                    </div>
                  ))}
                  {unchangedBlueprints.map((a) => (
                    <div key={a.filePath} className="flex items-center gap-2 py-1 opacity-40">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-muted-foreground/50"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="flex-1 font-mono text-[12px] text-muted-foreground">
                        {a.filePath}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/50">
                        no changes
                      </span>
                    </div>
                  ))}
                  {modifiedArtifacts.length === 0 && unchangedBlueprints.length === 0 && (
                    <div className="py-1 font-mono text-[11px] text-muted-foreground/30">
                      No blueprint files yet
                    </div>
                  )}
                </div>
              </div>

              {/* Commit button */}
              <div className="border-t border-border/50 px-4 py-3">
                <button
                  onClick={handleCommit}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-foreground py-2 font-mono text-[11px] text-background transition-colors hover:bg-foreground/90 active:bg-foreground/80"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Commit
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
