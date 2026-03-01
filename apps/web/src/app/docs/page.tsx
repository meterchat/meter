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
          <Section label="GET STARTED" items={["Introduction", "Quickstart", "Authentication"]} />
          <Section label="SDK" items={["Installation", "React Components", "TypeScript Client"]} />
          <Section label="API" items={["Chat", "Sessions", "History", "Billing"]} />
          <Section label="REFERENCE" items={["Models", "Pricing", "Events"]} />
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-medium text-foreground mb-4">Meter Documentation</h1>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="introduction">Introduction</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Meter is metered AI infrastructure for developers. One SDK gives you model routing, per-token usage
              tracking, and postpaid billing via Stripe. Integrate AI into your app without building billing logic.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every frontier model available — Claude, GPT, Gemini, Grok, DeepSeek — through one API key.
              Your end users pay for what they use. Cards collected and billed automatically.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="quickstart">Quickstart</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Get up and running in under 5 minutes.
            </p>
            <ol className="text-sm text-muted-foreground leading-relaxed space-y-3 list-decimal list-inside">
              <li>Get an API key from the <Link href="/console" className="text-foreground underline">Developer Console</Link></li>
              <li>Install the SDK:
                <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground mt-2">
{`npm install @getmeter/react`}
                </pre>
              </li>
              <li>Add to your app:
                <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mt-2">
{`import { MeterProvider, MeterChat } from "@getmeter/react"

function App() {
  return (
    <MeterProvider apiKey="mk_your_api_key">
      <MeterChat userId="user_123" />
    </MeterProvider>
  )
}`}
                </pre>
              </li>
            </ol>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="authentication">Authentication</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              All API requests require a Meter API key in the <code className="bg-card px-1 rounded text-xs">Authorization</code> header.
              Keys start with <code className="bg-card px-1 rounded text-xs">mk_</code>.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto mb-3">
{`Authorization: Bearer mk_your_api_key`}
            </pre>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generate keys in the <Link href="/console" className="text-foreground underline">Developer Console</Link>.
              Keys are hashed server-side — store them securely and never expose them client-side.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="installation">Installation</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Two packages are available depending on your use case:
            </p>
            <div className="space-y-3 mb-3">
              <div>
                <p className="text-xs font-medium text-foreground mb-1">React (recommended)</p>
                <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground">
{`npm install @getmeter/react`}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground mb-1">Headless (Node.js, any framework)</p>
                <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground">
{`npm install @getmeter/sdk`}
                </pre>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              <code className="bg-card px-1 rounded text-xs">@getmeter/react</code> includes <code className="bg-card px-1 rounded text-xs">@getmeter/sdk</code> as a dependency.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="react-components">React Components</h2>

            <h3 className="text-sm font-medium text-foreground mb-2 mt-4">{"<MeterProvider>"}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Wrap your app (or the section using Meter) with <code className="bg-card px-1 rounded text-xs">MeterProvider</code>.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`<MeterProvider
  apiKey="mk_..."       // required
  baseUrl="..."         // default: https://getmeter.dev
  defaultModel="auto"   // default model ID
  theme="dark"          // "light" | "dark" | "system"
>
  {children}
</MeterProvider>`}
            </pre>

            <h3 className="text-sm font-medium text-foreground mb-2 mt-4">{"<MeterChat>"}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Drop-in chat UI with model picker, cost counter, and file upload.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`<MeterChat
  userId="user_123"        // required — your app's user ID
  sessionId="sess_..."     // optional — continue a conversation
  placeholder="Ask..."     // input placeholder text
  showModelPicker={true}   // show model selector bar
  showCostCounter={true}   // show live cost counter
  showFileUpload={true}    // show file upload button
  onMessage={(msg) => {}}  // callback on send/receive
/>`}
            </pre>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="typescript-client">TypeScript Client</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Use <code className="bg-card px-1 rounded text-xs">MeterClient</code> directly for server-side or non-React usage.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`import { MeterClient } from "@getmeter/sdk"

const meter = new MeterClient({ apiKey: "mk_..." })

// Stream a chat response
const stream = await meter.chat({
  messages: [{ role: "user", content: "Hello" }],
  model: "anthropic/claude-sonnet-4.6",
  endUserId: "user_123",
  sessionId: "sess_...",
})

for await (const event of stream) {
  if (event.type === "delta") process.stdout.write(event.content)
  if (event.type === "usage") console.log(event)
}

// Session management
const sessions = await meter.listSessions("user_123")
const { sessionId } = await meter.createSession("user_123", "My Chat")
const history = await meter.getHistory("user_123", sessionId)

// Billing
const status = await meter.getBillingStatus("user_123")
const { clientSecret } = await meter.createSetupIntent("user_123")`}
            </pre>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="chat">POST /api/v1/chat</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Stream an AI response with real-time token metering. Returns Server-Sent Events.
            </p>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-4 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`POST /api/v1/chat
Authorization: Bearer mk_your_api_key
Content-Type: application/json

{
  "messages": [{"role": "user", "content": "Hello"}],
  "model": "anthropic/claude-sonnet-4.6",
  "endUserId": "user_123",
  "sessionId": "sess_..."
}

// Response (SSE stream):
data: {"type":"delta","content":"Hi","tokensOut":1}
data: {"type":"usage","tokensIn":5,"tokensOut":50}
data: {"type":"done"}`}
            </pre>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Parameter</th>
                    <th className="py-1.5 pr-4">Type</th>
                    <th className="py-1.5">Description</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">messages</td><td className="py-1.5 pr-4">array</td><td className="py-1.5">Chat messages (role + content)</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">model</td><td className="py-1.5 pr-4">string</td><td className="py-1.5">Model ID. Default: anthropic/claude-opus-4.6</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">endUserId</td><td className="py-1.5 pr-4">string</td><td className="py-1.5">Your end-user&apos;s ID (for multi-tenant billing)</td></tr>
                  <tr><td className="py-1.5 pr-4">sessionId</td><td className="py-1.5 pr-4">string</td><td className="py-1.5">Continue a conversation</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="sessions">Sessions</h2>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`GET  /api/v1/sessions?endUserId=user_123    — list sessions
POST /api/v1/sessions                        — create session
     { "endUserId": "user_123", "name": "My Chat" }`}
            </pre>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="history">History</h2>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`GET /api/v1/history?endUserId=user_123&sessionId=sess_...`}
            </pre>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Returns all messages for a session with role, content, model, token counts, cost, and timestamp.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="billing">Billing</h2>
            <pre className="rounded-lg bg-[#141414] border border-white/[0.06] p-3 font-mono text-xs text-foreground overflow-x-auto leading-relaxed mb-3">
{`GET  /api/v1/billing/status?endUserId=user_123  — check card status
POST /api/v1/billing/setup                       — create SetupIntent
     { "endUserId": "user_123" }`}
            </pre>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              End users add a card via Stripe. Usage is tracked per-token. Cards are charged at $10 or monthly,
              whichever comes first. You never touch Stripe directly — Meter handles it all.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="models">Models</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Every frontier model available through one endpoint.
            </p>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Model ID</th>
                    <th className="py-1.5 pr-4">Name</th>
                    <th className="py-1.5 pr-4">Provider</th>
                    <th className="py-1.5">Speed</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">anthropic/claude-sonnet-4.6</td><td className="py-1.5 pr-4">Sonnet 4.6</td><td className="py-1.5 pr-4">Anthropic</td><td className="py-1.5">60 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">anthropic/claude-opus-4.6</td><td className="py-1.5 pr-4">Opus 4.6</td><td className="py-1.5 pr-4">Anthropic</td><td className="py-1.5">70 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">openai/gpt-5.2</td><td className="py-1.5 pr-4">GPT-5.2</td><td className="py-1.5 pr-4">OpenAI</td><td className="py-1.5">84 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">google/gemini-3.1-pro-preview</td><td className="py-1.5 pr-4">Gemini 3.1 Pro</td><td className="py-1.5 pr-4">Google</td><td className="py-1.5">138 tok/s</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">x-ai/grok-4.1-fast</td><td className="py-1.5 pr-4">Grok 4.1 Fast</td><td className="py-1.5 pr-4">xAI</td><td className="py-1.5">129 tok/s</td></tr>
                  <tr><td className="py-1.5 pr-4">deepseek/deepseek-chat-v3-0324</td><td className="py-1.5 pr-4">DeepSeek V3</td><td className="py-1.5 pr-4">DeepSeek</td><td className="py-1.5">50 tok/s</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="pricing">Pricing</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Pay-per-token with a 2x markup on provider base rates.
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
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Gemini 3.1 Pro</td><td className="py-1.5 pr-4">$4.00</td><td className="py-1.5 pr-4">$24.00</td><td className="py-1.5">~$0.01</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">Grok 4.1 Fast</td><td className="py-1.5 pr-4">$0.40</td><td className="py-1.5 pr-4">$1.00</td><td className="py-1.5">~$0.001</td></tr>
                  <tr><td className="py-1.5 pr-4">DeepSeek V3</td><td className="py-1.5 pr-4">$0.54</td><td className="py-1.5 pr-4">$2.20</td><td className="py-1.5">~$0.001</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-lg font-medium text-foreground mb-2" id="events">Events</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              The chat endpoint streams Server-Sent Events with these types:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground/60">
                    <th className="py-1.5 pr-4">Event</th>
                    <th className="py-1.5 pr-4">Fields</th>
                    <th className="py-1.5">Description</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">delta</td><td className="py-1.5 pr-4">content, tokensOut</td><td className="py-1.5">Streamed text chunk</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">usage</td><td className="py-1.5 pr-4">tokensIn, tokensOut</td><td className="py-1.5">Final token counts</td></tr>
                  <tr className="border-b border-border/50"><td className="py-1.5 pr-4">done</td><td className="py-1.5 pr-4">—</td><td className="py-1.5">Stream complete</td></tr>
                  <tr><td className="py-1.5 pr-4">error</td><td className="py-1.5 pr-4">message</td><td className="py-1.5">Error occurred</td></tr>
                </tbody>
              </table>
            </div>
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
