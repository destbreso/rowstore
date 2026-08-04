# rowstore, measured by rowtoll

Node v22.14.0 on darwin/arm64, scale 0.25, 5 trials per subject, seed 12345, index-search cap 2.




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
the plain copy, arms interleaved, reported as a median with its interquartile
range. There is no warmup constant, because a declared warmup is a claim about
how long an engine takes to settle and a claim needs an instrument: the first
trial is printed next to the median instead.

**The printed IQR understates the uncertainty, by a measured amount.** It is the
spread WITHIN one measurement. Repeating the whole seven-trial measurement eight
times on the machine that produced this report moved the median by 20.9% for
Array.filter and 3.7% for sift, against printed interquartile ranges of 4.6%
and 1.9%. So the interval covers run-to-run movement in neither case, and a
throughput difference under roughly 1.25x is not a result. The reads axis has no
such problem: it is exactly reproducible, byte for byte, from the seed.

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
seed. The clock advantage decays faster and lands on nothing: about 1.8x at the
narrow end and 1.00x at the wide one, across runs of this panel. At the top of that
sweep the index still saves a quarter of the reads and buys no speed at all,
because a sorted index hands back positions in value order and the residual
filter then walks the rows in random order while a scan walks them sequentially.

Under mutation the disagreement changes sign outright. At sixteen mutations per
query the incrementally maintained index reads 5.5x less than the same library
with no index, and answers fewer queries per second than it, by 1.4x to 1.6x
depending on the run, because splicing into a sorted array is memory traffic that
touches no field at all. A harness that reported one number per workload would
have to pick which of those to believe, and picking is not neutral. Both are
printed.

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 1,147 | 876 | 1,966 | 7.39 |
| sift | 367 | 70 | 390 | 7.51 |
| mingo | 160 | 34 | 137 | 6.67 |
| lokijs (no index) | 2,132 | 392 | 1,979 | 9.70 |
| lokijs | 2,234 | 252 | 2,092 | 10.09 |
| lokijs (adaptive) | 2,744 | 769 | 2,936 | 10.46 |
| rowstore | 921 | 483 | 442 | 1.28 |
| rowstore (eager) | 631 | 78 | 680 | 1.20 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 1,689 | 890 | 1,085 | 6.43 |
| sift | 391 | 26 | 358 | 7.34 |
| mingo | 187 | 23 | 187 | 7.25 |
| lokijs (no index) | 2,289 | 935 | 1,538 | 9.30 |
| lokijs | 37,066 | 11,132 | 28,538 | 22.81 |
| lokijs (adaptive) | 42,667 | 6,524 | 8,479 | 22.24 |
| rowstore | 550 | 239 | 365 | 1.28 |
| rowstore (eager) | 1,248 | 251 | 621 | 1.22 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 2,281 | 551 | 1,739 | 7.67 |
| sift | 340 | 7 | 341 | 7.43 |
| mingo | 225 | 10 | 225 | 6.93 |
| lokijs (no index) | 3,069 | 435 | 2,660 | 9.48 |
| lokijs | 117,864 | 48,797 | 117,864 | 22.06 |
| lokijs (adaptive) | 123,000 | 43,166 | 105,901 | 22.27 |
| rowstore | 2,029 | 916 | 3,658 | 1.33 |
| rowstore (eager) | 4,861 | 1,333 | 6,129 | 1.17 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 3,151 | 520 | 3,441 | 6.45 |
| sift | 383 | 1 | 384 | 7.69 |
| mingo | 234 | 6 | 234 | 7.58 |
| lokijs (no index) | 3,656 | 20 | 3,671 | 10.67 |
| lokijs | 181,840 | 37,210 | 199,351 | 22.34 |
| lokijs (adaptive) | 166,342 | 46,418 | 160,034 | 22.05 |
| rowstore | 20,744 | 7,704 | 24,606 | 1.04 |
| rowstore (eager) | 35,030 | 1,526 | 36,572 | 1.10 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 19,120 | 988 | 19,276 | 1.46 |
| sift | 1,899 | 169 | 1,739 | 1.39 |
| mingo | 1,173 | 24 | 1,159 | 1.40 |
| lokijs (no index) | 23,142 | 165 | 23,114 | 1.92 |
| lokijs | 738,459 | 55,242 | 652,705 | 4.52 |
| lokijs (adaptive) | 703,091 | 82,957 | 587,300 | 4.64 |
| rowstore | 356,347 | 43,032 | 317,167 | 0.23 |
| rowstore (eager) | 481,251 | 76,776 | 481,251 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 21,627 | 435 | 18,806 | 1.28 |
| sift | 1,909 | 10 | 1,906 | 1.22 |
| mingo | 1,184 | 15 | 1,179 | 1.28 |
| lokijs (no index) | 27,066 | 890 | 31,602 | 1.80 |
| lokijs | 810,127 | 45,688 | 733,719 | 4.22 |
| lokijs (adaptive) | 809,035 | 87,962 | 700,933 | 4.35 |
| rowstore | 388,318 | 26,890 | 371,517 | 0.18 |
| rowstore (eager) | 579,359 | 22,766 | 549,198 | 0.18 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,375 | 915 | 13,343 | 1.29 |
| sift | 2,082 | 12 | 2,103 | 1.27 |
| mingo | 1,184 | 8 | 1,195 | 1.36 |
| lokijs (no index) | 15,827 | 708 | 15,401 | 1.75 |
| lokijs | 165,574 | 8,644 | 169,300 | 3.17 |
| lokijs (adaptive) | 160,133 | 16,403 | 110,193 | 3.27 |
| rowstore | 87,343 | 4,614 | 87,343 | 0.19 |
| rowstore (eager) | 101,881 | 4,970 | 113,526 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 15,760 | 789 | 14,671 | 1.38 |
| sift | 2,145 | 21 | 2,126 | 1.29 |
| mingo | 1,203 | 10 | 1,211 | 1.29 |
| lokijs (no index) | 17,347 | 1,494 | 17,347 | 2.16 |
| lokijs | 39,541 | 1,148 | 40,686 | 2.67 |
| lokijs (adaptive) | 40,596 | 672 | 41,390 | 2.66 |
| rowstore | 27,340 | 1,238 | 27,340 | 0.21 |
| rowstore (eager) | 27,967 | 97 | 27,967 | 0.21 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 12,040 | 1,064 | 13,090 | 1.37 |
| sift | 2,143 | 69 | 2,170 | 1.35 |
| mingo | 1,188 | 432 | 1,233 | 1.30 |
| lokijs (no index) | 12,282 | 879 | 12,158 | 1.99 |
| lokijs | 20,885 | 1,264 | 21,568 | 2.80 |
| lokijs (adaptive) | 21,384 | 2,612 | 21,752 | 2.78 |
| rowstore | 14,193 | 475 | 14,744 | 0.23 |
| rowstore (eager) | 13,161 | 2,225 | 14,841 | 0.22 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 14,559 | 224 | 14,350 | 1.30 |
| sift | 2,338 | 18 | 2,299 | 1.30 |
| mingo | 1,361 | 11 | 1,367 | 1.30 |
| lokijs (no index) | 13,278 | 329 | 13,278 | 1.89 |
| lokijs | 11,308 | 469 | 11,512 | 1.86 |
| lokijs (adaptive) | 11,279 | 296 | 11,501 | 1.96 |
| rowstore | 6,397 | 136 | 6,508 | 0.24 |
| rowstore (eager) | 6,636 | 328 | 6,745 | 0.18 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,374 | 148 | 13,374 | 1.26 |
| sift | 892 | 13 | 882 | 1.24 |
| mingo | 631 | 11 | 621 | 1.31 |
| lokijs (no index) | 9,332 | 133 | 9,175 | 1.95 |
| lokijs | 17,235 | 546 | 17,846 | 3.85 |
| lokijs (adaptive) | 17,558 | 541 | 17,064 | 3.81 |
| rowstore | 5,871 | 25 | 5,811 | 0.22 |
| rowstore (eager) | 6,039 | 198 | 6,216 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 10,385 | 252 | 10,602 | 1.26 |
| sift | 904 | 10 | 898 | 1.27 |
| mingo | 571 | 5 | 572 | 1.33 |
| lokijs (no index) | 7,345 | 380 | 7,189 | 1.94 |
| lokijs | 12,006 | 218 | 11,215 | 3.80 |
| lokijs (adaptive) | 11,912 | 509 | 12,254 | 3.68 |
| rowstore | 4,379 | 1,267 | 4,395 | 0.25 |
| rowstore (eager) | 4,431 | 481 | 4,685 | 0.25 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 8,761 | 1,061 | 9,588 | 1.30 |
| sift | 909 | 9 | 909 | 1.29 |
| mingo | 479 | 6 | 474 | 1.32 |
| lokijs (no index) | 6,065 | 303 | 5,695 | 1.88 |
| lokijs | 8,320 | 159 | 8,190 | 3.87 |
| lokijs (adaptive) | 8,009 | 297 | 7,935 | 3.93 |
| rowstore | 3,038 | 207 | 3,038 | 0.23 |
| rowstore (eager) | 3,228 | 98 | 3,193 | 0.30 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 9,015 | 710 | 9,231 | 1.24 |
| sift | 912 | 3 | 912 | 1.27 |
| mingo | 440 | 7 | 429 | 1.30 |
| lokijs (no index) | 5,658 | 131 | 5,658 | 1.86 |
| lokijs | 6,806 | 124 | 6,689 | 3.80 |
| lokijs (adaptive) | 6,899 | 97 | 6,805 | 3.74 |
| rowstore | 2,812 | 31 | 2,812 | 0.23 |
| rowstore (eager) | 2,863 | 117 | 3,012 | 0.18 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 8,363 | 93 | 8,509 | 1.26 |
| sift | 907 | 11 | 925 | 1.34 |
| mingo | 362 | 4 | 358 | 1.31 |
| lokijs (no index) | 4,748 | 81 | 4,639 | 1.86 |
| lokijs | 4,831 | 77 | 4,831 | 3.74 |
| lokijs (adaptive) | 4,855 | 7 | 4,855 | 3.89 |
| rowstore | 2,752 | 12 | 2,759 | 0.21 |
| rowstore (eager) | 2,919 | 123 | 3,025 | 0.18 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,802 | 988 | 13,643 | 1.25 |
| sift | 2,046 | 11 | 2,036 | 1.26 |
| mingo | 1,158 | 17 | 1,148 | 1.29 |
| lokijs (no index) | 17,182 | 376 | 15,952 | 1.73 |
| lokijs | 574,713 | 5,543 | 574,713 | 4.46 |
| lokijs (adaptive) | 600,827 | 23,527 | 580,410 | 4.45 |
| rowstore | 361,446 | 28,806 | 362,510 | 0.20 |
| rowstore (eager) | 518,807 | 60,585 | 530,211 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,707 | 198 | 18,619 | 1.30 |
| sift | 2,036 | 37 | 2,039 | 1.25 |
| mingo | 1,145 | 12 | 1,145 | 1.59 |
| lokijs (no index) | 16,303 | 552 | 15,233 | 1.80 |
| lokijs | 388 | 4 | 388 | 4.98 |
| lokijs (adaptive) | 88,497 | 4,490 | 88,497 | 4.49 |
| rowstore | 259,839 | 128,962 | 318,598 | 0.22 |
| rowstore (eager) | 370,542 | 52,941 | 405,235 | 0.22 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,572 | 978 | 18,037 | 1.34 |
| sift | 2,039 | 11 | 2,028 | 1.30 |
| mingo | 1,158 | 12 | 1,158 | 1.28 |
| lokijs (no index) | 15,337 | 639 | 15,940 | 1.90 |
| lokijs | 389 | 9 | 380 | 4.51 |
| lokijs (adaptive) | 27,021 | 381 | 27,030 | 4.73 |
| rowstore | 252,246 | 25,642 | 253,098 | 0.22 |
| rowstore (eager) | 334,472 | 40,814 | 298,026 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,689 | 456 | 16,047 | 1.36 |
| sift | 2,012 | 15 | 2,002 | 1.24 |
| mingo | 1,160 | 7 | 1,160 | 1.27 |
| lokijs (no index) | 12,509 | 199 | 12,432 | 1.76 |
| lokijs | 383 | 2 | 382 | 4.59 |
| lokijs (adaptive) | 7,029 | 47 | 6,988 | 5.13 |
| rowstore | 139,235 | 10,117 | 144,522 | 0.22 |
| rowstore (eager) | 152,745 | 41,653 | 152,745 | 0.19 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 14,956 | 930 | 14,466 | 1.61 |
| sift | 1,382 | 12 | 1,382 | 1.29 |
| mingo | 680 | 6 | 680 | 1.29 |
| lokijs (no index) | 9,877 | 739 | 9,492 | 2.01 |
| lokijs | 19,173 | 748 | 19,529 | 3.28 |
| lokijs (adaptive) | 19,454 | 258 | 19,454 | 3.56 |
| rowstore | 7,214 | 235 | 7,214 | 0.26 |
| rowstore (eager) | 7,495 | 460 | 8,014 | 0.21 |

### skew

400 queries alternating the hottest and the coldest value of a Zipf field

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,841 | 536 | 3,080 | 1.34 |
| sift | 1,949 | 277 | 845 | 1.30 |
| mingo | 1,129 | 25 | 1,141 | 1.45 |
| lokijs (no index) | 13,199 | 830 | 12,857 | 2.10 |
| lokijs | 64,735 | 4,043 | 62,010 | 4.24 |
| lokijs (adaptive) | 64,551 | 2,384 | 72,925 | 4.03 |
| rowstore | 64,644 | 1,081 | 64,176 | 0.27 |
| rowstore (eager) | 69,755 | 3,582 | 69,227 | 0.23 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,487 | 583 | 13,398 | 1.42 |
| sift | 1,334 | 17 | 1,334 | 1.29 |
| mingo | 704 | 107 | 548 | 1.31 |
| lokijs (no index) | 9,623 | 331 | 9,874 | 2.09 |
| lokijs | 46,820 | 1,939 | 46,820 | 4.35 |
| lokijs (adaptive) | 54,420 | 2,960 | 51,754 | 4.33 |
| rowstore | 70,975 | 5,914 | 69,099 | 0.24 |
| rowstore (eager) | 99,161 | 18,937 | 99,161 | 0.24 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 17,494 | 2,186 | 19,862 | 1.34 |
| sift | 2,112 | 20 | 2,119 | 1.32 |
| mingo | 745 | 25 | 745 | 1.35 |
| lokijs (no index) | 15,116 | 495 | 14,647 | 1.95 |
| lokijs | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| lokijs (adaptive) | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| rowstore | 21,588 | 3,351 | 19,176 | 0.23 |
| rowstore (eager) | 22,366 | 5,177 | 21,431 | 0.24 |

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

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 9,855 | 354 | 9,549 | 1.84 |
| sift | 842 | 24 | 835 | 1.77 |
| mingo | 768 | 50 | 808 | 1.80 |
| lokijs (no index) | 9,312 | 243 | 9,781 | 2.71 |
| lokijs | 9,474 | 362 | 9,763 | 5.55 |
| lokijs (adaptive) | 9,399 | 171 | 9,614 | 5.26 |
| rowstore | 66,456 | 5,655 | 69,026 | 0.27 |
| rowstore (eager) | 71,015 | 2,638 | 80,605 | 0.27 |
