// Smoke test against the PUBLISHED tarball, not this working tree.
//
// `prepack` already refuses to ship a tarball with no build in it, but a correct
// build of stale source packs and publishes just as cleanly, so "the tests pass
// here" says nothing about what a stranger installs. This installs what the
// registry serves, into a fresh temp directory, and checks numbers rather than
// checking that something ran.
//
//   node scripts/smoke-published.mjs                 # whatever is latest
//   node scripts/smoke-published.mjs 0.1.0           # a specific version
//   node scripts/smoke-published.mjs ./rowstore.tgz  # a tarball, before publishing
//
// The last form is how this script itself gets verified: it runs against the
// exact artifact `npm pack` produces, which is the same bytes the registry will
// hold.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = process.argv[2];
const local = arg !== undefined && (arg.endsWith(".tgz") || arg.startsWith(".") || isAbsolute(arg));
const spec = arg === undefined ? "rowstore" : local ? resolve(arg) : `rowstore@${arg}`;
const dir = mkdtempSync(join(tmpdir(), "rowstore-smoke-"));
let failed = 0;

const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  pass  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    failed++;
  }
};
const same = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

try {
  writeFileSync(join(dir, "package.json"), '{"name":"smoke","private":true,"type":"module"}\n');
  console.log(`installing ${spec} into ${dir}`);
  execFileSync("npm", ["install", spec, "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });

  const pkgDir = join(dir, "node_modules", "rowstore");
  const version = JSON.parse(
    execFileSync("node", ["-p", "JSON.stringify(require('./package.json'))"], { cwd: pkgDir }).toString(),
  ).version;
  console.log(`\nrowstore ${version}${local ? " (from a local tarball)" : ", from the registry"}\n`);

  console.log("the tarball");
  const esm = await import(pathToFileURL(join(pkgDir, "dist", "index.js")).href);
  ok("the ESM entry loads and exports RowStore", typeof esm.RowStore === "function");
  const cjs = createRequire(join(dir, "noop.js"))("rowstore");
  ok("the CJS entry loads and exports the same surface", typeof cjs.RowStore === "function");
  ok(
    "both entries export the same names",
    Object.keys(esm).sort().join(",") === Object.keys(cjs).sort().join(","),
    `${Object.keys(esm).length} vs ${Object.keys(cjs).length}`,
  );

  const { RowStore } = esm;
  const rows = () => Array.from({ length: 100 }, (_, i) => ({ _id: i, k: i % 10, n: i }));

  // Every number here is hand-derivable, which is the only kind worth asserting
  // about a package whose claim is an exact count.
  console.log("\nwhat it costs");
  const store = new RowStore(rows());
  store.find({ k: 3 });
  ok("the first sighting scans: 100 reads", store.stats().reads === 100, `${store.stats().reads}`);
  ok("and builds nothing", store.stats().indexes.length === 0);
  store.find({ k: 3 });
  ok("the second builds, one pass, and answers free: 200 total", store.stats().reads === 200, `${store.stats().reads}`);
  store.find({ k: 3 });
  ok("the third is free: still 200, where three scans would be 300", store.stats().reads === 200, `${store.stats().reads}`);

  const ix = store.stats().indexes;
  ok("it reports one hash index on the field it was asked about", ix.length === 1 && ix[0].field === "k" && ix[0].kind === "hash");
  ok(
    "with the true cardinality, the true size, and the sighting that triggered it",
    ix[0].distinct === 10 && ix[0].entries === 100 && ix[0].builtAfter === 2 && ix[0].buildCost === 100,
    JSON.stringify(ix[0]),
  );
  ok("and 90 rows skipped per indexed query", ix[0].saved === 180, `${ix[0].saved}`);

  const scan = new RowStore(rows(), { scanOnly: true });
  for (let i = 0; i < 3; i++) scan.find({ k: 3 });
  ok("scanOnly never builds and pays every time: 300", scan.stats().reads === 300 && scan.stats().indexes.length === 0);

  const eager = new RowStore(rows(), { buildAfter: 1 });
  eager.find({ k: 3 });
  ok("buildAfter 1 builds on first sight", eager.stats().indexes.length === 1 && eager.stats().indexes[0].builtAfter === 1);

  // The failure the package exists to avoid: an index that changes the answer,
  // which is what lokijs does on a column holding both 2 and "2".
  console.log("\nan index may not change the answer");
  const mixed = [
    { _id: 0, v: 2 },
    { _id: 1, v: "2" },
    { _id: 2, v: 2 },
    { _id: 3, v: true },
    { _id: 4, v: Number.NaN },
  ];
  for (const [label, query, expected] of [
    ["eq 2 excludes the string", { v: 2 }, [0, 2]],
    ['eq "2" excludes the number', { v: "2" }, [1]],
    ["in [2] excludes the string", { v: { in: [2] } }, [0, 2]],
    ["in [2, true] takes the boolean too", { v: { in: [2, true] } }, [0, 2, 3]],
    ["eq NaN matches nothing", { v: Number.NaN }, []],
    ["in [NaN] matches the NaN row", { v: { in: [Number.NaN] } }, [4]],
    ["gt 1 is numbers only", { v: { gt: 1 } }, [0, 2]],
  ]) {
    const s = new RowStore(mixed, { buildAfter: 2 });
    const cold = s.find(query);
    const warming = s.find(query);
    const warm = s.find(query);
    ok(
      `${label}, cold and indexed alike`,
      same(cold, expected) && same(warming, expected) && same(warm, expected),
      JSON.stringify({ cold, warming, warm, expected }),
    );
  }

  console.log("\nmutation");
  const m = new RowStore(rows(), { buildAfter: 1 });
  m.find({ k: 3 });
  m.find({ n: { gte: 50 } });
  m.insert({ _id: 100, k: 3, n: 500 });
  m.remove(3);
  m.update(13, { k: 9 });
  const truth = (q) => m.all().filter(q).map((r) => r._id);
  ok("equality follows an insert, a remove and an update", same(m.find({ k: 3 }), truth((r) => r.k === 3)), JSON.stringify(m.find({ k: 3 })));
  ok("the range follows them too", same(m.find({ n: { gte: 50 } }), truth((r) => r.n >= 50)));
  ok("and the moved row is gone from its old bucket", !m.find({ k: 3 }).includes(13));

  console.log("\nrefusals");
  const words = new RowStore([{ _id: 0, w: "a" }, { _id: 1, w: "b" }], { buildAfter: 1 });
  words.find({ w: { gt: 1 } });
  ok("a sorted index over no orderable value refuses, with the reason", words.stats().refused.length === 1, JSON.stringify(words.stats().refused));
  let threw = "";
  try {
    new RowStore(rows()).find({ k: { $eq: 3 } });
  } catch (e) {
    threw = String(e.message);
  }
  ok("an unknown operator throws by name rather than being ignored", threw.includes("rowstore") && threw.includes("$eq"), threw);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const what = local ? "the packed tarball" : "the published tarball";
console.log(failed === 0 ? `\nALL PASS against ${what}` : `\n${failed} FAILURES against ${what}`);
process.exit(failed === 0 ? 0 : 1);
