"use client";

import { useMemo } from "react";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { CompanySwitcher } from "./company-switcher";
import { ProjectSwitcher } from "./project-switcher";
import { CardSwitcher } from "./card-switcher";

export function WorkspaceBar() {
  // Select primitives + stable arrays — avoids new references on every render
  const companies = useWorkspaceStore((s) => s.companies);
  const projects = useWorkspaceStore((s) => s.projects);
  const activeCompanyId = useWorkspaceStore((s) => s.activeCompanyId);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId]
  );
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  return (
    <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50">
      {/* Left: Workspace + Track */}
      <div className="flex items-center gap-3">
        {/* Workspace (building icon) */}
        <div className="flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
            <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
            <path d="M9 22v-4h6v4" />
            <path d="M8 6h.01" />
            <path d="M16 6h.01" />
            <path d="M8 10h.01" />
            <path d="M16 10h.01" />
            <path d="M8 14h.01" />
            <path d="M16 14h.01" />
          </svg>
          <CompanySwitcher activeCompany={activeCompany} />
        </div>

        {activeCompany && (
          <>
            <span className="text-muted-foreground/20">/</span>
            {/* Track (git-branch icon) */}
            <div className="flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <ProjectSwitcher activeProject={activeProject} companyId={activeCompany.id} />
            </div>
          </>
        )}
      </div>

      {/* Right: Card switcher */}
      <CardSwitcher />
    </div>
  );
}
