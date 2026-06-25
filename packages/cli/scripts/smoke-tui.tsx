/**
 * TUI render smoke test — mounts the interactive Shell with ink-testing-library
 * (simulated TTY) and asserts the shell chrome, prompt, and footer paint.
 * No model calls. Run: bun run scripts/smoke-tui.tsx
 */
import React from "react";
import { render } from "ink-testing-library";
import Shell from "../tui/Shell.tsx";
import { defaultConfig } from "../src/config.ts";

let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`  ${cond ? "✓" : "✗"} ${name}`); if (!cond) failures++; };

async function main() {
  const { lastFrame, unmount } = render(
    React.createElement(Shell, { cwd: process.cwd(), config: defaultConfig(), dateISO: "2026-06-21", hasKey: false }),
  );
  // Let the initial paint + first async tick happen.
  await new Promise((r) => setTimeout(r, 200));
  const frame = lastFrame() ?? "";
  console.log("\n----- rendered frame -----\n" + frame + "\n--------------------------\n");

  check("renders banner 'meter'", /meter/.test(frame));
  check("shows Meter shell context", /no-git|git/.test(frame));
  check("shows the prompt arrow", frame.includes("›"));
  check("footer shows spend + commands hint", /\$0\.0000/.test(frame) && /commands/.test(frame));

  unmount();
  console.log(`\n${failures === 0 ? "✓ TUI RENDERS" : `✗ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
