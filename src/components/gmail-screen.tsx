"use client";

import { useMeterStore } from "@/lib/store";
import { initiateOAuthFlow } from "@/lib/oauth-client";
import Image from "next/image";

export function GmailScreen() {
  const { email, userId, activeProjectId, connectService } = useMeterStore();

  const handleConnect = () => {
    if (userId) {
      initiateOAuthFlow("gmail", activeProjectId);
    }
  };

  const handleSkip = () => {
    connectService("gmail");
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <Image src="/logo-dark-copy.webp" alt="Meter" width={72} height={20} />
          <h1 className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
            Connect Gmail
          </h1>
        </div>

        <div className="w-full rounded-xl border border-border bg-card p-6 flex flex-col items-center gap-4">
          {/* Gmail icon */}
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
            <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" fill="currentColor"/>
          </svg>

          <div className="text-center">
            <p className="text-sm text-foreground">
              Let Meter read your receipts
            </p>
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
              We scan for AI service invoices (OpenAI, Anthropic, etc.)
              to track your total spend across providers.
            </p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          className="w-full rounded-xl bg-foreground py-3.5 font-mono text-sm text-background transition-colors hover:bg-foreground/90 flex items-center justify-center gap-2"
        >
          Connect Gmail
        </button>

        <button
          onClick={handleSkip}
          className="font-mono text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Skip for now
        </button>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-mono text-[10px] text-muted-foreground/40">
            {email}
          </span>
        </div>
      </div>
    </div>
  );
}
