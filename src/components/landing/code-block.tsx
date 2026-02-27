import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Copy } from "lucide-react";

interface CodeBlockProps {
  filename: string;
  children: ReactNode;
  className?: string;
}

export function CodeBlock({ filename, children, className }: CodeBlockProps) {
  return (
    <div className={cn("bg-card border border-border rounded-lg overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
          </div>
          <span className="text-xs font-medium text-foreground bg-background px-2.5 py-1 rounded">
            {filename}
          </span>
        </div>
        <button className="p-1.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-muted-foreground">
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-4 font-mono text-xs overflow-x-auto">{children}</div>
    </div>
  );
}
