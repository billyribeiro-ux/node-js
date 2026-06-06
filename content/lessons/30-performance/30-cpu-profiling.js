registerLessonSrc("30-cpu-profiling", function () {/*
---
id: 30-cpu-profiling
title: "CPU Profiling & Flamegraphs (clinic, 0x)"
minutes: 26
level: principal
objectives:
  - Use Node's built-in CPU profiler flags and Chrome DevTools to capture a profile
  - Generate flamegraphs with clinic.js and 0x and read them correctly
  - Identify hot paths and apply the measure-first methodology
---

# CPU Profiling & Flamegraphs (clinic, 0x)

## Why this matters

Every senior engineer has been burned by optimising the wrong thing. You rewrite a loop, save 5 µs, and the real bottleneck — a JSON.stringify call 3 frames up the call stack — keeps your p99 latency at 800 ms. The only reliable way to know *where* time is actually going is to measure first, using a CPU profiler. Flamegraphs turn raw profile data into a visual where the answer often jumps off the screen.

## Learning objectives

- Capture a CPU profile with `--cpu-prof`, `--prof`, and Chrome DevTools.
- Generate flamegraphs with **clinic.js** (`clinic flame`) and **0x**.
- Read a flamegraph: understand what width, height, and colour mean.
- Find hot paths — and resist optimising until you've measured.

## The measure-first methodology

Before profiling, commit this mantra: **measure, identify, change one thing, measure again**. Intuition about performance is notoriously unreliable, even among experts. A profiler is the instrument that tells you where CPU time is actually spent — not where you *think* it is.

The workflow is:

1. Reproduce the workload (replay production traffic, run a benchmark, drive load with `autocannon` or `k6`).
2. Capture a profile *while the workload runs*.
3. Identify the widest frames in the flamegraph — those are your hot paths.
4. Change exactly one thing.
5. Profile again and confirm improvement.

Skipping step 5 is the most common senior mistake.

## Node's built-in profiling flags

### --cpu-prof (V8 CPU profiler)

The simplest entry point — no extra tools needed:

```bash
node --cpu-prof --cpu-prof-interval=100 server.js
```

When the process exits, Node writes a `.cpuprofile` file to the current directory. Open it in Chrome DevTools: navigate to `chrome://inspect`, open the **Profiler** tab, then **Load** the file. You'll see a flame chart and a "Bottom-Up" table sorted by self-time.

> [!NOTE] --cpu-prof-interval
> The default sampling interval is 1000 µs (1 ms). Lowering it (e.g. `100`) gives finer resolution but adds overhead. For production-style profiling, 1 ms is usually fine.

### --prof (V8 tick profiler)

The older, lower-level flag produces a `isolate-XXXX-v8.log` file:

```bash
node --prof server.js
# then post-process with:
node --prof-process isolate-*.log > profile.txt
```

The text output shows percentages for ticks in each function. Less visual than a flamegraph, but still useful for quick command-line analysis.

> [!OUTPUT]
>  [Bottom up (heavy) profile]:
>   ticks  parent  name
>   2342   58.3%  JSON.stringify (anonymous)
>    987   24.6%  serialize
>    234    5.8%  formatResponse

### Chrome DevTools CPU profiling

For interactive profiling against a running process:

```bash
node --inspect server.js
```

Then open `chrome://inspect` in Chrome, click **inspect** on your Node target, and use the **Performance** tab. Hit Record, drive some load, stop — you get an interactive flame chart right in the browser.

```js
// server.js — an example slow server to profile:
import http from 'node:http';

function expensiveSerialize(data) {
  // Simulate deep serialization work
  return JSON.stringify(data, null, 2);
}

const BIG = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item-${i}` }));

http.createServer((req, res) => {
  const body = expensiveSerialize(BIG);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}).listen(3000);
```

> [!OUTPUT]
> Profiling server listening on :3000
> [after load test: profile written to isolate-0x...v8.log]

## clinic.js and 0x flamegraphs

### clinic flame

[clinic.js](https://clinicjs.org) wraps your app, drives it, and produces beautiful interactive SVG flamegraphs:

```bash
npm install -g clinic
clinic flame -- node server.js
```

Under the hood, clinic uses `perf_events` (Linux) or `--cpu-prof` to sample the call stack at high frequency, then renders each unique call stack as a rectangle. The wider a frame, the more total CPU time that function (and its callees) consumed.

```bash
# Typical clinic workflow:
clinic flame -- node server.js &
autocannon -c 100 -d 10 http://localhost:3000
# clinic automatically opens the flamegraph in your browser
```

> [!OUTPUT]
> Analysing data
> Generated: clinic-flame/100000.html
> Opened in browser

### 0x

`0x` is a focused, zero-dependency flamegraph tool:

```bash
npm install -g 0x
0x -o server.js
# drives with the default http request, or you provide load externally
```

0x produces a self-contained HTML file with an interactive SVG flamegraph. It can also integrate with `autocannon`:

```bash
0x -- node server.js
# in another terminal:
autocannon http://localhost:3000
# Ctrl-C the 0x process — flamegraph is written
```

> [!PRINCIPAL] clinic vs 0x vs --cpu-prof: choosing the right tool
> Use `--cpu-prof` + Chrome DevTools when you want zero extra dependencies and a production-safe approach (you can enable it on a replica). Use `0x` for a local deep-dive — it adds DTrace/perf overhead, so never in production. Use `clinic flame` when you want the richest analysis: clinic can also detect event-loop blockage (`clinic doctor`) and I/O bottlenecks (`clinic bubbles`). For pre-production performance gates, `0x` in CI is common because its output is a single HTML file easy to archive as an artifact.

## Reading a flamegraph

A flamegraph is a stack-trace histogram, not a call sequence. The axes are:

- **X-axis (width):** Proportion of total CPU samples that included this frame — wider = hotter. This is what matters for finding bottlenecks.
- **Y-axis (height):** Stack depth. Frames at the bottom are callers; frames at the top are the innermost functions being sampled.
- **Colour:** Usually random or indicates the type of code (V8 built-ins, Node internals, user code). Colour does *not* indicate heat — width does.

### Finding hot paths

Look for wide plateaus at the top of the flame (frames with wide self-time — their callees are narrow or absent). Those are the functions where CPU time is actually *consumed*, not merely passed through.

```
┌─────────────────── JSON.stringify ──────────────────────┐  <-- 58% of CPU
│  ┌────── serialize ──────┐  ┌── formatResponse ─────┐  │
│  │ ┌─ toJSON ─┐          │  │  ┌── pick ─┐          │  │
│  │ │          │          │  │  │         │          │  │
└──┴─┴──────────┴──────────┴──┴──┴─────────┴──────────┴──┘
```

In the diagram above, `JSON.stringify` is the hottest frame. You'd look for ways to avoid it (caching serialized output, using a faster serializer like `fast-json-stringify`, or reducing payload size).

> [!PITFALL] Optimising callers when the callee is the problem
> A wide *middle* frame means the function is hot because of what it *calls*, not what it does itself. Optimise the callee (the wide frames at the top), not the caller. Spending time rewriting `formatResponse` when 90% of its cost is `JSON.stringify` inside it is a classic waste.

## Try it yourself

The runnable below implements a tiny **sampling profiler** in pure JavaScript. Every `sampleInterval` ms it records which "function" is conceptually running (simulated with an active task label), then reports a flat profile — the same idea behind V8's tick profiler, without the native layer.

```js run
// A tiny sampling profiler — pure JS, browser-safe.
// Simulates the core idea of a sampling/statistical profiler.

function createSamplingProfiler(sampleIntervalMs = 10) {
  const counts = new Map();
  let currentFn = null;
  let intervalId = null;
  let totalSamples = 0;

  function sample() {
    if (currentFn !== null) {
      counts.set(currentFn, (counts.get(currentFn) || 0) + 1);
      totalSamples++;
    }
  }

  return {
    start() {
      intervalId = setInterval(sample, sampleIntervalMs);
    },
    stop() {
      clearInterval(intervalId);
    },
    // Call this before entering a function, restore on exit
    enter(name) { currentFn = name; },
    exit()      { currentFn = null; },
    report() {
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`\nFlat profile (${totalSamples} samples):`);
      console.log('Function'.padEnd(20) + 'Samples'.padEnd(10) + 'Self %');
      console.log('-'.repeat(40));
      for (const [name, n] of sorted) {
        const pct = ((n / totalSamples) * 100).toFixed(1);
        console.log(name.padEnd(20) + String(n).padEnd(10) + pct + '%');
      }
    }
  };
}

// --- Simulate a workload ---
const profiler = createSamplingProfiler(5);
profiler.start();

// Simulate "serialize" being slow
function simulateSerialize(end) {
  profiler.enter('serialize');
  const deadline = Date.now() + 80;
  while (Date.now() < deadline) {
    // busy-wait to represent CPU work
  }
  profiler.exit();
}

// Simulate "computeHash" being cheaper
function simulateHash(end) {
  profiler.enter('computeHash');
  const deadline = Date.now() + 20;
  while (Date.now() < deadline) {}
  profiler.exit();
}

// Simulate "readCache" being very fast
function simulateReadCache() {
  profiler.enter('readCache');
  const deadline = Date.now() + 5;
  while (Date.now() < deadline) {}
  profiler.exit();
}

simulateReadCache();
simulateSerialize();
simulateHash();
simulateSerialize();
simulateReadCache();

profiler.stop();
profiler.report();
```

## Exercises

**Exercise 1:** Extend the profiler above to also track **call counts** (how many times each function was entered) and report it alongside sample counts. A function called 1000 times with few samples is a different problem than one called 5 times with many samples.

<details>
<summary>Show solution</summary>

```js run
function createProfiler(intervalMs = 5) {
  const samples = new Map();
  const calls   = new Map();
  let current = null;
  let id = null;
  let total = 0;

  return {
    start() { id = setInterval(() => { if (current) { samples.set(current, (samples.get(current) || 0) + 1); total++; } }, intervalMs); },
    stop()  { clearInterval(id); },
    enter(name) {
      current = name;
      calls.set(name, (calls.get(name) || 0) + 1);
    },
    exit() { current = null; },
    report() {
      const fns = [...new Set([...samples.keys(), ...calls.keys()])];
      fns.sort((a, b) => (samples.get(b) || 0) - (samples.get(a) || 0));
      console.log('Function'.padEnd(18) + 'Calls'.padEnd(8) + 'Samples'.padEnd(10) + 'Self%');
      console.log('-'.repeat(44));
      for (const f of fns) {
        const s = samples.get(f) || 0;
        const c = calls.get(f)   || 0;
        const pct = total ? ((s / total) * 100).toFixed(1) : '0.0';
        console.log(f.padEnd(18) + String(c).padEnd(8) + String(s).padEnd(10) + pct + '%');
      }
    }
  };
}

const p = createProfiler(5);
p.start();

function heavy() {
  p.enter('heavy');
  const t = Date.now() + 60; while (Date.now() < t) {}
  p.exit();
}
function light() {
  p.enter('light');
  const t = Date.now() + 5; while (Date.now() < t) {}
  p.exit();
}

heavy(); light(); light(); heavy(); light(); light(); light();
p.stop();
p.report();
```

</details>

**Exercise 2:** Add a "call tree" to the profiler so that entering `outer` then `inner` records `outer > inner` as a unique path. Print the top 3 paths by sample count. (Hint: represent the current stack as a string key.)

<details>
<summary>Show solution</summary>

```js run
function createTreeProfiler(intervalMs = 5) {
  const pathCounts = new Map();
  const stack = [];
  let id = null;
  let total = 0;

  function currentPath() { return stack.join(' > ') || '(idle)'; }

  return {
    start() {
      id = setInterval(() => {
        const p = currentPath();
        pathCounts.set(p, (pathCounts.get(p) || 0) + 1);
        total++;
      }, intervalMs);
    },
    stop()  { clearInterval(id); },
    enter(name) { stack.push(name); },
    exit()      { stack.pop(); },
    report() {
      const sorted = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      console.log(`Top paths (${total} samples):`);
      for (const [path, n] of sorted) {
        console.log(`  ${((n / total) * 100).toFixed(1)}%  ${path}`);
      }
    }
  };
}

const p = createTreeProfiler(5);
p.start();

function outer() {
  p.enter('outer');
  inner();
  p.exit();
}
function inner() {
  p.enter('inner');
  const t = Date.now() + 50; while (Date.now() < t) {}
  p.exit();
}
function standalone() {
  p.enter('standalone');
  const t = Date.now() + 20; while (Date.now() < t) {}
  p.exit();
}

outer(); standalone(); outer(); outer();
p.stop();
p.report();
```

</details>

## Common pitfalls

> [!PITFALL] Profiling in development mode, then deploying to production
> Development builds often lack minification, include extra assertions, or disable V8 optimisations. Always profile with the same Node version, the same `NODE_ENV`, and the same build artefacts that run in production. A flamegraph taken from `NODE_ENV=development` can show completely different hot paths from production.

Another common trap: profiling under insufficient load. If you profile with a single serial request, the flamegraph shows your framework's routing overhead — not your application's real bottleneck. Always drive realistic concurrency. Use `autocannon -c 50` rather than `curl` as your load driver.

## What you learned

- `--cpu-prof` produces a `.cpuprofile` file loadable in Chrome DevTools; `--prof` produces a V8 tick log for text-mode analysis.
- `clinic flame` and `0x` generate interactive flamegraph HTML files with richer visualisation.
- Flamegraph **width = CPU time**; height = stack depth; colour does not indicate heat.
- Wide frames at the top of the flame (large self-time) are the actual bottlenecks — not their callers.
- The golden rule: **measure first**, change one thing, measure again.

## Next steps

Now that you can find *where* CPU time goes, the next skill is rigorous *quantification* — knowing whether a change improved things by 5% or 50%, with statistical confidence. That's what micro-benchmarking tools like tinybench and mitata provide.
*/});
