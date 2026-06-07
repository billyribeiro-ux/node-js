registerLessonSrc("44-cpu-caches", function () {/*
---
id: 44-cpu-caches
title: "CPU Caches, Cache Lines & Data-Oriented Design"
minutes: 28
level: advanced
objectives:
  - Map the memory hierarchy with real latency numbers and reason about cache miss cost
  - Explain cache lines and how spatial/temporal locality determines throughput
  - Restructure data layouts from array-of-structs to struct-of-arrays to maximise cache efficiency
---

# CPU Caches, Cache Lines & Data-Oriented Design

## Why this matters

The fastest algorithm running on the wrong data layout can be 10-100x slower than a mediocre
algorithm on cache-friendly data. Memory bandwidth — not CPU frequency — is the binding constraint
in almost every compute-heavy Node service. A distinguished engineer who understands the memory
hierarchy writes code that the hardware *wants* to run, not code that merely looks clean.

## Learning objectives

- Map the full memory hierarchy and attach real access latencies to each level.
- Explain what a cache line is, why it is 64 bytes, and how false sharing arises.
- Rewrite hot data paths using struct-of-arrays and TypedArrays to stay in L1/L2.
- Recognise when pointer-chasing (linked lists, object graphs, Maps) kills throughput.

## The Memory Hierarchy

Modern CPUs execute instructions in roughly 0.3 ns (at 3 GHz one clock ≈ 0.33 ns). But reading a
value from RAM takes ~60-100 ns — 200-300 clock cycles of pure stall. The cache hierarchy exists
to bridge that gap:

```
Level       Size (typical)   Latency       Bandwidth
Registers   ~1 KB            ~0.3 ns       —
L1 cache    32-64 KB/core    ~1 ns         ~1 TB/s
L2 cache    256 KB-1 MB/core ~4 ns         ~400 GB/s
L3 cache    8-64 MB shared   ~12-40 ns     ~200 GB/s
DRAM        GBs              ~60-100 ns    ~50 GB/s
NVMe SSD    TBs              ~100 µs       ~7 GB/s
```

These are orders-of-magnitude differences. An L1 hit is 100x faster than a DRAM access. A function
that fits its working set in L1 can be **100x faster** than the same function that spills to RAM.

In V8 (the JS engine inside Node 24), the JIT compilers — Ignition (bytecode interpreter),
Sparkplug (fast baseline JIT), Maglev (mid-tier JIT), and TurboFan (optimising JIT) — can produce
near-optimal machine code for your hot loops. When that code stalls waiting for cache misses,
the JIT cannot help you. The bottleneck is in the hardware, and only a better data layout solves it.

> [!PRINCIPAL]
> TurboFan can hoist, vectorise, and schedule instructions beautifully — but a cache miss is a
> 200-cycle unconditional stall. No amount of compiler cleverness eliminates it. At sustained
> throughput, memory bandwidth (not CPU speed) is the binding resource in analytics, signal
> processing, physics simulations, and any scan over large datasets in Node.

## Cache Lines: The Unit of Transfer

The CPU never fetches a single byte from memory. It fetches one **cache line** — 64 consecutive
bytes on x86-64 and ARM64 — and places the whole line in L1. Every byte in that line is then free
at L1 speed until it is evicted.

This has two powerful implications:

**Spatial locality** — if you read `array[i]`, the next 15 elements (for 4-byte int32) are already
in cache at no extra cost. Sequential access patterns are fast because each cache-line fetch pays
for 64 bytes of useful work.

**False sharing** — if two independent variables (e.g., counters for two worker threads) happen to
live in the same 64-byte cache line, each thread's write invalidates the other's copy of that line.
The hardware enforces cache coherency (MESI protocol) and the line bounces between cores, turning
independent writes into serialised conflicts even though the variables are logically unrelated.

```js
// False sharing scenario (read-only demonstration):
// Two hot counters that look independent:
//   let counterA = 0;   // offset 0
//   let counterB = 0;   // offset 8 (same 64-byte cache line)
// Thread 1 increments counterA, Thread 2 increments counterB.
// Even though they never share data, every increment causes a
// cache-line invalidation on the other core — bandwidth collapses.
//
// Fix: pad each counter to its own cache line (64 bytes / 8 bytes = 8 slots):
//   const buf = new SharedArrayBuffer(128); // 2 × 64 bytes
//   const counterA = new Int32Array(buf, 0,  16); // first  64-byte line
//   const counterB = new Int32Array(buf, 64, 16); // second 64-byte line
// Now each core owns its own cache line; no coherency traffic.
```

## Array-of-Structs vs Struct-of-Arrays

This is the single most impactful layout change you can make. Consider a particle simulation with
fields `x`, `y`, `vx`, `vy`, `mass`:

**Array-of-Structs (AoS)** — the natural OO layout:

```js
// AoS: each particle is an object, stored contiguously per-object
const particles = [
  { x: 0, y: 0, vx: 1, vy: 2, mass: 1.5 },
  { x: 5, y: 3, vx: 0, vy: 1, mass: 2.0 },
  // ...
];

// Physics update: only needs x, vx, y, vy — not mass
for (const p of particles) {
  p.x += p.vx;
  p.y += p.vy;
}
// Problem: each particle object may be at a random heap address.
// Accessing p.x loads a cache line that includes p.y, p.vx, p.vy, p.mass.
// But if those objects are spread across the heap, each access is a pointer-chase
// to a new cache line. N particles → up to N cache misses.
```

**Struct-of-Arrays (SoA)** — the data-oriented layout:

```js
// SoA: one TypedArray per field, all particles together
const N = 10_000;
const x    = new Float64Array(N);
const y    = new Float64Array(N);
const vx   = new Float64Array(N);
const vy   = new Float64Array(N);
const mass = new Float64Array(N);

// Physics update: sequential scan of only the fields we touch
for (let i = 0; i < N; i++) {
  x[i] += vx[i];
  y[i] += vy[i];
}
// x and vx are contiguous. Prefetcher sees sequential access, loads ahead.
// mass is never touched → we save bandwidth entirely.
// Each cache line holds 8 Float64 values → 8 particles updated per cache miss.
```

> [!PRINCIPAL]
> TypedArrays (`Float64Array`, `Int32Array`, etc.) are backed by a contiguous `ArrayBuffer`.
> V8 stores them as unboxed numeric arrays in memory — no pointer indirection, no heap boxing per
> element. A plain JS `Array` of numbers starts as a Smi/double array internally but can be
> degraded to a generic tagged-pointer array the moment you store a non-number. Use TypedArrays
> wherever the element type is fixed and numeric; V8's TurboFan can then autovectorise the loop.

## Why Pointer-Chasing Destroys Performance

A JavaScript `Map`, linked list, or deeply-nested object graph is a **pointer-chasing** structure:
each lookup dereferences a pointer to a heap-allocated object at an essentially random address.

With 10,000 entries, a random-access scan of a `Map<number, object>` might generate 10,000 L2/L3
or DRAM cache misses. The same data in a sorted `Float64Array` with binary search generates
`log2(10000) ≈ 13` cache misses — and a linear scan over it is nearly all L1 hits.

In hot paths — game loops, signal processing, columnar analytics — prefer:

- `TypedArray` over `Array` of numbers
- `TypedArray` over `Map<number, number>`
- Parallel arrays (SoA) over arrays of objects (AoS)
- Flat packed buffers over trees of heap objects

## Try it yourself

The runnable below models a row-major vs column-major traversal on a flat `Float32Array` that
represents a 2-D matrix. It counts the number of "effective" cache-line fetches each pattern
would cause. A row-major scan hits elements sequentially (cache-friendly); a column-major scan
jumps by `COLS` elements between accesses, causing a new cache-line fetch for each element when
`COLS * 4` exceeds 64 bytes.

```js run
// Model: how many 64-byte cache-line fetches does each traversal pattern generate?
// Float32 = 4 bytes, so one cache line covers 16 consecutive elements.
const CACHE_LINE_BYTES = 64;
const BYTES_PER_ELEM   = 4; // Float32Array
const ELEMS_PER_LINE   = CACHE_LINE_BYTES / BYTES_PER_ELEM; // 16

const ROWS = 512;
const COLS = 512;
const total = ROWS * COLS;

// Build a flat Float32Array representing a ROWS×COLS matrix (row-major layout)
const matrix = new Float32Array(total);
for (let i = 0; i < total; i++) matrix[i] = i * 0.001;

// ---- Row-major traversal (cache-friendly) ----
// Access: matrix[row * COLS + col]  → stride 1 between consecutive col accesses
let rowMajorMisses = 0;
let rowMajorSum = 0;
let lastLineRow = -1;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const idx = r * COLS + c;
    const lineId = Math.floor(idx / ELEMS_PER_LINE);
    if (lineId !== lastLineRow) { rowMajorMisses++; lastLineRow = lineId; }
    rowMajorSum += matrix[idx];
  }
}

// ---- Column-major traversal (cache-hostile) ----
// Access: matrix[row * COLS + col]  → stride COLS between consecutive row accesses
let colMajorMisses = 0;
let colMajorSum = 0;
let lastLineCol = -1;
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    const idx = r * COLS + c;
    const lineId = Math.floor(idx / ELEMS_PER_LINE);
    if (lineId !== lastLineCol) { colMajorMisses++; lastLineCol = lineId; }
    colMajorSum += matrix[idx];
  }
}

const totalLines = total / ELEMS_PER_LINE;
console.log(`Matrix: ${ROWS}×${COLS} Float32Array (${(total*4/1024).toFixed(0)} KB)`);
console.log(`Elements per cache line: ${ELEMS_PER_LINE}`);
console.log(`Total cache lines in matrix: ${totalLines}`);
console.log();
console.log(`Row-major traversal:`);
console.log(`  Cache-line fetches : ${rowMajorMisses} (${(rowMajorMisses/totalLines*100).toFixed(1)}% of lines)`);
console.log(`  (Each line fetched exactly once — perfect spatial locality)`);
console.log();
console.log(`Column-major traversal:`);
console.log(`  Cache-line fetches : ${colMajorMisses} (${(colMajorMisses/totalLines*100).toFixed(1)}% of lines touched)`);
console.log(`  (COLS=${COLS} stride × 4 bytes = ${COLS*4} bytes > 64 → every access is a new line)`);
console.log();
console.log(`Miss amplification: ${(colMajorMisses / rowMajorMisses).toFixed(1)}x more fetches column-major`);
console.log(`(Both sums equal: ${rowMajorSum.toFixed(1) === colMajorSum.toFixed(1)})`);
```

## Exercises

**Exercise 1:** Rewrite the particle physics update from AoS (array of objects) to SoA (parallel
TypedArrays) and count how many "cache line fetches" the hot loop triggers for each layout.

<details>
<summary>Show solution</summary>

```js run
const N = 1024;
const LINE_ELEMS = 16; // 64 bytes / 4 bytes (Float32)

// ---- AoS ----
// Each particle object is a heap allocation at an arbitrary address.
// Model it as: each object access touches one new cache line (worst-case pointer-chase).
let aosMisses = 0;
for (let i = 0; i < N; i++) {
  // Accessing p.x from a random heap address → model as 1 miss per particle per field
  aosMisses += 1; // x — brings in whole object line
  // p.vx is likely in the same line if the struct is small enough, but
  // we can't guarantee packing in V8's heap for real objects.
}
// Conservative: assume x and vx land in the same cache line (compact object)
console.log(`AoS  misses (optimistic, same line): ${aosMisses}`);

// ---- SoA with Float32Array ----
const x  = new Float32Array(N);
const vx = new Float32Array(N);
let soaMisses = 0;
let lastX  = -1;
let lastVx = -1;
for (let i = 0; i < N; i++) {
  x[i] += 1; // update position
  const xLine  = Math.floor(i / LINE_ELEMS);
  const vxLine = Math.floor(i / LINE_ELEMS);
  if (xLine  !== lastX)  { soaMisses++; lastX  = xLine; }
  if (vxLine !== lastVx) { soaMisses++; lastVx = vxLine; }
}
console.log(`SoA  misses (x + vx arrays):  ${soaMisses}`);
console.log(`SoA fetches 2 arrays × ${Math.ceil(N/LINE_ELEMS)} lines each = ${soaMisses} total`);
console.log(`AoS (random heap): up to ${N} misses; SoA: ${soaMisses} — ratio ${(N/soaMisses).toFixed(1)}x`);
```

</details>

**Exercise 2:** Write a cache-miss cost estimator. Given `N` random-access lookups into an array of
size `S` (elements), compute the expected number of cache misses using the formula
`misses ≈ min(N, S / ELEMS_PER_LINE)` (each unique cache line accessed contributes one miss).

<details>
<summary>Show solution</summary>

```js run
const ELEMS_PER_LINE = 16; // 64 bytes / 4 bytes

function estimateMisses(arraySize, numLookups) {
  // In the worst case (random access) each lookup hits a new cache line.
  // But once all lines are warm, subsequent accesses are free.
  const totalLines = Math.ceil(arraySize / ELEMS_PER_LINE);
  // Expected distinct lines accessed for numLookups random draws from totalLines
  // (Birthday-problem approximation): E[distinct] ≈ totalLines * (1 - (1 - 1/totalLines)^N)
  const expected = totalLines * (1 - Math.pow(1 - 1 / totalLines, numLookups));
  return { totalLines, expectedMisses: Math.round(expected) };
}

for (const [S, N] of [[1024, 100], [1024, 1024], [65536, 1000], [65536, 65536]]) {
  const { totalLines, expectedMisses } = estimateMisses(S, N);
  console.log(`Array=${S} elements (${totalLines} lines), ${N} random lookups → ~${expectedMisses} cache misses`);
}
```

</details>

## Common pitfalls

> [!PITFALL]
> **Treating `new Array(n)` and `new Float64Array(n)` as equivalent.** A plain JS array can hold
> mixed types, so V8 stores it as an array of tagged pointers (or transitions through Smi→double
> element kinds). A TypedArray is a flat, unboxed buffer. For numeric hot paths, using `Array`
> instead of a TypedArray can cost 3-5x in throughput — not from algorithm complexity, but from
> pointer-chasing and boxing overhead on every element access.

Beyond TypedArrays vs arrays: watch out for —

- **Interleaved hot/cold fields in the same struct.** If your hot loop only touches 2 of 10 fields,
  you're paying to load cache lines for 8 cold fields. Move cold fields to a parallel "cold" array.
- **Object allocation inside tight loops.** `{ x, y }` in a hot loop allocates on the V8 heap.
  Reuse pre-allocated TypedArray slots instead.
- **Using `Map<number, number>` for dense integer keys.** A plain `Int32Array` or `Float64Array`
  indexed by the key is 10-30x faster for dense key ranges.

## What you learned

- The memory hierarchy spans 5 orders of magnitude in latency (L1 ~1 ns to RAM ~100 ns to SSD ~100 µs).
- The CPU's unit of memory transfer is a 64-byte **cache line**; spatial locality means sequential scans are nearly free, random scans are not.
- **Struct-of-arrays** (parallel TypedArrays) beats **array-of-structs** (array of objects) for hot numeric loops because it maximises cache-line utilisation and enables prefetching.
- **False sharing** turns logically independent data into a coherency bottleneck; fix it by padding shared data to its own cache line.
- TypedArrays are the primary tool for cache-friendly, allocation-free, vectorisation-ready data in Node/V8.

## Next steps

Now that your data is cache-friendly, the next bottleneck is the CPU's ability to predict branches
and avoid the cost of object allocation. In the next lesson we tackle branch prediction,
branchless techniques, and allocation-free hot paths.
*/});
