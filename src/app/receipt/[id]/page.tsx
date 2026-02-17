"use client";

import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useMeterStore } from "@/lib/store";
import { shortModelName } from "@/lib/models";

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
  const statusText = message.receiptStatus === "settled" ? "Settled on Base" : "Signed · Settles tonight";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
        <h1 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Message Receipt</h1>

        <div className="space-y-2 text-sm">
          <p>Time: {when.toLocaleString()}</p>
          <p>Model: {message.model ? shortModelName(message.model) : "—"}</p>
          <p>Tokens: {totalTokens.toLocaleString()}</p>
          <p>Cost: ${(message.cost ?? 0).toFixed(4)}</p>
          <p>Status: {statusText}</p>
        </div>

        <div className="my-4 h-px bg-border" />

        <div className="space-y-2 font-mono text-[11px] text-muted-foreground">
          <p>Signed by: meter.base.eth</p>
          <p>Signature: {message.signature ?? "pending"}</p>
          {message.txHash && <p>Tx: {message.txHash}</p>}
        </div>

        <button className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-foreground/5">
          Verify Signature
        </button>
      </div>
    </div>
  );
}
