registerLessonSrc("29-resilience", function () {/*
---
id: 29-resilience
title: "Resilience: Timeouts, Retries & Circuit Breakers"
minutes: 28
level: principal
objectives:
  - Apply timeouts, retries, and jitter to prevent cascading failures in distributed systems
  - Implement the circuit breaker state machine (closed, open, half-open)
  - Design bulkheads and fallbacks to contain failure blast radius
---

# Resilience: Timeouts, Retries & Circuit Breakers

## Why this matters

In a distributed system, failure is not an edge case — it is a routine operating condition. A database goes slow, a downstream API rate-limits you, a container gets OOM-killed mid-request. How your service *behaves* during those moments determines whether you have a blip or an outage. The patterns in this lesson — timeouts, retries, and circuit breakers — are what separate a service that gracefully degrades from one that silently amplifies failures across the whole system.

## Learning objectives

- Understand why failure must be assumed and designed for, not hoped away.
- Apply **timeouts** to prevent slow callers from holding resources forever.
- Use **retries** with exponential backoff and jitter to handle transient failures safely.
- Implement the full **circuit breaker** state machine and explain each state transition.
- Use **bulkheads** to isolate failure domains and **fallbacks** to give users something useful.

## Failure is normal

In a single-process application, a function call either succeeds or throws — and it does so in microseconds. Over a network, the same call might:

- Succeed in 5 ms (normal)
- Succeed in 8 000 ms (slow, holding your thread/connection)
- Return a 503 (transient — retry might work)
- Return a 400 (permanent — retrying makes it worse)
- Never return at all (the other end crashed mid-reply)

Without explicit handling for each of these, your service inherits the failure modes of everything it calls. A slow downstream makes you slow. A crashed downstream makes you hang. If you have ten services in a call chain and each is 99.9 % available, your end-to-end availability is 0.999^10 = 99.0 %. Add a 5-second timeout failure to the mix and users notice.

> [!PRINCIPAL] Design for the failure case first
> When you write a service call, the happy path is trivial. Spend your design time on: what is the worst acceptable latency (set as a timeout), what errors are worth retrying (transient vs. permanent), and what can you do when the downstream is simply unavailable (fallback). Document these decisions — they are as important as the API contract itself.

## Timeouts

A **timeout** is a hard deadline: if you have not heard back in X milliseconds, give up and return an error. Without timeouts, a slow downstream ties up your connection pool, your thread pool, and ultimately your own response time.

```js
// Node.js fetch with a timeout (AbortController — works in Node 18+)
async function fetchWithTimeout(url, ms = 2000) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timerId);
  }
}
```

> [!OUTPUT]
> // If the server takes longer than 2 s:
> AbortError: The operation was aborted

Set timeouts at every layer: database queries, external HTTP calls, internal gRPC calls, queue message processing. A good rule of thumb: the timeout for a downstream call should be shorter than your own SLA, leaving headroom for your own processing.

> [!WARNING] Choose timeout values based on measurements
> Don't guess — look at your p99 latency in production. Set the timeout at roughly 2–3× p99 so you cut off the true tail without prematurely aborting healthy-but-slow calls. Then instrument how often the timeout fires and adjust.

## Retries, backoff, and jitter

Some failures are transient — a brief network glitch, a momentary rate limit, a restarting pod. **Retrying** these makes sense. Retrying permanent errors (a 404, a validation error) just wastes resources and delays user feedback.

**Exponential backoff** grows the wait time between retries so you don't hammer a struggling downstream:

```
attempt 1: wait 100 ms
attempt 2: wait 200 ms
attempt 3: wait 400 ms
attempt 4: wait 800 ms
...cap at 30 000 ms
```

**Jitter** randomises the wait within a range. Without jitter, every client that got a 503 together will retry together, creating a thundering herd that hits the recovering downstream in a tight spike — often knocking it back over. With jitter, retries spread out.

```js
// Full-jitter backoff: random between 0 and the capped exponential value
function backoffMs(attempt, base = 100, cap = 30_000) {
  const exp = Math.min(base * Math.pow(2, attempt), cap);
  return Math.random() * exp; // full-jitter
}

async function retryable(fn, { maxAttempts = 3, retryOn } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const shouldRetry = retryOn ? retryOn(err) : true;
      if (!shouldRetry || attempt === maxAttempts - 1) throw err;
      const wait = backoffMs(attempt);
      // In Node: await new Promise(r => setTimeout(r, wait));
      console.log(`attempt ${attempt + 1} failed, retrying in ${wait.toFixed(0)} ms`);
    }
  }
  throw lastErr;
}
```

> [!PITFALL] Retrying non-idempotent operations
> Never blindly retry a POST that creates a resource. If the server processed the request but the reply got lost, a retry creates a duplicate. Either make the operation idempotent (use a client-generated idempotency key) or only retry safe operations (GET, idempotent PUT). The `retryOn` predicate above lets you encode this distinction.

## The circuit breaker pattern

Retries help with transient blips, but what if a downstream is down for minutes? Retrying for minutes means:
- Your callers wait (or get queued up)
- You generate load on an already-struggling system
- Your thread/connection pool drains

A **circuit breaker** solves this by tracking failure rates and "opening" when a threshold is exceeded — at which point calls fail immediately without touching the downstream.

### The three states

```
  ┌─────────────────────────────────────────────┐
  │                                             │
  │  CLOSED ──(failures ≥ threshold)──► OPEN   │
  │    ▲                                  │    │
  │    │                             (timeout) │
  │    │                                  ▼    │
  │    └────(probe succeeds)────── HALF-OPEN   │
  │                                             │
  └─────────────────────────────────────────────┘
```

- **CLOSED** — calls go through normally. Failures are counted. When the failure rate exceeds a threshold (e.g., 5 failures in 10 seconds), the circuit opens.
- **OPEN** — calls fail immediately with a "circuit open" error. No downstream traffic. After a reset timeout (e.g., 30 seconds), the circuit moves to half-open.
- **HALF-OPEN** — a single probe call is allowed through. If it succeeds, the circuit closes. If it fails, it opens again and the reset timer restarts.

```js
// Conceptual Node.js circuit breaker (not runnable — uses timers)
class CircuitBreaker {
  constructor(fn, { threshold = 5, resetMs = 30_000 } = {}) {
    this.fn = fn;
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.state = "CLOSED";      // CLOSED | OPEN | HALF_OPEN
    this.failures = 0;
    this.nextAttempt = 0;       // timestamp when HALF_OPEN probe is allowed
  }

  async call(...args) {
    if (this.state === "OPEN") {
      if (Date.now() < this.nextAttempt) {
        throw new Error("Circuit OPEN — fast fail");
      }
      this.state = "HALF_OPEN";
    }

    try {
      const result = await this.fn(...args);
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this.failures = 0;
    this.state = "CLOSED";
  }

  _onFailure() {
    this.failures++;
    if (this.state === "HALF_OPEN" || this.failures >= this.threshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.resetMs;
      console.log(`[CB] opened — next probe at ${new Date(this.nextAttempt).toISOString()}`);
    }
  }
}
```

> [!NOTE] Combine circuit breaker with retries thoughtfully
> Retries should sit *inside* the circuit breaker (so the breaker sees each retry attempt as a failure candidate) OR retries should wrap the circuit breaker call only for `CLOSED` state errors. The most common bug is stacking unlimited retries on top of a circuit breaker, defeating the fast-fail purpose.

## Bulkheads

A **bulkhead** isolates different classes of traffic so one saturated resource pool cannot take down unrelated functionality. Named after watertight compartments in a ship — a breach floods one compartment, not the whole vessel.

In practice: instead of one shared HTTP connection pool or worker pool serving all downstream calls, give each downstream its own pool with a hard cap. If the payments service becomes slow and drains 100 connections, the orders service pool is unaffected.

```js
// Conceptual: per-downstream concurrency limits
const pools = {
  payments: createPool({ max: 10 }),
  inventory: createPool({ max: 20 }),
  email:     createPool({ max: 5 })
};
```

## Fallbacks

When a downstream is unavailable, returning an error is sometimes unavoidable — but often you can do better. A **fallback** is a degraded-but-acceptable response:

- Return a cached version of the data (possibly stale)
- Return a default/empty result (empty recommendations vs. a 500)
- Route to a secondary data source
- Queue the request and notify the user asynchronously

Fallbacks convert hard failures into soft degradation, keeping the core user journey intact.

## Try it yourself

A full circuit breaker state machine with simulated failures. Watch it open after repeated failures, then probe and recover.

```js run
// Full circuit breaker state machine — pure JS, no timers (uses a monotonic counter
// as simulated "time" so it runs synchronously in this sandbox)

function createCircuitBreaker({ threshold = 3, resetTicks = 5 } = {}) {
  let state = "CLOSED";
  let failures = 0;
  let tick = 0;
  let openedAtTick = 0;

  function advanceTick() { tick++; }

  function call(fn) {
    advanceTick();

    if (state === "OPEN") {
      if (tick - openedAtTick < resetTicks) {
        return { ok: false, error: "Circuit OPEN — fast fail", state };
      }
      state = "HALF_OPEN";
      console.log(`[tick ${tick}] Circuit -> HALF_OPEN (probe allowed)`);
    }

    try {
      const result = fn();
      // success
      if (state === "HALF_OPEN") {
        console.log(`[tick ${tick}] Probe succeeded -> CLOSED`);
      }
      failures = 0;
      state = "CLOSED";
      return { ok: true, result, state };
    } catch (err) {
      failures++;
      if (state === "HALF_OPEN" || failures >= threshold) {
        state = "OPEN";
        openedAtTick = tick;
        console.log(`[tick ${tick}] Circuit -> OPEN (failures=${failures})`);
      }
      return { ok: false, error: err.message, state };
    }
  }

  function status() { return { state, failures, tick }; }

  return { call, status };
}

// --- Simulation ---
const cb = createCircuitBreaker({ threshold: 3, resetTicks: 4 });

function failingService() { throw new Error("downstream timeout"); }
function healthyService() { return "OK"; }

// Calls 1-3: service is failing -> breaker opens
console.log("=== Phase 1: Failures accumulating ===");
for (let i = 0; i < 3; i++) {
  const r = cb.call(failingService);
  console.log(`  call ${i + 1}: ${r.ok ? "ok" : r.error} [${r.state}]`);
}

// Calls 4-6: circuit is OPEN -> fast fail (no downstream call)
console.log("\n=== Phase 2: Circuit OPEN — fast fails ===");
for (let i = 0; i < 3; i++) {
  const r = cb.call(failingService); // fn never executes in OPEN state
  console.log(`  call ${i + 4}: ${r.error} [${r.state}]`);
}

// Advance ticks past resetTicks to trigger HALF_OPEN probe
// (simulated by making extra no-op calls that just increment tick)
console.log("\n=== Phase 3: Reset timeout elapsed -> HALF_OPEN probe ===");
// 4 more ticks needed
for (let i = 0; i < 4; i++) cb.call(() => { throw new Error("still broken"); });

// Probe with a healthy call
const probe = cb.call(healthyService);
console.log(`  probe result: ${probe.ok ? probe.result : probe.error} [${probe.state}]`);

// Now fully closed — healthy traffic flows
console.log("\n=== Phase 4: Circuit CLOSED — healthy calls ===");
for (let i = 0; i < 3; i++) {
  const r = cb.call(healthyService);
  console.log(`  call: ${r.result} [${r.state}]`);
}
```

## Exercise

**Challenge:** Wrap the circuit breaker with a retry helper so transient failures trigger retries, but only when the circuit is CLOSED. If the circuit is OPEN, fail immediately without retrying.

<details>
<summary>Show solution</summary>

```js run
function createCB({ threshold = 2, resetTicks = 3 } = {}) {
  let state = "CLOSED", failures = 0, tick = 0, openedAt = 0;
  return {
    call(fn) {
      tick++;
      if (state === "OPEN") {
        if (tick - openedAt < resetTicks) return { ok: false, open: true, error: "OPEN" };
        state = "HALF_OPEN";
      }
      try {
        const result = fn();
        failures = 0; state = "CLOSED";
        return { ok: true, result };
      } catch (err) {
        failures++;
        if (state === "HALF_OPEN" || failures >= threshold) {
          state = "OPEN"; openedAt = tick;
        }
        return { ok: false, open: false, error: err.message };
      }
    },
    get state() { return state; }
  };
}

function withRetry(cb, fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = cb.call(fn);
    if (r.ok) return r;
    if (r.open) {
      console.log(`  [retry] circuit OPEN — giving up immediately`);
      return r;
    }
    console.log(`  [retry] attempt ${attempt} failed: ${r.error}`);
  }
  return { ok: false, error: "max attempts exhausted" };
}

const cb = createCB({ threshold: 3, resetTicks: 4 });
let callCount = 0;

// Service fails for first 2 calls, then succeeds
function service() {
  callCount++;
  if (callCount <= 2) throw new Error("transient");
  return "success";
}

console.log("--- With retries, transient failure eventually succeeds ---");
const result = withRetry(cb, service);
console.log("final:", result.ok ? result.result : result.error);
console.log("circuit state:", cb.state);
```

</details>

## Common pitfalls

> [!PITFALL] Sharing one circuit breaker across different error types
> If you put a circuit breaker in front of a service that returns both 503 (transient) and 400 (permanent), the circuit will open on 400s too — causing healthy calls to fast-fail. Separate your failure counters: only open the circuit on infrastructure failures (timeouts, 5xx, connection refused), not on business-logic errors (4xx). Also never count client-side cancellations as failures.

> [!PITFALL] Not testing the open state
> Circuit breakers are usually written once, forgotten, and never verified. Add an integration test that deliberately makes your downstream fail past the threshold, confirms the circuit opens, waits for the reset period, confirms the half-open probe fires, and then confirms the circuit closes on success. Without this, you discover the breaker is misconfigured at 2 a.m.

## What you learned

- Every network call needs a **timeout**; set it based on p99 measurements and your own SLA.
- **Retries with exponential backoff and full jitter** handle transient failures without creating thundering herds.
- The **circuit breaker** state machine (closed → open → half-open → closed) prevents load accumulation against failing downstreams.
- **Bulkheads** isolate resource pools per downstream so one slow dependency cannot exhaust shared capacity.
- **Fallbacks** (cached data, defaults, secondary sources) convert hard failures into soft degradation.

## Next steps

Even with circuit breakers and retries, some operations span multiple services and *all* must succeed or *all* must be undone. That coordination problem — distributed transactions without 2PC — is what the **saga pattern** solves, which we tackle next.
*/});
