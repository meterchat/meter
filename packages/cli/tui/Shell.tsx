/**
 * Meter interactive shell.
 *
 * Render rules (keep it flicker-free):
 *   • The screen is cleared once by bin before Ink mounts — never from here.
 *   • All completed output (welcome card, milestones, diffs) goes through <Static>:
 *     written once → native scrollback you can scroll a line at a time, never repainted.
 *   • Only a small fixed region re-renders: optional live status, the input row, an
 *     optional command palette, and a one-line footer. Stays short → incremental
 *     updates, no full clears, no flash.
 */
import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { runMeter, type RunResult } from "../src/loop.ts";
import { gitRoot, loadRepoContext } from "../src/harness/repo.ts";
import { exec } from "../src/harness/exec.ts";
import { shortModelName, SELECTABLE_MODELS, costBadge } from "../src/providers/models.ts";
import {
  createRunHandler, initLive, phaseLabel, costText, type Live, type LogLine,
} from "./runview.tsx";
import type { Candidate, MeterConfig, MeterEvent } from "../src/types.ts";

const VERSION = "0.3.1";
const ACCENT = "green";

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/model", desc: "show or set the model panel — /model id1,id2,id3" },
  { name: "/settings", desc: "show or change run settings — /settings candidates=3 budget=1.0" },
  { name: "/update", desc: "how to update Meter to the latest version" },
  { name: "/clear", desc: "clear the screen" },
  { name: "/help", desc: "show commands and keys" },
  { name: "/exit", desc: "quit Meter" },
];

export interface ShellProps {
  cwd: string;
  config: MeterConfig;
  dateISO: string;
  hasKey: boolean;
}

function homeShort(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

interface WelcomeData { panel: string; repo: string; cwd: string; hasKey: boolean }
type Item = ({ kind: "welcome"; data: WelcomeData } | ({ kind: "line" } & LogLine)) & { key: string };

let lineKey = 0;
const k = () => `l${lineKey++}`;

function WelcomeCard({ data, width }: { data: WelcomeData; width: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={width}>
      <Text><Text bold color={ACCENT}>meter</Text><Text dimColor> v{VERSION} · Meter CLI</Text></Text>
      <Text dimColor>multi-model review — repo verification — one tested diff</Text>
      <Box marginTop={1} flexDirection="column">
        <Text><Text color="cyan">Panel  </Text>{data.panel}</Text>
        <Text><Text color="cyan">Repo   </Text>{data.repo}</Text>
        <Text dimColor>{data.cwd}</Text>
      </Box>
      {!data.hasKey ? <Text color="yellow">⚠ set OPENROUTER_API_KEY to run tasks</Text> : null}
    </Box>
  );
}

export default function Shell({ cwd, config, dateISO, hasKey }: ShellProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = Math.max(40, stdout?.columns ?? 88);

  const [items, setItems] = useState<Item[]>([]);
  const [live, setLive] = useState<Live>(initLive());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Candidate | null>(null);
  const [sessionSpend, setSessionSpend] = useState(0);
  const [branch, setBranch] = useState("");
  const [cfg, setCfg] = useState<MeterConfig>(config);
  const approveResolver = useRef<((ok: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queuedRef = useRef<string | null>(null);

  const append = (lines: LogLine[]) =>
    setItems((prev) => [...prev, ...lines.map((l) => ({ kind: "line" as const, ...l, key: k() }))]);

  // Persistent event handler (keeps debate-turn buffers across renders).
  const handlerRef = useRef<ReturnType<typeof createRunHandler>>();
  handlerRef.current ??= createRunHandler(append, setLive);

  // Load repo context, then print the welcome card as the first Static item.
  useEffect(() => {
    (async () => {
      const root = await gitRoot(cwd);
      let repoLabel = "not a git repo — run inside a repo to use Meter";
      let extra: LogLine | null = null;
      if (root) {
        const repo = await loadRepoContext(root);
        let b = ""; try { b = (await exec("git rev-parse --abbrev-ref HEAD", { cwd: root, timeoutMs: 8000 })).stdout.trim(); } catch { /* ignore */ }
        setBranch(b);
        const verify = [repo.commands.test, repo.commands.typecheck, repo.commands.lint, repo.commands.build].filter(Boolean).join(" · ") || "static gates";
        repoLabel = `${root.split("/").pop()}${b ? ` (${b})` : ""} · tests: ${repo.hasTests ? "found" : "auto-generate"}`;
        extra = { text: `verify: ${verify}`, dim: true };
      }
      setItems((prev) => [
        { kind: "welcome", key: k(), data: { panel: config.panel.map(shortModelName).join(" · "), repo: repoLabel, cwd: homeShort(cwd), hasKey } },
        ...(extra ? [{ kind: "line" as const, key: k(), ...extra }] : []),
        ...prev,
      ]);
    })();
  }, []);

  const dispatch = (e: MeterEvent) => handlerRef.current!(e);

  async function submitTask(task: string) {
    append([{ text: "", dim: true }, { text: `› ${task.replace(/\n/g, " ⏎ ")}`, color: ACCENT, bold: true }]);
    setBusy(true);
    setLive({ ...initLive(), running: true });
    const controller = new AbortController();
    abortRef.current = controller;

    const approve = (winner: Candidate) =>
      new Promise<boolean>((resolve) => {
        append([
          { text: `✓ winner: ${shortModelName(winner.model)} (${winner.id})`, color: ACCENT, bold: true },
          { text: `  ${winner.edits.map((e) => e.path).join(", ")}`, dim: true },
          ...winner.diff.split("\n").slice(0, 40).map((d) => ({
            text: "  " + d,
            color: d.startsWith("+") && !d.startsWith("+++") ? "green" : d.startsWith("-") && !d.startsWith("---") ? "red" : undefined,
            dim: !/^[+-]/.test(d),
          })),
        ]);
        approveResolver.current = resolve;
        setPending(winner);
      });

    let result: RunResult | null = null;
    try {
      result = await runMeter({ task, cwd, config: cfg, send: dispatch, dateISO, approve, signal: controller.signal });
    } catch (err) {
      append([{ text: `✗ ${(err as Error).message}`, color: "red", bold: true }]);
    }
    if (result) {
      const r = result;
      setSessionSpend((s) => s + r.cost.actualCost);
      // Chat answers already streamed via answer_done — just a faint cost line.
      if (r.kind === "chat") {
        append([{ text: `  · $${r.cost.actualCost.toFixed(4)}`, dim: true }]);
      } else {
        const summary = r.winner
          ? r.committed ? `✓ committed ${r.sha} · $${r.cost.actualCost.toFixed(4)}`
            : r.stoppedReason === "declined" ? `· declined — nothing committed · $${r.cost.actualCost.toFixed(4)}`
              : `· not committed · $${r.cost.actualCost.toFixed(4)}`
          : `· ${r.stoppedReason ?? "no winner"} · $${r.cost.actualCost.toFixed(4)}`;
        append([{ text: summary, color: r.committed ? "green" : "yellow" }]);
      }
    }
    abortRef.current = null;
    setPending(null);
    setBusy(false);
    setLive(initLive());

    // Auto-run a task queued while this one was busy.
    const q = queuedRef.current;
    if (q) { queuedRef.current = null; void submitTask(q); }
  }

  function handleSlash(raw: string): boolean {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd.toLowerCase()) {
      case "/exit": case "/quit": case "/q": exit(); return true;
      case "/clear": stdout?.write("\x1b[2J\x1b[3J\x1b[H"); setItems([]); return true;
      case "/help":
        append([
          { text: "commands:", bold: true },
          ...COMMANDS.map((c) => ({ text: `  ${c.name}  —  ${c.desc}`, dim: true })),
          { text: "keys: Enter run · Shift/Opt+Enter newline · Esc clear · Ctrl+C quit · y/n approve", dim: true },
        ]);
        return true;
      case "/update":
        append([{ text: "update: bun add -g @meterxyz/cli@latest", color: "cyan" }]);
        return true;
      case "/model": case "/models":
        if (arg) {
          const ids = arg.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
          setCfg((c) => ({ ...c, panel: ids }));
          append([{ text: `panel set → ${ids.map(shortModelName).join(" · ")}`, color: ACCENT }]);
        } else {
          append([
            { text: `panel: ${cfg.panel.map(shortModelName).join(" · ")}`, bold: true },
            { text: "available:", dim: true },
            ...SELECTABLE_MODELS.map((m) => ({ text: `  ${costBadge(m).padEnd(4)} ${m.id}  (${m.name})`, dim: true })),
            { text: "set with: /model anthropic/claude-opus-4.6,openai/gpt-5.4", dim: true },
          ]);
        }
        return true;
      case "/settings": case "/set": {
        if (arg) {
          const next = { ...cfg };
          for (const pair of arg.split(/\s+/)) {
            const [key, val] = pair.split("=");
            if (key === "candidates") next.candidates = Math.max(1, Number(val) || next.candidates);
            else if (key === "budget") next.budgetUsd = val === "none" ? null : Number(val) || next.budgetUsd;
            else if (key === "repairs") next.maxRepairs = Math.max(0, Number(val) || next.maxRepairs);
            else if (key === "debate") next.skipDebate = val === "off" || val === "false";
          }
          setCfg(next);
          append([{ text: `settings → candidates ${next.candidates} · repairs ${next.maxRepairs} · budget ${next.budgetUsd ?? "none"} · debate ${next.skipDebate ? "off" : "on"}`, color: ACCENT }]);
        } else {
          append([
            { text: "settings:", bold: true },
            { text: `  candidates ${cfg.candidates} · repairs ${cfg.maxRepairs} · budget ${cfg.budgetUsd ?? "none"} · debate ${cfg.skipDebate ? "off" : "on"}`, dim: true },
            { text: `  plan model ${shortModelName(cfg.planModel)}`, dim: true },
            { text: "change: /settings candidates=3 budget=1.0 repairs=2 debate=off", dim: true },
          ]);
        }
        return true;
      }
      default:
        append([{ text: `unknown command ${cmd} — type /help`, color: "yellow" }]);
        return true;
    }
  }

  useInput((ch, key) => {
    if (key.ctrl && (ch === "c" || ch === "d")) { exit(); return; }
    if (key.escape) {
      if (busy && abortRef.current) { abortRef.current.abort(); append([{ text: "  cancelling…", color: "yellow" }]); }
      else setInput("");
      return;
    }

    if (pending && approveResolver.current) {
      if (ch.toLowerCase() === "y") { append([{ text: "  applying…", dim: true }]); approveResolver.current(true); approveResolver.current = null; setPending(null); }
      else if (ch.toLowerCase() === "n") { append([{ text: "  declined", color: "yellow" }]); approveResolver.current(false); approveResolver.current = null; setPending(null); }
      return;
    }

    // Newline: Shift+Enter or Opt/Alt+Enter (terminal-dependent).
    if (key.return && (key.shift || key.meta)) { setInput((s) => s + "\n"); return; }
    // Submit on plain Enter. While a run is in flight, queue it instead.
    if (key.return) {
      const v = input.trim();
      if (!v) { setInput(""); return; }
      setInput("");
      if (busy) {
        queuedRef.current = v;
        append([{ text: `  ⏎ queued: ${v}`, dim: true }]);
        return;
      }
      if (v.startsWith("/") && handleSlash(v)) return;
      submitTask(v);
      return;
    }
    if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return; }
    // Editing allowed even while running, so you can compose the next task.
    if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch);
  });

  // Command palette: filter as the user types after "/".
  const showMenu = input.startsWith("/") && !input.includes(" ") && !busy;
  const menu = showMenu ? COMMANDS.filter((c) => c.name.startsWith(input.toLowerCase())) : [];
  const lines = input.length ? input.split("\n") : [""];

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) =>
          item.kind === "welcome"
            ? <WelcomeCard key={item.key} data={item.data} width={cols - 1} />
            : item.segments
              ? <Text key={item.key} wrap="end">{item.segments.map((s, i) => <Text key={i} color={s.color} dimColor={s.dim} bold={s.bold}>{s.text}</Text>)}</Text>
              : <Text key={item.key} color={item.color} dimColor={item.dim} bold={item.bold} wrap="end">{item.text}</Text>
        }
      </Static>

      {live.running ? (
        <Box marginTop={1}>
          <Text color="cyan"><Spinner type="dots" /> </Text>
          <Text bold>{phaseLabel(live.phase) || "working"} </Text>
          <Text color="cyan">{live.activity}</Text>
          <Text dimColor>   spend </Text><Text color="green" bold>{costText(live.cost)}</Text>
          <Text dimColor>   Esc to cancel</Text>
        </Box>
      ) : null}

      {pending ? <Text color={ACCENT} bold>Apply &amp; commit {pending.id}?  [y]es / [n]o</Text> : null}

      {/* Open, full-width input — top & bottom rules only */}
      {!pending ? (
        <Box flexDirection="column" width={cols} borderStyle="round" borderColor={busy ? "gray" : ACCENT}
             borderLeft={false} borderRight={false} borderTop borderBottom>
          {lines.map((ln, i) => (
            <Box key={i}>
              <Text color={ACCENT}>{i === 0 ? "› " : "  "}</Text>
              <Text>{ln}</Text>
              {i === lines.length - 1 && !busy ? <Text color={ACCENT}>▋</Text> : null}
              {i === 0 && input === "" ? <Text dimColor>{busy ? "running — Esc to cancel · type to queue next" : "type a task · / for commands"}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {/* Command palette */}
      {menu.length ? (
        <Box flexDirection="column">
          {menu.map((c) => (
            <Text key={c.name}><Text color={ACCENT}>{c.name.padEnd(11)}</Text><Text dimColor>{c.desc}</Text></Text>
          ))}
        </Box>
      ) : null}

      {/* Footer */}
      <Box width={cols} justifyContent="space-between">
        <Text dimColor>meter · {branch || "no-git"}</Text>
        <Text dimColor>${sessionSpend.toFixed(4)} · / commands · Esc cancel · Ctrl+C quit</Text>
      </Box>
    </Box>
  );
}
