"use client";

import { useState } from "react";
import { useMeterStore } from "@/lib/store";
import { CONNECTORS } from "@/lib/connectors";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ApiKeyDialogProps {
  provider: string;
  onClose: () => void;
}

export function ApiKeyDialog({ provider, onClose }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitApiKey = useMeterStore((s) => s.submitApiKey);
  const connector = CONNECTORS.find((c) => c.id === provider);

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await submitApiKey(provider, apiKey.trim());
      if (result.ok) {
        onClose();
      } else {
        setError(result.error ?? "Failed to save API key");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Connect {connector?.name ?? provider}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px] text-muted-foreground/60">
            Enter your API key to connect {connector?.name ?? provider}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="API key..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="font-mono text-sm"
            autoFocus
          />
          {error && (
            <p className="font-mono text-[11px] text-red-400">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !apiKey.trim()}
              className="rounded-md bg-foreground px-3 py-1.5 font-mono text-[11px] text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
