"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Zap, CreditCard, Box, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedBorderPill } from "@/components/landing/animated-border-pill";
import { CornerMarkers } from "@/components/landing/corner-markers";
import { CodeBlock } from "@/components/landing/code-block";
import { ScrollScrambleText } from "@/components/landing/scramble-text";
import { ScrambleButton } from "@/components/landing/scramble-button";
import { StaggerContainer, staggerItemVariants } from "@/components/landing/scroll-reveal";
import { motion } from "framer-motion";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-6 md:px-12 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo-dark-copy.webp"
              alt="Meter"
              width={24}
              height={24}
              className="rounded"
            />
            <span className="font-semibold text-sm tracking-tight">Meter</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/docs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs">
                Docs
              </Button>
            </Link>
            <Link href="/console">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs">
                Console
              </Button>
            </Link>
            <a href="https://meter.chat" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground text-xs">
                meter.chat
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-24 dot-grid-fade">
        <div className="container mx-auto px-6 md:px-12 text-center">
          <CornerMarkers className="max-w-xl mx-auto py-8">
            <AnimatedBorderPill className="mb-6">
              <Zap className="h-3 w-3" />
              Metered AI for developers
            </AnimatedBorderPill>

            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight mb-4 leading-tight max-w-md mx-auto">
              Add <ScrollScrambleText text="metered AI" />
              <br />
              to any app.
            </h1>

            <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto mb-8">
              One SDK handles model routing, usage tracking, and billing.
              <br />
              Ship AI features in an afternoon.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/console">
                <ScrambleButton
                  size="lg"
                  className="gap-2 btn-shine text-sm px-6 py-5"
                  icon={<ArrowRight className="h-4 w-4 order-last" />}
                >
                  Get started
                </ScrambleButton>
              </Link>
              <Link href="/docs">
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 text-sm px-6 py-5 border-border/50"
                >
                  <Terminal className="h-4 w-4" />
                  Read the docs
                </Button>
              </Link>
            </div>
          </CornerMarkers>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <StaggerContainer className="grid md:grid-cols-2 gap-12 items-start">
              <motion.div variants={staggerItemVariants} className="space-y-6">
                <p className="text-xs font-medium text-primary uppercase tracking-widest mb-2">
                  How it works
                </p>
                <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                  Every model. One endpoint.
                  <br />
                  <span className="text-muted-foreground">Billing included.</span>
                </h2>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-mono font-bold text-primary">1</span>
                    </div>
                    <p>Install <code className="text-foreground font-mono text-xs bg-muted px-1.5 py-0.5 rounded">@getmeter/react</code> and drop in your API key.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-mono font-bold text-primary">2</span>
                    </div>
                    <p>Meter routes calls to Claude, GPT, Gemini, Grok, or Deepseek. Your users pick.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-mono font-bold text-primary">3</span>
                    </div>
                    <p>Usage is tracked per-token. Cards collected. Billing automated. You never touch Stripe.</p>
                  </div>
                </div>
              </motion.div>

              <motion.div variants={staggerItemVariants}>
                <CodeBlock filename="app.tsx">
                  <pre className="text-muted-foreground leading-relaxed">
                    <code>{`import { MeterProvider, MeterChat }
  from '@getmeter/react'

function App() {
  return (
    <MeterProvider apiKey="mk_xxxxx">
      <MeterChat
        userId="user_123"
        showModelPicker
        showCostCounter
      />
    </MeterProvider>
  )
}`}</code>
                  </pre>
                </CodeBlock>
              </motion.div>
            </StaggerContainer>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────── */}
      <section className="py-20 md:py-24 border-t border-border">
        <div className="container mx-auto px-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <StaggerContainer className="grid md:grid-cols-3 gap-6">
              <motion.div variants={staggerItemVariants}>
                <CornerMarkers className="p-6" showLines={true}>
                  <Box className="h-5 w-5 text-muted-foreground mb-3" />
                  <h3 className="font-semibold text-sm mb-2">Every model, one endpoint</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Claude, GPT, Gemini, Grok, Deepseek — all through one API. No managing provider keys. Swap models with a string.
                  </p>
                </CornerMarkers>
              </motion.div>

              <motion.div variants={staggerItemVariants}>
                <CornerMarkers className="p-6" showLines={true}>
                  <CreditCard className="h-5 w-5 text-muted-foreground mb-3" />
                  <h3 className="font-semibold text-sm mb-2">Pay-per-token billing</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    End users pay for what they use. Cards collected automatically. Auto-charge at thresholds. No subscription logic to build.
                  </p>
                </CornerMarkers>
              </motion.div>

              <motion.div variants={staggerItemVariants}>
                <CornerMarkers className="p-6" showLines={true}>
                  <Zap className="h-5 w-5 text-muted-foreground mb-3" />
                  <h3 className="font-semibold text-sm mb-2">Ship in minutes</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Drop-in React components or use the REST API. Chat UI, model picker, live meter, receipts — all included.
                  </p>
                </CornerMarkers>
              </motion.div>
            </StaggerContainer>
          </div>
        </div>
      </section>

      {/* ── CTA + Footer ────────────────────────────────────────── */}
      <section className="py-20 md:py-24 border-t border-border">
        <div className="container mx-auto px-6 md:px-12 text-center">
          <div className="max-w-md mx-auto">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-3">
              Start building with Meter
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Get an API key. Install the SDK. Ship metered AI today.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
              <Link href="/console">
                <ScrambleButton
                  size="lg"
                  className="gap-2 btn-shine text-sm px-6 py-5"
                  icon={<ArrowRight className="h-4 w-4 order-last" />}
                >
                  Open console
                </ScrambleButton>
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="container mx-auto px-6 md:px-12 border-t border-border pt-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo-dark-copy.webp"
                alt="Meter"
                width={18}
                height={18}
                className="rounded opacity-50"
              />
              <span className="text-xs text-muted-foreground">
                &copy; {new Date().getFullYear()} Meter
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
              <Link href="/console" className="hover:text-foreground transition-colors">Console</Link>
              <a href="https://meter.chat" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">meter.chat</a>
              <a href="https://github.com/meterdev/meter" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
