registerLessonSrc("11-crash-handling", function () {/*
---
id: 11-crash-handling
title: "uncaughtException, unhandledRejection & Exit Codes"
minutes: 28
level: advanced
objectives:
  - Understand uncaughtException and unhandledRejection and why swallowing them is dangerous
  - Apply the correct pattern — log, attempt cleanup, then exit — for both error types
  - Use process.exitCode vs process.exit() and understand exit-code conventions
---

# uncaughtException, unhandledRejection & Exit Codes

## Why this matters

Every production Node service will eventually encounter a bug it did not anticipate: a null-dereference deep in a dependency, a network call that rejects without a catch block, a JSON.parse on malformed data. What happens next determines whether your service fails safely — alerting operators and stopping cleanly — or whether it silently corrupts state and limps along in an unknown half-working condition. The difference is a handful of carefully written global error handlers and a disciplined exit-code contract.

## Learning objectives

- Register `uncaughtException` and `unhandledRejection` handlers to catch all unhandled errors.
- Understand why the only safe response to an uncaught exception is **log + attempt cleanup + exit** — never just swallow the error.
- Distinguish `process.exit(code)` from setting `process.exitCode` and know when to use each.
- Apply POSIX exit-code conventions so orchestrators, CI pipelines, and shell scripts can react correctly.

## uncaughtException — catching the uncatchable

When a synchronous exception is thrown and no `try/catch` in the call stack catches it, Node emits the `uncaughtException` event on `process`. If nothing handles *that*, Node prints the stack trace and exits with code 1.

```js
// Without a handler — the process crashes and Node prints the stack:
// UnhandledError: surprise!
//   at Object.<anonymous> (app.js:2:7)

// With a handler:
process.on("uncaughtException", (err, origin) => {
  // origin is "uncaughtException" or "unhandledRejection"
  console.error("[FATAL] Uncaught exception:", err.message);
  console.error("Origin:", origin);
  console.error(err.stack);
  // ALWAYS exit after logging — do not continue
  process.exit(1);
});

// This throw will now be caught by the handler above:
throw new Error("surprise!");
```

> [!OUTPUT]
> [FATAL] Uncaught exception: surprise!
> Origin: uncaughtException
> Error: surprise!
>     at Object.<anonymous> (app.js:14:7)

> [!WARNING] Never swallow uncaughtException and continue
> The Node documentation is explicit: after an `uncaughtException`, the application is in an **undefined state**. Heap objects may be corrupt, pending timers may reference freed memory, open file descriptors may be orphaned. Continuing to run is like driving with a shredded tyre — it might seem to work for a moment, then fail catastrophically. Always log and exit. Use a process supervisor (systemd, PM2, Kubernetes) to restart the process cleanly.

## unhandledRejection — the async equivalent

A promise that rejects with no `.catch()` and no `await` in a try/catch triggers `unhandledRejection`. Since Node 15, an unhandled rejection exits with code 1 by default, but you should always register an explicit handler to control the log format and cleanup flow:

```js
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection");
  console.error("Promise:", promise);
  console.error("Reason:", reason instanceof Error ? reason.stack : reason);
  process.exit(1);
});

// This rejection will be caught:
Promise.reject(new Error("async surprise!"));
```

> [!OUTPUT]
> [FATAL] Unhandled promise rejection
> Promise: Promise { <rejected> Error: async surprise! }
> Reason: Error: async surprise!
>     at Object.<anonymous> (app.js:10:16)

> [!PITFALL] Async errors inside setTimeout or setInterval are uncaughtExceptions, not rejections
> `setTimeout(async () => { throw new Error("oops"); }, 100)` — the async function returns a rejected promise, but nobody awaits it. This becomes an `unhandledRejection`, not an `uncaughtException`. Both handlers are needed. Do not assume one covers the other.

## The right pattern: log, attempt cleanup, then exit

Crashing quickly and cleanly is better than limping. The canonical pattern:

```js
import http from "node:http";

const server = http.createServer(handler);
server.listen(3000);

async function emergencyShutdown(err, origin) {
  console.error(`[CRASH] ${origin}:`, err?.stack ?? err);

  // Give cleanup a short window — do not let cleanup itself block forever
  const cleanupTimeout = setTimeout(() => {
    console.error("[CRASH] Cleanup timed out — forcing exit");
    process.exit(1);
  }, 5_000);
  cleanupTimeout.unref();   // do not keep the event loop alive just for this timer

  try {
    // Best-effort cleanup: stop accepting new requests
    await new Promise(resolve => server.close(resolve));
    // await db.end();
    // await telemetry.flush();
    console.error("[CRASH] Emergency cleanup done");
  } catch (cleanupErr) {
    console.error("[CRASH] Cleanup also failed:", cleanupErr.message);
  }

  process.exit(1);
}

process.on("uncaughtException",  (err, origin) => emergencyShutdown(err, origin));
process.on("unhandledRejection", (reason)       => emergencyShutdown(reason, "unhandledRejection"));
```

> [!OUTPUT]
> [CRASH] uncaughtException: Error: something went wrong
>     at ...
> [CRASH] Emergency cleanup done

> [!PRINCIPAL] Error handlers are a last-resort circuit-breaker, not a catch-all
> Registering `uncaughtException` and `unhandledRejection` does NOT mean "I don't need try/catch anymore." These handlers are your circuit-breaker: they fire for bugs you did not expect, log structured diagnostic data for your observability stack, and exit cleanly. Every predictable error path (validation, network, DB) should still be handled explicitly with try/catch or .catch(). The global handlers exist for the remaining 1% — the bugs you did not know about yet.

## process.exit() vs process.exitCode

Two ways to set the exit code:

```js
// process.exit(code) — stops the event loop immediately.
// No more callbacks, timers, or I/O. No 'exit' event guarantees for async code.
process.exit(0);    // clean
process.exit(1);    // error

// process.exitCode — sets the code that will be used when the event loop
// drains naturally. Lets pending I/O and timers finish.
process.exitCode = 1;
// ... the process continues, then exits with code 1 when the loop is empty
```

```js
// The 'exit' event fires just before the process terminates.
// ONLY synchronous code runs here — no awaits, no timers, no I/O.
process.on("exit", (code) => {
  // Synchronous last-chance log — useful for structured exit telemetry
  console.log(`Process exiting with code ${code}`);
});
```

> [!OUTPUT]
> Process exiting with code 0

When to use each:

| Situation | Recommended approach |
|---|---|
| Crash handler — stop immediately | `process.exit(1)` |
| CLI that finishes work normally | let the loop drain; set `process.exitCode` if needed |
| Test runner marking a failure | `process.exitCode = 1`, let the runner finish cleanup |
| Graceful shutdown after cleanup | `process.exit(0)` after awaiting cleanup |

## Exit code conventions

Exit codes are how your process communicates its outcome to the shell, CI pipelines, Kubernetes liveness probes, and process supervisors. Follow the POSIX convention:

| Code | Meaning |
|---|---|
| `0` | Success — everything worked |
| `1` | Generic error — unspecified failure |
| `2` | Misuse of shell built-in or bad arguments (used by shells themselves) |
| `3`-`125` | Application-defined errors — document them! |
| `126` | Command found but not executable |
| `127` | Command not found |
| `128 + N` | Terminated by signal N (e.g. 130 = Ctrl-C = SIGINT, 143 = SIGTERM) |

```js
// Documenting exit codes as constants is a best practice:
const EXIT = Object.freeze({
  OK:             0,
  ERR_GENERIC:    1,
  ERR_CONFIG:     2,
  ERR_DB:         3,
  ERR_TIMEOUT:    4,
});

// In your shutdown logic:
// process.exit(EXIT.ERR_DB);   // ops team knows it's a DB issue from the code alone
```

> [!NOTE] Exit code 1 vs specific codes
> For simple services, `0` (success) and `1` (error) are enough. For complex daemons or CLIs used in scripts and pipelines, define application-specific codes (3–125) and document them in a README or `--help` output. Kubernetes can map exit codes to specific restart policies.

## Try it yourself

A daemon can be modelled as a **state machine** with explicit health states. Building this in pure JS makes the logic clear before adding any Node-specific APIs. This is the foundation of the project below.

```js run
// Pure-JS daemon state machine — no Node APIs needed.
// States: STARTING -> RUNNING -> STOPPING -> STOPPED (or CRASHED)

function createDaemon(name) {
  const STATES = ["STARTING", "RUNNING", "STOPPING", "STOPPED", "CRASHED"];
  let state = "STARTING";
  const log = [];

  function transition(next) {
    const valid = {
      STARTING: ["RUNNING", "CRASHED"],
      RUNNING:  ["STOPPING", "CRASHED"],
      STOPPING: ["STOPPED", "CRASHED"],
      STOPPED:  [],
      CRASHED:  [],
    };
    if (!valid[state].includes(next)) {
      throw new Error(`Invalid transition: ${state} -> ${next}`);
    }
    log.push(`${state} -> ${next}`);
    state = next;
  }

  function health() {
    return { name, state, healthy: state === "RUNNING" };
  }

  return { transition, health, getLog: () => [...log] };
}

const daemon = createDaemon("api-server");

// Simulate a normal lifecycle
daemon.transition("RUNNING");
console.log("Health:", daemon.health());

daemon.transition("STOPPING");
daemon.transition("STOPPED");
console.log("Final state:", daemon.health().state);
console.log("Transitions:", daemon.getLog().join(" | "));

// Simulate a crash from RUNNING
const daemon2 = createDaemon("worker");
daemon2.transition("RUNNING");

try {
  daemon2.transition("STOPPING");
  daemon2.transition("CRASHED");   // can't crash after stopping — invalid
} catch (err) {
  console.log("Caught invalid transition:", err.message);
}

console.log("Worker state:", daemon2.health().state);
```

## Exercise

**Challenge:** Extend the daemon state machine to record a `crashReason` when transitioning to `CRASHED`, and implement a `canRestart()` method that returns `true` only when the daemon is `STOPPED` or `CRASHED`. Then simulate a crash, inspect the reason, and restart.

<details>
<summary>Show solution</summary>

```js run
function createDaemon(name) {
  let state = "STARTING";
  let crashReason = null;
  const log = [];

  const validTransitions = {
    STARTING: ["RUNNING", "CRASHED"],
    RUNNING:  ["STOPPING", "CRASHED"],
    STOPPING: ["STOPPED", "CRASHED"],
    STOPPED:  ["STARTING"],
    CRASHED:  ["STARTING"],
  };

  function transition(next, reason) {
    if (!validTransitions[state].includes(next)) {
      throw new Error(`Invalid transition: ${state} -> ${next}`);
    }
    if (next === "CRASHED") {
      crashReason = reason ?? "Unknown error";
    }
    if (next === "STARTING") {
      crashReason = null;   // clear on restart
    }
    log.push(`${state} -> ${next}${reason ? " (" + reason + ")" : ""}`);
    state = next;
  }

  function canRestart() {
    return state === "STOPPED" || state === "CRASHED";
  }

  function health() {
    return { name, state, healthy: state === "RUNNING", crashReason };
  }

  return { transition, canRestart, health, getLog: () => [...log] };
}

const daemon = createDaemon("payments-worker");
daemon.transition("RUNNING");

// Simulate a crash
daemon.transition("CRASHED", "Database connection lost");
console.log("Health after crash:", daemon.health());
console.log("Can restart?", daemon.canRestart());

// Restart the daemon
if (daemon.canRestart()) {
  daemon.transition("STARTING");
  daemon.transition("RUNNING");
  console.log("Restarted successfully:", daemon.health());
}

console.log("Lifecycle:", daemon.getLog().join(" | "));
```

</details>

## Project

**Build a long-running daemon with graceful shutdown, signal handling, and a clean health/exit-code contract.**

You are building a production-grade daemon class that combines everything from this module: signal handling (SIGTERM/SIGINT), uncaughtException/unhandledRejection safety nets, a state-machine health model, ordered cleanup handlers, a shutdown timeout, and well-defined exit codes.

### Acceptance criteria

1. **State machine** — the daemon tracks `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, and `CRASHED` states. Illegal transitions throw immediately.
2. **Signal handling** — `SIGTERM` and `SIGINT` trigger graceful shutdown. A second `SIGINT` (impatient user) forces immediate exit with code `130`.
3. **Global error safety net** — `uncaughtException` and `unhandledRejection` both call `emergencyShutdown()` which logs the error, attempts best-effort cleanup, and exits with code `1`.
4. **Ordered cleanup** — cleanup handlers registered with `onShutdown(name, fn)` run in order. If one throws, the error is logged and the next handler still runs (no abort).
5. **Shutdown timeout** — if all cleanup handlers do not finish within a configurable `shutdownTimeoutMs`, the daemon force-exits with code `1`.
6. **Exit code contract** — exits `0` for clean shutdown, `1` for crash or timeout, `2` for invalid startup configuration. The exit code is observable via `process.exitCode` before `process.exit()` is called.

### Pure-JS starter

This starter implements the core state machine and shutdown orchestration in pure JS. Extend it with real signal bindings and Node APIs:

```js run
// Daemon state machine + shutdown orchestration — pure JS core.

const EXIT = Object.freeze({ OK: 0, ERR: 1, ERR_CONFIG: 2, ERR_SIGNAL: 130 });

function createDaemon({ name, shutdownTimeoutMs = 5000 } = {}) {
  let state = "STARTING";
  let exitCode = EXIT.OK;
  let shuttingDown = false;
  const cleanupHandlers = [];   // [{ name, fn }]
  const transitionLog = [];

  const validTransitions = {
    STARTING: ["RUNNING", "CRASHED"],
    RUNNING:  ["STOPPING", "CRASHED"],
    STOPPING: ["STOPPED", "CRASHED"],
    STOPPED:  [],
    CRASHED:  [],
  };

  function setState(next) {
    if (!validTransitions[state]?.includes(next)) {
      throw new Error(`[${name}] Illegal transition: ${state} -> ${next}`);
    }
    transitionLog.push(`${state}->${next}`);
    state = next;
  }

  function onShutdown(handlerName, fn) {
    cleanupHandlers.push({ name: handlerName, fn });
  }

  function health() {
    return { name, state, exitCode, healthy: state === "RUNNING" };
  }

  async function runCleanup() {
    let failures = 0;
    for (const h of cleanupHandlers) {
      try {
        console.log(`  [cleanup] ${h.name}...`);
        await h.fn();
        console.log(`  [cleanup] ${h.name} done`);
      } catch (err) {
        console.error(`  [cleanup] ${h.name} FAILED: ${err.message}`);
        failures++;
      }
    }
    return failures;
  }

  async function shutdown(reason, code = EXIT.OK) {
    if (shuttingDown) {
      console.log(`[${name}] Shutdown already in progress`);
      return;
    }
    shuttingDown = true;
    exitCode = code;
    console.log(`[${name}] Shutdown: ${reason} (code=${code})`);

    try {
      setState("STOPPING");
    } catch {
      // May already be in CRASHED — proceed anyway
    }

    const timeoutHandle = setTimeout(() => {
      console.error(`[${name}] Shutdown timed out — forcing exit`);
      process.exitCode = EXIT.ERR;
      process.exit(EXIT.ERR);
    }, shutdownTimeoutMs);

    const failures = await runCleanup();
    clearTimeout(timeoutHandle);

    try { setState("STOPPED"); } catch (_) {} // already crashed — ignore

    const finalCode = failures > 0 ? EXIT.ERR : exitCode;
    console.log(`[${name}] Exiting with code ${finalCode}`);
    console.log(`[${name}] State history: ${transitionLog.join(", ")}`);
    // In real code: process.exit(finalCode);
    return finalCode;
  }

  async function emergencyShutdown(err, origin) {
    console.error(`[${name}][CRASH] ${origin}: ${err?.message ?? err}`);
    try { setState("CRASHED"); } catch (_) {} // ignore — already in terminal state
    await shutdown("emergency", EXIT.ERR);
  }

  function start() {
    setState("RUNNING");
    console.log(`[${name}] Started — state: ${state}`);
  }

  return { start, onShutdown, health, shutdown, emergencyShutdown };
}

// --- Demo ---
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const daemon = createDaemon({ name: "api-daemon", shutdownTimeoutMs: 3000 });

daemon.onShutdown("http-server",    () => delay(30).then(() => {}));
daemon.onShutdown("db-pool",        () => delay(50).then(() => {}));
daemon.onShutdown("metrics-flush",  () => delay(20).then(() => {}));

daemon.start();
console.log("Health check:", daemon.health());

// Simulate SIGTERM arriving 100ms later
setTimeout(async () => {
  const code = await daemon.shutdown("SIGTERM", EXIT.OK);
  console.log("Final exit code:", code);
  console.log("Health after shutdown:", daemon.health());
}, 100);
```

## Common pitfalls

> [!PITFALL] Using process.on("uncaughtException") to swallow errors and keep running
> This is the single most dangerous misuse of the API. Code that catches uncaughtException and does *not* exit produces a process running in an unknown state. Corrupted closures, orphaned DB transactions, and memory leaks follow. The Node docs explicitly forbid this pattern for anything but diagnostic/cleanup use. Always exit.

> [!PITFALL] Forgetting to call .unref() on emergency timers
> When you set a `setTimeout` as a backstop (e.g., "if cleanup takes too long, force exit"), call `.unref()` on the timer handle. Without it, the timer itself keeps the event loop alive — meaning if all your real work finishes and there is nothing else running, the process still will not exit until the timeout fires. `.unref()` tells Node "this timer is a safety net, not a reason to stay alive."

## What you learned

- `uncaughtException` catches synchronous throws that escape all call stacks; `unhandledRejection` catches promise rejections with no handler. Both require the same response: log + cleanup + exit.
- The only safe recovery from an uncaught exception is a fast, clean exit — continuing to run risks data corruption and unpredictable behaviour.
- `process.exit(code)` halts immediately; `process.exitCode = N` lets the loop drain first. Use `process.exit()` in crash handlers where you cannot trust the event loop.
- Exit codes are a contract: `0` = success, `1` = generic error, `2` = config error, `130` = SIGINT, `143` = SIGTERM. Document non-standard codes.
- The complete daemon pattern combines: state machine, signal handlers, global error nets, ordered cleanup with `continue-on-error`, and a shutdown timeout — all working together.

## Next steps

You have now mastered the full process lifecycle — configuration, signals, and crash handling. The next module explores building polished command-line interfaces with `util.parseArgs`, interactive prompts, and publishing CLIs to npm.
*/});
