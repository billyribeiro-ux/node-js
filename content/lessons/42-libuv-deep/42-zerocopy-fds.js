registerLessonSrc("42-zerocopy-fds", function () {/*
---
id: 42-zerocopy-fds
title: "Zero-Copy, sendfile & File-Descriptor Limits"
minutes: 30
level: advanced
objectives:
  - Quantify the cost of user/kernel copies and identify when Node avoids them via sendfile/splice
  - Explain fd exhaustion (EMFILE), graceful-fs patterns, and how to tune ulimit and UV_THREADPOOL_SIZE
  - Build and apply an fd-pool semaphore that prevents EMFILE under concurrent load
---

# Zero-Copy, sendfile & File-Descriptor Limits

## Why this matters

A high-throughput file server that copies every byte through user space can saturate a CPU core before saturating a 1 Gbps link. A Node service that naively opens files concurrently without an fd semaphore will crash with `EMFILE: too many open files` the moment load spikes — and that error surfaces as 500s, not a clean backpressure signal. These are the two failure modes that separate a prototype from a production-grade service. Understanding the kernel's zero-copy path and the OS fd-limit model lets you design around both before your first incident.

## Learning objectives

- Explain the **copy cost** of normal `read` + `write` and what the kernel does instead with `sendfile(2)` and `splice(2)`.
- Identify the Node.js APIs that transparently use `sendfile` and which ones do not.
- Explain `ulimit -n` / `RLIMIT_NOFILE`, how EMFILE occurs, and the graceful-fs retry pattern.
- Tune `UV_THREADPOOL_SIZE` correctly for mixed fs/dns/crypto workloads.
- Build a semaphore-based **fd pool** that caps concurrent open file descriptors.

## The Cost of Copies: User Space ↔ Kernel Space

When a Node.js HTTP server reads a file and sends it over a TCP socket via the naive path:

```js
// Naive: 4 copies, 4 context switches
import { createReadStream } from "node:fs";
import { createServer } from "node:http";

createServer((req, res) => {
  createReadStream("/var/www/file.bin").pipe(res);
}).listen(8080);
```

At the kernel level, `pipe()` (before `stream.pipeline`'s optimisations) does this:

```
Disk → kernel page cache  (DMA, no CPU copy — "free")
       kernel page cache → user-space buffer  (copy 1, CPU)
       user-space buffer → socket send buffer (copy 2, CPU)
       socket send buffer → NIC               (DMA, no CPU copy — "free")
```

Two CPU copies per byte served. At 10 GB/s NIC throughput that is 10 GB/s of memcpy — easily enough to saturate a core on a single-socket server. Each copy also evicts L3 cache lines, cascading into cache misses for everything else running on that core.

### sendfile(2): The Zero-Copy Path

`sendfile(2)` (Linux) takes a file fd and a socket fd and tells the kernel to transfer bytes directly from the page cache to the socket send buffer — **without passing through user space**:

```
Disk → kernel page cache (DMA)
       kernel page cache → socket send buffer (kernel copy or DMA gather on supporting NICs)
       socket send buffer → NIC (DMA)
```

One kernel-side copy (or zero on NICs with scatter-gather DMA). No user-space buffer needed. No context switch for the data path.

The syscall signature:

```c
// C — for reference only
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);
// out_fd must be a socket; in_fd must be a file fd opened for reading.
```

`splice(2)` is a more general version that works between any two fds as long as one is a pipe — it can chain file→pipe→socket without a user-space copy.

### When Node Uses sendfile

Node's `fs.createReadStream().pipe(response)` does **not** automatically use `sendfile` — it goes through the two-copy path. The zero-copy path is triggered specifically by:

**`response.sendFile()` in Express / Fastify** — frameworks call `fs.createReadStream` + pipe, which in current Node 24 still goes through user space for HTTP/1 responses.

**`stream.pipeline` with a `net.Socket` destination on Linux** — Node's stream internals can detect the socket-to-file pair and invoke `sendfile` via `socket._handle.writableNeedDrain`. However, this optimisation is **only active for TCP sockets, not HTTP response objects**, because HTTP responses add headers and framing.

**`fs.createReadStream` → direct `net.Socket.write`** — Node 18+ added `ReadableStream.pipeTo` / `TransferableStream` foundations, but the reliable path for sendfile semantics in 2026 is:

```js
// Real Node — explicit sendfile via net.Socket internal API
// (This is what static file servers like serve-static do under the hood)
import { createServer } from "node:net";
import { open } from "node:fs/promises";
import { sendfile } from "node:fs"; // note: not yet a stable public API in all versions

// In practice: use the 'send' npm package or Fastify's reply.sendFile()
// which internally uses the OS sendfile via native bindings.
```

> [!NOTE]
> As of Node 24 / 2026, the cleanest way to get OS-level sendfile semantics from userland is the `send` package (used by `serve-static` / Express `res.sendFile`). It uses Node's internal `net.Socket` write path which libuv maps to `sendfile(2)` on Linux when the source is a file fd and the destination is a TCP socket. Fastify's `reply.sendFile` does the same via `@fastify/send`.

> [!PRINCIPAL]
> The "zero-copy" label in marketing is often a half-truth. `sendfile` eliminates the user-space memcpy but still does a kernel-space copy from page cache to socket buffer (unless the NIC supports scatter-gather DMA, in which case it is zero-copy end-to-end). For TLS connections (the majority of production traffic), TLS termination happens in user space, which forces a copy regardless. On TLS-terminated traffic, `sendfile` provides no benefit — all the data must pass through the TLS library. Design for zero-copy only on plaintext internal paths (e.g., service-to-service on a trusted VPC).

## File-Descriptor Limits and EMFILE

Every open file, socket, pipe, timer fd, and epoll instance consumes one entry in the process's **fd table**. The OS imposes two limits:

- **Soft limit** (`RLIMIT_NOFILE` soft): the current cap, enforced by the kernel on every `open(2)`, `socket(2)`, `accept(2)`. Default on most Linux distributions: **1,024**. On macOS: **256**.
- **Hard limit** (`RLIMIT_NOFILE` hard): the ceiling the process can raise its own soft limit to without root. Default on Linux: **4,096** to **1,048,576** depending on distribution and systemd configuration.

When a Node process hits the soft limit, any call that would open a new fd fails immediately with `EMFILE: too many open files`. This error propagates as an unhandled exception unless you catch it:

```js
// Real Node — EMFILE propagates from fs and net
import { open } from "node:fs/promises";

try {
  const handles = await Promise.all(
    Array.from({ length: 2000 }, (_, i) => open(`/tmp/f${i}`, "w"))
  );
  // If ulimit -n is 1024, this throws EMFILE around the 1000th open
  // (Node itself holds ~24 fds for internals)
} catch (err) {
  if (err.code === "EMFILE") {
    console.error("fd exhaustion — raise ulimit -n or use an fd semaphore");
  }
}
```

### Setting Limits

```bash
# Check current limits
ulimit -n       # soft limit (effective)
ulimit -Hn      # hard limit

# Raise soft limit for this shell session
ulimit -n 65536

# Permanent raise via /etc/security/limits.conf (PAM-based systems):
# * soft nofile 65536
# * hard nofile 65536

# For systemd services — in the unit file:
# [Service]
# LimitNOFILE=65536

# Check what a running process actually has:
# cat /proc/<pid>/limits | grep "open files"
```

> [!WARNING]
> Setting `ulimit -n` to an arbitrarily large value (e.g., 1,048,576) has a real cost: on Linux, the kernel allocates a bitmap for the fd table proportional to the limit, even if most fds are unused. At 1 M fds, that's 128 KB of kernel memory *per process*, and `select(2)` (used by some libraries) has a hardcoded `FD_SETSIZE` of 1,024 — it will silently corrupt memory if fds exceed that. Use the smallest limit that covers your actual peak concurrency with headroom.

### graceful-fs Pattern

The `graceful-fs` package (used internally by npm and many build tools) handles EMFILE by queuing failed `open` calls and retrying when another fd is released:

```js
// The graceful-fs approach (conceptual — not runnable in browser):
// When open() returns EMFILE, push the call onto a retry queue.
// Patch fs.close / fs.closeSync to drain the retry queue after each close.
// This converts "crash on EMFILE" into "queue and retry transparently."
```

The weakness: if the EMFILE source is sockets (not files), graceful-fs doesn't help — it only patches `fs.open`. A production-grade solution requires an explicit **fd semaphore** that caps concurrent open handles across all sources.

## UV_THREADPOOL_SIZE Tuning

The thread pool default of 4 threads is calibrated for a server doing moderate fs I/O. For production services, the right value depends on the mix:

| Workload mix | Recommended UV_THREADPOOL_SIZE |
|---|---|
| Pure network I/O (sockets only) | 4 (default; threads barely used) |
| fs + DNS lookup heavy | 16–32 |
| fs + crypto (bcrypt, scrypt, pbkdf2) | 32–64 |
| All three simultaneously | 64–128 |
| io_uring enabled (Linux ≥ 5.1) | Reduce by 50% for fs (kernel handles it) |

The cost of more threads: each thread consumes a stack (~8 MB default on Linux, tunable with `UV_THREADPOOL_STACK_SIZE` in newer libuv). 128 threads = 1 GB of reserved stack space. Physical memory usage is lower (stacks are demand-paged) but the virtual address space commitment matters on 32-bit deployments and in memory-constrained containers.

```bash
# Set before starting Node — cannot be changed at runtime
UV_THREADPOOL_SIZE=32 node server.js

# Verify with clinic.js:
npx clinic doctor -- node server.js
# Look for "uv threadpool" saturation events in the flame graph
```

> [!PRINCIPAL]
> `UV_THREADPOOL_SIZE` is a process-wide global set at startup. If you use worker threads (`node:worker_threads`), each worker has its **own** libuv loop and its **own** thread pool — `UV_THREADPOOL_SIZE=32` means up to 32 * numWorkers threads total. At 8 workers, that's 256 threads. This is one of the most common sources of unexpected CPU saturation when adopting worker threads for CPU-bound work alongside heavy fs usage. Profile the full process thread count with `ps -L -p <pid> | wc -l` before assuming worker threads are "free."

## Try it yourself

This fd-pool semaphore prevents EMFILE by capping concurrent open handles. It queues callers when the pool is full and releases slots on close — the same pattern used by production file servers and database connection pools.

```js run
// FD Pool Semaphore — prevents EMFILE by capping concurrent open "files"
// Pure JS simulation: no real fds, but models the exact queuing semantics.

class FdSemaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
    this.stats = { acquired: 0, queued: 0, maxActive: 0 };
  }

  // Returns a Promise that resolves with a "release" function
  acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.limit) {
          this.active++;
          this.stats.acquired++;
          if (this.active > this.stats.maxActive) this.stats.maxActive = this.active;
          resolve(() => this._release());
        } else {
          this.stats.queued++;
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  _release() {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next(); // retry the queued acquisition
    }
  }

  status() {
    return `active=${this.active}/${this.limit} queued=${this.queue.length}`;
  }
}

// Simulate opening a "file" that takes some ms to process
function simulateFileOp(id, durationMs) {
  return new Promise(resolve => setTimeout(() => resolve(`data-${id}`), durationMs));
}

async function runWithSemaphore(semaphore, tasks) {
  const results = await Promise.all(tasks.map(async ({ id, durationMs }) => {
    const release = await semaphore.acquire();
    // console.log(`[t] opened fd for task ${id} — ${semaphore.status()}`);
    try {
      return await simulateFileOp(id, durationMs);
    } finally {
      release();
    }
  }));
  return results;
}

// 20 concurrent file operations, but only 5 fds allowed at once
const sem = new FdSemaphore(5);
const tasks = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  durationMs: 10 + (i % 4) * 5 // vary durations 10-25ms
}));

const t0 = Date.now();
runWithSemaphore(sem, tasks).then(results => {
  const elapsed = Date.now() - t0;
  console.log(`Completed ${results.length} tasks in ~${elapsed}ms`);
  console.log(`Max concurrent fds: ${sem.stats.maxActive} (limit: ${sem.limit})`);
  console.log(`Total acquired: ${sem.stats.acquired}`);
  console.log(`Total queued (would have been EMFILE without semaphore): ${sem.stats.queued}`);
  console.log(`Without semaphore: all 20 would open simultaneously → EMFILE at fd limit`);
});
```

## Exercise

**Challenge:** Extend `FdSemaphore` above to support a **timeout**: if a caller waits more than N milliseconds in the queue without acquiring, reject its Promise with an `Error("fd acquire timeout")`. This models production backpressure — you'd rather return HTTP 503 than queue indefinitely.

<details>
<summary>Show solution</summary>

```js run
class FdSemaphoreWithTimeout {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  acquire(timeoutMs = Infinity) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const tryAcquire = () => {
        if (settled) return; // timed out while queued
        if (this.active < this.limit) {
          settled = true;
          if (timer !== null) clearTimeout(timer);
          this.active++;
          resolve(() => this._release());
        } else {
          if (timer === null && timeoutMs !== Infinity) {
            timer = setTimeout(() => {
              settled = true;
              // Remove from queue
              const idx = this.queue.indexOf(tryAcquire);
              if (idx !== -1) this.queue.splice(idx, 1);
              reject(new Error(`fd acquire timeout after ${timeoutMs}ms`));
            }, timeoutMs);
          }
          this.queue.push(tryAcquire);
        }
      };

      tryAcquire();
    });
  }

  _release() {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }
}

async function demo() {
  const sem = new FdSemaphoreWithTimeout(2);

  // Acquire 2 slots — no problem
  const r1 = await sem.acquire(100);
  const r2 = await sem.acquire(100);
  console.log("Acquired 2 slots (limit=2)");

  // 3rd caller will time out after 50ms (slots held for 200ms)
  const p3 = sem.acquire(50).catch(e => `TIMEOUT: ${e.message}`);

  // Release one slot after 200ms — too late for p3
  setTimeout(() => { r1(); r2(); }, 200);

  const result = await p3;
  console.log("3rd caller result:", result);
  console.log("Done — timeout pattern prevents indefinite queuing");
}

demo();
```

</details>

## Project

### Build a High-Throughput TCP File Service with Tuned fd Limits and Thread Pool

**Brief:** Build a TCP server that serves arbitrary files from a directory, protected by an fd semaphore to prevent EMFILE, and tuned for maximum throughput via `UV_THREADPOOL_SIZE` configuration. Prove the gains with a structured load test that measures throughput and p99 latency with and without tuning.

This is a portfolio-grade project that demonstrates real systems engineering: knowing not just that a tool exists, but exactly which knob to turn, by how much, and how to measure the result.

**Acceptance criteria:**

1. **fd semaphore:** Implement `FdSemaphore` with configurable limit and timeout. All file `open()` calls must go through the semaphore. Under load that would exceed `ulimit -n`, the server returns a `503 Resource Unavailable` response rather than crashing.

2. **sendfile path:** When serving files over a raw `net.Socket` (bypassing HTTP headers), use `fs.createReadStream` piped directly to the socket to exercise the sendfile kernel path. Add a flag `--zero-copy` that enables this path vs a naive `fs.readFile` + `socket.write`.

3. **UV_THREADPOOL_SIZE tuning:** Accept a `--threadpool-size N` CLI flag and set `process.env.UV_THREADPOOL_SIZE` before requiring any fs modules. Document in comments why this must happen before any I/O is initiated (libuv reads it at loop init, not at runtime).

4. **Load test harness:** Implement a pure-JS concurrent client (`Promise.all` + `net.Socket`) that sends N concurrent requests, measures per-request latency (start → last byte), and reports: min/mean/p95/p99/max latency and total throughput (bytes/sec). The harness must run in the same Node process on a `net.createServer` loopback socket.

5. **Measurement comparison:** The load test must produce a side-by-side table comparing three configurations:
   - Baseline: `UV_THREADPOOL_SIZE=4`, no semaphore (may EMFILE), naive path
   - Tuned: `UV_THREADPOOL_SIZE=32`, semaphore with limit = 80% of `ulimit -n`
   - Zero-copy: tuned + sendfile path
   Show the p99 latency and throughput for each.

6. **Graceful shutdown:** On `SIGTERM`, the server stops accepting new connections, waits for in-flight file transfers to complete (tracked via the semaphore's `active` count), then calls `server.close(cb)`. The process must exit cleanly within 5 seconds.

**Starter — the fd-semaphore core (runnable pure-JS model):**

```js run
// Starter: FdSemaphore + latency-percentile calculator
// This is the pure-logic core of the project's two most critical components.

// ---- FdSemaphore ----
class FdSemaphore {
  constructor(limit, acquireTimeoutMs = 5000) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.rejected = 0;
  }

  acquire() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const tryAcquire = () => {
        if (settled) return;
        if (this.active < this.limit) {
          settled = true;
          if (timer !== null) clearTimeout(timer);
          this.active++;
          resolve(() => {
            this.active--;
            if (this.queue.length > 0) this.queue.shift()();
          });
        } else {
          if (timer === null) {
            timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              const idx = this.queue.indexOf(tryAcquire);
              if (idx !== -1) this.queue.splice(idx, 1);
              this.rejected++;
              reject(Object.assign(new Error("fd pool exhausted"), { code: "EMFILE" }));
            }, this.acquireTimeoutMs);
          }
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  get queued() { return this.queue.length; }
}

// ---- Percentile calculator ----
function percentiles(samples, ...ps) {
  const sorted = [...samples].sort((a, b) => a - b);
  return ps.map(p => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  });
}

// ---- Simulated load test ----
async function simulateLoadTest(sem, concurrency, totalRequests, fileOpMs) {
  const latencies = [];
  let emfileCount = 0;

  await Promise.all(Array.from({ length: totalRequests }, async (_, i) => {
    const start = Date.now();
    let release;
    try {
      release = await sem.acquire();
    } catch (e) {
      if (e.code === "EMFILE") { emfileCount++; return; }
      throw e;
    }
    try {
      // Simulate file read time
      await new Promise(r => setTimeout(r, fileOpMs + Math.random() * 5));
      latencies.push(Date.now() - start);
    } finally {
      release();
    }
  }));

  return { latencies, emfileCount };
}

// Run comparison: tight semaphore vs loose semaphore
async function runComparison() {
  const REQUESTS = 60;
  const FILE_OP_MS = 15;

  console.log("=== fd Semaphore Load Test Comparison ===\n");

  // Config 1: tight limit (simulate EMFILE scenario)
  const tightSem = new FdSemaphore(5, 30); // only 5 slots, 30ms timeout
  const tight = await simulateLoadTest(tightSem, 60, REQUESTS, FILE_OP_MS);
  const [tp50, tp95, tp99] = percentiles(tight.latencies, 50, 95, 99);
  console.log(`Tight semaphore (limit=5, timeout=30ms):`);
  console.log(`  Completed: ${tight.latencies.length}, EMFILE-rejected: ${tight.emfileCount}`);
  console.log(`  p50=${tp50}ms  p95=${tp95}ms  p99=${tp99}ms`);

  console.log();

  // Config 2: correctly sized semaphore
  const goodSem = new FdSemaphore(40, 5000); // 40 slots, 5s timeout
  const good = await simulateLoadTest(goodSem, 60, REQUESTS, FILE_OP_MS);
  const [gp50, gp95, gp99] = percentiles(good.latencies, 50, 95, 99);
  console.log(`Tuned semaphore (limit=40, timeout=5000ms):`);
  console.log(`  Completed: ${good.latencies.length}, EMFILE-rejected: ${good.emfileCount}`);
  console.log(`  p50=${gp50}ms  p95=${gp95}ms  p99=${gp99}ms`);

  console.log("\nKey insight: tuned semaphore completes all requests without EMFILE");
  console.log("but still queues safely — never crashing even under overload.");
}

runComparison();
```

## Common pitfalls

> [!PITFALL]
> **EMFILE from sockets, not files.** Engineers reach for `graceful-fs` when they see EMFILE, but `graceful-fs` only patches `fs.open`. If your EMFILE comes from `net.createConnection`, `http.request`, or `server.accept`, `graceful-fs` does nothing. Always check `process._getActiveHandles().length` alongside `ulimit -n` — if handles approach the limit, your connection pool or client pool is the leak, not your file opens. Use `wtfnode` to identify which handle types are alive.

> [!PITFALL]
> **UV_THREADPOOL_SIZE set too late.** The environment variable is read by libuv when the thread pool is first initialised — which happens at the first fs or dns call, often during `require`/`import` resolution of your own modules. Setting `UV_THREADPOOL_SIZE` inside the application code (e.g., `process.env.UV_THREADPOOL_SIZE = "32"`) works only if no I/O has happened yet. The only safe approach: set it in the OS environment before launching Node, or use `--env-file` with a `.env` file and `UV_THREADPOOL_SIZE` defined there.

> [!PRINCIPAL]
> The combination of a correctly sized `FdSemaphore` + `UV_THREADPOOL_SIZE` tuned to the workload + `ulimit -n` set via the systemd unit is the production trifecta for I/O-heavy Node services. Miss any one of them and you get a different failure: miss the semaphore and you EMFILE under spike load; miss the threadpool tuning and you get invisible latency at p99 under mixed fs+crypto load; miss the ulimit and your kernel is the bottleneck, not your code. Principal engineers set all three by default in every Node service template.

## What you learned

- Normal `read` + `write` costs two CPU-side memory copies per byte; `sendfile(2)` eliminates the user-space hop but **only helps on plaintext paths** — TLS forces a copy regardless.
- Node's `createReadStream().pipe(socket)` exercises the sendfile path on TCP sockets; HTTP response objects do not (headers require user-space framing).
- EMFILE is a hard limit enforced by the OS fd table; soft limits default to 1,024 on Linux and 256 on macOS — far below production needs.
- An fd semaphore with a timeout converts EMFILE from a crash into a controlled 503 backpressure signal.
- `UV_THREADPOOL_SIZE` must be set in the environment before Node starts; worker threads multiply it per worker, which can cause hidden thread explosion.
- The production trifecta: fd semaphore + thread pool tuning + systemd `LimitNOFILE`.

## Next steps

You have now covered libuv from the inside out: the loop's anatomy, the OS I/O backends, and the copy-and-fd economics of real I/O. The next module explores Node's diagnostic tooling — `--prof`, `clinic.js`, and `--trace-gc` — to put numbers on everything you've learned here.
*/});
