registerLessonSrc("43-async-hooks", function () {/*
---
id: 43-async-hooks
title: "async_hooks Lifecycle & Resource Tracking"
minutes: 28
level: advanced
objectives:
  - Understand every async_hooks callback (init/before/after/destroy/promiseResolve) and when each fires
  - Trace the asyncId/triggerAsyncId causality chain to reconstruct the async resource tree
  - Measure and reason about async_hooks overhead and know when it matters in production
---

# async_hooks Lifecycle & Resource Tracking

## Why this matters

Every APM agent, distributed tracer, and structured logger that "magically" knows which request triggered a given callback is built on top of `async_hooks`. Understanding the lifecycle at this level lets you build your own zero-magic tracers, debug context-loss bugs that no library author documented, and reason critically about the ~10–30 % throughput cost that enabling these hooks can impose. If you've ever wondered how a tracing library attaches a `traceId` across a hundred `await` points without you threading it manually — this is the lesson.

## Learning objectives

- Map the five hook callbacks to the exact moments in the event loop and V8 microtask queue they fire.
- Explain the asyncId / triggerAsyncId parent-child relationship and reconstruct a causal tree.
- Quantify the overhead of `async_hooks` and identify the V8/Node internals that cause it.
- Know which resource types appear in the wild (`PROMISE`, `Timeout`, `TCPWRAP`, `HTTPINCOMINGMESSAGE`, etc.) and why.

## The async execution model and the problem it creates

Node's event loop dispatches I/O callbacks, timers, and promise continuations across time. The call stack at the moment a callback executes gives you no information about *who scheduled it*. A `setTimeout` callback has no stack frames pointing back to the `http.createServer` handler that called `setTimeout`. This is the **context propagation problem** that `async_hooks` was designed to solve.

The module ships with Node since v8.0.0 (stable in v10) and is in `node:async_hooks`.

## The five hook callbacks

```js
import { createHook, executionAsyncId, triggerAsyncId } from 'node:async_hooks';
import { writeSync } from 'node:fs';

const hook = createHook({
  // Called when an async resource is CREATED.
  // asyncId   — unique id assigned to THIS resource
  // type      — string label: 'PROMISE', 'Timeout', 'TCPWRAP', …
  // triggerAsyncId — asyncId of the resource that CREATED this one
  // resource  — the raw JS object (e.g., the Promise, the Timer handle)
  init(asyncId, type, triggerAsyncId, resource) {
    writeSync(1, `init  ${type}(${asyncId}) trigger=${triggerAsyncId}\n`);
  },

  // Called immediately BEFORE the callback associated with this resource fires.
  before(asyncId) {
    writeSync(1, `before ${asyncId}\n`);
  },

  // Called immediately AFTER the callback associated with this resource returns.
  after(asyncId) {
    writeSync(1, `after  ${asyncId}\n`);
  },

  // Called when the GC has collected the resource.
  destroy(asyncId) {
    writeSync(1, `destroy ${asyncId}\n`);
  },

  // Promise-only: called when a Promise resolves (fulfills or rejects).
  promiseResolve(asyncId) {
    writeSync(1, `promiseResolve ${asyncId}\n`);
  },
});

hook.enable();
```

> [!NOTE]
> `writeSync` instead of `console.log`: `console.log` itself schedules an async write, which would trigger more hooks while you're inside a hook — causing infinite recursion. Always use synchronous I/O inside hook callbacks.

### The exact firing order for a Promise chain

```js
// Execution context: asyncId 1 (the main module)
Promise.resolve(42)
  .then(v => v + 1)   // .then creates a new PROMISE resource
  .then(console.log);
```

> [!OUTPUT]
> init  PROMISE(5) trigger=1        ← Promise.resolve() creates resource 5
> init  PROMISE(6) trigger=5        ← .then #1 creates resource 6 (triggered by 5)
> init  PROMISE(7) trigger=6        ← .then #2 creates resource 7
> before 6                          ← microtask: .then #1 callback fires
> promiseResolve 6
> after  6
> before 7                          ← microtask: .then #2 callback fires (console.log)
> promiseResolve 7
> 43
> after  7

> [!PRINCIPAL]
> The `triggerAsyncId` at `init` time is the asyncId that was **executing** (i.e. `executionAsyncId()`) when the resource was created, not the asyncId of the resolved value's producer. This is the causality link: it lets you reconstruct a parent→child tree by following triggerAsyncIds up to the root (asyncId 1, the main module). APM agents store `{ [asyncId]: triggerAsyncId }` in a flat map and walk it backward to attach spans.

## The async resource tree

Every async operation forms a tree whose root is asyncId 1. Here is how an HTTP request callback sits inside that tree:

```
1 (root — main module)
└─ 2 TCPServerWrap  (net.createServer listen)
   └─ 8 TCPWRAP     (incoming connection accepted)
      └─ 9 HTTPINCOMINGMESSAGE  (req/res parsing)
         └─ 14 PROMISE  (await inside handler)
            └─ 15 PROMISE  (next await)
               └─ 23 Timeout  (setTimeout inside handler)
```

`executionAsyncId()` tells you which node in this tree is *currently executing*. `triggerAsyncId()` tells you which node created the one currently executing.

```js
import { executionAsyncId, triggerAsyncId } from 'node:async_hooks';

// Inside an async function called from an HTTP handler:
async function handleRequest(req, res) {
  console.log('exec', executionAsyncId(), 'trigger', triggerAsyncId());
  await someDatabaseQuery();
  console.log('exec', executionAsyncId(), 'trigger', triggerAsyncId());
  // executionAsyncId changes across the await boundary!
}
```

> [!OUTPUT]
> exec 9 trigger 8
> exec 14 trigger 9

## Resource types you'll encounter in production

| Type | When created |
|---|---|
| `PROMISE` | Any native Promise (resolve/reject/then/async-await) |
| `Timeout` / `Immediate` | `setTimeout` / `setImmediate` |
| `TCPWRAP` | TCP socket accept |
| `TCPSERVERWRAP` | `net.createServer` |
| `HTTPINCOMINGMESSAGE` | Node HTTP parser per-request |
| `TLSWRAP` | TLS handshake |
| `GETADDRINFOREQWRAP` | `dns.lookup` |
| `FSREQCALLBACK` | `fs.readFile` and friends |
| `UDPSENDWRAP` | UDP send |
| `AsyncResource` | Manual resource (APM agents, worker pools) |

## Why async_hooks has overhead

Enabling async_hooks installs callbacks into V8's `Promise` intrinsic and into libuv's handle tracking. Two costs dominate:

1. **Promise hook overhead (~2–4× promise allocation cost).** V8 exposes a `PromiseHook` C++ API. Every promise creation, resolution, and microtask step calls through it. With tens of thousands of promises per second (a busy `async/await` server), this alone accounts for 10–30 % throughput loss in microbenchmarks. The V8 team added `AsyncContextFrame` (shipped in Node 22+) as a lighter replacement — more on that in the next lesson.

2. **`init` cost for all I/O resources.** libuv wraps every handle creation through Node's `AsyncWrap` C++ layer. `init` is called synchronously in the same thread before the handle becomes active, so a slow `init` callback directly increases handle creation latency.

3. **Memory pressure from the id map.** If you store state keyed by asyncId, you must listen to `destroy` and clean up — otherwise every promise allocation leaks an entry. In a high-RPS app, hundreds of thousands of promises fire per second; forgetting `destroy` cleanup OOMs the process in minutes.

> [!PITFALL]
> The `destroy` callback is fired by V8's GC finalizer — it is **not** guaranteed to fire promptly or in order. For cleanup of business logic (span ending, resource accounting), use `AsyncResource.runInAsyncScope` with explicit teardown, not `destroy`.

> [!PRINCIPAL]
> `async_hooks` was never intended as a production telemetry API — its original design charter was "make it possible to implement AsyncLocalStorage and zone.js." The performance hit on promise-heavy services can be severe enough that some teams disable it in production and rely on sampling-based tracers instead. Measure with `node --prof` or `clinic flame` before enabling globally.

## Try it yourself

The runnable below simulates the async_hooks id-assignment and parent-child tracking in pure JS, so you can see the causality tree being built without needing Node internals.

```js run
// Async resource tree simulator
// Mirrors the init/before/after lifecycle of async_hooks in pure JS.

let nextId = 2; // start after ROOT (id 1)
const resources = new Map(); // asyncId -> { type, triggerId, children }
let currentId = 1;           // simulates executionAsyncId()

// Register root
resources.set(1, { type: 'ROOT', triggerId: 0, children: [] });

function createResource(type) {
  const id = nextId++;
  const triggerId = currentId;
  resources.set(id, { type, triggerId, children: [] });
  const parent = resources.get(triggerId);
  if (parent) parent.children.push(id);
  console.log(`init  ${type}(${id}) trigger=${triggerId}`);
  return id;
}

function runInContext(asyncId, fn) {
  const prev = currentId;
  currentId = asyncId;
  console.log(`before ${asyncId}`);
  fn();
  console.log(`after  ${asyncId}`);
  currentId = prev;
}

// Simulate: main module creates a "TCP connection" which creates a "Promise"
const tcpId  = createResource('TCPWRAP');
const httpId = createResource('HTTPINCOMINGMESSAGE');

// The TCP accept fires, inside it the HTTP handler runs
runInContext(tcpId, () => {
  const promId = createResource('PROMISE');       // handler creates a promise
  runInContext(httpId, () => {
    const p2 = createResource('PROMISE');         // continuation promise
    runInContext(promId, () => {
      createResource('Timeout');                  // setTimeout inside handler
    });
  });
});

// Reconstruct and print the causal tree
function printTree(id, indent) {
  const r = resources.get(id);
  console.log(`${indent}${r.type}(${id})`);
  for (const child of r.children) printTree(child, indent + '  ');
}

console.log('\n--- Async Resource Tree ---');
printTree(1, '');
```

## Exercise

**Challenge:** Extend the simulator above to track "which root request triggered each resource" — that is, given any asyncId, walk the `triggerId` chain back to find the nearest ancestor whose `type === 'HTTPINCOMINGMESSAGE'` and return its id.

<details>
<summary>Show solution</summary>

```js run
let nextId = 1;
const resources = new Map();
let currentId = 1;

resources.set(1, { type: 'ROOT', triggerId: 0, children: [] });

function createResource(type) {
  const id = nextId++;
  const triggerId = currentId;
  resources.set(id, { type, triggerId, children: [] });
  const parent = resources.get(triggerId);
  if (parent) parent.children.push(id);
  return id;
}

function runInContext(asyncId, fn) {
  const prev = currentId;
  currentId = asyncId;
  fn();
  currentId = prev;
}

// Find the nearest HTTP request ancestor
function findRequestAncestor(asyncId) {
  let id = asyncId;
  while (id > 0) {
    const r = resources.get(id);
    if (!r) return null;
    if (r.type === 'HTTPINCOMINGMESSAGE') return id;
    id = r.triggerId;
  }
  return null;
}

// Build a small resource tree under two simulated HTTP requests
const req1 = createResource('HTTPINCOMINGMESSAGE');
const req2 = createResource('HTTPINCOMINGMESSAGE');

let deepPromise;
runInContext(req1, () => {
  const p = createResource('PROMISE');
  runInContext(p, () => {
    deepPromise = createResource('Timeout');
  });
});

let req2Timer;
runInContext(req2, () => {
  req2Timer = createResource('Timeout');
});

console.log(`Timeout(${deepPromise}) belongs to request:`, findRequestAncestor(deepPromise));
console.log(`Timeout(${req2Timer}) belongs to request:`, findRequestAncestor(req2Timer));
// Timeout(4) belongs to request: 2
// Timeout(5) belongs to request: 3
```

</details>

## Common pitfalls

> [!PITFALL]
> **Forgetting to call `hook.disable()`** in tests or in request-scoped code that creates hooks dynamically. Each `createHook` + `enable()` adds a listener globally for the lifetime of the process. Multiple enabled hooks compound the overhead multiplicatively. Use one shared hook per process, or `AsyncResource` instances for per-request tracking instead of re-hooking.

Equally dangerous: storing anything on the `resource` object passed to `init`. That is the live internal object — mutating it can corrupt Node internals. Always key your side-channel data by asyncId in a separate `Map`.

## What you learned

- `init` fires at resource creation time with `asyncId` and `triggerAsyncId`; the latter is your causality link.
- `before`/`after` bracket every callback dispatch; `promiseResolve` fires when a promise settles.
- `destroy` is GC-driven and non-deterministic — do not rely on it for business logic teardown.
- The async resource tree is a DAG rooted at asyncId 1; APM agents walk it to correlate spans.
- Promise hook overhead is 10–30 % on promise-heavy workloads; Node 22+ ships `AsyncContextFrame` as a lighter path.
- Never use `console.log` inside hook callbacks — use `writeSync(1, …)` to avoid reentrant hook calls.

## Next steps

Now that you understand the machinery underneath, the next lesson covers `AsyncLocalStorage` — the high-level context-propagation API built on top of these hooks — and how Node is migrating it to the much-lower-overhead `AsyncContextFrame` mechanism.
*/});
