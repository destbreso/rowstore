// rowstore, measured by rowtoll.
//
// The harness enters from outside and knows nothing about this package: it
// hands over rows, asks questions, checks every answer against
// Array.prototype.filter, and counts the field reads through the records
// themselves. `selfIndexing` means it is handed NO declared indexes, so it is
// measured against the best index set that exists, found by exhaustive search
// with a planner that was told the true selectivity of every predicate.

import {
  adapter,
  applyReplicas,
  checksum,
  defaultWorkloads,
  machine,
  markdownReport,
  panel,
  planFrom,
  runAll,
  serveReplica,
  spawnReplicas,
  summarizeCalibrator,
  textReport,
} from "rowtoll";
import type { Query as ArenaQuery, Row } from "rowtoll";
import { fileURLToPath } from "node:url";
import { RowStore } from "../src/store.js";
import type { Condition, Query } from "../src/types.js";

/**
 * rowtoll's AST into rowstore's query object.
 *
 * Two predicates of the same shape on one field would collide on the object
 * key and one would vanish, which is precisely how a translation layer frames
 * its own library for a correctness failure. It refuses instead.
 */
function translate(q: ArenaQuery): Query {
  const out: Record<string, Condition> = {};
  for (const p of q.where) {
    const c = (out[p.field] ??= {});
    if (p.op in c) {
      throw new Error(`rowstore adapter: two ${p.op} conditions on ${p.field} cannot be expressed`);
    }
    if (p.op === "in") c.in = p.values;
    else c[p.op] = p.value as never;
  }
  return out;
}

export function rowstoreSubject(buildAfter?: number) {
  return adapter({
    name: buildAfter === 1 ? "rowstore (eager)" : "rowstore",
    source: "rowstore",
    selfIndexing: true,
    make: (rows: readonly Row[]) => {
      const store = new RowStore(rows as never, buildAfter ? { buildAfter } : {});
      return {
        find: (q: ArenaQuery) => store.find(translate(q)),
        insert: (row: Row) => store.insert(row as never),
        remove: (id: number) => void store.remove(id),
        reportedReads: () => store.stats().reads,
      };
    },
  });
}

const ARMS = ["rowstore", "rowstore (eager)"] as const;

/**
 * The competitive ratio, per workload and in summary.
 *
 * This is the number the README leads with, so it is computed from the run
 * rather than copied out of it by hand. The denominator is the offline optimum:
 * the best index set that exists for the workload, found by exhaustive search
 * with a planner that was told the true selectivity of every predicate. It saw
 * the whole workload before choosing and this store saw nothing, so a ratio of
 * 1.00x means the price of not knowing the future was zero.
 */
function summarize(rows: ReturnType<typeof runAll>): string {
  const ratioOf = (w: (typeof rows)[number], arm: string): number | null => {
    const s = w.subjects.find((x) => x.subject === arm);
    return s?.toll ? s.toll.total / w.reference.total : null;
  };

  const lines = [
    "| workload | offline optimum | rowstore | vs optimum | rowstore (eager) | vs optimum |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  const ratios: Record<string, number[]> = { rowstore: [], "rowstore (eager)": [] };
  const worst: Record<string, { name: string; ratio: number }> = {
    rowstore: { name: "-", ratio: 0 },
    "rowstore (eager)": { name: "-", ratio: 0 },
  };
  for (const w of rows) {
    const cells: string[] = [];
    for (const arm of ARMS) {
      const r = ratioOf(w, arm);
      const s = w.subjects.find((x) => x.subject === arm);
      cells.push(s?.toll ? s.toll.total.toLocaleString("en-US") : `absent: ${s?.absent?.why ?? "?"}`);
      cells.push(r === null ? "-" : `${r.toFixed(2)}x`);
      if (r !== null) {
        ratios[arm]!.push(r);
        if (r > worst[arm]!.ratio) worst[arm] = { name: w.workload, ratio: r };
      }
    }
    lines.push(
      `| \`${w.workload}\` | ${w.reference.total.toLocaleString("en-US")} | ${cells.join(" | ")} |`,
    );
  }

  const stat = (arm: string): string => {
    const r = ratios[arm]!;
    const exact = r.filter((x) => x <= 1.0001).length;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    return (
      `**${arm}** matches the offline optimum exactly on ${exact} of ${r.length} workloads. ` +
      `Mean ${mean.toFixed(2)}x, worst ${worst[arm]!.ratio.toFixed(2)}x on \`${worst[arm]!.name}\`.`
    );
  };

  return [
    "## What it cost, against an optimum that knew the future",
    "",
    "Every ratio below is this store's total field reads divided by the best index",
    "set that exists for that workload, found by exhaustive search with a planner",
    "handed the true selectivity of every predicate. It chose with the whole",
    "workload in front of it. This store was handed no declared indexes at all and",
    "had to find them from the queries as they arrived.",
    "",
    stat("rowstore (eager)"),
    "",
    stat("rowstore"),
    "",
    "`rowstore` is the default, which waits for a predicate shape to repeat before",
    "it builds. That wait costs exactly one unindexed pass, paid once, and it does",
    "not amortize: where the optimum's entire cost is a single build pass, one extra",
    "pass is 2.00x however many queries follow. It costs less than that only where",
    "the optimum has to read rows anyway, and more where the wait happens twice on",
    "one field, which is what `hash-trap` and `conjunct` are for.",
    "",
    ...lines,
  ].join("\n");
}

const scale = Number(process.argv[2] ?? 0.25);
const trials = Number(process.argv[3] ?? 5);
// Independent processes to repeat the TIMING in. The reads axis is a count and
// is measured once whatever this says; the clock is an estimate and one process
// cannot say how uncertain it is, so a published clock figure here runs several.
const replicates = Number(process.argv[4] ?? 1);
const seed = 12345;
// `panel()` rather than `competitors()`, because the engines that failed to load
// are half the result. This benchmark once ran with sift, mingo and lokijs all
// absent and printed a three-row table that looked complete.
const { subjects: installed, missing } = await panel();
const subjects = [...installed, rowstoreSubject(), rowstoreSubject(1)];
const workloads = defaultWorkloads(scale, seed);

// A replica of this same script: it times what the parent asked for, writes it
// where the parent said, and prints nothing at all. The parent owns stdout.
if (serveReplica(workloads, subjects, (m) => process.stderr.write(`  ${m}\n`))) process.exit(0);

const results = runAll(workloads, subjects, {
  trials,
  // With replicates the parent measures only the axis that cannot come out
  // differently, and hands the clock to processes that do nothing else.
  tollOnly: replicates > 1,
  onProgress: (m) => process.stderr.write(`  ${m}\n`),
});

let calibrator;
if (replicates > 1) {
  const plan = planFrom(results, workloads, { scale, seed, trials });
  const payloads = spawnReplicas(plan, {
    replicates,
    // Spelled out rather than left to the default, which re-runs the current
    // command line: vite-node has already taken the script path out of argv by
    // the time this runs, so the default would restart the runner with the
    // scale where the filename belongs.
    command: process.argv[0]!,
    args: [process.argv[1]!, fileURLToPath(import.meta.url), String(scale), String(trials), "1"],
    onProgress: (m) => process.stderr.write(`\n${m}\n`),
  });
  applyReplicas(results, payloads);
  calibrator = summarizeCalibrator(payloads.map((p) => p.calibrator));
}

process.stdout.write(textReport(results));
if (process.env.OUT ?? process.env.OUT_JSON) {
  const { writeFileSync } = await import("node:fs");
  const meta = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    machine: machine(),
    scale,
    trials,
    replicates,
    calibrator,
    checksum: checksum(workloads),
    seed,
    maxIndexes: 2,
    generatedBy: "rowstore/bench/arena.ts",
    missing,
  };
  if (process.env.OUT) {
    writeFileSync(
      process.env.OUT,
      markdownReport(results, { ...meta, title: "rowstore, measured by rowtoll", intro: summarize(results) }),
    );
  }
  // The raw run, so the figures are drawn from the same numbers the tables are.
  if (process.env.OUT_JSON) writeFileSync(process.env.OUT_JSON, JSON.stringify({ meta, results }, null, 1));
}
