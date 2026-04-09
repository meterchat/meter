"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PortalDocument {
  id: string;
  filePath: string;
  content: string;
  category: string | null;
  lastGeneratedAt: string | null;
  updatedAt: string | null;
}

interface DocsConfigPage {
  path: string;
  label: string;
}

interface DocsConfigSection {
  section: string;
  pages: DocsConfigPage[];
}

interface DocsConfig {
  title: string;
  description?: string;
  navigation: DocsConfigSection[];
}

interface PortalData {
  workspace: { name: string; slug: string; handle: string; createdAt: string };
  documents: PortalDocument[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_ORDER = ["strategy", "technical", "design", "business", "notes", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  strategy: "Strategy",
  technical: "Technical",
  design: "Design",
  business: "Business",
  notes: "Notes",
  other: "Other",
};

function inferCategory(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (/readme|architecture|decisions|claude|cursorrules/.test(lower)) return "strategy";
  if (/api|schema|spec|config|setup/.test(lower)) return "technical";
  if (/design|brand|style|ui|ux/.test(lower)) return "design";
  if (/budget|revenue|runway|pitch|investor|business/.test(lower)) return "business";
  if (/notes|meeting|standup|retro|log/.test(lower)) return "notes";
  return "other";
}

function groupDocuments(docs: PortalDocument[]) {
  const groups: Record<string, PortalDocument[]> = {};
  for (const doc of docs) {
    const cat = doc.category || inferCategory(doc.filePath);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(doc);
  }
  return CATEGORY_ORDER
    .filter((cat) => groups[cat]?.length)
    .map((cat) => ({ category: cat, items: groups[cat] }));
}

function parseDocsConfig(docs: PortalDocument[]): DocsConfig | null {
  const configDoc = docs.find((d) => d.filePath === "_docs_config.json");
  if (!configDoc) return null;
  try {
    const parsed = JSON.parse(configDoc.content);
    if (parsed.title && Array.isArray(parsed.navigation)) return parsed as DocsConfig;
  } catch { /* invalid JSON */ }
  return null;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function FileTree({
  groups,
  activeDocId,
  onSelect,
}: {
  groups: { category: string; items: PortalDocument[] }[];
  activeDocId: string | null;
  onSelect: (doc: PortalDocument) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-1">
      {groups.map(({ category, items }) => (
        <div key={category}>
          <button
            onClick={() => toggle(category)}
            className="flex w-full items-center gap-1.5 py-1.5 px-2 rounded-md hover:bg-foreground/[0.04] transition-colors"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-muted-foreground/50 transition-transform ${collapsed.has(category) ? "" : "rotate-90"}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="font-mono text-[11px] text-muted-foreground/70 uppercase tracking-wider">
              {CATEGORY_LABELS[category] ?? category}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
              {items.length}
            </span>
          </button>

          {!collapsed.has(category) && (
            <div className="ml-4 border-l border-border pl-1">
              {items.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => onSelect(doc)}
                  className={`flex w-full items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
                    activeDocId === doc.id
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground/90"
                  }`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 opacity-50"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate font-mono text-[12px]">
                    {doc.filePath}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function StructuredNav({
  config,
  documents,
  activeDocId,
  onSelect,
}: {
  config: DocsConfig;
  documents: PortalDocument[];
  activeDocId: string | null;
  onSelect: (doc: PortalDocument) => void;
}) {
  const docByPath = useMemo(() => {
    const map = new Map<string, PortalDocument>();
    for (const d of documents) map.set(d.filePath, d);
    return map;
  }, [documents]);

  return (
    <nav className="flex flex-col gap-3">
      {config.navigation.map((section) => (
        <div key={section.section}>
          <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider px-2 mb-1.5">
            {section.section}
          </div>
          <div className="flex flex-col gap-0.5">
            {section.pages.map((page) => {
              const doc = docByPath.get(page.path);
              if (!doc) return null;
              return (
                <button
                  key={page.path}
                  onClick={() => onSelect(doc)}
                  className={`flex w-full items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors ${
                    activeDocId === doc.id
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground/90"
                  }`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 opacity-50"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate text-[12px]">
                    {page.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function CoverPage({ config }: { config: DocsConfig }) {
  const totalPages = config.navigation.reduce((sum, s) => sum + s.pages.length, 0);
  return (
    <div className="max-w-2xl mx-auto py-16">
      <h1 className="text-3xl font-medium text-foreground mb-3">{config.title}</h1>
      {config.description && (
        <p className="text-muted-foreground/70 text-base mb-10 leading-relaxed">{config.description}</p>
      )}
      <div className="grid gap-6">
        {config.navigation.map((section) => (
          <div key={section.section} className="border border-border rounded-lg p-5">
            <h2 className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-3">
              {section.section}
            </h2>
            <div className="flex flex-col gap-1.5">
              {section.pages.map((page) => (
                <div key={page.path} className="text-[13px] text-muted-foreground/80 flex items-center gap-2">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {page.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 font-mono text-[11px] text-muted-foreground/40">
        {totalPages} page{totalPages !== 1 ? "s" : ""} across {config.navigation.length} section{config.navigation.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function DocumentViewer({ doc }: { doc: PortalDocument }) {
  const updated = formatDate(doc.updatedAt) || formatDate(doc.lastGeneratedAt);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Document header */}
      <div className="mb-8 pb-6 border-b border-border">
        <h1 className="text-2xl font-medium text-foreground mb-1">
          {doc.filePath}
        </h1>
        {updated && (
          <p className="font-mono text-[11px] text-muted-foreground/50">
            Last updated {updated}
          </p>
        )}
      </div>

      {/* Rendered markdown content */}
      <div className="prose prose-invert prose-sm max-w-none
        prose-headings:text-foreground prose-headings:font-medium
        prose-h1:text-xl prose-h1:mb-4 prose-h1:mt-8
        prose-h2:text-lg prose-h2:mb-3 prose-h2:mt-6
        prose-h3:text-base prose-h3:mb-2 prose-h3:mt-4
        prose-p:text-foreground/70 prose-p:leading-relaxed prose-p:mb-3
        prose-li:text-foreground/70 prose-li:leading-relaxed
        prose-strong:text-foreground prose-strong:font-medium
        prose-code:text-[#D97757] prose-code:text-[13px] prose-code:font-mono
        prose-code:bg-foreground/[0.05] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-[#141414] prose-pre:border prose-pre:border-border prose-pre:rounded-lg
        prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
        prose-table:text-[13px] prose-th:text-muted-foreground/80 prose-th:font-mono prose-th:text-[11px]
        prose-td:text-foreground/70 prose-td:border-border prose-th:border-border
        prose-hr:border-border
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {doc.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page — docs.meter.chat/{handle}/{workspace}                        */
/* ------------------------------------------------------------------ */

export default function DocsPortalPage() {
  const { handle, workspace } = useParams<{ handle: string; workspace: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!handle || !workspace) return;
    setLoading(true);
    fetch(`/api/portal/${encodeURIComponent(handle)}/${encodeURIComponent(workspace)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Portal not found" : "Failed to load");
        return res.json();
      })
      .then((d: PortalData) => {
        setData(d);
        // If there's a docs config, start on the cover page (no doc selected)
        const hasConfig = d.documents.some((doc) => doc.filePath === "_docs_config.json");
        if (!hasConfig) {
          // Auto-select first document (prefer README)
          const readme = d.documents.find((doc) =>
            doc.filePath.toLowerCase().includes("readme"),
          );
          setActiveDocId(readme?.id ?? d.documents[0]?.id ?? null);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [handle, workspace]);

  const docsConfig = useMemo(
    () => (data ? parseDocsConfig(data.documents) : null),
    [data],
  );

  // Filter out _docs_config.json from visible documents
  const visibleDocs = useMemo(
    () => (data?.documents.filter((d) => d.filePath !== "_docs_config.json") ?? []),
    [data],
  );

  const groups = useMemo(
    () => groupDocuments(visibleDocs),
    [visibleDocs],
  );

  const activeDoc = useMemo(
    () => visibleDocs.find((d) => d.id === activeDocId) ?? null,
    [visibleDocs, activeDocId],
  );

  /* Loading / Error states */
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
          <div className="font-mono text-[13px] text-muted-foreground/70">
            {error || "Portal not found"}
          </div>
          <Link
            href="/"
            className="font-mono text-[12px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
          >
            Go to Meter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } shrink-0 border-r border-border transition-all duration-200 overflow-hidden flex flex-col`}
      >
        <div className="p-4 pb-3 border-b border-border flex items-center gap-3">
          <Link href="/">
            <Image
              src="/logo-dark-copy.webp"
              alt="Meter"
              width={48}
              height={14}
              className="opacity-50 hover:opacity-80 transition-opacity hidden dark:block"
            />
            <Image
              src="/logo-light.webp"
              alt="Meter"
              width={48}
              height={14}
              className="opacity-50 hover:opacity-80 transition-opacity block dark:hidden"
            />
          </Link>
        </div>

        {/* Workspace / site name */}
        <div className="px-4 py-3 border-b border-border">
          <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">
            {data.workspace.handle}
          </div>
          <div className="text-[13px] text-foreground/90 font-medium truncate">
            {docsConfig?.title ?? data.workspace.name}
          </div>
          {docsConfig?.description && (
            <div className="text-[11px] text-muted-foreground/50 mt-1 leading-relaxed line-clamp-2">
              {docsConfig.description}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto p-3">
          {docsConfig ? (
            <StructuredNav
              config={docsConfig}
              documents={visibleDocs}
              activeDocId={activeDocId}
              onSelect={(doc) => setActiveDocId(doc.id)}
            />
          ) : (
            <FileTree
              groups={groups}
              activeDocId={activeDocId}
              onSelect={(doc) => setActiveDocId(doc.id)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border">
          <div className="font-mono text-[10px] text-muted-foreground/40 text-center">
            {data.documents.length} document{data.documents.length !== 1 ? "s" : ""}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-foreground/[0.05] transition-colors"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground/60"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>

          {activeDoc && (
            <span className="font-mono text-[12px] text-muted-foreground/70 truncate">
              {activeDoc.filePath}
            </span>
          )}
        </div>

        {/* Document viewer */}
        <div className="flex-1 overflow-y-auto p-8">
          {activeDoc ? (
            <DocumentViewer doc={activeDoc} />
          ) : docsConfig ? (
            <CoverPage config={docsConfig} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="font-mono text-[13px] text-muted-foreground/50 mb-2">
                  No documents yet
                </div>
                <div className="font-mono text-[11px] text-muted-foreground/40">
                  Documents will appear here once generated
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
