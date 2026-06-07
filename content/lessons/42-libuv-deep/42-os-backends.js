registerLessonSrc("42-os-backends", function () {/*
---
id: 42-os-backends
title: "epoll, kqueue, IOCP & io_uring"
minutes: 30
level: advanced
objectives:
  - Contrast readiness-based (epoll/kqueue) and completion-based (IOCP/io_uring) I/O models with precision
  - Explain edge-triggered vs level-triggered semantics and why the choice matters at scale
  - Describe why Linux file I/O bypasses epoll and must use the thread pool, and what io_uring changes
---

# epoll, kqueue, IOCP & io_uring

## Why this matters

The gap between 10 K and 10 M concurrent connections is not solved in JavaScript — it is solved in the OS kernel. When Node.js handles 50,000 WebSocket connections on a single thread without melting, that is epoll doing the heavy lifting. When a Windows .NET service achieves the same with zero busy-waiting, that is IOCP. When a modern Linux kernel transfers 10 GB/s of file data with two syscalls instead of four, that is io_uring. Understanding these backends tells you exactly why Node scales, where it hits ceilings, and how to tune around them.

## Learning objectives

- Explain **readiness** (epoll/kqueue) versus **completion** (IOCP/io_uring) I/O models and their tradeoffs.
- Understand **edge-triggered** vs **level-triggered** semantics and the EAGAIN dance.
- Explain the "file I/O on Linux does not fit epoll" problem and what libuv does instead.
- Describe io_uring's submission/completion ring design and libuv's adoption status as of 2026.
- Situate C10K and C10M in the historical context where these APIs were invented.

## The C10K Problem and Why select/poll Failed

In 1999, Dan Kegel published the C10K problem: how do you handle 10,000 simultaneous network connections on a single server? The culprit was `select(2)` and `poll(2)`.

`select` takes an `fd_set` (a fixed-size bit array, classically capped at 1,024 fds), scans *all* registered fds on every call, and returns the count of ready fds — you then loop to find which ones. Cost: **O(N)** per call, where N is the highest fd number. At 10,000 connections that is 10,000 bit-checks *per wakeup*, plus copying the entire fd_set between kernel and user space each time.

`poll(2)` removed the fd-set cap but kept the O(N) scan. At 50,000 fds, polling costs ~800 µs of kernel time per wakeup — a serious overhead on a busy server.

The solution was moving the O(N) scan *into the kernel* and giving user space only the fds that are actually ready. That is epoll and kqueue.

## Readiness Model: epoll (Linux) and kqueue (macOS/BSD)

A **readiness-based** model works like this:

1. You register interest in fds with the kernel once (`epoll_ctl(EPOLL_CTL_ADD, …)` or `kevent`).
2. You call `epoll_wait(…, timeout)` or `kevent(…, timeout)` — the kernel blocks until *at least one* registered fd is ready.
3. The kernel returns **only the ready fds** — O(ready) not O(registered).
4. You perform the actual I/O (`read(2)`, `write(2)`, `accept(2)`) yourself.

The key word is *readiness*: the kernel tells you the fd **can** be read/written without blocking. You still do the I/O. This is a **two-syscall round-trip** per operation: one to wait, one to do the work.

### Edge-triggered vs Level-triggered

Both epoll and kqueue support two triggering modes:

**Level-triggered (LT, the default for epoll):** The kernel keeps reporting a fd as ready as long as there is data available. If you `read` only 100 bytes from a socket with 500 bytes in its buffer, epoll will report it ready again on the next `epoll_wait`. Safe, but can generate redundant wakeups.

**Edge-triggered (ET):** The kernel fires exactly once when the fd *transitions* from not-ready to ready. You **must** drain the fd completely (loop `read` until `EAGAIN`) or you will miss data. Miss it and you stall forever — the kernel will not wake you again until more data arrives.

```js
// Real Node — libuv registers sockets in ET mode on Linux
// You don't write this directly, but understanding it matters when
// debugging stalled streams or missed data.

import { createServer } from "node:net";

const server = createServer((socket) => {
  socket.on("data", (chunk) => {
    // Node's stream layer drains the socket's kernel buffer fully before
    // emitting "data" — it handles the EAGAIN loop internally.
    console.log("received:", chunk.length, "bytes");
  });
});
server.listen(0, () => {
  console.log("listening on", server.address().port);
  server.close();
});
```

> [!OUTPUT]
> listening on 54321

> [!PRINCIPAL]
> libuv uses **edge-triggered** epoll for sockets and pipes on Linux. This means libuv's I/O handlers must drain the kernel buffer completely — returning EAGAIN — before yielding back to the event loop. The `uv__read` function in `src/unix/stream.c` does exactly this: it loops `read(2)` until it gets `EAGAIN` or `EOF`. If you write a native addon that registers its own fds with libuv without honouring the EAGAIN contract, you introduce a silent stall bug that only manifests under high throughput. This is one of the most pernicious categories of bugs in native Node addons.

### epoll internals in brief

Internally, epoll maintains a **red-black tree** of registered fds in kernel space (O(log N) insert/remove) and a **linked list** of ready fds populated by hardware interrupt handlers or kernel socket code. `epoll_wait` simply transfers that ready list to user space — O(ready events), not O(registered fds). At 100,000 connections with 1,000 active at any moment, `epoll_wait` returns 1,000 events regardless of how many total sockets exist.

kqueue on macOS/BSD works similarly but exposes a richer event type system (file changes, process events, signals, timers) through a single interface. libuv uses kqueue's `EVFILT_TIMER` for timers and `EVFILT_READ`/`EVFILT_WRITE` for sockets.

## Completion Model: IOCP (Windows)

Windows uses a fundamentally different paradigm: **completion-based** I/O. You do not wait for readiness and then do I/O — you *initiate* the I/O and the OS calls you back when it is *complete*.

The flow:

1. Associate a socket/file handle with an **I/O Completion Port** (IOCP) via `CreateIoCompletionPort`.
2. Issue an overlapped I/O operation (`ReadFile` / `WSARecv` with an `OVERLAPPED` structure). The call returns *immediately* regardless of data availability.
3. The kernel performs the I/O asynchronously. When done, it posts a completion packet to the IOCP.
4. Worker threads call `GetQueuedCompletionStatus` to dequeue completed packets and process results.

The key difference: with IOCP you pass the **buffer** to the OS upfront. The OS fills it. With epoll you call `read()` yourself after being told the fd is ready.

| Dimension | epoll / kqueue | IOCP |
|---|---|---|
| Model | Readiness — "fd is ready, you do I/O" | Completion — "I/O is done, here is your buffer" |
| Syscalls per op | 2 (wait + read/write) | 1 (initiate; kernel completes) |
| Buffer ownership | User allocates, reads after readiness | User allocates, hands to kernel |
| Memory pressure | Buffers only allocated when reading | Buffers pinned for duration of outstanding ops |
| File I/O | Not async on Linux (epoll ignores disk fds) | Async on Windows via overlapped file I/O |
| Platform | Linux, macOS, BSD | Windows only |

libuv on Windows implements the entire event loop on top of IOCP. A completion-port thread pool receives completions and routes them to the event-loop thread via `PostQueuedCompletionStatus` — semantically similar to how libuv's thread pool uses `uv_async_t` on Linux.

> [!PRINCIPAL]
> The completion model's "buffer pinned during I/O" property is both a strength and a hazard. On Windows, if you issue 10,000 overlapped reads, 10,000 user-space buffers are locked in memory for the duration. Under high fan-out (WebSocket server with 50 K clients each with a pending read), this means tens of megabytes of pinned, non-swappable memory. Production IOCP services tune the number of outstanding reads per connection carefully — typically 1-2 — to cap memory pressure. Node's libuv backend manages this automatically, but if you write native addons using Windows overlapped I/O directly, this accounting is your responsibility.

## Why File I/O Cannot Use epoll on Linux

This is the most important "gotcha" in the entire I/O stack:

**On Linux, regular files are always "ready" from epoll's perspective.** If you add a regular file fd to epoll, it will always report `EPOLLIN` / `EPOLLOUT` — because the kernel assumes disk reads are "fast enough." But `read(2)` on a disk file *can* block for tens of milliseconds on a cold cache or a slow disk. epoll gives you no async notification for the actual completion of a disk read.

So on Linux, libuv uses its **thread pool** for all `fs.*` operations. A `uv_fs_t` request is dispatched to a pool thread that calls the blocking `pread(2)` / `pwrite(2)`. When the blocking call returns, the thread signals the event loop via `uv_async_send` (writing to an `eventfd`). This is why:

- `fs.readFile` is non-blocking from Node's perspective (main thread is free)
- But it consumes one of the 4 default thread-pool threads while the disk read is in-flight
- 5 simultaneous `fs.readFile` calls queue the 5th — thread-pool starvation

```bash
# Check thread pool starvation: if fs ops are taking >10ms on fast SSDs,
# the pool is likely saturated. Increase pool size before your next incident.
UV_THREADPOOL_SIZE=16 node server.js
```

```bash
# Trace thread pool events:
node --trace-event-categories node.threadpoolwork.sync server.js
# Then: node --prof + node --prof-process isolate-*.log | grep "LazyCompile"
```

> [!NOTE]
> `dns.lookup()` also uses the thread pool (it calls the platform's `getaddrinfo(3)`). Under high DNS load, `dns.lookup()` competes with `fs.*` for thread-pool slots. Production services that do both should increase `UV_THREADPOOL_SIZE` and consider using `dns.resolve*()` instead, which uses libuv's built-in async DNS resolver (c-ares) — no thread pool at all.

## io_uring: The Completion Model for Linux

`io_uring` (introduced in Linux 5.1, 2019) brings completion semantics to Linux — and goes further by minimising syscalls through shared-memory ring buffers.

Architecture:

- **Submission Queue (SQ):** A ring buffer in shared memory between user space and kernel. You write I/O requests directly into this ring — no syscall required for most submissions.
- **Completion Queue (CQ):** Another shared-memory ring where the kernel writes results. You read completions directly — again, often without a syscall.
- **`io_uring_enter(2)`:** The one syscall that submits a batch and/or waits for completions. A single call can submit N operations and harvest M completions.

The theoretical advantage over epoll:

- File I/O can be genuinely async (no thread pool needed for `IORING_OP_READ` / `IORING_OP_WRITE`).
- Network I/O submissions and completions are batched, reducing syscall overhead at very high IOPS.
- "Fixed buffers" and "registered fds" let the kernel avoid per-call overhead.

### libuv's io_uring adoption status (Node 24, 2026)

libuv began experimental io_uring support for file I/O in **libuv 1.45** (2023). As of libuv shipping with Node 24 (libuv ~1.49+), io_uring is used on Linux ≥ 5.1 for:

- `uv_fs_t` read/write operations (bypassing the thread pool for file I/O when the kernel supports it)
- The wakeup async handle (replacing the `eventfd` with an io_uring no-op submission in some configurations)

Network I/O (TCP/UDP) still uses epoll in the current libuv implementation — io_uring's network path (`IORING_OP_ACCEPT`, `IORING_OP_RECV`) is available in the kernel but not yet wired into libuv's main socket path as of 2026.

> [!WARNING]
> io_uring has had several serious privilege-escalation CVEs (2022-2023). Many container runtimes (Docker, gVisor) and some Linux distributions disable it by default via `io_uring_disabled` sysctl. If you deploy Node on such platforms, libuv silently falls back to the thread-pool model. Run `sysctl kernel.io_uring_disabled` to check. Node does not expose this fallback in any log — you would only notice via missing performance gains.

> [!PRINCIPAL]
> The headline promise of io_uring — eliminating the thread pool for file I/O — is real, but the practical gains depend on workload. For sequential large-file streaming, the benefit is massive (fewer threads, lower latency, better CPU cache utilisation). For random 4 KB reads across thousands of files (e.g., serving a Next.js build's thousands of tiny JS chunks), the kernel's page cache hit rate matters far more than which syscall interface you use. Profile before assuming io_uring is your bottleneck.

## Try it yourself

This simulator implements both the readiness model (epoll-style) and the completion model (IOCP/io_uring-style) over a set of simulated sockets, so you can see exactly where the work happens in each model.

```js run
// Readiness-vs-Completion model simulator
// Pure JS — models the two I/O paradigms over simulated sockets.

// Simulated "socket" — has buffered data arriving at a given time
class SimSocket {
  constructor(id, dataArrivalMs, dataBytes) {
    this.id = id;
    this.dataArrivalMs = dataArrivalMs;
    this.dataBytes = dataBytes;
    this.read = false;
  }
  isReady(now) { return !this.read && now >= this.dataArrivalMs; }
}

// --- READINESS MODEL (epoll-style) ---
// User space registers interest, kernel reports ready fds,
// user space calls read() to get data.
function runReadinessModel(sockets) {
  console.log("=== READINESS MODEL (epoll) ===");
  let now = 0;
  const totalOps = sockets.length;
  let completed = 0;
  const syscalls = { epoll_wait: 0, read: 0 };

  while (completed < totalOps && now <= 120) {
    // epoll_wait: returns list of ready sockets
    syscalls.epoll_wait++;
    const ready = sockets.filter(s => s.isReady(now));

    if (ready.length > 0) {
      console.log(`  t=${now}ms: epoll_wait returned ${ready.length} ready fd(s)`);
      for (const s of ready) {
        // User space calls read() for each ready fd
        syscalls.read++;
        s.read = true;
        completed++;
        console.log(`    read(fd=${s.id}): got ${s.dataBytes} bytes`);
      }
    }
    now += 10;
  }
  console.log(`  Syscalls: ${syscalls.epoll_wait}x epoll_wait + ${syscalls.read}x read = ${syscalls.epoll_wait + syscalls.read} total`);
  console.log();
}

// --- COMPLETION MODEL (IOCP/io_uring-style) ---
// User space issues overlapped read with buffer, kernel fills buffer,
// user space dequeues completions. No separate read() call.
function runCompletionModel(sockets) {
  console.log("=== COMPLETION MODEL (IOCP/io_uring) ===");
  let now = 0;
  const totalOps = sockets.length;
  let completed = 0;
  // "Outstanding" reads: kernel is working on them with our buffers
  const outstanding = sockets.map(s => ({
    socket: s,
    buffer: new Array(s.dataBytes).fill(0), // buffer handed to kernel
    submittedAt: 0
  }));
  const syscalls = { submit: sockets.length, getCompletion: 0 };

  console.log(`  Submitted ${sockets.length} overlapped read(s) at t=0 (buffers handed to kernel)`);

  while (completed < totalOps && now <= 120) {
    // GetQueuedCompletionStatus / io_uring_enter
    syscalls.getCompletion++;
    const done = outstanding.filter(op => !op.socket.read && op.socket.isReady(now));

    if (done.length > 0) {
      console.log(`  t=${now}ms: dequeued ${done.length} completion(s)`);
      for (const op of done) {
        op.socket.read = true;
        completed++;
        // Buffer is already filled — no separate read() syscall
        console.log(`    completion(fd=${op.socket.id}): buffer has ${op.socket.dataBytes} bytes`);
      }
    }
    now += 10;
  }
  console.log(`  Syscalls: ${syscalls.submit}x submit + ${syscalls.getCompletion}x getCompletion = ${syscalls.submit + syscalls.getCompletion} total`);
}

// 4 sockets with data arriving at different times
const sockets = [
  new SimSocket(3, 10, 1024),
  new SimSocket(7, 10, 512),
  new SimSocket(11, 40, 2048),
  new SimSocket(15, 70, 256),
];

runReadinessModel(sockets.map(s => Object.assign(Object.create(Object.getPrototypeOf(s)), s)));
runCompletionModel(sockets);
```

## Exercise

**Challenge:** Modify the readiness model above to simulate **edge-triggered** behaviour: each socket should only appear in the epoll_wait results *once* (when it transitions from not-ready to ready). If the simulated `read()` only reads *half* the available data, the remaining data is silently lost unless you track partial reads and retry. Implement that tracking and observe the difference vs level-triggered.

<details>
<summary>Show solution</summary>

```js run
class SimSocket {
  constructor(id, arrivalMs, totalBytes) {
    this.id = id; this.arrivalMs = arrivalMs;
    this.totalBytes = totalBytes; this.bytesRead = 0;
    this.edgeNotified = false;
  }
  isReady(now) { return now >= this.arrivalMs && this.bytesRead < this.totalBytes; }
  // Edge: only fire once per transition
  edgeFires(now) {
    if (!this.edgeNotified && this.isReady(now)) { this.edgeNotified = true; return true; }
    return false;
  }
}

function readPartial(socket, maxBytes) {
  const toRead = Math.min(maxBytes, socket.totalBytes - socket.bytesRead);
  socket.bytesRead += toRead;
  return toRead;
}

function runEdgeTriggered(sockets, readChunkSize) {
  console.log(`Edge-triggered epoll (readChunk=${readChunkSize}B)`);
  let now = 0;
  // Drain queue: sockets that fired edge but weren't fully drained
  const drainQueue = new Set();
  const syscalls = { epoll_wait: 0, read: 0 };
  let iterations = 0;

  while (sockets.some(s => s.bytesRead < s.totalBytes) && now <= 200) {
    syscalls.epoll_wait++;
    iterations++;

    // Collect edge-fired sockets
    for (const s of sockets) {
      if (s.edgeFires(now)) drainQueue.add(s);
    }

    // Drain all sockets in drain queue (EAGAIN loop)
    for (const s of [...drainQueue]) {
      while (s.bytesRead < s.totalBytes) {
        syscalls.read++;
        const got = readPartial(s, readChunkSize);
        if (got === 0) break; // would get EAGAIN
      }
      if (s.bytesRead >= s.totalBytes) {
        console.log(`  t=${now}ms: fd=${s.id} fully drained (${s.bytesRead}B)`);
        drainQueue.delete(s);
      }
    }
    now += 10;
  }
  console.log(`epoll_wait calls: ${syscalls.epoll_wait}, read calls: ${syscalls.read}`);
}

const sockets = [
  new SimSocket(3, 10, 1024),
  new SimSocket(7, 10, 512),
];

runEdgeTriggered(sockets, 256); // read 256B at a time, must loop to drain
```

</details>

## Common pitfalls

> [!PITFALL]
> **Assuming file I/O is event-driven on Linux.** Engineers coming from an IOCP background (Windows, .NET) assume that `fs.readFile` is powered by epoll — it is not. On Linux it uses blocking pread in a thread pool. If you set `UV_THREADPOOL_SIZE=4` (the default) and issue 100 concurrent `fs.readFile` calls, 96 of them queue. The queueing latency is invisible — the calls return to the event loop immediately, but the callbacks don't fire until a thread is free. Profile with `clinic.js flame` or `--prof` if your fs-heavy service has unexplained tail latency.

> [!PITFALL]
> **io_uring availability surprises in containers.** If your staging environment is a bare metal Linux 5.15 box but production is an older kernel or a hardened container image with io_uring disabled (`kernel.io_uring_disabled=2`), libuv silently falls back. This can cause a 2-3x throughput difference between environments with no error logs. Always check `sysctl kernel.io_uring_disabled` in your production environment.

## What you learned

- **Readiness model** (epoll/kqueue): kernel tells you *when* a fd is ready; you do the I/O — O(ready) overhead regardless of registered fds.
- **Edge-triggered** semantics require fully draining the fd buffer on every notification or data is missed; **level-triggered** fires again if data remains.
- **Completion model** (IOCP): you submit I/O with a buffer; kernel fills it; you dequeue the result — one fewer syscall per operation but buffers are pinned.
- Linux file I/O does not fit epoll; libuv uses a thread pool for all `fs.*` — the primary source of thread-pool saturation.
- **io_uring** brings completion semantics to Linux with shared-memory rings; libuv uses it for file I/O on Linux ≥ 5.1 in Node 24, but network I/O still uses epoll.
- `UV_THREADPOOL_SIZE` and kernel-level io_uring availability are the two most impactful tuning levers for I/O-heavy Node services.

## Next steps

Now that you understand how Node interacts with the OS to move data, the final lesson examines the cost of actually copying that data — and the zero-copy techniques (`sendfile`, `splice`) that eliminate most of it — along with fd limits and the semaphore patterns that prevent EMFILE at scale.
*/});
