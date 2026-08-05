# rowstore, measured by rowtoll

Node v22.14.0 on darwin/arm64 (Apple M4, 10 cores, 24 GB), scale 0.25, seed 12345, index-search cap 2, data fingerprint `285d7fd0`.

Timing: 5 trials per engine in each of 7 independent processes, arms interleaved inside every round.

The machine, measured while it worked: a fixed two-million-row scan, read once before every workload, ran at 893 million row visits per second. It moved 17.7% inside a single replicate, a replicate ended 1.5% faster than it started, and +/- 0.7% separates one replicate from another. That last figure is the floor: a clock gap smaller than it is the room, not the engine.




## What it cost, against an optimum that knew the future

Every ratio below is this store's total field reads divided by the best index
set that exists for that workload, found by exhaustive search with a planner
handed the true selectivity of every predicate. It chose with the whole
workload in front of it. This store was handed no declared indexes at all and
had to find them from the queries as they arrived.

**rowstore (eager)** matches the offline optimum exactly on 22 of 24 workloads. Mean 1.09x, worst 2.24x on `conjunct`.

**rowstore** matches the offline optimum exactly on 1 of 24 workloads. Mean 2.09x, worst 4.13x on `hash-trap`.

`rowstore` is the default, which waits for a predicate shape to repeat before
it builds. That wait costs exactly one unindexed pass, paid once, and it does
not amortize: where the optimum's entire cost is a single build pass, one extra
pass is 2.00x however many queries follow. It costs less than that only where
the optimum has to read rows anyway, and more where the wait happens twice on
one field, which is what `hash-trap` and `conjunct` are for.

| workload | offline optimum | rowstore | vs optimum | rowstore (eager) | vs optimum |
|---|---:|---:|---:|---:|---:|
| `amortize/r=1` | 25,000 | 25,000 | 1.00x | 25,000 | 1.00x |
| `amortize/r=2` | 25,000 | 50,000 | 2.00x | 25,000 | 1.00x |
| `amortize/r=8` | 25,000 | 50,000 | 2.00x | 25,000 | 1.00x |
| `amortize/r=64` | 25,000 | 50,000 | 2.00x | 25,000 | 1.00x |
| `select-eq/s=1/N` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-eq/s=0.001` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-eq/s=0.05` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-eq/s=0.25` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-eq/s=0.5` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-eq/s=1` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `select-rng/keep=5%` | 10,000 | 19,687 | 1.97x | 10,000 | 1.00x |
| `select-rng/keep=20%` | 10,000 | 17,092 | 1.71x | 10,000 | 1.00x |
| `select-rng/keep=45%` | 10,000 | 21,756 | 2.18x | 10,000 | 1.00x |
| `select-rng/keep=60%` | 10,000 | 21,826 | 2.18x | 10,000 | 1.00x |
| `select-rng/keep=100%` | 10,000 | 25,000 | 2.50x | 10,000 | 1.00x |
| `churn/m=0` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `churn/m=1` | 5,400 | 10,398 | 1.93x | 5,400 | 1.00x |
| `churn/m=4` | 6,600 | 11,592 | 1.76x | 6,600 | 1.00x |
| `churn/m=16` | 11,400 | 16,368 | 1.44x | 11,400 | 1.00x |
| `hash-trap` | 5,000 | 20,643 | 4.13x | 10,000 | 2.00x |
| `skew` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `in-values` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `mixed-types` | 5,000 | 10,000 | 2.00x | 5,000 | 1.00x |
| `conjunct` | 6,698 | 22,655 | 3.38x | 15,000 | 2.24x |

## Method

**The toll is field reads.** Every dataset is duplicated: one copy where each
queryable field is an accessor that counts, and one plain copy. An engine that
walks the records pays a tick per field it looks at, whether or not it agreed to
be measured. Reads are counted separately for building and for running, and the
total is what a workload cost end to end.

Counting field reads rather than rows is deliberate. A scan applying two
predicates reads the first field on every row and the second only on the
survivors, so the ORDER predicates are tested in shows up in the number, and
predicate ordering by measured selectivity is the part of a query optimizer that
actually pays for itself.

**Correctness is a gate, not a score.** Every answer to every query is compared,
as a set of ids, against `Array.prototype.filter` over the same predicates. An
engine that fails has no toll and no throughput printed: numbers for the wrong
answer are not slower or faster, they are about a different question.

**The reference is allowed to know the future.** Its planner is handed the true
selectivity of every predicate, computed by the oracle over the actual data, the
way Belady's optimal replacement policy is handed the future. No shipped engine
can do that, which is the point. It is optimal WITHIN a disclosed strategy space
(scan, hash lookup, sorted range, posting-list intersection, residual filtering
in true-selectivity order), so an engine with a strategy it does not have can
legally beat it, and where that happens the report says so instead of calling it
a violation.

**The declared index set is the best one that exists**, found by exhaustive
search over every candidate set up to the cap, each one actually built and
actually run. Every engine that takes declared indexes gets it, identically. A
self-indexing engine is handed nothing and has to find its own, so the comparison
is against perfect foresight rather than against a plausible guess.

**Timing is separate and never mixes with counting.** Accessors are slower than
data properties and change what the JIT can assume, so throughput is measured on
the plain copy, arms interleaved inside every round. There is no warmup constant,
because a declared warmup is a claim about how long an engine takes to settle and
a claim needs an instrument: the first trial is printed next to the median
instead.

**The clock is repeated in separate processes, and the counting is not.** A
count is a function of the seed, so running it again reproduces it; repeating it
would measure nothing. A clock figure is not, and the spread inside one
measurement is the most flattering dispersion available for it: on the machine
that produced this report, repeating a whole seven-trial measurement eight times
moved the median by 20.9% against a printed interquartile range of 4.6%. So the
two are separate columns. **Run to run** is half the range of the per-process
medians, over their median, and it is the one to read as uncertainty. **IQR
within a run** is the old number, kept because a large gap between them says the
machine, not the engine, is what moved. A single-process run prints `n=1` in
the first column rather than a zero, because an uncertainty that was not measured
is absent, not small.

Each replicate is a fresh process that times and does nothing else. It does not
repeat the index search or the toll pass, which is deliberate past saving the
minutes: the toll pass hands every engine rows whose fields are accessors, and
doing it first leaves the JIT holding inline caches for exactly the code about to
be timed on a different shape.

**Two engines are ordered by a paired sign test, not by a threshold.** Arms
measured inside the same replicate share that replicate's mood, so the sign of
the difference is the part that survives it, and the sign needs no assumption
about the distribution: under the null that two engines are the same speed each
replicate is a coin flip, and agreement across all `k` of them has
`p = 2^(1-k)`. Unanimity is the whole rule. An engine that lost even once has
not been shown to be faster, whatever the medians look like. Each throughput
table says how many of its pairs the replicates order, names the ones they do
not, and states how many orderings a table of that size gets by luck at that
replicate count.

The rule replaced a constant, and the constant is why it needed replacing. This
report used to say that a throughput gap under roughly 1.25x was not a result, a
figure taken from repeating one measurement eight times. Then three whole runs of
this panel on one machine put a single pairing at 1.6x one way, 1.8x the other
and 1.5x back, every one of them past that constant, while the reads on it came
out identical to the read all three times. A threshold cannot express that, and
it is wrong in the other direction too: a difference of a few percent that every
process agreed on is a result, and a much larger one they disagreed about is not.
Which of those a pair is cannot be read off its size, which is exactly why the
tables print the split rather than a verdict.

**The machine is part of the measurement, so it is printed.** The header carries
the CPU, the core count and the memory, plus a calibrator: a fixed scan of two
million plain rows, run before and after every replicate. Its rate is a unit a
figure can be divided by to survive the trip to another machine; the gap between
its before and after says whether the machine changed speed while the replicate
ran; and its own spread across replicates is the smallest difference this
environment can resolve at all.

## What this harness found before anyone ran it

Two results are worth stating up front, because they change what the tables mean.

**On the reads axis, indexing has almost no losing region.** Building a hash
index costs exactly one pass over a field, which is exactly what the scan it
replaces costs, so it pays for itself on the SECOND query at every scale
measured. There is no crossover even at 100% selectivity, where an index still
reads nothing at all.

The worst loss available is one wasted pass per index that cannot serve the
query, which is 1 + k/Q for k useless indexes and Q queries. Measured, on
range queries against hash indexes: 2.00x at one query and one wasted index,
3.00x at one query and two, 1.20x at ten queries and two, and 1.01x at two
hundred. So the hostile case is real but it is a corner, and it evaporates the
moment a workload repeats itself at all.

**The two axes disagree, and the disagreement is the interesting part.** Take one
engine with its best index declared against the same engine with nothing
declared, and widen a range until it keeps the whole collection. The reads
advantage decays from 2.11x to 1.38x, which is exact and reproducible from the
seed. The clock advantage decays faster and runs out first: it starts near 1.8x,
and by the top of the sweep the replicates no longer agree on which of the two is
even faster. So the index ends that sweep saving better than a quarter of the
reads and buying no speed this instrument can find, because a sorted index hands
back positions in value order and the residual filter then walks the rows in
random order while a scan walks them sequentially.

Under mutation the two axes name different winners. At sixteen mutations per
query the incrementally maintained index reads 5.5x less than the same library
with no index, identically on every run from this seed, because splicing into a
sorted array is memory traffic that touches no field at all. On the clock it is
the slower of the two, in every replicate. Neither figure is wrong and neither
one is the answer on its own. A harness reporting one number per workload would
have to pick which to believe, and picking is not neutral. Both are printed, and
where one of them has nothing to say, the table says so instead of filling the
cell.

Where the real losses live is mutation. An engine that invalidates its index and
rebuilds on the next query is two orders of magnitude slower than having no index
at all, at one mutation per query.


## Results

### amortize/r=1

1 equality query on one field at 0.5% selectivity

25,000 rows, 1 queries, 0 mutations.
True selectivity: median 0.480%, from 0.480% to 0.480%. Empty answers: 0.0%.
Best index set: none. Searched 1 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| sift | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| mingo | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| lokijs (no index) | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| lokijs | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| lokijs (adaptive) | 0 | 25,000 | 25,000 | 1.00x | - | key 25,000 |
| rowstore (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes none | 0 | 25,000 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 25,000 | 25,000 | 1.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 761 | +/- 25.8% | 70.3% | 452 | 6.44 |
| sift | 174 | +/- 16.9% | 41.4% | 130 | 6.22 |
| mingo | 174 | +/- 4.4% | 11.5% | 122 | 6.26 |
| lokijs (no index) | 2,680 | +/- 10.5% | 57.7% | 838 | 9.09 |
| lokijs | 2,933 | +/- 12.6% | 23.1% | 1,671 | 9.55 |
| lokijs (adaptive) | 2,798 | +/- 8.5% | 6.4% | 1,469 | 9.35 |
| rowstore | 377 | +/- 12.6% | 24.6% | 202 | 0.98 |
| rowstore (eager) | 522 | +/- 18.6% | 35.5% | 287 | 0.93 |

> The clock orders 23 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `sift` and `mingo` (3 of 7, median 1.00x), `lokijs (no index)` and `lokijs (adaptive)` (2 of 7, median 0.95x), `lokijs` and `lokijs (adaptive)` (5 of 7, median 1.03x), `lokijs (no index)` and `lokijs` (1 of 7, median 0.91x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.70x).

### amortize/r=2

2 equality queries on one field at 0.5% selectivity

25,000 rows, 2 queries, 0 mutations.
True selectivity: median 0.500%, from 0.480% to 0.520%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 50,000 | 50,000 | 2.00x | - | key 50,000 |
| sift | 0 | 50,000 | 50,000 | 2.00x | - | key 50,000 |
| mingo | 0 | 50,000 | 50,000 | 2.00x | - | key 50,000 |
| lokijs (no index) | 0 | 50,000 | 50,000 | 2.00x | - | key 50,000 |
| lokijs | 568,396 | 333 | 568,729 | 22.75x | - | key 568,729 |
| lokijs (adaptive) | 568,396 | 333 | 568,729 | 22.75x | - | key 568,729 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 50,000 | 50,000 | 2.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 1,760 | +/- 29.0% | 68.6% | 1,072 | 6.80 |
| sift | 337 | +/- 9.6% | 13.5% | 284 | 6.82 |
| mingo | 197 | +/- 6.9% | 5.5% | 184 | 6.89 |
| lokijs (no index) | 3,551 | +/- 10.3% | 64.9% | 4,390 | 8.69 |
| lokijs | 28,605 | +/- 32.6% | 35.3% | 6,233 | 19.41 |
| lokijs (adaptive) | 31,517 | +/- 18.1% | 47.4% | 20,806 | 19.17 |
| rowstore | 639 | +/- 17.3% | 23.7% | 524 | 0.80 |
| rowstore (eager) | 1,051 | +/- 12.8% | 24.2% | 1,276 | 0.80 |

> The clock orders 26 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 0.96x), `Array.filter` and `rowstore (eager)` (6 of 7, median 1.67x).

### amortize/r=8

8 equality queries on one field at 0.5% selectivity

25,000 rows, 8 queries, 0 mutations.
True selectivity: median 0.484%, from 0.420% to 0.552%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 200,000 | 200,000 | 8.00x | - | key 200,000 |
| sift | 0 | 200,000 | 200,000 | 8.00x | - | key 200,000 |
| mingo | 0 | 200,000 | 200,000 | 8.00x | - | key 200,000 |
| lokijs (no index) | 0 | 200,000 | 200,000 | 8.00x | - | key 200,000 |
| lokijs | 568,396 | 1,307 | 569,703 | 22.79x | - | key 569,703 |
| lokijs (adaptive) | 568,396 | 1,307 | 569,703 | 22.79x | - | key 569,703 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 200,000 | 200,000 | 8.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 3,903 | +/- 14.1% | 32.9% | 3,752 | 6.69 |
| sift | 399 | +/- 8.4% | 3.9% | 412 | 6.89 |
| mingo | 228 | +/- 2.9% | 2.3% | 232 | 6.19 |
| lokijs (no index) | 5,299 | +/- 8.2% | 12.2% | 5,841 | 8.30 |
| lokijs | 86,214 | +/- 15.5% | 55.3% | 56,404 | 19.22 |
| lokijs (adaptive) | 82,509 | +/- 35.0% | 53.3% | 59,944 | 18.53 |
| rowstore | 2,991 | +/- 7.7% | 30.0% | 2,229 | 0.79 |
| rowstore (eager) | 4,458 | +/- 15.8% | 21.3% | 4,358 | 0.80 |

> The clock orders 25 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (5 of 7, median 1.05x), `lokijs (no index)` and `rowstore (eager)` (6 of 7, median 1.10x), `Array.filter` and `rowstore (eager)` (1 of 7, median 0.85x).

### amortize/r=64

64 equality queries on one field at 0.5% selectivity

25,000 rows, 64 queries, 0 mutations.
True selectivity: median 0.498%, from 0.420% to 0.600%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,600,000 |
| sift | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,600,000 |
| mingo | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,600,000 |
| lokijs (no index) | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,600,000 |
| lokijs | 568,396 | 10,651 | 579,047 | 23.16x | - | key 579,047 |
| lokijs (adaptive) | 568,396 | 10,651 | 579,047 | 23.16x | - | key 579,047 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,600,000 | 1,600,000 | 64.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 4,544 | +/- 4.5% | 3.4% | 4,362 | 6.07 |
| sift | 428 | +/- 2.9% | 1.7% | 414 | 6.08 |
| mingo | 241 | +/- 1.8% | 0.7% | 240 | 6.52 |
| lokijs (no index) | 6,726 | +/- 8.5% | 14.6% | 6,500 | 8.77 |
| lokijs | 209,980 | +/- 8.4% | 8.8% | 201,258 | 19.21 |
| lokijs (adaptive) | 208,299 | +/- 14.1% | 28.8% | 229,390 | 18.84 |
| rowstore | 20,129 | +/- 15.6% | 28.3% | 20,129 | 0.81 |
| rowstore (eager) | 30,397 | +/- 16.7% | 3.9% | 27,669 | 0.80 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 0.98x).

### select-eq/s=1/N

200 equality queries keeping 0.0200% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.020%, from 0.000% to 0.080%. Empty answers: 36.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 109,912 | 7,600 | 117,512 | 23.50x | - | key 117,512 |
| lokijs (adaptive) | 109,912 | 7,600 | 117,512 | 23.50x | - | key 117,512 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 29,911 | +/- 2.3% | 2.7% | 30,135 | 1.22 |
| sift | 2,162 | +/- 1.6% | 1.0% | 2,160 | 1.21 |
| mingo | 1,194 | +/- 1.8% | 0.7% | 1,190 | 1.24 |
| lokijs (no index) | 49,245 | +/- 3.7% | 3.0% | 47,806 | 1.56 |
| lokijs | 742,460 | +/- 7.8% | 20.2% | 594,133 | 4.01 |
| lokijs (adaptive) | 834,490 | +/- 3.4% | 21.1% | 676,247 | 3.86 |
| rowstore | 353,019 | +/- 9.8% | 5.8% | 352,242 | 0.16 |
| rowstore (eager) | 490,948 | +/- 4.6% | 11.2% | 483,627 | 0.14 |

> The clock orders 28 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It orders every pair in it.

### select-eq/s=0.001

200 equality queries keeping 0.100% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.100%, from 0.000% to 0.260%. Empty answers: 1.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 110,038 | 8,408 | 118,446 | 23.69x | - | key 118,446 |
| lokijs (adaptive) | 110,038 | 8,408 | 118,446 | 23.69x | - | key 118,446 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 31,962 | +/- 1.5% | 1.6% | 26,854 | 1.21 |
| sift | 2,201 | +/- 2.2% | 0.9% | 2,131 | 1.19 |
| mingo | 1,191 | +/- 1.5% | 1.0% | 1,189 | 1.26 |
| lokijs (no index) | 45,711 | +/- 2.1% | 2.2% | 44,291 | 1.58 |
| lokijs | 816,743 | +/- 4.1% | 4.1% | 806,991 | 3.67 |
| lokijs (adaptive) | 861,605 | +/- 5.9% | 6.4% | 862,068 | 3.71 |
| rowstore | 397,483 | +/- 1.9% | 3.3% | 386,972 | 0.16 |
| rowstore (eager) | 574,093 | +/- 3.6% | 6.4% | 524,362 | 0.14 |

> The clock orders 28 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It orders every pair in it.

### select-eq/s=0.05

200 equality queries keeping 5.00% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 5.060%, from 4.340% to 5.580%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 81,184 | 57,279 | 138,463 | 27.69x | - | key 138,463 |
| lokijs (adaptive) | 81,184 | 57,279 | 138,463 | 27.69x | - | key 138,463 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 23,556 | +/- 2.4% | 3.1% | 23,476 | 1.20 |
| sift | 2,120 | +/- 2.2% | 1.8% | 2,095 | 1.19 |
| mingo | 1,189 | +/- 1.4% | 1.0% | 1,190 | 1.23 |
| lokijs (no index) | 33,824 | +/- 5.1% | 4.4% | 34,206 | 1.58 |
| lokijs | 215,624 | +/- 13.2% | 5.1% | 217,687 | 2.80 |
| lokijs (adaptive) | 215,083 | +/- 18.2% | 4.3% | 215,827 | 2.81 |
| rowstore | 88,687 | +/- 8.2% | 9.9% | 90,109 | 0.16 |
| rowstore (eager) | 103,984 | +/- 10.1% | 6.7% | 118,718 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (4 of 7, median 1.00x).

### select-eq/s=0.25

200 equality queries keeping 25.0% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 24.940%, from 24.180% to 25.520%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 55,516 | 256,731 | 312,247 | 62.45x | - | key 312,247 |
| lokijs (adaptive) | 55,516 | 256,731 | 312,247 | 62.45x | - | key 312,247 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 23,289 | +/- 5.1% | 3.4% | 23,917 | 1.23 |
| sift | 2,185 | +/- 3.2% | 1.4% | 2,139 | 1.21 |
| mingo | 1,224 | +/- 2.5% | 1.8% | 1,244 | 1.25 |
| lokijs (no index) | 29,549 | +/- 3.0% | 5.5% | 29,549 | 1.56 |
| lokijs | 58,106 | +/- 1.7% | 3.0% | 58,945 | 2.51 |
| lokijs (adaptive) | 57,776 | +/- 5.4% | 3.9% | 58,272 | 2.34 |
| rowstore | 26,961 | +/- 6.4% | 2.2% | 27,130 | 0.18 |
| rowstore (eager) | 28,263 | +/- 6.6% | 1.5% | 29,760 | 0.17 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (4 of 7, median 1.01x).

### select-eq/s=0.5

200 equality queries keeping 50.0% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 49.280%, from 49.280% to 50.720%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 47,644 | 506,548 | 554,192 | 110.84x | - | key 554,192 |
| lokijs (adaptive) | 47,644 | 506,548 | 554,192 | 110.84x | - | key 554,192 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 20,112 | +/- 6.8% | 5.5% | 17,221 | 1.25 |
| sift | 2,220 | +/- 2.6% | 1.1% | 2,158 | 1.22 |
| mingo | 1,263 | +/- 3.2% | 1.4% | 1,049 | 1.23 |
| lokijs (no index) | 24,412 | +/- 7.1% | 2.9% | 21,734 | 1.56 |
| lokijs | 32,189 | +/- 3.6% | 1.0% | 30,056 | 2.10 |
| lokijs (adaptive) | 32,141 | +/- 0.6% | 2.6% | 29,880 | 2.07 |
| rowstore | 14,422 | +/- 2.5% | 1.9% | 13,474 | 0.18 |
| rowstore (eager) | 14,634 | +/- 1.4% | 2.0% | 13,000 | 0.19 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (5 of 7, median 1.00x).

### select-eq/s=1

200 equality queries keeping 100% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 100.000%, from 100.000% to 100.000%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 9,998 | 1,007,000 | 1,016,998 | 203.40x | - | key 1,016,998 |
| lokijs (adaptive) | 9,998 | 1,007,000 | 1,016,998 | 203.40x | - | key 1,016,998 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 22,852 | +/- 3.5% | 10.1% | 19,678 | 1.22 |
| sift | 2,475 | +/- 1.5% | 0.7% | 2,482 | 1.24 |
| mingo | 1,418 | +/- 2.8% | 1.2% | 1,428 | 1.25 |
| lokijs (no index) | 20,304 | +/- 1.2% | 1.8% | 19,895 | 1.58 |
| lokijs | 16,951 | +/- 2.2% | 2.0% | 16,940 | 1.70 |
| lokijs (adaptive) | 17,029 | +/- 0.8% | 1.6% | 17,081 | 1.67 |
| rowstore | 6,409 | +/- 4.4% | 6.2% | 6,055 | 0.19 |
| rowstore (eager) | 6,484 | +/- 4.5% | 3.5% | 6,631 | 0.15 |

> The clock orders 26 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (4 of 7, median 1.00x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.99x).

### select-rng/keep=5%

200 range queries whose range spans 5% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 2.500%, from 1.960% to 2.920%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,513,685, active 50,042 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| mingo | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,513,685, active 50,042 |
| lokijs (no index) | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,513,685, active 50,042 |
| lokijs | 157,564 | 567,719 | 725,283 | 72.53x | - | score 627,525, active 97,758 |
| lokijs (adaptive) | 157,564 | 567,719 | 725,283 | 72.53x | - | score 627,525, active 97,758 |
| rowstore (self-indexing) | 0 | 19,687 | 19,687 | 1.97x | 19,687 | answers from its own snapshot, so its run reads are a lower bound; score 14,429, active 5,258 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,435,306 | 1,435,306 | 143.53x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 14,201 | +/- 2.3% | 1.5% | 11,929 | 1.19 |
| sift | 983 | +/- 2.5% | 2.1% | 830 | 1.23 |
| mingo | 644 | +/- 2.5% | 1.5% | 586 | 1.25 |
| lokijs (no index) | 9,399 | +/- 2.5% | 4.2% | 8,032 | 1.77 |
| lokijs | 17,432 | +/- 4.6% | 3.6% | 13,474 | 3.87 |
| lokijs (adaptive) | 17,642 | +/- 2.6% | 2.1% | 17,091 | 3.61 |
| rowstore | 5,901 | +/- 2.1% | 3.5% | 5,156 | 0.21 |
| rowstore (eager) | 6,111 | +/- 6.7% | 3.6% | 5,867 | 0.17 |

> The clock orders 26 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (1 of 7, median 0.99x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.98x).

### select-rng/keep=20%

200 range queries whose range spans 20% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 9.810%, from 9.160% to 10.420%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,603,688, active 198,880 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| mingo | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,603,688, active 198,880 |
| lokijs (no index) | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,603,688, active 198,880 |
| lokijs | 157,564 | 806,550 | 964,114 | 96.41x | - | score 717,518, active 246,596 |
| lokijs (adaptive) | 157,564 | 806,550 | 964,114 | 96.41x | - | score 717,518, active 246,596 |
| rowstore (self-indexing) | 0 | 17,092 | 17,092 | 1.71x | 17,092 | answers from its own snapshot, so its run reads are a lower bound; score 11,087, active 6,005 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,594,112 | 1,594,112 | 159.41x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 11,440 | +/- 1.0% | 1.7% | 11,379 | 1.23 |
| sift | 980 | +/- 1.4% | 1.6% | 997 | 1.19 |
| mingo | 564 | +/- 2.0% | 0.7% | 563 | 1.25 |
| lokijs (no index) | 7,635 | +/- 1.3% | 2.1% | 7,707 | 1.64 |
| lokijs | 12,288 | +/- 1.0% | 1.9% | 12,424 | 3.61 |
| lokijs (adaptive) | 12,165 | +/- 1.8% | 1.3% | 11,679 | 3.58 |
| rowstore | 4,497 | +/- 2.4% | 3.3% | 3,430 | 0.19 |
| rowstore (eager) | 4,607 | +/- 3.1% | 2.3% | 3,572 | 0.16 |

> The clock orders 26 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 1.00x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.98x).

### select-rng/keep=45%

200 range queries whose range spans 45% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 22.170%, from 21.440% to 22.600%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,723,087, active 446,761 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| mingo | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,723,087, active 446,761 |
| lokijs (no index) | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,723,087, active 446,761 |
| lokijs | 157,564 | 1,173,847 | 1,331,411 | 133.14x | - | score 836,934, active 494,477 |
| lokijs (adaptive) | 157,564 | 1,173,847 | 1,331,411 | 133.14x | - | score 836,934, active 494,477 |
| rowstore (self-indexing) | 0 | 21,756 | 21,756 | 2.18x | 21,756 | answers from its own snapshot, so its run reads are a lower bound; score 14,550, active 7,206 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,788,464 | 1,788,464 | 178.85x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 9,629 | +/- 2.4% | 2.5% | 9,475 | 1.23 |
| sift | 968 | +/- 1.4% | 0.7% | 972 | 1.21 |
| mingo | 480 | +/- 2.0% | 0.7% | 470 | 1.26 |
| lokijs (no index) | 6,185 | +/- 2.7% | 1.6% | 6,276 | 1.68 |
| lokijs | 8,479 | +/- 0.7% | 1.4% | 8,310 | 3.61 |
| lokijs (adaptive) | 8,490 | +/- 1.6% | 2.0% | 8,363 | 3.58 |
| rowstore | 3,257 | +/- 2.6% | 1.4% | 2,910 | 0.20 |
| rowstore (eager) | 3,285 | +/- 2.1% | 1.4% | 3,144 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (1 of 7, median 1.00x).

### select-rng/keep=60%

200 range queries whose range spans 60% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 29.370%, from 28.760% to 29.840%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,797,851, active 595,194 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| mingo | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,797,851, active 595,194 |
| lokijs (no index) | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,797,851, active 595,194 |
| lokijs | 157,564 | 1,397,043 | 1,554,607 | 155.46x | - | score 911,697, active 642,910 |
| lokijs (adaptive) | 157,564 | 1,397,043 | 1,554,607 | 155.46x | - | score 911,697, active 642,910 |
| rowstore (self-indexing) | 0 | 21,826 | 21,826 | 2.18x | 21,826 | answers from its own snapshot, so its run reads are a lower bound; score 13,836, active 7,990 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,842,698 | 1,842,698 | 184.27x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 9,356 | +/- 2.5% | 1.6% | 8,620 | 1.22 |
| sift | 967 | +/- 1.4% | 1.1% | 952 | 1.22 |
| mingo | 443 | +/- 0.7% | 1.0% | 445 | 1.24 |
| lokijs (no index) | 5,794 | +/- 1.7% | 1.2% | 5,794 | 1.64 |
| lokijs | 7,098 | +/- 2.2% | 1.8% | 7,268 | 3.63 |
| lokijs (adaptive) | 7,060 | +/- 1.5% | 1.4% | 7,266 | 3.53 |
| rowstore | 2,922 | +/- 2.4% | 1.7% | 2,917 | 0.21 |
| rowstore (eager) | 2,981 | +/- 2.1% | 1.6% | 2,995 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 1.00x).

### select-rng/keep=100%

200 range queries whose range spans 100% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 49.540%, from 49.540% to 49.540%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| mingo | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| lokijs (no index) | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,000,000, active 1,000,000 |
| lokijs | 157,564 | 2,000,400 | 2,157,964 | 215.80x | - | score 1,110,248, active 1,047,716 |
| lokijs (adaptive) | 157,564 | 2,000,400 | 2,157,964 | 215.80x | - | score 1,110,248, active 1,047,716 |
| rowstore (self-indexing) | 0 | 25,000 | 25,000 | 2.50x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; score 15,000, active 10,000 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,990,800 | 1,990,800 | 199.08x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 8,726 | +/- 1.4% | 1.8% | 8,209 | 1.20 |
| sift | 982 | +/- 1.0% | 1.1% | 930 | 1.21 |
| mingo | 362 | +/- 1.9% | 1.1% | 360 | 1.26 |
| lokijs (no index) | 4,856 | +/- 1.7% | 1.4% | 4,822 | 1.66 |
| lokijs | 5,038 | +/- 2.8% | 1.4% | 5,038 | 3.54 |
| lokijs (adaptive) | 5,010 | +/- 1.3% | 1.8% | 5,049 | 3.60 |
| rowstore | 2,789 | +/- 5.3% | 7.1% | 2,656 | 0.21 |
| rowstore (eager) | 2,961 | +/- 3.3% | 5.3% | 3,034 | 0.16 |

> The clock orders 26 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (5 of 7, median 1.01x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.95x).

### churn/m=0

200 equality queries with 0 insert-and-remove pairs between each

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.100%, from 0.000% to 0.280%. Empty answers: 0.5%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 109,936 | 8,347 | 118,283 | 23.66x | - | key 118,283 |
| lokijs (adaptive) | 109,936 | 8,347 | 118,283 | 23.66x | - | key 118,283 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 20,225 | +/- 2.2% | 3.1% | 20,404 | 1.21 |
| sift | 2,124 | +/- 1.0% | 0.8% | 2,139 | 1.20 |
| mingo | 1,159 | +/- 1.9% | 0.8% | 1,168 | 1.25 |
| lokijs (no index) | 18,159 | +/- 3.5% | 1.4% | 18,534 | 1.62 |
| lokijs | 617,600 | +/- 1.2% | 2.9% | 631,746 | 4.14 |
| lokijs (adaptive) | 643,517 | +/- 2.7% | 2.3% | 622,649 | 4.11 |
| rowstore | 363,306 | +/- 2.8% | 2.8% | 357,569 | 0.16 |
| rowstore (eager) | 530,269 | +/- 14.0% | 9.0% | 530,269 | 0.14 |

> The clock orders 28 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It orders every pair in it.

### churn/m=1

200 equality queries with 1 insert-and-remove pairs between each

5,000 rows, 200 queries, 400 mutations.
True selectivity: median 0.100%, from 0.000% to 0.240%. Empty answers: 1.0%.
Best index set: key:hash. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,000,000 |
| lokijs | 109,936 | 21,888,952 | 21,998,888 | 4073.87x | - | key 21,998,888 |
| lokijs (adaptive) | 109,936 | 19,173 | 129,109 | 23.91x | - | key 129,109 |
| rowstore (self-indexing) | 0 | 10,398 | 10,398 | 1.93x | 10,398 | answers from its own snapshot, so its run reads are a lower bound; key 10,398 |
| rowstore (eager) (self-indexing) | 0 | 5,400 | 5,400 | 1.00x | 5,400 | answers from its own snapshot, so its run reads are a lower bound; key 5,400 |
| reference, indexes key:hash | 5,000 | 400 | 5,400 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 185.19x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 19,743 | +/- 4.1% | 8.8% | 17,457 | 1.25 |
| sift | 2,113 | +/- 0.9% | 1.2% | 2,098 | 1.23 |
| mingo | 1,151 | +/- 2.6% | 1.3% | 1,165 | 1.24 |
| lokijs (no index) | 17,293 | +/- 1.5% | 2.1% | 16,869 | 1.71 |
| lokijs | 391 | +/- 0.3% | 0.5% | 391 | 4.34 |
| lokijs (adaptive) | 87,665 | +/- 4.2% | 4.8% | 41,642 | 4.59 |
| rowstore | 267,394 | +/- 5.9% | 7.8% | 195,870 | 0.19 |
| rowstore (eager) | 361,718 | +/- 14.5% | 21.3% | 280,948 | 0.18 |

> The clock orders 28 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It orders every pair in it.

### churn/m=4

200 equality queries with 4 insert-and-remove pairs between each

5,000 rows, 200 queries, 1,600 mutations.
True selectivity: median 0.080%, from 0.000% to 0.240%. Empty answers: 0.5%.
Best index set: key:hash. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,000,000 |
| lokijs | 109,936 | 21,883,541 | 21,993,477 | 3332.34x | - | key 21,993,477 |
| lokijs (adaptive) | 109,936 | 51,545 | 161,481 | 24.47x | - | key 161,481 |
| rowstore (self-indexing) | 0 | 11,592 | 11,592 | 1.76x | 11,592 | answers from its own snapshot, so its run reads are a lower bound; key 11,592 |
| rowstore (eager) (self-indexing) | 0 | 6,600 | 6,600 | 1.00x | 6,600 | answers from its own snapshot, so its run reads are a lower bound; key 6,600 |
| reference, indexes key:hash | 5,000 | 1,600 | 6,600 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 151.52x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 19,474 | +/- 3.9% | 3.0% | 18,344 | 1.26 |
| sift | 2,112 | +/- 1.5% | 1.2% | 2,117 | 1.23 |
| mingo | 1,158 | +/- 2.1% | 2.1% | 1,135 | 1.24 |
| lokijs (no index) | 16,223 | +/- 2.5% | 1.8% | 16,857 | 1.62 |
| lokijs | 391 | +/- 0.8% | 1.1% | 388 | 4.20 |
| lokijs (adaptive) | 26,740 | +/- 1.7% | 2.7% | 25,755 | 4.19 |
| rowstore | 257,248 | +/- 10.4% | 8.9% | 216,401 | 0.17 |
| rowstore (eager) | 329,965 | +/- 12.6% | 10.0% | 255,932 | 0.16 |

> The clock orders 28 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It orders every pair in it.

### churn/m=16

200 equality queries with 16 insert-and-remove pairs between each

5,000 rows, 200 queries, 6,400 mutations.
True selectivity: median 0.100%, from 0.000% to 0.340%. Empty answers: 1.5%.
Best index set: key:hash. Searched 4 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,000,000 |
| lokijs | 109,936 | 21,871,091 | 21,981,027 | 1928.16x | - | key 21,981,027 |
| lokijs (adaptive) | 109,936 | 181,452 | 291,388 | 25.56x | - | key 291,388 |
| rowstore (self-indexing) | 0 | 16,368 | 16,368 | 1.44x | 16,368 | answers from its own snapshot, so its run reads are a lower bound; key 16,368 |
| rowstore (eager) (self-indexing) | 0 | 11,400 | 11,400 | 1.00x | 11,400 | answers from its own snapshot, so its run reads are a lower bound; key 11,400 |
| reference, indexes key:hash | 5,000 | 6,400 | 11,400 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 87.72x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 18,769 | +/- 4.7% | 7.3% | 18,769 | 1.25 |
| sift | 2,104 | +/- 1.1% | 1.4% | 2,093 | 1.20 |
| mingo | 1,146 | +/- 1.9% | 0.9% | 1,150 | 1.23 |
| lokijs (no index) | 12,978 | +/- 2.6% | 1.1% | 12,823 | 1.59 |
| lokijs | 387 | +/- 0.6% | 0.3% | 380 | 4.43 |
| lokijs (adaptive) | 6,944 | +/- 1.8% | 1.8% | 6,903 | 4.61 |
| rowstore | 138,237 | +/- 4.6% | 6.3% | 134,775 | 0.17 |
| rowstore (eager) | 158,249 | +/- 23.9% | 7.2% | 154,664 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `rowstore` and `rowstore (eager)` (1 of 7, median 0.88x).

### hash-trap

20 equality queries then 200 range queries on one field: the case where the wrong index kind costs exactly 2.00x

5,000 rows, 220 queries, 0 mutations.
True selectivity: median 4.940%, from 0.000% to 5.340%. Empty answers: 5.0%.
Best index set: score:sorted. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,645,483 |
| sift | 0 | 2,100,000 | 2,100,000 | 420.00x | - | score 2,100,000 |
| mingo | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,645,483 |
| lokijs (no index) | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,645,483 |
| lokijs | 109,848 | 550,213 | 660,061 | 132.01x | - | score 660,061 |
| lokijs (adaptive) | 109,848 | 550,213 | 660,061 | 132.01x | - | score 660,061 |
| rowstore (self-indexing) | 0 | 20,643 | 20,643 | 4.13x | 20,643 | score 20,643 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | score 10,000 |
| reference, indexes score:sorted | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,387,743 | 1,387,743 | 277.55x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 15,814 | +/- 3.0% | 2.7% | 15,612 | 1.24 |
| sift | 1,430 | +/- 2.0% | 1.3% | 1,437 | 1.21 |
| mingo | 685 | +/- 1.4% | 1.0% | 446 | 1.26 |
| lokijs (no index) | 10,109 | +/- 1.7% | 1.4% | 10,053 | 1.65 |
| lokijs | 20,061 | +/- 2.1% | 2.7% | 19,435 | 3.19 |
| lokijs (adaptive) | 20,168 | +/- 1.5% | 1.7% | 19,513 | 2.98 |
| rowstore | 7,506 | +/- 2.2% | 4.8% | 6,540 | 0.19 |
| rowstore (eager) | 7,724 | +/- 2.0% | 1.0% | 5,983 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 0.99x).

### skew

400 queries alternating the hottest value of a Zipf field with a rare one

5,000 rows, 400 queries, 0 mutations.
True selectivity: median 9.560%, from 0.040% to 19.080%. Empty answers: 0.0%.
Best index set: topic:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,000,000 |
| sift | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,000,000 |
| mingo | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,000,000 |
| lokijs (no index) | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,000,000 |
| lokijs | 93,982 | 206,000 | 299,982 | 60.00x | - | topic 299,982 |
| lokijs (adaptive) | 93,982 | 206,000 | 299,982 | 60.00x | - | topic 299,982 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; topic 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; topic 5,000 |
| reference, indexes topic:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 2,000,000 | 2,000,000 | 400.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 16,210 | +/- 2.8% | 4.1% | 15,858 | 1.29 |
| sift | 2,104 | +/- 0.9% | 0.6% | 2,104 | 1.20 |
| mingo | 1,164 | +/- 3.2% | 0.7% | 1,160 | 1.25 |
| lokijs (no index) | 14,079 | +/- 3.0% | 1.8% | 14,096 | 1.79 |
| lokijs | 74,386 | +/- 3.4% | 2.5% | 74,794 | 3.73 |
| lokijs (adaptive) | 74,343 | +/- 2.0% | 3.6% | 72,594 | 3.67 |
| rowstore | 67,793 | +/- 3.8% | 4.4% | 66,659 | 0.20 |
| rowstore (eager) | 72,560 | +/- 3.8% | 4.0% | 71,844 | 0.19 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (4 of 7, median 1.01x).

### in-values

200 membership queries over three values each, which only a hash index serves

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 2.990%, from 1.980% to 3.660%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,000,000 |
| lokijs | 100,260 | 22,477 | 122,737 | 24.55x | - | key 122,737 |
| lokijs (adaptive) | 100,260 | 22,477 | 122,737 | 24.55x | - | key 122,737 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 14,374 | +/- 2.7% | 4.8% | 12,809 | 1.22 |
| sift | 1,337 | +/- 1.7% | 1.1% | 1,311 | 1.20 |
| mingo | 735 | +/- 2.1% | 1.2% | 713 | 1.26 |
| lokijs (no index) | 10,340 | +/- 2.1% | 4.8% | 8,808 | 1.61 |
| lokijs | 50,854 | +/- 6.8% | 11.7% | 37,448 | 3.70 |
| lokijs (adaptive) | 51,812 | +/- 7.3% | 14.7% | 38,194 | 3.66 |
| rowstore | 78,668 | +/- 8.1% | 17.2% | 42,780 | 0.17 |
| rowstore (eager) | 92,807 | +/- 7.3% | 10.7% | 52,182 | 0.16 |

> The clock orders 27 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 0.99x).

### mixed-types

a column of numbers, strings and booleans queried with `in`: does an index change the answer?

5,000 rows, 50 queries, 0 mutations.
True selectivity: median 20.000%, from 20.000% to 20.000%. Empty answers: 0.0%.
Best index set: v:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 250,000 | 250,000 | 50.00x | - | v 250,000 |
| sift | 0 | 250,000 | 250,000 | 50.00x | - | v 250,000 |
| mingo | 0 | 250,000 | 250,000 | 50.00x | - | v 250,000 |
| lokijs (no index) | 0 | 250,000 | 250,000 | 50.00x | - | v 250,000 |
| lokijs | - | - | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| lokijs (adaptive) | - | - | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | v 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | v 5,000 |
| reference, indexes v:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 250,000 | 250,000 | 50.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 19,885 | +/- 4.7% | 3.7% | 11,140 | 1.29 |
| sift | 2,095 | +/- 2.2% | 1.5% | 1,997 | 1.25 |
| mingo | 764 | +/- 1.6% | 0.9% | 727 | 1.27 |
| lokijs (no index) | 16,940 | +/- 4.8% | 2.1% | 8,540 | 1.86 |
| lokijs | - | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| lokijs (adaptive) | - | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| rowstore | 21,467 | +/- 10.3% | 6.3% | 8,970 | 0.17 |
| rowstore (eager) | 24,797 | +/- 9.2% | 11.1% | 11,561 | 0.17 |

> The clock orders 14 of 15 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 15 pairs is expected to order 0.2 of them by luck alone). It does not order `rowstore` and `rowstore (eager)` (1 of 7, median 0.92x).

> lokijs answered a query differently from the oracle: v in [2]: wrong-set, extra 2,7,12,17,22

> lokijs (adaptive) answered a query differently from the oracle: v in [2]: wrong-set, extra 2,7,12,17,22

### conjunct

300 three-predicate queries where the whole difference is which predicate is tested first

5,000 rows, 300 queries, 0 mutations.
True selectivity: median 0.000%, from 0.000% to 0.040%. Empty answers: 83.3%.
Best index set: status:hash. Searched 7 of 22 candidate sets (the rest could not win on build cost alone), cap 2 of 6 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,500,000, region 741,300, status 61,446 |
| sift | 0 | 4,500,000 | 4,500,000 | 671.84x | - | status 1,500,000, region 1,500,000, active 1,500,000 |
| mingo | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,500,000, region 741,300, status 61,446 |
| lokijs (no index) | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,500,000, region 741,300, status 61,446 |
| lokijs | 109,916 | 2,302,746 | 2,412,662 | 360.21x | - | active 1,500,000, region 741,300, status 171,362 |
| lokijs (adaptive) | 109,916 | 2,302,746 | 2,412,662 | 360.21x | - | active 1,500,000, region 741,300, status 171,362 |
| rowstore (self-indexing) | 0 | 22,655 | 22,655 | 3.38x | 22,655 | active 10,000, region 7,471, status 5,184 |
| rowstore (eager) (self-indexing) | 0 | 15,000 | 15,000 | 2.24x | 15,000 | status 5,000, region 5,000, active 5,000 |
| reference, indexes status:hash | 5,000 | 1,698 | 6,698 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,501,698 | 1,501,698 | 224.20x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | run to run | IQR within a run | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array.filter | 10,807 | +/- 6.9% | 11.2% | 11,545 | 1.72 |
| sift | 845 | +/- 1.8% | 0.5% | 846 | 1.68 |
| mingo | 812 | +/- 1.9% | 1.5% | 802 | 1.71 |
| lokijs (no index) | 9,590 | +/- 1.5% | 3.9% | 9,942 | 2.40 |
| lokijs | 9,697 | +/- 1.7% | 2.7% | 10,027 | 5.08 |
| lokijs (adaptive) | 9,735 | +/- 1.8% | 2.3% | 10,041 | 4.97 |
| rowstore | 70,950 | +/- 6.7% | 4.4% | 65,631 | 0.23 |
| rowstore (eager) | 76,118 | +/- 7.7% | 9.1% | 70,324 | 0.22 |

> The clock orders 24 of 28 pairs here, unanimously across 7 independent processes (1.6% per pair under the null, so a table of 28 pairs is expected to order 0.4 of them by luck alone). It does not order `lokijs` and `lokijs (adaptive)` (3 of 7, median 1.00x), `lokijs (no index)` and `lokijs (adaptive)` (2 of 7, median 0.99x), `lokijs (no index)` and `lokijs` (1 of 7, median 0.99x), `rowstore` and `rowstore (eager)` (1 of 7, median 0.92x).
