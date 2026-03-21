import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meter — Tech Stack",
  description: "The tools and technologies powering Meter.",
};

interface Tool {
  name: string;
  url: string;
}

interface Category {
  label: string;
  tools: Tool[];
}

const STACK: Category[] = [
  {
    label: "Framework",
    tools: [
      { name: "Next.js", url: "https://nextjs.org" },
      { name: "React", url: "https://react.dev" },
      { name: "TypeScript", url: "https://typescriptlang.org" },
    ],
  },
  {
    label: "Styling",
    tools: [
      { name: "Tailwind CSS", url: "https://tailwindcss.com" },
      { name: "Radix UI", url: "https://radix-ui.com" },
      { name: "Framer Motion", url: "https://motion.dev" },
      { name: "Lucide", url: "https://lucide.dev" },
    ],
  },
  {
    label: "AI",
    tools: [
      { name: "OpenRouter", url: "https://openrouter.ai" },
      { name: "Anthropic SDK", url: "https://docs.anthropic.com" },
      { name: "Google Generative AI", url: "https://ai.google.dev" },
      { name: "OpenAI SDK", url: "https://platform.openai.com" },
      { name: "AWS Bedrock", url: "https://aws.amazon.com/bedrock" },
    ],
  },
  {
    label: "Backend",
    tools: [
      { name: "Supabase", url: "https://supabase.com" },
      { name: "Cloudflare Workers", url: "https://workers.cloudflare.com" },
      { name: "OpenNext", url: "https://opennext.js.org" },
    ],
  },
  {
    label: "Payments",
    tools: [
      { name: "Stripe", url: "https://stripe.com" },
    ],
  },
  {
    label: "Auth",
    tools: [
      { name: "SimpleWebAuthn", url: "https://simplewebauthn.dev" },
    ],
  },
  {
    label: "Mobile",
    tools: [
      { name: "Capacitor", url: "https://capacitorjs.com" },
    ],
  },
  {
    label: "State",
    tools: [
      { name: "Zustand", url: "https://zustand.docs.pmnd.rs" },
      { name: "Zod", url: "https://zod.dev" },
    ],
  },
  {
    label: "Analytics",
    tools: [
      { name: "PostHog", url: "https://posthog.com" },
      { name: "Sentry", url: "https://sentry.io" },
      { name: "Liveline", url: "https://benji.org/liveline" },
    ],
  },
  {
    label: "Infra",
    tools: [
      { name: "Vercel", url: "https://vercel.com" },
      { name: "Cloudflare", url: "https://cloudflare.com" },
      { name: "GitHub", url: "https://github.com" },
      { name: "Porkbun", url: "https://porkbun.com" },
    ],
  },
];

export default function TechPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto px-6 py-16">
        <header className="mb-12">
          <h1 className="font-mono text-sm font-semibold tracking-tight text-foreground">
            Meter Tech Stack
          </h1>
          <p className="font-mono text-[11px] text-muted-foreground/50 mt-1">
            what we use to build meter
          </p>
        </header>

        <div className="flex flex-col gap-8">
          {STACK.map((category) => (
            <section key={category.label}>
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                {category.label}
              </h2>
              <div className="flex flex-col">
                {category.tools.map((tool) => (
                  <a
                    key={tool.name}
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between py-1.5 px-2 -mx-2 rounded-sm transition-colors hover:bg-foreground/[0.04]"
                  >
                    <span className="font-mono text-[13px] text-foreground/80 group-hover:text-foreground transition-colors">
                      {tool.name}
                    </span>
                    <span className="font-mono text-[13px] text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">
                      &rarr;
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-16 pt-6 border-t border-border">
          <p className="font-mono text-[10px] text-muted-foreground/30">
            meter.chat
          </p>
        </footer>
      </div>
    </div>
  );
}
