registerLessonSrc("43-async-local-storage", function () {/*
---
id: 43-async-local-storage
title: "AsyncLocalStorage Internals & Context Propagation"
minutes: 28
level: advanced
objectives:
  - Explain how AsyncLocalStorage.run/getStore propagates context across awaits, timers, and callbacks
  - Understand the shift from async_hooks PromiseHook to AsyncContextFrame and why it matters for overhead
  - Identify and fix context-loss bugs across EventEmitters, connection pools, and manual thread boundaries
---

# AsyncLocalStorage Internals & Context Propagation

## Why this matters

Every serious Node.js service needs *implicit* context propagation: a request-id that follows a call chain through `await`, `setTimeout`, worker pools, and third-party callbacks — without threading it as an argument through every function signature. `AsyncLocalStorage` is the production-grade answer, and since Node 22 it runs on a fundamentally lighter engine than the `async_hooks` PromiseHook it replaced. Understanding the internals lets you build zero-boilerplate tracing, diagnose context-loss bugs that surface only in production under concurrent load, and reason correctly about the remaining overhead cost.

## Learning objectives

- Describe what happens at the C++ level when `AsyncLocalStorage.run()` is called.
- Explain why context survives `await` but can be lost across certain EventEmitter patterns.
- Know the `AsyncContextFrame` (Node 22+) model and how it differs from the PromiseHook path.
- Recognise the four concrete pitfall patterns and apply the correct fix for each.

## The public API surface

```js
import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

// In your HTTP handler:
function handleRequest(req, res) {
  const store = { requestId: crypto.randomUUID(), startMs: Date.now() };
  requestContext.run(store, () => {
    // Everything called synchronously or asynchronously inside this callback
    // can read the store — including across awaits and timers.
    processRequest(req, res);
  });
}

async function processRequest(req, res) {
  const ctx = requestContext.getStore(); // { requestId, startMs }
  await db.query('SELECT 1');           // context survives the await
  logger.info({ requestId: ctx.requestId }, 'query done');
}
```

> [!OUTPUT]
> {"level":"info","requestId":"a3f2...","msg":"query done"}

The key insight: `requestContext.run(store, fn)` does not just call `fn()`. It installs `store` as the *active store* for the current async context frame, then calls `fn`. Any async resource created inside `fn` (a Promise returned by `fn`, a `setTimeout` within it, a net socket it opens) inherits that frame, so `getStore()` returns the same object anywhere in that causal subtree.

## How it worked before: the async_hooks PromiseHook path

Before Node 22 the implementation was straightforward but expensive:

1. `AsyncLocalStorage` implemented `AsyncResource` and registered an `async_hooks` hook.
2. On every Promise `init` hook call, Node copied the current store map into the new Promise's internal slot via `AsyncResource._emitInitNativeHook`.
3. On every `before` callback, Node swapped the active store map to match the target asyncId.
4. On every `after` callback, Node swapped back.

The cost was proportional to promise throughput: at 50k requests/second, each request spawning ~20 promise continuations, that is 1 million `init`+`before`+`after` triples per second, each touching a V8-internal `PromiseHook` C++ callback. Overhead was measured at **10–30 % throughput reduction** on promise-heavy services even when the store was empty.

> [!PRINCIPAL]
> The PromiseHook design meant that even code that never called `getStore()` paid the overhead cost just because *some* `AsyncLocalStorage` instance existed somewhere in the process. This was a trap for library authors: publishing a package that created a global `AsyncLocalStorage` would silently slow down every app that `require`d it, with no obvious cause visible in CPU profiles.

## AsyncContextFrame: the Node 22 lightweight path

Node 22 shipped a fundamentally different implementation, landed as part of the TC39 "Async Context" proposal work, backed by V8's new `AsyncContextFrame` API (distinct from the `PromiseHook` API):

- Instead of copying state on every promise event, V8 now maintains an **immutable linked-list frame** attached to each Promise internally. The frame is cheap to create (a pointer assignment) and cheap to read (a pointer dereference).
- `AsyncLocalStorage.run(store, fn)` creates a new `AsyncContextFrame` node with a reference to the store map. This frame is stored in V8's `Isolate::async_context_frame_` field.
- When a `Promise` is created, V8 captures the current `AsyncContextFrame` pointer into the Promise's internal slot — no user-space hook callback fires.
- When a microtask runs, V8 restores the captured frame before calling the callback — again, no hook callback.
- `getStore()` reads from the current frame in O(1) — it just dereferences the isolate field and looks up the key.

The result: with no hooks enabled, overhead drops to **< 1 % on promise-heavy workloads** in Node 22+ benchmarks. The PromiseHook path still exists as a fallback for legacy `createHook` users, and the two systems coexist — but `AsyncLocalStorage` now uses the fast path exclusively.

> [!PRINCIPAL]
> The `AsyncContextFrame` linked-list is immutable by design: each `run()` call creates a new node pointing to the parent, it never mutates the parent. This makes concurrent contexts safe — two simultaneous requests each have their own frame chain and can never accidentally overwrite each other's store. The only shared mutable state is the isolate's "current frame" pointer, which V8 manages correctly across microtask switches.

## Propagation across different async primitives

### Survives ✓

```js
// async/await — frame captured at Promise creation
const store = als.getStore(); // works after every await

// setTimeout / setImmediate — frame captured when timer is registered
setTimeout(() => als.getStore(), 1000); // works

// Promise.all, Promise.race — each branch inherits the caller's frame
await Promise.all([fetchA(), fetchB()]); // both branches see the same store

// EventEmitter when listener is registered inside run()
emitter.on('data', () => als.getStore()); // works if on() was called inside run()

// worker_threads via AsyncResource.bind
const bound = AsyncResource.bind(() => als.getStore());
// bound can be called from any thread and sees the captured context
```

### Does NOT survive by default ✗

```js
// EventEmitter listener registered OUTSIDE run(), called INSIDE
const emitter = new EventEmitter();
emitter.on('data', () => als.getStore()); // registered outside — returns undefined
als.run(store, () => emitter.emit('data')); // emit inside run — too late, listener has no frame
```

This is the most common production context-loss bug. The fix:

```js
// Option A: register the listener inside run()
als.run(store, () => {
  emitter.on('data', () => als.getStore()); // listener inherits frame
  emitter.emit('data');
});

// Option B: use AsyncResource.bind at listener registration time
const boundListener = AsyncResource.bind(() => als.getStore(), 'emitter-listener');
emitter.on('data', boundListener);
// Now calling emitter.emit('data') anywhere restores the captured context.
```

### Connection/thread pool boundaries

Worker thread message handlers and connection pool callback reuse are another source of loss:

```js
// Generic pool: a callback reused across requests loses context
pool.acquire((conn) => {
  // conn.query is called later from a pool-internal context — not yours
  conn.query('SELECT 1', (err, rows) => {
    als.getStore(); // undefined — the pool dispatched this in its own context
  });
});

// Fix: capture and restore explicitly with AsyncResource
import { AsyncResource } from 'node:async_hooks';
pool.acquire((conn) => {
  const resource = new AsyncResource('pool-query');
  conn.query('SELECT 1', resource.runInAsyncScope.bind(resource, (err, rows) => {
    als.getStore(); // now correctly restored
  }));
});
```

> [!PITFALL]
> Libraries that cache callbacks (connection pools, HTTP keep-alive agents, worker queues) almost universally break `AsyncLocalStorage` because they dispatch the callback in a context that was created when the pool was initialised, not when your request called `acquire()`. Always check whether a library's callbacks run in the caller's async context before trusting `getStore()`. The `node:undici` HTTP client and `pg` >= 8.11 correctly propagate context; many older clients do not.

## The enterWith escape hatch

`AsyncLocalStorage.enterWith(store)` changes the store for the **current** execution context without a `run()` scope boundary. It is useful for middleware patterns where you cannot wrap the entire handler in a closure:

```js
// Express-style middleware
app.use((req, res, next) => {
  als.enterWith({ requestId: req.headers['x-request-id'] });
  next(); // everything downstream in this request's sync/async flow sees the store
});
```

> [!WARNING]
> `enterWith` is permanent for the remainder of the current async context — there is no automatic "exit" when the middleware returns. If you call `enterWith` on the root context (asyncId 1), it changes the store for all future callbacks that inherit from the root. Use `run()` when you can; only reach for `enterWith` in framework middleware where wrapping is architecturally impossible.

## Implementing a run+stack model in pure JS

To cement your understanding, here is a pure-JS implementation that models `AsyncLocalStorage` semantics using a stack of context frames — the conceptual ancestor of the real `AsyncContextFrame` linked list.

## Try it yourself

```js run
// Pure-JS AsyncLocalStorage-like context propagation.
// Models: run(store, fn), getStore(), and nested run() stacking.
// Demonstrates that context propagates into nested callbacks and is
// restored correctly after the scope exits.

class SimpleContextStorage {
  constructor() {
    this._stack = [undefined]; // frame stack; [0] = root = undefined
  }

  run(store, fn) {
    this._stack.push(store);
    try {
      return fn();
    } finally {
      this._stack.pop();
    }
  }

  getStore() {
    return this._stack[this._stack.length - 1];
  }

  // Simulate what V8 does when creating an async resource inside run():
  // it captures the current top-of-stack so the callback can restore it.
  _captureFrame() {
    const captured = this._stack[this._stack.length - 1];
    return (fn) => {
      this._stack.push(captured);
      try { return fn(); }
      finally { this._stack.pop(); }
    };
  }
}

const als = new SimpleContextStorage();

// Simulate Promise.then(): capture the frame at .then() time, restore at callback time
function simulateThen(captureFrame, fn) {
  const restore = captureFrame();
  // "microtask queue dispatch" — in reality V8 does this asynchronously
  return () => restore(fn);
}

// --- Scenario 1: basic run + getStore ---
als.run({ requestId: 'req-1' }, () => {
  console.log('inside run:', als.getStore().requestId); // req-1

  // Simulate a .then() callback (frame captured now, called "later")
  const thunk = simulateThen(als._captureFrame.bind(als), () => {
    console.log('in .then():', als.getStore().requestId); // req-1 — context survives
  });

  // --- Scenario 2: nested run() creates a child context ---
  als.run({ requestId: 'req-2' }, () => {
    console.log('nested run:', als.getStore().requestId); // req-2
    const thunk2 = simulateThen(als._captureFrame.bind(als), () => {
      console.log('nested .then():', als.getStore().requestId); // req-2
    });
    thunk2(); // dispatch nested callback
  });

  console.log('after nested run:', als.getStore().requestId); // req-1 restored
  thunk(); // dispatch outer callback
});

console.log('outside run:', als.getStore()); // undefined — no active context
```

## Exercise

**Challenge:** Extend the `SimpleContextStorage` above to support `enterWith(store)` semantics — mutate the current frame in place so that future captured closures inherit the new value, without a `run()` scope boundary. Then demonstrate that a closure captured *before* `enterWith` still sees the old value, while one captured *after* sees the new value.

<details>
<summary>Show solution</summary>

```js run
class ContextStorage {
  constructor() {
    // Use an object reference so mutations are visible to all holders of the same ref
    this._frame = { value: undefined };
  }

  run(store, fn) {
    const prev = this._frame;
    this._frame = { value: store };
    try { return fn(); }
    finally { this._frame = prev; }
  }

  getStore() { return this._frame.value; }

  // enterWith: mutate the CURRENT frame object (affects all closures holding this ref)
  enterWith(store) { this._frame.value = store; }

  captureFrame() {
    const snapshot = this._frame; // capture reference, not value
    return (fn) => {
      const prev = this._frame;
      this._frame = snapshot;
      try { return fn(); }
      finally { this._frame = prev; }
    };
  }
}

const als = new ContextStorage();

// Capture BEFORE enterWith
const restoreBefore = als.captureFrame();

als.enterWith({ requestId: 'middleware-set' });
console.log('after enterWith:', als.getStore().requestId); // middleware-set

// Capture AFTER enterWith
const restoreAfter = als.captureFrame();

// Dispatch "before" callback — sees undefined (captured the root empty frame)
restoreBefore(() => {
  console.log('before-capture sees:', als.getStore()); // undefined
});

// Dispatch "after" callback — sees middleware-set
restoreAfter(() => {
  console.log('after-capture sees:', als.getStore().requestId); // middleware-set
});
```

</details>

## Common pitfalls

> [!PITFALL]
> **Sharing a store object across requests.** `AsyncLocalStorage.run(store, fn)` stores the *reference* to `store` — it does not clone it. If you pass the same object to concurrent requests (e.g. a module-level singleton), mutations from one request overwrite the other's data. Always construct a fresh store object per `run()` call: `als.run({ requestId: uuid() }, fn)`.

A second common mistake: calling `als.getStore()` in module-level initialisation code that runs before any `run()` call. It returns `undefined`, and if the caller destructures it without a null guard the process throws. Always guard: `const ctx = als.getStore() ?? {}`.

## What you learned

- `AsyncLocalStorage.run(store, fn)` installs a frame; every async resource created inside inherits it; `getStore()` reads it in O(1).
- Node 22+ uses `AsyncContextFrame` (a V8 pointer in each Promise's internal slot) instead of PromiseHook callbacks, dropping overhead from ~10–30 % to < 1 %.
- Context propagates through `await`, timers, and EventEmitter listeners registered *inside* `run()`, but is lost across listeners registered outside — fix with `AsyncResource.bind`.
- Connection pools and reused callbacks break context by default; wrap with `AsyncResource.runInAsyncScope`.
- `enterWith` is a mutable escape hatch for middleware patterns; `run()` is always safer.

## Next steps

Now that you can propagate context cheaply, the next lesson covers `diagnostics_channel` and `--trace-event-categories` — the instrumentation layer that lets you *observe* what that context carries through a production system without stopping it.
*/});
