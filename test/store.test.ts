import { describe, expect, it } from "vitest";
import { RowStore, holds, predicates } from "../src/store.js";
import type { Query, Row } from "../src/types.js";

// The oracle. Every answer this store gives is compared against filtering the
// array by hand, because a collection that answers fast and wrong is not fast.
const oracle = (rows: readonly Row[], q: Query): number[] =>
  rows.filter((r) => predicates(q).every((p) => holds(r[p.field], p))).map((r) => r._id).sort((a, b) => a - b);

const sorted = (ids: number[]): number[] => [...ids].sort((a, b) => a - b);

function makeRows(n: number, seed = 1): Row[] {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, (_, i) => ({
    _id: i,
    status: `s${Math.floor(rnd() * 20)}`,
    region: `r${Math.floor(rnd() * 4)}`,
    score: Math.floor(rnd() * 1000),
    active: rnd() < 0.5,
  }));
}

const rows = makeRows(1000);

const BATTERY: Query[] = [
  {},
  { status: "s3" },
  { status: { eq: "s3" } },
  { status: { in: ["s1", "s2", "s3"] } },
  { score: { gte: 400 } },
  { score: { gte: 400, lt: 600 } },
  { active: true, status: "s7" },
  { region: "r1", score: { gt: 900 }, active: false },
  { status: "s1", region: "r0", score: { lte: 100 } },
];

describe("answers", () => {
  it("agrees with the oracle on every shape, cold", () => {
    for (const q of BATTERY) {
      const store = new RowStore(rows);
      expect(sorted(store.find(q)), JSON.stringify(q)).toEqual(oracle(rows, q));
    }
  });

  // The failure this whole package has to avoid: an index that changes the
  // answer. lokijs returns four rows for `$in [2]` without an index and eight
  // with one, on a column holding both 2 and "2". For a store that decides on
  // its own when to build, that is a wrong answer which appears only after the
  // workload warms up, so the same query is asked until an index exists and
  // then asked again.
  it("gives the same answer before and after it decides to index", () => {
    for (const q of BATTERY) {
      const store = new RowStore(rows);
      const answers = Array.from({ length: 6 }, () => sorted(store.find(q)));
      const truth = oracle(rows, q);
      for (let i = 0; i < answers.length; i++) {
        expect(answers[i], `${JSON.stringify(q)} at query ${i + 1}`).toEqual(truth);
      }
      // and it really did build one, or the test proves nothing
      if (Object.keys(q).length > 0) expect(store.stats().indexes.length).toBeGreaterThan(0);
    }
  });

  it("keeps agreeing through inserts and removals", () => {
    const store = new RowStore(rows);
    const live = new Map(rows.map((r) => [r._id, r]));
    for (const q of BATTERY) store.find(q); // warm, so the indexes exist
    for (const q of BATTERY) store.find(q);

    for (let id = 0; id < 200; id++) {
      store.remove(id);
      live.delete(id);
    }
    for (let k = 0; k < 150; k++) {
      const row = { ...rows[k]!, _id: 10_000 + k };
      store.insert(row);
      live.set(row._id, row);
    }
    const present = [...live.values()];
    for (const q of BATTERY) {
      expect(sorted(store.find(q)), JSON.stringify(q)).toEqual(oracle(present, q));
    }
  });
});

describe("the comparison the index implements is the comparison the language does", () => {
  const mixed: Row[] = [
    { _id: 0, v: 2 },
    { _id: 1, v: "2" },
    { _id: 2, v: true },
    { _id: 3, v: 0 },
    { _id: 4, v: NaN },
  ];

  it("does not confuse a number with its string form, indexed or not", () => {
    for (const q of [{ v: 2 }, { v: "2" }, { v: { in: [2] } }, { v: { in: ["2"] } }, { v: { in: [2, "2"] } }] as Query[]) {
      const store = new RowStore(mixed);
      const cold = sorted(store.find(q));
      const warm = sorted(store.find(q));
      expect(cold, JSON.stringify(q)).toEqual(oracle(mixed, q));
      expect(warm, `${JSON.stringify(q)} indexed`).toEqual(oracle(mixed, q));
    }
  });

  // A Map compares keys with SameValueZero, `eq` wants strict equality and `in`
  // wants SameValueZero, and NaN is the single value where those two disagree.
  // So the index has to lean one way for one operator and the other way for the
  // other, and this is the cell that proves it does.
  it("splits NaN the way the language splits it: eq never matches, in does", () => {
    const store = new RowStore(mixed);
    for (let i = 0; i < 3; i++) {
      expect(sorted(store.find({ v: NaN }))).toEqual([]);
      expect(sorted(store.find({ v: { in: [NaN] } }))).toEqual([4]);
    }
    expect(oracle(mixed, { v: NaN })).toEqual([]);
    expect(oracle(mixed, { v: { in: [NaN] } })).toEqual([4]);
  });

  it("never matches a range against a value that is not a number", () => {
    const store = new RowStore(mixed);
    for (let i = 0; i < 3; i++) {
      expect(sorted(store.find({ v: { gte: 0 } }))).toEqual(oracle(mixed, { v: { gte: 0 } }));
      expect(sorted(store.find({ v: { lt: 100 } }))).toEqual(oracle(mixed, { v: { lt: 100 } }));
    }
    // true and "2" and NaN are all excluded, 2 and 0 are not
    expect(oracle(mixed, { v: { gte: 0 } })).toEqual([0, 3]);
  });

  it("refuses a sorted index over a field with nothing orderable in it, and says so", () => {
    const words: Row[] = [{ _id: 0, v: "a" }, { _id: 1, v: "b" }];
    const store = new RowStore(words);
    for (let i = 0; i < 4; i++) expect(store.find({ v: { gt: 0 } })).toEqual([]);
    const s = store.stats();
    expect(s.indexes).toEqual([]);
    expect(s.refused[0]!.reason).toContain("no orderable value");
  });
});

describe("when it decides to build, and what that costs", () => {
  it("builds on the second sighting of a shape, not the first", () => {
    const store = new RowStore(rows);
    store.find({ status: "s1" });
    expect(store.stats().indexes).toEqual([]);
    store.find({ status: "s2" });
    expect(store.stats().indexes.map((i) => `${i.field}:${i.kind}`)).toEqual(["status:hash"]);
  });

  it("builds on the first when asked to, which on reads is never worse", () => {
    const eager = new RowStore(rows, { buildAfter: 1 });
    eager.find({ status: "s1" });
    expect(eager.stats().indexes.length).toBe(1);

    // The whole arithmetic in one assertion: a build reads exactly what the scan
    // it replaces reads, so after one query the eager store has read the same
    // number of rows as the lazy one, and every query after this is free.
    const lazy = new RowStore(rows);
    lazy.find({ status: "s1" });
    expect(eager.stats().reads).toBe(lazy.stats().reads);
  });

  it("charges a full pass to build and then reads nothing to answer", () => {
    const store = new RowStore(rows);
    store.find({ status: "s1" });
    const afterScan = store.stats().reads;
    expect(afterScan).toBe(rows.length);

    store.find({ status: "s2" }); // builds, then answers from the index
    expect(store.stats().reads).toBe(2 * rows.length);

    const before = store.stats().reads;
    for (let i = 0; i < 50; i++) store.find({ status: `s${i % 20}` });
    expect(store.stats().reads).toBe(before);
  });

  it("costs one read per index per mutation to stay correct", () => {
    const store = new RowStore(rows.slice(0, 100));
    for (let i = 0; i < 3; i++) store.find({ status: "s1" });
    expect(store.stats().indexes.length).toBe(1);
    const before = store.stats().reads;
    store.insert({ ...rows[0]!, _id: 99_999 });
    store.remove(99_999);
    expect(store.stats().reads).toBe(before + 2);
  });

  it("never builds anything when told to scan", () => {
    const store = new RowStore(rows, { scanOnly: true });
    for (let i = 0; i < 10; i++) store.find({ status: "s1" });
    expect(store.stats().indexes).toEqual([]);
    expect(store.stats().reads).toBe(10 * rows.length);
  });
});

describe("what it says about itself", () => {
  it("publishes an estimate it knows can be wrong, and never plans with it", () => {
    // A skewed column: one value holds half the rows, nine share the rest. The
    // estimate this store can make from an index is 1/distinct = 0.1, which is
    // the uniformity assumption every textbook optimizer starts from, and it is
    // wrong by 5x for the hot value and by 2x for the cold ones.
    //
    // That is exactly why it is published and not used. The driving path is
    // chosen from the posting list's EXACT size, which needs no assumption, and
    // the estimate exists so a harness measuring the truth can print all three.
    const skewed: Row[] = Array.from({ length: 1000 }, (_, i) => ({
      _id: i,
      topic: i % 2 === 0 ? "hot" : `c${i % 10}`,
    }));
    const store = new RowStore(skewed);
    for (let i = 0; i < 4; i++) store.find({ topic: "hot" });

    const shape = store.stats().shapes.find((x) => x.field === "topic")!;
    expect(shape.estimatedSelectivity).toBeCloseTo(1 / 6, 6);

    const trueHot = skewed.filter((r) => r.topic === "hot").length / skewed.length;
    expect(trueHot).toBe(0.5);
    expect(shape.estimatedSelectivity!).toBeLessThan(trueHot / 2);

    // And the plan is unharmed by the bad estimate: answering reads no rows.
    const before = store.stats().reads;
    expect(sorted(store.find({ topic: "hot" }))).toEqual(oracle(skewed, { topic: "hot" }));
    expect(store.stats().reads).toBe(before);
  });

  it("measures the selectivity of a predicate it has to apply by hand", () => {
    const store = new RowStore(rows, { scanOnly: true });
    for (let i = 0; i < 3; i++) store.find({ active: true });
    const shape = store.stats().shapes.find((x) => x.field === "active")!;
    const truth = rows.filter((r) => r.active === true).length / rows.length;
    // Not an estimate: it is the fraction of the rows it actually tested that
    // actually survived, so on a full scan it is the true selectivity exactly.
    expect(shape.observedSelectivity).toBeCloseTo(truth, 10);
    expect(shape.estimatedSelectivity).toBeNull();
  });

  it("orders the residual predicates by what it measured, not by what it guessed", () => {
    // `active` keeps about half and `region` about a quarter, neither indexed.
    // Whichever is written first, the store should end up testing the more
    // selective one first, and the proof is the read count falling.
    const first = new RowStore(rows, { scanOnly: true });
    first.find({ active: true, region: "r1" });
    const cold = first.stats().reads;
    first.find({ active: true, region: "r1" });
    const warm = first.stats().reads - cold;
    expect(warm).toBeLessThan(cold);
  });

  it("reports what each index has saved, in rows nobody had to read", () => {
    const store = new RowStore(rows);
    for (let i = 0; i < 12; i++) store.find({ status: `s${i % 20}` });
    const ix = store.stats().indexes.find((i) => i.field === "status")!;
    expect(ix.buildCost).toBe(rows.length);
    expect(ix.saved).toBeGreaterThan(9 * (rows.length - 100));
    expect(ix.entries).toBe(rows.length);
    expect(ix.distinct).toBe(20);
  });
});

describe("the query language refuses what it cannot do", () => {
  it("names an unknown operator instead of silently ignoring it", () => {
    const store = new RowStore(rows);
    expect(() => store.find({ status: { regex: "s.*" } as never })).toThrow(/unknown operator/);
  });

  it("refuses an empty condition rather than matching everything", () => {
    const store = new RowStore(rows);
    expect(() => store.find({ status: {} })).toThrow(/empty condition/);
  });

  it("treats an empty query as everything, like the oracle does", () => {
    const store = new RowStore(rows);
    expect(store.find({}).length).toBe(rows.length);
  });

  it("refuses a duplicate id rather than losing a row", () => {
    const store = new RowStore(rows);
    expect(() => store.insert(rows[0]!)).toThrow(/duplicate/);
  });
});

describe("mutation through the store", () => {
  it("keeps every index true when a row changes", () => {
    const data = makeRows(300, 5);
    const store = new RowStore(data);
    const live = new Map(data.map((r) => [r._id, { ...r }]));
    for (let i = 0; i < 3; i++) {
      store.find({ status: "s1" });
      store.find({ score: { gte: 500 } });
    }
    expect(store.stats().indexes.length).toBe(2);

    for (let id = 0; id < 120; id++) {
      const patch = { status: `s${(id * 7) % 20}`, score: (id * 37) % 1000 };
      store.update(id, patch);
      Object.assign(live.get(id)!, patch);
    }

    const present = [...live.values()];
    for (const q of BATTERY) {
      expect(sorted(store.find(q)), JSON.stringify(q)).toEqual(oracle(present, q));
    }
  });

  it("says so when there is nothing to update", () => {
    const store = new RowStore(rows);
    expect(store.update(999_999, { status: "x" })).toBe(false);
  });

  it("refuses to move a row's identity", () => {
    const store = new RowStore(makeRows(10, 3));
    store.update(1, { _id: 7 } as never);
    expect(store.get(1)!._id).toBe(1);
    expect(store.get(7)!._id).toBe(7);
  });
});

// The README publishes these numbers, so they get a test. The dataset is the
// harness's own skewed field, at the scale the committed report was run at, and
// it is generated by the harness rather than by this repo so the claim is about
// the panel and not about a dataset chosen to make the point.
describe("the selectivity estimate it publishes about itself", () => {
  it("is wrong by 80x on the hot value and 6x on the rare one, which is why it plans nothing", async () => {
    const { makeRows: harnessRows } = await import("rowtoll");
    const rows = harnessRows(
      5000,
      [
        { name: "topic", kind: "categorical", cardinality: 500, skew: 1.1 },
        { name: "score", kind: "numeric", min: 0, max: 10_000 },
      ],
      12352,
    ) as Row[];

    const share = (value: string): number => rows.filter((r) => r.topic === value).length / rows.length;
    const store = new RowStore(rows);
    store.find({ topic: "v0" });
    store.find({ topic: "v0" });

    const shape = store.stats().shapes.find((s) => s.op === "eq")!;
    const estimate = shape.estimatedSelectivity!;
    // One number for every value in the column, which is the uniformity
    // assumption doing exactly what it says.
    expect(estimate).toBeCloseTo(1 / store.stats().indexes[0]!.distinct, 12);

    expect(share("v0") / estimate).toBeGreaterThan(80);
    // v499 is the rare value the panel's skew queries alternate with, not the
    // rarest in the column: 99 values occur exactly once, where the estimate is
    // 12x too high.
    expect(estimate / share("v499")).toBeGreaterThan(5.9);
    // And the number it actually plans with, the exact posting-list size, has no
    // such problem: it IS the answer count.
    expect(store.find({ topic: "v0" }).length).toBe(Math.round(share("v0") * rows.length));
  });
});
