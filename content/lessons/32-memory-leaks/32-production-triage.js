registerLessonSrc("32-production-triage", function () {/*
---
id: 32-production-triage
title: "Production Leak Triage Methodology"
minutes: 28
level: advanced
objectives:
  - Detect memory leaks early using process.memoryUsage() and trend analysis
  - Execute a structured triage runbook to isolate and confirm a leak in production
  - Capture heap snapshots safely under load and verify a fix is working
---

# Production Leak Triage Methodology

## Why this matters

A memory leak in production does not announce itself. It shows up as a slowly rising RSS graph in
your metrics dashboard, a weekly restart ticket, or a 3 AM page because the OOM killer finally
acted. By the time an incident is declared, engineers are under pressure, the process may have
already restarted and destroyed its evidence, and the team is guessing. A practised triage runbook
changes that: you know exactly what to measure, when to capture a snapshot, and how to confirm that
your fix actually worked — before you declare the incident closed.

## Learning objectives

- Read `process.memoryUsage()` and understand each field.
- Detect a leak early by tracking a monotonically increasing trend in `heapUsed`.
- Follow a step-by-step runbook from suspicion to confirmed fix.
- Capture heap snapshots safely on a production instance without impacting users.

## Reading process.memoryUsage()

Node exposes a synchronous, low-overhead call that returns the process's current memory figures:

```js
import { memoryUsage } from "node:process";

const mu = memoryUsage();
console.log(mu);
```

> [!OUTPUT]
> {
>   rss: 62914560,
>   heapTotal: 31457280,
>   heapUsed: 18874368,
>   external: 1048576,
>   arrayBuffers: 204800
> }

| Field | Meaning |
|---|---|
| `rss` | Resident Set Size — total bytes held in RAM by the process (heap + stack + native) |
| `heapTotal` | Bytes V8 has committed for the JavaScript heap |
| `heapUsed` | Bytes of heap actually in use by live JS objects |
| `external` | Memory used by C++ objects bound to JS (Buffers, native add-ons) |
| `arrayBuffers` | Subset of `external` that backs `ArrayBuffer` / `Buffer` objects |

For leak hunting:

- **`heapUsed` trending up** across GC cycles is the clearest early signal.
- **`rss` trending up** without `heapUsed` moving suggests a native-code or `external` leak.
- `heapTotal` growing but `heapUsed` staying flat usually means the GC is not returning memory to
  the OS — often harmless, but worth noting.

> [!PRINCIPAL] Poll heapUsed at a fixed interval and store a rolling window
> A single reading is meaningless — memory oscillates with the GC. Meaningful signals come from
> a rolling window of samples (e.g. every 10 seconds for 5 minutes) and a trend calculation.
> A positive linear-regression slope across the window after a full GC cycle is strong evidence of
> a leak. Many APMs (Datadog, Clinic.js, AppSignal) do exactly this under the hood.

## The triage runbook

Use these steps in order. Do not skip to heap snapshots before confirming you have a real leak —
snapshot analysis under pressure is expensive and error-prone.

### Step 1 — Confirm the trend

Add a `memoryUsage()` poller if your APM does not already provide one:

```js
import { memoryUsage } from "node:process";

const INTERVAL_MS = 10_000; // 10 seconds
const samples = [];

const id = setInterval(() => {
  const { heapUsed, rss } = memoryUsage();
  samples.push({ ts: Date.now(), heapUsed, rss });

  if (samples.length >= 6) { // at least 1 minute of data
    const slope = linearSlope(samples.map((s, i) => [i, s.heapUsed]));
    if (slope > 0) console.warn(`[LEAK?] heapUsed slope: +${(slope / 1024).toFixed(1)} KB/sample`);
  }
}, INTERVAL_MS);

function linearSlope(points) {
  const n = points.length;
  const sumX  = points.reduce((a, [x]) => a + x, 0);
  const sumY  = points.reduce((a, [, y]) => a + y, 0);
  const sumXY = points.reduce((a, [x, y]) => a + x * y, 0);
  const sumX2 = points.reduce((a, [x]) => a + x * x, 0);
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}
```

> [!OUTPUT]
> [LEAK?] heapUsed slope: +512.3 KB/sample

### Step 2 — Isolate to a single replica

Route traffic away from one instance. This lets you instrument it aggressively (verbose logging,
GC exposure, snapshot endpoints) without user impact.

```bash
# example: remove the suspect instance from the load-balancer target group
aws elbv2 deregister-targets --target-group-arn arn:... --targets Id=i-0abc123
```

### Step 3 — Force a GC and take baseline snapshot A

```js
import v8 from "node:v8";

// Start node with: node --expose-gc server.js
global.gc();                            // full garbage collection
const snap1 = v8.writeHeapSnapshot();   // baseline
console.log("Snapshot A:", snap1);
```

> [!OUTPUT]
> Snapshot A: Heap.20260606.091200.42001.0.001.heapsnapshot

### Step 4 — Reproduce the leak (drive load or wait)

Drive representative traffic through the isolated instance for 5–15 minutes, or simply wait if
the leak is slow. You need enough time for the leaking objects to accumulate.

```bash
# drive load with autocannon or wrk:
npx autocannon -d 600 -c 50 http://localhost:3000/api/users
```

### Step 5 — Force GC again and take snapshot B

```js
global.gc();
const snap2 = v8.writeHeapSnapshot();
console.log("Snapshot B:", snap2);
```

### Step 6 — Compare in Chrome DevTools

1. Open `chrome://inspect` → click "Open dedicated DevTools for Node".
2. **Memory** tab → **Load** snapshot A.
3. **Load** snapshot B, select it.
4. Dropdown: change from **Summary** to **Comparison**, base = snapshot A.
5. Sort by **Size Delta** descending — the top rows are your suspects.

### Step 7 — Fix, deploy to canary, and verify trend reversal

After deploying the fix:

```js
// Watch the slope go to zero or negative — leak confirmed fixed
const id = setInterval(() => {
  const { heapUsed } = memoryUsage();
  samples.push([samples.length, heapUsed]);
  const slope = linearSlope(samples);
  console.log(`heapUsed: ${(heapUsed / 1024 / 1024).toFixed(1)} MB  slope: ${slope.toFixed(0)} B/sample`);
}, 10_000);
```

> [!OUTPUT]
> heapUsed: 48.2 MB  slope: 312 B/sample
> heapUsed: 48.4 MB  slope: 201 B/sample
> heapUsed: 48.3 MB  slope: -45 B/sample

A negative or near-zero slope after a GC cycle confirms the fix is effective.

> [!WARNING] Do not capture snapshots on every production replica simultaneously
> Snapshot capture pauses the event loop. On a loaded service a snapshot of a 1 GB heap can pause
> for 10–30 seconds. Always isolate one replica first. If you cannot drain traffic, capture during
> your lowest-traffic window (typically 2–4 AM local time for the region) and have a circuit
> breaker ready to abort.

## Try it yourself

This runnable block implements the memory-trend detector from the runbook. Feed it a sequence of
simulated `heapUsed` samples and watch it flag the leak.

```js run
// Linear regression slope (least-squares) over [index, value] pairs
function linearSlope(points) {
  const n = points.length;
  if (n < 2) return 0;
  const sumX  = points.reduce((a, [x]) => a + x, 0);
  const sumY  = points.reduce((a, [, y]) => a + y, 0);
  const sumXY = points.reduce((a, [x, y]) => a + x * y, 0);
  const sumX2 = points.reduce((a, [x]) => a + x * x, 0);
  const denom = (n * sumX2 - sumX * sumX);
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// Simulate 10 heapUsed samples that grow by ~1 MB per sample (plus noise)
const samples = Array.from({ length: 10 }, (_, i) => [
  i,
  50 * 1024 * 1024 + i * 1_000_000 + (Math.random() - 0.5) * 200_000
]);

const slope = linearSlope(samples);
const slopeMBPerSample = slope / (1024 * 1024);

console.log("Samples (MB):", samples.map(([, v]) => (v / 1024 / 1024).toFixed(2)).join(", "));
console.log(`Slope: ${slopeMBPerSample.toFixed(3)} MB/sample`);
console.log(slope > 0 ? "LEAK DETECTED — heapUsed is growing" : "No leak trend detected");

// Now simulate the same service after a fix (stable heap)
const fixedSamples = Array.from({ length: 10 }, (_, i) => [
  i,
  50 * 1024 * 1024 + (Math.random() - 0.5) * 500_000   // noise only, no trend
]);
const fixedSlope = linearSlope(fixedSamples) / (1024 * 1024);
console.log(`\nPost-fix slope: ${fixedSlope.toFixed(3)} MB/sample`);
console.log(Math.abs(fixedSlope) < 0.05 ? "STABLE — leak appears fixed" : "Still leaking");
```

## Project — Diagnose and fix a seeded memory leak

**Goal:** You are given a simulated long-running service that has a known memory leak seeded into
it. Use heap-snapshot diffs and the trend detector to identify the leak source, fix it, and prove
the fix works by showing the trend reverting to zero.

**Acceptance criteria:**

1. The trend detector correctly flags the leaking service — `slope > 0` across at least 8 samples.
2. You identify the leaking data structure by name (e.g. "unbounded Map on `requestCache`").
3. You apply a fix (bounded LRU, `WeakMap`, listener removal, or equivalent).
4. The trend detector reports `slope ≤ 0` across at least 8 samples of the fixed service.
5. A brief comment in the code explains *why* the original code leaked and *why* the fix prevents it.
6. No external packages are used — pure JS only.

**Starter code** (implements the trend detector; you add the leaky service + fix):

```js run
// ─── Trend detector (do not modify) ───────────────────────────────────────────
function linearSlope(points) {
  const n = points.length;
  if (n < 2) return 0;
  const sumX  = points.reduce((a, [x]) => a + x, 0);
  const sumY  = points.reduce((a, [, y]) => a + y, 0);
  const sumXY = points.reduce((a, [x, y]) => a + x * y, 0);
  const sumX2 = points.reduce((a, [x]) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function runTrendDetector(label, getHeapUsed, rounds = 10) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    getHeapUsed(); // drive the service for one "tick"
    samples.push([i, getHeapUsed()]);
  }
  const slope = linearSlope(samples);
  console.log(`[${label}] slope: ${slope > 0 ? "+" : ""}${slope.toFixed(0)} units/sample — ${slope > 50 ? "LEAKING" : "stable"}`);
  return slope;
}

// ─── TODO: implement leaky service ────────────────────────────────────────────
// Hint: create an unbounded Map, push entries on every "tick", return map.size
// as a proxy for heapUsed.

function makeLeakyService() {
  const cache = new Map(); // SEEDED LEAK
  let tick = 0;
  return {
    tick() {
      for (let i = 0; i < 100; i++) cache.set(`req-${tick++}`, { data: new Array(10).fill(0) });
    },
    heapProxy() { return cache.size; }
  };
}

// ─── TODO: implement fixed service ────────────────────────────────────────────
function makeFixedService() {
  // Replace the unbounded Map with a bounded structure (max 200 entries)
  const MAX = 200;
  const cache = new Map();
  let tick = 0;
  return {
    tick() {
      for (let i = 0; i < 100; i++) {
        const key = `req-${tick++}`;
        if (cache.size >= MAX) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
        }
        cache.set(key, { data: new Array(10).fill(0) });
      }
    },
    heapProxy() { return cache.size; }
  };
}

const leaky = makeLeakyService();
runTrendDetector("LEAKY ", leaky.tick.bind(leaky), 10);
// Each tick adds 100 entries → slope ≈ +100

const fixed = makeFixedService();
runTrendDetector("FIXED ", fixed.tick.bind(fixed), 10);
// Cache is capped at 200 → size plateaus → slope ≈ 0
```

## Common pitfalls

> [!PITFALL] Declaring victory after RSS drops following a restart
> Restarting the process makes memory look healthy — until the leak accumulates again. The only
> valid proof of a fix is a positive-slope graph that turns flat (or negative) *on the same
> running process* after the fix is deployed. Restarts hide leaks; they don't cure them.

> [!PITFALL] Chasing the wrong metric — heapTotal instead of heapUsed
> `heapTotal` reflects V8's committed reservation and can grow for reasons unrelated to leaks
> (e.g. after a large but now-collected allocation spike). Always track `heapUsed` across GC
> cycles for leak detection.

## What you learned

- `process.memoryUsage()` fields: `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers` —
  and which ones to trend for leak detection.
- A linear-regression slope over rolling `heapUsed` samples is a reliable, low-cost leak detector.
- The 7-step triage runbook: confirm trend → isolate replica → snapshot A → drive load →
  snapshot B → compare in DevTools → verify fix with a reverting slope.
- Snapshot capture pauses the event loop; always use an isolated, traffic-drained instance.
- The only valid proof of a fix is a trend reversal on a *live, running* process — not a restart.

## Next steps

You have completed Module 32. You can now detect, diagnose, attribute, and fix memory leaks at
every level — from heap-snapshot forensics and root-cause identification to production triage and
quantitative fix verification. The next module explores performance profiling with CPU flame graphs
to tackle the other half of the production performance story.
*/});
