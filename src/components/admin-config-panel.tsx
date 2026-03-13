"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MODELS } from "@/lib/models";
import { SLASH_COMMANDS } from "@/lib/connectors";
import { apiUrl } from "@/lib/api-url";
import { useMeterStore } from "@/lib/store";

// ── Types ──

interface AdminConfig {
  markupMultiplier: number;
  enabledModels: string[];
  enabledCommands: string[];
  freeUsdCredit: number;
}

type Tab = "pricing" | "models" | "commands";

const CONFIGURABLE_MODELS = MODELS.filter((m) => m.id !== "auto");

// ── Main Panel ──

export function AdminConfigPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("pricing");
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch config when panel opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(apiUrl("/api/admin/config"))
      .then((r) => r.json())
      .then((d) => setConfig(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const save = useCallback(async (updates: Partial<AdminConfig>) => {
    const res = await fetch(apiUrl("/api/admin/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setConfig(updated);
      // Propagate to store so the app reflects changes immediately
      useMeterStore.getState().setAdminConfig({
        markupMultiplier: updated.markupMultiplier,
        enabledModels: updated.enabledModels,
        enabledCommands: updated.enabledCommands,
      });
    }
  }, []);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-50 mt-2 w-[380px] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
    >
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {(["pricing", "models", "commands"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              tab === t
                ? "text-foreground border-b-2 border-foreground"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading || !config ? (
        <div className="px-4 py-8 text-center font-mono text-[11px] text-muted-foreground/40">
          loading...
        </div>
      ) : (
        <>
          {tab === "pricing" && <PricingTab config={config} onSave={save} />}
          {tab === "models" && <ModelsTab config={config} onSave={save} />}
          {tab === "commands" && <CommandsTab config={config} onSave={save} />}
        </>
      )}
    </div>
  );
}

// ── Pricing Tab ──

function PricingTab({ config, onSave }: { config: AdminConfig; onSave: (u: Partial<AdminConfig>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [markup, setMarkup] = useState(String(config.markupMultiplier));
  const [freeCredit, setFreeCredit] = useState(String(config.freeUsdCredit));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const m = parseFloat(markup);
    const f = parseFloat(freeCredit);
    if (isNaN(m) || m < 1) return;
    if (isNaN(f) || f < 0) return;
    setSaving(true);
    await onSave({ markupMultiplier: m, freeUsdCredit: f });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setMarkup(String(config.markupMultiplier));
    setFreeCredit(String(config.freeUsdCredit));
    setEditing(false);
  };

  return (
    <div className="p-4 space-y-5">
      {/* Markup Multiplier */}
      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
          Markup Multiplier
        </label>
        <p className="text-[10px] text-muted-foreground/40 mb-2">
          Applied to all base model prices for all users
        </p>
        <input
          type="text"
          value={markup}
          onChange={(e) => setMarkup(e.target.value)}
          disabled={!editing}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-2xl text-foreground tabular-nums disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-foreground/20"
        />
      </div>

      {/* Free Credit for New Users */}
      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
          Free Credit (New Users)
        </label>
        <p className="text-[10px] text-muted-foreground/40 mb-2">
          USD credited to every new account on signup
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg text-muted-foreground">$</span>
          <input
            type="text"
            value={freeCredit}
            onChange={(e) => setFreeCredit(e.target.value)}
            disabled={!editing}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-lg text-foreground tabular-nums disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-foreground/20"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={handleCancel}
              className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-foreground text-background px-3 py-2 font-mono text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Models Tab ──

function ModelsTab({ config, onSave }: { config: AdminConfig; onSave: (u: Partial<AdminConfig>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(config.enabledModels);
  const [saving, setSaving] = useState(false);

  // Empty array = all enabled
  const isAllEnabled = selected.length === 0;

  const toggle = (id: string) => {
    if (!editing) return;
    setSelected((prev) => {
      // If currently "all enabled" (empty), switch to "all except this one"
      if (prev.length === 0) {
        return CONFIGURABLE_MODELS.filter((m) => m.id !== id).map((m) => m.id);
      }
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    // If all models are selected, save as empty array (convention for "all enabled")
    const allSelected = CONFIGURABLE_MODELS.every((m) => selected.includes(m.id));
    await onSave({ enabledModels: allSelected ? [] : selected });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setSelected(config.enabledModels);
    setEditing(false);
  };

  return (
    <div className="p-4 space-y-3">
      <p className="text-[10px] text-muted-foreground/40">
        {isAllEnabled ? "All models enabled" : `${selected.length} of ${CONFIGURABLE_MODELS.length} models enabled`}
      </p>

      <div className="space-y-1">
        {CONFIGURABLE_MODELS.map((m) => {
          const checked = isAllEnabled || selected.includes(m.id);
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              disabled={!editing}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-default"
            >
              <div
                className={`h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors ${
                  checked ? "bg-foreground border-foreground" : "border-border"
                }`}
              >
                {checked && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-background">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: m.color }}
              />
              <span className="font-mono text-xs text-foreground">{m.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground/50 ml-auto">{m.provider}</span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={handleCancel}
              className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-foreground text-background px-3 py-2 font-mono text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Commands Tab ──

function CommandsTab({ config, onSave }: { config: AdminConfig; onSave: (u: Partial<AdminConfig>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(config.enabledCommands);
  const [saving, setSaving] = useState(false);

  const isAllEnabled = selected.length === 0;

  const toggle = (name: string) => {
    if (!editing) return;
    setSelected((prev) => {
      if (prev.length === 0) {
        return SLASH_COMMANDS.filter((c) => c.command !== name).map((c) => c.command);
      }
      return prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const allSelected = SLASH_COMMANDS.every((c) => selected.includes(c.command));
    await onSave({ enabledCommands: allSelected ? [] : selected });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setSelected(config.enabledCommands);
    setEditing(false);
  };

  return (
    <div className="p-4 space-y-3">
      <p className="text-[10px] text-muted-foreground/40">
        {isAllEnabled ? "All commands enabled" : `${selected.length} of ${SLASH_COMMANDS.length} commands enabled`}
      </p>

      <div className="space-y-1">
        {SLASH_COMMANDS.map((cmd) => {
          const checked = isAllEnabled || selected.includes(cmd.command);
          return (
            <button
              key={cmd.command}
              onClick={() => toggle(cmd.command)}
              disabled={!editing}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-default"
            >
              <div
                className={`h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors ${
                  checked ? "bg-foreground border-foreground" : "border-border"
                }`}
              >
                {checked && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-background">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60 shrink-0">
                <path d={cmd.iconPath} />
              </svg>
              <span className="font-mono text-xs text-foreground">/{cmd.command}</span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={handleCancel}
              className="flex-1 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-foreground text-background px-3 py-2 font-mono text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Gear Button (exported for use in log page header) ──

export function AdminConfigButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        title="Configure"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <AdminConfigPanel open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
