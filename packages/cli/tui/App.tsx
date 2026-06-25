/**
 * One-shot run view: `meter "<task>"`.
 *
 * Same flicker-free model as the shell — milestones stream into <Static> (natural
 * scrollback, no repaint), a tiny live status line is the only thing that updates,
 * and approval is a single y/n line. Exits when the run finishes.
 */
import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { runMeter, type RunResult } from "../src/loop.ts";
import { shortModelName } from "../src/providers/models.ts";
import { createRunHandler, initLive, phaseLabel, costText, type Live, type LogLine } from "./runview.tsx";
import type { Candidate, MeterConfig, MeterEvent, RepoContext } from "../src/types.ts";

export interface AppProps {
  task: string;
  cwd: string;
  config: MeterConfig;
  dateISO: string;
  autoApprove: boolean;
  onFinish: (r: RunResult) => void;
}

let lineKey = 0;
const k = () => `a${lineKey++}`;

export default function App({ task, cwd, config, dateISO, autoApprove, onFinish }: AppProps) {
  const { exit } = useApp();
  const [log, setLog] = useState<(LogLine & { key: string })[]>([]);
  const [live, setLive] = useState<Live>({ ...initLive(), running: true });
  const [pending, setPending] = useState<Candidate | null>(null);
  const approveResolver = useRef<((ok: boolean) => void) | null>(null);
  const started = useRef(false);

  const append = (lines: LogLine[]) => setLog((p) => [...p, ...lines.map((l) => ({ ...l, key: k() }))]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    append([{ text: `› ${task}`, color: "green", bold: true }]);

    const dispatch = createRunHandler(append, setLive);

    const approve = autoApprove
      ? undefined
      : (winner: Candidate, _r: RepoContext) =>
          new Promise<boolean>((resolve) => {
            append([
              { text: `✓ winner: ${shortModelName(winner.model)} (${winner.id})`, color: "green", bold: true },
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

    runMeter({ task, cwd, config, send: dispatch, dateISO, approve })
      .then((r) => { onFinish(r); setTimeout(() => exit(), 40); })
      .catch((err) => { append([{ text: `✗ ${(err as Error).message}`, color: "red", bold: true }]); setTimeout(() => exit(), 40); });
  }, []);

  useInput((ch) => {
    if (!pending || !approveResolver.current) return;
    if (ch.toLowerCase() === "y") { approveResolver.current(true); approveResolver.current = null; setPending(null); }
    else if (ch.toLowerCase() === "n") { approveResolver.current(false); approveResolver.current = null; setPending(null); }
  });

  return (
    <Box flexDirection="column">
      <Static items={log}>
        {(line) =>
          line.segments
            ? <Text key={line.key} wrap="end">{line.segments.map((s, i) => <Text key={i} color={s.color} dimColor={s.dim} bold={s.bold}>{s.text}</Text>)}</Text>
            : <Text key={line.key} color={line.color} dimColor={line.dim} bold={line.bold}>{line.text}</Text>
        }
      </Static>
      {live.running && !pending ? (
        <Box>
          <Text color="cyan"><Spinner type="dots" /> </Text>
          <Text bold>{phaseLabel(live.phase)} </Text>
          <Text dimColor>{live.activity}</Text>
          <Text dimColor>   spend </Text><Text color="green" bold>{costText(live.cost)}</Text>
        </Box>
      ) : null}
      {pending ? <Text color="green" bold>Apply &amp; commit {pending.id}?  [y]es / [n]o</Text> : null}
    </Box>
  );
}
