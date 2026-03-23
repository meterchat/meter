"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { MODELS, DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";
import { useMeterStore } from "@/lib/store";

function fmtPrice(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(1)}`;
}

/** Models shown in docs pricing table (skip "Auto" since it routes to other models) */
const DOCS_MODELS = MODELS.filter((m) => m.id !== "auto");

const SECTION_IDS = [
  "introduction", "how-it-works",
  "pay-per-use", "pricing", "billing", "models",
  "api-reference", "mcp",
];

export default function DocsPage() {
  const markup = useMeterStore((s) => s.markupMultiplier) || DEFAULT_MARKUP_MULTIPLIER;
  const mainRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string>("introduction");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { root, rootMargin: "0px 0px -60% 0px", threshold: 0 }
    );

    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const sidebarNav = (
    <nav className="flex flex-col gap-4">
      <Section label="GET STARTED" items={["Introduction", "How It Works"]} activeId={activeId} onNavigate={() => setSidebarOpen(false)} />
      <Section label="CONCEPTS" items={["Pay Per Use", "Pricing", "Billing", "Models"]} activeId={activeId} onNavigate={() => setSidebarOpen(false)} />
      <Section label="DEVELOPERS" items={["API Reference", "MCP"]} activeId={activeId} onNavigate={() => setSidebarOpen(false)} />
    </nav>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3 bg-background border-b border-border md:hidden">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-muted-foreground hover:text-foreground transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>}
          </svg>
        </button>
        <Link href="/">
          <Image src="/logo-dark-copy.webp" alt="Meter" width={64} height={18} />
        </Link>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute top-12 left-0 bottom-0 w-56 bg-background pl-6 pr-6 pt-4 pb-6 flex flex-col gap-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {sidebarNav}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 pl-10 pr-6 pt-6 pb-6 flex-col gap-6 shrink-0">
        <Link href="/">
          <Image src="/logo-dark-copy.webp" alt="Meter" width={64} height={18} />
        </Link>
        {sidebarNav}
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="flex-1 overflow-y-auto px-4 pt-16 pb-8 md:pl-20 md:pr-8 md:pt-8">
        <div className="max-w-xl">
          <h1 className="text-2xl font-medium text-foreground mb-4">Meter Documentation</h1>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="introduction">Introduction</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Meter is the first consumer AI product with postpaid billing. No subscription. No credits.
              Use any model, pay only for what you use.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every model available — Claude, GPT, Gemini, Grok, DeepSeek. One bill. No complexity.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="how-it-works">How It Works</h2>
            <ol className="text-sm text-muted-foreground leading-relaxed space-y-2 list-decimal list-inside">
              <li>Create an account with a passkey</li>
              <li>Add a card — no charge, just a verification hold</li>
              <li>Start chatting — every model is available</li>
              <li>Each response shows: <code className="bg-card px-1 rounded text-xs">Model · $Cost · Confidence%</code></li>
              <li>Your card is charged when your balance reaches the threshold, or monthly — whichever comes first</li>
            </ol>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="pay-per-use">Pay Per Use</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Every message has a cost based on the model used and tokens consumed. Below each response you see:
            </p>
            <div className="rounded-lg border border-border bg-card p-4 font-mono text-sm text-muted-foreground mb-3">
              <span className="text-[#D97757]">Sonnet 4.6</span>
              <span className="text-muted-foreground/30 mx-2">&middot;</span>
              <span>$0.03</span>
              <span className="text-muted-foreground/30 mx-2">&middot;</span>
              <span>82%</span>
              <span className="text-muted-foreground/30 mx-2">&middot;</span>
              <span className="text-emerald-500/70">settled</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Model name. Cost in dollars. AI confidence score. Settlement status.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="pricing">Pricing</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Pay-per-token pricing.
            </p>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Model</th>
                    <th className="py-1.5 pr-4">Input / 1M</th>
                    <th className="py-1.5 pr-4">Output / 1M</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {DOCS_MODELS.map((m, i) => (
                    <tr key={m.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-4">{m.name}</td>
                      <td className="py-1.5 pr-4">{fmtPrice(m.inputPrice * 1_000_000 * markup)}</td>
                      <td className="py-1.5 pr-4">{fmtPrice(m.outputPrice * 1_000_000 * markup)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 pr-4">Meter 1.0 (Debate)</td>
                    <td className="py-1.5 pr-4">{fmtPrice(3.0 * markup)}</td>
                    <td className="py-1.5 pr-4">{fmtPrice(15.0 * markup)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              The daily meter in the header shows your running total. Set a daily spending cap in settings.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Debate mode runs your question through three models simultaneously, then synthesizes the best answer. Standard per-token pricing applies.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="billing">Billing</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your card is charged when your balance reaches the threshold, or at the end of each month — whichever comes first.
              Stripe handles all payments securely.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="models">Models</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Every frontier model available through one interface. Quality measured by GPQA Diamond
              (graduate-level science accuracy). Speed is output tokens per second from native APIs.
            </p>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Model</th>
                    <th className="py-1.5 pr-4">Provider</th>
                    <th className="py-1.5 pr-4">GPQA</th>
                    <th className="py-1.5">Speed</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {DOCS_MODELS.map((m, i) => (
                    <tr key={m.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-4">{m.name}</td>
                      <td className="py-1.5 pr-4">{m.provider}</td>
                      <td className="py-1.5 pr-4">{m.quality != null ? `${m.quality}%` : "\u2014"}</td>
                      <td className="py-1.5">{m.speed != null ? `${m.speed} tok/s` : "\u2014"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 pr-4">Meter 1.0 (Debate)</td>
                    <td className="py-1.5 pr-4">Meter</td>
                    <td className="py-1.5 pr-4">93%</td>
                    <td className="py-1.5">30 tok/s</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Meter 1.0 runs your question through Opus, GPT-5.4, and Grok simultaneously, then synthesizes
              the best answer. Higher quality, competitive pricing.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="api-reference">API Reference</h2>
            <h3 className="text-sm font-medium text-foreground mb-2">POST /api/v1/chat</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Streaming chat endpoint. Returns SSE events.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-4 font-mono text-xs text-foreground overflow-x-auto leading-relaxed">
{`POST /api/v1/chat
Authorization: Bearer mk_your_api_key
Content-Type: application/json

{
  "messages": [{"role": "user", "content": "Hello"}],
  "model": "anthropic/claude-sonnet-4.6"
}

// Response: SSE stream
data: {"type":"delta","content":"Hi","tokensOut":1}
data: {"type":"usage","tokensIn":5,"tokensOut":50}
data: {"type":"done"}`}
            </pre>
          </section>

          <McpSection />
        </div>
      </main>
    </div>
  );
}

/* ─── MCP Connector definitions (static, for docs) ───────────────── */

const MCP_CONNECTORS = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM10 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm4.5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9.5 14a2.5 2.5 0 0 0 5 0",
    label: "Run in your terminal",
    snippet: `claude mcp add meter --transport http https://meter.chat/api/mcp -H "Authorization: Bearer your-api-key"`,
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3ZM8 7v10l8-5-8-5Z",
    label: "Add to Settings → MCP Servers",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "lovable",
    name: "Lovable",
    icon: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "replit",
    name: "Replit",
    icon: "M6 3a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h12V3H6Zm12 9H6a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h12V12ZM18 3h3v18h-3V3Z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    icon: "M12 2L2 19.5h20L12 2Zm0 4l6.93 12H5.07L12 6Z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "codex",
    name: "Codex",
    icon: "M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
];

const MCP_TOOLS = [
  { name: "get_decisions", desc: "List and search your decisions log" },
  { name: "get_decision", desc: "Fetch full detail of a single decision" },
  { name: "get_blueprints", desc: "List and search your blueprints" },
  { name: "get_blueprint", desc: "Fetch full content of a blueprint" },
  { name: "get_debates", desc: "List debate summaries with synthesis" },
  { name: "search", desc: "Full-text search across all artifact types" },
];

function McpSection() {
  const [expandedId, setExpandedId] = useState<string | null>("claude-code");

  return (
    <section className="mb-10">
      <h2 className="text-lg font-medium text-foreground mb-2" id="mcp">MCP</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
        Connect your coding agent to your Meter decisions, blueprints, and debates.
        The Meter MCP server gives any MCP-compatible IDE direct access to your thinking.
      </p>

      <h3 className="text-sm font-medium text-foreground mb-2 mt-6">Available Tools</h3>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground/60">
              <th className="py-1.5 pr-4">Tool</th>
              <th className="py-1.5">Description</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {MCP_TOOLS.map((tool, i) => (
              <tr key={tool.name} className={i < MCP_TOOLS.length - 1 ? "border-b border-border/50" : ""}>
                <td className="py-1.5 pr-4 text-foreground/80">{tool.name}</td>
                <td className="py-1.5">{tool.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-medium text-foreground mb-2">Setup</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">
        Get your API key from Settings → API on{" "}
        <a href="https://meter.chat" className="text-foreground/80 hover:text-foreground transition-colors underline underline-offset-2">meter.chat</a>,
        then configure your editor:
      </p>

      <div className="flex flex-col gap-1 mb-4">
        {MCP_CONNECTORS.map((connector) => {
          const isExpanded = expandedId === connector.id;
          return (
            <div key={connector.id}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : connector.id)}
                className="w-full flex items-center gap-2 py-2 px-3 rounded-lg text-left font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                  <path d={connector.icon} />
                </svg>
                <span className="flex-1">{connector.name}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 opacity-30 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3">
                  <p className="text-[11px] text-muted-foreground/60 mb-2">{connector.label}</p>
                  <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-4 font-mono text-xs text-foreground overflow-x-auto leading-relaxed">
                    {connector.snippet}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        <a
          href="https://github.com/meterchat/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/80 hover:text-foreground transition-colors underline underline-offset-2"
        >
          View on GitHub
        </a>
        {" "}— MIT licensed, contributions welcome.
      </p>
    </section>
  );
}

function Section({ label, items, activeId, onNavigate }: { label: string; items: string[]; activeId: string; onNavigate?: () => void }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-2">{label}</p>
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const slug = item.toLowerCase().replace(/\s+/g, "-");
          const isActive = slug === activeId;
          return (
            <a
              key={item}
              href={`#${slug}`}
              onClick={onNavigate}
              className={`text-sm transition-colors py-0.5 ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item}
            </a>
          );
        })}
      </div>
    </div>
  );
}
