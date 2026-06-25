/**
 * Candidate output protocol.
 *
 * Applying model-generated unified diffs is famously fragile (fuzzy context,
 * whitespace drift). Meter sidesteps that: each candidate emits *whole files*
 * in a strict, language-agnostic envelope, which we write verbatim into the
 * candidate's worktree. The real unified diff is then computed by git — accurate
 * by construction.
 *
 *   <<<FILE: relative/path.ext>>>
 *   ...complete new file contents...
 *   <<<END>>>
 *
 *   <<<DELETE: relative/path.ext>>>
 */
import type { FileEdit } from "../types.ts";

/** The contract appended to every candidate/repair system prompt. */
export const OUTPUT_PROTOCOL = `
OUTPUT FORMAT — follow exactly, no exceptions:

For every file you create or modify, emit the COMPLETE new file contents wrapped like this:

<<<FILE: path/relative/to/repo/root.ext>>>
<the entire file, top to bottom — not a diff, not a fragment>
<<<END>>>

To delete a file:

<<<DELETE: path/relative/to/repo/root.ext>>>

Rules:
- Paths are relative to the repo root. Never absolute, never containing "..".
- Output the full file every time, even for a one-line change.
- Emit ONLY these blocks. No prose, no markdown fences, no commentary before, between, or after.
- Keep changes minimal and focused on the task; do not reformat untouched code.
`.trim();

const FILE_RE = /<<<FILE:\s*(.+?)\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END>>>/g;
const DELETE_RE = /<<<DELETE:\s*(.+?)\s*>>>/g;

/** Parse a candidate's raw output into file edits. Unsafe paths are dropped. */
export function parseFileEdits(raw: string): FileEdit[] {
  const edits: FileEdit[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(raw)) !== null) {
    const path = m[1].trim();
    if (!isSafePath(path) || seen.has(path)) continue;
    seen.add(path);
    edits.push({ path, contents: m[2] });
  }

  DELETE_RE.lastIndex = 0;
  while ((m = DELETE_RE.exec(raw)) !== null) {
    const path = m[1].trim();
    if (!isSafePath(path) || seen.has(path)) continue;
    seen.add(path);
    edits.push({ path, contents: null });
  }

  return edits;
}

function isSafePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  return true;
}
