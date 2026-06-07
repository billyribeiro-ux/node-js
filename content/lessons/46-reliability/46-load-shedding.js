registerLessonSrc("46-load-shedding", function () {/*
---
id: 46-load-shedding
title: "Load Shedding, Backpressure & Graceful Degradation"
minutes: 30
level: advanced
objectives:
  - Design end-to-end backpressure so overload signals propagate upstream rather than silently queueing
  - Implement adaptive concurrency limits using a Little's Law-based AIMD controller
  - Apply graceful degradation patterns to keep a service partially available under extreme load
---

# Load Shedding, Backpressure & Graceful Degradation

## Why this matters

A service that tries to serve every request under overload is worse than one that refuses some.
When you accept more work than you can complete, latency climbs, queues fill, timeouts cascade,
and eventually the whole system falls over for everyone. Load shedding — deliberately dropping
low-priority work at the boundary — lets the system stay on the safe side of the utilization knee
you learned about in the queueing theory lesson. It is the operational complement to SLOs:
the SLO tells you when you are failing; load shedding is what you do to avoid failing.

## Learning objectives

- Design end-to-end backpressure so overload signals propagate upstream rather than silently queueing.
- Implement adaptive concurrency limits using a Little's Law-based AIMD controller (like Netflix's concurrency-limits library).
- Apply graceful degradation — brownouts, feature flags, stale data — to maintain partial service.

## End-to-End Backpressure

**Backpressure** is the mechanism by which a downstream bottleneck signals to upstream producers
to slow down. Without it, every layer buffers indefinitely and the system behaves as an M/M/1
queue driven to ρ→1: latency explodes, memory climbs, and timeouts cascade.

In Node.js, the Streams API has first-class backpressure: `Writable.write()` returns `false`
when the internal buffer is full, and the `drain` event signals when it is safe to resume.

```js
// Node streams backpressure (read-only reference)
import { createReadStream, createWriteStream } from "node:fs";

const src  = createReadStream("/data/big-file");
const dest = createWriteStream("/data/out");

src.on("data", (chunk) => {
  const ok = dest.write(chunk);
  if (!ok) {
    src.pause();           // stop reading until the writable drains
    dest.once("drain", () => src.resume());
  }
});
src.on("end", () => dest.end());
```

> [!OUTPUT]
> // No console output — backpressure is silent when working correctly.
> // Without pause/resume you see "MaxListenersExceededWarning" and OOM.

HTTP/2 and gRPC implement backpressure at the protocol level via **flow control**: the receiver
advertises a receive window, and the sender stops when it is exhausted. HTTP/1.1 has no such
mechanism — the only signal is TCP backpressure, which only kicks in when kernel socket buffers
are full. This is one reason HTTP/2 is easier to reason about under overload.

> [!PRINCIPAL] Backpressure must propagate all the way to the traffic source
> Buffering at an intermediate layer (say, an in-memory queue in your API gateway) is a way
> of hiding overload, not handling it. The latency your users experience includes queue wait
> time. The correct answer is to measure total residence time (W in Little's Law) at the
> outermost boundary, and to reject work there — before it consumes any resources — when W
> exceeds the SLO budget. Shedding work deep in the stack wastes CPU on work you will discard.

## Admission Control and Load Shedding

**Load shedding** is the deliberate rejection of requests at the service boundary when the
system is overloaded. Good load shedding is:

1. **Early** — reject before any significant work is done (after parsing headers, before DB calls).
2. **Priority-aware** — reject the cheapest-to-drop requests first (health checks, low-tier users,
   non-critical read paths) and protect critical writes.
3. **Transparent** — return HTTP 429 (Too Many Requests) or gRPC `RESOURCE_EXHAUSTED` with a
   `Retry-After` header so clients can back off.

### Static vs Adaptive Admission Control

**Static**: set a fixed concurrency limit or request-rate cap. Simple; does not adapt to changing
service times. If your DB slows down, the static limit is now too high; if it speeds up, you
leave capacity on the table.

**Adaptive**: measure latency (or another signal) and dynamically adjust the concurrency limit.
When latency rises above target → tighten the limit; when latency falls below target → relax it.
Netflix's **concurrency-limits** library (and its conceptual successor in various proxy implementations)
does exactly this, and the algorithm is essentially AIMD (Additive Increase, Multiplicative Decrease)
applied to concurrency slots rather than TCP window size.

### The AIMD Adaptive Limit Algorithm

The algorithm tracks:
- `limit` — current admitted concurrency (maximum in-flight requests)
- `inflight` — currently in-flight requests
- After each completed request, compare `rtt` (round-trip time) to `minRtt` (best observed RTT):
  - If `rtt < gradient_threshold × minRtt` → **increase** limit by `+additive_increase` (additive)
  - If `rtt >= gradient_threshold × minRtt` → **decrease** limit by `× backoff_factor` (multiplicative)
- Incoming requests are admitted if `inflight < limit`; otherwise they receive 429.

This is conceptually identical to TCP congestion control: probe up slowly, back off fast on
congestion signal. The "congestion signal" here is latency gradient rather than packet loss.

```js
// Adaptive concurrency limiter — read-only reference (Node.js middleware shape)
// Uses measured request latency vs minRtt to drive AIMD adjustment.

class AdaptiveLimiter {
  constructor({ initLimit = 20, minLimit = 5, maxLimit = 200,
                additive = 1, backoff = 0.9, gradient = 1.25 } = {}) {
    this.limit    = initLimit;
    this.minLimit = minLimit;
    this.maxLimit = maxLimit;
    this.inflight = 0;
    this.minRtt   = Infinity;
    this.additive = additive;
    this.backoff  = backoff;
    this.gradient = gradient;  // latency multiple that triggers backoff
  }

  acquire() {
    if (this.inflight >= this.limit) return false; // shed
    this.inflight++;
    return true;
  }

  release(rttMs) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (rttMs < this.minRtt) this.minRtt = rttMs;
    if (rttMs < this.gradient * this.minRtt) {
      this.limit = Math.min(this.maxLimit, this.limit + this.additive);
    } else {
      this.limit = Math.max(this.minLimit, Math.floor(this.limit * this.backoff));
    }
  }
}
```

> [!PRINCIPAL] Why latency-based limits beat CPU-based limits
> CPU utilization lags reality by seconds (kernel scheduling jitter, GC pauses). Measured RTT
> from your service's perspective reflects the *integrated* effect of all bottlenecks —
> slow downstream, GC stop-the-world, thread-pool saturation — and updates on every completed
> request. Little's Law guarantees that if RTT is rising, in-flight concurrency (L) is growing
> faster than throughput (λ). Tightening the limit directly controls L and therefore RTT.
> This is the insight behind Google's BBR congestion control and Netflix's concurrency-limits.

## Queue Bounds and Timeouts

Any internal queue (job queue, retry queue, DB connection pool queue) must have a bound.
An unbounded queue is a slow-leak memory bomb and hides overload behind ever-growing latency.

Rules of thumb:
- **Queue depth ≤ service-time × throughput × latency-budget / service-time** — or more practically,
  keep the queue depth small enough that a queued item will be processed within your SLO window.
  If SLO = 500 ms and service-time = 50 ms, maximum queue depth is ~10 items (10 × 50 ms = 500 ms).
- **Every queued item has a deadline**. If the deadline expires before service, drop and 429.
- **Timeouts must be shorter than client timeouts**. If your client times out at 10 s and your
  internal DB timeout is 30 s, you will hold a DB connection for 30 s serving work whose result
  will never reach the client. Set all internal timeouts to a fraction of the SLO.

```js
// Bounded queue with deadline enforcement (read-only reference)
class BoundedQueue {
  #queue = [];
  #maxDepth;
  #sloMs;

  constructor(maxDepth, sloMs) {
    this.#maxDepth = maxDepth;
    this.#sloMs    = sloMs;
  }

  enqueue(task) {
    if (this.#queue.length >= this.#maxDepth) return false; // shed immediately
    this.#queue.push({ task, deadline: Date.now() + this.#sloMs });
    return true;
  }

  dequeue() {
    while (this.#queue.length > 0) {
      const item = this.#queue.shift();
      if (Date.now() < item.deadline) return item.task;
      // expired — drop silently (already past SLO, serving it helps no one)
    }
    return null;
  }
}
```

## Graceful Degradation / Brownouts

When the error budget is being burned at high speed, full load shedding (global 503) is a last
resort. Before that, **graceful degradation** strategies let you keep the service partially useful:

| Strategy | Example |
|----------|---------|
| Serve stale cache | Return last-good response from cache; skip the slow origin call |
| Feature flags | Disable expensive UI features (recommendations, analytics) under load |
| Reduced fidelity | Return a truncated result set; skip enrichment from secondary services |
| Priority queues | Serve authenticated paying users; 429 anonymous/free-tier users |
| Canary shedding | Load-shed only on the new deployment; keep the old version serving |

> [!WARNING]
> Graceful degradation requires **explicit design**. If your service is a single synchronous
> call chain — request → auth → DB → enrichment → response — you have no natural shed points.
> Architect services as a set of composable, independently-skippable enrichments so you can
> return a degraded-but-valid response when any non-critical step is slow or failing.

## Try it yourself

Run the adaptive load-shedder simulation below. It simulates a stream of requests with
increasing load and a service that sometimes gets slow (simulating GC pauses or DB hiccups),
and shows the AIMD limit adapting in real time.

```js run
// AIMD Adaptive Load Shedder Simulation
// Pure browser JS — no Node APIs.

class AdaptiveLimiter {
  constructor({ initLimit = 10, minLimit = 3, maxLimit = 100,
                additive = 1, backoff = 0.85, gradient = 1.30 } = {}) {
    this.limit    = initLimit;
    this.minLimit = minLimit;
    this.maxLimit = maxLimit;
    this.inflight = 0;
    this.minRtt   = Infinity;
    this.additive = additive;
    this.backoff  = backoff;
    this.gradient = gradient;
    this.admitted = 0;
    this.shed     = 0;
  }

  tryAcquire() {
    if (this.inflight >= this.limit) { this.shed++; return false; }
    this.inflight++;
    this.admitted++;
    return true;
  }

  release(rttMs) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (rttMs < this.minRtt) this.minRtt = rttMs;
    const congested = rttMs >= this.gradient * this.minRtt;
    if (congested) {
      this.limit = Math.max(this.minLimit, Math.floor(this.limit * this.backoff));
    } else {
      this.limit = Math.min(this.maxLimit, this.limit + this.additive);
    }
  }
}

// Simulate service: normally 20ms; during overload phases, 120ms (like a GC or slow DB)
function simulateRtt(tick) {
  const overload = (tick >= 30 && tick < 50) || (tick >= 75 && tick < 85);
  const base     = overload ? 120 : 20;
  // add jitter ±20%
  return base * (0.8 + Math.random() * 0.4);
}

const limiter = new AdaptiveLimiter({ initLimit: 10 });

console.log("tick  concurr  limit   admitted  shed   rtt(ms)   minRtt(ms)");
console.log("----  -------  -----   --------  ----   -------   ----------");

let totalAdmitted = 0;
let totalShed     = 0;

for (let tick = 0; tick < 100; tick++) {
  // Simulate 8 concurrent arrivals per tick
  const arrivals = 8;
  let tickAdmitted = 0;
  let tickShed     = 0;
  const rtts = [];

  for (let i = 0; i < arrivals; i++) {
    if (limiter.tryAcquire()) {
      const rtt = simulateRtt(tick);
      rtts.push(rtt);
      limiter.release(rtt);
      tickAdmitted++;
    } else {
      tickShed++;
    }
  }

  totalAdmitted += tickAdmitted;
  totalShed     += tickShed;

  if (tick % 10 === 0 || (tick >= 28 && tick <= 52) || (tick >= 73 && tick <= 87)) {
    const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
    const phase  = (tick >= 30 && tick < 50) || (tick >= 75 && tick < 85) ? " [OVERLOAD]" : "";
    console.log(
      `${String(tick).padStart(4)}  ` +
      `${String(limiter.inflight).padStart(7)}  ` +
      `${String(limiter.limit).padStart(5)}   ` +
      `${String(tickAdmitted).padStart(8)}  ` +
      `${String(tickShed).padStart(4)}   ` +
      `${avgRtt.toFixed(0).padStart(7)}   ` +
      `${limiter.minRtt.toFixed(0).padStart(10)}${phase}`
    );
  }
}

console.log(`\nFinal: admitted=${totalAdmitted}, shed=${totalShed}`);
console.log(`Shed rate: ${(totalShed / (totalAdmitted + totalShed) * 100).toFixed(1)}%`);
console.log("Limit recovered after overload phases — AIMD adaptation working.");
```

## Project: Model → SLO → Adaptive Load Shedding → k6 Proof

Build a complete reliability stack for a simulated Node.js HTTP service:
model it with queueing theory, set SLOs and an error budget, then add adaptive load shedding
and prove the system protects its SLO under overload using a k6 load test.

**Acceptance criteria:**

1. **Queueing model**: using Little's Law and your measured baseline latency + throughput, calculate
   the safe concurrency limit and the theoretical latency at 70%, 80%, and 90% utilization.
   Document these as capacity-planning comments in your server code.

2. **SLO definition**: define at least two SLIs (e.g., availability ≥ 99.9% and latency p99 < 300 ms
   over a 24 h window). Derive the error budget in number of allowed bad requests per day.

3. **Adaptive concurrency limiter**: implement the AIMD `AdaptiveLimiter` class from this lesson
   as Express/Fastify middleware. Tune `gradient`, `backoff`, and initial `limit` so the service
   stays within the latency SLO during normal load and sheds load gracefully during spikes.

4. **Graceful degradation**: add at least one degraded response path (e.g., serve a cached
   response or a reduced-fidelity result) when the limiter is near its cap, so some admitted
   requests still succeed even during a brownout phase.

5. **k6 load test**: write a k6 script that ramps from 0 → 2× normal RPS over 2 minutes,
   holds at 2× for 1 minute, then ramps back down. Assert in the k6 thresholds that:
   `http_req_failed < 0.1%` (availability SLO) and `http_req_duration p(99) < 300` (latency SLO).
   The adaptive limiter should cause clean 429s that k6 does not count as failures (treat 429
   as expected shed, not error), while 5xx count against the SLO.

6. **Error budget report**: after the k6 run, a small Node script reads the k6 output JSON
   and prints an error budget report: total requests, bad events (5xx), budget fraction consumed,
   burn rate, and whether any multi-window alert would have fired.

```js run
// Starter: core AIMD adaptive limiter + error-budget report calculator
// Implements criteria 3 and 6 in pure browser JS.

// ============================================================
// 1.  AdaptiveLimiter (AIMD-based, Little's Law informed)
// ============================================================
class AdaptiveLimiter {
  constructor({
    initLimit = 20,
    minLimit  = 5,
    maxLimit  = 500,
    additive  = 2,
    backoff   = 0.90,
    gradient  = 1.25,   // RTT multiple above minRtt that signals congestion
  } = {}) {
    this.limit    = initLimit;
    this.minLimit = minLimit;
    this.maxLimit = maxLimit;
    this.inflight = 0;
    this.minRtt   = Infinity;
    this.additive = additive;
    this.backoff  = backoff;
    this.gradient = gradient;
    // telemetry
    this.totalAdmitted = 0;
    this.totalShed     = 0;
    this.limitHistory  = [];
  }

  // Returns true if admitted, false if shed (caller should return 429)
  tryAcquire() {
    if (this.inflight >= this.limit) {
      this.totalShed++;
      return false;
    }
    this.inflight++;
    this.totalAdmitted++;
    return true;
  }

  // Call when the request completes (or times out); rttMs is end-to-end latency
  release(rttMs) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (rttMs < this.minRtt) this.minRtt = rttMs;

    const congested = this.minRtt < Infinity && rttMs >= this.gradient * this.minRtt;
    if (congested) {
      this.limit = Math.max(this.minLimit, Math.floor(this.limit * this.backoff));
    } else {
      this.limit = Math.min(this.maxLimit, this.limit + this.additive);
    }
    this.limitHistory.push(this.limit);
  }

  stats() {
    const total = this.totalAdmitted + this.totalShed;
    return {
      admitted: this.totalAdmitted,
      shed:     this.totalShed,
      shedRate: total ? ((this.totalShed / total) * 100).toFixed(2) + "%" : "0%",
      limit:    this.limit,
      inflight: this.inflight,
      minRtt:   this.minRtt === Infinity ? "n/a" : this.minRtt.toFixed(1) + "ms",
    };
  }
}

// ============================================================
// 2.  Error-budget report (criterion 6)
// ============================================================
function errorBudgetReport({ sloTarget, windowRequests, badEvents }) {
  const budgetFraction = 1 - sloTarget;
  const budgetRequests = windowRequests * budgetFraction;
  const remaining      = budgetRequests - badEvents;
  const pctConsumed    = (badEvents / budgetRequests) * 100;
  const burnRate       = (badEvents / windowRequests) / budgetFraction;

  const alerts = [
    { label: "P0 page  (14.4×)", threshold: 14.4 },
    { label: "P1 page  ( 6.0×)", threshold: 6    },
    { label: "Ticket   ( 3.0×)", threshold: 3    },
    { label: "Warning  ( 1.0×)", threshold: 1    },
  ];

  console.log("=== Error Budget Report ===");
  console.log(`SLO:              ${(sloTarget * 100).toFixed(3)}%`);
  console.log(`Window requests:  ${windowRequests.toLocaleString()}`);
  console.log(`Allowed bad:      ${budgetRequests.toLocaleString()}`);
  console.log(`Actual bad (5xx): ${badEvents.toLocaleString()}`);
  console.log(`Budget consumed:  ${pctConsumed.toFixed(2)}%`);
  console.log(`Budget remaining: ${remaining.toLocaleString()} requests`);
  console.log(`Burn rate:        ${burnRate.toFixed(2)}×`);
  console.log("");
  console.log("Multi-window alert status:");
  for (const a of alerts) {
    console.log(`  ${burnRate >= a.threshold ? "FIRING" : "  ok  "} — ${a.label}`);
  }
  return { budgetFraction, burnRate, pctConsumed, remaining };
}

// ============================================================
// 3.  Demonstration run
// ============================================================
console.log("=== AdaptiveLimiter Demo ===");
const limiter = new AdaptiveLimiter({ initLimit: 10, minLimit: 3, maxLimit: 50 });

// Simulate 200 requests: first 100 normal (25ms RTT), next 100 overloaded (200ms RTT)
let bad5xx = 0;
for (let i = 0; i < 200; i++) {
  const overload = i >= 100;
  const admitted = limiter.tryAcquire();
  if (admitted) {
    const rtt = overload ? 200 + Math.random() * 50 : 25 + Math.random() * 10;
    limiter.release(rtt);
    // Simulate: during overload, 5% of admitted requests fail (downstream error)
    if (overload && Math.random() < 0.05) bad5xx++;
  }
}

const s = limiter.stats();
console.log(`Admitted: ${s.admitted} | Shed (429): ${s.shed} | Shed rate: ${s.shedRate}`);
console.log(`Final limit: ${s.limit} | minRtt: ${s.minRtt}`);

console.log("\n--- Error Budget (simulated 24h window) ---");
// Scale up: simulate 1M requests per day, same shed/error proportions
const scale = 1_000_000 / (s.admitted + s.shed);
errorBudgetReport({
  sloTarget:       0.999,
  windowRequests:  1_000_000,
  badEvents:       Math.round(bad5xx * scale),
});
```

Extend the starter by wiring `AdaptiveLimiter` into a real Fastify server, adding a
`/health` endpoint that reports `stats()`, and running the k6 script against it.

## Common pitfalls

> [!PITFALL] Shedding work AFTER doing the expensive part
> A common mistake is placing the load-shedder after authentication, JSON parsing, and DB
> lookup — the expensive parts — and shedding only at the final response-building step.
> This wastes CPU on work you discard and gives you no protection. The limiter's `tryAcquire()`
> call must be the *first* thing in the request handler, before any I/O. The only work allowed
> before it is reading the `Content-Length` header to avoid a slow-loris attack on the read itself.

A second trap: not distinguishing 429s from 5xxs in your error-budget accounting. A 429 is
correct load-shedding behavior — the service is working as designed. If k6 or your SLO
monitoring counts 429s as errors, you will see burn rate spike during load shedding and
freeze your release pipeline for the wrong reason. Define your availability SLI as
`non-5xx / total`, not `non-4xx / total`.

## What you learned

- **Backpressure** must propagate to the traffic source; buffering in the middle hides overload
  and inflates latency without protecting throughput.
- **Adaptive concurrency limits** (AIMD on latency gradient) outperform static caps because
  they track changing service times and self-tune to the current bottleneck.
- **Queue bounds and deadlines** prevent queues from becoming unbounded memory sinks; a queued
  item that expires before service should be dropped, not processed.
- **Graceful degradation** — stale cache, reduced fidelity, priority tiers — keeps the service
  partially useful when full capacity is unavailable.
- **Shed early, shed cheaply**: the load-shedder must be the first middleware, before any I/O.
- Distinguish 429 (correct shedding) from 5xx (actual error) in your SLI to avoid false budget burns.

## Next steps

You now have the full reliability toolkit: SLOs and error budgets to set the target, queueing
theory to understand the physics, and adaptive load shedding to stay safe under overload.
The next module explores embedding Node.js in larger systems and extending the runtime itself.
*/});
