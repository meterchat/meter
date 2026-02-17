"use client";

import { useState, useEffect, useRef } from "react";
import { useMeterStore } from "@/lib/store";
import Image from "next/image";

interface ApiKey {
  id: string;
  key_prefix: string;
  name: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}

interface UsageStats {
  requests: number;
  tokens: number;
  cost: number;
}

export default function ConsolePage() {
  const { authenticated, email, logout } = useMeterStore();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [codeTab, setCodeTab] = useState<"js" | "curl" | "ai">("js");
  const [stats] = useState<UsageStats>({ requests: 0, tokens: 0, cost: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  async function createKey() {
    setLoading(true);
    setNewKey(null);
    // Placeholder — would call /api/v1/keys
    await new Promise((r) => setTimeout(r, 500));
    setNewKey(`mk_${Math.random().toString(36).slice(2, 26)}`);
    setLoading(false);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background px-4 gap-6">
        <Image src="/logo-dark-copy.webp" alt="Meter" width={108} height={29} priority />
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
          Developer Console
        </p>
        <p className="text-sm text-muted-foreground">Sign in to access the console.</p>
      </div>
    );
  }

  const jsSnippet = `const response = await fetch("https://meterchat.com/api/v1/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer mk_your_api_key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello" }],
    model: "anthropic/claude-sonnet-4",
  }),
});
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split("\\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = JSON.parse(line.slice(6));
    if (data.type === "delta") process.stdout.write(data.content);
  }
}`;

  const curlSnippet = `curl -N https://meterchat.com/api/v1/chat \\
  -H "Authorization: Bearer mk_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hello"}],"model":"anthropic/claude-sonnet-4"}'`;

  const aiSnippet = `Integrate Meter AI into this app. Use the following API:

POST https://meterchat.com/api/v1/chat
Authorization: Bearer mk_YOUR_KEY
Content-Type: application/json

Body: { "messages": [{"role":"user","content":"..."}], "model": "anthropic/claude-sonnet-4" }
Response: SSE stream with JSON lines:
  {"type":"delta","content":"...","tokensOut":N}
  {"type":"usage","tokensIn":N,"tokensOut":N,"confidence":N}
  {"type":"done"}

Parse "delta" events for streamed text. "usage" has final token counts and confidence.`;

  const activeSnippet = codeTab === "js" ? jsSnippet : codeTab === "curl" ? curlSnippet : aiSnippet;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <a href="/">
            <Image src="/logo-dark-copy.webp" alt="Meter" width={48} height={13} />
          </a>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            dev console
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 hover:bg-foreground/5 transition-colors"
            >
              <span className="h-2 w-2 rounded-full bg-green-400" />
              <span className="font-mono text-xs text-foreground">{email}</span>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-[#1a1a1a] shadow-lg overflow-hidden z-50">
                <button
                  onClick={() => { logout(); setDropdownOpen(false); }}
                  className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl">
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "REQUESTS", value: stats.requests.toLocaleString() },
              { label: "TOKENS", value: stats.tokens.toLocaleString() },
              { label: "COST", value: `$${stats.cost.toFixed(4)}` },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-border p-4">
                <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">
                  {card.label}
                </p>
                <p className="font-mono text-lg text-foreground">{card.value}</p>
              </div>
            ))}
          </div>

          <h1 className="text-lg font-medium text-foreground mb-1">API Keys</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Manage your Meter API keys for programmatic access.
          </p>

          {newKey && (
            <div className="mb-6 rounded-lg border border-green-400/20 bg-green-400/5 p-4">
              <p className="text-sm text-green-400 font-medium mb-1">New API key created</p>
              <p className="text-xs text-muted-foreground mb-2">Copy it now — you won&apos;t see it again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                  {newKey}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(newKey)}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <button
            onClick={createKey}
            disabled={loading}
            className="mb-6 h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create New Key"}
          </button>

          {keys.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden mb-10">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-4 py-2 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Prefix</th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Created</th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{k.key_prefix}...</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-[10px] uppercase ${k.active ? "text-green-400" : "text-red-400"}`}>
                          {k.active ? "active" : "revoked"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {k.active && (
                          <button className="font-mono text-[10px] text-red-400 hover:text-red-300 transition-colors">
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-border p-8 text-center mb-10">
              <p className="text-sm text-muted-foreground">No API keys yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Create one to get started</p>
            </div>
          )}

          <h2 className="text-lg font-medium text-foreground mb-1">Quick Integration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Copy a snippet to start using the Meter API in your app.
          </p>

          <div className="flex gap-1 mb-4">
            {([
              { key: "js" as const, label: "JavaScript / TypeScript" },
              { key: "curl" as const, label: "cURL" },
              { key: "ai" as const, label: "Share with AI Coder" },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setCodeTab(tab.key)}
                className={`px-3 py-1.5 rounded-md font-mono text-[11px] transition-colors ${
                  codeTab === tab.key
                    ? "bg-white/[0.08] text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.04]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-4 font-mono text-xs text-foreground overflow-x-auto mb-6 leading-relaxed">
              {activeSnippet}
            </pre>
            <button
              onClick={() => copyText(activeSnippet)}
              className="absolute top-3 right-3 rounded-md border border-white/[0.06] bg-[#1a1a1a] px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
