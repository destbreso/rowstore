# rowstore

An in-memory collection that decides its own indexes by watching the queries you
actually run.

There is no `ensureIndex`. You hand it rows and ask questions; it counts which
predicate shapes come back, builds the access path the moment the arithmetic
says the loan repays, keeps it correct incrementally through mutations, and
tells you exactly what it did and why.

```js
import { RowStore } from "rowstore";

const store = new RowStore(rows);

store.find({ status: "open" });                       // scans, and takes note
store.find({ status: "closed" });                     // builds a hash index, uses it
store.find({ status: "open", score: { gte: 100 } });  // and keeps going

store.stats();   // what it built, when, what it cost, what it saved
```

## How well does it guess

Measured by [`rowtoll`](https://github.com/destbreso/rowtoll), which counts field
reads through the records themselves and checks every answer against
`Array.prototype.filter`. The reference it is measured against is the best index
set that exists for each workload, found by exhaustive search, with a planner
that was handed the true selectivity of every predicate. It is allowed to know
the future. This is not.

Building on first sight (`buildAfter: 1`), **it matches that optimum exactly on
22 of 24 workloads**, mean 1.09x, worst 2.24x.

| where it loses | ratio | why |
|---|---|---|
| `conjunct` | 2.24x | it indexes all three repeated shapes; the optimum needed one |
| `hash-trap` | 2.00x | equality queries arrive first, so it builds a hash where the sorted index later covers both |

Both are the same thing: the offline optimum saw the whole workload before
choosing. Neither is a bug to be fixed by a cleverer heuristic, and pretending
otherwise would mean guessing, which is the one thing this store does not do.

![Competitive ratio per workload for both arms: the eager arm sits at 1.00x on 22 of 24 workloads, the default arm at about 2.00x on most of them](https://raw.githubusercontent.com/destbreso/rowstore/main/assets/competitive-ratio.svg)

The default waits for a shape to repeat, and that wait is the whole difference:
mean 2.09x, worst 4.13x on `hash-trap`, exactly one unindexed pass per shape more
than the eager arm on every workload. The next section is why that trade is the
default anyway, and one line changes it. Both arms are in the table in
[BENCHMARKS.md](BENCHMARKS.md), workload by workload, alongside four other
engines.

Against the incumbent, on the axis where the harness found the most loss
available. This is `churn/m=16`: 5,000 rows, 200 equality queries, and sixteen
insert-and-remove pairs between each of them, so 6,400 mutations in all.

| engine | field reads | queries/s | run to run |
|---|---:|---:|---:|
| `rowstore`, eager | 11,400 | 158,249 | +/- 23.9% |
| `rowstore`, default | 16,368 | 138,237 | +/- 4.6% |
| `lokijs`, index maintained incrementally | 291,388 | 6,944 | +/- 1.8% |
| `lokijs`, index rebuilt when invalidated | 21,981,027 | 387 | +/- 0.6% |
| `lokijs`, no index declared | 1,000,000 | 12,978 | +/- 2.6% |
| `Array.prototype.filter` | 1,000,000 | 18,769 | +/- 4.7% |

11,400 is also the offline optimum for that workload, so under mutation the
eager arm pays exactly what perfect foresight pays. Reads are exact and
reproducible from the seed. The clock column is a median over seven separate
processes, with the spread between them beside it, and the harness orders two
engines only when every one of those processes agreed on the direction. It
orders 27 of the 28 pairs in that table. The one it refuses is the two
`rowstore` arms against each other: the reads separate them by 4,968 and the
clock does not separate them at all.

![Field reads under mutation, log scale: rowstore at 11,400 against 291,388 for an incrementally maintained lokijs index and 21,981,027 for one rebuilt on invalidation](https://raw.githubusercontent.com/destbreso/rowstore/main/assets/mutation.svg)

## Why the threshold is two

Building a hash index over a field reads every value once. That is exactly what
the full scan it replaces reads. So on reads alone, building on **first** sight
is weakly dominant: one query costs a pass either way, and every query after it
is free. There is no crossover to find, not even at 100% selectivity, where an
index still reads no record at all.

This store waits for the second sighting anyway, and the reason is the part
reads cannot see. An index costs memory, and it costs maintenance on every
mutation, and it has no instrument for either. One repeat is the cheapest
possible evidence that a shape belongs to the workload rather than being a
one-off, and the price of asking for it is exactly one unindexed pass, paid once
per shape.

That price does not amortize, and the measurement says so plainly: where the
optimum's whole cost is a single build pass, one extra pass is 2.00x whether two
queries follow or two hundred. It is smaller only where the optimum has to read
rows anyway (down to 1.44x under heavy mutation) and larger where the wait
happens twice on one field (4.13x on `hash-trap`). Against no index at all, which
is the alternative in most real code, the same store is still ahead by a factor
that grows with every query.

```js
new RowStore(rows, { buildAfter: 1 });   // build on first sight
new RowStore(rows, { buildAfter: 10 });  // be stingier
new RowStore(rows, { scanOnly: true });  // never build anything
```

The number of times a shape has been seen is the **only** input to the decision.
Not a cost model, not an estimated selectivity. This store never decides anything
using a number it made up about itself.

## An index may never change the answer

This is the failure the package exists to avoid, and it is not hypothetical.

lokijs answers `$in` from its binary index without re-verifying the candidates,
and computes that index's range with type-loose comparators. Ten rows, five
holding the number `2` and five holding the string `"2"`, and one query:

```js
col.find({ $and: [{ v: { $in: [2] } }] });   // 5 rows
col.ensureIndex("v");
col.find({ $and: [{ v: { $in: [2] } }] });   // all 10, and nothing changed but the index
```

Reported as issue #909 in March 2022, still open, the only reply a stale bot. The
harness reproduces it on its own, from outside: on the `mixed-types` workload both
indexed lokijs arms fail the correctness gate and print no toll at all, because a
number for the wrong answer is not a slower or faster number, it is a number
about a different question.

For a collection that decides on its own when to build, that class of defect is
worse than a wrong answer: it is a wrong answer that appears only after the
workload has warmed up, on the thousandth call, with nothing having changed.

So every structure here implements exactly the comparison the language does.

- Equality is `===` and membership is `Array.prototype.includes`, which differ on
  exactly one value: `NaN`. A `Map` uses SameValueZero, which is what `in` wants
  and what `eq` must be guarded against, so `{ v: NaN }` matches nothing and
  `{ v: { in: [NaN] } }` matches the NaN row, indexed or not.
- A range compares numbers. Strings, booleans and `NaN` are false against every
  bound, so the ordered index holds only the numeric values, and what it excludes
  is exactly what a range can never match. The exclusion is the semantics, not an
  approximation that needs re-checking.
- Where a structure cannot implement the comparison, it refuses to exist and says
  so in `stats().refused`.

The test suite asks every query cold, then repeatedly until an index has been
built, then again, and requires the same answer every time.

## What it tells you

```js
// 200,000 rows, 1,000 distinct values in `status`, 200 equality queries on it.
store.stats();
// {
//   rows: 200000,
//   indexes: [{ field: "status", kind: "hash", distinct: 1000, entries: 200000,
//               builtAfter: 2, buildCost: 200000, saved: 39760200 }],
//   shapes:  [{ field: "status", op: "eq", seen: 200,
//               estimatedSelectivity: 0.001, observedSelectivity: 0.001 }],
//   queries: 200, reads: 400000, refused: []
// }
```

`estimatedSelectivity` is this store's own claim about itself, computed as
`1/distinct`, which is the uniformity assumption every textbook optimizer starts
from. It is published so that it can be checked, and it does not survive the
check. On the harness's skewed column, 500 declared values under a Zipf
distribution of which 422 actually occur, the estimate says 0.24% for every one
of them. The hottest really selects 19.1% of the rows, and the rare value the
panel's queries alternate with selects 0.04%: wrong by 80x in one direction and
6x in the other, on the same field, in the same query shape. The rarest value
that occurs at all is one row in five thousand, where it is 12x too high. There
is a test that pins the first two, because a caveat nothing measures is
decoration.

It is not used to plan anything. The driving access path is chosen from the
posting list's **exact** size, which needs no assumption at all, and residual
predicates are ordered by `observedSelectivity`, which is not an estimate either:
it is the fraction of the rows a predicate was actually applied to that actually
survived it.

## Mutation

`insert`, `remove` and `update` all keep every index true, incrementally, at one
read per index per mutation. There is no invalidate-and-rebuild, because the
harness measured what that costs: on the workload in the table above, a lokijs
configured that way pays 21,981,027 field reads where this store pays 11,400, and
answers 383 queries a second where this one answers 152,745.

Change rows **through the store**. An index holds the values it read when it was
built, so mutating a record in place behind the store's back leaves the index
describing a row that no longer exists. Every database has this property; this is
why they all make you go through the writer.

## The query language

```ts
type Condition = { eq?, in?, lt?, lte?, gt?, gte? };
type Query = Record<string, FieldValue | Condition>;   // implicit AND
```

```js
store.find({ status: "open" });
store.find({ status: { in: ["open", "pending"] }, score: { gte: 100, lt: 500 } });
```

Small on purpose. It is the surface where choosing an access path is a real
decision and nothing beyond it: a collection that also had to be a query engine
would be competing with `sift` and `mingo`, which are 6.5M and 250k weekly
downloads of solved problem. An unknown operator throws with its own name in the
message rather than being quietly ignored.

## License

MIT
