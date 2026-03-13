"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useMeterStore, normalizeReceiptStatus, type ChatMessage } from "@/lib/store";
import { shortModelName } from "@/lib/models";


export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const projectId = search.get("session") ?? search.get("project");
  const sessions = useMeterStore((s) => s.sessions);

  // Try local store first (works when opened in same tab)
  const localMessage = useMemo(() => {
    const inSession = sessions.find((p) => p.id === projectId) ?? sessions[0];
    return inSession?.messages.find((m) => m.id === params.id);
  }, [sessions, projectId, params.id]);

  // Fallback: fetch from server when not in local store (new tab)
  const [serverMessage, setServerMessage] = useState<ChatMessage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localMessage || !projectId || !params.id) return;
    setLoading(true);
    fetch(`/api/receipt/${encodeURIComponent(params.id)}?session=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.message) {
          const m = data.message;
          setServerMessage({
            id: m.id,
            role: m.role,
            content: m.content ?? "",
            model: m.model ?? undefined,
            tokensIn: m.tokens_in ?? undefined,
            tokensOut: m.tokens_out ?? undefined,
            cacheCreationTokens: m.cache_creation_tokens ?? undefined,
            cacheReadTokens: m.cache_read_tokens ?? undefined,
            cost: m.cost != null ? Number(m.cost) : undefined,
            confidence: m.confidence ?? undefined,
            settled: m.settled ?? undefined,
            receiptStatus: normalizeReceiptStatus(m.receipt_status),
            timestamp: m.timestamp,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [localMessage, projectId, params.id]);

  const message = localMessage ?? serverMessage;

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading receipt...</div>;
  }

  if (!message) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Receipt not found.</div>;
  }

  const tokensIn = message.tokensIn ?? 0;
  const tokensOut = message.tokensOut ?? 0;
  const when = new Date(message.timestamp);
  const isSettled = message.receiptStatus === "settled";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
        <h1 className="mb-4 font-mono text-sm uppercase tracking-wider text-muted-foreground">Message Receipt</h1>

        <div className="space-y-2 text-sm">
          <p>Time: {when.toLocaleString()}</p>
          <p>Model: {message.model ? shortModelName(message.model) : "—"}</p>
          <p>Input tokens: {tokensIn.toLocaleString()}</p>
          <p>Output tokens: {tokensOut.toLocaleString()}</p>
          <p>Cost: ${(message.cost ?? 0).toFixed(4)}</p>
          <p>Status: <span className="text-emerald-400">Metered</span></p>
          <p>
            Settlement:{" "}
            <span className={isSettled ? "text-emerald-400" : "text-amber-400"}>
              {isSettled ? "Settled" : "Pending"}
            </span>
          </p>
        </div>

      </div>
    </div>
  );
}
