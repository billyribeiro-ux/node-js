registerLessonSrc("38-load-testing", function () {/*
---
id: 38-load-testing
title: "Load Testing & Capacity Planning"
minutes: 28
level: principal
objectives:
  - Design and run load tests with k6 and autocannon, interpreting percentiles correctly
  - Apply Little's Law to relate concurrency, throughput, and latency
  - Build a capacity plan from test results and identify the system's breaking point
---

# Load Testing & Capacity Planning

## Why this matters

You cannot optimise a system you have never measured under load, and you cannot plan
infrastructure costs without knowing your system's limits. Averages hide the tail latency
that ruins user experience; knowing the p99 is the difference between a service that
"feels fast" and one that causes 1 in 100 users to stare at a spinner. Load testing and
capacity planning are the activities that turn "we think we can handle it" into "we have
data that says so."

## Learning objectives

- Use **k6** and **autocannon** to generate controlled HTTP load.
- Understand open vs closed load models and when each applies.
- Read percentiles (p50, p95, p99) correctly and explain why averages mislead.
- Identify the knee of the throughput-latency curve — the system's breaking point.
- Apply **Little's Law** to reason about concurrency, throughput, and latency.
- Build a capacity plan: headroom, scaling triggers, and a runbook.

## Tools: k6 and autocannon

### k6

**k6** is a developer-centric load testing tool. Tests are JavaScript files that describe
virtual users (VUs) performing scenarios. It emits rich metrics (RPS, latency percentiles,
error rates) and integrates with Grafana for dashboards.

```bash
# Install
brew install k6   # macOS
# or: snap install k6 / docker run grafana/k6

# Run a basic test
k6 run script.js
```

```js
// script.js — k6 load test
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 50 },   // ramp up to 50 VUs
    { duration: "1m",  target: 50 },   // hold at 50 VUs
    { duration: "30s", target: 0  },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<200"],  // fail if p95 > 200 ms
    http_req_failed:   ["rate<0.01"],  // fail if error rate > 1%
  },
};

export default function () {
  const res = http.get("http://localhost:3000/api/orders");
  check(res, {
    "status is 200": r => r.status === 200,
    "duration < 500ms": r => r.timings.duration < 500,
  });
  sleep(1);
}
```

> [!OUTPUT]
> scenarios: (100.00%) 1 scenario, 50 max VUs, 2m30s max duration
>
> http_req_duration............: avg=48ms  min=12ms  med=42ms  max=310ms  p(90)=88ms  p(95)=112ms
> http_req_failed..............: 0.00%   0 out of 6240
> http_reqs....................: 6240    41.6/s
>
> ✓ http_req_duration p(95)<200

### autocannon

**autocannon** is a Node.js tool for quick HTTP benchmarks — simpler than k6 but excellent
for fast feedback loops during development.

```bash
npm install -g autocannon

# 10 connections, 30 seconds, with latency percentiles
autocannon -c 10 -d 30 -l http://localhost:3000/api/ping
```

> [!OUTPUT]
> Running 30s test @ http://localhost:3000/api/ping
> 10 connections
>
> Stat    2.5%   50%   97.5%  99%   Avg     Stdev   Max
> Lat (ms)   1     2     8      14    2.43    2.1     48
> Req/Sec  3420  3810  4020   4100  3788.4  147.5   4200
>
> 113,652 requests in 30.0s — 21.5 MB read

## Open vs closed load models

This is a frequently misunderstood distinction that causes load tests to produce
unrealistically optimistic results.

| Model | How arrivals work | Matches reality? |
|---|---|---|
| **Closed** | N virtual users loop: request → wait → request | Internal batch jobs, SDKs with connection pools |
| **Open** | Arrivals happen at a fixed rate regardless of response time | Public HTTP APIs, web traffic |

k6's default (virtual users sleeping between requests) is a **closed model**. Real web
traffic is an **open model**: users arrive at a rate determined by the outside world, not
by your server's response time.

> [!PRINCIPAL] Why the model matters
> In a closed model, if your server slows down, VUs queue up behind their pending request —
> arrival rate drops automatically. Your server appears to cope fine while latency climbs.
> In an open model (the real world), arrivals keep coming at the same rate; the queue grows
> unboundedly until requests time out or the server crashes. To simulate real web traffic,
> use k6's `arrival-rate` executor or autocannon's constant RPS mode (`-r` flag). Closed
> models are fine for benchmarking throughput ceilings; open models reveal how your system
> behaves when overloaded.

## Percentiles, not averages

Imagine 99 requests take 10 ms and 1 request takes 5,000 ms. The average is ~60 ms.
Nobody was served in 60 ms. The p99 is 5,000 ms — that is the number to fix.

| Percentile | Meaning |
|---|---|
| p50 (median) | Half of users are faster than this |
| p95 | 95% of users finish within this time — a common SLA threshold |
| p99 | 99% finish within this — the "long tail" |
| p99.9 | 1 in 1000 users — relevant at millions of req/s |

> [!NOTE] Never report average latency in an SLA or postmortem
> Averages can be mathematically manipulated to hide tail latency. Percentiles cannot. When
> your monitoring dashboard shows only "average response time", you are flying blind.

## Finding the knee

Every system has a **knee** — the point on the throughput-latency curve where latency starts
rising faster than throughput rises. Beyond the knee, adding more load makes things worse
non-linearly: queues build, connections time out, error rates climb.

```
Latency
  ^
  |                      .*
  |                   .*
  |             .*.*
  |   .*.*.*.*              ← knee is here
  | .*
  +──────────────────────────→ Throughput (RPS)
```

To find the knee:
1. Run a series of tests at increasing RPS (e.g. 100, 200, 500, 1000, 2000 …).
2. Record p95 at each level.
3. Plot the curve. The knee is where p95 begins its steep upward climb.
4. Your safe operating capacity is roughly 70–80 % of the knee — the headroom absorbs
   burst traffic without tipping over.

## Little's Law

**Little's Law** is a fundamental result in queueing theory:

```
L = λ × W
```

- **L** — average number of requests in the system (concurrency in flight)
- **λ** (lambda) — average arrival rate (requests per second)
- **W** — average time each request spends in the system (latency in seconds)

This lets you answer practical planning questions:

- "Our SLA is 200 ms (W = 0.2 s) and we expect λ = 500 RPS. How many concurrent requests
  must the system handle?" → L = 500 × 0.2 = **100 concurrent requests**.

- "We see L = 200 concurrent requests and W = 400 ms. What is our effective throughput?" →
  λ = 200 / 0.4 = **500 RPS**.

- "We doubled throughput (λ) and see doubled concurrency (L). Does latency stay the same?" →
  Yes, if W is unchanged — but if W is also growing, the system is saturating.

## Try it yourself

The runnable block below implements a latency-percentile calculator and applies Little's Law
to a simulated load-test result set.

```js run
// Compute latency percentiles from a sample array and apply Little's Law.

function percentile(sorted, p) {
  // sorted must already be sorted ascending
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function analyzeLatencies(samples, rps) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;

  console.log(`Samples: ${samples.length}  |  RPS: ${rps}`);
  console.log(`  avg : ${avg.toFixed(1)} ms  (misleading!)`);
  console.log(`  p50 : ${p50} ms`);
  console.log(`  p95 : ${p95} ms`);
  console.log(`  p99 : ${p99} ms`);

  // Little's Law: L = lambda * W
  // W = p99 in seconds (use p99 as conservative estimate)
  const W = p99 / 1000;
  const L = rps * W;
  console.log(`\nLittle's Law (using p99 as W):`);
  console.log(`  λ = ${rps} req/s, W = ${W.toFixed(3)} s → L = ${L.toFixed(1)} concurrent requests`);
  return { p50, p95, p99, avg };
}

// Simulate a bimodal latency distribution:
// most requests are fast, but a tail hits a slow path (e.g. a cache miss)
function generateSamples(count) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const isSlow = Math.random() < 0.05; // 5% cache misses
    const base = isSlow ? 400 + Math.random() * 600 : 20 + Math.random() * 60;
    samples.push(Math.round(base));
  }
  return samples;
}

console.log("=== Scenario: 200 RPS, mixed latency ===");
analyzeLatencies(generateSamples(1000), 200);

console.log("\n=== Scenario: 800 RPS, system approaching saturation ===");
// Near the knee: p99 balloons but avg looks acceptable
const highLoad = generateSamples(1000).map(v => v * 3 + Math.round(Math.random() * 200));
analyzeLatencies(highLoad, 800);
```

## Exercise: find the knee from step data

You ran autocannon at six RPS levels and captured p95 latency. Write a function that finds
the knee — defined as the first point where p95 grows by more than 50 % compared to the
previous step.

```js run
const steps = [
  { rps: 100,  p95: 18 },
  { rps: 200,  p95: 22 },
  { rps: 400,  p95: 28 },
  { rps: 700,  p95: 52 },   // knee candidate
  { rps: 1000, p95: 180 },
  { rps: 1500, p95: 890 },
];

function findKnee(steps, threshold = 0.5) {
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].p95;
    const curr = steps[i].p95;
    const growth = (curr - prev) / prev;
    if (growth > threshold) {
      return { kneeAt: steps[i].rps, p95: curr, growth: (growth * 100).toFixed(0) + "%" };
    }
  }
  return null;
}

const knee = findKnee(steps);
console.log("Knee detected:", knee);
console.log(`Safe operating capacity (75%): ${Math.round(knee.kneeAt * 0.75)} RPS`);
```

<details>
<summary>Show solution + explanation</summary>

The knee is at 700 RPS — that is where p95 jumps from 28 ms to 52 ms, an 86 % increase
in a single step. Beyond 700 RPS, latency grows non-linearly.

Safe capacity = 700 × 0.75 = **525 RPS**. You would provision enough instances to handle
525 RPS at normal load and set autoscaling to trigger before 700 RPS is reached.

```js run
// Extended: also compute Little's Law at the safe operating point
const safeRps = 525;
const safeP95ms = 52; // interpolated from knee step
const W = safeP95ms / 1000;
const L = safeRps * W;
console.log(`At safe capacity (${safeRps} RPS):`);
console.log(`  W (p95) = ${W} s`);
console.log(`  L = ${safeRps} * ${W} = ${L.toFixed(1)} concurrent requests in flight`);
console.log(`  Size your connection pools and worker counts to at least ${Math.ceil(L)} concurrent slots`);
```

</details>

## Project — Load-test the system, find the breaking point, and write a runbook

**Goal:** Load-test a Node.js HTTP service with k6 or autocannon, identify its breaking
point, apply at least two hardening techniques, and produce a concise runbook that
documents what was found and how to respond when thresholds are breached in production.

**Acceptance criteria:**

1. Run at least five RPS levels with k6 or autocannon and record p50/p95/p99 at each level.
   Present the data as a table and identify the knee.
2. Apply Little's Law at the knee to derive the required concurrency (L) and confirm your
   connection-pool / cluster-worker count is set to at least that value.
3. Apply at least two hardening techniques (e.g. cluster module, connection pooling,
   response caching, rate limiting, payload compression) and show a before/after p95
   comparison at the knee RPS.
4. Write a runbook section that defines three alert thresholds (green / yellow / red),
   specifies the on-call action for each, and includes the exact autocannon command to
   reproduce the baseline test.
5. Include at least one k6 threshold (using `thresholds:` in `options`) that would gate
   a CI deploy — and demonstrate that the hardened service passes it.
6. Document one database or downstream bottleneck discovered during testing and explain
   how you addressed it (or would address it with more time).

**Starter code** — the percentile calculator from "Try it yourself", ready to accept your
measured data:

```js run
// Paste your autocannon or k6 raw latency samples here and compute percentiles.
// In real usage you would pipe autocannon --json output and parse latencies[].

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function buildCapacityReport(label, samples, rps) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  // Little's Law
  const L = rps * (p99 / 1000);
  console.log(`--- ${label} ---`);
  console.log(`RPS: ${rps}  |  p50: ${p50}ms  p95: ${p95}ms  p99: ${p99}ms`);
  console.log(`Little's Law: need ${L.toFixed(1)} concurrent slots (pool/worker size)`);
  console.log(`Safe capacity (75% of knee): set autoscale trigger at ${Math.round(rps * 0.75)} RPS\n`);
}

// Replace these synthetic samples with your real measurements
const beforeHardening = Array.from({ length: 500 }, () =>
  Math.round(30 + Math.random() * 120 + (Math.random() < 0.08 ? 800 : 0))
);
const afterHardening = Array.from({ length: 500 }, () =>
  Math.round(20 + Math.random() * 40 + (Math.random() < 0.02 ? 200 : 0))
);

buildCapacityReport("Before hardening (knee RPS)", beforeHardening, 700);
buildCapacityReport("After hardening (knee RPS)", afterHardening, 700);
```

## Common pitfalls

> [!PITFALL] Warming up the JIT and caches before recording results
> The first few thousand requests to a fresh Node process are slower — V8 is still JIT
> compiling hot paths and caches are cold. Always run a 30-second warm-up phase before
> the measurement window starts. Both k6 (with an initial ramp stage) and autocannon
> (with `-w` warmup) support this. Results from a cold start are not representative.

> [!PITFALL] Testing against localhost and calling it "production-like"
> Loopback has essentially zero network latency and no TLS overhead. Always load-test
> against a staging environment that mirrors production: same machine type, same TLS
> termination, same network path, same database size. A 2 ms p99 on localhost can be a
> 80 ms p99 in prod.

## What you learned

- k6 and autocannon generate controlled HTTP load; k6 supports scripted scenarios and
  CI thresholds, autocannon is faster for ad-hoc benchmarking.
- Open load models (arrival-rate) reflect real web traffic better than closed models
  (virtual-user loops) — use them when you want to know how the system behaves when
  overloaded.
- Always report p50/p95/p99 — never averages alone. Averages hide the tail that ruins
  user experience.
- The knee of the throughput-latency curve is your system's breaking point; operate at
  70–80 % of it and set autoscaling triggers before it.
- Little's Law (L = λW) connects concurrency, throughput, and latency — use it to size
  connection pools, worker counts, and thread limits.

## Next steps

You can now scale out, deploy without downtime, and prove your system meets its
throughput targets under measurement. The final module ties everything together: designing
for the long term with Architecture Decision Records, runbooks, and the operational
disciplines that separate a production-grade system from a prototype.
*/});
