registerLessonSrc("11-signals-shutdown", function () {/*
---
id: 11-signals-shutdown
title: "Signals & Graceful Shutdown"
minutes: 24
level: advanced
objectives:
  - Understand POSIX signals and which ones a Node process must handle
  - Register per-signal handlers with process.on() to intercept shutdown requests
  - Implement a GracefulShutdown manager that drains connections and runs cleanup in order with a timeout
---

# Signals & Graceful Shutdown

## Why this matters

Every long-running server — a REST API, a queue worker, a WebSocket gateway — will be asked to stop at some point. Kubernetes sends `SIGTERM` before it kills a pod. A developer hits Ctrl-C and sends `SIGINT`. A load balancer rotates your process. If your code ignores these signals, two bad things happen: in-flight requests get hard-cut (returning 502s to clients), and cleanup code (flushing logs, committing transactions, closing DB pools) never runs. Graceful shutdown is the difference between a professional production service and one that corrupts state on every deploy.

## Learning objectives

- Name the key POSIX signals (`SIGINT`, `SIGTERM`, `SIGHUP`) and what each one means.
- Register signal handlers with `process.on("SIGTERM", handler)`.
- Implement a shutdown sequence: stop accepting new work, drain in-flight work, run cleanup handlers, exit with the right code.
- Race a cleanup timeout against actual completion so a hung handler can never stall a shutdown indefinitely.

## POSIX signals — what the OS sends your process

A **signal** is a small integer the operating system (or another process) delivers to a process to notify it of an event. You cannot pass data with a signal — only the signal number itself arrives. Node translates signal numbers into string names.

| Signal | Typical sender | Default action | What it means |
|---|---|---|---|
| `SIGINT` | Terminal (Ctrl-C) | terminate | Interactive interrupt — user wants to stop |
| `SIGTERM` | `kill`, orchestrators (Kubernetes, systemd, Heroku) | terminate | Polite shutdown request — please stop soon |
| `SIGHUP` | Terminal closed, daemon managers | terminate | Historically "hang up"; often repurposed to mean "reload config" |
| `SIGUSR1` | Custom (your tooling) | terminate | Reserved for application-defined use (Node uses it for `--inspect`) |
| `SIGKILL` | `kill -9`, OS OOM killer | **uncatchable** — immediate kill | Cannot be caught; Node cannot run any code after this |

> [!NOTE] SIGKILL is uncatchable
> You can never handle `SIGKILL`. It is the OS's last resort. The only protection against it is to finish your graceful shutdown before the orchestrator's kill-timeout elapses. Kubernetes default grace period is 30 seconds — your shutdown must complete inside that window.

## Registering signal handlers

Node exposes signals through the `EventEmitter`-like `process.on()` API:

```js
// Handle Ctrl-C from the terminal
process.on("SIGINT", () => {
  console.log("\nSIGINT received — starting graceful shutdown");
  shutdown("SIGINT");
});

// Handle orchestrator shutdown (Kubernetes, systemd, Heroku)
process.on("SIGTERM", () => {
  console.log("SIGTERM received — starting graceful shutdown");
  shutdown("SIGTERM");
});

// Handle terminal disconnect / config reload request
process.on("SIGHUP", () => {
  console.log("SIGHUP received — reloading configuration");
  reloadConfig();
});
```

> [!WARNING] Registering a signal handler disables the default action
> The moment you call `process.on("SIGTERM", fn)`, Node will no longer automatically exit when `SIGTERM` arrives. *You* are now responsible for calling `process.exit()` at the end of your handler. Forgetting this means your process becomes un-stoppable via `SIGTERM`.

## The shutdown sequence

A well-behaved shutdown follows a strict order:

```
1. Stop accepting new work   (close HTTP server, pause queue consumers)
2. Drain in-flight work      (wait for active requests / jobs to finish)
3. Run cleanup handlers      (close DB pool, flush telemetry, commit metrics)
4. Exit with correct code    (process.exit(0) for clean, process.exit(1) for error)
```

Here is what this looks like with Node's built-in `http` module:

```js
import http from "node:http";

const server = http.createServer((req, res) => {
  // Simulate work with a short delay
  setTimeout(() => res.end("OK\n"), 100);
});

server.listen(3000, () => console.log("Listening on :3000"));

async function shutdown(signal) {
  console.log(`[${signal}] shutting down...`);

  // Step 1: stop accepting new connections
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  console.log("Server closed — no new connections accepted");

  // Step 2: in-flight requests finish naturally (server.close waits for them)

  // Step 3: cleanup
  // await db.end();
  // await telemetry.flush();
  console.log("Cleanup complete");

  // Step 4: exit
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
```

> [!OUTPUT]
> Listening on :3000
> SIGTERM received — starting graceful shutdown
> Server closed — no new connections accepted
> Cleanup complete

> [!PRINCIPAL] server.close() only stops new connections — not in-flight ones
> `server.close(cb)` stops the server from accepting new TCP connections, but keeps existing keep-alive connections open. In Node 18.2+ you can call `server.closeAllConnections()` to forcibly close idle keep-alive connections, and `server.closeIdleConnections()` to only close idle ones while letting active requests finish. This is essential for fast graceful shutdown under production load where clients hold open keep-alive connections.

## The timeout race — guarding against hung handlers

What if a cleanup handler stalls — a DB that never acknowledges a close, a queue that hangs mid-drain? Without a timeout, shutdown blocks forever and the orchestrator is forced to `SIGKILL` you anyway, losing the benefit of the graceful approach.

The correct pattern races cleanup against a deadline:

```js
function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} did not finish in ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

async function shutdown(signal) {
  console.log(`[${signal}] graceful shutdown started`);
  try {
    await withTimeout(runAllCleanup(), 10_000, "graceful shutdown");
    console.log("Clean shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("Shutdown timed out or failed:", err.message);
    process.exit(1);   // non-zero: orchestrator knows it was not clean
  }
}
```

> [!OUTPUT]
> [SIGTERM] graceful shutdown started
> Clean shutdown complete

## Try it yourself

The core of a graceful shutdown manager is a **registry of cleanup functions run in order, raced against a timeout**. This concept is pure logic — let's build it as a runnable simulation:

```js run
// GracefulShutdown manager — pure JS, no Node APIs needed to understand the pattern.

function createGracefulShutdown({ timeoutMs = 5000 } = {}) {
  const handlers = [];    // [{name, fn}] — run in registration order
  let shuttingDown = false;

  function register(name, fn) {
    handlers.push({ name, fn });
  }

  async function run(signal) {
    if (shuttingDown) {
      console.log("Shutdown already in progress — ignoring duplicate signal");
      return;
    }
    shuttingDown = true;
    console.log(`[${signal}] Graceful shutdown initiated (${handlers.length} handlers)`);

    const deadline = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Shutdown timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    );

    const cleanup = (async () => {
      for (const { name, fn } of handlers) {
        console.log(`  → running: ${name}`);
        await fn();
        console.log(`  ✓ done:    ${name}`);
      }
    })();

    try {
      await Promise.race([cleanup, deadline]);
      console.log("All handlers completed successfully");
      return 0;
    } catch (err) {
      console.error("Shutdown error:", err.message);
      return 1;
    }
  }

  return { register, run };
}

// --- simulate a real app ---

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const shutdown = createGracefulShutdown({ timeoutMs: 3000 });

shutdown.register("http-server",    () => delay(50).then(() => console.log("    (server.close() done)")));
shutdown.register("queue-consumer", () => delay(30).then(() => console.log("    (queue paused)")));
shutdown.register("db-pool",        () => delay(80).then(() => console.log("    (pool drained)")));
shutdown.register("telemetry",      () => delay(20).then(() => console.log("    (metrics flushed)")));

// Simulate SIGTERM arriving
shutdown.run("SIGTERM").then(code => {
  console.log("Exit code would be:", code);
});
```

## Exercises

**Exercise 1:** Add an `unregister(name)` method to the `createGracefulShutdown` factory so you can remove a handler that is no longer needed (for example, when a subsystem is conditionally loaded).

<details>
<summary>Show solution</summary>

```js run
function createGracefulShutdown({ timeoutMs = 5000 } = {}) {
  const handlers = [];

  function register(name, fn) {
    handlers.push({ name, fn });
  }

  function unregister(name) {
    const idx = handlers.findIndex(h => h.name === name);
    if (idx !== -1) {
      handlers.splice(idx, 1);
      console.log(`Unregistered handler: ${name}`);
    } else {
      console.log(`Handler not found: ${name}`);
    }
  }

  async function run(signal) {
    console.log(`[${signal}] Running ${handlers.length} remaining handlers`);
    for (const { name, fn } of handlers) {
      await fn();
      console.log(`  done: ${name}`);
    }
    return 0;
  }

  return { register, unregister, run };
}

const sd = createGracefulShutdown();
sd.register("db",    async () => {});
sd.register("cache", async () => {});
sd.register("queue", async () => {});

sd.unregister("cache");       // remove a handler
sd.unregister("not-there");   // safe no-op

sd.run("SIGTERM");
```

</details>

**Exercise 2:** Modify the shutdown runner so that if one handler throws, it logs the error and continues running the remaining handlers rather than aborting the whole sequence. Track how many handlers failed and use that to determine the exit code.

<details>
<summary>Show solution</summary>

```js run
async function runHandlers(handlers) {
  let failures = 0;
  for (const { name, fn } of handlers) {
    try {
      await fn();
      console.log(`  ok: ${name}`);
    } catch (err) {
      console.error(`  FAILED: ${name} — ${err.message}`);
      failures++;
    }
  }
  return failures;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const handlers = [
  { name: "server",  fn: async () => { await delay(10); } },
  { name: "broken",  fn: async () => { throw new Error("connection refused"); } },
  { name: "db-pool", fn: async () => { await delay(20); } },
];

runHandlers(handlers).then(failures => {
  const code = failures > 0 ? 1 : 0;
  console.log(`Shutdown complete with ${failures} failure(s) — exit code ${code}`);
});
```

</details>

## Common pitfalls

> [!PITFALL] Registering signal handlers without ever calling process.exit()
> Once you add `process.on("SIGTERM", fn)`, the default "exit immediately" behaviour is gone. If your handler completes but never calls `process.exit()`, the process hangs alive — appearing healthy to your orchestrator but doing nothing. Always end your shutdown handler with `process.exit(0)` (success) or `process.exit(1)` (failed shutdown).

> [!PITFALL] Calling process.exit() synchronously inside the handler
> Calling `process.exit()` immediately in a signal handler skips all async cleanup. The pattern is: set a flag, kick off async cleanup, await everything, *then* call `process.exit()`. Also guard with the `shuttingDown` flag so duplicate signals (common when users hit Ctrl-C twice) do not start a second parallel shutdown.

## What you learned

- `SIGINT` (Ctrl-C), `SIGTERM` (orchestrators), and `SIGHUP` (daemon managers) are the three signals every long-running Node process should handle. `SIGKILL` cannot be caught.
- Registering `process.on("SIGTERM", fn)` disables the default exit — you must call `process.exit()` yourself.
- The shutdown sequence is: stop new work → drain in-flight work → run cleanup handlers in order → exit.
- A timeout race (`Promise.race([cleanup, deadline])`) prevents a hung handler from blocking shutdown indefinitely.
- Exit with `process.exit(0)` on clean completion and `process.exit(1)` on error so orchestrators can distinguish clean restarts from failures.

## Next steps

Signals handle the *expected* shutdown path. The next lesson covers the *unexpected* path: `uncaughtException`, `unhandledRejection`, and how to build a crash-safe daemon with a clean exit-code contract.
*/});
