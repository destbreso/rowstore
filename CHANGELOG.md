# Changelog

## 0.1.0

First release.

An in-memory collection that decides its own indexes by counting which predicate
shapes come back, with no declaration and no configuration required.

- **The build decision has one input**: how many times a predicate shape has been
  seen. Not a cost model and not an estimated selectivity. The threshold is two,
  derived: a hash build reads exactly what the scan it replaces reads, so on the
  reads axis building on first sight is weakly dominant, and the one repeat this
  store waits for buys evidence against the costs reads cannot see, at a bounded
  and measured price of one extra pass.
- **An index may never change the answer.** Equality is `===`, membership is
  `includes`, and those differ on exactly one value, so `NaN` is guarded in one
  direction for `eq` and left alone in the other for `in`. Ordered comparison
  holds only numbers, because a range is false against a string, a boolean and
  NaN, so what the index excludes is exactly what a range cannot match. Where a
  structure cannot implement the comparison it refuses to exist and reports why.
- **Maintenance is incremental**, one read per index per mutation, through
  `insert`, `remove` and `update`. Never invalidate-and-rebuild.
- **`stats()` publishes the store's own estimate beside what it measured.** The
  estimate is `1/distinct`, wrong by 5x on a skewed column, and it is printed
  rather than used: the driving path is chosen from exact posting-list sizes and
  residual predicates are ordered by the fraction of rows they were measured to
  reject.

Measured by `rowtoll` against the best index set that exists for each workload,
found by exhaustive search with a planner that knows the true selectivity of
every predicate: **exactly optimal on 22 of 24 workloads, 1.09x mean, 2.24x
worst**. The two workloads where it loses are both the price of not knowing the
future, which the reference does know.

The harness found two things during the build that the tests did not:

- It answers from its own snapshot, correctly flagged, because an index holds the
  values it read when it was built. That is what `update` is for, and it was
  missing until the harness said so.
- A sorted index can serve equality, so a field that already has one never needs
  a hash built for `eq`. Worth a full pass on any workload that meets its ranges
  before its equalities.
