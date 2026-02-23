"use client";

import { useMemo } from "react";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { CompanySwitcher } from "./company-switcher";
import { ModeSwitcher } from "./project-switcher";
import { CardSwitcher } from "./card-switcher";

export function WorkspaceBar() {
  // Select primitives + stable arrays — avoids new references on every render
  const companies = useWorkspaceStore((s) => s.companies);
  const activeCompanyId = useWorkspaceStore((s) => s.activeCompanyId);
  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId]
  );

  return (
    <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50">
      {/* Left: Workspace + Mode */}
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
            {/* Mode (layers icon) */}
            <div className="flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              <ModeSwitcher />
            </div>
          </>
        )}
      </div>

      {/* Right: Card switcher */}
      <CardSwitcher />
    </div>
  );
}
