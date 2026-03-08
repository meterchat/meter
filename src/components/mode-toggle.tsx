"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useMeterStore } from "@/lib/store";

export function ModeToggle() {
  const appMode = useMeterStore((s) => s.appMode);
  const toggleAppMode = useMeterStore((s) => s.toggleAppMode);
  const accountType = useMeterStore((s) => s.accountType);
  const { setTheme } = useTheme();

  // Sync theme with mode
  useEffect(() => {
    setTheme(appMode === "metric" ? "light" : "dark");
  }, [appMode, setTheme]);

  // Only show for superadmin
  if (accountType !== "superadmin") return null;

  return (
    <button
      onClick={toggleAppMode}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] transition-all ${
        appMode === "metric"
          ? "text-foreground/80 bg-foreground/5"
          : "text-muted-foreground/50 hover:text-muted-foreground/70"
      }`}
      title={appMode === "meter" ? "Switch to code mode" : "Switch to think mode"}
    >
      {appMode === "meter" ? (
        /* Brain icon for think mode */
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 4 7.5L12 22l3-5.5c2-2 4-4.5 4-7.5a7 7 0 0 0-7-7z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      ) : (
        /* Terminal icon for code mode */
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      )}
      {appMode === "meter" ? "think" : "code"}
    </button>
  );
}
