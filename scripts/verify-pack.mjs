// Runs on `prepack`, so it runs on both `npm pack` and `npm publish`.
//
// It exists because `npm pack` from a clean clone produced a tarball with four
// files in it, none of them code, and exited 0. `prepublishOnly` does not run on
// pack, so the only thing that had ever put a `dist` in the tarball was me
// having built by hand minutes earlier. A build that never happened and a log
// that ends in a success line is the failure this whole family of packages
// keeps re-learning.
import { existsSync, statSync } from "node:fs";

const REQUIRED = [
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
];

const missing = REQUIRED.filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.error(`verify-pack: the build did not produce ${missing.join(", ")}`);
  process.exit(1);
}

const empty = REQUIRED.filter((f) => statSync(f).size < 1000);
if (empty.length > 0) {
  console.error(`verify-pack: suspiciously small build output: ${empty.join(", ")}`);
  process.exit(1);
}
console.error(`verify-pack: ${REQUIRED.length} build artifacts present`);
