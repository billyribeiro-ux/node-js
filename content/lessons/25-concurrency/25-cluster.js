registerLessonSrc("25-cluster", function () {/*
---
id: 25-cluster
title: "cluster & the SO_REUSEPORT Model"
minutes: 22
level: advanced
objectives:
  - Explain how the cluster module forks workers and shares a port
  - Write a primary/worker setup that saturates all CPU cores
  - Compare cluster against worker_threads for different workloads
  - Implement graceful worker restarts with zero downtime
---

# cluster & the SO_REUSEPORT Model

## Why this matters

Node.js runs JavaScript in a single thread, so a single Node process can only use one CPU core at a time. On a 16-core machine you're leaving 15 cores completely idle. The `cluster` module solves this for network servers: fork one worker per CPU, have them all listen on the same port, and let the OS or Node distribute incoming connections across them. This is how real Node HTTP servers handle production traffic.

@diagram:cluster

## Learning objectives

- Describe how `cluster` forks workers and how they share a server port.
- Write a primary+worker pattern that uses all CPU cores.
- Choose between `cluster` and `worker_threads` for a given workload.
- Restart a crashed worker without dropping live connections.

## How cluster works under the hood

When you call `cluster.fork()`, Node spawns a new child process running the same script file. Node's primary process (the one that called `fork`) uses an `IPC` channel to hand each worker a file descriptor for the listening socket.

On Linux with `SO_REUSEPORT` (the socket option that lets multiple processes bind the same port), the kernel load-balances new connections across all the bound sockets in round-robin order. On macOS and older Linux, Node emulates this: the primary accepts new connections and distributes them to workers over IPC — only slightly less efficient.

The result: every worker calls `server.listen(PORT)` and they all share that port transparently.

```
  ┌─────────────────────────────────────────┐
  │         Primary process (PID 1001)       │
  │  cluster.fork() x numCPUs               │
  │  Holds the shared listening socket fd   │
  └──────┬────────────────────────────┬──────┘
         │  IPC channel               │  IPC channel
  ┌──────▼──────┐               ┌─────▼───────┐
  │  Worker #1  │               │  Worker #2  │
  │  (PID 1002) │               │  (PID 1003) │
  │  HTTP server│               │  HTTP server│
  └─────────────┘               └─────────────┘
        ▲                              ▲
        └─────── incoming requests ────┘
                (kernel distributes)
```

## The primary/worker pattern

The key insight is that the *same file* runs in both the primary and the workers. The `cluster.isPrimary` flag lets you branch:

```js
import cluster from 'node:cluster';
import http from 'node:http';
import { availableParallelism } from 'node:os';

const NUM_WORKERS = availableParallelism(); // e.g. 8 on an 8-core machine

if (cluster.isPrimary) {
  console.log(`Primary PID ${process.pid}: forking ${NUM_WORKERS} workers`);

  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} exited (${signal || code}). Restarting…`);
    cluster.fork(); // replace the dead worker
  });

} else {
  // Each worker runs independently in its own event loop
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end(`Hello from worker PID ${process.pid}\n`);
  }).listen(3000);

  console.log(`Worker PID ${process.pid} listening on :3000`);
}
```

> [!OUTPUT]
> Primary PID 1001: forking 8 workers
> Worker PID 1002 listening on :3000
> Worker PID 1003 listening on :3000
> Worker PID 1004 listening on :3000
> Worker PID 1005 listening on :3000
> Worker PID 1006 listening on :3000
> Worker PID 1007 listening on :3000
> Worker PID 1008 listening on :3000
> Worker PID 1009 listening on :3000

> [!NOTE] availableParallelism vs os.cpus().length
> `os.availableParallelism()` (added in Node 19) returns the number of CPUs available to this process, respecting Linux cgroups and container CPU quotas. `os.cpus().length` returns the host machine's total core count, which may be much higher than your container is allowed to use. Prefer `availableParallelism()` in containerised deployments.

## Load balancing strategy

Node's default clustering policy is `'rr'` (round-robin) on Linux and macOS — the primary accepts connections and hands them to workers one by one. You can switch to `'none'` to let the OS kernel distribute them:

```js
import cluster from 'node:cluster';

cluster.schedulingPolicy = cluster.SCHED_NONE; // let the OS decide
```

> [!PRINCIPAL] When round-robin hurts
> Round-robin distributes *connections* evenly, but not necessarily *work*. If one request takes 10 ms and another 2000 ms, the slow request monopolises a worker while fast requests pile up waiting. For highly variable workload durations, consider a task-queue pattern (see the worker pool lesson) rather than a cluster of long-lived request handlers.

## Graceful worker restarts

A naive `cluster.on('exit', () => cluster.fork())` restarts workers immediately after a crash — good. But for deployments (rolling restarts) you want to drain in-flight requests before killing a worker:

```js
// In the primary:
function restartWorker(worker) {
  // Tell the worker to stop accepting new connections
  worker.send('shutdown');
  worker.disconnect(); // closes the IPC channel; worker exits when its event loop drains

  // Safety net: force-kill after 5 seconds
  const timeout = setTimeout(() => worker.kill(), 5000);
  worker.on('exit', () => clearTimeout(timeout));
}

// In each worker:
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    server.close(() => process.exit(0)); // stop accepting, finish pending
  }
});
```

> [!WARNING] Workers share no memory
> Every worker is a separate OS process with its own V8 heap. In-memory state (caches, session maps, counters) is **not shared**. If your HTTP handler writes to a `Map` in the worker's memory, only that worker sees it. Use Redis, a database, or shared memory via `SharedArrayBuffer` (worker_threads territory) for state that must be visible across all workers.

## cluster vs worker_threads

| Concern | cluster | worker_threads |
|---|---|---|
| Isolation | Full OS process | Same process, separate V8 context |
| Shared memory | No (separate heaps) | Yes (SharedArrayBuffer) |
| Best for | I/O-bound HTTP servers | CPU-bound computation |
| Startup cost | ~50-100 ms (fork) | ~5-20 ms (thread) |
| Crash isolation | Worker crash doesn't kill primary | Unhandled error kills the whole process by default |
| Port sharing | Built-in | Requires custom IPC |

> [!PITFALL] Clustering a CPU-bound server doesn't help as much as you think
> If your request handler runs a synchronous 200 ms computation, clustering 8 workers only gives you 8 parallel slots — still single-threaded per worker. The right answer for CPU-bound work is `worker_threads` inside each cluster worker, offloading computation off the event loop entirely.

## Try it yourself

Below is a pure-JavaScript simulation of a round-robin load balancer distributing requests across N workers. The concept is identical to what Node's cluster primary does internally:

```js run
// Round-robin load balancer simulation — no Node APIs required.

function createWorker(id) {
  let handled = 0;
  return {
    id,
    handle(req) {
      handled++;
      return `Worker-${id} handled "${req}" (total: ${handled})`;
    },
    get count() { return handled; }
  };
}

function createBalancer(numWorkers) {
  const workers = Array.from({ length: numWorkers }, (_, i) => createWorker(i + 1));
  let next = 0;
  return {
    dispatch(req) {
      const worker = workers[next % workers.length];
      next++;
      return worker.handle(req);
    },
    stats() {
      return workers.map(w => `Worker-${w.id}: ${w.count} requests`).join('\n');
    }
  };
}

const balancer = createBalancer(3);

const requests = ['GET /', 'POST /api', 'GET /health', 'GET /data', 'DELETE /item', 'GET /'];
for (const req of requests) {
  console.log(balancer.dispatch(req));
}

console.log('\n--- Distribution ---');
console.log(balancer.stats());
```

## Exercises

**Exercise 1:** Modify the balancer above to use a **weighted round-robin** strategy. Give Worker-1 a weight of 2 (receives twice as many requests) and Worker-2 and Worker-3 a weight of 1 each. Verify the distribution with 9 requests.

<details>
<summary>Show solution</summary>

```js run
function createWorker(id) {
  let handled = 0;
  return {
    id,
    handle(req) { handled++; return `Worker-${id}: "${req}"`; },
    get count() { return handled; }
  };
}

function createWeightedBalancer(specs) {
  // specs: [{ id, weight }, ...]
  // Expand each worker by its weight into a rotation list
  const rotation = [];
  for (const { id, weight } of specs) {
    const w = createWorker(id);
    for (let i = 0; i < weight; i++) rotation.push(w);
  }
  let next = 0;
  return {
    dispatch(req) {
      const worker = rotation[next % rotation.length];
      next++;
      return worker.handle(req);
    },
    stats() {
      // Deduplicate workers
      const seen = new Map();
      for (const w of rotation) seen.set(w.id, w);
      return [...seen.values()].map(w => `Worker-${w.id}: ${w.count}`).join('\n');
    }
  };
}

const balancer = createWeightedBalancer([
  { id: 1, weight: 2 },
  { id: 2, weight: 1 },
  { id: 3, weight: 1 }
]);

for (let i = 0; i < 8; i++) balancer.dispatch(`req-${i}`);
console.log(balancer.stats());
// Worker-1: 4, Worker-2: 2, Worker-3: 2
```

</details>

**Exercise 2:** Add a `leastConnections()` dispatch strategy to the original balancer — instead of strict round-robin, always route to the worker with the fewest in-flight requests. Track in-flight count with `start()` and `finish()` methods.

<details>
<summary>Show solution</summary>

```js run
function createWorker(id) {
  let inFlight = 0;
  let total = 0;
  return {
    id,
    start() { inFlight++; total++; },
    finish() { inFlight = Math.max(0, inFlight - 1); },
    get inFlight() { return inFlight; },
    get total() { return total; }
  };
}

function leastConnBalancer(n) {
  const workers = Array.from({ length: n }, (_, i) => createWorker(i + 1));
  return {
    dispatch() {
      const w = workers.reduce((min, w) => w.inFlight < min.inFlight ? w : min, workers[0]);
      w.start();
      return w;
    },
    stats() {
      return workers.map(w => `Worker-${w.id}: total=${w.total} inFlight=${w.inFlight}`).join('\n');
    }
  };
}

const lb = leastConnBalancer(3);

// Simulate: dispatch 5 requests, finish some, dispatch more
const w1 = lb.dispatch(); // W1 in-flight=1
const w2 = lb.dispatch(); // W2 in-flight=1
const w3 = lb.dispatch(); // W3 in-flight=1
w1.finish();              // W1 done, in-flight=0
lb.dispatch();            // should go to W1 (least)
lb.dispatch();            // W1 or another with 0; W1 in-flight=1 again, pick W1 or tie

console.log(lb.stats());
```

</details>

## Common pitfalls

> [!PITFALL] Shared state in the primary's memory is not visible to workers
> A common mistake is storing session tokens or rate-limit counters in a `Map` in the primary process and expecting workers to see them. Workers are separate OS processes — they can only communicate via IPC messages or an external store. Treat each worker as if it were a completely different machine.

Another pitfall: forgetting the safety-net `setTimeout` on graceful shutdown. If a worker has a persistent WebSocket connection that never closes, `server.close()` never fires the callback. Always pair graceful drain with a force-kill timeout.

## What you learned

- `cluster.fork()` spawns child processes running the same file; `cluster.isPrimary` controls branching.
- Workers share a port via the OS `SO_REUSEPORT` socket option or Node's IPC-based accept hand-off.
- Node's default scheduling is round-robin; workers are separate processes with no shared memory.
- `cluster` is for I/O-bound servers; `worker_threads` is for CPU-bound computation.
- Graceful restarts require telling the worker to drain (`server.close()`), then force-killing after a timeout.

## Next steps

`cluster` scales I/O across CPU cores by using multiple processes. When you need true parallelism for CPU-bound JavaScript *without* the process overhead, `worker_threads` gives you real OS threads sharing the same process memory — and with `SharedArrayBuffer` + `Atomics`, low-overhead coordination between them.
*/});
