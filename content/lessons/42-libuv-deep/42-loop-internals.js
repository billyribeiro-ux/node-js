registerLessonSrc("42-loop-internals", function () {/*
---
id: 42-loop-internals
title: "Handles, Requests & the Loop's Anatomy"
minutes: 28
level: advanced
objectives:
  - Distinguish libuv handles from requests and know which Node APIs create each
  - Explain the loop's run modes, the watcher/poll model, and how the thread pool delivers completions back to the loop
  - Use .ref()/.unref() correctly to control whether a handle keeps the process alive
---

# Handles, Requests & the Loop's Anatomy

## Why this matters

Every Node.js I/O operation — a TCP socket, a timer, a file read — is ultimately managed by **libuv**, the C library that sits beneath V8. Understanding libuv's internal model lets you reason precisely about why `process.exit()` is sometimes needed, why a lone `setInterval` keeps a process alive forever, and why unrefing a handle is the right tool instead of patching with `process.exit()`. At the principal level, this knowledge is the prerequisite for diagnosing event-loop stalls, thread-pool saturation, and leaked handles in long-running services.

## Learning objectives

- Explain the difference between a **handle** (`uv_handle_t` hierarchy) and a **request** (`uv_req_t` hierarchy), with concrete Node examples of each.
- Walk through every phase of the event loop and name which callbacks fire in each.
- Explain ref/unref semantics and why `active_handles + active_reqs > 0` keeps the loop running.
- Describe how the thread pool delivers results back to the event loop via an async handle.

## Handles vs Requests

libuv has two fundamental abstractions:

**Handles** are long-lived objects that persist across multiple event-loop iterations. They represent an ongoing capability — a listening socket, an active timer, a signal watcher, a TTY. Each handle holds state, consumes a file descriptor (usually), and keeps the loop alive while it is both *initialised* and *referenced*.

Key handle types and their Node.js equivalents:

| libuv type | Node.js surface |
|---|---|
| `uv_tcp_t` | `net.Socket`, `net.Server` |
| `uv_udp_t` | `dgram.Socket` |
| `uv_timer_t` | `setTimeout`, `setInterval` |
| `uv_fs_event_t` | `fs.watch` |
| `uv_process_t` | `child_process.spawn` |
| `uv_async_t` | internal wakeup from thread pool |
| `uv_signal_t` | `process.on('SIGTERM', …)` |
| `uv_pipe_t` | `process.stdin/stdout`, named pipes |
| `uv_tty_t` | terminal I/O |
| `uv_idle_t` | `setImmediate` (plus internal uses) |
| `uv_prepare_t` / `uv_check_t` | internal hooks, `beforeExit` plumbing |

**Requests** are one-shot operations submitted against a handle (or standalone). They complete and are then destroyed. They do NOT by themselves keep the loop alive — a pending request that has no associated active handle is an anomaly, not the norm.

Key request types:

| libuv type | Node.js surface |
|---|---|
| `uv_write_t` | `socket.write()`, `fs.WriteStream` write |
| `uv_connect_t` | `net.Socket.connect()` |
| `uv_shutdown_t` | `socket.end()` half-close |
| `uv_fs_t` | `fs.readFile`, `fs.open`, `fs.stat`, … |
| `uv_getaddrinfo_t` | `dns.resolve*` |
| `uv_work_t` | `crypto.pbkdf2`, custom libuv thread-pool work |

> [!NOTE]
> In Node's source you can inspect active handles at any time: `process._getActiveHandles()` and `process._getActiveRequests()`. These are underscore-prefixed (unofficial) but stable for debugging. They return live JS wrapper objects. Combine with `wtfnode` in production to find leaked handles by stack trace.

## The Loop's Anatomy — Six Phases

libuv's event loop is not a single monolithic poll. It runs through distinct phases on every "tick" (one full iteration):

```
┌─────────────────────────────────────────────────────┐
│ 1. timers              setTimeout/setInterval CBs    │
│ 2. pending callbacks   deferred I/O error CBs        │
│ 3. idle / prepare      internal (setImmediate prep)  │
│ 4. poll                block & drain I/O events      │
│    ┌── incoming connections, data, fs completions    │
│    └── if timers due → exit poll early               │
│ 5. check               setImmediate CBs              │
│ 6. close callbacks     socket.on('close', …)         │
└─────────────────────────────────────────────────────┘
     ↑___________________loop if active handles remain_│
```

**Phase 1 — timers.** The loop walks the min-heap of `uv_timer_t` objects sorted by expiry. Any timer whose `due_time ≤ now` fires. Node's `setTimeout(fn, 0)` actually has a minimum floor of ~1 ms in libuv (clamped from 0 to 1). The *time* checked is the cached `uv__hrtime()` captured once at loop entry, not a live clock — so timers inside the same iteration all see the same "now".

**Phase 2 — pending callbacks.** I/O callbacks deferred from the previous iteration (e.g., certain TCP errors on some platforms) fire here.

**Phase 3 — idle/prepare.** These are internal `uv_idle_t` and `uv_prepare_t` handles. Node uses `uv_prepare_t` to flush the microtask queue (Promise callbacks, `queueMicrotask`) and `nextTick` queue before blocking. This is why `process.nextTick` and resolved Promises drain *between* phases, not at a fixed phase boundary.

**Phase 4 — poll.** The beating heart. libuv calls the OS-level I/O multiplexer (`epoll_wait` / `kqueue` / `IOCP`). The timeout is computed as: `min(next_timer_due - now, INT_MAX)`. If there are no timers and no idle handles, the loop blocks indefinitely here until an I/O event arrives. Every callback fired from the poll phase can *enqueue* new timers and I/O that affect subsequent phases.

**Phase 5 — check.** `uv_check_t` handles fire. Node maps `setImmediate` to this phase. That's why `setImmediate` always fires *after* I/O callbacks in the same iteration, but *before* `setTimeout(fn, 0)` if both are scheduled from within an I/O callback.

**Phase 6 — close callbacks.** When a handle is closed (e.g., `socket.destroy()`), libuv queues its close callback here, one iteration later.

> [!PRINCIPAL]
> The poll-phase timeout is the knob that controls CPU burn vs latency. If you have frequent short timers (e.g., `setTimeout(fn, 1)`), the loop wakes every millisecond even with no I/O work — which is fine for low concurrency but burns a core at high connection count. At scale, prefer event-driven patterns (react to data) over polling patterns (wake on timer). libuv's `uv_timer_t` min-heap means N timers cost O(log N) to schedule; 10,000 short timers is measurably expensive.

## Run Modes

`uv_run()` accepts a mode flag:

| Mode | Behaviour |
|---|---|
| `UV_RUN_DEFAULT` | run until no active handles/reqs remain |
| `UV_RUN_ONCE` | one iteration of all phases, block at poll |
| `UV_RUN_NOWAIT` | one iteration, do NOT block at poll — return immediately |

Node's main entry point calls `uv_run(loop, UV_RUN_DEFAULT)`. Some embeddings (e.g., Electron's main process, Deno's Tokio integration points) need `UV_RUN_NOWAIT` to let their own event loop coexist. Node 22+ added `--experimental-eventsource` and other async primitives that still reduce to the same `UV_RUN_DEFAULT` loop.

## Ref / Unref — Why the Process Stays Alive

The loop's exit condition in `UV_RUN_DEFAULT` is:

```
active_handles > 0  OR  active_requests > 0
```

Every handle starts *active* when started and *referenced* (ref count = 1). The loop counts **referenced, active handles** when deciding whether to keep running.

Calling `handle.unref()` decrements the ref count to 0 — the handle is still active and will still fire its callback, but it no longer contributes to the "keep alive" count. Calling `handle.ref()` increments it back.

```js
// setInterval keeps the process alive forever
const t = setInterval(() => console.log("tick"), 1000);

// .unref() lets the process exit naturally once all other work is done
t.unref();

// If this is the last handle, the process exits without waiting for the next tick.
// The interval still fires if other handles keep the loop alive.
```

```js
// net.Server keeps the process alive until you call server.close()
// internally: server._handle.ref() is called in server.listen()
// explicitly unref a server to let the process die even if a client is connected:
// server.unref(); // rarely correct — only for testing / REPL embedding
```

> [!PITFALL]
> A common memory/process leak: you create a `setInterval` for health-check logging, forget to unref it or store a reference, and the process never exits after the main work finishes. `process._getActiveHandles()` will show `Timeout` objects. Always `.unref()` background timers that should not be the last reason the process is alive.

## How the Thread Pool Delivers Results Back to the Loop

libuv maintains a **thread pool** (default 4 threads, configurable via `UV_THREADPOOL_SIZE` up to 1024 — though Node clamps the default to `min(4, number_of_cpus)` as of Node 22). This pool is used for:

- All `fs.*` calls on Linux (file I/O is NOT handled by epoll — see the next lesson)
- `dns.lookup()` (not `dns.resolve*` which uses a proper async resolver)
- `crypto` heavy ops: `pbkdf2`, `scrypt`, `randomFill`
- `zlib` (compression)
- Custom native addons via `uv_queue_work`

The thread pool threads share the libuv loop's **single** `uv_async_t` wakeup handle. When a thread-pool worker finishes a `uv_fs_t` or `uv_work_t` request:

1. The worker writes the result into the request struct.
2. It calls `uv_async_send(loop->wq_async)` — an **async-safe** function that does an `eventfd_write(1)` on Linux (or `SetEvent` on Windows).
3. The poll phase in the event-loop thread wakes from `epoll_wait` because the eventfd is readable.
4. The loop drains the `loop->wq` (work queue), picks up completed requests, and invokes their JavaScript callbacks on the main thread.

This means: **all JS callbacks always execute on the single main thread**. The thread pool only does the blocking work; the result delivery always flows back through the poll phase.

```js
// Real Node — reading a file dispatches a uv_fs_t to the thread pool:
import { readFile } from "node:fs";

const before = performance.now();
readFile("/etc/hostname", (err, data) => {
  const after = performance.now();
  console.log(`fs callback in main thread, took ${(after - before).toFixed(1)} ms`);
  console.log("data:", data.toString().trim());
});
console.log("readFile dispatched — main thread is NOT blocked");
```

> [!OUTPUT]
> readFile dispatched — main thread is NOT blocked
> fs callback in main thread, took 1.4 ms
> data: my-hostname

> [!PRINCIPAL]
> With only 4 thread-pool threads, 5 simultaneous `fs.readFile` calls means the 5th waits in the work queue — it doesn't start until a thread becomes free. Under heavy mixed load (fs + dns + crypto), thread-pool starvation manifests as *seemingly random latency spikes* on otherwise fast operations. The fix is a higher `UV_THREADPOOL_SIZE`, but watch out: more threads = more memory and more context-switch cost. A principal engineer measures the actual queue depth with `--trace-event-categories node.threadpoolwork.sync` or clinic.js before reaching for the tuning knob.

## Try it yourself

This simulator implements a mini event-loop with explicit handle/request tracking and ref-counting. It teaches the exact exit condition of `uv_run`. Experiment: add `myTimer.unref()` and watch the loop exit early.

```js run
// Mini libuv event-loop simulator — handle/request registry with ref-counting
// All pure JS — no Node APIs needed.

class Handle {
  constructor(name, intervalMs, cb) {
    this.name = name;
    this.intervalMs = intervalMs;
    this.cb = cb;
    this.active = true;
    this._refCount = 1; // starts referenced
    this._nextFire = intervalMs;
  }
  ref()   { if (this.active) this._refCount = 1; return this; }
  unref() { this._refCount = 0; return this; }
  stop()  { this.active = false; this._refCount = 0; }
}

class Request {
  constructor(name, completesAtMs, cb) {
    this.name = name;
    this.completesAtMs = completesAtMs;
    this.cb = cb;
    this.done = false;
  }
}

class MiniLoop {
  constructor() {
    this.handles = [];
    this.requests = [];
    this.now = 0;
    this.log = [];
  }

  addHandle(h)  { this.handles.push(h); return h; }
  addRequest(r) { this.requests.push(r); return r; }

  _activeReferenced() {
    return this.handles.filter(h => h.active && h._refCount > 0).length;
  }
  _pendingRequests() {
    return this.requests.filter(r => !r.done).length;
  }

  run(maxMs = 200) {
    this.log.push(`[loop] starting — handles: ${this.handles.length}, reqs: ${this.requests.length}`);
    while (this.now <= maxMs) {
      const alive = this._activeReferenced() + this._pendingRequests();
      if (alive === 0) {
        this.log.push(`[loop] t=${this.now}ms — no active refs, loop exits`);
        break;
      }

      // Phase 1: fire handles whose interval elapsed
      for (const h of this.handles) {
        if (h.active && this.now >= h._nextFire) {
          this.log.push(`[handle:${h.name}] t=${this.now}ms fired (ref=${h._refCount})`);
          h.cb(h, this);
          if (h.active) h._nextFire = this.now + h.intervalMs;
        }
      }

      // Phase 4: poll — deliver completed requests
      for (const r of this.requests) {
        if (!r.done && this.now >= r.completesAtMs) {
          this.log.push(`[request:${r.name}] t=${this.now}ms completed`);
          r.done = true;
          r.cb(r, this);
        }
      }

      this.now += 10; // advance simulated clock 10 ms per iteration
    }
    this.log.forEach(l => console.log(l));
  }
}

const loop = new MiniLoop();

// A timer handle — keeps the process alive (ref=1)
const heartbeat = loop.addHandle(new Handle("heartbeat", 30, (h) => {
  // after 3 fires, stop the heartbeat
  if (h._nextFire > 90) { h.stop(); }
}));

// A background debug handle — unrefed, should NOT keep loop alive
const debugTimer = loop.addHandle(new Handle("debug-logger", 20, (h) => {
  // fires whenever loop is alive, but won't keep it alive alone
}));
debugTimer.unref(); // <-- key: unref means it won't prevent loop exit

// A one-shot file-read request (simulates uv_fs_t returning from thread pool)
loop.addRequest(new Request("readFile", 45, (r) => {
  console.log("  -> readFile result delivered to main thread at t=45ms");
}));

loop.run(200);
```

## Exercise

**Challenge:** Extend the simulator above so that a `Request`, when it completes, *creates a new Handle* (e.g., a connection handle for a TCP session), and verify that the loop now stays alive longer because the new handle is referenced.

<details>
<summary>Show solution</summary>

```js run
class Handle {
  constructor(name, intervalMs, cb) {
    this.name = name; this.intervalMs = intervalMs; this.cb = cb;
    this.active = true; this._refCount = 1; this._nextFire = intervalMs;
  }
  ref()   { if (this.active) this._refCount = 1; return this; }
  unref() { this._refCount = 0; return this; }
  stop()  { this.active = false; this._refCount = 0; }
}
class Request {
  constructor(name, completesAtMs, cb) {
    this.name = name; this.completesAtMs = completesAtMs; this.cb = cb; this.done = false;
  }
}
class MiniLoop {
  constructor() { this.handles = []; this.requests = []; this.now = 0; }
  addHandle(h)  { this.handles.push(h); return h; }
  addRequest(r) { this.requests.push(r); return r; }
  _alive() {
    return this.handles.filter(h => h.active && h._refCount > 0).length
         + this.requests.filter(r => !r.done).length;
  }
  run(maxMs = 300) {
    while (this.now <= maxMs && this._alive() > 0) {
      for (const h of this.handles) {
        if (h.active && this.now >= h._nextFire) {
          h.cb(h, this);
          if (h.active) h._nextFire = this.now + h.intervalMs;
        }
      }
      for (const r of this.requests) {
        if (!r.done && this.now >= r.completesAtMs) {
          r.done = true;
          r.cb(r, this);
        }
      }
      this.now += 10;
    }
    console.log(`loop exited at t=${this.now}ms, alive=${this._alive()}`);
  }
}

const loop = new MiniLoop();

// accept request — when complete, spawns a connection handle that runs for 80ms
loop.addRequest(new Request("accept-conn", 20, (r, lp) => {
  console.log(`t=${lp.now}: accept completed → spawning tcp-session handle`);
  const session = lp.addHandle(new Handle("tcp-session", 999, (h, lp2) => {
    // session expires after 80ms from creation
    if (lp2.now >= 100) {
      console.log(`t=${lp2.now}: tcp-session closed`);
      h.stop();
    }
  }));
  session._nextFire = lp.now; // fire immediately next iteration
}));

loop.run(300);
// Loop should exit around t=100-110ms when tcp-session stops
```

</details>

## Common pitfalls

> [!PITFALL]
> **Confusing "unref" with "close."** An unrefed handle still fires its callback — it just won't prevent the loop from exiting. If you unref a timer and then the process *does* stay alive (other active handles), the timer fires normally. This surprises engineers who think unref = disabled. If you want to prevent the callback from ever firing again, call `clearTimeout` / `clearInterval` / `server.close()` / `socket.destroy()`.

A second pitfall: Node wraps `uv_timer_t` with extra bookkeeping. If you call `setTimeout(fn, 0)` in a tight loop without `setImmediate`, you can accidentally keep rescheduling a timer before the poll phase empties, starving I/O. Always prefer `setImmediate` for deferring work to the next iteration when you are *inside* an I/O callback.

## What you learned

- **Handles** are long-lived libuv objects (sockets, timers, signals) that stay in the loop; **requests** are one-shot operations (file reads, DNS lookups, writes) that complete and disappear.
- The loop runs six ordered phases each iteration, with the poll phase blocking until I/O or a timer fires.
- `active_referenced_handles + pending_requests > 0` is the sole exit condition in `UV_RUN_DEFAULT`.
- `.ref()` / `.unref()` toggle whether a handle contributes to the keep-alive count — unrefed handles still fire.
- The thread pool uses a shared `uv_async_t` wakeup handle to safely deliver completed work back to the main-thread event loop via the poll phase.

## Next steps

Now that you know the loop's anatomy, the next lesson digs into *how* the poll phase actually waits for I/O — the OS-level backends: `epoll`, `kqueue`, `IOCP`, and the new `io_uring`.
*/});
