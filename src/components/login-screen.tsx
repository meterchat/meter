"use client";

import Image from "next/image";
import { useState } from "react";
import { useMeterStore } from "@/lib/store";

export function LoginScreen() {
  const { setAuth } = useMeterStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // In production: /api/auth/signup with passkey registration
      const userId = `usr_${Date.now().toString(36)}`;
      setAuth(userId, email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSignup();
  };

  return (
    <div className="relative flex h-screen flex-col items-center bg-background px-4">
      <div className="flex flex-col items-center gap-8 max-w-sm text-center mt-[28vh]">
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/logo-dark-copy.webp"
            alt="Meter"
            width={108}
            height={29}
            priority
          />
          <p className="font-mono text-xs text-muted-foreground tracking-wide uppercase">
            use first, pay after
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 w-full">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every model. One bill. No subscription.
          </p>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            The meter runs in dollars. You pay what you use.
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="you@startup.com"
            className="w-full h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
            autoFocus
          />

          {error && (
            <p className="font-mono text-[11px] text-red-400">{error}</p>
          )}

          <button
            onClick={handleSignup}
            disabled={loading || !email.trim()}
            className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50"
          >
            {loading ? "Setting up..." : "Get Started"}
          </button>

          <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
            We&apos;ll ask for a card next. No charge until you chat.
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <a href="https://x.com/meterchat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://github.com/meterchat/meter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
        </div>
      </div>
    </div>
  );
}
