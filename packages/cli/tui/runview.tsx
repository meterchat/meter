/**
 * Render model shared by the interactive shell and the one-shot run.
 *
 * Flicker-free: completed output (plan text, each model's debate turn, milestones,
 * the chat answer) is appended ONCE to Ink's <Static>. We do NOT repaint it and we
 * do NOT stream token-by-token into the live region (that caused the flashing). The
 * only thing that re-renders each frame is a one-line live status (spinner + phase +
 * what's currently thinking + spend).
 *
 * `createRunHandler` turns the engine's event stream into Static appends + live
 * updates, including reconstructing each debate turn's full text from its deltas so
 * you can actually read the models argue (the thing v0.1 showed).
 */
import type { CostSnapshot, MeterEvent, Phase } from "../src/types.ts";

export interface Segment {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

export interface LogLine {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  /** Rich inline runs (markdown). When set, renderers use these instead of `text`. */
  segments?: Segment[];
}

/** Parse inline markdown (**bold**, `code`) into styled segments. */
function inline(s: string): Segment[] {
  const segs: Segment[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) segs.push({ text: s.slice(last, m.index) });
    if (m[2] != null) segs.push({ text: m[2], bold: true });
    else if (m[3] != null) segs.push({ text: m[3], color: "cyan" });
    last = re.lastIndex;
  }
  if (last < s.length) segs.push({ text: s.slice(last) });
  return segs.length ? segs : [{ text: s }];
}

/** Render markdown text into terminal-styled log lines (headers, lists, code, bold). */
export function renderMarkdown(md: string, indent = "  "): LogLine[] {
  const out: LogLine[] = [];
  let inFence = false;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    if (raw.trim().startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) { out.push({ text: indent + raw, color: "cyan", dim: true }); continue; }
    if (raw.trim() === "") { out.push({ text: "" }); continue; }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ text: indent + h[2].replace(/\*\*/g, "").trim(), bold: true, color: "cyan" }); continue; }
    const bullet = raw.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) { out.push({ text: "", segments: [{ text: indent + bullet[1] + "• " }, ...inline(bullet[2])] }); continue; }
    const num = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (num) { out.push({ text: "", segments: [{ text: indent + num[1] + num[2] + ". ", color: "cyan" }, ...inline(num[3])] }); continue; }
    out.push({ text: "", segments: [{ text: indent }, ...inline(raw)] });
  }
  return out;
}

export interface Live {
  phase: Phase | null;
  activity: string;
  cost: CostSnapshot | null;
  running: boolean;
}

export function initLive(): Live {
  return { phase: null, activity: "thinking…", cost: null, running: false };
}

const PHASE_LABEL: Record<Phase, string> = {
  plan: "PLAN", debate: "DEBATE", fanout: "FAN-OUT", execute: "EXECUTE",
  select: "SELECT", repair: "REPAIR", commit: "COMMIT",
};

/** A titled block: a colored header line + the body, indented, wrapped by Ink. */
function section(title: string, body: string, color = "cyan"): LogLine[] {
  const lines: LogLine[] = [];
  if (title) lines.push({ text: title, color, bold: true });
  for (const ln of (body || "").trim().split("\n")) lines.push({ text: "  " + ln });
  lines.push({ text: "" });
  return lines;
}

/** Convert a milestone event into permanent log lines. Content events (plan/debate/
 *  answer text) are handled by createRunHandler instead. */
export function eventToLog(e: MeterEvent): LogLine[] {
  switch (e.type) {
    case "phase":
      return [{ text: `▸ ${PHASE_LABEL[e.phase]}${e.detail ? `  ${e.detail}` : ""}`, color: "cyan", bold: true }];
    case "testgen":
      return [{ text: `  testgen · ${e.message}`, color: "blue" }];
    case "candidate_done":
      return [{ text: `  ○ ${e.id} ${e.model} — ${e.files.length} file(s)`, dim: true }];
    case "candidate_failed":
      return [{ text: `  ✗ ${e.id} ${e.model} — ${e.reason}`, color: "red" }];
    case "verify_result": {
      const gates = e.result.gates.map((g) => `${g.gate} ${g.skipped ? "—" : g.passed ? "✓" : "✗"}`).join("  ");
      return [{ text: `  ${e.result.passed ? "✓" : "✗"} ${e.id} ${e.model} — ${e.result.passed ? "PASS" : "fail"}  ${gates}`, color: e.result.passed ? "green" : "yellow" }];
    }
    case "repair_start":
      return [{ text: `  ↻ repair ${e.id} ${e.model} #${e.attempt}`, color: "magenta" }];
    case "select":
      return [{ text: `  → ${e.reason}`, dim: true }];
    case "log":
      return e.level === "info" ? [] : [{ text: `  ${e.message}`, color: e.level === "warn" ? "yellow" : "red" }];
    case "error":
      return [{ text: `  ✗ ${e.message}`, color: "red", bold: true }];
    default:
      return [];
  }
}

/** Fold an event into the small live region state (what's thinking right now). */
export function eventToLive(prev: Live, e: MeterEvent): Live {
  switch (e.type) {
    case "triage": return { ...prev, activity: e.kind === "chat" ? "answering…" : "planning…", running: true };
    case "phase": return { ...prev, phase: e.phase, activity: PHASE_LABEL[e.phase].toLowerCase() + "…", running: true };
    case "plan_delta": return prev.activity === "drafting the plan…" ? prev : { ...prev, activity: "drafting the plan…" };
    case "debate_turn_start": return { ...prev, activity: `${e.model} · ${e.phase}` };
    case "candidate_start": return { ...prev, activity: `generating ${e.id} (${e.model})` };
    case "verify_start": return { ...prev, activity: `verifying ${e.id}` };
    case "repair_start": return { ...prev, activity: `repairing ${e.id} (#${e.attempt})` };
    case "cost": return { ...prev, cost: e.cost };
    case "done": return { ...prev, running: false, activity: "" };
    case "error": return { ...prev, running: false };
    default: return prev;
  }
}

/**
 * Build an event handler that appends content to <Static> and updates the live
 * region. Reconstructs each debate turn's full text from its streamed deltas so the
 * actual deliberation is shown (once, when the turn ends).
 */
export function createRunHandler(append: (lines: LogLine[]) => void, setLive: (fn: (p: Live) => Live) => void) {
  const turns: Record<string, string> = {};
  return (e: MeterEvent) => {
    switch (e.type) {
      case "plan_done":
        append([{ text: "PLAN", color: "yellow", bold: true }, ...renderMarkdown(e.plan), { text: "" }]);
        break;
      case "answer_done":
        append([{ text: "" }, ...renderMarkdown(e.text, ""), { text: "" }]);
        break;
      case "debate_turn_start":
        turns[e.model] = "";
        break;
      case "debate_turn_delta":
        turns[e.model] = (turns[e.model] ?? "") + e.content;
        break;
      case "debate_turn_end":
        append(section(`${e.model} · ${e.phase}`, turns[e.model] ?? "", "magenta"));
        break;
      default: {
        const lines = eventToLog(e);
        if (lines.length) append(lines);
      }
    }
    setLive((prev) => eventToLive(prev, e));
  };
}

export function phaseLabel(p: Phase | null): string {
  return p ? PHASE_LABEL[p] : "";
}

export function costText(cost: CostSnapshot | null): string {
  return cost ? `$${cost.actualCost.toFixed(4)}` : "$0.0000";
}
