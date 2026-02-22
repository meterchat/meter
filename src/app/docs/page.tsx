"use client";

import Link from "next/link";
import Image from "next/image";

export default function DocsPage() {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border p-6 flex flex-col gap-6 shrink-0">
        <Link href="/">
          <Image src="/logo-dark-copy.webp" alt="Meter" width={64} height={18} />
        </Link>

        <nav className="flex flex-col gap-4">
          <Section label="GET STARTED" items={["Introduction", "How It Works", "Quickstart"]} />
          <Section label="CONCEPTS" items={["Pay Per Use", "Pricing", "Billing", "Models"]} />
          <Section label="DEVELOPERS" items={["API Reference", "SDK"]} />
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-medium text-foreground mb-4">Meter Documentation</h1>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="introduction">Introduction</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Meter is the first consumer AI product with postpaid billing. No subscription. No credits.
              Use first, pay after. The meter runs up in dollars like a taxi.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every model available — Claude, GPT, Gemini, Grok, DeepSeek. One bill. No complexity.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="how-it-works">How It Works</h2>
            <ol className="text-sm text-muted-foreground leading-relaxed space-y-2 list-decimal list-inside">
              <li>Sign up with your email</li>
              <li>Add a card — no charge, just a verification hold</li>
              <li>Start chatting — every model is available</li>
              <li>Each response shows: <code className="bg-card px-1 rounded text-xs">Model · $Cost · Confidence%</code></li>
              <li>Your card is charged at $10 or monthly, whichever comes first</li>
            </ol>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="pay-per-use">Pay Per Use</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Every message has a cost based on the model used and tokens consumed. Below each response you see:
            </p>
            <div className="rounded-lg border border-border bg-card p-4 font-mono text-sm text-muted-foreground mb-3">
              <span className="text-[#D97757]">Sonnet 4</span>
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
              Pay-per-token with a 2x markup on provider base rates. Most messages cost between $0.01 and $0.50.
            </p>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Model</th>
                    <th className="py-1.5 pr-4">Input / 1M</th>
                    <th className="py-1.5 pr-4">Output / 1M</th>
                    <th className="py-1.5">~Per Msg</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Claude Sonnet 4.6</td><td className="py-1.5 pr-4">$6.00</td><td className="py-1.5 pr-4">$30.00</td><td className="py-1.5">~$0.02</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Claude Opus 4.6</td><td className="py-1.5 pr-4">$10.00</td><td className="py-1.5 pr-4">$50.00</td><td className="py-1.5">~$0.03</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">GPT-5.2</td><td className="py-1.5 pr-4">$3.50</td><td className="py-1.5 pr-4">$28.00</td><td className="py-1.5">~$0.01</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Gemini 3 Pro</td><td className="py-1.5 pr-4">$4.00</td><td className="py-1.5 pr-4">$24.00</td><td className="py-1.5">~$0.01</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Grok 4.1 Fast</td><td className="py-1.5 pr-4">$0.40</td><td className="py-1.5 pr-4">$1.00</td><td className="py-1.5">~$0.001</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">DeepSeek V3</td><td className="py-1.5 pr-4">$0.54</td><td className="py-1.5 pr-4">$2.20</td><td className="py-1.5">~$0.001</td></tr>
                  <tr><td className="py-1.5 pr-4">Meter 1.0 (Debate)</td><td className="py-1.5 pr-4">$13.90</td><td className="py-1.5 pr-4">$79.00</td><td className="py-1.5">~$1.00</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The daily meter in the header shows your running total. Set a daily spending cap in settings.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="billing">Billing</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Your card is charged when your balance reaches $10, or at the end of each month — whichever comes first.
              Stripe handles all payments securely.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Most founders spend $20-40/month — less than a single AI subscription, with every model included.
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
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Claude Sonnet 4.6</td><td className="py-1.5 pr-4">Anthropic</td><td className="py-1.5 pr-4">74%</td><td className="py-1.5">60 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Claude Opus 4.6</td><td className="py-1.5 pr-4">Anthropic</td><td className="py-1.5 pr-4">91%</td><td className="py-1.5">70 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">GPT-5.2</td><td className="py-1.5 pr-4">OpenAI</td><td className="py-1.5 pr-4">90%</td><td className="py-1.5">84 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Gemini 3 Pro</td><td className="py-1.5 pr-4">Google</td><td className="py-1.5 pr-4">92%</td><td className="py-1.5">138 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Grok 4.1 Fast</td><td className="py-1.5 pr-4">xAI</td><td className="py-1.5 pr-4">86%</td><td className="py-1.5">129 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">DeepSeek V3</td><td className="py-1.5 pr-4">DeepSeek</td><td className="py-1.5 pr-4">59%</td><td className="py-1.5">50 tok/s</td></tr>
                  <tr><td className="py-1.5 pr-4">Meter 1.0 (Debate)</td><td className="py-1.5 pr-4">Meter</td><td className="py-1.5 pr-4">93%</td><td className="py-1.5">30 tok/s</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Meter 1.0 runs Opus + GPT-5.2 + Grok in a multi-model debate, then synthesizes
              the best answer. Slower but highest quality.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="api">API Reference</h2>
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
data: {"type":"usage","tokensIn":5,"tokensOut":50,"confidence":85}
data: {"type":"done"}`}
            </pre>
          </section>
        </div>
      </main>
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="font-mono text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">{label}</p>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <a
            key={item}
            href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
          >
            {item}
          </a>
        ))}
      </div>
    </div>
  );
}
