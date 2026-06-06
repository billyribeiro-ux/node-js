registerLessonSrc("32-leak-sources", function () {/*
---
id: 32-leak-sources
title: "Common Leak Sources & Fixes"
minutes: 26
level: advanced
objectives:
  - Identify the six most common sources of memory leaks in Node.js services
  - Apply WeakMap, WeakRef, and FinalizationRegistry to break unintended retention
  - Replace unbounded caches with a size-bounded LRU alternative
---

# Common Leak Sources & Fixes

## Why this matters

Most production memory leaks come from the same half-dozen patterns repeated across thousands of
codebases. A senior engineer can usually point to the culprit within minutes of seeing a heap
snapshot — not because they are smarter, but because they have memorised the list. This lesson
gives you that list, the mental model behind each pattern, and the exact tool or technique that
fixes it.

## Learning objectives

- Name and explain the six canonical leak sources.
- Replace unbounded `Map` caches with a bounded LRU cache.
- Use `WeakMap` for per-object metadata, `WeakRef` for optional references, and
  `FinalizationRegistry` for cleanup callbacks.
- Remove event listeners correctly and clear timers that run indefinitely.

## The six canonical leak sources

### 1. Unbounded caches and Maps

The most common leak in long-running services. A developer adds a `Map` to memoize results and
forgets to bound it. Every unique key that ever arrives stays in memory forever.

```js
// LEAKS — grows without bound
const cache = new Map();
function getUser(id) {
  if (!cache.has(id)) cache.set(id, fetchUserSync(id));
  return cache.get(id);
}
```

The fix is to enforce a maximum size. The simplest correct data structure is an **LRU (Least
Recently Used) cache**: when the cache is full, evict the entry that was accessed least recently.

```js
// Safe — bounded LRU (see the full implementation in the runnable block)
const cache = new LRUCache({ maxSize: 500 });
```

> [!PITFALL] "We'll add a TTL later" is how leaks ship
> Deferring a bound on a cache until "performance becomes a problem" means it ships to production
> unbounded. Set the limit at creation time, even if the initial value is generous.

### 2. Forgotten event listeners

Every call to `emitter.on(event, listener)` adds a reference from the emitter to the listener
function. If the emitter outlives the object that registered the listener, that object can never
be garbage-collected.

```js
import { EventEmitter } from "node:events";

class ConnectionPool {
  constructor(globalBus) {
    // LEAKS: 'globalBus' lives forever; every Pool created adds a listener
    // that holds a reference back into the Pool instance.
    globalBus.on("config-update", (cfg) => this.reconfigure(cfg));
  }
  reconfigure(cfg) { // implementation omitted
  }
}
```

Fix: store the listener reference and call `removeListener` (alias: `off`) in a `close()` or
`destroy()` method.

```js
class ConnectionPool {
  constructor(globalBus) {
    this._bus = globalBus;
    this._onConfig = (cfg) => this.reconfigure(cfg);
    globalBus.on("config-update", this._onConfig);
  }
  reconfigure(cfg) { // implementation omitted
  }
  close() {
    this._bus.off("config-update", this._onConfig);
  }
}
```

Node warns you when an emitter has more than 10 listeners on one event — that warning is almost
always a sign that listener cleanup is missing. Heed it immediately.

> [!NOTE] `once()` is automatically self-cleaning
> `emitter.once(event, fn)` removes the listener after the first call. For events you only need to
> handle once, prefer `once()` over manually calling `off()`.

### 3. Closures holding large objects

A closure captures variables from its surrounding scope — not copies of values, but live
references to the variables themselves. If a long-lived function closes over a large object, that
object is pinned in memory for as long as the closure lives.

```js
function processRequest(req) {
  const bigBuffer = Buffer.alloc(10 * 1024 * 1024); // 10 MB
  // ... do work with bigBuffer ...

  // LEAKS: setInterval captures the entire function scope, keeping bigBuffer alive
  const id = setInterval(() => {
    console.log("request count:", req.id);
  }, 5000);
  // bigBuffer is no longer needed but cannot be collected
}
```

Fix: extract only what you need into a small closure, or explicitly null the variable after use.

```js
function processRequest(req) {
  const bigBuffer = Buffer.alloc(10 * 1024 * 1024);
  const result = compress(bigBuffer); // use it
  // bigBuffer is no longer needed

  const reqId = req.id; // capture only the scalar
  const id = setInterval(() => {
    console.log("request count:", reqId); // no reference to bigBuffer
  }, 5000);
  clearInterval(id); // and still clear it when done!
}
```

### 4. Global arrays and module-level state

Module-level variables are singletons for the lifetime of the process. Any data pushed into a
global array or attached to `global` never leaves unless you explicitly remove it.

```js
// top of module — lives forever
const auditLog = [];

function recordEvent(event) {
  auditLog.push({ ts: Date.now(), event }); // LEAKS — array grows forever
}
```

Fix: cap the array, drain it to a database, or use a ring buffer.

```js
const MAX_LOG = 10_000;
const auditLog = [];

function recordEvent(event) {
  if (auditLog.length >= MAX_LOG) auditLog.shift(); // evict oldest
  auditLog.push({ ts: Date.now(), event });
}
```

### 5. Timers not cleared

`setInterval` and `setTimeout` callbacks hold references to their closure scope. An interval that
runs indefinitely and captures a large object is a leak. Equally, a `setTimeout` that fires well
in the future holds everything in scope until it fires.

```js
// LEAKS if the service "shuts down" without clearing the interval
function startHeartbeat(connection) {
  setInterval(() => connection.ping(), 1000); // no reference stored — can never clear it
}
```

Fix: always store the timer ID and clear it on shutdown.

```js
function startHeartbeat(connection) {
  const id = setInterval(() => connection.ping(), 1000);
  return () => clearInterval(id); // return a dispose function
}
const stopHeartbeat = startHeartbeat(conn);
// later, during cleanup:
stopHeartbeat();
```

### 6. Closures in promise chains and async callbacks

Promises form chains. Each `.then()` callback captures its surrounding scope. A promise that
never resolves (or resolves very late) keeps every closure in its chain alive.

```js
// LEAKS if the request never responds — the 10 MB body is captured forever
async function slowQuery(bigBody) {
  const result = await db.query({ body: bigBody }); // might hang
  return result;
}
```

The pattern is the same as closures: capture only what you need. If a promise might hang, add a
timeout using `Promise.race`.

## Weak references: WeakMap, WeakRef, FinalizationRegistry

JavaScript's garbage collector cannot collect an object as long as any strong reference to it
exists. **Weak references** do not count toward reachability, allowing the GC to collect the
target.

### `WeakMap` — per-object metadata without retention

```js
// LEAKS: Map strongly references every DOM node / object passed to it
const metadata = new Map();
metadata.set(someObject, { role: "admin" });
// if 'someObject' goes away, Map still holds it alive

// CORRECT: WeakMap allows 'someObject' to be collected
const metadata = new WeakMap();
metadata.set(someObject, { role: "admin" });
// when nothing else references 'someObject', the entry disappears automatically
```

> [!PRINCIPAL] WeakMap is the canonical tool for private per-instance data
> Libraries like React and many Node frameworks use `WeakMap` to store internal state keyed by
> caller-provided objects. Because the map doesn't prevent collection, there is no cleanup
> ceremony — the entry evaporates when the object it annotates does. This is significantly more
> robust than manually calling a `.destroy()` method.

### `WeakRef` — an optional reference that may be null

```js
// WeakRef is a global in Node 24 — no import needed
class Cache {
  constructor(compute) {
    this._cache = new Map();
    this._compute = compute;
  }
  get(key) {
    const ref = this._cache.get(key);
    const val = ref && ref.deref(); // null if collected
    if (val !== undefined) return val;
    const fresh = this._compute(key);
    this._cache.set(key, new WeakRef(fresh));
    return fresh;
  }
}
```

`deref()` returns the value or `undefined` if the GC has collected it. This is perfect for
optional caches where a miss is acceptable.

### `FinalizationRegistry` — run code when an object is collected

```js
const registry = new FinalizationRegistry((heldValue) => {
  console.log("cleaned up:", heldValue);
  // close a file handle, unregister from a registry, etc.
});

function createSubscription(stream) {
  const sub = { handler: () => stream.resume() };
  registry.register(sub, "subscription-for-" + stream.id);
  return sub;
}
```

> [!WARNING] FinalizationRegistry callbacks are non-deterministic
> The GC may run the callback at any time, or not at all before process exit. Never depend on it
> for correctness — use it only for *best-effort* cleanup of external resources.

## Try it yourself

Here is a side-by-side demonstration: an unbounded `Map` grows without limit, while an LRU cache
of the same maximum size evicts old entries. Watch the entry count diverge.

```js run
// A simple LRU cache backed by a Map (insertion order = access order via re-insertion)
class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this._map = new Map();
  }
  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    // refresh: delete then re-insert to mark as most-recently used
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, val);
    if (this._map.size > this.maxSize) {
      // evict least-recently used (first inserted key)
      const lruKey = this._map.keys().next().value;
      this._map.delete(lruKey);
    }
  }
  get size() { return this._map.size; }
}

const MAX = 5;
const unbounded = new Map();
const lru       = new LRUCache(MAX);

// Simulate 12 unique keys arriving
for (let i = 1; i <= 12; i++) {
  unbounded.set(`key-${i}`, { data: i });
  lru.set(`key-${i}`, { data: i });
}

console.log("Unbounded map size:", unbounded.size); // 12 — keeps growing
console.log("LRU cache size:    ", lru.size);       // 5  — capped

// LRU should only retain the 8 most recent keys
console.log("LRU has key-1:", lru.get("key-1") !== undefined); // false — evicted
console.log("LRU has key-8:", lru.get("key-8") !== undefined); // true  — still live
```

## Exercises

**Challenge 1:** The following `EventManager` leaks because it never removes its listeners.
Rewrite it so that `manager.destroy()` cleans everything up.

```js run
// Starter — observe the leak (listener count grows)
function makeEmitter() {
  const listeners = {};
  return {
    on(event, fn)  { (listeners[event] = listeners[event] || []).push(fn); },
    emit(event, d) { (listeners[event] || []).forEach(fn => fn(d)); },
    listenerCount(event) { return (listeners[event] || []).length; }
  };
}

const bus = makeEmitter();

class EventManager {
  constructor(bus) {
    this._bus = bus;
    bus.on("data", (d) => console.log("got:", d));
  }
  // missing: destroy()
}

const m1 = new EventManager(bus);
const m2 = new EventManager(bus);
console.log("listener count:", bus.listenerCount("data")); // 2 — and growing
```

<details>
<summary>Show solution</summary>

```js run
function makeEmitter() {
  const listeners = {};
  return {
    on(event, fn)  { (listeners[event] = listeners[event] || []).push(fn); },
    off(event, fn) {
      listeners[event] = (listeners[event] || []).filter(f => f !== fn);
    },
    emit(event, d) { (listeners[event] || []).forEach(fn => fn(d)); },
    listenerCount(event) { return (listeners[event] || []).length; }
  };
}

const bus = makeEmitter();

class EventManager {
  constructor(bus) {
    this._bus = bus;
    this._onData = (d) => console.log("got:", d);
    bus.on("data", this._onData);
  }
  destroy() {
    this._bus.off("data", this._onData);
  }
}

const m1 = new EventManager(bus);
const m2 = new EventManager(bus);
console.log("before destroy:", bus.listenerCount("data")); // 2
m1.destroy();
m2.destroy();
console.log("after destroy: ", bus.listenerCount("data")); // 0 — clean
```

</details>

**Challenge 2:** Rewrite the unbounded `auditLog` array below as a fixed-size ring buffer that
never exceeds 5 entries.

<details>
<summary>Show solution</summary>

```js run
class RingBuffer {
  constructor(max) {
    this._buf = new Array(max);
    this._max = max;
    this._head = 0; // next write position
    this._size = 0;
  }
  push(item) {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._max;
    if (this._size < this._max) this._size++;
  }
  toArray() {
    const result = [];
    // items stored in oldest-first order
    let start = this._size < this._max ? 0 : this._head;
    for (let i = 0; i < this._size; i++) {
      result.push(this._buf[(start + i) % this._max]);
    }
    return result;
  }
  get size() { return this._size; }
}

const log = new RingBuffer(5);
for (let i = 1; i <= 8; i++) log.push(`event-${i}`);
console.log("size:", log.size);         // 5
console.log("entries:", log.toArray()); // event-4 … event-8
```

</details>

## Common pitfalls

> [!PITFALL] Using WeakRef for caches without also cleaning up Map keys
> A `WeakRef` in a `Map` only makes the *value* weakly held. The Map key (a string, number, or
> symbol) is still a strong reference — the key entry stays in the Map even after the value is
> collected. Pair a `WeakRef` cache with a `FinalizationRegistry` that deletes the stale key, or
> use a `WeakMap` where the key itself is the object you want to weakly reference.

## What you learned

- **Unbounded caches** are the most common leak; fix them with a bounded LRU eviction policy.
- **Forgotten event listeners** pin objects alive; always store the reference and call `off()` on
  teardown.
- **Closures** capture entire scopes; minimise what you capture and clear timers you start.
- **Global / module-level state** lives forever; cap or drain it actively.
- `WeakMap` holds per-object metadata without preventing collection; `WeakRef` gives an optional
  reference that can become `undefined`; `FinalizationRegistry` runs best-effort cleanup.

## Next steps

You now know what to look for; the final lesson in this module covers how to detect these leaks in
a live production environment — trending memory metrics, the triage runbook, and safely capturing
snapshots under load.
*/});
