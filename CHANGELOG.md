# Changelog

## 0.1.1

Documentation, and the evidence behind it. No behavior changes.

**The benchmark had been running with three of its four rivals missing.** The
harness came from a local path, which brought its dev dependencies with it, so
`sift`, `mingo` and `lokijs` resolved by accident. Installed from the registry
they did not, and the panel quietly became a table this package and
`Array.prototype.filter`. They are dev dependencies here now, and the run reports
what it could not load instead of printing a short table that looks complete.

**Three numbers in the README did not come from the committed run.** The mutation
table was from a smaller scale and labeled with the wrong row count; the lokijs
`$in` defect was stated as "four rows without an index and eight with one", which
is neither the reduction in the tests nor what the panel reproduces; and the
`stats()` example had a hand-rounded `saved` and a selectivity of zero where the
store reports the real one. All three now come from the run in `BENCHMARKS.md`.

**The README advertised only the eager arm.** `buildAfter: 1` is 1.09x mean and
22 of 24 exactly optimal; the default, which waits for one repeat, is 2.09x mean
and matches exactly once. Both are stated, and the summary table in
`BENCHMARKS.md` is computed by the benchmark rather than copied by hand.

Also: two figures drawn from the benchmark's own JSON (`npm run figures`), and
the benchmark now writes that JSON alongside the markdown.

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
