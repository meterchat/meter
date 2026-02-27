"use client";

import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useMeterStore } from "@/lib/store";
import { shortModelName } from "@/lib/models";

const BASE_EXPLORER = "https://basescan.org/tx/";

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const projectId = search.get("project");
  const projects = useMeterStore((s) => s.projects);

  const message = useMemo(() => {
    const inProject = projects.find((p) => p.id === projectId) ?? projects[0];
    return inProject?.messages.find((m) => m.id === params.id);
  }, [projects, projectId, params.id]);

  if (!message) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Receipt not found.</div>;
  }

  const totalTokens = (message.tokensIn ?? 0) + (message.tokensOut ?? 0);
  const when = new Date(message.timestamp);
  const isSettled = message.receiptStatus === "settled";
  const statusText = isSettled ? "Settled on Base" : "Signed · Pending settlement";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
        <h1 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Message Receipt</h1>

        <div className="space-y-2 text-sm">
          <p>Time: {when.toLocaleString()}</p>
          <p>Model: {message.model ? shortModelName(message.model) : "—"}</p>
          <p>Tokens: {totalTokens.toLocaleString()}</p>
          <p>Cost: ${(message.cost ?? 0).toFixed(4)}</p>
          <p>
            Status:{" "}
            <span className={isSettled ? "text-emerald-400" : "text-amber-400"}>
              {statusText}
            </span>
          </p>
        </div>

        <div className="my-4 h-px bg-border" />

        <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
          <p>Signed by: meter.base.eth</p>
          <p>Signature: {message.signature ?? "pending"}</p>
          {message.txHash && (
            <p>
              Tx:{" "}
              <a
                href={`${BASE_EXPLORER}${message.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                {message.txHash.slice(0, 10)}...{message.txHash.slice(-8)}
                <span className="ml-1">↗</span>
              </a>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-foreground/5 transition-colors">
            Verify Signature
          </button>
          {message.txHash && (
            <a
              href={`${BASE_EXPLORER}${message.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-foreground/5 transition-colors"
            >
              View on Base
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
