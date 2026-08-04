// The two access paths, and the exact reason each one is allowed to answer.
//
// The rule both of them obey: an index may only be used where it returns the
// same rows the scan would have. That sounds obvious and it is where the
// incumbent fails. lokijs answers `$in` from its binary index without
// re-verifying the candidates, and its range is computed with type-loose
// comparators, so on a column holding both `2` and `"2"` an index changes the
// answer: ten rows, five of each, and `$in: [2]` returns five unindexed and all
// ten indexed. It has been open as issue #909 since March 2022.
//
// For a collection that builds its own indexes that failure mode is worse than
// a wrong answer, it is a wrong answer that appears only after the workload has
// warmed up. So each structure here is matched to the comparison it implements
// exactly, and where it cannot be, it refuses to exist.

import type { FieldValue, IndexKind, Row } from "./types.js";

/**
 * Equality and membership.
 *
 * A `Map` compares keys with SameValueZero, which is `===` for every value this
 * store accepts, with one exception: SameValueZero says `NaN` equals `NaN` and
 * `===` does not. That is not a rounding difference, it is the whole trap, and
 * it points in opposite directions for the two operators this index serves:
 * `Array.prototype.includes` also uses SameValueZero, so `in` wants the Map's
 * behavior, while `eq` wants strict equality and must be guarded.
 */
export class HashIndex {
  readonly kind: IndexKind = "hash";
  private readonly buckets = new Map<FieldValue, Set<number>>();
  entries = 0;

  constructor(readonly field: string) {}

  add(value: FieldValue, id: number): void {
    const b = this.buckets.get(value);
    if (b) b.add(id);
    else this.buckets.set(value, new Set([id]));
    this.entries++;
  }

  remove(value: FieldValue, id: number): void {
    const b = this.buckets.get(value);
    if (!b || !b.delete(id)) return;
    this.entries--;
    if (b.size === 0) this.buckets.delete(value);
  }

  /** Rows where the field is strictly equal to `value`. */
  eq(value: FieldValue): ReadonlySet<number> | undefined {
    // `NaN === NaN` is false, so an equality query for NaN selects nothing,
    // whatever the Map thinks.
    if (typeof value === "number" && Number.isNaN(value)) return EMPTY;
    return this.buckets.get(value);
  }

  /** Rows where the field is one of `values`, with `includes` semantics. */
  in(values: readonly FieldValue[]): Set<number> {
    const out = new Set<number>();
    for (const v of values) {
      const b = this.buckets.get(v);
      if (b) for (const id of b) out.add(id);
    }
    return out;
  }

  /** How many rows a given value selects, exactly, without reading a record. */
  count(value: FieldValue): number {
    if (typeof value === "number" && Number.isNaN(value)) return 0;
    return this.buckets.get(value)?.size ?? 0;
  }

  get distinct(): number {
    return this.buckets.size;
  }
}

const EMPTY: ReadonlySet<number> = new Set();

/**
 * Ordered comparison, over numbers only.
 *
 * A range predicate here means what it means in the language: `score > 100` is
 * false for a string, for a boolean and for `NaN`, because those comparisons are
 * false in JavaScript. So this index holds only the numeric, non-NaN values, and
 * everything it excludes is exactly what a range can never match. The exclusion
 * is not an approximation that needs re-checking, it is the semantics.
 */
export class SortedIndex {
  readonly kind: IndexKind = "sorted";
  private values: number[] = [];
  private ids: number[] = [];

  constructor(readonly field: string) {}

  static indexable(v: FieldValue): v is number {
    return typeof v === "number" && !Number.isNaN(v);
  }

  bulkLoad(pairs: readonly { value: number; id: number }[]): void {
    // Sorting once, not splicing per row: an ordered build costs O(n log n) and
    // reads each value exactly once, which is the same single pass the scan it
    // replaces costs. Inserting row by row would make it quadratic.
    const sorted = [...pairs].sort((a, b) => a.value - b.value || a.id - b.id);
    this.values = sorted.map((p) => p.value);
    this.ids = sorted.map((p) => p.id);
  }

  private lowerBound(v: number): number {
    let lo = 0;
    let hi = this.values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.values[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private upperBound(v: number): number {
    let lo = 0;
    let hi = this.values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.values[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  add(value: FieldValue, id: number): void {
    if (!SortedIndex.indexable(value)) return;
    const at = this.upperBound(value);
    this.values.splice(at, 0, value);
    this.ids.splice(at, 0, id);
  }

  remove(value: FieldValue, id: number): void {
    if (!SortedIndex.indexable(value)) return;
    for (let i = this.lowerBound(value); i < this.values.length; i++) {
      if (this.values[i] !== value) return;
      if (this.ids[i] === id) {
        this.values.splice(i, 1);
        this.ids.splice(i, 1);
        return;
      }
    }
  }

  /** Row count in a half-open slot range, without materializing it. */
  private span(from: number, to: number): number {
    return Math.max(0, to - from);
  }

  /** Rows where the field is strictly equal to `value`, when it is a number. */
  eq(value: FieldValue): Set<number> | undefined {
    if (!SortedIndex.indexable(value)) return undefined;
    const from = this.lowerBound(value);
    const to = this.upperBound(value);
    const out = new Set<number>();
    for (let i = from; i < to; i++) out.add(this.ids[i]!);
    return out;
  }

  /** How many rows equal `value`, exactly, without reading a record. */
  countEq(value: FieldValue): number | undefined {
    if (!SortedIndex.indexable(value)) return undefined;
    return this.upperBound(value) - this.lowerBound(value);
  }

  bounds(op: "lt" | "lte" | "gt" | "gte", value: number): [number, number] {
    switch (op) {
      case "lt":
        return [0, this.lowerBound(value)];
      case "lte":
        return [0, this.upperBound(value)];
      case "gt":
        return [this.upperBound(value), this.values.length];
      case "gte":
        return [this.lowerBound(value), this.values.length];
    }
  }

  /** How many rows a range selects, exactly, without reading a record. */
  count(op: "lt" | "lte" | "gt" | "gte", value: number): number {
    const [from, to] = this.bounds(op, value);
    return this.span(from, to);
  }

  select(op: "lt" | "lte" | "gt" | "gte", value: number): Set<number> {
    const [from, to] = this.bounds(op, value);
    const out = new Set<number>();
    for (let i = from; i < to; i++) out.add(this.ids[i]!);
    return out;
  }

  get entries(): number {
    return this.values.length;
  }

  get distinct(): number {
    let n = 0;
    for (let i = 0; i < this.values.length; i++) {
      if (i === 0 || this.values[i] !== this.values[i - 1]) n++;
    }
    return n;
  }
}

/** Values a sorted index would have to drop, and therefore why it may refuse. */
export function unorderableCount(rows: Iterable<Row>, field: string): number {
  let n = 0;
  for (const row of rows) if (!SortedIndex.indexable(row[field]!)) n++;
  return n;
}
