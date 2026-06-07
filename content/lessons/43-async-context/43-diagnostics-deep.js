registerLessonSrc("43-diagnostics-deep", function () {/*
---
id: 43-diagnostics-deep
title: "diagnostics_channel, Trace Events & Continuous Profiling"
minutes: 30
level: advanced
objectives:
  - Use diagnostics_channel (channel/subscribe/publish and tracingChannel start/end/error/asyncStart/asyncEnd) for structured, low-overhead instrumentation
  - Capture trace events with --trace-event-categories and the trace_events module, and read the resulting JSON in chrome://tracing
  - Apply --cpu-prof and --heap-prof for production profiling, and understand continuous profiling tools like Pyroscope
---

# diagnostics_channel, Trace Events & Continuous Profiling

## Why this matters

`console.log` instrumentation has zero structural guarantees and forces every subscriber to parse strings. `async_hooks` gives causality but costs 10–30 % throughput. The production answer is the three-layer instrumentation stack built into Node itself: `diagnostics_channel` for structured, named, zero-allocation events; Trace Events for CPU-level timeline data; and continuous profiling for always-on flame graphs. Together they let you observe a production system with sub-1 % overhead — the kind of instrumentation that actually stays on in your most latency-sensitive tier.

## Learning objectives

- Create, subscribe to, and publish on `diagnostics_channel` channels, including the `tracingChannel` five-event pattern.
- Capture, export, and interpret Trace Event JSON from `--trace-event-categories` and `node:trace_events`.
- Run `--cpu-prof` and `--heap-prof`, interpret the outputs, and understand how tools like Pyroscope and Parca extend this to continuous profiling.
- Design instrumentation that is cost-free when no subscriber is present.

## diagnostics_channel: named, typed, structured events

`diagnostics_channel` (stable since Node 18, evolved in 19–22) provides a pub-sub bus where channels are identified by string names. The critical design property: **publishing to a channel with no subscribers is effectively free** — it is a single boolean check against a V8-inlined counter. You can instrument a library and ship it with the instrumentation on; consumers pay nothing unless they subscribe.

```js
import diagnostics from 'node:diagnostics_channel';

// --- Publisher (library code) ---
const ch = diagnostics.channel('mylib:query');

function runQuery(sql, params) {
  if (ch.hasSubscribers) {           // fast path: skip publish if nobody listening
    ch.publish({ sql, params, ts: performance.now() });
  }
  return db.execute(sql, params);
}

// --- Subscriber (APM agent / instrumentation code) ---
diagnostics.subscribe('mylib:query', (message, name) => {
  console.log(`[${name}] sql=${message.sql} at ${message.ts.toFixed(2)}ms`);
});
```

> [!OUTPUT]
> [mylib:query] sql=SELECT * FROM users WHERE id=$1 at 14.22ms

> [!NOTE]
> `hasSubscribers` is a getter backed by a reference-counted integer in C++. The check costs ~1 ns — cheaper than a function call. This is the key: you pay nothing at the call site unless someone is listening. Library authors should instrument everything; ops teams decide what to observe.

### tracingChannel: the five-event contract

`diagnostics.tracingChannel(namePrefix)` returns an object with five pre-named channels that together describe an operation's full lifecycle, including its async behaviour:

| Channel suffix | When to publish |
|---|---|
| `start` | Synchronous start of the operation |
| `end` | Synchronous end (success path) |
| `asyncStart` | The async phase begins (e.g., I/O submitted) |
| `asyncEnd` | The async phase completes |
| `error` | Any error on either the sync or async path |

```js
import diagnostics from 'node:diagnostics_channel';

const tracing = diagnostics.tracingChannel('db.query');

async function instrumentedQuery(sql, params) {
  const ctx = { sql, params, startMs: Date.now() };
  tracing.start.publish(ctx);
  try {
    ctx.result = await db.execute(sql, params);    // async boundary here
    tracing.asyncStart.publish(ctx);               // i/o in flight
    // ...awaited above, so asyncEnd fires when the promise resolves
    tracing.asyncEnd.publish(ctx);
    tracing.end.publish(ctx);
    return ctx.result;
  } catch (err) {
    ctx.error = err;
    tracing.error.publish(ctx);
    throw err;
  }
}

// Subscriber that builds a span:
tracing.start.subscribe((ctx) => { ctx._span = tracer.startSpan('db.query'); });
tracing.end.subscribe((ctx) => { ctx._span.finish(); });
tracing.error.subscribe((ctx) => { ctx._span.setError(ctx.error); ctx._span.finish(); });
```

> [!PRINCIPAL]
> The `tracingChannel` convention is important because it defines a stable cross-library contract. OpenTelemetry's Node.js instrumentation packages (as of 2025) are migrating from monkey-patching module exports to `diagnostics_channel` subscriptions precisely because it is safe, non-invasive, and has negligible overhead. If you ship a library and instrument it with `tracingChannel`, any OTel-compatible agent can observe it with zero changes to your code.

## Trace Events: CPU-timeline instrumentation

Node's Trace Events system writes structured JSON in the Chrome Trace Event Format, consumable by `chrome://tracing` or Perfetto. It captures V8 internals (GC, JIT, microtask queue), libuv I/O events, and user-defined events all on the same timeline.

### Enabling from the CLI

```bash
node --trace-event-categories v8,node,node.async_hooks,node.http app.js
```

This writes `node_trace.1.log` in the CWD. Common category groups:

| Category | What it includes |
|---|---|
| `v8` | GC pauses, JIT compile/deopt events |
| `node` | Node core bootstrapping events |
| `node.async_hooks` | Every init/before/after/destroy from async_hooks |
| `node.http` | HTTP parser events, request/response timings |
| `node.perf` | `performance.mark` and `performance.measure` entries |
| `node.promises.rejections` | Unhandled rejection tracking |

> [!OUTPUT]
> (node_trace.1.log — open in chrome://tracing)
> {"traceEvents":[
>   {"pid":12345,"tid":12345,"ts":1234567890,"ph":"B","cat":"v8","name":"V8.GCScavenger","args":{}},
>   {"pid":12345,"tid":12345,"ts":1234568100,"ph":"E","cat":"v8","name":"V8.GCScavenger","args":{"usedHeapSizeAfter":2456780}},
>   {"pid":12345,"tid":12345,"ts":1234568200,"ph":"b","cat":"node.async_hooks","name":"PROMISE","id":"0x7f...","args":{"triggerAsyncId":5}}
> ]}

### Programmatic trace events

```js
import { createTracing, getEnabledCategories } from 'node:trace_events';

// Create a session for a custom category
const tracing = createTracing({ categories: ['myapp'] });
tracing.enable();

// Emit a duration event pair (B=begin, E=end in Chrome format)
function traceOp(name, fn) {
  performance.mark(`${name}-start`);
  const result = fn();
  performance.mark(`${name}-end`);
  performance.measure(name, `${name}-start`, `${name}-end`);
  return result;
}

console.log('enabled categories:', getEnabledCategories());
```

> [!OUTPUT]
> enabled categories: myapp,node.perf

## CPU profiling: --cpu-prof and --heap-prof

### CPU profiling

```bash
# Generate a V8 CPU profile (samples every 1 ms by default)
node --cpu-prof --cpu-prof-interval=100 server.js

# After the process exits (or SIGINT), writes cpu.cpuprofile
# Load in Chrome DevTools > Performance > Load Profile
```

The `.cpuprofile` format is a JSON tree of V8 internal node ids, hit counts, and source positions. DevTools renders it as a flame graph where width = time spent. Key things to look for:

- **Wide bars in user code**: hot paths ripe for optimisation.
- **Wide bars in `v8::internal::Runtime_*`**: deoptimisation events — check with `--trace-deopt`.
- **Wide bars in `node::AsyncWrap::*`**: async_hooks overhead — consider disabling hooks in that path.

```bash
# Heap allocation profile
node --heap-prof server.js
# Writes heapprofile.*.heapprofile — load in Chrome Memory > Load Allocation Timeline
```

> [!PRINCIPAL]
> `--cpu-prof` uses V8's `CpuProfiler` which is a **sampling profiler at 1 ms intervals** (configurable with `--cpu-prof-interval`). It has < 1 % overhead at the default interval — safe for short production burns. However, it misses sub-millisecond hotspots. For μs-level analysis use `perf record -F 99 -g` (Linux) combined with `perf script | node --linux-perf` (requires `--perf-basic-prof` or `--perf-prof-to-file`) to map JIT frames. The `0x` and `clinic flame` tools automate this entire pipeline.

### Continuous profiling: Pyroscope and Parca

CPU profiles captured at process exit are useless for long-running services with intermittent spikes. **Continuous profilers** sample at 10–100 Hz continuously, store aggregated flame graph data in a time-series backend, and let you query "show me the flame graph for the last 30 seconds of elevated p99."

```js
// Pyroscope Node.js agent — minimal setup
import Pyroscope from '@pyroscope/nodejs';

Pyroscope.init({
  serverAddress: 'http://pyroscope:4040',
  appName: 'myapp',
  tags: { region: process.env.REGION, version: process.env.APP_VERSION },
});
Pyroscope.start(); // samples at 10 Hz via V8 CpuProfiler, uploads every 10 s
```

The agent calls `v8::CpuProfiler::StartProfiling` and `StopProfiling` on a timer, serialises the tree, and ships it to the backend. The overhead is ~0.5–1 % CPU — acceptable for always-on use. Parca (CNCF) does the same but is fully open-source and stores profiles in Parquet on object storage.

> [!WARNING]
> Continuous profilers interact with V8's JIT: starting/stopping `CpuProfiler` can cause V8 to deoptimise hot functions if profiling changes the feedback vector's observation mode. Measure your p99 latency before and after enabling — a function that was Turbofan-compiled may fall back to Maglev or Sparkplug when observed, adding 2–5 μs per call. At 10 Hz start/stop intervals this is usually negligible, but be aware for latency-critical hot loops.

## Low-overhead instrumentation design principles

1. **Check `hasSubscribers` before computing message objects.** Object allocation is never free — even if the GC handles it quickly, it adds to GC pressure. `if (ch.hasSubscribers) ch.publish(buildCtx())` avoids allocating `buildCtx()`'s return value entirely when nobody is listening.

2. **Use `tracingChannel` for anything with an async boundary.** The five-event contract lets subscribers compute durations, attach spans, and correlate errors without needing to instrument inside your library.

3. **Separate observation from interpretation.** Publishers emit raw data (SQL string, latency number, error object). Subscribers decide what to do: log, increment a counter, start a span. This layering is what makes `diagnostics_channel` composable — an OTel agent, a custom logger, and a metrics library can all subscribe independently.

4. **Profile the profiler.** Run `node --prof` on your instrumented service and look at the tick processor output for time spent in `diagnostics_channel`'s subscription dispatch. On a channel with 3 subscribers and 50k publishes/second, expect ~0.5–2 μs per publish — acceptable for I/O operations, potentially significant for tight inner loops.

## Try it yourself

The runnable below implements a `tracingChannel`-style instrumentation wrapper in pure JS. It tracks operations with start/end/error events, measures durations, and delivers them to subscribers — modelling exactly what the real `diagnostics_channel` tracingChannel does.

```js run
// tracingChannel-style instrumentation in pure browser JS.
// Models: channel creation, hasSubscribers fast-path, publish,
// and the 5-event lifecycle for async operations.

function makeChannel(name) {
  const subs = [];
  return {
    name,
    get hasSubscribers() { return subs.length > 0; },
    subscribe(fn) { subs.push(fn); },
    publish(msg) { for (const fn of subs) fn(msg, name); },
  };
}

function makeTracingChannel(prefix) {
  return {
    start:      makeChannel(`${prefix}:start`),
    end:        makeChannel(`${prefix}:end`),
    asyncStart: makeChannel(`${prefix}:asyncStart`),
    asyncEnd:   makeChannel(`${prefix}:asyncEnd`),
    error:      makeChannel(`${prefix}:error`),
  };
}

// --- Library instrumentation ---
const dbTracing = makeTracingChannel('db.query');

function simulateDbQuery(sql, shouldFail) {
  return new Promise((resolve, reject) => {
    const ctx = { sql, startMs: performance.now() };

    if (dbTracing.start.hasSubscribers) dbTracing.start.publish(ctx);

    // Simulate async I/O with setTimeout (50 ms round-trip)
    setTimeout(() => {
      if (dbTracing.asyncStart.hasSubscribers) dbTracing.asyncStart.publish(ctx);

      setTimeout(() => {
        ctx.durationMs = performance.now() - ctx.startMs;

        if (shouldFail) {
          ctx.error = new Error('connection timeout');
          if (dbTracing.error.hasSubscribers) dbTracing.error.publish(ctx);
          reject(ctx.error);
        } else {
          ctx.rows = [{ id: 1 }, { id: 2 }];
          if (dbTracing.asyncEnd.hasSubscribers) dbTracing.asyncEnd.publish(ctx);
          if (dbTracing.end.hasSubscribers)      dbTracing.end.publish(ctx);
          resolve(ctx.rows);
        }
      }, 10);
    }, 5);
  });
}

// --- APM subscriber ---
const spans = [];

dbTracing.start.subscribe((ctx) => {
  ctx._span = { name: 'db.query', sql: ctx.sql, start: ctx.startMs };
  spans.push(ctx._span);
  console.log(`[start]  sql="${ctx.sql}"`);
});

dbTracing.end.subscribe((ctx) => {
  ctx._span.durationMs = ctx.durationMs;
  console.log(`[end]    sql="${ctx.sql}" duration=${ctx.durationMs.toFixed(1)}ms rows=${ctx.rows.length}`);
});

dbTracing.error.subscribe((ctx) => {
  ctx._span.error = ctx.error.message;
  console.log(`[error]  sql="${ctx.sql}" err=${ctx.error.message}`);
});

// --- Run two queries ---
simulateDbQuery('SELECT * FROM users', false)
  .then(() => simulateDbQuery('DELETE FROM sessions', true))
  .catch(() => {})
  .then(() => {
    console.log('\nCaptured spans:');
    for (const s of spans) {
      const status = s.error ? `ERROR(${s.error})` : `OK(${s.durationMs?.toFixed(1)}ms)`;
      console.log(`  ${s.sql} → ${status}`);
    }
  });
```

## Project

### Build a zero-overhead request-context + tracing layer

Design and implement a production-grade instrumentation layer that combines `AsyncLocalStorage` for context propagation with `diagnostics_channel` for structured event emission — then benchmark its overhead against a baseline with no instrumentation.

**Acceptance criteria:**

1. **Context propagation.** Every incoming "request" is assigned a unique `requestId` via `AsyncLocalStorage.run()`. Any code anywhere in the async call tree can retrieve it with `getStore().requestId` — including inside `setTimeout` and inside simulated async I/O callbacks.

2. **tracingChannel integration.** All outbound "operations" (DB queries, HTTP calls, cache lookups) are instrumented using a `makeTracingChannel(name)` helper that emits `start`, `end`, `asyncStart`, `asyncEnd`, and `error` events. The `start` event automatically captures `getStore().requestId` into the context object.

3. **Zero-overhead when unsubscribed.** Benchmark the instrumented path with no subscribers vs. the same code with three subscribers active. The unsubscribed path must be within 3 % of a completely uninstrumented baseline.

4. **Error attribution.** When an operation emits an `error` event, the subscriber records which `requestId` experienced the error. After processing 100 requests (10 of which fail), print a summary of `{ requestId, operation, errorMessage }` for each failure.

5. **Duration histogram.** A subscriber accumulates operation durations into a histogram with 10 buckets (`[0,1)`, `[1,5)`, `[5,10)`, `[10,25)`, `[25,50)`, `[50,100)`, `[100,250)`, `[250,500)`, `[500,1000)`, `[1000,∞)` ms). After all requests, print the histogram with bucket counts and a p95 estimate.

6. **Benchmark report.** Use `performance.now()` to measure total wall time for 1000 requests under three conditions: no instrumentation, instrumented + no subscribers, instrumented + 3 subscribers. Print a table showing ops/sec and overhead percentage for each condition.

**Starter — the pure-logic core (expand this into the full solution):**

```js run
// Starter: tracingChannel + request-context in pure browser JS.
// Expand into the full project by adding the histogram, benchmark loop,
// and error-attribution summary.

// --- AsyncLocalStorage shim (same as previous lesson's SimpleContextStorage) ---
class ContextStorage {
  constructor() { this._stack = [undefined]; }
  run(store, fn) {
    this._stack.push(store);
    try { return fn(); }
    finally { this._stack.pop(); }
  }
  getStore() { return this._stack[this._stack.length - 1]; }
  captureFrame() {
    const captured = this._stack[this._stack.length - 1];
    return (fn) => {
      this._stack.push(captured);
      try { return fn(); }
      finally { this._stack.pop(); }
    };
  }
}

const als = new ContextStorage();

// --- diagnostics_channel shim ---
function makeChannel(name) {
  const subs = [];
  return {
    name,
    get hasSubscribers() { return subs.length > 0; },
    subscribe(fn) { subs.push(fn); },
    publish(msg) { for (const fn of subs) fn(msg, name); },
  };
}

function makeTracingChannel(prefix) {
  return {
    start:      makeChannel(`${prefix}:start`),
    end:        makeChannel(`${prefix}:end`),
    asyncStart: makeChannel(`${prefix}:asyncStart`),
    asyncEnd:   makeChannel(`${prefix}:asyncEnd`),
    error:      makeChannel(`${prefix}:error`),
  };
}

// --- Instrumented operation ---
const dbCh = makeTracingChannel('db.query');

function doQuery(sql, latencyMs, fail, restoreCtx) {
  return new Promise((resolve, reject) => {
    restoreCtx(() => {
      const ctx = { sql, requestId: als.getStore()?.requestId, startMs: performance.now() };
      if (dbCh.start.hasSubscribers) dbCh.start.publish(ctx);

      const frame = als.captureFrame();
      setTimeout(() => {
        frame(() => {
          ctx.durationMs = performance.now() - ctx.startMs;
          if (fail) {
            ctx.error = new Error('simulated failure');
            if (dbCh.error.hasSubscribers) dbCh.error.publish(ctx);
            reject(ctx.error);
          } else {
            if (dbCh.asyncEnd.hasSubscribers) dbCh.asyncEnd.publish(ctx);
            if (dbCh.end.hasSubscribers)      dbCh.end.publish(ctx);
            resolve('ok');
          }
        });
      }, latencyMs);
    });
  });
}

// --- Wire up subscribers ---
const errors = [];
dbCh.error.subscribe((ctx) => errors.push({ requestId: ctx.requestId, sql: ctx.sql, err: ctx.error.message }));

const durations = [];
dbCh.end.subscribe((ctx) => durations.push(ctx.durationMs));

// --- Simulate 10 requests, 2 fail ---
const restoreRoot = als.captureFrame();
let done = 0;
for (let i = 0; i < 10; i++) {
  const reqId = `req-${i}`;
  als.run({ requestId: reqId }, () => {
    const frame = als.captureFrame();
    doQuery(`SELECT ${i}`, 5 + Math.random() * 20, i % 5 === 0, frame)
      .catch(() => {})
      .then(() => {
        done++;
        if (done === 10) {
          console.log('Errors:');
          for (const e of errors) console.log(`  ${e.requestId}: ${e.err}`);
          console.log(`Successful durations (ms): ${durations.map(d => d.toFixed(1)).join(', ')}`);
        }
      });
  });
}
```

## Common pitfalls

> [!PITFALL]
> **Publishing rich objects with circular references.** `diagnostics_channel` passes the message object directly to all subscribers by reference — it does not clone or serialise it. If a subscriber holds the reference and your code later mutates the object (appending a response body to `ctx.data`, for example), the subscriber sees the mutation retroactively. Always treat published context objects as frozen after `publish()`, or pass a shallow clone: `ch.publish({ ...ctx })`.

A second production pitfall: **registering subscribers after the process starts handling traffic.** Because `hasSubscribers` is checked at publish time, a channel that was unsubscribed during startup (and thus had `hasSubscribers === false`) will have skipped computing certain diagnostic fields. Subscribing at minute 5 of a running service means you get events only from minute 5 onward, with no back-fill — which is expected, but surprises people who assume they can toggle instrumentation on dynamically and immediately see historical data.

## What you learned

- `diagnostics_channel` provides named, typed pub-sub with a `hasSubscribers` fast path that costs ~1 ns when no subscribers are present — safe to ship in library code.
- `tracingChannel` defines a five-event contract (`start/end/asyncStart/asyncEnd/error`) that lets APM agents observe operations without monkey-patching.
- `--trace-event-categories` writes Chrome Trace Event JSON; `--cpu-prof` and `--heap-prof` produce V8 profiler output; both are safe for short production burns.
- Continuous profilers (Pyroscope, Parca) run the V8 CpuProfiler at 10 Hz continuously with ~1 % overhead, enabling always-on flame graphs.
- Low-overhead instrumentation requires: `hasSubscribers` guards, immutable context objects, and separating the data-emitting layer from the interpretation layer.

## Next steps

With async context, diagnostics, and profiling in hand, the next module (`44-mechanical-sympathy`) takes you into CPU cache topology, NUMA effects, and how Node's single-threaded model interacts with hardware prefetchers — the final performance frontier before you hit physics.
*/});
