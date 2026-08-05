# Changelog

## 0.1.4

**The throughput column in the README was one process's opinion, and now it is
seven processes' agreement.** `rowtoll` 0.2.0 repeats the timing axis in separate
processes and orders two engines only when every one of them agreed on the
direction, a paired sign test rather than the 1.25x threshold the old caveat
pointed at. `bench/arena.ts` runs that protocol: the parent measures the reads
axis, which is a count and cannot come out differently, and hands the clock to
fresh processes that do nothing else.

Nothing about this store changed, and no read moved: the competitive ratios are
the same figures they were, because they were never the noisy kind. What changed
is what the clock is allowed to claim, and two things came out of it that a
single-process table could not have supported:

- The mutation table carries the spread between processes beside each rate, and
  the harness orders 27 of the 28 pairs in it.
- The pair it refuses is this package against itself. The eager arm and the
  default differ by 4,968 field reads at sixteen mutations per query, which is
  exact, and by a clock gap that went the other way in one process out of seven,
  which is not a result at all.

## 0.1.3

The skewed-column figures said "the coldest 0.04%", and 0.04% is not the coldest
value: it is the rare value the panel's queries alternate with, two rows in five
thousand. The rarest value that occurs at all is one row, where the estimate is
12x too high rather than 6x. Both numbers are in the README now, with the 500
declared values distinguished from the 422 that actually appear, which is where
the 0.24% comes from.

## 0.1.2

The paragraph under the mutation table still carried the numbers the table above
it had just been corrected away from: 7,705,084 against 6,000 reads and 1,073
against 173,938 queries per second, from a run at a different scale. On the
workload actually shown it is 21,981,027 against 11,400, and 383 against 152,745.

Same defect as the one 0.1.1 was about, one paragraph further down, which is what
a spot fix buys you when the numbers live in prose instead of in a table the
benchmark generates.

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

And 0.1.0 said the `1/distinct` estimate is "wrong by 5x on a skewed column",
which was a guess in the shape of a measurement. Measured on the harness's own
skewed field, 500 values under a Zipf distribution at the report's scale: the
estimate says 0.24% for all of them, the hottest really selects 19.1% and the
coldest 0.04%. That is 80x in one direction and 6x in the other, it makes the
point far better than the number I made up for it, and it now has a test.

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
