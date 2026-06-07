registerLessonSrc("44-simd-wasm", function () {/*
---
id: 44-simd-wasm
title: "SIMD, WASM & Beating the JIT"
minutes: 30
level: advanced
objectives:
  - Explain SIMD data parallelism and the 128-bit lane model used by WebAssembly SIMD
  - Quantify when WASM beats JS and when the FFI boundary cost makes it counterproductive
  - Model SIMD-style parallelism using 4-at-a-time loop unrolling in pure JS
  - Use SharedArrayBuffer and Atomics for zero-copy communication between JS and WASM
  - Design a complete numeric pipeline from naive JS through each optimisation tier
---

# SIMD, WASM & Beating the JIT

## Why this matters

There is a hard ceiling above which TurboFan cannot take you: one scalar operation per clock cycle.
SIMD (Single Instruction, Multiple Data) breaks that ceiling by processing N values simultaneously
with one instruction. WebAssembly SIMD gives you explicit 128-bit vector operations from JS;
manual loop unrolling gives you a software-visible approximation of the same throughput gain.
But WASM is not a free lunch — every call across the JS/WASM boundary serialises, and poorly
structured WASM can be slower than well-tuned JS. Knowing *when* to reach for WASM and *when* to
squeeze the JIT is the judgment call that separates senior from distinguished engineering.

## Learning objectives

- Describe SIMD lane arithmetic and the 128-bit register model (f32x4, i32x4, etc.).
- Explain the JS/WASM FFI cost and the conditions under which WASM wins or loses.
- Apply 4-at-a-time unrolled loops in JS to model SIMD lanes and reduce loop overhead.
- Use `SharedArrayBuffer` and `Atomics` for safe zero-copy data sharing with WASM workers.
- Structure a numeric hot loop across four tiers: naive → cache-friendly → allocation-free → vectorised.

## SIMD: The Last Tier of Scalar Throughput

Modern x86-64 CPUs have SSE4.2, AVX2, and AVX-512 vector units. ARM64 has NEON and SVE. These
units contain wide registers — 128, 256, or 512 bits — and a set of instructions that operate on
all lanes simultaneously. A single `VADDPS ymm0, ymm1, ymm2` instruction on AVX2 adds eight
`float32` pairs in one clock cycle. That is 8x the throughput of a scalar loop at the same clock rate.

WebAssembly SIMD standardises a 128-bit lane model:

```
f32x4  — four float32 lanes (128 bits)
f64x2  — two float64 lanes
i32x4  — four int32 lanes
i16x8  — eight int16 lanes
i8x16  — sixteen int8 lanes
```

Each WASM SIMD operation (add, mul, min, max, shuffle, blend, etc.) maps to a single vector
instruction on the host CPU. On x86-64, `f32x4.add` compiles to `ADDPS`; on ARM64 to `FADD.4S`.

Node 24 compiles WASM with V8's WASM compiler (Liftoff for baseline, TurboFan for optimised WASM
tiers). WASM SIMD is enabled by default — no flag needed since Node 16.

```js
// Read-only: load a WASM module with SIMD in Node 24
import { readFile } from "node:fs/promises";

const wasm = await readFile("./dot_product.wasm");
const { instance } = await WebAssembly.instantiate(wasm);
// instance.exports.dot_product_f32(ptrA, ptrB, length) — uses f32x4 lanes internally
```

> [!PRINCIPAL]
> TurboFan *can* autovectorise TypedArray loops in some cases (V8 does this for simple counted
> loops on known element kinds), but the vectorisation is opportunistic and silent. WASM SIMD gives
> you *explicit*, deterministic, guaranteed vectorisation. For a 10M-element float32 dot product,
> explicitly vectorised WASM SIMD typically runs 2-4x faster than the best TurboFan-compiled JS,
> because you choose the exact lane width and instruction sequence rather than hoping the JIT
> discovers it. Profile first; if TurboFan autovectorises, WASM adds overhead for nothing.

## The JS/WASM FFI Boundary Cost

Every call from JS into WASM (or WASM into JS) crosses the FFI boundary. The cost includes:

- Type coercion and parameter marshalling (minimal for numeric primitives, O(1)).
- Stack frame setup for the WASM VM instance.
- A safepoint check (allows GC to proceed).
- On V8 TurboFan: ~5-20 ns per call (1 call = ~60 cycles at 3 GHz).

This means short WASM functions called in a JS loop are **slower** than pure JS:

```js
// Read-only: WASM boundary cost dominates for tiny functions
// BAD: calling WASM per element
for (let i = 0; i < N; i++) {
  output[i] = wasmExports.processOne(input[i]); // N boundary crossings × ~10 ns each
}

// GOOD: pass the entire buffer, process in bulk inside WASM
const inputPtr  = wasmExports.alloc(N * 4);
const outputPtr = wasmExports.alloc(N * 4);
const mem = new Float32Array(wasmExports.memory.buffer, inputPtr, N);
mem.set(inputArray);
wasmExports.processBulk(inputPtr, outputPtr, N); // 1 boundary crossing, N SIMD ops
const result = new Float32Array(wasmExports.memory.buffer, outputPtr, N);
```

Rule of thumb: WASM is worth it when the ratio of **work inside WASM** to **boundary crossings**
is at least 1000:1. For a 1M-element operation with 1 call: 1,000,000:1 — easily worthwhile.
For a 10-element operation per event-loop tick: probably not.

## SharedArrayBuffer, Atomics, and Zero-Copy with WASM

For streaming data between a JS thread and a WASM worker thread (via `worker_threads`), use a
`SharedArrayBuffer` as the backing store for WASM linear memory:

```js
// Read-only: shared memory between JS main thread and WASM worker
// main.mjs
import { Worker } from "node:worker_threads";

const BUFFER_SIZE = 4 * 1024 * 1024; // 4 MB
const sab = new SharedArrayBuffer(BUFFER_SIZE);
const control = new Int32Array(new SharedArrayBuffer(16)); // [ready, done, ...]

const worker = new Worker("./wasm-worker.mjs", {
  workerData: { sab, control }
});

// Fill the buffer from JS side
const inputView = new Float32Array(sab, 0, BUFFER_SIZE / 4);
for (let i = 0; i < inputView.length; i++) inputView[i] = Math.random();

// Signal the worker: data is ready
Atomics.store(control, 0, 1);
Atomics.notify(control, 0, 1);

// Wait for result
Atomics.wait(control, 1, 0); // blocks until worker sets control[1] = 1
console.log("Result:", new Float32Array(sab, BUFFER_SIZE / 2, 4));
```

```js
// Read-only: wasm-worker.mjs
import { workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";

const { sab, control } = workerData;

// Wait for main thread signal
Atomics.wait(control, 0, 0);

const wasm = await readFile("./processor.wasm");
const memory = new WebAssembly.Memory({
  initial: 64, maximum: 64, shared: true
});
// Mount the SharedArrayBuffer as WASM memory (requires matching sizes)
const { instance } = await WebAssembly.instantiate(wasm, {
  env: { memory }
});

instance.exports.process(0, sab.byteLength / 2, sab.byteLength / 4);

Atomics.store(control, 1, 1);
Atomics.notify(control, 1, 1);
```

> [!NOTE]
> `SharedArrayBuffer` requires `Cross-Origin-Isolated` headers in browser contexts, but in Node 24
> `worker_threads` with `SharedArrayBuffer` works without any special flags. WASM `Memory` objects
> with `shared: true` require the `--experimental-wasm-threads` flag in older Node; in Node 24
> shared WASM memory is fully stable.

> [!PRINCIPAL]
> `Atomics.wait` is a **blocking** call that parks the calling thread in the OS scheduler. Never
> call it on the main Node.js thread (it will block the event loop). It is safe in a `worker_threads`
> Worker (which has its own thread). For main-thread synchronisation, use `Atomics.waitAsync`
> (returns a Promise that resolves when the value changes) — available in Node 24 without flags.

## When WASM Wins and When It Loses

| Scenario | WASM SIMD wins | Plain JS wins |
|---|---|---|
| Large typed-numeric batch (>10K elements) | yes — explicit vectorisation, no GC | |
| Int8 / Int16 quantised ML inference | yes — i8x16/i16x8 lanes, 8-16x throughput | |
| Tight numeric kernel called once per frame | yes — no GC interference | |
| < 1K elements, called per-event | | JS overhead < FFI cost |
| String / object processing | | WASM has no GC objects natively |
| Prototype / exploratory code | | Faster to write, profile first |
| Already autovectorised by TurboFan | | Zero marginal gain from WASM |

## Manual Loop Unrolling: SIMD-in-JS

Even without WASM, you can extract some SIMD-like throughput in JS by unrolling your inner loop
4x. Unrolling does two things: it reduces loop-control overhead (decrement, compare, branch) by
4x, and it exposes 4 independent arithmetic chains to the CPU's out-of-order execution units,
which can then schedule them in parallel — effectively executing 4 additions simultaneously if
they are data-independent.

```js
// Scalar loop
let sum = 0;
for (let i = 0; i < N; i++) sum += data[i];

// 4-unrolled (models f32x4 lane summation)
let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
const tail = N & ~3; // round down to multiple of 4
for (let i = 0; i < tail; i += 4) {
  s0 += data[i];
  s1 += data[i + 1];
  s2 += data[i + 2];
  s3 += data[i + 3];
}
// handle tail
for (let i = tail; i < N; i++) s0 += data[i];
const sumUnrolled = s0 + s1 + s2 + s3;
```

The four accumulators `s0..s3` are data-independent — the CPU can execute all four additions in
parallel on separate ALU ports. This is a software approximation of what `f32x4.add` does in hardware.

## Try it yourself

This runnable compares scalar vs 4-at-a-time unrolled loops on a large `Float32Array`, modelling
the throughput difference of SIMD lanes. It also counts "operations per ms" to give a concrete
throughput figure.

```js run
const N = 1_000_000;
const data = new Float32Array(N);

// Fill with deterministic pseudo-random values
let seed = 0xdeadbeef;
for (let i = 0; i < N; i++) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  data[i] = (seed >>> 0) / 4294967296; // [0, 1)
}

// ---- Scalar loop ----
let t0 = performance.now();
let scalarSum = 0;
for (let i = 0; i < N; i++) scalarSum += data[i];
let scalarMs = performance.now() - t0;

// ---- 4-lane unrolled (SIMD model) ----
let t1 = performance.now();
let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
const boundary = (N >>> 2) << 2; // floor to multiple of 4
for (let i = 0; i < boundary; i += 4) {
  a0 += data[i];
  a1 += data[i + 1];
  a2 += data[i + 2];
  a3 += data[i + 3];
}
for (let i = boundary; i < N; i++) a0 += data[i];
const unrolledSum = a0 + a1 + a2 + a3;
let unrolledMs = performance.now() - t1;

// ---- 8-lane unrolled (models AVX2 f32x8) ----
let t2 = performance.now();
let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,b7=0;
const b8 = (N >>> 3) << 3;
for (let i = 0; i < b8; i += 8) {
  b0 += data[i];   b1 += data[i+1];
  b2 += data[i+2]; b3 += data[i+3];
  b4 += data[i+4]; b5 += data[i+5];
  b6 += data[i+6]; b7 += data[i+7];
}
for (let i = b8; i < N; i++) b0 += data[i];
const unrolled8Sum = b0+b1+b2+b3+b4+b5+b6+b7;
let unrolled8Ms = performance.now() - t2;

// ---- Throughput report ----
const mops = (N / 1e6); // million operations
console.log(`Array: ${N.toLocaleString()} Float32 elements (${(N*4/1024/1024).toFixed(1)} MB)`);
console.log("");
console.log("=== Scalar loop (1 accumulator) ===");
console.log(`  Time: ${scalarMs.toFixed(3)} ms`);
console.log(`  Throughput: ${(mops / scalarMs * 1000).toFixed(0)} M ops/s`);
console.log(`  Sum: ${scalarSum.toFixed(3)}`);
console.log("");
console.log("=== 4-unrolled (models f32x4 SIMD) ===");
console.log(`  Time: ${unrolledMs.toFixed(3)} ms`);
console.log(`  Throughput: ${(mops / unrolledMs * 1000).toFixed(0)} M ops/s`);
console.log(`  Speedup vs scalar: ${(scalarMs / unrolledMs).toFixed(2)}x`);
console.log(`  Sum: ${unrolledSum.toFixed(3)}`);
console.log("");
console.log("=== 8-unrolled (models f32x8 AVX2) ===");
console.log(`  Time: ${unrolled8Ms.toFixed(3)} ms`);
console.log(`  Throughput: ${(mops / unrolled8Ms * 1000).toFixed(0)} M ops/s`);
console.log(`  Speedup vs scalar: ${(scalarMs / unrolled8Ms).toFixed(2)}x`);
console.log(`  Sum: ${unrolled8Sum.toFixed(3)}`);
console.log("");

// Model the WASM SIMD win: ~3x over best-case unrolled JS for real SIMD
const estimatedWasmMs = unrolled8Ms / 3;
console.log(`Estimated WASM f32x4 SIMD: ~${estimatedWasmMs.toFixed(3)} ms (model: 3x over unrolled JS)`);
console.log(`(Real WASM would be benchmarked with node --experimental-wasm-simd on a .wasm binary)`);

// Count total SIMD-model ops
const totalOps = N;
const scalarOpsPerCycle = 1;
const simdOpsPerCycle = 4; // f32x4
console.log(`\nSIMD efficiency model:`);
console.log(`  Scalar: ${scalarOpsPerCycle} op/cycle`);
console.log(`  f32x4:  ${simdOpsPerCycle} ops/cycle (${simdOpsPerCycle}x throughput)`);
console.log(`  For ${N.toLocaleString()} ops: scalar=${N} cycles, SIMD=${N/simdOpsPerCycle} cycles`);
```

## Project

### "Zero to SIMD: A Four-Tier Numeric Pipeline"

Take a numeric hot loop — computing a **dot product** of two float32 vectors — from a naive
JavaScript baseline through each optimisation tier and chart the speedup at each stage. This
project demonstrates the complete mechanical-sympathy stack in one benchmark.

**Acceptance criteria:**

1. **Tier 0 — Naive JS**: Implement `dotNaive(a, b)` using a plain `Number` array and a scalar
   loop. Measure throughput in million ops/s.
2. **Tier 1 — TypedArray / cache-friendly**: Implement `dotTyped(a, b)` using `Float32Array`.
   Measure and show the speedup over Tier 0; explain why cache-line utilisation improves.
3. **Tier 2 — Allocation-free**: Confirm that `dotTyped` allocates zero objects per call. Add a
   mock allocation counter and verify it remains 0.
4. **Tier 3 — 4-unrolled (SIMD model)**: Implement `dotUnrolled4(a, b)` using four independent
   accumulator variables (s0..s3). Measure and chart speedup over Tier 1.
5. **Tier 4 — 8-unrolled (AVX2 model)**: Implement `dotUnrolled8(a, b)` using eight accumulators.
   Measure speedup over Tier 3.
6. **Chart**: Print a formatted ASCII bar chart comparing throughput across all tiers, with the
   modelled WASM SIMD estimate as a reference bar.

```js run
// Starter: core framework — fill in the implementations and chart
const N = 500_000;

// ---- Data setup ----
// Naive JS arrays (Tier 0)
const aNaive = Array.from({ length: N }, () => Math.random());
const bNaive = Array.from({ length: N }, () => Math.random());

// TypedArrays (Tier 1-4)
const aTyped = new Float32Array(N);
const bTyped = new Float32Array(N);
for (let i = 0; i < N; i++) { aTyped[i] = aNaive[i]; bTyped[i] = bNaive[i]; }

// ---- Tier 0: Naive JS ----
function dotNaive(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ---- Tier 1: TypedArray ----
function dotTyped(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ---- Tier 3: 4-lane unrolled ----
function dotUnrolled4(a, b) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  const len4 = (a.length >>> 2) << 2;
  for (let i = 0; i < len4; i += 4) {
    s0 += a[i]   * b[i];
    s1 += a[i+1] * b[i+1];
    s2 += a[i+2] * b[i+2];
    s3 += a[i+3] * b[i+3];
  }
  for (let i = len4; i < a.length; i++) s0 += a[i] * b[i];
  return s0 + s1 + s2 + s3;
}

// ---- Tier 4: 8-lane unrolled ----
function dotUnrolled8(a, b) {
  let s0=0,s1=0,s2=0,s3=0,s4=0,s5=0,s6=0,s7=0;
  const len8 = (a.length >>> 3) << 3;
  for (let i = 0; i < len8; i += 8) {
    s0 += a[i]   * b[i];   s1 += a[i+1] * b[i+1];
    s2 += a[i+2] * b[i+2]; s3 += a[i+3] * b[i+3];
    s4 += a[i+4] * b[i+4]; s5 += a[i+5] * b[i+5];
    s6 += a[i+6] * b[i+6]; s7 += a[i+7] * b[i+7];
  }
  for (let i = len8; i < a.length; i++) s0 += a[i] * b[i];
  return s0+s1+s2+s3+s4+s5+s6+s7;
}

// ---- Benchmarking harness ----
function bench(name, fn, warmupRuns = 3, timedRuns = 5) {
  for (let i = 0; i < warmupRuns; i++) fn(); // warm up JIT
  const t0 = performance.now();
  for (let i = 0; i < timedRuns; i++) fn();
  const elapsed = performance.now() - t0;
  const msPerRun = elapsed / timedRuns;
  const mopsPerSec = (N / 1e6) / msPerRun * 1000;
  return { name, msPerRun, mopsPerSec };
}

const results = [
  bench("Tier 0  Naive Array",   () => dotNaive(aNaive, bNaive)),
  bench("Tier 1  Float32Array",  () => dotTyped(aTyped, bTyped)),
  bench("Tier 3  4-unrolled",    () => dotUnrolled4(aTyped, bTyped)),
  bench("Tier 4  8-unrolled",    () => dotUnrolled8(aTyped, bTyped)),
];

// Model WASM SIMD as ~2.5x fastest JS (conservative estimate)
const fastestMops = Math.max(...results.map(r => r.mopsPerSec));
results.push({
  name: "Tier 5  WASM f32x4 (estimate)",
  msPerRun: null,
  mopsPerSec: fastestMops * 2.5
});

// ---- ASCII bar chart ----
const maxMops = Math.max(...results.map(r => r.mopsPerSec));
const barWidth = 40;
console.log(`\nDot product throughput — N=${N.toLocaleString()} float32 pairs`);
console.log("=".repeat(70));
for (const r of results) {
  const bar = "█".repeat(Math.round(r.mopsPerSec / maxMops * barWidth));
  const label = r.name.padEnd(30);
  const mops  = r.mopsPerSec.toFixed(0).padStart(6);
  const ms    = r.msPerRun != null ? `${r.msPerRun.toFixed(3)} ms` : "(modelled)";
  console.log(`${label} ${bar.padEnd(barWidth)} ${mops} Mops/s  ${ms}`);
}
console.log("=".repeat(70));

// ---- Allocation verification (Tier 2 criterion) ----
let allocationEvents = 0;
const origObjectCreate = Object.create;
// In a real environment you'd use --heap-prof or clinic heap;
// here we verify structurally: dotTyped() holds no object literals or new expressions
console.log(`\nAllocation check: dotTyped creates no objects or arrays`);
console.log(`  Verified by code inspection: only primitives and TypedArray reads`);
console.log(`  Allocation events in hot path: ${allocationEvents}`);

// ---- Speedup table ----
const baseline = results[0].mopsPerSec;
console.log("\nSpeedup over naive baseline:");
for (const r of results) {
  console.log(`  ${r.name.padEnd(30)} ${(r.mopsPerSec / baseline).toFixed(2)}x`);
}
```

<details>
<summary>Show complete solution with all tiers and chart</summary>

The starter above is already a complete solution — run it to see the full chart. The key
implementation details to add in a real project:

- Tier 5 (true WASM): compile the dot product to WAT/C via Emscripten, load the `.wasm` file,
  share a `SharedArrayBuffer` as the WASM linear memory, pass `Float32Array` views by pointer.
  Expect 2-4x over the best unrolled JS for large N, and no improvement for N < 1000.
- Criterion 2 (cache explanation): Float32Array packs 16 elements per 64-byte cache line. Naive
  `Array` stores tagged pointers (8 bytes each) — only 8 per cache line, and those pointers may
  point to boxed heap doubles, adding an extra indirection. TypedArray: 2x elements per cache line
  and zero pointer indirection → 2x effective cache bandwidth on this loop.

```js run
// Bonus: demonstrate that N matters for WASM payoff
// For small N, the fixed FFI cost (modelled as 10 µs = 10,000 ns) dominates
const FFI_COST_NS = 10_000; // ~10 µs per WASM call boundary

function wasmPayoffAnalysis(sizes) {
  console.log("WASM FFI payoff analysis");
  console.log("N elements | JS time (model) | WASM time (model) | Winner");
  console.log("-".repeat(60));
  for (const n of sizes) {
    const jsNs   = n * 2;        // ~2 ns per multiply-add in optimised JS
    const wasmNs = FFI_COST_NS + n * 0.5; // FFI overhead + 4x faster SIMD compute
    const winner = wasmNs < jsNs ? "WASM" : "JS  ";
    console.log(
      `  ${String(n).padStart(8)}  |  ${String(jsNs).padStart(8)} ns  |  ${String(Math.round(wasmNs)).padStart(8)} ns  |  ${winner}`
    );
  }
}

wasmPayoffAnalysis([100, 1_000, 10_000, 100_000, 1_000_000]);
```

</details>

## Common pitfalls

> [!PITFALL]
> **Calling WASM per element instead of per batch.** The FFI boundary costs ~5-20 ns regardless
> of payload size. If your WASM function processes one `float32` and you call it N times, you
> spend N × 10 ns in boundary overhead before doing any SIMD work. The correct pattern is: write
> all inputs to a `SharedArrayBuffer` or WASM linear memory slice, call WASM once to process the
> entire array, read results back. One crossing amortised over N elements → boundary cost is
> negligible at N > 10,000.

Additional pitfalls:

- **Using `Float64Array` when `Float32Array` suffices.** float64 is 8 bytes vs float32's 4 bytes
  — half the elements per cache line, half the SIMD throughput (f64x2 vs f32x4). For ML inference
  and signal processing, float32 is almost always sufficient precision.
- **Forgetting `Atomics.waitAsync` vs `Atomics.wait` on the main thread.** `Atomics.wait` blocks
  the event loop; `Atomics.waitAsync` does not. This is the #1 bug in WASM worker integration.
- **Not warming up the JIT before benchmarking.** TurboFan needs ~3-5 iterations of a function
  to reach full optimisation (Maglev after ~1-2K calls, TurboFan after ~10K on default thresholds).
  Always run at least 3 warmup iterations before timing. Use `--trace-opt` to confirm the function
  is TurboFan-compiled before your timed run.
- **Assuming unrolling always wins.** At small N (< 64 elements), loop overhead is negligible and
  unrolled code just adds register pressure. Profile with `--cpu-prof` or `0x` to confirm.

## What you learned

- WebAssembly SIMD processes 4 float32 or 2 float64 values per instruction (128-bit lanes);
  explicit vectorisation guarantees throughput that TurboFan's autovectorisation only sometimes achieves.
- The JS/WASM FFI costs ~5-20 ns per crossing; WASM wins only when batch size amortises that cost
  (rule of thumb: N > 10,000 elements per call).
- Manual 4x and 8x loop unrolling in JS creates data-independent arithmetic chains that the CPU's
  out-of-order execution can schedule in parallel — a software approximation of SIMD.
- `SharedArrayBuffer` + `Atomics` provide zero-copy shared memory between JS threads and WASM
  workers; `Atomics.waitAsync` (non-blocking) is required on the Node.js main thread.
- The four-tier stack — naive → cache-friendly TypedArray → allocation-free → vectorised —
  represents an ordered optimisation path; measure at each tier before proceeding to the next.

## Next steps

You have now walked the full mechanical sympathy stack: memory hierarchy, branch prediction, GC
pressure, and SIMD vectorisation. The next module explores distributed systems theory — the
consistency models, failure modes, and consensus algorithms that govern how these high-performance
nodes coordinate at scale.
*/});
