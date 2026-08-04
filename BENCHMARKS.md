# rowtoll

Node v22.14.0 on darwin/arm64, scale 0.25, 5 trials per subject, seed 12345, index-search cap 2.




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

**The two axes disagree in sign, and the disagreement is the interesting part.**
On ordered access past roughly 45% selectivity, reads say the index is 2.5x
better while the clock says it is 0.86x worse, because a sorted index hands back
positions in value order and the residual filter then walks the rows in random
order while a scan walks them sequentially. A harness that reported one number
per workload would have to pick which of those to believe, and picking is not
neutral. Both are printed.

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
| Array.filter | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| sift | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| mingo | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| lokijs (no index) | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| lokijs | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| lokijs (adaptive) | 0 | 25,000 | 25,000 | 1.00x | - | key 75,000 |
| rowstore (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes none | 0 | 25,000 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 25,000 | 25,000 | 1.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 895 | 117 | 817 | 8.03 |
| sift | 312 | 58 | 217 | 6.67 |
| mingo | 173 | 11 | 173 | 8.20 |
| lokijs (no index) | 1,939 | 961 | 1,818 | 9.52 |
| lokijs | 2,152 | 296 | 2,218 | 10.47 |
| lokijs (adaptive) | 2,199 | 449 | 1,758 | 9.73 |
| rowstore | 405 | 74 | 405 | 1.30 |
| rowstore (eager) | 612 | 94 | 612 | 1.31 |

### amortize/r=2

2 equality queries on one field at 0.5% selectivity

25,000 rows, 2 queries, 0 mutations.
True selectivity: median 0.500%, from 0.480% to 0.520%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 50,000 | 50,000 | 2.00x | - | key 100,000 |
| sift | 0 | 50,000 | 50,000 | 2.00x | - | key 100,000 |
| mingo | 0 | 50,000 | 50,000 | 2.00x | - | key 100,000 |
| lokijs (no index) | 0 | 50,000 | 50,000 | 2.00x | - | key 100,000 |
| lokijs | 568,396 | 333 | 568,729 | 22.75x | - | key 656 |
| lokijs (adaptive) | 568,396 | 333 | 568,729 | 22.75x | - | key 656 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 50,000 | 50,000 | 2.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 1,436 | 792 | 1,122 | 7.66 |
| sift | 349 | 62 | 349 | 7.42 |
| mingo | 180 | 16 | 175 | 6.52 |
| lokijs (no index) | 2,451 | 1,104 | 1,547 | 10.04 |
| lokijs | 34,335 | 13,303 | 29,250 | 21.82 |
| lokijs (adaptive) | 35,477 | 23,207 | 10,044 | 21.81 |
| rowstore | 443 | 146 | 507 | 1.28 |
| rowstore (eager) | 1,268 | 124 | 1,373 | 1.19 |

### amortize/r=8

8 equality queries on one field at 0.5% selectivity

25,000 rows, 8 queries, 0 mutations.
True selectivity: median 0.484%, from 0.420% to 0.552%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 200,000 | 200,000 | 8.00x | - | key 250,000 |
| sift | 0 | 200,000 | 200,000 | 8.00x | - | key 250,000 |
| mingo | 0 | 200,000 | 200,000 | 8.00x | - | key 250,000 |
| lokijs (no index) | 0 | 200,000 | 200,000 | 8.00x | - | key 250,000 |
| lokijs | 568,396 | 1,307 | 569,703 | 22.79x | - | key 1,626 |
| lokijs (adaptive) | 568,396 | 1,307 | 569,703 | 22.79x | - | key 1,626 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 200,000 | 200,000 | 8.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 2,144 | 744 | 1,591 | 6.59 |
| sift | 397 | 5 | 397 | 7.68 |
| mingo | 203 | 20 | 202 | 7.46 |
| lokijs (no index) | 3,277 | 898 | 3,277 | 10.78 |
| lokijs | 69,541 | 13,717 | 61,166 | 22.92 |
| lokijs (adaptive) | 115,246 | 46,059 | 82,973 | 21.68 |
| rowstore | 3,014 | 1,278 | 1,948 | 1.18 |
| rowstore (eager) | 5,247 | 2,616 | 2,616 | 1.11 |

### amortize/r=64

64 equality queries on one field at 0.5% selectivity

25,000 rows, 64 queries, 0 mutations.
True selectivity: median 0.498%, from 0.420% to 0.600%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,650,000 |
| sift | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,650,000 |
| mingo | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,650,000 |
| lokijs (no index) | 0 | 1,600,000 | 1,600,000 | 64.00x | - | key 1,650,000 |
| lokijs | 568,396 | 10,651 | 579,047 | 23.16x | - | key 10,971 |
| lokijs (adaptive) | 568,396 | 10,651 | 579,047 | 23.16x | - | key 10,971 |
| rowstore (self-indexing) | 0 | 50,000 | 50,000 | 2.00x | 50,000 | answers from its own snapshot, so its run reads are a lower bound; key 50,000 |
| rowstore (eager) (self-indexing) | 0 | 25,000 | 25,000 | 1.00x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; key 25,000 |
| reference, indexes key:hash | 25,000 | 0 | 25,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,600,000 | 1,600,000 | 64.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 3,124 | 433 | 3,165 | 7.52 |
| sift | 420 | 1 | 421 | 6.65 |
| mingo | 235 | 5 | 234 | 6.59 |
| lokijs (no index) | 3,407 | 359 | 3,407 | 10.30 |
| lokijs | 129,807 | 25,989 | 113,635 | 22.62 |
| lokijs (adaptive) | 144,537 | 20,524 | 171,850 | 22.18 |
| rowstore | 15,552 | 9,812 | 13,204 | 1.18 |
| rowstore (eager) | 22,225 | 12,561 | 19,921 | 1.22 |

### select-eq/s=1/N

200 equality queries keeping 0.0200% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.020%, from 0.000% to 0.080%. Empty answers: 36.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 109,912 | 7,600 | 117,512 | 23.50x | - | key 7,675 |
| lokijs (adaptive) | 109,912 | 7,600 | 117,512 | 23.50x | - | key 7,675 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,007 | 422 | 18,007 | 1.28 |
| sift | 2,122 | 15 | 2,100 | 1.24 |
| mingo | 1,196 | 14 | 1,179 | 1.31 |
| lokijs (no index) | 22,950 | 892 | 23,033 | 1.86 |
| lokijs | 694,747 | 49,418 | 596,273 | 4.62 |
| lokijs (adaptive) | 745,573 | 96,138 | 604,078 | 4.48 |
| rowstore | 301,016 | 31,460 | 303,030 | 0.20 |
| rowstore (eager) | 441,786 | 60,107 | 552,105 | 0.26 |

### select-eq/s=0.001

200 equality queries keeping 0.100% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.100%, from 0.000% to 0.260%. Empty answers: 1.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 110,038 | 8,408 | 118,446 | 23.69x | - | key 8,489 |
| lokijs (adaptive) | 110,038 | 8,408 | 118,446 | 23.69x | - | key 8,489 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 20,156 | 275 | 19,957 | 1.28 |
| sift | 2,073 | 7 | 2,080 | 1.33 |
| mingo | 1,139 | 167 | 1,006 | 1.33 |
| lokijs (no index) | 25,584 | 2,090 | 26,992 | 1.86 |
| lokijs | 767,999 | 54,300 | 754,598 | 4.43 |
| lokijs (adaptive) | 803,884 | 107,818 | 710,060 | 4.41 |
| rowstore | 329,512 | 26,279 | 344,160 | 0.22 |
| rowstore (eager) | 482,751 | 92,367 | 512,219 | 0.18 |

### select-eq/s=0.05

200 equality queries keeping 5.00% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 5.060%, from 4.340% to 5.580%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 81,184 | 57,279 | 138,463 | 27.69x | - | key 57,866 |
| lokijs (adaptive) | 81,184 | 57,279 | 138,463 | 27.69x | - | key 57,866 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 12,986 | 627 | 12,986 | 1.26 |
| sift | 2,016 | 33 | 2,061 | 1.27 |
| mingo | 1,157 | 6 | 1,160 | 1.25 |
| lokijs (no index) | 16,375 | 1,153 | 18,456 | 1.77 |
| lokijs | 154,694 | 10,218 | 154,694 | 3.42 |
| lokijs (adaptive) | 160,917 | 4,957 | 160,503 | 3.45 |
| rowstore | 84,998 | 16,014 | 84,465 | 0.22 |
| rowstore (eager) | 98,918 | 30,681 | 74,525 | 0.19 |

### select-eq/s=0.25

200 equality queries keeping 25.0% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 24.940%, from 24.180% to 25.520%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 55,516 | 256,731 | 312,247 | 62.45x | - | key 259,222 |
| lokijs (adaptive) | 55,516 | 256,731 | 312,247 | 62.45x | - | key 259,222 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 15,423 | 227 | 15,525 | 1.31 |
| sift | 1,958 | 14 | 1,956 | 1.29 |
| mingo | 1,205 | 13 | 1,207 | 1.37 |
| lokijs (no index) | 16,760 | 492 | 16,760 | 2.16 |
| lokijs | 38,009 | 2,042 | 38,009 | 2.70 |
| lokijs (adaptive) | 38,912 | 1,565 | 38,858 | 2.72 |
| rowstore | 25,811 | 769 | 25,811 | 0.21 |
| rowstore (eager) | 27,884 | 741 | 27,835 | 0.45 |

### select-eq/s=0.5

200 equality queries keeping 50.0% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 49.280%, from 49.280% to 50.720%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 47,644 | 506,548 | 554,192 | 110.84x | - | key 511,687 |
| lokijs (adaptive) | 47,644 | 506,548 | 554,192 | 110.84x | - | key 511,687 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 11,574 | 1,568 | 10,861 | 1.38 |
| sift | 1,964 | 35 | 1,964 | 1.32 |
| mingo | 1,229 | 3 | 1,232 | 1.39 |
| lokijs (no index) | 12,651 | 153 | 12,602 | 1.84 |
| lokijs | 21,769 | 138 | 21,763 | 2.61 |
| lokijs (adaptive) | 21,307 | 191 | 21,175 | 2.57 |
| rowstore | 13,941 | 155 | 13,941 | 0.25 |
| rowstore (eager) | 14,298 | 9 | 14,301 | 0.23 |

### select-eq/s=1

200 equality queries keeping 100% of the rows

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 100.000%, from 100.000% to 100.000%. Empty answers: 0.0%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 9,998 | 1,007,000 | 1,016,998 | 203.40x | - | key 1,017,069 |
| lokijs (adaptive) | 9,998 | 1,007,000 | 1,016,998 | 203.40x | - | key 1,017,069 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 14,385 | 795 | 12,568 | 1.25 |
| sift | 1,984 | 17 | 2,003 | 1.32 |
| mingo | 1,358 | 14 | 1,358 | 1.32 |
| lokijs (no index) | 11,517 | 1,635 | 11,293 | 1.94 |
| lokijs | 10,705 | 617 | 10,033 | 2.09 |
| lokijs (adaptive) | 10,996 | 276 | 9,610 | 2.05 |
| rowstore | 6,240 | 358 | 5,752 | 0.27 |
| rowstore (eager) | 6,245 | 238 | 6,000 | 0.19 |

### select-rng/keep=5%

200 range queries whose range spans 5% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 2.500%, from 1.960% to 2.920%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,532,543, active 50,558 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| mingo | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,532,543, active 50,558 |
| lokijs (no index) | 0 | 1,563,727 | 1,563,727 | 156.37x | - | score 1,532,543, active 50,558 |
| lokijs | 157,564 | 567,719 | 725,283 | 72.53x | - | score 526,575, active 50,558 |
| lokijs (adaptive) | 157,564 | 567,719 | 725,283 | 72.53x | - | score 526,575, active 50,558 |
| rowstore (self-indexing) | 0 | 19,687 | 19,687 | 1.97x | 19,687 | answers from its own snapshot, so its run reads are a lower bound; score 14,429, active 5,258 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,435,306 | 1,435,306 | 143.53x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 12,813 | 150 | 12,773 | 1.24 |
| sift | 732 | 7 | 727 | 1.31 |
| mingo | 647 | 1 | 644 | 1.31 |
| lokijs (no index) | 9,266 | 142 | 9,266 | 1.85 |
| lokijs | 17,411 | 58 | 17,391 | 3.76 |
| lokijs (adaptive) | 17,249 | 114 | 17,139 | 3.82 |
| rowstore | 5,769 | 90 | 5,709 | 0.25 |
| rowstore (eager) | 6,059 | 61 | 6,059 | 0.19 |

### select-rng/keep=20%

200 range queries whose range spans 20% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 9.810%, from 9.160% to 10.420%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,615,862, active 200,890 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| mingo | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,615,862, active 200,890 |
| lokijs (no index) | 0 | 1,802,568 | 1,802,568 | 180.26x | - | score 1,615,862, active 200,890 |
| lokijs | 157,564 | 806,550 | 964,114 | 96.41x | - | score 609,886, active 200,890 |
| lokijs (adaptive) | 157,564 | 806,550 | 964,114 | 96.41x | - | score 609,886, active 200,890 |
| rowstore (self-indexing) | 0 | 17,092 | 17,092 | 1.71x | 17,092 | answers from its own snapshot, so its run reads are a lower bound; score 11,087, active 6,005 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,594,112 | 1,594,112 | 159.41x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 10,305 | 1,025 | 9,332 | 1.23 |
| sift | 734 | 34 | 645 | 1.33 |
| mingo | 568 | 10 | 469 | 1.30 |
| lokijs (no index) | 7,119 | 322 | 7,017 | 1.88 |
| lokijs | 11,742 | 159 | 9,742 | 3.81 |
| lokijs (adaptive) | 11,831 | 248 | 11,831 | 3.81 |
| rowstore | 4,463 | 85 | 4,476 | 0.25 |
| rowstore (eager) | 4,560 | 101 | 4,491 | 0.18 |

### select-rng/keep=45%

200 range queries whose range spans 45% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 22.170%, from 21.440% to 22.600%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,742,187, active 451,173 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| mingo | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,742,187, active 451,173 |
| lokijs (no index) | 0 | 2,169,848 | 2,169,848 | 216.98x | - | score 1,742,187, active 451,173 |
| lokijs | 157,564 | 1,173,847 | 1,331,411 | 133.14x | - | score 736,228, active 451,173 |
| lokijs (adaptive) | 157,564 | 1,173,847 | 1,331,411 | 133.14x | - | score 736,228, active 451,173 |
| rowstore (self-indexing) | 0 | 21,756 | 21,756 | 2.18x | 21,756 | answers from its own snapshot, so its run reads are a lower bound; score 14,550, active 7,206 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,788,464 | 1,788,464 | 178.85x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 8,341 | 1,440 | 7,684 | 1.24 |
| sift | 729 | 5 | 743 | 1.25 |
| mingo | 475 | 2 | 474 | 1.31 |
| lokijs (no index) | 6,056 | 21 | 6,061 | 1.88 |
| lokijs | 8,214 | 133 | 8,214 | 3.85 |
| lokijs (adaptive) | 8,179 | 181 | 8,245 | 3.90 |
| rowstore | 3,196 | 27 | 3,196 | 0.22 |
| rowstore (eager) | 3,269 | 72 | 3,292 | 0.18 |

### select-rng/keep=60%

200 range queries whose range spans 60% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 29.370%, from 28.760% to 29.840%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,815,523, active 601,174 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| mingo | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,815,523, active 601,174 |
| lokijs (no index) | 0 | 2,393,045 | 2,393,045 | 239.30x | - | score 1,815,523, active 601,174 |
| lokijs | 157,564 | 1,397,043 | 1,554,607 | 155.46x | - | score 809,561, active 601,174 |
| lokijs (adaptive) | 157,564 | 1,397,043 | 1,554,607 | 155.46x | - | score 809,561, active 601,174 |
| rowstore (self-indexing) | 0 | 21,826 | 21,826 | 2.18x | 21,826 | answers from its own snapshot, so its run reads are a lower bound; score 13,836, active 7,990 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,842,698 | 1,842,698 | 184.27x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 8,716 | 261 | 8,742 | 1.50 |
| sift | 727 | 8 | 731 | 1.28 |
| mingo | 430 | 1 | 431 | 1.32 |
| lokijs (no index) | 5,610 | 89 | 5,778 | 1.81 |
| lokijs | 6,878 | 110 | 6,848 | 3.81 |
| lokijs (adaptive) | 6,977 | 138 | 7,036 | 3.79 |
| rowstore | 2,861 | 29 | 2,861 | 0.23 |
| rowstore (eager) | 2,998 | 98 | 2,917 | 0.19 |

### select-rng/keep=100%

200 range queries whose range spans 100% of the value space, halved again by a residual equality: see the measured selectivity below, which is the number that matters

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 49.540%, from 49.540% to 49.540%. Empty answers: 0.0%.
Best index set: active:hash, score:sorted. Searched 5 of 7 candidate sets (the rest could not win on build cost alone), cap 2 of 3 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| sift | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| mingo | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| lokijs (no index) | 0 | 3,000,000 | 3,000,000 | 300.00x | - | score 2,020,000, active 1,010,000 |
| lokijs | 157,564 | 2,000,400 | 2,157,964 | 215.80x | - | score 1,010,404, active 1,010,000 |
| lokijs (adaptive) | 157,564 | 2,000,400 | 2,157,964 | 215.80x | - | score 1,010,404, active 1,010,000 |
| rowstore (self-indexing) | 0 | 25,000 | 25,000 | 2.50x | 25,000 | answers from its own snapshot, so its run reads are a lower bound; score 15,000, active 10,000 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 1.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; score 5,000, active 5,000 |
| reference, indexes active:hash, score:sorted | 10,000 | 0 | 10,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,990,800 | 1,990,800 | 199.08x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 7,937 | 261 | 7,937 | 1.31 |
| sift | 732 | 18 | 741 | 1.31 |
| mingo | 349 | 1 | 350 | 1.31 |
| lokijs (no index) | 4,670 | 26 | 4,701 | 1.85 |
| lokijs | 4,852 | 102 | 4,852 | 3.85 |
| lokijs (adaptive) | 4,875 | 94 | 4,965 | 3.77 |
| rowstore | 2,811 | 68 | 2,811 | 0.26 |
| rowstore (eager) | 2,997 | 161 | 3,104 | 0.19 |

### churn/m=0

200 equality queries with 0 insert-and-remove pairs between each

5,000 rows, 200 queries, 0 mutations.
True selectivity: median 0.100%, from 0.000% to 0.280%. Empty answers: 0.5%.
Best index set: key:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 200.00x | - | key 1,010,000 |
| lokijs | 109,936 | 8,347 | 118,283 | 23.66x | - | key 8,426 |
| lokijs (adaptive) | 109,936 | 8,347 | 118,283 | 23.66x | - | key 8,426 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,376 | 641 | 17,794 | 1.24 |
| sift | 1,692 | 33 | 1,669 | 1.28 |
| mingo | 1,028 | 11 | 1,032 | 1.30 |
| lokijs (no index) | 16,954 | 259 | 16,846 | 1.78 |
| lokijs | 576,231 | 6,999 | 523,560 | 4.52 |
| lokijs (adaptive) | 562,588 | 54,405 | 604,990 | 4.85 |
| rowstore | 339,919 | 17,551 | 366,609 | 0.20 |
| rowstore (eager) | 485,633 | 25,173 | 485,633 | 0.19 |

### churn/m=1

200 equality queries with 1 insert-and-remove pairs between each

5,000 rows, 200 queries, 400 mutations.
True selectivity: median 0.100%, from 0.000% to 0.240%. Empty answers: 1.0%.
Best index set: key:hash. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,010,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,010,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,010,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 185.19x | - | key 1,010,000 |
| lokijs | 109,936 | 21,888,952 | 21,998,888 | 4073.87x | - | key 21,998,938 |
| lokijs (adaptive) | 109,936 | 19,173 | 129,109 | 23.91x | - | key 19,261 |
| rowstore (self-indexing) | 0 | 10,398 | 10,398 | 1.93x | 10,398 | answers from its own snapshot, so its run reads are a lower bound; key 10,398 |
| rowstore (eager) (self-indexing) | 0 | 5,400 | 5,400 | 1.00x | 5,400 | answers from its own snapshot, so its run reads are a lower bound; key 5,400 |
| reference, indexes key:hash | 5,000 | 400 | 5,400 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 185.19x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 18,054 | 229 | 16,025 | 1.32 |
| sift | 1,689 | 5 | 2,093 | 1.26 |
| mingo | 997 | 5 | 1,128 | 1.30 |
| lokijs (no index) | 16,396 | 322 | 16,578 | 1.85 |
| lokijs | 389 | 1 | 390 | 4.38 |
| lokijs (adaptive) | 88,646 | 1,517 | 83,097 | 4.44 |
| rowstore | 260,346 | 3,442 | 263,562 | 0.20 |
| rowstore (eager) | 357,595 | 5,269 | 148,025 | 0.20 |

### churn/m=4

200 equality queries with 4 insert-and-remove pairs between each

5,000 rows, 200 queries, 1,600 mutations.
True selectivity: median 0.080%, from 0.000% to 0.240%. Empty answers: 0.5%.
Best index set: key:hash. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,005,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,005,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,005,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 151.52x | - | key 1,010,000 |
| lokijs | 109,936 | 21,883,541 | 21,993,477 | 3332.34x | - | key 21,993,582 |
| lokijs (adaptive) | 109,936 | 51,545 | 161,481 | 24.47x | - | key 51,589 |
| rowstore (self-indexing) | 0 | 11,592 | 11,592 | 1.76x | 11,592 | answers from its own snapshot, so its run reads are a lower bound; key 11,592 |
| rowstore (eager) (self-indexing) | 0 | 6,600 | 6,600 | 1.00x | 6,600 | answers from its own snapshot, so its run reads are a lower bound; key 6,600 |
| reference, indexes key:hash | 5,000 | 1,600 | 6,600 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 151.52x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 17,773 | 126 | 17,720 | 1.27 |
| sift | 1,696 | 11 | 1,615 | 1.27 |
| mingo | 991 | 14 | 967 | 1.32 |
| lokijs (no index) | 15,823 | 356 | 16,914 | 1.81 |
| lokijs | 389 | 1 | 386 | 4.45 |
| lokijs (adaptive) | 26,594 | 448 | 26,302 | 4.44 |
| rowstore | 238,961 | 8,970 | 243,816 | 0.21 |
| rowstore (eager) | 330,101 | 1,227 | 334,985 | 0.20 |

### churn/m=16

200 equality queries with 16 insert-and-remove pairs between each

5,000 rows, 200 queries, 6,400 mutations.
True selectivity: median 0.100%, from 0.000% to 0.340%. Empty answers: 1.5%.
Best index set: key:hash. Searched 4 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,005,000 |
| sift | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,005,000 |
| mingo | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,005,000 |
| lokijs (no index) | 0 | 1,000,000 | 1,000,000 | 87.72x | - | key 1,010,000 |
| lokijs | 109,936 | 21,871,091 | 21,981,027 | 1928.16x | - | key 21,981,006 |
| lokijs (adaptive) | 109,936 | 181,452 | 291,388 | 25.56x | - | key 181,494 |
| rowstore (self-indexing) | 0 | 16,368 | 16,368 | 1.44x | 16,368 | answers from its own snapshot, so its run reads are a lower bound; key 16,368 |
| rowstore (eager) (self-indexing) | 0 | 11,400 | 11,400 | 1.00x | 11,400 | answers from its own snapshot, so its run reads are a lower bound; key 11,400 |
| reference, indexes key:hash | 5,000 | 6,400 | 11,400 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 87.72x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 17,378 | 648 | 17,378 | 1.30 |
| sift | 1,702 | 7 | 1,698 | 1.26 |
| mingo | 1,026 | 3 | 1,030 | 1.24 |
| lokijs (no index) | 12,391 | 636 | 12,873 | 1.79 |
| lokijs | 381 | 3 | 378 | 4.51 |
| lokijs (adaptive) | 6,954 | 214 | 6,748 | 4.82 |
| rowstore | 135,513 | 8,191 | 141,773 | 0.19 |
| rowstore (eager) | 152,973 | 31,986 | 158,484 | 0.21 |

### hash-trap

20 equality queries then 200 range queries on one field: the case where the wrong index kind costs exactly 2.00x

5,000 rows, 220 queries, 0 mutations.
True selectivity: median 4.940%, from 0.000% to 5.340%. Empty answers: 5.0%.
Best index set: score:sorted. Searched 3 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,650,483 |
| sift | 0 | 2,100,000 | 2,100,000 | 420.00x | - | score 2,105,000 |
| mingo | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,650,483 |
| lokijs (no index) | 0 | 1,645,483 | 1,645,483 | 329.10x | - | score 1,650,483 |
| lokijs | 109,848 | 550,213 | 660,061 | 132.01x | - | score 550,250 |
| lokijs (adaptive) | 109,848 | 550,213 | 660,061 | 132.01x | - | score 550,250 |
| rowstore (self-indexing) | 0 | 20,643 | 20,643 | 4.13x | 20,643 | score 20,643 |
| rowstore (eager) (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | score 10,000 |
| reference, indexes score:sorted | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,387,743 | 1,387,743 | 277.55x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 16,235 | 75 | 12,457 | 1.59 |
| sift | 1,093 | 2 | 1,093 | 1.26 |
| mingo | 679 | 2 | 680 | 1.32 |
| lokijs (no index) | 9,754 | 111 | 9,622 | 1.85 |
| lokijs | 19,124 | 231 | 19,065 | 3.32 |
| lokijs (adaptive) | 19,999 | 328 | 20,127 | 3.31 |
| rowstore | 7,387 | 299 | 7,181 | 0.22 |
| rowstore (eager) | 7,820 | 19 | 7,831 | 0.19 |

### skew

400 queries alternating the hottest and the coldest value of a Zipf field

5,000 rows, 400 queries, 0 mutations.
True selectivity: median 9.560%, from 0.040% to 19.080%. Empty answers: 0.0%.
Best index set: topic:hash. Searched 2 of 4 candidate sets (the rest could not win on build cost alone), cap 2 of 2 candidates.

**Toll, in field reads**

| engine | build reads | run reads | total | vs best | self-reported | notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Array.filter | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,010,000 |
| sift | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,010,000 |
| mingo | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,010,000 |
| lokijs (no index) | 0 | 2,000,000 | 2,000,000 | 400.00x | - | topic 2,010,000 |
| lokijs | 93,982 | 206,000 | 299,982 | 60.00x | - | topic 207,983 |
| lokijs (adaptive) | 93,982 | 206,000 | 299,982 | 60.00x | - | topic 207,983 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | answers from its own snapshot, so its run reads are a lower bound; topic 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | answers from its own snapshot, so its run reads are a lower bound; topic 5,000 |
| reference, indexes topic:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 2,000,000 | 2,000,000 | 400.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,812 | 3,636 | 13,452 | 1.31 |
| sift | 1,681 | 3 | 1,682 | 1.28 |
| mingo | 1,045 | 3 | 1,048 | 1.30 |
| lokijs (no index) | 13,432 | 703 | 12,891 | 1.84 |
| lokijs | 66,533 | 3,166 | 66,533 | 3.92 |
| lokijs (adaptive) | 70,517 | 3,175 | 70,517 | 3.83 |
| rowstore | 65,761 | 2,002 | 65,603 | 0.21 |
| rowstore (eager) | 69,239 | 1,021 | 69,239 | 0.21 |

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
| lokijs | 100,260 | 22,477 | 122,737 | 24.55x | - | key 22,477 |
| lokijs (adaptive) | 100,260 | 22,477 | 122,737 | 24.55x | - | key 22,477 |
| rowstore (self-indexing) | 0 | 10,000 | 10,000 | 2.00x | 10,000 | key 10,000 |
| rowstore (eager) (self-indexing) | 0 | 5,000 | 5,000 | 1.00x | 5,000 | key 5,000 |
| reference, indexes key:hash | 5,000 | 0 | 5,000 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,000,000 | 1,000,000 | 200.00x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 13,281 | 223 | 13,442 | 1.29 |
| sift | 1,243 | 29 | 1,173 | 1.26 |
| mingo | 734 | 9 | 727 | 1.31 |
| lokijs (no index) | 9,619 | 766 | 10,450 | 2.03 |
| lokijs | 53,413 | 7,000 | 46,542 | 4.33 |
| lokijs (adaptive) | 53,055 | 2,101 | 51,195 | 4.18 |
| rowstore | 75,315 | 773 | 69,766 | 0.20 |
| rowstore (eager) | 100,749 | 11,633 | 93,276 | 0.19 |

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
| Array.filter | 19,277 | 217 | 19,361 | 1.31 |
| sift | 1,881 | 16 | 1,880 | 1.34 |
| mingo | 722 | 13 | 766 | 1.55 |
| lokijs (no index) | 16,380 | 607 | 16,380 | 2.03 |
| lokijs | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| lokijs (adaptive) | - | - | - | WRONG ANSWER: v in [2]: wrong-set, extra 2,7,12,17,22 |
| rowstore | 20,826 | 1,134 | 8,206 | 0.23 |
| rowstore (eager) | 24,465 | 3,603 | 24,465 | 0.22 |

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
| Array.filter | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,505,000, region 743,771, status 61,630 |
| sift | 0 | 4,500,000 | 4,500,000 | 671.84x | - | status 1,505,000, region 1,505,000, active 1,505,000 |
| mingo | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,505,000, region 743,771, status 61,630 |
| lokijs (no index) | 0 | 2,302,746 | 2,302,746 | 343.80x | - | active 1,505,000, region 743,771, status 61,630 |
| lokijs | 109,916 | 2,302,746 | 2,412,662 | 360.21x | - | active 1,505,000, region 743,771, status 61,630 |
| lokijs (adaptive) | 109,916 | 2,302,746 | 2,412,662 | 360.21x | - | active 1,505,000, region 743,771, status 61,630 |
| rowstore (self-indexing) | 0 | 22,655 | 22,655 | 3.38x | 22,655 | active 10,000, region 7,471, status 5,184 |
| rowstore (eager) (self-indexing) | 0 | 15,000 | 15,000 | 2.24x | 15,000 | status 5,000, region 5,000, active 5,000 |
| reference, indexes status:hash | 5,000 | 1,698 | 6,698 | 1.00x | - | the best index set that exists for this workload |
| reference, no index | 0 | 1,501,698 | 1,501,698 | 224.20x | - | what indexing was worth here |

**Throughput**

| engine | queries/s | IQR | first trial | build ms / why absent |
| --- | ---: | ---: | ---: | ---: |
| Array.filter | 11,527 | 2,220 | 11,771 | 2.05 |
| sift | 756 | 12 | 757 | 1.80 |
| mingo | 711 | 6 | 711 | 1.91 |
| lokijs (no index) | 9,242 | 400 | 9,242 | 2.45 |
| lokijs | 9,475 | 675 | 9,071 | 5.56 |
| lokijs (adaptive) | 9,652 | 283 | 9,453 | 5.02 |
| rowstore | 63,256 | 2,806 | 62,412 | 0.29 |
| rowstore (eager) | 72,443 | 1,817 | 72,443 | 0.31 |
