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
  workspace: { name: string; slug: string; handle: string; createdAt: string; logoUrl?: string | null; iconUrl?: string | null };
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
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [tabDropdownOpen, setTabDropdownOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);
  const tabDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    if (!tabDropdownOpen && !copyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(e.target as Node)) setTabDropdownOpen(false);
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) setCopyMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tabDropdownOpen, copyMenuOpen]);

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

  // Scroll spy — observe all h2/h3 elements with IDs in the content area
  useEffect(() => {
    const root = contentRef.current;
    if (!root || headings.length === 0) return;
    let observer: IntersectionObserver | null = null;
    const timer = setTimeout(() => {
      const elements = root.querySelectorAll("h2[id], h3[id]");
      if (elements.length === 0) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.target.id) {
              setActiveHeading(entry.target.id);
            }
          }
        },
        { root, rootMargin: "0px 0px -75% 0px", threshold: 0.1 },
      );
      elements.forEach((el) => observer!.observe(el));
    }, 200);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
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
    setCopyMenuOpen(false);
    setTimeout(() => setCopied(false), 1500);
  }, [activeDoc]);

  const handleOpenInChatGPT = useCallback(() => {
    if (!activeDoc) return;
    const text = encodeURIComponent(activeDoc.content.slice(0, 10000));
    window.open(`https://chatgpt.com/?q=${text}`, "_blank");
    setCopyMenuOpen(false);
  }, [activeDoc]);

  const handleOpenInClaude = useCallback(() => {
    if (!activeDoc) return;
    navigator.clipboard.writeText(activeDoc.content);
    window.open("https://claude.ai/new", "_blank");
    setCopyMenuOpen(false);
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
      {/* Header — breadcrumb style */}
      <header className="shrink-0 border-b border-border/40">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 font-sans text-[13px]">
            {/* Workspace branding */}
            {data.workspace.logoUrl ? (
              <img src={data.workspace.logoUrl} alt={data.workspace.name} className="h-6 w-auto" />
            ) : data.workspace.iconUrl ? (
              <div className="flex items-center gap-2">
                <img src={data.workspace.iconUrl} alt="" className="h-5 w-5 rounded" />
                <span className="font-semibold text-foreground">{data.workspace.name}</span>
              </div>
            ) : (
              <span className="font-semibold text-foreground">{data.workspace.name}</span>
            )}
            <span className="text-muted-foreground/30">/</span>
            {/* Tab dropdown */}
            <div className="relative" ref={tabDropdownRef}>
              <button
                onClick={() => setTabDropdownOpen(!tabDropdownOpen)}
                className="flex items-center gap-1.5 text-muted-foreground/80 hover:text-foreground transition-colors"
              >
                {TAB_LABELS[activeTab ?? ""] ?? activeTab}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                  <polyline points="7 10 12 5 17 10" /><polyline points="7 14 12 19 17 14" />
                </svg>
              </button>
              {tabDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => { setActiveTab(tab); setTabDropdownOpen(false); }}
                      className={`flex w-full items-center px-3 py-2 text-left text-[13px] transition-colors hover:bg-foreground/[0.03] ${
                        activeTab === tab ? "text-foreground font-medium" : "text-muted-foreground/70"
                      }`}
                    >
                      {TAB_LABELS[tab] ?? tab}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Copy dropdown */}
          <div className="relative" ref={copyMenuRef}>
            <button
              onClick={() => setCopyMenuOpen(!copyMenuOpen)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-sans text-[12px] text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03] transition-colors"
            >
              {copied ? "Copied!" : "Copy page"}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {copyMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                <button onClick={handleCopyAll} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-foreground/[0.03] transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-muted-foreground/60">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  <div>
                    <div className="font-sans text-[12px] text-foreground/80">Copy page</div>
                    <div className="font-sans text-[10px] text-muted-foreground/50">Copy as Markdown for LLMs</div>
                  </div>
                </button>
                <button onClick={handleOpenInChatGPT} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-foreground/[0.03] transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 shrink-0 text-muted-foreground/60">
                    <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 0011.741.253a6.04 6.04 0 00-5.765 4.17 5.982 5.982 0 00-3.996 2.9 6.049 6.049 0 00.743 7.097 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 23.75a6.023 6.023 0 005.738-4.186 5.98 5.98 0 003.997-2.9 6.045 6.045 0 00-.713-6.843z"/>
                  </svg>
                  <div>
                    <div className="font-sans text-[12px] text-foreground/80">Open in ChatGPT</div>
                    <div className="font-sans text-[10px] text-muted-foreground/50">Ask questions about this page</div>
                  </div>
                </button>
                <button onClick={handleOpenInClaude} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-foreground/[0.03] transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 shrink-0 text-muted-foreground/60">
                    <path d="M4.709 15.955l4.71-11.91h2.828L7.537 15.955H4.709zm7.065 0l4.71-11.91h2.807L14.602 15.955h-2.828z"/>
                  </svg>
                  <div>
                    <div className="font-sans text-[12px] text-foreground/80">Open in Claude</div>
                    <div className="font-sans text-[10px] text-muted-foreground/50">Copies to clipboard, opens Claude</div>
                  </div>
                </button>
                <div className="mx-2 my-1 h-px bg-border" />
                <button onClick={handleDownload} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-foreground/[0.03] transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-muted-foreground/60">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <div>
                    <div className="font-sans text-[12px] text-foreground/80">Download MD</div>
                    <div className="font-sans text-[10px] text-muted-foreground/50">Save as Markdown file</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content + TOC */}
      <div className="flex flex-1 overflow-hidden">
        {/* TOC Sidebar */}
        {headings.length > 0 && (
          <aside className="hidden lg:block w-64 shrink-0 overflow-y-auto pl-8 pr-6 pt-8 pb-6">
            <nav className="flex flex-col gap-0.5">
              {headings.map((h) => {
                if (h.level === 2) {
                  return (
                    <div
                      key={h.id}
                      className={`text-left py-2 mt-3 first:mt-0 font-sans text-[13px] font-semibold transition-colors ${
                        activeHeading === h.id ? "text-foreground" : "text-foreground/70"
                      }`}
                    >
                      {h.text}
                    </div>
                  );
                }
                return (
                  <button
                    key={h.id}
                    onClick={() => scrollToHeading(h.id)}
                    className={`text-left py-1 pl-3 font-sans text-[13px] transition-colors ${
                      activeHeading === h.id
                        ? "text-foreground font-medium"
                        : "text-foreground/50 hover:text-foreground/80"
                    }`}
                  >
                    {h.text}
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        {/* Main content */}
        <main ref={contentRef} className="flex-1 overflow-y-auto">
          {activeDoc ? (
            <div className="max-w-2xl px-16 pt-8 pb-8 ml-20">
              {/* Page title */}
              <h1 className="font-sans text-[26px] font-bold text-foreground mb-8">{TAB_LABELS[activeTab ?? ""] ?? data.workspace.name}</h1>
              <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-sans prose-headings:font-semibold prose-p:text-foreground/80 prose-li:text-foreground/80 prose-a:text-blue-500 dark:prose-a:text-blue-400 prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-border prose-code:text-orange-600 dark:prose-code:text-orange-400">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={(() => {
                    const seen = new Map<string, number>();
                    const makeId = (text: string) => {
                      let id = slugify(text);
                      const count = seen.get(id) ?? 0;
                      if (count > 0) id = `${id}-${count}`;
                      seen.set(id, count + 1);
                      return id;
                    };
                    return {
                      h2: ({ children, ...props }: React.ComponentProps<"h2">) => {
                        const text = extractText(children);
                        return <h2 id={makeId(text)} className="scroll-mt-6" {...props}>{children}</h2>;
                      },
                      h3: ({ children, ...props }: React.ComponentProps<"h3">) => {
                        const text = extractText(children);
                        return <h3 id={makeId(text)} className="scroll-mt-6" {...props}>{children}</h3>;
                      },
                    };
                  })()}
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
