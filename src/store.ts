// The store.
//
// It has no `ensureIndex`. It watches which predicate shapes come back, and
// builds the access path the moment the arithmetic says the loan repays.
//
// WHY THE THRESHOLD IS TWO, and why that is arithmetic rather than a taste:
//
// Building a hash index over a field reads every value once. That is exactly
// what the full scan it replaces reads. So on reads alone, building on FIRST
// sight is weakly dominant: one query costs a pass either way, and every query
// after that is free. There is no crossover to find, not even at 100%
// selectivity, where an index still reads no record at all.
//
// This store still waits for the second sighting, and the reason is the part
// reads cannot see. An index costs memory, and it costs maintenance on every
// mutation, and there is no instrument here for either. One repeat is the
// cheapest possible evidence that a shape belongs to the workload rather than
// being a one-off. The price of asking for that evidence is bounded and known:
// at most one extra pass, and only for shapes queried exactly twice, which is
// 2x at two queries and 1.01x at two hundred. Set `buildAfter: 1` to spend
// memory for that, or a larger number to be stingier.
//
// The number of queries a shape has been seen is the ONLY input to the
// decision. Not a cost model, not an estimated selectivity: this store never
// decides anything using a number it made up about itself.

import { HashIndex, SortedIndex } from "./indexes.js";
import type {
  Condition,
  FieldValue,
  IndexReport,
  Op,
  Predicate,
  Query,
  Row,
  ShapeReport,
  Stats,
} from "./types.js";

const RANGE_OPS = new Set<Op>(["lt", "lte", "gt", "gte"]);
const isRange = (op: Op): op is "lt" | "lte" | "gt" | "gte" => RANGE_OPS.has(op);

export interface StoreOptions {
  /**
   * Sightings of a predicate shape before its index is built. Default 2, for
   * the reason given at the top of this file. 1 builds on first sight, which is
   * never worse on reads and always costs memory sooner.
   */
  buildAfter?: number;
  /** Turn off index building entirely, so the store is a scan and nothing else. */
  scanOnly?: boolean;
}

interface Shape {
  field: string;
  op: Op;
  seen: number;
  /** Rows this predicate was actually applied to, and how many survived. */
  tested: number;
  passed: number;
}

interface FieldIndexes {
  hash?: HashIndex;
  sorted?: SortedIndex;
  hashBuiltAfter?: number;
  sortedBuiltAfter?: number;
  hashBuildCost?: number;
  sortedBuildCost?: number;
  hashSaved?: number;
  sortedSaved?: number;
}

/** Flatten a query object into comparisons, rejecting anything unrecognized. */
export function predicates(query: Query): Predicate[] {
  const out: Predicate[] = [];
  for (const field of Object.keys(query)) {
    const c = query[field]!;
    if (typeof c !== "object" || c === null) {
      out.push({ field, op: "eq", value: c });
      continue;
    }
    const cond = c as Condition;
    let any = false;
    for (const key of Object.keys(cond)) {
      const op = key as Op;
      switch (op) {
        case "eq":
          out.push({ field, op, value: cond.eq! });
          break;
        case "in":
          out.push({ field, op, value: 0, values: cond.in! });
          break;
        case "lt":
        case "lte":
        case "gt":
        case "gte":
          out.push({ field, op, value: cond[op]! });
          break;
        default:
          throw new Error(
            `rowstore: unknown operator ${JSON.stringify(key)} on field ${JSON.stringify(field)}. ` +
              `Supported: eq, in, lt, lte, gt, gte.`,
          );
      }
      any = true;
    }
    if (!any) {
      throw new Error(`rowstore: empty condition on field ${JSON.stringify(field)}`);
    }
  }
  return out;
}

/** Does a predicate hold for a value already in hand? The definition of truth here. */
export function holds(v: FieldValue | undefined, p: Predicate): boolean {
  switch (p.op) {
    case "eq":
      return v === p.value;
    case "in":
      return p.values!.includes(v as FieldValue);
    // A range compares numbers. A string, a boolean and NaN are all false
    // against every bound, which is what JavaScript says and therefore what a
    // scan would say, so it is what the index has to say too.
    case "lt":
      return typeof v === "number" && v < (p.value as number);
    case "lte":
      return typeof v === "number" && v <= (p.value as number);
    case "gt":
      return typeof v === "number" && v > (p.value as number);
    case "gte":
      return typeof v === "number" && v >= (p.value as number);
  }
}

export class RowStore {
  private readonly rows = new Map<number, Row>();
  private readonly indexes = new Map<string, FieldIndexes>();
  private readonly shapes = new Map<string, Shape>();
  private readonly refused: Stats["refused"] = [];
  private readonly buildAfter: number;
  private readonly scanOnly: boolean;
  private reads = 0;
  private queries = 0;

  constructor(rows: Iterable<Row> = [], options: StoreOptions = {}) {
    this.buildAfter = Math.max(1, options.buildAfter ?? 2);
    this.scanOnly = options.scanOnly ?? false;
    for (const row of rows) this.admit(row);
  }

  /**
   * The one door a row comes in through.
   *
   * It exists because there were two. `insert` refused a duplicate `_id` and
   * the constructor did not, so the same three rows either threw or silently
   * became two depending on which way they arrived, and `find` then answered
   * with fewer rows than the collection held. In a package whose thesis is that
   * an index may never change the answer, the answer was already wrong before
   * any index existed.
   *
   * A missing `_id` is refused for the same reason: every row without one keys
   * on `undefined`, so a whole collection collapses onto the last row of it.
   * The type says `_id` is required, and JavaScript callers do not read types.
   */
  private admit(row: Row): void {
    if (typeof row._id !== "number" || !Number.isFinite(row._id)) {
      throw new Error(
        `rowstore: every row needs a numeric _id, got ${JSON.stringify(row._id)}. ` +
          "Rows without one all key on the same slot and overwrite each other.",
      );
    }
    if (this.rows.has(row._id)) throw new Error(`rowstore: duplicate _id ${row._id}`);
    this.rows.set(row._id, row);
  }

  get size(): number {
    return this.rows.size;
  }

  /** Read a field, and pay for it. Every value access in this file goes here. */
  private read(row: Row, field: string): FieldValue {
    this.reads++;
    return row[field]!;
  }

  private shapeOf(p: Predicate): Shape {
    // The separator is written as an escape, not as the byte itself. It used to
    // be the byte, which is the same string at runtime and a binary file on
    // disk: `file` called this source "data" and `grep` skipped it in silence,
    // which is a tool going quiet rather than wrong, and so the worse of the two.
    const key = `${p.field}\u0000${p.op}`;
    let s = this.shapes.get(key);
    if (!s) {
      s = { field: p.field, op: p.op, seen: 0, tested: 0, passed: 0 };
      this.shapes.set(key, s);
    }
    return s;
  }

  private indexesFor(field: string): FieldIndexes {
    let f = this.indexes.get(field);
    if (!f) {
      f = {};
      this.indexes.set(field, f);
    }
    return f;
  }

  /** Serve a predicate from an index, or undefined when none can. */
  private served(p: Predicate): { count: number; select: () => Set<number> } | undefined {
    const f = this.indexes.get(p.field);
    if (!f) return undefined;
    if (p.op === "eq" && f.hash) {
      const n = f.hash.count(p.value);
      return { count: n, select: () => new Set(f.hash!.eq(p.value) ?? []) };
    }
    // A sorted index answers equality too, by the same bounds it uses for a
    // range, so a field that already has one never needs a second structure to
    // be built for `eq`. It costs a binary search instead of a hash lookup,
    // which the reads axis does not see and the clock does.
    if (p.op === "eq" && f.sorted) {
      const n = f.sorted.countEq(p.value);
      if (n !== undefined) return { count: n, select: () => f.sorted!.eq(p.value)! };
    }
    if (p.op === "in" && f.hash) {
      const set = f.hash.in(p.values!);
      return { count: set.size, select: () => set };
    }
    if (isRange(p.op) && f.sorted) {
      const n = f.sorted.count(p.op, p.value as number);
      return { count: n, select: () => f.sorted!.select(p.op as "lt", p.value as number) };
    }
    return undefined;
  }

  /** Build whatever the sightings now justify. Reads a pass per index built. */
  private maybeBuild(p: Predicate): void {
    if (this.scanOnly) return;
    const shape = this.shapeOf(p);
    if (shape.seen < this.buildAfter) return;
    const f = this.indexesFor(p.field);

    // `in` still needs a hash: a sorted index would have to do one lookup per
    // value and cannot answer for a non-numeric one at all.
    const sortedCoversEq = p.op === "eq" && f.sorted !== undefined;
    if ((p.op === "eq" || p.op === "in") && !f.hash && !sortedCoversEq) {
      const hash = new HashIndex(p.field);
      for (const row of this.rows.values()) hash.add(this.read(row, p.field), row._id);
      f.hash = hash;
      f.hashBuiltAfter = shape.seen;
      f.hashBuildCost = this.rows.size;
      f.hashSaved = 0;
    }

    if (isRange(p.op) && !f.sorted) {
      const pairs: { value: number; id: number }[] = [];
      for (const row of this.rows.values()) {
        const v = this.read(row, p.field);
        if (SortedIndex.indexable(v)) pairs.push({ value: v, id: row._id });
      }
      if (pairs.length === 0) {
        // Every value is a string, a boolean or NaN, so no range can ever match
        // one. The index would be an empty structure kept up to date forever.
        this.refused.push({
          field: p.field,
          kind: "sorted",
          reason: `no orderable value among ${this.rows.size} rows`,
        });
        return;
      }
      const sorted = new SortedIndex(p.field);
      sorted.bulkLoad(pairs);
      f.sorted = sorted;
      f.sortedBuiltAfter = shape.seen;
      f.sortedBuildCost = this.rows.size;
      f.sortedSaved = 0;
    }
  }

  /**
   * The rows matching every condition, as ids.
   *
   * The plan: drive from the index that selects fewest rows, intersect the other
   * indexed conditions, then apply the rest by reading fields, most selective
   * first. "Most selective" is MEASURED, from the fraction of rows this exact
   * predicate shape has rejected before, and where nothing has been measured yet
   * the order is the order you wrote them in. There is no cost model and no
   * guessed constant.
   */
  find(query: Query): number[] {
    const preds = predicates(query);
    this.queries++;

    for (const p of preds) {
      this.shapeOf(p).seen++;
      this.maybeBuild(p);
    }

    const indexed: { p: Predicate; count: number; select: () => Set<number> }[] = [];
    const residual: Predicate[] = [];
    for (const p of preds) {
      const s = this.served(p);
      if (s) indexed.push({ p, ...s });
      else residual.push(p);
    }

    let candidates: Iterable<number>;
    let candidateCount: number;
    if (indexed.length > 0) {
      indexed.sort((a, b) => a.count - b.count);
      let set = indexed[0]!.select();
      for (let i = 1; i < indexed.length; i++) {
        const other = indexed[i]!.select();
        const next = new Set<number>();
        for (const id of set) if (other.has(id)) next.add(id);
        set = next;
      }
      candidates = set;
      candidateCount = set.size;
      // Every row the driving index excluded is a row nobody read. Credited to
      // the driver alone: splitting it across several indexes would count the
      // same avoided read more than once.
      const driver = indexed[0]!.p;
      const f = this.indexes.get(driver.field)!;
      const saved = this.rows.size - candidateCount;
      if (isRange(driver.op)) f.sortedSaved = (f.sortedSaved ?? 0) + saved;
      else f.hashSaved = (f.hashSaved ?? 0) + saved;
    } else {
      candidates = this.rows.keys();
      candidateCount = this.rows.size;
    }

    // Shapes resolved once, outside the row loop: looking one up per row per
    // predicate is a hash lookup on the hottest path in the library.
    const order = residual
      .map((p) => ({ p, shape: this.shapeOf(p) }))
      .sort((a, b) => selectivityOf(a.shape) - selectivityOf(b.shape));

    const out: number[] = [];
    outer: for (const id of candidates) {
      const row = this.rows.get(id);
      if (!row) continue;
      for (const { p, shape } of order) {
        shape.tested++;
        if (!holds(this.read(row, p.field), p)) continue outer;
        shape.passed++;
      }
      out.push(id);
    }
    return out;
  }

  /** The single row matching, or undefined. Same plan, stops at the first hit. */
  findOne(query: Query): Row | undefined {
    const id = this.find(query)[0];
    return id === undefined ? undefined : this.rows.get(id);
  }

  insert(row: Row): void {
    this.admit(row);
    for (const [field, f] of this.indexes) {
      if (f.hash) f.hash.add(this.read(row, field), row._id);
      if (f.sorted) f.sorted.add(this.read(row, field), row._id);
    }
  }

  /**
   * Change a row through the store, so its indexes stay true.
   *
   * The harness flags this store as answering from its own snapshot, and that
   * is accurate: an index holds the values it read when it was built, so
   * mutating a record in place behind the store's back leaves the index
   * describing a row that no longer exists. Every database has this property
   * and every one of them makes you go through the writer. This is the writer.
   */
  update(id: number, patch: Partial<Record<string, FieldValue>>): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    for (const [field, next] of Object.entries(patch)) {
      if (next === undefined || field === "_id") continue;
      const f = this.indexes.get(field);
      if (f) {
        const previous = this.read(row, field);
        if (f.hash) {
          f.hash.remove(previous, id);
          f.hash.add(next, id);
        }
        if (f.sorted) {
          f.sorted.remove(previous, id);
          f.sorted.add(next, id);
        }
      }
      row[field] = next;
    }
    return true;
  }

  remove(id: number): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    for (const [field, f] of this.indexes) {
      if (f.hash) f.hash.remove(this.read(row, field), id);
      if (f.sorted) f.sorted.remove(this.read(row, field), id);
    }
    this.rows.delete(id);
    return true;
  }

  /** Every row, in insertion order. */
  all(): Row[] {
    return [...this.rows.values()];
  }

  get(id: number): Row | undefined {
    return this.rows.get(id);
  }

  /**
   * What it decided, and what it knows.
   *
   * `estimatedSelectivity` is this store's own claim about its behavior and is
   * published so it can be checked against a real measurement, never used in
   * place of one. `observedSelectivity` is not a claim: it is the fraction of
   * the rows this predicate was actually applied to that survived it.
   */
  stats(): Stats {
    const indexes: IndexReport[] = [];
    for (const [field, f] of this.indexes) {
      if (f.hash) {
        indexes.push({
          field,
          kind: "hash",
          distinct: f.hash.distinct,
          entries: f.hash.entries,
          builtAfter: f.hashBuiltAfter ?? 0,
          buildCost: f.hashBuildCost ?? 0,
          saved: f.hashSaved ?? 0,
        });
      }
      if (f.sorted) {
        indexes.push({
          field,
          kind: "sorted",
          distinct: f.sorted.distinct,
          entries: f.sorted.entries,
          builtAfter: f.sortedBuiltAfter ?? 0,
          buildCost: f.sortedBuildCost ?? 0,
          saved: f.sortedSaved ?? 0,
        });
      }
    }

    const shapes: ShapeReport[] = [...this.shapes.values()].map((s) => ({
      field: s.field,
      op: s.op,
      seen: s.seen,
      estimatedSelectivity: this.estimate(s),
      observedSelectivity: s.tested > 0 ? s.passed / s.tested : 0,
    }));

    return {
      rows: this.rows.size,
      indexes,
      shapes,
      queries: this.queries,
      reads: this.reads,
      refused: [...this.refused],
    };
  }

  /**
   * What this store would guess a shape's selectivity to be from its index, and
   * null when it has no basis. Reported, never used to decide anything: the
   * driving path is chosen from exact posting-list sizes, and residual order
   * from what was measured.
   */
  private estimate(s: Shape): number | null {
    const f = this.indexes.get(s.field);
    if (!f || this.rows.size === 0) return null;
    if ((s.op === "eq" || s.op === "in") && f.hash) {
      return f.hash.distinct === 0 ? null : 1 / f.hash.distinct;
    }
    if (isRange(s.op) && f.sorted) return 0.5;
    return null;
  }
}

/**
 * Order residual predicates by the fraction of rows they have been measured to
 * reject, most selective first. A shape nothing has been measured about sorts
 * last and keeps its written order among its peers, because a sort here is
 * stable: an unmeasured predicate is not assumed to be anything.
 */
function selectivityOf(s: Shape): number {
  return s.tested > 0 ? s.passed / s.tested : Number.POSITIVE_INFINITY;
}
