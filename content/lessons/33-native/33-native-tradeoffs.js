registerLessonSrc("33-native-tradeoffs", function () {/*
---
id: 33-native-tradeoffs
title: "Native vs Worker Threads vs WASM"
minutes: 28
level: advanced
objectives:
  - Apply a decision framework to choose between pure JS, Worker threads, WASM, and N-API
  - Articulate the build complexity, portability, and performance tradeoffs of each approach
  - Implement a decision scorer and pure-JS numeric baseline suitable for benchmarking
---

# Native vs Worker Threads vs WASM

## Why this matters

You now know *how* native addons and WebAssembly work. The harder skill is knowing *when* to use each. Reaching for N-API when Worker threads would suffice adds months of build complexity; choosing pure JS for a hot cryptographic inner loop leaves performance on the table. Senior engineers build a mental decision model — a set of weighted criteria they apply before writing a single line of C++ or WASM. This lesson gives you that model and shows you how to encode it as a runnable scorer.

## Learning objectives

- Apply a **decision framework** across four approaches: pure JS, Worker threads, WASM, N-API.
- Compare the approaches on six criteria: **performance ceiling, portability, build complexity, FFI overhead, debuggability, ecosystem fit**.
- Implement the framework as a **weighted decision scorer** in pure JS.
- Use a pure-JS numeric baseline as the starting point for a benchmark project.

## The four approaches

Before scoring, let's nail down what each approach actually is:

**Pure JS** — everything inside V8, no addons, no separate processes. V8's JIT is excellent; for I/O-bound work and most business logic, this is all you need.

**Worker threads** (`node:worker_threads`) — still JavaScript, but runs in a separate V8 isolate on a real OS thread. Parallelises CPU work without leaving the JS world. No native toolchain required.

**WebAssembly (WASM)** — a portable binary that runs inside Node's V8 sandbox. Compiled from C, C++, Rust, or AssemblyScript. Portable: same binary works on every platform/arch. Cannot directly call OS APIs without WASI.

**N-API native addon** — compiled C, C++, or Rust that loads directly into the Node process as a `.node` shared library. Maximum performance, direct OS and hardware access, but requires a native toolchain and produces platform-specific binaries.

## The decision framework

Six criteria, each scored 1–5 (5 = best for that criterion):

| Criterion | Pure JS | Workers | WASM | N-API |
|---|---|---|---|---|
| **Performance ceiling** | 2 | 3 | 4 | 5 |
| **Portability** | 5 | 5 | 5 | 2 |
| **Build complexity** | 5 | 5 | 3 | 1 |
| **FFI / marshalling overhead** | 5 | 2 | 3 | 3 |
| **Debuggability** | 5 | 4 | 2 | 2 |
| **Ecosystem fit** (npm, tooling) | 5 | 5 | 3 | 3 |

*Note: "FFI overhead" is the cost of crossing the boundary between JS and the execution environment. Workers pay serialisation overhead for `postMessage`; WASM and N-API pay data-marshalling overhead at the call boundary. Pure JS has none because everything is in the same heap.*

> [!PRINCIPAL] The benchmark that surprises most engineers
> Worker threads beat N-API on many real workloads. The reason: N-API addons must marshal data across the JS↔native boundary. Passing a million-element Float64Array to a C function requires pinning the buffer, crossing the call boundary, and potentially copying. A Worker thread can operate on a SharedArrayBuffer with zero copy. Measure before assuming N-API is always faster than Workers for array-heavy workloads.

## When to choose each approach

**Choose Pure JS when:**
- The bottleneck is I/O (database, network, file system) — JS is irrelevant to that wait.
- The CPU work is < 5ms per request — parallelism adds overhead that exceeds the gain.
- You need maximum debuggability and fast iteration.
- You want the simplest possible deployment artifact (a `.js` file, no compiled assets).

**Choose Worker threads when:**
- You have a CPU-bound task that can run in parallel with other requests.
- The data can be shared with `SharedArrayBuffer` or transferred with `Transferable` objects.
- You want parallelism without leaving the npm ecosystem or requiring a C++ toolchain.
- Examples: JSON parsing of very large payloads, image thumbnail generation in pure JS, compression.

**Choose WASM when:**
- You have a battle-tested C/C++/Rust library (SQLite, FFmpeg, zlib) you want to run sandboxed.
- Portability is non-negotiable (cross-platform, edge workers, multi-runtime).
- You need better performance than JS but accept slightly higher call overhead vs N-API.
- Examples: image codecs, cryptographic primitives, PDF rendering, language parsers.

**Choose N-API when:**
- You need maximum raw throughput and have confirmed WASM/Workers don't cut it.
- You need direct hardware access (CUDA, GPU, SIMD intrinsics, raw sockets).
- You're wrapping a library that itself uses OS primitives that WASI doesn't expose.
- Examples: database drivers (better-sqlite3), GPU compute, custom SIMD kernels.

> [!NOTE] The 80/20 rule of native addons in production
> Most Node services that reach for native acceleration get 80% of the benefit from Worker threads with 20% of the operational complexity. Reserve WASM for portability+performance, and N-API for the narrow cases where you genuinely need OS or hardware access. Verify with benchmarks before committing to the build machinery.

## FFI overhead: the hidden tax

Every approach except pure JS pays a **Foreign Function Interface (FFI) tax** when crossing the boundary between JS and the execution environment.

```
  JS call to N-API:
    JS engine → [napi_call_function] → native frame → back to JS
    + marshalling each argument (JS value → C type)
    + unmarshalling the return value

  JS to Worker:
    JS engine → [structured clone / transfer] → other V8 isolate
    + serialisation (or transfer of ownership for Transferable)

  JS to WASM:
    JS engine → [WASM call stub] → WASM frame
    + numeric marshalling (JS Number → i32/f64)
    + array data must be in linear memory already
```

For short functions called at very high frequency (e.g., `hash(key)` called a million times in a loop), the overhead per call can dominate. **Batch operations at the boundary**: instead of calling the addon once per element, pass the whole array in one call and let native code iterate.

```js
// naive — pays FFI cost N times:
for (const x of data) result += addon.square(x);

// better — pays FFI cost once:
result = addon.sumOfSquares(data);  // native code does the loop
```

> [!PITFALL] Micro-benchmarking the boundary in isolation
> Benchmarks that call `addon.add(1, 2)` in a tight loop and compare with `(a + b)` are measuring almost entirely FFI overhead, not algorithmic performance. The addon will look 10–100x *slower* than JS for this workload. Always benchmark the real operation at realistic batch sizes.

## Try it yourself

Let's encode the decision framework as a runnable weighted scorer. You supply weights for each criterion based on your project's priorities, and the scorer recommends an approach:

```js run
// Decision scorer for: Pure JS vs Worker threads vs WASM vs N-API
// Scores are 1-5 per criterion (5 = best fit).
// Weights reflect how important each criterion is to YOUR project (0 = ignored).

const APPROACHES = ["Pure JS", "Workers", "WASM", "N-API"];

// Base scores: [PureJS, Workers, WASM, NAPI]
const BASE_SCORES = {
  performance:   [2, 3, 4, 5],
  portability:   [5, 5, 5, 2],
  buildSimplicity: [5, 5, 3, 1],
  lowFFIOverhead:  [5, 2, 3, 3],
  debuggability: [5, 4, 2, 2],
  ecosystemFit:  [5, 5, 3, 3],
};

function score(weights) {
  const totals = APPROACHES.map(() => 0);

  for (const [criterion, w] of Object.entries(weights)) {
    const scores = BASE_SCORES[criterion];
    if (!scores) throw new Error("Unknown criterion: " + criterion);
    for (let i = 0; i < APPROACHES.length; i++) {
      totals[i] += scores[i] * w;
    }
  }

  const ranked = APPROACHES
    .map((name, i) => ({ name, total: totals[i] }))
    .sort((a, b) => b.total - a.total);

  return ranked;
}

function recommend(projectDescription, weights) {
  console.log("Project:", projectDescription);
  const ranked = score(weights);
  ranked.forEach((r, i) => {
    const bar = "#".repeat(Math.round(r.total / 2));
    console.log((i === 0 ? ">> " : "   ") + r.name.padEnd(10) + r.total.toFixed(1) + "  " + bar);
  });
  console.log("Recommendation:", ranked[0].name);
  console.log();
}

// Scenario 1: "High-throughput image codec, must run on edge workers"
recommend("Image codec on edge", {
  performance:    4,
  portability:    5,
  buildSimplicity: 2,
  lowFFIOverhead:  2,
  debuggability:  1,
  ecosystemFit:   2,
});

// Scenario 2: "CPU-intensive JSON aggregation in an API service"
recommend("CPU-intensive JSON aggregation", {
  performance:    3,
  portability:    5,
  buildSimplicity: 5,
  lowFFIOverhead:  4,
  debuggability:  4,
  ecosystemFit:   5,
});

// Scenario 3: "Custom SIMD kernel for ML inference, Linux only"
recommend("Custom SIMD ML kernel", {
  performance:    5,
  portability:    1,
  buildSimplicity: 1,
  lowFFIOverhead:  3,
  debuggability:  2,
  ecosystemFit:   2,
});
```

## Project

**Build a small N-API addon (or WASM module) for a hot numeric routine and benchmark it against pure JS.**

Implement the same algorithm — sum of squares over a large Float64 array — in pure JavaScript, in a Worker thread (using SharedArrayBuffer), and ideally in an N-API addon or WASM module. Measure throughput at multiple array sizes and produce a comparison table.

### Acceptance criteria

1. **Pure-JS baseline** — implement `sumOfSquares(data: Float64Array): number` with a simple for-loop. This is the baseline every other approach must beat to be worth its complexity.
2. **Worker-thread variant** — send the array via `SharedArrayBuffer` to a Worker; the Worker computes the sum and `Atomics.store`s the result into a shared result buffer. Measure round-trip time including message passing.
3. **WASM or N-API variant** — compile the same routine to WASM (AssemblyScript or Rust) or wrap it in an N-API addon (C++ or napi-rs). Call it from the main thread with the full array.
4. **Benchmark harness** — run each variant 100 times at each of three array sizes: 1 000, 100 000, and 1 000 000 elements. Report mean time in microseconds and throughput in elements/second.
5. **Comparison table** — print a Markdown-formatted table: approach × array-size × mean-µs × throughput.
6. **Decision output** — after the table, print which approach "won" at each array size and briefly explain why (e.g., "FFI overhead dominates at N=1 000; Workers win at N=1 000 000 due to zero-copy SharedArrayBuffer").

### Starter — pure-JS baseline (runnable)

This block is a complete, runnable pure-JS implementation of the baseline and mini-benchmarking harness. It is the core you'll extend in the full project:

```js run
// Pure-JS baseline for the native benchmark project.
// This is Acceptance Criterion 1 — runnable as-is.

function sumOfSquares(data) {
  let acc = 0.0;
  for (let i = 0; i < data.length; i++) {
    acc += data[i] * data[i];
  }
  return acc;
}

// Kahan-compensated version (reduced floating-point error for large N)
function sumOfSquaresKahan(data) {
  let sum = 0.0, comp = 0.0;
  for (let i = 0; i < data.length; i++) {
    const term = data[i] * data[i] - comp;
    const temp = sum + term;
    comp = (temp - sum) - term;
    sum = temp;
  }
  return sum;
}

function bench(label, fn, data, reps) {
  // Warmup
  for (let i = 0; i < 5; i++) fn(data);
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn(data);
  const elapsed = performance.now() - t0;
  const meanUs = (elapsed / reps) * 1000;
  const throughput = Math.round(data.length / (meanUs / 1e6));
  console.log(
    label.padEnd(28) +
    "N=" + String(data.length).padStart(7) +
    "  mean=" + meanUs.toFixed(1).padStart(7) + " µs" +
    "  " + (throughput / 1e6).toFixed(0) + "M elem/s"
  );
  return meanUs;
}

// Generate test arrays at three sizes
const SIZES = [1_000, 100_000, 500_000];
const arrays = SIZES.map(n => {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = (i % 256) / 255.0;
  return a;
});

console.log("=== Pure-JS Sum-of-Squares Baseline ===");
console.log();

for (const arr of arrays) {
  bench("naive for-loop     ", sumOfSquares, arr, 50);
  bench("Kahan compensated  ", sumOfSquaresKahan, arr, 50);
  console.log();
}

// Verify correctness: 1^2 + 2^2 + ... + 4^2 = 30
const test = new Float64Array([1, 2, 3, 4]);
console.log("Correctness check (expect 30):", sumOfSquares(test));
console.log("Kahan check      (expect 30):", sumOfSquaresKahan(test));

console.log();
console.log("Next steps for the full project:");
console.log("  1. Port sumOfSquares to AssemblyScript or Rust -> .wasm");
console.log("  2. Wrap in an N-API addon with node-addon-api");
console.log("  3. Add Worker-thread variant using SharedArrayBuffer");
console.log("  4. Replace 'performance.now' bench with a real CLI harness");
console.log("  5. Collect results and print the comparison table");
```

## Common pitfalls

> [!PITFALL] Choosing N-API because it "sounds faster" without measuring
> Many teams have added a C++ native addon, endured weeks of build-system pain, and discovered the speedup was negligible because the bottleneck was marshalling data across the boundary, not the computation itself. Always profile the pure-JS version first; if it's within 2–3x of what you need, Workers or WASM will likely close the gap with far less complexity.

> [!PITFALL] Ignoring cold-start in serverless / edge environments
> Loading a `.node` binary involves `dlopen` and native module initialisation. In a cold-started Lambda or edge worker this adds noticeable latency (10–50ms). WASM modules instantiate in the same V8 process and have a much lower cold-start cost. Factor startup time into your benchmarks if your service experiences cold starts.

## What you learned

- The **four approaches** — Pure JS, Worker threads, WASM, N-API — sit on a spectrum of complexity vs performance, and the right choice depends on your specific criteria.
- A **weighted decision scorer** operationalises the tradeoffs and removes gut-feel bias from architecture decisions.
- **FFI overhead** is the hidden cost of crossing the JS↔native boundary; batch calls and use `SharedArrayBuffer` to minimise it.
- **Worker threads** often outperform N-API addons for array-heavy workloads because `SharedArrayBuffer` transfer is zero-copy.
- **WASM** is the right choice when you need both portability and performance without OS-level access.
- The **pure-JS baseline** is always the first implementation — it gives you correctness, debuggability, and a performance floor to justify added complexity.

## Next steps

With Module 33 complete, you understand the full spectrum of performance escape hatches in Node. The next module — **Observability** — shows you how to instrument whichever approach you chose so you can prove, in production, that it's actually delivering the performance gains you designed for.
*/});
