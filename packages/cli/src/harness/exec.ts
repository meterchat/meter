/**
 * Sandboxed command execution.
 *
 * Every verifier gate and git operation runs through here. Commands execute with
 * a fixed cwd, a hard timeout (killed process group on overrun), and captured
 * stdout/stderr. Output is tail-trimmed so a runaway test log can't blow up the
 * model context when it's fed back into repair.
 *
 * "Sandboxed" in v0.1 means *isolated working tree* (each candidate runs in its
 * own git worktree) + process timeout, not OS-level containment. A future hard
 * sandbox (container/seatbelt) slots in behind this same interface.
 */
import { spawn } from "node:child_process";

export interface ExecResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr, tail-trimmed to `tailChars`. */
  combined: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Keep only the last N chars of combined output (default 8000). */
  tailChars?: number;
}

const MAX_BUFFER = 4 * 1024 * 1024; // 4MB per stream before we stop appending

export function exec(command: string, opts: ExecOptions): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const tailChars = opts.tailChars ?? 8000;

  return new Promise((resolve) => {
    const startedAt = performance.now();
    // Run through the shell so package.json script strings ("vitest run", etc.) work.
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      detached: true, // own process group → we can kill the whole tree on timeout
      env: { ...process.env, CI: "1", ...opts.env },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (buf: string, chunk: Buffer) =>
      buf.length < MAX_BUFFER ? buf + chunk.toString("utf8") : buf;

    child.stdout?.on("data", (c) => (stdout = append(stdout, c)));
    child.stderr?.on("data", (c) => (stderr = append(stderr, c)));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const combinedRaw = [stdout, stderr].filter(Boolean).join("\n");
      const combined =
        combinedRaw.length > tailChars
          ? "…(truncated)…\n" + combinedRaw.slice(-tailChars)
          : combinedRaw;
      resolve({
        command,
        exitCode,
        stdout,
        stderr,
        combined: timedOut ? combined + `\n(timed out after ${timeoutMs}ms)` : combined,
        timedOut,
        durationMs: Math.round(performance.now() - startedAt),
      });
    };

    child.on("error", (err) => finish(typeof (err as { errno?: number }).errno === "number" ? 127 : 1));
    child.on("close", (code) => finish(timedOut ? 124 : code));
  });
}
