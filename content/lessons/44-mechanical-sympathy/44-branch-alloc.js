registerLessonSrc("44-branch-alloc", function () {/*
---
id: 44-branch-alloc
title: "Branch Prediction, GC Pressure & Allocation-Free Code"
minutes: 28
level: advanced
objectives:
  - Explain how the branch predictor works and quantify the cost of a misprediction
  - Rewrite branch-heavy hot paths using branchless arithmetic techniques
  - Identify and eliminate allocation pressure in hot loops using object pools and buffer reuse
  - Understand what makes a call site monomorphic and why megamorphism silently kills throughput
---

# Branch Prediction, GC Pressure & Allocation-Free Code

## Why this matters

You've made your data cache-friendly. The next two bottlenecks are invisible in profilers: branch
mispredictions and GC pressure from short-lived allocations. A mispredicted branch costs 10-20
cycles of pipeline flush — trivial in isolation, catastrophic at millions of iterations per second.
And a hot loop that allocates a small object on every call can generate enough garbage to trigger
minor GC every few milliseconds, injecting unpredictable 1-5 ms pauses into otherwise sub-100 µs
operations. These are the bugs that make p99 latency look fine in testing and explode in production.

## Learning objectives

- Describe the CPU's branch predictor and quantify misprediction cost (~15 cycles / ~5 ns).
- Apply branchless arithmetic (conditional moves, sign-based selection) to eliminate unpredictable branches.
- Measure GC pressure with `--trace-gc` and `--trace-gc-verbose` and interpret the output.
- Build and use object pools and pre-allocated buffers to keep hot paths allocation-free.
- Understand monomorphic vs polymorphic vs megamorphic call sites and how V8 handles them.

## Branch Prediction: How It Works

Modern CPUs are deeply pipelined — a branch instruction is decoded, dispatched, and the next
instructions are already in flight before the branch outcome is known. The **branch predictor**
guesses which path will be taken and speculatively executes it. If correct: no cost. If wrong:
the pipeline is flushed and the correct path must be fetched and re-decoded.

On modern x86-64 and ARM64 microarchitectures (Intel Ice Lake, AMD Zen 4, Apple M-series):

```
Misprediction penalty: ~15-20 cycles ≈ 5-7 ns
```

At 3 GHz with a loop body of 3 cycles, a misprediction every iteration triples execution time.
The predictor is very good at **regular** patterns (always-taken, never-taken, alternating 0/1)
but fails on **data-dependent** branches whose outcome depends on essentially random values.

The classic demonstration: summing an array of random integers where you skip negatives. If the
data is sorted (all negatives first), the predictor sees a single pattern change and achieves
near-perfect accuracy. If the data is shuffled, each element triggers a coin-flip branch.

```js
// Read-only: real Node measurement of sorted vs unsorted conditional sum
// Run with: node --prof branch.mjs  (see --prof output with node --prof-process)
const N = 10_000_000;
const data = new Int32Array(N);
const r = new Int32Array(1);
// fill with random values in [-500, 499]
const crypto = await import("node:crypto");
crypto.webcrypto.getRandomValues(r);
// ...etc — see the runnable block below for a pure-JS model
```

> [!PRINCIPAL]
> The branch predictor uses a Branch Target Buffer (BTB) and Pattern History Table (PHT) with
> saturating counters. These are finite hardware resources. Highly polymorphic code with many call
> sites (megamorphic inline caches) and many unpredictable branches can **thrash** the predictor's
> finite tables, causing mispredictions even on branches that would individually be predictable.
> This is why tightly typed, monomorphic hot paths outperform generic, polymorphic ones even when
> both are "JIT-compiled."

## Branchless Techniques

The CPU has a `CMOV` (conditional move) instruction that selects between two values without a
branch. V8/TurboFan emits `CMOV` when it can prove a conditional is data-driven and has no
side-effects. You can also write branchless JS using arithmetic:

```js
// Branch-heavy: data-dependent branch that mispredicts ~50% on random input
let sum = 0;
for (let i = 0; i < data.length; i++) {
  if (data[i] > 0) sum += data[i];
}

// Branchless: eliminate the conditional with arithmetic
// (v >>> 31) extracts the sign bit: 0 for positive, 1 for negative (two's complement)
// ~(v >>> 31) + 1 is 1 for positive, 0 for negative => bitwise NOT trick
// mask = -(v > 0 ? 1 : 0) as Int32 is all-ones (0xFFFFFFFF) or 0
let sumBL = 0;
const int = new Int32Array(1);
for (let i = 0; i < data.length; i++) {
  const v = data[i];
  // sign bit is 0 for positive, 1 for negative (in Int32 two's-complement)
  const mask = ~(v >> 31) & 1; // 1 if v >= 0, 0 if v < 0
  sumBL += v * mask;
}
```

> [!NOTE]
> In pure JS the arithmetic trick may or may not be faster than the branch — TurboFan already
> emits CMOV for simple ternaries on typed numeric arrays. The real gain is in **sorted vs
> unsorted** data: branchless code is insensitive to data order; branchy code is not.

### Sorted vs Unsorted: the Quantifiable Difference

Sorting the input before a threshold scan is a legitimate engineering choice when the scan is
called many times on the same dataset. If you sort once (O(N log N)) and scan K times, the break-
even is roughly K > log₂(N), which is just 23 for N = 10M.

## GC Pressure & Allocation-Free Hot Paths

V8's garbage collector (Orinoco, with concurrent marking and incremental sweeping) runs a
**minor GC** (scavenge of the young generation, ~256 KB–8 MB) whenever the young generation fills.
A minor GC typically takes 1-5 ms in production. If your hot path allocates 8 MB of short-lived
objects per second, you get a minor GC roughly every second. Allocate 80 MB/s and you get ~10 GCs/s
— that's 10-50 ms of GC time per second injected into your latency distribution.

Diagnose with Node flags:

```bash
node --trace-gc app.mjs
```

> [!OUTPUT]
> [82352:0x...] 150 ms: Scavenge 7.5 (8.0) -> 3.2 (8.0) MB, 1.2 / 0.0 ms  (average mu = 0.987)
> [82352:0x...] 203 ms: Scavenge 7.8 (8.0) -> 3.1 (8.0) MB, 1.1 / 0.0 ms  (average mu = 0.988)

Each line is a minor GC. The two numbers are heap-before → heap-after. If you see these every
50-200 ms in a high-throughput path, you have a hot-path allocation problem.

For deeper allocation tracing:

```bash
node --trace-gc --trace-gc-verbose app.mjs
# or using clinic.js for interactive flamegraph
npx clinic heap -- node app.mjs
```

### Common Allocation Sources in Hot Paths

1. **Object literals** — `const point = { x, y }` inside a loop allocates.
2. **Closures capturing variables** — `arr.map(v => v + offset)` allocates a new Function object
   unless TurboFan can inline it completely (it usually can for simple lambdas, but not always).
3. **Spread and rest** — `[...arr]`, `{ ...obj }` always allocate.
4. **`arguments` object** — accessing `arguments` in a non-arrow function allocates the object.
5. **Generator/async iterators** — each `yield` suspends and resumes via heap-allocated generator state.
6. **`Array.from`, `Array.prototype.map/filter`** — always return new arrays.

### Object Pools

An **object pool** pre-allocates a fixed number of objects and recycles them. The pool hands out
objects from a free list and accepts them back after use. Zero allocation on the hot path.

```js
// Read-only: a typed object pool for a 2D vector
class Vec2Pool {
  constructor(capacity) {
    this._pool = Array.from({ length: capacity }, () => ({ x: 0, y: 0 }));
    this._free = capacity;
  }
  acquire() {
    if (this._free === 0) throw new Error("pool exhausted");
    return this._pool[--this._free];
  }
  release(v) {
    v.x = 0; v.y = 0;
    this._pool[this._free++] = v;
  }
}

// Hot path: zero allocation
const pool = new Vec2Pool(1024);
function computeOffset(ax, ay, bx, by) {
  const v = pool.acquire();
  v.x = bx - ax;
  v.y = by - ay;
  const len = Math.hypot(v.x, v.y);
  pool.release(v);
  return len;
}
```

### Buffer Reuse with TypedArrays

For numeric data, don't pool objects — reuse a single pre-allocated `TypedArray`:

```js
// Pre-allocate once
const scratchBuffer = new Float64Array(4096);

function processChunk(inputArray, length) {
  // Write results into scratchBuffer, never allocate
  for (let i = 0; i < length; i++) {
    scratchBuffer[i] = inputArray[i] * 2.0 + 1.0;
  }
  return scratchBuffer.subarray(0, length); // subarray is a zero-copy view, not a copy
}
```

> [!PRINCIPAL]
> `TypedArray.prototype.subarray()` returns a view (no allocation, no copy). `TypedArray.prototype.slice()`
> returns a new buffer (allocation). In allocation-sensitive hot paths, always use `subarray` to
> carve windows into a pre-allocated buffer. Track offsets manually if you need multiple concurrent
> windows. This is the same pattern used by Node's `Buffer.allocUnsafeSlow` pool internally.

## Monomorphic Call Sites

V8 uses **inline caches (ICs)** to speed up property access and function calls. When a call site
always sees the same hidden class (object shape), V8 optimises it as **monomorphic** — essentially
a direct memory read without any property lookup. When it sees 2-4 shapes it becomes **polymorphic**;
beyond that, **megamorphic**. Megamorphic ICs fall back to a hash-table lookup on every access.

```js
// Monomorphic — all objects have the same hidden class {x, y}
function getX(p) { return p.x; }
const pts = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i }));
pts.forEach(getX); // IC stays monomorphic, TurboFan inlines the load

// Megamorphic — objects have different shapes
function getXGeneric(p) { return p.x; }
getXGeneric({ x: 1 });          // shape A
getXGeneric({ x: 1, y: 2 });    // shape B
getXGeneric({ x: 1, y: 2, z: 3 }); // shape C → megamorphic
// Subsequent calls never get optimised; every access is a hash-table lookup
```

You can inspect V8's optimisation status with `--allow-natives-syntax`:

```bash
node --allow-natives-syntax -e "
function add(a,b){return a+b}
add(1,2); add(1,2);
%OptimizeFunctionOnNextCall(add);
add(1,2);
console.log(%GetOptimizationStatus(add));
"
```

> [!OUTPUT]
> 2

Status `2` = TurboFan-optimised. Status `65` = interpreted. Status `25` = Maglev.
Run `node --allow-natives-syntax --print-opt-code app.mjs` to see the generated assembly.

> [!PITFALL]
> **Adding properties to objects after construction** creates a new hidden class each time,
> fragmenting V8's shape tree and silently turning monomorphic ICs megamorphic. Always initialise
> all properties in the constructor, in the same order, and never add properties dynamically on
> hot-path objects. This is the #1 cause of "the code was fast in the benchmark but slow in
> production" — production objects often carry extra debug/metadata properties added conditionally.

## Try it yourself

This runnable models branch-prediction cost and compares a branch-heavy vs branchless conditional
sum. It also simulates an allocation-heavy vs pooled path by counting "allocation events."

```js run
// ---- Part 1: Branch-heavy vs branchless conditional sum ----
const N = 200_000;
const data = new Int32Array(N);

// Fill with random values in [-1000, 999]
let seed = 42;
function lcg() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}
for (let i = 0; i < N; i++) {
  data[i] = ((lcg() % 2000) | 0) - 1000;
}

// Branch-heavy version
let t0 = performance.now();
let sumBranchy = 0;
for (let i = 0; i < N; i++) {
  if (data[i] > 0) sumBranchy += data[i];
}
let t1 = performance.now();
const branchyMs = (t1 - t0).toFixed(3);

// Branchless version (sign-bit mask)
let t2 = performance.now();
let sumBranchless = 0;
for (let i = 0; i < N; i++) {
  const v = data[i];
  const mask = (~(v >> 31)) & 1; // 1 if v >= 0, 0 if negative
  sumBranchless += v * mask;
}
let t3 = performance.now();
const branchlessMs = (t3 - t2).toFixed(3);

console.log("=== Branch comparison (random data) ===");
console.log(`Branch-heavy:  ${branchyMs} ms  (sum=${sumBranchy})`);
console.log(`Branchless:    ${branchlessMs} ms  (sum=${sumBranchless})`);
console.log(`Results match: ${sumBranchy === sumBranchless}`);

// Now sort and re-run the branch-heavy version
data.sort();
let t4 = performance.now();
let sumSorted = 0;
for (let i = 0; i < N; i++) {
  if (data[i] > 0) sumSorted += data[i];
}
let t5 = performance.now();
console.log(`Branch-heavy (sorted): ${(t5 - t4).toFixed(3)} ms  (predictor now sees clean transition)`);

// ---- Part 2: Allocation-heavy vs pooled path ----
console.log("\n=== Allocation simulation ===");
const ITERS = 50_000;

// Allocating version: creates a new object each call
let allocCount = 0;
function allocatingProcess(x, y) {
  allocCount++;
  const v = { x, y, len: 0 }; // allocation
  v.len = Math.hypot(v.x, v.y);
  return v.len;
}

// Pooled version: reuses a single scratch object
const scratch = { x: 0, y: 0, len: 0 };
function pooledProcess(x, y) {
  scratch.x = x;
  scratch.y = y;
  scratch.len = Math.hypot(scratch.x, scratch.y);
  return scratch.len;
}

let allocTotal = 0;
for (let i = 0; i < ITERS; i++) allocTotal += allocatingProcess(i, i + 1);

let poolTotal = 0;
for (let i = 0; i < ITERS; i++) poolTotal += pooledProcess(i, i + 1);

console.log(`Allocating version: ${allocCount} object allocations for ${ITERS} iterations`);
console.log(`Pooled version:     0 allocations (single reused scratch object)`);
console.log(`Results match: ${Math.abs(allocTotal - poolTotal) < 0.001}`);
console.log(`At 8 MB/GC threshold, allocating version triggers GC every ~${(8*1024*1024 / (ITERS * 40)).toFixed(0)} batches`);
console.log(`(assuming ~40 bytes/object; pooled version: never)`);
```

## Exercises

**Exercise 1:** Write a branchless `clamp(v, lo, hi)` that clamps a value to [lo, hi] without
any `if` statements. Use `Math.min` and `Math.max` (which TurboFan lowers to CMOV), or bit tricks.

<details>
<summary>Show solution</summary>

```js run
// Math.min/max are lowered to conditional-move instructions by TurboFan —
// they are the idiomatic branchless clamp in JS.
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Verify
const cases = [[-10, 0, 100], [50, 0, 100], [150, 0, 100], [0, 0, 100], [100, 0, 100]];
for (const [v, lo, hi] of cases) {
  console.log(`clamp(${v}, ${lo}, ${hi}) = ${clamp(v, lo, hi)}`);
}

// Branchless absolute value using bit trick (Int32 only)
function absInt32(v) {
  const sign = v >> 31;       // all-zeros or all-ones
  return (v + sign) ^ sign;   // two's-complement negation if negative
}
console.log("\nbranchless abs:");
[-5, 0, 7, -2147483648, 2147483647].forEach(v => {
  console.log(`absInt32(${v}) = ${absInt32(v)}`);
});
```

</details>

**Exercise 2:** Build a minimal object pool for a `Rect` type (`x, y, w, h`) and confirm that
acquiring and releasing 10,000 times produces zero "allocations" (track with a counter).

<details>
<summary>Show solution</summary>

```js run
class RectPool {
  constructor(capacity) {
    this._pool = [];
    this._allocs = 0;
    for (let i = 0; i < capacity; i++) {
      this._pool.push({ x: 0, y: 0, w: 0, h: 0 });
    }
    this._head = capacity - 1;
  }
  acquire(x, y, w, h) {
    if (this._head < 0) {
      this._allocs++; // pool exhausted — had to allocate
      return { x, y, w, h };
    }
    const r = this._pool[this._head--];
    r.x = x; r.y = y; r.w = w; r.h = h;
    return r;
  }
  release(r) {
    this._pool[++this._head] = r;
  }
  get allocationCount() { return this._allocs; }
}

const pool = new RectPool(64);
const ITERS = 10_000;

for (let i = 0; i < ITERS; i++) {
  const r = pool.acquire(i, i, 10, 20);
  // use r ...
  pool.release(r);
}

console.log(`Iterations:  ${ITERS}`);
console.log(`Pool allocs: ${pool.allocationCount} (should be 0 — pool never exhausted)`);
console.log(`Pool is allocation-free: ${pool.allocationCount === 0}`);
```

</details>

## Common pitfalls

> [!PITFALL]
> **Sorting to avoid mispredictions is a one-shot win only if the data stays sorted.** If your
> hot loop runs on a stream of incoming events and you sort before each scan, the sort itself
> (O(N log N)) can cost more than the mispredictions you save unless N is large and the scan
> runs many times. Profile before sorting — `--prof` plus `node --prof-process` will tell you
> whether branch mispredictions or the sort itself dominate. Also: TurboFan's CMOV lowering of
> `Math.min`/`Math.max` works only on unboxed doubles; if your array holds mixed types and V8
> deoptimises the function, you lose the CMOV and get a full branch again.

Additional pitfalls:

- **Object pools with variable-size objects** defeat the hidden-class stability guarantee —
  if pool objects hold references of different types between uses, V8 may transition their
  hidden class. Always zero/reset fields to the same type on release.
- **Mixing Int32 and Float64 in the same TypedArray operation.** V8 widens to Float64 for
  any mixed arithmetic, doubling memory bandwidth requirement.
- **`--trace-deopt` silence** does not mean no deoptimisations — `--trace-deopt` only shows
  eager deopt; lazy deopt (from IC feedback updates) requires `--trace-opt --trace-deopt`.

## What you learned

- Branch mispredictions cost ~15-20 cycles each; data-dependent branches on unsorted data can
  approach 50% miss rate — a throughput-halving event in tight loops.
- Branchless arithmetic using sign-bit masking and `Math.min`/`Math.max` (CMOV) eliminates
  data-dependent branches from hot inner loops.
- Minor GC (scavenge) in Node/V8 takes 1-5 ms and fires whenever the young generation (~8 MB)
  fills; allocating objects in hot loops is the primary cause.
- Object pools and TypedArray scratch buffers eliminate allocation entirely from hot paths,
  keeping GC pauses infrequent and predictable.
- Monomorphic call sites and consistent hidden classes are prerequisites for TurboFan
  optimisation; megamorphic ICs silently degrade every property access to a hash-table lookup.

## Next steps

With cache-friendly data and allocation-free, branch-predictable hot paths, the last frontier is
raw arithmetic throughput. The next lesson explores SIMD data parallelism, WebAssembly, and where
pure JS hits an absolute ceiling — and how to break through it.
*/});
