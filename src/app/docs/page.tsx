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
  "mcp",
];

export default function DocsPage() {
  // Marketing/public pricing always shows 2x markup regardless of internal config
  const markup = 2.0;
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
      <Section label="DEVELOPERS" items={["MCP"]} activeId={activeId} onNavigate={() => setSidebarOpen(false)} />
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
              Use any model, pay only for what you use. Run multi-model debates to get the best answer.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every top frontier model available — Claude, GPT, Gemini, Grok, DeepSeek. One bill. No complexity.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="how-it-works">How It Works</h2>
            <ol className="text-sm text-muted-foreground leading-relaxed space-y-2 list-decimal list-inside">
              <li>Create an account with a passkey</li>
              <li>Add a card — no charge, just a verification hold</li>
              <li>Start chatting — every model is available</li>
              <li>Each response shows: <code className="bg-card px-1 rounded text-xs">Model · Tokens · $Cost · Status</code></li>
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
              <span>1,204 tokens</span>
              <span className="text-muted-foreground/30 mx-2">&middot;</span>
              <span>$0.03</span>
              <span className="text-muted-foreground/30 mx-2">&middot;</span>
              <span className="text-emerald-500/70">settled</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Model name. Token count. Cost in dollars. Settlement status.
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
              Debate mode runs your question through multiple models simultaneously, then synthesizes the best answer. Standard per-token pricing applies.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="billing">Billing</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your card is charged when your balance reaches the threshold, or at the end of each month — whichever comes first.
              All payments are processed securely.
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
              Meter 1.0 runs your question through multiple frontier models simultaneously, then synthesizes
              the best answer. Higher quality, competitive pricing.
            </p>
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
    icon: "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z",
    label: "Run in your terminal",
    snippet: `claude mcp add meter --transport http https://meter.chat/api/mcp -H "Authorization: Bearer your-api-key"`,
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z",
    label: "Add to Settings → MCP Servers",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "lovable",
    name: "Lovable",
    icon: "M7.082 0c3.91 0 7.081 3.179 7.081 7.1v2.7h2.357c3.91 0 7.082 3.178 7.082 7.1 0 3.923-3.17 7.1-7.082 7.1H0V7.1C0 3.18 3.17 0 7.082 0z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "replit",
    name: "Replit",
    icon: "M11.878 7.761H3.482A1.469 1.469 0 012 6.304V1.457C2 .644 2.67 0 3.482 0h6.913c.827 0 1.483.658 1.483 1.457v6.304zM20.882 16.215h-8.995V7.75h8.995c.87 0 1.588.717 1.588 1.586v5.294c0 .885-.717 1.586-1.588 1.586zM10.395 24H3.482C2.67 24 2 23.343 2 22.546v-4.853c0-.797.67-1.454 1.482-1.454h8.396v6.307c0 .797-.67 1.454-1.483 1.454z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    icon: "M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z",
    label: "Add to your MCP configuration",
    snippet: JSON.stringify({ mcpServers: { meter: { url: "https://meter.chat/api/mcp", headers: { Authorization: "Bearer your-api-key" } } } }, null, 2),
  },
  {
    id: "codex",
    name: "Codex",
    icon: "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z",
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" clipRule="evenodd" className="shrink-0 opacity-50">
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
