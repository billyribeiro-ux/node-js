registerLessonSrc("31-garbage-collection", function () {/*
---
id: 31-garbage-collection
title: "Garbage Collection & GC-Friendly Code"
minutes: 28
level: advanced
objectives:
  - Understand V8's generational garbage collector — young space, old space, scavenge, and mark-sweep-compact
  - Identify allocation patterns that stress the GC and increase pause times
  - Apply object pooling and other GC-friendly techniques to reduce allocation pressure
---

# Garbage Collection & GC-Friendly Code

## Why this matters

Garbage collection is invisible — until it is not. A Node server that allocates aggressively can pause for tens of milliseconds while the GC compacts old-generation objects. Those pauses show up as p99 latency spikes that are almost impossible to debug without understanding *why* they happen. Writing GC-friendly code is not premature optimisation for high-throughput services; it is the difference between a flat latency curve and one that terrifies your SREs.

@diagram:gc-generations

## Learning objectives

- Describe V8's **generational GC**: young generation (semi-space scavenge) and old generation (mark-sweep-compact).
- Recognise allocation patterns that promote objects into old space and trigger major GCs.
- Implement **object pooling** to reuse objects rather than allocating new ones.
- Use `--max-old-space-size` and `--expose-gc` correctly in development and production.

## Generational GC: the two-generation model

V8 divides the heap into two regions based on a key observation — *most objects die young*. This is the **generational hypothesis**.

**Young generation (new space)**

Newly allocated objects go into two equal semi-spaces — "from" and "to" — each a few MB in size. The collector that works here is called **Scavenge** (or Cheney's algorithm):

1. Walk all live objects in the "from" space.
2. Copy survivors to the "to" space.
3. Flip "from" and "to".

Because most objects are dead by the time scavenge runs, only a small fraction of memory gets copied. Scavenge is extremely fast — typically under 1 ms — and runs frequently.

**Old generation (old space)**

Objects that survive two scavenges are **promoted** to old space. Old space is collected by **Mark-Sweep-Compact**:

1. **Mark** — traverse the object graph from GC roots, marking every live object.
2. **Sweep** — reclaim the memory of unmarked (dead) objects.
3. **Compact** — optionally move live objects together to reduce fragmentation.

Mark-sweep-compact is expensive. It touches every live object in the heap and can pause the process for tens to hundreds of milliseconds. V8 mitigates this with **incremental marking** and **concurrent sweeping** (running GC work on background threads), but major pauses still happen.

```js
// node --expose-gc pause-demo.js
// --expose-gc enables gc() as a global function (dev/bench only)

const used = () => process.memoryUsage().heapUsed;

const before = used();
const arr = [];
for (let i = 0; i < 1_000_000; i++) arr.push({ id: i, value: Math.random() });
const afterAlloc = used();

// Force a full GC (never do this in production)
gc();
const afterGC = used();

console.log(`Before alloc : ${(before       / 1024 / 1024).toFixed(1)} MB`);
console.log(`After alloc  : ${(afterAlloc   / 1024 / 1024).toFixed(1)} MB`);
console.log(`After GC     : ${(afterGC      / 1024 / 1024).toFixed(1)} MB`);
```

> [!OUTPUT]
> Before alloc : 4.2 MB
> After alloc  : 89.3 MB
> After GC     : 5.1 MB

> [!NOTE] --expose-gc is for development and benchmarks only
> Calling `gc()` manually in production defeats the purpose of the GC heuristics and can make throughput *worse* by triggering major collections at arbitrary times. Use it only in benchmarks and memory-leak investigations.

## What stresses the GC

**Short-lived temporaries in hot paths.**
Every object literal `{}` or array `[]` created inside a tight loop or a per-request handler becomes a new allocation. Most will die quickly (good for scavenge) but if the loop is long enough, the young generation fills up and triggers many scavenges — or worse, objects get promoted simply because they are alive during a scavenge cycle.

```js
// node server-naive.js  (read-only illustration)
import http from "node:http";

http.createServer((req, res) => {
  // BAD: a fresh object and array allocated on every request
  const ctx = { url: req.url, ts: Date.now(), headers: {} };
  const parts = req.url.split("/");   // new array each time
  res.end(parts[parts.length - 1]);
}).listen(3000);
```

> [!OUTPUT]
> (server listening — no console output until requests arrive)

**Large object allocation.**
Objects over ~512 KB skip the young generation entirely and land directly in old space (large object space). Allocating and releasing large buffers frequently causes major GC cycles.

**Closures capturing large scopes.**
A closure keeps its entire enclosing scope alive. If a request handler closes over a multi-megabyte dataset, that dataset cannot be collected until the handler finishes.

> [!PITFALL] Closures in event listeners are a memory-leak vector
> Adding an event listener inside a loop without removing it creates a closure that keeps the enclosing scope alive for as long as the emitter exists. Always call `emitter.off(event, handler)` when done, or use `{ once: true }` for one-shot listeners.

## Controlling heap size

```bash
# Allow up to 4 GB for old-generation space (default is ~1.5 GB on 64-bit)
node --max-old-space-size=4096 server.js

# Observe GC activity in real time
node --trace-gc server.js

# Detailed GC tracing with pauses and heap sizes
node --trace-gc-verbose server.js
```

> [!WARNING] --max-old-space-size does not fix leaks
> Increasing heap size delays the out-of-memory crash but does not fix the underlying leak. Always investigate with `--trace-gc`, heap snapshots, or `--heapsnapshot-signal` before raising the limit.

## Object pooling: reuse instead of allocate

The most effective GC-friendly technique for hot paths is an **object pool**: instead of allocating a new object and discarding it, you borrow an object from a pre-allocated pool, use it, and return it when done.

```js
// node pool-server.js  (read-only illustration)
class Pool {
  constructor(factory, size = 256) {
    this._free = Array.from({ length: size }, factory);
    this._factory = factory;
  }
  acquire() {
    return this._free.length > 0 ? this._free.pop() : this._factory();
  }
  release(obj) {
    this._free.push(obj);
  }
}

const ctxPool = new Pool(() => ({ url: "", ts: 0, headers: null }));

import http from "node:http";

http.createServer((req, res) => {
  const ctx = ctxPool.acquire();
  ctx.url     = req.url;
  ctx.ts      = Date.now();
  ctx.headers = req.headers;

  res.end(ctx.url.split("/").pop());

  // Reset and return to pool — no garbage generated
  ctx.url = "";
  ctx.ts  = 0;
  ctx.headers = null;
  ctxPool.release(ctx);
}).listen(3000);
```

> [!OUTPUT]
> (server listening)

> [!PRINCIPAL] Pooling is a trade-off, not a free lunch
> Object pools reduce GC pressure but introduce complexity: you must reset objects before release (stale data leaks between requests), size the pool correctly (too small — you allocate anyway; too large — you waste memory), and handle pool exhaustion gracefully. Profile allocation pressure with `--prof` and Chrome DevTools before committing to a pool. Pools shine for objects that are always the same shape and are allocated in tight, predictable loops — they are overkill for occasional allocations.

## Try it yourself

This runnable example implements a minimal object pool and measures the allocation reduction compared to creating fresh objects in a loop. In a real V8 environment, the pool version generates far fewer young-generation allocations.

```js run
// Object pool vs fresh allocation — compare total "work" done.
// In a real Node process you'd observe fewer GC cycles with the pool.

class Pool {
  constructor(factory, size) {
    this._free = Array.from({ length: size }, factory);
    this._factory = factory;
    this.acquired = 0;
    this.reused   = 0;
  }
  acquire() {
    this.acquired++;
    if (this._free.length > 0) { this.reused++; return this._free.pop(); }
    return this._factory();
  }
  release(obj) {
    // Reset before returning so stale data cannot leak
    obj.id    = 0;
    obj.value = 0;
    this._free.push(obj);
  }
}

const ITERATIONS = 10_000;
const POOL_SIZE  = 64;

// --- Pool approach ---
const pool = new Pool(() => ({ id: 0, value: 0 }), POOL_SIZE);

let t0 = performance.now();
let checksum1 = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const obj = pool.acquire();
  obj.id    = i;
  obj.value = i * 1.5;
  checksum1 += obj.value;
  pool.release(obj);
}
let poolMs = performance.now() - t0;

// --- Fresh allocation approach ---
let t1 = performance.now();
let checksum2 = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const obj = { id: i, value: i * 1.5 };
  checksum2 += obj.value;
  // obj becomes garbage here
}
let freshMs = performance.now() - t1;

console.log(`Pool:  ${poolMs.toFixed(2)} ms  (${pool.reused}/${pool.acquired} reused)`);
console.log(`Fresh: ${freshMs.toFixed(2)} ms`);
console.log(`Checksums match: ${checksum1 === checksum2}`);
// Note: in a sandbox the JIT may optimise away the fresh allocations entirely;
// in real Node the pool advantage is most visible under GC pressure.
```

## Exercise

**Challenge:** Extend the pool above to handle the case where the pool is exhausted (more `acquire` calls than pool size without intervening `release`). Log a warning and still return a valid object.

<details>
<summary>Show solution</summary>

```js run
class BoundedPool {
  constructor(factory, maxSize) {
    this._free    = Array.from({ length: maxSize }, factory);
    this._factory = factory;
    this._maxSize = maxSize;
    this._out     = 0;
    this.warnings = 0;
  }
  acquire() {
    if (this._free.length === 0) {
      this.warnings++;
      console.warn(`[Pool] exhausted (${this._out} objects in flight) — allocating overflow`);
      this._out++;
      return this._factory();
    }
    this._out++;
    return this._free.pop();
  }
  release(obj) {
    this._out--;
    if (this._free.length < this._maxSize) {
      obj.id = 0; obj.value = 0;
      this._free.push(obj);
    }
    // If pool is somehow over-full just let the object be GC'd
  }
}

const pool = new BoundedPool(() => ({ id: 0, value: 0 }), 3);

// Acquire more than pool size to trigger the warning
const held = [];
for (let i = 0; i < 5; i++) held.push(pool.acquire());
console.log(`Objects in flight: ${held.length}, warnings: ${pool.warnings}`);

// Release all
held.forEach(o => pool.release(o));
console.log(`Pool free after release: ${pool._free.length}`);
```

</details>

## Project

### Micro-benchmark experiments: hidden-class deopts and IC effects

Run a suite of micro-benchmark experiments that concretely demonstrate how hidden-class transitions and inline-cache pollution degrade performance. Instrument your benchmarks to explain *what* V8 is doing internally, not just show a number.

**Acceptance criteria**

1. **Shape-stable vs shape-unstable constructor benchmark** — create two constructor functions that build objects with the same properties but in different orders (or conditionally). Time 100 000 property reads through a single accessor function on each set. Record and print the ratio.
2. **IC state demonstration** — show monomorphic, polymorphic (2–4 shapes), and megamorphic (5+ shapes) call sites. Use three separate accessor functions so each IC starts fresh. Print the timing for all three tiers.
3. **Delete penalty** — benchmark property access on objects before and after `delete obj.prop` is used. Show that delete demotes to dictionary mode and explain it in a comment.
4. **Object-pool allocation** — implement a pool and compare per-iteration time against fresh-allocation for at least 50 000 iterations. Print reuse rate.
5. **Explanation comments** — every benchmark section must have a `// WHY:` comment explaining what V8 does internally to cause the measured result.
6. **Consistent results** — each benchmark must run the hot loop at least twice and print the *second* result (discarding the first as warm-up noise), and results must show a clear, non-trivial difference between fast and slow paths.

**Starter — shape benchmark core logic (pure JS, no Node APIs)**

```js run
// Starter: shape-stable vs shape-unstable — IC monomorphic vs megamorphic.
// Expand this into the full project by adding delete-penalty, pool, and IC-state experiments.

function stableFactory(i)   { return { x: i, y: i * 2, z: i * 3 }; }
function unstableFactory(i) {
  // WHY: alternating key order creates two distinct hidden classes,
  // driving the accessor IC from monomorphic to polymorphic.
  if (i % 2 === 0) return { x: i, y: i * 2, z: i * 3 };
  return { z: i * 3, y: i * 2, x: i };
}

function readX(obj) { return obj.x; }  // IC lives here

const N = 80_000;
const stable   = Array.from({ length: N }, (_, i) => stableFactory(i));
const unstable = Array.from({ length: N }, (_, i) => unstableFactory(i));

function bench(label, arr) {
  // Run twice; report second to discard cold-start noise.
  let sum = 0;
  for (let i = 0; i < N; i++) sum += readX(arr[i]);  // warm-up

  const t0 = performance.now();
  let s2 = 0;
  for (let i = 0; i < N; i++) s2 += readX(arr[i]);
  const ms = performance.now() - t0;
  console.log(`${label}: ${ms.toFixed(2)} ms  (sum=${s2})`);
  return ms;
}

const stableMs   = bench("Stable shapes  ", stable);
const unstableMs = bench("Unstable shapes", unstable);
console.log(`Ratio: ${(unstableMs / stableMs).toFixed(2)}x`);
```

## Common pitfalls

> [!PITFALL] Assuming the GC is your only memory concern
> The GC only reclaims *unreachable* objects. Memory leaks in Node almost always come from objects that are still *reachable* — event listeners that are never removed, caches that grow without bounds, closures that capture more than intended. `--trace-gc` shows GC activity but not leaks; use heap snapshots (via `v8.writeHeapSnapshot()` or Chrome DevTools) to find what is alive and why.

## What you learned

- V8 uses a **generational GC**: young objects live in semi-spaces collected by fast **Scavenge**; long-lived objects are promoted to old space and collected by **Mark-Sweep-Compact**.
- Short-lived temporaries are cheap; objects that survive scavenges become expensive because they increase major-GC work.
- **Object pools** drastically reduce allocation pressure in hot paths at the cost of added complexity.
- `--max-old-space-size` controls the old-generation heap limit; `--trace-gc` and `--expose-gc` (dev only) let you observe GC behaviour.
- The GC only collects *unreachable* objects — real memory leaks require heap-snapshot analysis, not GC tuning.

## Next steps

With V8 internals solid, the next module explores **memory leaks** in Node specifically — how to detect, diagnose, and fix the most common patterns using heap snapshots, allocation tracking, and production-safe tooling.
*/});
