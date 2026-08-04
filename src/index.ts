// rowstore: an in-memory row store that decides its own indexes.
//
// You never declare one. It counts which predicate shapes come back, builds the
// access path when the arithmetic says the loan repays, keeps it correct
// incrementally through mutations, and tells you what it did and why.

export { RowStore, holds, predicates, type StoreOptions } from "./store.js";
export { HashIndex, SortedIndex } from "./indexes.js";
export type {
  Condition,
  FieldValue,
  IndexKind,
  IndexReport,
  Op,
  Predicate,
  Query,
  Row,
  ShapeReport,
  Stats,
} from "./types.js";
