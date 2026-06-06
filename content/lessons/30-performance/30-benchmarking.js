registerLessonSrc("30-benchmarking", function () {/*
---
id: 30-benchmarking
title: "Benchmarking with tinybench & mitata"
minutes: 24
level: advanced
objectives:
  - Explain why naive benchmarks produce misleading results and how to avoid the traps
  - Write statistically rigorous micro-benchmarks with tinybench and mitata
  - Interpret ops/sec, mean, median, and variance to make confident optimisation decisions
---

# Benchmarking with tinybench & mitata

## Why this matters

You found a hot path in the flamegraph. You have two candidate implementations. Which is faster — and by how much? Without rigorous benchmarking you are guessing. The difference between a careful benchmark and a naive one can be a factor of 10x or more in the *reported* number, even when the underlying code is identical. Getting benchmarking right is the difference between shipping a real improvement and confidently shipping a regression.

## Learning objectives

- Understand how **JIT warm-up**, **dead-code elimination**, and **measurement noise** sabotage naive benchmarks.
- Write correct benchmarks with **tinybench** and **mitata**, two modern zero-dependency tools.
- Read benchmark output: **ops/sec**, **mean**, **median**, **standard deviation**, and what each tells you.
- Use `perf_hooks.performance.now()` for high-resolution timing in Node.

## Why naive benchmarks lie

### The JIT warm-up trap

V8 interprets JavaScript initially, then monitors hot code and compiles it to optimised machine code (the "JIT", just-in-time compiler). A loop that runs 3 times is interpreted. The same loop run 10,000 times gets compiled to highly optimised native code. If you time only the first few iterations, you're measuring the interpreter — not what your users will experience.

```js
// Naive benchmark — do NOT do this:
const start = Date.now();
for (let i = 0; i < 10; i++) {
  heavyFn(i);
}
const elapsed = Date.now() - start;
console.log('total ms:', elapsed);
// This measures mostly warm-up, not steady-state performance.
```

The fix: run a **warm-up phase** (throw away results), then measure the **steady-state** phase.

### Dead-code elimination

V8 can detect when a computation's result is never used and simply delete the computation. If your benchmark calculates something but throws the result away, the JIT may eliminate the entire hot loop and report zero overhead — not the function's real cost.

```js
// BAD: V8 may eliminate this loop entirely
function bench() {
  let start = performance.now();
  for (let i = 0; i < 1e6; i++) {
    JSON.parse('{"x":1}'); // result discarded — compiler can elide this
  }
  return performance.now() - start;
}
```

The fix: **consume** the result — assign it to a variable and use it (e.g. accumulate a sum, or use the result as a return value that a benchmarking framework captures).

### Clock resolution and noise

`Date.now()` has millisecond resolution on most platforms. For functions that run in microseconds, you need `performance.now()` which has sub-millisecond precision. Even then, OS scheduling jitter, garbage collection pauses, and CPU frequency scaling add noise. A proper harness runs many iterations and reports **statistical summaries** — not a single timing.

```js
// High-resolution timing in Node.js:
import { performance } from 'node:perf_hooks';

const t0 = performance.now();
// ... work ...
const elapsed = performance.now() - t0; // fractional milliseconds
```

> [!NOTE] perf_hooks vs globalThis.performance
> In modern Node 24, `globalThis.performance` is available (Web Compatibility API). For consistency with browser code you can use it directly. The `node:perf_hooks` import gives you additional Node-specific APIs (PerformanceObserver, marks, measures) on top of the base timer.

## tinybench

[tinybench](https://github.com/tinylibs/tinybench) is a tiny (no runtime dependencies), promise-based benchmarking library used internally by Vite. It handles warm-up, statistical collection, and formatting:

```js
import { Bench } from 'tinybench';

const bench = new Bench({ time: 1000 }); // run each task for 1000 ms

bench
  .add('JSON.stringify', () => {
    JSON.stringify({ id: 1, name: 'Ada', tags: ['a', 'b'] });
  })
  .add('manual concat', () => {
    const o = { id: 1, name: 'Ada', tags: ['a', 'b'] };
    '{"id":' + o.id + ',"name":"' + o.name + '"}';
  });

await bench.warmup(); // runs each task briefly without recording
await bench.run();

console.table(bench.table());
```

> [!OUTPUT]
> ┌─────────────────┬───────────┬────────────┬──────────┬──────────┬──────────┐
> │    Task Name    │  ops/sec  │ avg (ns)   │ med (ns) │ p75 (ns) │ p99 (ns) │
> ├─────────────────┼───────────┼────────────┼──────────┼──────────┼──────────┤
> │ JSON.stringify  │ 5,234,012 │    191.06  │  188.00  │  195.00  │  231.00  │
> │ manual concat   │ 9,881,432 │    101.20  │   99.00  │  104.00  │  128.00  │
> └─────────────────┴───────────┴────────────┴──────────┴──────────┴──────────┘

Key columns:
- **ops/sec**: operations per second — more is faster.
- **avg (ns)**: mean nanoseconds per operation.
- **med (ns)**: median nanoseconds — more robust to outliers than the mean.
- **p75 / p99**: 75th and 99th percentile latencies — if p99 is 10× the median, you have outliers (GC pauses, cache misses).

> [!PRINCIPAL] Mean vs median in benchmarks
> Always look at the **median** and the **spread** (p75, p99, or std dev), not just the mean. A function that takes 100 µs 99% of the time but 10 ms 1% of the time has a fine mean — but terrible p99 latency that users will notice. In production systems the tail matters more than the average.

## mitata

[mitata](https://github.com/nicolo-ribaudo/mitata) offers a more ergonomic API and richer histogram output, and it is compatible with Bun, Deno, and Node:

```js
import { bench, run, group, baseline } from 'mitata';

group('serialization', () => {
  baseline('JSON.stringify', () => JSON.stringify({ x: 1, y: 2 }));
  bench('custom serialize', () => `{"x":${1},"y":${2}}`);
});

await run();
```

> [!OUTPUT]
> cpu: Apple M2
> runtime: node v24.0.0
>
> benchmark                   time (avg)        iter/s
> -------------------------------------------------------
> • serialization
> JSON.stringify               198 ns/iter   5,050,505
> custom serialize              88 ns/iter  11,363,636
>
> summary
>   custom serialize is 2.25x faster than JSON.stringify

mitata reports a **summary** ratio automatically (e.g. "2.25x faster than baseline"), which is far more meaningful than comparing raw numbers by eye.

> [!WARNING] Micro-benchmark results do not always transfer to macro performance
> A function that is 2x faster in isolation may produce only a 2% improvement in your real application if it accounts for only 1% of total CPU time (Amdahl's Law). Always measure the system-level impact after applying the optimisation. Micro-benchmarks answer "which is faster?"; profiling answers "does it matter?".

## Statistical rigor checklist

Before trusting a benchmark result:

1. **Warm-up ran?** At least 100 ms, ideally 500 ms+.
2. **Enough iterations?** The time budget should be long enough to collect ≥1000 samples.
3. **Result consumed?** The return value is used or accumulated (black-box the compiler).
4. **Variance acceptable?** Std dev < 10% of the mean is a sign of a stable measurement; > 20% means too much noise.
5. **Same environment?** Run benchmarks on a quiet machine, ideally with power saving off (`cpufreq-set -g performance` on Linux). Never benchmark on a CI runner that shares CPUs.
6. **Compared fairly?** Both implementations must do equivalent work — same input, same correctness guarantees.

## Try it yourself

The runnable below is a **self-contained micro-benchmark harness** in pure JS. It implements warm-up, collects timings over N iterations, and reports mean, median, and ops/sec — the same ideas tinybench and mitata use under the hood.

```js run
// A portable micro-benchmark harness — pure JS, browser-safe.
// Uses performance.now() (available in Web Workers).

function runBench(name, fn, { warmupMs = 100, runMs = 400 } = {}) {
  // Warm-up phase — let the JIT compile the function
  const warmupEnd = performance.now() + warmupMs;
  while (performance.now() < warmupEnd) fn();

  // Measurement phase
  const samples = [];
  const runEnd = performance.now() + runMs;
  while (performance.now() < runEnd) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }

  // Stats
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)];
  const opsPerSec = Math.round(1000 / mean);

  console.log(`\n[${name}]`);
  console.log(`  samples : ${samples.length}`);
  console.log(`  mean    : ${mean.toFixed(4)} ms`);
  console.log(`  median  : ${median.toFixed(4)} ms`);
  console.log(`  ops/sec : ${opsPerSec.toLocaleString()}`);
}

// --- Compare two ways to build a string ---

// Candidate A: Array join
function joinApproach() {
  const parts = [];
  for (let i = 0; i < 50; i++) parts.push(`item-${i}`);
  return parts.join(', ');
}

// Candidate B: string concatenation
function concatApproach() {
  let s = '';
  for (let i = 0; i < 50; i++) {
    if (i > 0) s += ', ';
    s += `item-${i}`;
  }
  return s;
}

runBench('Array join', joinApproach);
runBench('String concat', concatApproach);

console.log('\nNote: results vary by JS engine and CPU load.');
```

## Exercises

**Exercise 1:** Extend the harness to also compute and display the **standard deviation**. Then add a "noise warning" that prints a message if std dev is more than 15% of the mean.

<details>
<summary>Show solution</summary>

```js run
function stdDev(samples, mean) {
  const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance);
}

function runBench(name, fn, { warmupMs = 80, runMs = 300 } = {}) {
  const warmupEnd = performance.now() + warmupMs;
  while (performance.now() < warmupEnd) fn();

  const samples = [];
  const runEnd = performance.now() + runMs;
  while (performance.now() < runEnd) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }

  samples.sort((a, b) => a - b);
  const mean   = samples.reduce((s, x) => s + x, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)];
  const sd     = stdDev(samples, mean);
  const opsPerSec = Math.round(1000 / mean);
  const noisy = sd / mean > 0.15;

  console.log(`\n[${name}]`);
  console.log(`  samples : ${samples.length}`);
  console.log(`  mean    : ${mean.toFixed(4)} ms`);
  console.log(`  median  : ${median.toFixed(4)} ms`);
  console.log(`  std dev : ${sd.toFixed(4)} ms  (${((sd / mean) * 100).toFixed(1)}%)`);
  console.log(`  ops/sec : ${opsPerSec.toLocaleString()}`);
  if (noisy) console.log('  ⚠ high variance — results may be unreliable');
}

function slowFib(n) {
  if (n <= 1) return n;
  return slowFib(n - 1) + slowFib(n - 2);
}
function fastFib(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; }
  return a;
}

runBench('recursive fib(20)', () => slowFib(20));
runBench('iterative fib(20)', () => fastFib(20));
```

</details>

**Exercise 2:** Add a `compare(nameA, fnA, nameB, fnB)` helper that runs both benchmarks and prints a ratio summary ("fnB is X.Xx faster than fnA"), similar to mitata's output.

<details>
<summary>Show solution</summary>

```js run
function measure(fn, { warmupMs = 80, runMs = 300 } = {}) {
  const end0 = performance.now() + warmupMs;
  while (performance.now() < end0) fn();
  const samples = [];
  const end1 = performance.now() + runMs;
  while (performance.now() < end1) {
    const t0 = performance.now(); fn(); samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return { mean, median: samples[Math.floor(samples.length / 2)], samples: samples.length };
}

function compare(nameA, fnA, nameB, fnB) {
  const a = measure(fnA);
  const b = measure(fnB);
  console.log(`\n${nameA}: ${a.mean.toFixed(4)} ms mean  (${a.samples} samples)`);
  console.log(`${nameB}: ${b.mean.toFixed(4)} ms mean  (${b.samples} samples)`);
  if (b.mean < a.mean) {
    console.log(`\nsummary: ${nameB} is ${(a.mean / b.mean).toFixed(2)}x faster than ${nameA}`);
  } else {
    console.log(`\nsummary: ${nameA} is ${(b.mean / a.mean).toFixed(2)}x faster than ${nameB}`);
  }
}

compare(
  'Object.assign({}, o)',
  () => Object.assign({}, { a: 1, b: 2, c: 3 }),
  'spread { ...o }',
  () => ({ ...{ a: 1, b: 2, c: 3 } })
);
```

</details>

## Common pitfalls

> [!PITFALL] Benchmarking with NODE_ENV=development or source maps on
> Many frameworks (React, Express plugins, TypeScript loaders) add significant overhead in development mode. Benchmark with `NODE_ENV=production` and compiled output — the same artefact that runs in production. A 3x performance difference that disappears in production is noise, not signal.

Never benchmark across a network or disk I/O in a micro-benchmark harness — those timings are dominated by external latency, not your code. Isolate the CPU-bound computation, mock I/O, then use an integration load test (autocannon, k6) to measure the full stack.

## What you learned

- V8's JIT compiler and dead-code elimination can make naive benchmarks wildly misleading — always warm up and consume results.
- `performance.now()` gives sub-millisecond resolution; `Date.now()` does not.
- **tinybench** and **mitata** provide warm-up, statistical collection, and human-readable summaries out of the box.
- Read **median** and **p99**, not just the mean; high spread means noisy or inconsistent results.
- Micro-benchmarks answer "which is faster in isolation?" — always follow up with system-level profiling to confirm the improvement matters at scale.

## Next steps

Now that you can profile where time goes and measure improvements precisely, the final piece is *observability at runtime*: tracing individual requests through your system using `diagnostics_channel` and `async_hooks`, so you can see not just which functions are hot but which *request paths* cause them to be hot.
*/});
