"use client";

import { useEffect, useState } from "react";
import { useMeterStore } from "@/lib/store";
import { apiUrl } from "@/lib/api-url";
import {
  trackProfileOpened,
  trackAccountDeleted,
  trackUserLoggedOut,
} from "@/lib/analytics";

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground font-mono">{value}</span>
    </div>
  );
}

export function ProfileSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useMeterStore((s) => s.userId);
  const email = useMeterStore((s) => s.email);
  const logout = useMeterStore((s) => s.logout);

  const [passkeys, setPasskeys] = useState<Array<{ credentialId: string; deviceType: string | null; backedUp: boolean; createdAt: string }>>([]);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    trackProfileOpened();
    fetch(apiUrl("/api/auth/passkeys"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.passkeys) setPasskeys(data.passkeys);
      })
      .catch(() => {});
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    setDeleteError(null);
    setDeleteConfirm("");
    setDeleteOpen(false);
  }, [open]);

  const handleDeleteAccount = async () => {
    if (!userId || deleteConfirm !== "delete account") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(apiUrl("/api/account/delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Deletion failed" }));
        setDeleteError(body.error ?? "Deletion failed");
        setDeleting(false);
        return;
      }
      trackAccountDeleted();
      trackUserLoggedOut();
      await logout();
    } catch {
      setDeleteError("Deletion failed");
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Profile Settings
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close profile settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4">
            <div>
              <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">
                Account
              </div>
              <StatRow label="Email" value={email ?? "—"} />
              {passkeys.length > 0 && (
                <div className="mt-2">
                  {passkeys.map((pk) => (
                    <div key={pk.credentialId} className="flex items-center gap-2 py-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60">
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                      </svg>
                      <span className="text-xs text-muted-foreground">
                        Passkey{pk.deviceType ? ` (${pk.deviceType})` : ""}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/40">
                        {pk.backedUp ? "Synced" : "Local"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">
                Model Preferences
              </div>
              <p className="font-mono text-[10px] text-muted-foreground/40">
                Auto-routing picks the best model per message. You can override per-message in the composer.
              </p>
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">
                Data
              </div>
              <p className="font-mono text-[10px] text-muted-foreground/40 mb-2">
                Your conversation persists as one eternal session per workspace.
              </p>
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="font-mono text-[10px] text-red-400/60 uppercase tracking-wider mb-2">
                Danger Zone
              </div>
              <div className="rounded-lg border border-red-500/20 p-3">
                <p className="font-mono text-[10px] text-muted-foreground/60 mb-3">
                  Permanently delete your account and all associated data. This cannot be undone.
                </p>
                {!deleteOpen ? (
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="rounded-lg border border-red-500/30 px-3 py-1.5 font-mono text-[10px] text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    Delete Account
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] text-muted-foreground/60">
                      Type <span className="text-foreground">delete account</span> to confirm:
                    </p>
                    <input
                      autoFocus
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-red-500/50"
                      placeholder="delete account"
                    />
                    {deleteError && (
                      <p className="font-mono text-[10px] text-red-400">{deleteError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); setDeleteError(null); }}
                        className="flex-1 rounded-lg border border-border py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleteConfirm !== "delete account" || deleting}
                        className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 font-mono text-[10px] text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                      >
                        {deleting ? "Deleting..." : "Confirm Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
