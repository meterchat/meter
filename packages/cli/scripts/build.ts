/**
 * Build the distributable CLI into a single self-contained file.
 *
 * Why bundle: Meter ships React + Ink. Run as a raw .tsx via bun, module
 * resolution can walk up into an ambient node_modules (e.g. a workspace-level
 * react 19 / react-reconciler) and collide with Meter's react 18 — the classic
 * "Objects are not valid as a React child ($$typeof)" dual-React crash. A bundle
 * inlines one React, so there is no runtime resolution and no collision.
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const result = await Bun.build({
  entrypoints: ["bin/meter.tsx"],
  target: "bun",
  outdir: "dist",
  naming: "meter.js",
  // Ink only calls react-devtools-core when DEV mode is on (never in our CLI),
  // but the bundler still pulls the dep in. Resolve it to a harmless stub so the
  // bundle is self-contained and never does a runtime require for it.
  plugins: [
    {
      name: "stub-react-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core",
          namespace: "stub-rdt",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub-rdt" }, () => ({
          contents: "export default { connectToDevTools() {} };",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Ensure a single, correct shebang on the bundle and make it executable.
const file = "dist/meter.js";
const code = readFileSync(file, "utf8").replace(/^#![^\n]*\n/, "");
writeFileSync(file, "#!/usr/bin/env bun\n" + code);
chmodSync(file, 0o755);

const kb = Math.round(readFileSync(file).length / 1024);
console.log(`built ${file} (${kb} KB)`);
