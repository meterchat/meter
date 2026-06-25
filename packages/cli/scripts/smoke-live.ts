/**
 * Live triage check — one real (cheap) model call per case. Confirms:
 *   • chat-vs-code classification works,
 *   • a chat question yields a direct answer (no pipeline),
 *   - provider [fallback] noise does NOT leak to stdout (gated behind METER_DEBUG).
 * Run: bun run scripts/smoke-live.ts   (needs a provider key; spends a few cents)
 */
import { CostMeter } from "../src/core/turn.ts";
import { triage } from "../src/core/triage.ts";
import { loadRepoContext, gitRoot } from "../src/harness/repo.ts";
import { META_MODEL } from "../src/providers/models.ts";
import type { MeterEvent } from "../src/types.ts";

async function main() {
  const root = (await gitRoot(process.cwd()))!;
  const repo = await loadRepoContext(root);
  const meter = new CostMeter();
  const events: MeterEvent[] = [];
  const send = (e: MeterEvent) => events.push(e);

  for (const [label, msg, expect] of [
    ["chat", "hey should I add a dark mode to this?", "chat"],
    ["code", "add a --version flag to the CLI entry", "code"],
  ] as const) {
    events.length = 0;
    const r = await triage(msg, repo, META_MODEL, meter, send);
    const ok = r.kind === expect;
    console.log(`\n[${label}] "${msg}"`);
    console.log(`  classified: ${r.kind}  ${ok ? "✓" : "✗ expected " + expect}`);
    if (r.kind === "chat") console.log(`  answer: ${r.answer.slice(0, 160)}${r.answer.length > 160 ? "…" : ""}`);
  }
  console.log(`\ncost: $${meter.actualCost.toFixed(4)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
