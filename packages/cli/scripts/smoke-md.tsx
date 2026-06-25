/**
 * Deterministic proof that chat/plan markdown renders as styled terminal text
 * (not raw markdown). Renders renderMarkdown() output through the exact same
 * <Static>+segments path the shell uses. No API calls.
 */
import React from "react";
import { Box, Static, Text } from "ink";
import { render } from "ink-testing-library";
import { renderMarkdown, type LogLine } from "../tui/runview.tsx";

const SAMPLE = `Here's the audit:
### Critical Issues
1. **No test suite exists.** There are smoke scripts but zero tests.
2. **Error handling** in \`exec.ts\` needs work.

- bullet with \`code\`
- bullet **two**`;

const items = renderMarkdown(SAMPLE, "").map((l, i) => ({ ...l, key: `k${i}` }));

function View({ lines }: { lines: (LogLine & { key: string })[] }) {
  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(line) =>
          line.segments
            ? <Text key={line.key}>{line.segments.map((s, i) => <Text key={i} color={s.color} dimColor={s.dim} bold={s.bold}>{s.text}</Text>)}</Text>
            : <Text key={line.key} color={line.color} dimColor={line.dim} bold={line.bold}>{line.text}</Text>
        }
      </Static>
    </Box>
  );
}

const { lastFrame } = render(<View lines={items} />);
const frame = lastFrame() ?? "";
console.log("----- rendered frame -----");
console.log(frame);
console.log("--------------------------");

let fail = 0;
const check = (n: string, c: boolean) => { console.log(`  ${c ? "✓" : "✗"} ${n}`); if (!c) fail++; };
check("no raw ** markers", !frame.includes("**"));
check("no raw ### markers", !frame.includes("###"));
check("no raw backticks", !frame.includes("`"));
check("bullets rendered (•)", frame.includes("•"));
check("ANSI bold present (styled)", /\x1b\[1m/.test(frame));
check("header text present", frame.includes("Critical Issues"));
check("sentence spacing intact", frame.includes("zero tests."));
process.exit(fail ? 1 : 0);
