// The query language, and the record shape it runs over.
//
// Deliberately small. It is the surface where an access path is a real decision
// and nothing more: equality, membership, and ordered comparison, joined by AND.
// A collection that also had to be a query engine would be competing with sift
// and mingo, which are 6.5M and 250k weekly downloads of solved problem.

export type FieldValue = number | string | boolean;

/** A record. `_id` is unique and is never a predicate field. */
export type Row = { _id: number } & Record<string, FieldValue>;

/**
 * A condition on one field.
 *
 * Written as an object, so `{ score: { gte: 100, lt: 200 } }` is one field with
 * two bounds. There are no `$` prefixes: this is not Mongo and pretending
 * otherwise invites the assumption that the other forty operators exist.
 */
export interface Condition {
  eq?: FieldValue;
  in?: readonly FieldValue[];
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
}

/** A query is a conjunction: every field's condition must hold. */
export type Query = Record<string, FieldValue | Condition>;

/** One condition flattened to a single comparison, which is what a plan works with. */
export type Op = "eq" | "in" | "lt" | "lte" | "gt" | "gte";

export interface Predicate {
  field: string;
  op: Op;
  value: FieldValue;
  values?: readonly FieldValue[];
}

export type IndexKind = "hash" | "sorted";

/** What the store decided, and what it knows. Everything here is measured. */
export interface IndexReport {
  field: string;
  kind: IndexKind;
  /** Distinct values held, which is what makes an equality index worth having. */
  distinct: number;
  /** Entries held. Equals the live row count for a total field. */
  entries: number;
  /** Queries seen for this shape before the index existed. */
  builtAfter: number;
  /** Rows the build had to read: the collection size at that moment. */
  buildCost: number;
  /** Reads this index has saved since, versus scanning for the same queries. */
  saved: number;
}

export interface ShapeReport {
  field: string;
  op: Op;
  seen: number;
  /**
   * Mean selectivity ESTIMATED from the index, when one exists, and from the
   * answers actually returned when one does not.
   *
   * It is a claim about this store's own behavior, so it is published rather
   * than trusted, and a harness measuring the real selectivity should print
   * both. That is the whole reason this field is in the public report.
   */
  estimatedSelectivity: number | null;
  /** Selectivity of the answers actually produced, which is not an estimate. */
  observedSelectivity: number;
}

export interface Stats {
  rows: number;
  indexes: IndexReport[];
  shapes: ShapeReport[];
  /** Queries answered since construction. */
  queries: number;
  /** Field reads the store believes it performed. A claim, like any self-report. */
  reads: number;
  /** Fields an index was refused on, with the measured reason. */
  refused: { field: string; kind: IndexKind; reason: string }[];
}
