"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
import Link from "next/link";

/* ── Types ─────────────────────────────────────────────────────── */

interface PortalDocument {
  id: string;
  filePath: string;
  content: string;
  category: string | null;
  portalTab: string | null;
  lastGeneratedAt: string | null;
  updatedAt: string | null;
}

interface PortalData {
  workspace: { name: string; slug: string; handle: string; createdAt: string };
  documents: PortalDocument[];
}

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

const TAB_ORDER = ["thesis", "specs", "design"] as const;
const TAB_LABELS: Record<string, string> = {
  thesis: "Thesis",
  specs: "Specs",
  design: "Design",
};

/* ── Heading extraction ────────────────────────────────────────── */

function extractHeadings(markdown: string): Heading[] {
  const seen = new Map<string, number>();
  return markdown.split("\n")
    .filter((line) => /^#{2,3}\s/.test(line))
    .map((line) => {
      const level = (line.startsWith("###") ? 3 : 2) as 2 | 3;
      const text = line.replace(/^#{2,3}\s+/, "").trim();
      let id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const count = seen.get(id) ?? 0;
      if (count > 0) id = `${id}-${count}`;
      seen.set(id, count + 1);
      return { id, text, level };
    });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as React.ReactElement).props.children);
  }
  return "";
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function DocsPortalPage() {
  const params = useParams<{ handle: string; workspace: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [activeHeading, setActiveHeading] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch portal data
  useEffect(() => {
    if (!params?.handle || !params?.workspace) return;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${params.handle}/${params.workspace}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Portal not found" : "Failed to load portal");
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load portal");
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.handle, params?.workspace]);

  // Determine available tabs
  const tabs = useMemo(() => {
    if (!data) return [];
    const tabIds = new Set(data.documents.filter((d) => d.portalTab).map((d) => d.portalTab!));
    return TAB_ORDER.filter((t) => tabIds.has(t));
  }, [data]);

  const hasTabDocuments = tabs.length > 0;

  // Auto-select first tab
  useEffect(() => {
    if (tabs.length > 0 && !activeTab) setActiveTab(tabs[0]);
  }, [tabs, activeTab]);

  // Active document for the selected tab
  const activeDoc = useMemo(() => {
    if (!data || !activeTab) return null;
    return data.documents.find((d) => d.portalTab === activeTab) ?? null;
  }, [data, activeTab]);

  // Headings for TOC
  const headings = useMemo(() => {
    if (!activeDoc) return [];
    return extractHeadings(activeDoc.content);
  }, [activeDoc]);

  // Scroll spy
  useEffect(() => {
    const root = contentRef.current;
    if (!root || headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveHeading(entry.target.id);
        }
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const h of headings) {
      const el = root.querySelector(`#${CSS.escape(h.id)}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings, activeTab]);

  // Reset scroll on tab change
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    setActiveHeading("");
  }, [activeTab]);

  const handleCopyAll = useCallback(() => {
    if (!activeDoc) return;
    navigator.clipboard.writeText(activeDoc.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [activeDoc]);

  const handleDownload = useCallback(() => {
    if (!activeDoc) return;
    const blob = new Blob([activeDoc.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeDoc.filePath || `${activeTab}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDoc, activeTab]);

  const scrollToHeading = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* ── Loading / Error ─────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
          <span className="font-mono text-[12px] text-muted-foreground/60">Loading portal...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="font-mono text-[13px] text-muted-foreground/70">{error || "Portal not found"}</div>
          <Link href="/" className="font-mono text-[12px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
            Go to Meter
          </Link>
        </div>
      </div>
    );
  }

  if (!hasTabDocuments) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="font-mono text-[13px] text-muted-foreground/70">No documents yet</div>
          <div className="font-mono text-[11px] text-muted-foreground/50">Use /spec, /thesis, or /design to generate portal content</div>
          <Link href="/" className="font-mono text-[12px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
            Go to Meter
          </Link>
        </div>
      </div>
    );
  }

  /* ── Main layout ─────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="shrink-0">
        <div className="flex items-center justify-between px-8 py-4">
          <div className="flex items-center gap-5">
            <Link href="/">
              <Image src="/logo-dark-copy.webp" alt="Meter" width={64} height={18} className="opacity-60 hover:opacity-90 transition-opacity hidden dark:block" />
              <Image src="/logo-light.webp" alt="Meter" width={64} height={18} className="opacity-60 hover:opacity-90 transition-opacity block dark:hidden" />
            </Link>
            <span className="text-sm font-medium text-foreground/80">{data.workspace.name}</span>
            {/* Tabs — inline in header */}
            <div className="flex gap-1 ml-4">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded-md font-mono text-[12px] transition-colors ${
                    activeTab === tab
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/[0.03]"
                  }`}
                >
                  {TAB_LABELS[tab] ?? tab}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Content + TOC */}
      <div className="flex flex-1 overflow-hidden">
        {/* TOC Sidebar */}
        {headings.length > 0 && (
          <aside className="hidden md:block w-56 shrink-0 overflow-y-auto px-8 py-6">
            <nav className="flex flex-col gap-0.5">
              {headings.map((h) => (
                <button
                  key={h.id}
                  onClick={() => scrollToHeading(h.id)}
                  className={`text-left py-1 font-sans text-[12px] transition-colors truncate ${
                    h.level === 3 ? "pl-3" : ""
                  } ${
                    activeHeading === h.id
                      ? "text-foreground font-medium"
                      : "text-muted-foreground/70 hover:text-foreground"
                  }`}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          </aside>
        )}

        {/* Main content */}
        <main ref={contentRef} className="flex-1 overflow-y-auto">
          {activeDoc ? (
            <div className="max-w-2xl px-8 py-8 ml-4">
              {/* Action buttons at top of content */}
              <div className="flex items-center gap-2 mb-8">
                <button onClick={handleDownload} className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  Download MD
                </button>
                <button onClick={handleCopyAll} className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  {copied ? "Copied!" : "Copy All"}
                </button>
              </div>
              <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-sans prose-headings:font-semibold prose-p:text-foreground/80 prose-li:text-foreground/80 prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-border prose-code:text-orange-600 dark:prose-code:text-orange-400">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h2: ({ children, ...props }) => {
                      const text = extractText(children);
                      const id = slugify(text);
                      return <h2 id={id} className="scroll-mt-6" {...props}>{children}</h2>;
                    },
                    h3: ({ children, ...props }) => {
                      const text = extractText(children);
                      const id = slugify(text);
                      return <h3 id={id} className="scroll-mt-6" {...props}>{children}</h3>;
                    },
                  }}
                >
                  {activeDoc.content}
                </ReactMarkdown>
              </article>
              {/* Footer */}
              <div className="mt-16 mb-8 border-t border-border pt-6 text-center">
                <span className="font-mono text-[10px] text-muted-foreground/40">
                  Generated by <Link href="/" className="hover:text-muted-foreground/60 transition-colors">Meter</Link>
                  {activeDoc.updatedAt && ` · Updated ${new Date(activeDoc.updatedAt).toLocaleDateString()}`}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-[13px] text-muted-foreground/50">Select a tab to view content</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
