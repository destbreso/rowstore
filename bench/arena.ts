// rowstore, measured by rowtoll.
//
// The harness enters from outside and knows nothing about this package: it
// hands over rows, asks questions, checks every answer against
// Array.prototype.filter, and counts the field reads through the records
// themselves. `selfIndexing` means it is handed NO declared indexes, so it is
// measured against the best index set that exists, found by exhaustive search
// with a planner that was told the true selectivity of every predicate.

import { adapter, competitors, defaultWorkloads, runAll, textReport, markdownReport } from "rowtoll";
import type { Query as ArenaQuery, Row } from "rowtoll";
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

const scale = Number(process.argv[2] ?? 0.25);
const subjects = [...(await competitors()), rowstoreSubject(), rowstoreSubject(1)];
const results = runAll(defaultWorkloads(scale), subjects, {
  trials: Number(process.argv[3] ?? 5),
  onProgress: (m) => process.stderr.write(`  ${m}\n`),
});
process.stdout.write(textReport(results));
if (process.env.OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.OUT, markdownReport(results, {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    scale,
    trials: Number(process.argv[3] ?? 5),
    seed: 12345,
    maxIndexes: 2,
    generatedBy: "rowstore/bench/arena.ts",
  }));
}
