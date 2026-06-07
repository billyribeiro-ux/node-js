registerLessonSrc("25-worker-pools", function () {/*
---
id: 25-worker-pools
title: "Building a Worker Pool"
minutes: 30
level: principal
objectives:
  - Explain why a fixed pool of workers outperforms spawning a thread per task
  - Implement a task queue with idle/busy tracking and Promise-based result routing
  - Handle backpressure when the queue grows faster than workers can drain it
  - Benchmark a CPU-bound pipeline on a pool against a single-threaded baseline
---

# Building a Worker Pool

## Why this matters

Spawning a new worker thread for every task works for a handful of tasks, but breaks down at scale: each `new Worker()` takes 5–20 ms and allocates megabytes of V8 heap. A web server receiving 1000 image-processing requests per second can't afford that overhead. A **worker pool** keeps a fixed set of warm threads alive, routes tasks to idle ones, queues the overflow, and recycles threads when they finish — the same pattern used by every high-throughput data pipeline, task runner, and compute cluster. Building one from scratch teaches you the exact patterns you'll find inside `piscina`, `workerpool`, and similar libraries.

@diagram:worker-pool

## Learning objectives

- Justify the pool pattern over per-task thread spawning.
- Build a pool with idle/busy tracking, a task queue, and Promise-based result routing.
- Implement bounded backpressure to avoid unbounded memory growth.
- Benchmark a parallel pipeline on the pool versus the single-threaded baseline.

## Why pools beat spawn-per-task

Consider processing 500 images, each taking ~20 ms of CPU:

| Approach | Startup overhead | Peak threads | Total time (8-core machine) |
|---|---|---|---|
| Sequential | 0 | 1 | 500 × 20 ms = 10 s |
| Spawn per task | 500 × 15 ms | 500 | 35 ms (concurrent) + 7.5 s startup = ~8 s |
| Pool (8 workers) | 8 × 15 ms = 120 ms | 8 | 120 ms startup + 500/8 × 20 ms = 1.37 s |

The pool wins because startup cost is paid once, threads are reused, and you saturate all cores without thrashing the OS scheduler with hundreds of simultaneous threads.

> [!PRINCIPAL] The right pool size
> A CPU-bound pool should have at most `availableParallelism()` workers — one per logical CPU. Adding more workers beyond that causes context-switching overhead that slows throughput. For I/O-bound tasks, a slightly larger pool (1.5× cores) can help, because threads spend time waiting and additional threads keep CPUs busy. For mixed workloads, profile first.

## The pool architecture

A worker pool has four components:

```
  ┌─────────────────────────────────────────────────────────┐
  │                      WorkerPool                          │
  │                                                          │
  │  Task Queue: [ task3, task4, task5 ... ]                │
  │                                                          │
  │  Workers:                                                │
  │   Worker-1 [BUSY] → task1  → resolve(result1)           │
  │   Worker-2 [BUSY] → task2  → resolve(result2)           │
  │   Worker-3 [IDLE] ─────────────────────────────────     │
  │   Worker-4 [IDLE] ─────────────────────────────────     │
  └─────────────────────────────────────────────────────────┘
         ▲ run() called
         │ returns Promise<result>
```

Each `run(data)` call checks for an idle worker. If one exists, dispatch immediately. If all are busy, push the task onto the queue. When a worker finishes, pick the next queued task or mark the worker idle.

## Building the pool — Node.js version

```js
// pool.mjs — the worker pool implementation
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export class WorkerPool {
  constructor(workerScript, { size = availableParallelism(), maxQueue = Infinity } = {}) {
    this.workerScript = workerScript;
    this.maxQueue = maxQueue;
    this.workers = [];   // all worker wrappers
    this.idle = [];      // indexes of idle workers
    this.queue = [];     // pending { data, resolve, reject } tasks

    for (let i = 0; i < size; i++) {
      this._addWorker();
    }
  }

  _addWorker() {
    const worker = new Worker(this.workerScript);
    const slot = { worker, busy: false, index: this.workers.length };
    this.workers.push(slot);
    this.idle.push(slot.index);

    worker.on('message', (result) => {
      // The slot must have a pending resolver
      const { resolve } = slot.pending;
      slot.pending = null;
      slot.busy = false;
      this.idle.push(slot.index);
      resolve(result);
      this._drain(); // process next queued task if any
    });

    worker.on('error', (err) => {
      if (slot.pending) {
        slot.pending.reject(err);
        slot.pending = null;
      }
      // Replace the crashed worker
      slot.busy = false;
      this.workers[slot.index] = null;
      this._addWorker();
    });
  }

  _dispatch(slot, data, resolve, reject) {
    slot.busy = true;
    slot.pending = { resolve, reject };
    slot.worker.postMessage(data);
  }

  _drain() {
    if (this.queue.length === 0 || this.idle.length === 0) return;
    const { data, resolve, reject } = this.queue.shift();
    const index = this.idle.shift();
    this._dispatch(this.workers[index], data, resolve, reject);
  }

  run(data) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.maxQueue) {
        reject(new Error(`Worker pool queue full (max ${this.maxQueue})`));
        return;
      }
      if (this.idle.length > 0) {
        const index = this.idle.shift();
        this._dispatch(this.workers[index], data, resolve, reject);
      } else {
        this.queue.push({ data, resolve, reject });
      }
    });
  }

  async destroy() {
    await Promise.all(this.workers.filter(Boolean).map(s => s.worker.terminate()));
  }
}
```

```js
// compute-worker.mjs — the worker script
import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ n }) => {
  // CPU-bound: nth prime via trial division
  function nthPrime(target) {
    let count = 0, num = 2;
    while (true) {
      if ([...Array(Math.floor(Math.sqrt(num)) + 1).keys()].slice(2)
          .every(d => d === 0 || num % d !== 0)) {
        count++;
        if (count === target) return num;
      }
      num++;
    }
  }
  parentPort.postMessage({ prime: nthPrime(n) });
});
```

```js
// main.mjs — using the pool
import { WorkerPool } from './pool.mjs';
import { availableParallelism } from 'node:os';

const pool = new WorkerPool('./compute-worker.mjs', {
  size: availableParallelism(),
  maxQueue: 1000
});

const tasks = Array.from({ length: 20 }, (_, i) => ({ n: (i + 1) * 100 }));

console.time('parallel');
const results = await Promise.all(tasks.map(t => pool.run(t)));
console.timeEnd('parallel');

results.forEach(({ prime }, i) => {
  console.log(`${(i + 1) * 100}th prime: ${prime}`);
});

await pool.destroy();
```

> [!OUTPUT]
> parallel: 312ms
> 100th prime: 541
> 200th prime: 1223
> 300th prime: 1987
> ...

## Backpressure

Without bounds, the queue grows until your process OOMs. The `maxQueue` option above rejects with an error when the queue is full. A production pool should surface this to the caller so they can retry, shed load, or apply upstream rate-limiting.

```js
// Bounded pool usage with backpressure handling
try {
  const result = await pool.run(heavyTask);
} catch (err) {
  if (err.message.includes('queue full')) {
    // Respond with 503 Service Unavailable, or push to a durable queue
    res.status(503).send('Server busy, try again shortly');
  } else {
    throw err;
  }
}
```

> [!NOTE] piscina — the production-grade pool
> Building your own pool is a great learning exercise. In production, consider `piscina`, the most widely used worker-thread pool for Node.js. It handles task timeouts, NICE levels, resource limits, and statistics. The architecture is identical to what we built — piscina is our pool with battle-hardened edge cases covered.

## Try it yourself

This pure-JS simulation runs entirely in the browser sandbox and demonstrates the full pool scheduling algorithm — idle tracking, queue, and Promise resolution — without any Node APIs:

```js run
// A fully functional task-pool scheduler (pure JS, no Worker APIs needed).
// maxConcurrent limits how many tasks run "simultaneously".
// Excess tasks are queued and dispatched as slots free up.

function createPool(maxConcurrent) {
  let active = 0;
  const queue = [];

  function tryDrain() {
    while (active < maxConcurrent && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(() => task())
        .then((result) => {
          active--;
          resolve(result);
          tryDrain();
        })
        .catch((err) => {
          active--;
          reject(err);
          tryDrain();
        });
    }
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        tryDrain();
      });
    },
    get stats() {
      return { active, queued: queue.length };
    }
  };
}

// Simulate CPU work as a delayed Promise
function heavyTask(id, durationMs) {
  return () => new Promise(resolve => {
    // Simulate work duration using a tight loop count
    const start = Date.now();
    let i = 0;
    // Busy-wait approximation (safe in sandbox; never do in real code)
    while (Date.now() - start < durationMs) i++;
    resolve({ id, duration: Date.now() - start });
  });
}

async function main() {
  const pool = createPool(3); // max 3 concurrent

  const tasks = Array.from({ length: 7 }, (_, i) =>
    pool.run(heavyTask(i + 1, 20 + i * 5))
      .then(result => console.log(`Task ${result.id} done in ~${result.duration}ms`))
  );

  console.log('Pool stats after dispatch:', pool.stats);

  await Promise.all(tasks);
  console.log('All tasks complete. Final stats:', pool.stats);
}

main();
```

## Project

### Build a parallel data-processing pipeline and benchmark it

Apply everything from this module to build a realistic pipeline: a worker-thread pool that processes a batch of "records" (simulate with CPU-bound transformations), compared against a single-threaded baseline. Measure the speedup.

**Acceptance criteria:**

1. **Pool with configurable size** — `WorkerPool` class accepts `size` (default `availableParallelism()`) and `maxQueue` (default 500). Workers are pre-warmed at construction time.
2. **Worker script performs CPU-bound work** — each task receives `{ id, data }` where `data` is a numeric array; the worker computes the standard deviation and returns `{ id, stddev }`.
3. **Batch runner** — a function `runBatch(pool, records)` dispatches all records in parallel with `Promise.all` and returns results in input order.
4. **Single-threaded baseline** — the same standard-deviation calculation runs synchronously in the main thread over the same dataset; both execution times are recorded with `performance.now()`.
5. **Benchmark output** — print a table showing single-threaded time, parallel time, and speedup factor (e.g. `4.2×`).
6. **Graceful shutdown** — after the benchmark, call `pool.destroy()` and confirm all workers terminate before the process exits.

**Starter — the pure-JS core (runs in the sandbox):**

```js run
// Starter: task-pool scheduler + standard-deviation worker logic in pure JS.
// Replace the simulated "worker" with a real Worker thread for the project.

// --- The computation (goes in compute-worker.mjs) ---
function stddev(arr) {
  const n = arr.length;
  const mean = arr.reduce((s, x) => s + x, 0) / n;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

// --- Pool scheduler (pure-JS version) ---
function createPool(maxConcurrent) {
  let active = 0;
  const queue = [];

  function tryDrain() {
    while (active < maxConcurrent && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(() => task())
        .then(r => { active--; resolve(r); tryDrain(); })
        .catch(e => { active--; reject(e); tryDrain(); });
    }
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        tryDrain();
      });
    }
  };
}

// --- Simulate a batch of records ---
const RECORD_COUNT = 12;
const ARRAY_SIZE  = 10_000;
const records = Array.from({ length: RECORD_COUNT }, (_, id) => ({
  id,
  data: Float64Array.from({ length: ARRAY_SIZE }, () => Math.random() * 1000)
}));

// Single-threaded baseline
const t0 = performance.now();
const baselineResults = records.map(r => ({ id: r.id, stddev: stddev(r.data) }));
const baselineTime = performance.now() - t0;

// Pool simulation (still single-threaded here — swap in real Workers for true parallelism)
const pool = createPool(4);
const t1 = performance.now();
Promise.all(
  records.map(r => pool.run(() => ({ id: r.id, stddev: stddev(r.data) })))
).then(poolResults => {
  const poolTime = performance.now() - t1;

  console.log(`Records processed : ${RECORD_COUNT}`);
  console.log(`Array size        : ${ARRAY_SIZE.toLocaleString()} elements`);
  console.log(`Baseline time     : ${baselineTime.toFixed(2)} ms`);
  console.log(`Pool time (sim)   : ${poolTime.toFixed(2)} ms`);
  console.log(`Sample stddev[0]  : ${poolResults[0].stddev.toFixed(4)}`);
  console.log('');
  console.log('In real Node with worker_threads, pool time would be');
  console.log('~' + (baselineTime / 4).toFixed(1) + ' ms on a 4-core machine.');
});
```

## Common pitfalls

> [!PITFALL] Storing state in the worker between tasks
> Workers are reused across tasks. If your worker script has module-level mutable state (a cache, a counter) that a task modifies, subsequent tasks inherit that mutated state — often causing subtle, hard-to-reproduce bugs. Design workers to be **stateless**: treat each incoming message as fully self-contained. If shared state is truly needed, use `SharedArrayBuffer` with `Atomics`.

A second common mistake is forgetting that `worker.on('error')` doesn't bubble to `run()`'s Promise by default — you must wire the rejection yourself, as shown in the pool implementation above. Unhandled worker errors silently kill the worker without resolving any pending promises, causing callers to hang forever.

## What you learned

- A fixed pool amortises thread startup cost and limits OS scheduler pressure — dramatically faster than spawn-per-task for batched workloads.
- The pool's core invariant: a task goes to an idle worker immediately; otherwise it waits in a bounded queue.
- Resolving the correct Promise requires the worker to carry a `pending` resolver and clear it before dispatching the next task.
- `maxQueue` implements backpressure — reject eagerly rather than accumulating unbounded memory.
- In production, `piscina` implements this pattern with additional features; building it yourself gives you the mental model to use and debug it confidently.

## Next steps

With concurrency and parallelism conquered, the next frontier is real-time bidirectional communication: WebSockets, Server-Sent Events, and the `ws` library — the foundation of live dashboards, collaborative editors, and multiplayer games.
*/});
