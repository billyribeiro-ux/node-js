registerLessonSrc("30-tracing", function () {/*
---
id: 30-tracing
title: "Tracing with diagnostics_channel & async_hooks"
minutes: 28
level: principal
objectives:
  - Use diagnostics_channel to publish and subscribe to instrumentation events without coupling code
  - Propagate request context across async boundaries with AsyncLocalStorage
  - Build a span/trace tree using perf_hooks marks and measures
---

# Tracing with diagnostics_channel & async_hooks

## Why this matters

Profiling tells you that `serialize` consumes 40% of CPU. But *which request* is triggering the expensive path? On a busy server, one misbehaving tenant can saturate a shared resource while every other request suffers — and a flat flamegraph won't tell you who is to blame. Distributed tracing gives each request a unique identity that follows it through every async hop, every database call, every downstream service. Node's built-in `diagnostics_channel` and `async_hooks` APIs let you instrument code at the platform level without polluting business logic.

## Learning objectives

- Publish and subscribe instrumentation events using **diagnostics_channel**.
- Propagate request-scoped context across async boundaries using **AsyncLocalStorage**.
- Emit and collect **perf_hooks** marks and measures for precise duration tracking.
- Build a hierarchical span/trace tree that shows the timeline of a single request.

## diagnostics_channel

`diagnostics_channel` is a lightweight publish/subscribe system built into Node. Libraries (like `undici`, `mysql2`, and `pg`) already publish events on named channels. You subscribe without patching anything:

```js
import diagnostics from 'node:diagnostics_channel';

// Subscribe to HTTP client requests made by undici (built-in fetch):
const ch = diagnostics.channel('undici:request:create');

ch.subscribe((message) => {
  const { request } = message;
  console.log(`→ ${request.method} ${request.origin}${request.path}`);
});

// Now every fetch() call automatically logs a trace line:
await fetch('https://example.com/api/users');
await fetch('https://example.com/api/posts');
```

> [!OUTPUT]
> → GET https://example.com/api/users
> → GET https://example.com/api/posts

You can also publish your own channels in application code:

```js
import diagnostics from 'node:diagnostics_channel';

const queryChannel = diagnostics.channel('myapp:db:query');

// In your DB layer:
export async function query(sql, params) {
  const start = performance.now();
  const result = await db.execute(sql, params);
  if (queryChannel.hasSubscribers) {
    queryChannel.publish({ sql, params, durationMs: performance.now() - start });
  }
  return result;
}
```

> [!NOTE] hasSubscribers guard
> Always check `channel.hasSubscribers` before constructing the message object. If nobody is listening, this short-circuits the allocation entirely — zero cost in production when tracing is disabled.

> [!PRINCIPAL] diagnostics_channel as a zero-coupling instrumentation contract
> The key design insight is that the publisher and subscriber are completely decoupled. Your database layer publishes to `'myapp:db:query'` whether or not an APM agent is attached. Datadog, OpenTelemetry, or your own tracing harness subscribes. Neither side needs to know about the other. This is how Node's own built-in libraries expose telemetry — `http`, `net`, `undici` all publish on standardised channels — so third-party APM tools can instrument them without monkey-patching.

## async_hooks & AsyncLocalStorage

An async operation (like an HTTP request handler) spawns Promises, `setTimeout` callbacks, streams — all of which outlive the original call frame. Standard module-level state cannot hold per-request data without mixing it up across concurrent requests. **AsyncLocalStorage** solves this:

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const requestContext = new AsyncLocalStorage();

http.createServer((req, res) => {
  // Set context for this request and all async work spawned inside:
  requestContext.run({ requestId: randomUUID(), path: req.url }, async () => {
    await handleRequest(req, res);
  });
}).listen(3000);

async function handleRequest(req, res) {
  const ctx = requestContext.getStore(); // works in any nested async call
  console.log(`[${ctx.requestId}] handling ${ctx.path}`);
  await fetchData();
  res.end('ok');
}

async function fetchData() {
  const ctx = requestContext.getStore(); // still works — async context preserved!
  console.log(`[${ctx.requestId}] fetching data`);
}
```

> [!OUTPUT]
> [a3f9-...] handling /api/items
> [a3f9-...] fetching data

The `requestId` flows from the HTTP handler all the way into `fetchData` without being passed as a parameter. No thread-local storage, no globals, no prop-drilling.

> [!PITFALL] AsyncLocalStorage and queueMicrotask / worker_threads
> `AsyncLocalStorage` propagates context through Promises, `setTimeout`, `setImmediate`, and Node streams automatically. However, context does NOT cross `worker_threads` boundaries — a Worker thread starts fresh. If you post a message to a Worker you must serialise the relevant context fields and pass them explicitly in the message payload.

## perf_hooks marks and measures

`perf_hooks` provides a User Timing API (identical to the browser's `performance.mark`/`performance.measure`):

```js
import { performance, PerformanceObserver } from 'node:perf_hooks';

// Observe measures as they are created:
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`${entry.name}: ${entry.duration.toFixed(2)} ms`);
  }
});
obs.observe({ entryTypes: ['measure'] });

// Instrument your code:
performance.mark('db:start');
await db.query('SELECT ...');
performance.mark('db:end');
performance.measure('db:query', 'db:start', 'db:end');

performance.mark('render:start');
const html = renderTemplate(data);
performance.mark('render:end');
performance.measure('render', 'render:start', 'render:end');
```

> [!OUTPUT]
> db:query: 4.23 ms
> render: 1.07 ms

Marks and measures are named globally — in a concurrent server, combine them with a unique prefix per request to avoid collisions:

```js
const id = ctx.requestId.slice(0, 8);
performance.mark(`${id}:db:start`);
// ...
performance.measure(`${id}:db:query`, `${id}:db:start`, `${id}:db:end`);
```

## Putting it together: a span/trace model

OpenTelemetry, Datadog, and Jaeger all model distributed tracing as a tree of **spans**. Each span has a name, a start time, a duration, and optionally a parent span. The combination of all spans for a single request is a **trace**.

```js
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';

const traceCtx = new AsyncLocalStorage();

function startSpan(name) {
  const parent = traceCtx.getStore();
  const span = {
    name,
    start: performance.now(),
    end: null,
    duration: null,
    children: [],
    parent,
  };
  if (parent) parent.children.push(span);
  return span;
}

function endSpan(span) {
  span.end = performance.now();
  span.duration = span.end - span.start;
}

async function withSpan(name, fn) {
  const span = startSpan(name);
  return traceCtx.run(span, async () => {
    try {
      return await fn(span);
    } finally {
      endSpan(span);
    }
  });
}

function printTrace(span, indent = 0) {
  const pad = '  '.repeat(indent);
  console.log(`${pad}[${span.name}] ${span.duration.toFixed(2)} ms`);
  for (const child of span.children) printTrace(child, indent + 1);
}
```

> [!OUTPUT]
> [handleRequest] 47.31 ms
>   [db:query] 32.10 ms
>   [renderTemplate] 14.88 ms
>     [formatDate] 0.43 ms

## Try it yourself

The runnable below implements the full span/trace engine in pure JS, simulates an HTTP request with nested async operations, and prints the complete trace tree — the exact starter you will extend in the project.

```js run
// Span/trace engine — pure JS, browser-safe (uses performance.now + Promises).

// --- Minimal AsyncLocalStorage simulation for the browser sandbox ---
// (Real Node uses node:async_hooks; here we thread it manually to stay pure-JS.)
let _currentSpan = null;
function getCurrentSpan() { return _currentSpan; }
function setCurrentSpan(s) { _currentSpan = s; }

function startSpan(name) {
  const parent = getCurrentSpan();
  const span = { name, start: performance.now(), end: null, duration: null, children: [] };
  if (parent) parent.children.push(span);
  return span;
}

function endSpan(span) {
  span.end = performance.now();
  span.duration = span.end - span.start;
}

async function withSpan(name, fn) {
  const span = startSpan(name);
  const prev = getCurrentSpan();
  setCurrentSpan(span);
  try {
    return await fn(span);
  } finally {
    endSpan(span);
    setCurrentSpan(prev);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function printTrace(span, indent = 0) {
  const pad = '  '.repeat(indent);
  console.log(`${pad}[${span.name}] ${span.duration.toFixed(1)} ms`);
  for (const child of span.children) printTrace(child, indent + 1);
}

// --- Simulated request pipeline ---

async function fetchUser(id) {
  return withSpan('db:fetchUser', async () => {
    await sleep(20); // simulate DB latency
    return { id, name: 'Ada' };
  });
}

async function fetchPosts(userId) {
  return withSpan('db:fetchPosts', async () => {
    await sleep(15);
    return [{ title: 'Hello' }, { title: 'World' }];
  });
}

async function renderPage(user, posts) {
  return withSpan('render:page', async () => {
    await sleep(5);
    return `<h1>${user.name}</h1><ul>${posts.map(p => `<li>${p.title}</li>`).join('')}</ul>`;
  });
}

async function handleRequest(requestId) {
  return withSpan(`request:${requestId}`, async (rootSpan) => {
    const user  = await fetchUser(42);
    const posts = await fetchPosts(user.id);
    const html  = await renderPage(user, posts);
    console.log(`Served ${html.length} bytes`);
    return rootSpan;
  });
}

// Run it and print the trace tree
const root = await handleRequest('req-001');
console.log('\nTrace:');
printTrace(root);
```

## Project

**Profile and optimise a deliberately slow service, producing a before/after analysis.**

You have learned CPU profiling (flamegraphs), benchmarking (statistical measurement), and tracing (per-request context). This project brings all three together.

### Acceptance criteria

1. **Instrument the service** — wrap every logical operation in the span tracer above (or your extended version). Every incoming "request" must produce a complete trace tree showing which sub-operations ran and how long each took.
2. **Identify the bottleneck** — run the service under load and use either the sampling profiler (lesson 30-cpu-profiling) or your benchmarking harness (lesson 30-benchmarking) to confirm which function consumes the most time. Document your finding with numbers.
3. **Optimise exactly one thing** — change only the identified bottleneck (e.g. cache a repeated computation, replace a naive algorithm, avoid redundant serialisation). Do not refactor anything else.
4. **Measure the improvement** — re-run the benchmark harness and record before/after ops/sec and median latency. The optimised version must show a measurable improvement (at least 10% faster median).
5. **Produce a written analysis** — a short comment block (or a `console.log` summary) that states: (a) what the bottleneck was, (b) how you found it, (c) what you changed, and (d) the before/after numbers.
6. **Regression check** — add at least one assertion that confirms the optimised function produces the same output as the original for a set of representative inputs.

### Starter — extend this in the project

```js run
// Starter: deliberately slow service + span tracer + benchmark harness.
// Your job: find the bottleneck, fix it, prove the improvement.

// ---- Span tracer (same as lesson body) ----
let _cur = null;

function startSpan(name) {
  const span = { name, start: performance.now(), end: null, duration: null, children: [] };
  if (_cur) _cur.children.push(span);
  return span;
}
function endSpan(s) { s.end = performance.now(); s.duration = s.end - s.start; }

async function withSpan(name, fn) {
  const span = startSpan(name);
  const prev = _cur; _cur = span;
  try { return await fn(span); } finally { endSpan(span); _cur = prev; }
}

function printTrace(s, i = 0) {
  console.log('  '.repeat(i) + `[${s.name}] ${s.duration.toFixed(1)} ms`);
  s.children.forEach(c => printTrace(c, i + 1));
}

// ---- Deliberately slow helpers ----

function slowSum(arr) {
  // BUG: recomputes from scratch on every call — no caching
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += arr[i];
  return total;
}

function buildReport(items) {
  // Calls slowSum ONCE PER ITEM — O(n^2) total
  return items.map(item => ({
    id: item.id,
    value: item.value,
    runningTotal: slowSum(items.slice(0, item.id + 1).map(x => x.value)),
  }));
}

const ITEMS = Array.from({ length: 200 }, (_, i) => ({ id: i, value: i * 3 + 1 }));

// ---- Benchmark harness ----
function measure(fn, warmupMs = 80, runMs = 300) {
  const t0 = performance.now() + warmupMs;
  while (performance.now() < t0) fn();
  const samples = [];
  const t1 = performance.now() + runMs;
  while (performance.now() < t1) {
    const s = performance.now(); fn(); samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return { mean, median: samples[Math.floor(samples.length / 2)], ops: Math.round(1000 / mean) };
}

// ---- Simulate a "request" with tracing ----
async function handleRequest(id) {
  return withSpan(`request:${id}`, async (root) => {
    await withSpan('buildReport', async () => {
      buildReport(ITEMS); // this is where time goes
    });
    return root;
  });
}

// Run one traced request
const root = await handleRequest('r-001');
console.log('Trace:');
printTrace(root);

// Benchmark the slow version
const before = measure(() => buildReport(ITEMS));
console.log(`\nBEFORE: ${before.median.toFixed(2)} ms median, ${before.ops} ops/sec`);

// TODO: implement fastBuildReport() that fixes the O(n^2) pattern,
//       then measure() it and print the AFTER numbers.
// TODO: add an assertion that fastBuildReport(ITEMS) deep-equals buildReport(ITEMS).
```

## Common pitfalls

> [!PITFALL] AsyncLocalStorage.run() and forgotten await
> If you `run(store, callback)` but forget to `await` an async operation inside the callback, the context is torn down before the async work completes. The symptom is `getStore()` returning `undefined` in a downstream function. Always `await` every async call inside a `run()` callback, and `return` the final Promise so the caller can also await it.

Another subtle trap: forgetting `endSpan` on error paths. Wrap the span's body in `try/finally` (as the `withSpan` helper above does) so that spans are always closed even when exceptions are thrown. An unclosed span inflates its parent's duration to infinity.

## What you learned

- **diagnostics_channel** lets libraries and application code publish instrumentation events on named channels, decoupling publishers from subscribers with zero overhead when no subscriber is attached.
- **AsyncLocalStorage** propagates request-scoped data (request ID, user, trace context) across every async hop without passing it as a parameter.
- **perf_hooks** marks and measures give you named, high-resolution timing that integrates with browser DevTools and OpenTelemetry exporters.
- A **span/trace tree** models a request as a hierarchy of named durations, letting you pinpoint which sub-operation is responsible for latency.
- Combining tracing with profiling and benchmarking gives you the complete picture: *where* time goes (profile), *which request* causes it (trace), and *how much better* your fix is (benchmark).

## Next steps

With performance fully covered — profiling, benchmarking, and tracing — the next module dives into the V8 engine itself: how it compiles JavaScript, what hidden classes are, and how to write code that stays in the "fast path".
*/});
