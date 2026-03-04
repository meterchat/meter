"use client";

import Link from "next/link";
import Image from "next/image";

/** Minimal markdown → HTML for legal docs (headings, paragraphs, bold, lists). */
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Headings
    if (trimmed.startsWith("# ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h1 class="text-lg font-semibold text-foreground mt-8 mb-3">${esc(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("## ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h2 class="text-sm font-semibold text-foreground mt-6 mb-2">${esc(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("### ")) {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<h3 class="text-sm font-medium text-foreground mt-4 mb-1">${esc(trimmed.slice(4))}</h3>`);
    } else if (trimmed === "") {
      if (inList) { html.push("</ul>"); inList = false; }
    } else {
      // Paragraph or list item — inline bold
      const content = esc(trimmed).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html.push(`<p class="text-sm text-muted-foreground leading-relaxed mb-2">${content}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("\n");
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function LegalPage({ markdown }: { markdown: string }) {
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="inline-block mb-8">
          <Image
            src="/logo-dark-copy.webp"
            alt="Meter"
            width={80}
            height={22}
            className="hidden dark:block opacity-60 hover:opacity-100 transition-opacity"
          />
          <Image
            src="/logo-light.webp"
            alt="Meter"
            width={80}
            height={22}
            className="block dark:hidden opacity-60 hover:opacity-100 transition-opacity"
          />
        </Link>
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
        <div className="mt-12 pt-6 border-t border-border">
          <Link href="/" className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors font-mono">
            &larr; Back to Meter
          </Link>
        </div>
      </div>
    </div>
  );
}
