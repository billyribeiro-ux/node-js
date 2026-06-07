registerLessonSrc("46-queueing-theory", function () {/*
---
id: 46-queueing-theory
title: "Queueing Theory: Little's Law, M/M/c & the USL"
minutes: 28
level: advanced
objectives:
  - Apply Little's Law to relate throughput, latency, and concurrency in any queuing system
  - Model the latency knee using M/M/1 and M/M/c response-time curves
  - Use the Universal Scalability Law to predict throughput degradation from contention and coherency costs
---

# Queueing Theory: Little's Law, M/M/c & the USL

## Why this matters

Your service starts returning 500 ms latency at 60% CPU and 5 s latency at 80% CPU — and you
have no idea why. Queueing theory gives you the physics. These laws are universal: they apply
to a database connection pool, an event-loop tick queue, a Kubernetes node's CPU scheduler,
and a toll booth. Learn them once and you will predict latency explosions before they happen
in production rather than debugging them at 2 am.

## Learning objectives

- Apply Little's Law to relate throughput, latency, and concurrency at steady state.
- Read and reason about the M/M/1 and M/M/c response-time curves and the utilization knee.
- Use the Universal Scalability Law (USL) to predict how throughput degrades as you add servers.

## Little's Law: L = λW

**Little's Law** (John D.C. Little, 1961) states that for any stable system in steady state:

```
L = λ × W
```

- **L** — average number of items *in the system* (in service + waiting in queue)
- **λ** (lambda) — average arrival rate (requests per second, tasks per minute, …)
- **W** — average time an item spends in the system (service time + queue wait)

The law holds for *any* stable queuing system with no assumptions about distribution.
That universality is the reason every performance engineer has it memorized.

### Practical applications

**Find concurrency from latency and throughput:**

If your service handles λ = 1,000 RPS and the average request spends W = 80 ms end-to-end,
then at any instant there are L = 1,000 × 0.080 = **80 concurrent requests** in flight.
That tells you exactly how large your connection pool, semaphore, or thread pool must be.

**Find throughput from concurrency and latency:**

If your Node process can hold L = 100 concurrent async operations and each takes W = 50 ms,
the maximum steady-state throughput is λ = L / W = 100 / 0.050 = **2,000 RPS**.
Add more concurrency (async worker slots, `Promise.all` width) or reduce latency to scale.

**Find latency from throughput and concurrency:**

If you measure λ = 500 RPS and instrument L = 40 in-flight requests,
then W = L / λ = 40 / 500 = **80 ms** average residence time.

> [!PRINCIPAL] Little's Law as a production diagnostic
> When your p50 latency suddenly doubles, Little's Law tells you *something* increased L or
> decreased λ — a downstream slowdown, a new serialization point, or a suddenly larger
> working set. Instrument both concurrency (L) and throughput (λ) in your metrics; you get
> W for free. Most teams only instrument latency histograms and miss the concurrency signal
> that explains *why* the histogram shifted.

## Utilization and the Latency Knee

**Utilization** (ρ, rho) is the fraction of time a server is busy:

```
ρ = λ / μ         (for a single server)
ρ = λ / (c × μ)   (for c parallel servers)
```

where **μ** (mu) is the server's service rate (requests completed per second at 100% load).

### M/M/1: the canonical single-server queue

M/M/1 assumes Poisson arrivals, exponentially distributed service times, one server.
The response-time formula is:

```
W = S / (1 - ρ)
```

where **S = 1/μ** is the mean service time with zero queue. Notice what happens as ρ → 1.0:

| ρ (utilization) | Response time multiplier |
|-----------------|--------------------------|
| 10% | 1.11× S |
| 50% | 2.0× S |
| 70% | 3.33× S |
| 80% | 5.0× S |
| 90% | 10.0× S |
| 95% | 20.0× S |
| 99% | 100.0× S |

This is the **latency knee**: below ~70% things feel fine; above 80% latency has already tripled;
at 90% it is ten times the baseline. The knee is not a bug — it is a mathematical certainty.

> [!PITFALL] Targeting 90%+ utilization as "efficient use of resources"
> Infrastructure teams often celebrate high CPU or connection-pool utilization as cost savings.
> What they are actually doing is running the service on the steep part of the M/M/1 curve.
> Any arrival variance — a momentary traffic spike, a slow GC pause, a slow downstream response —
> pushes ρ above 1.0 transiently, causing queue buildup that takes seconds to drain even after
> the spike subsides. Budget headroom. Keep sustained utilization below 70% on critical paths.

### M/M/c: parallel servers

With **c** identical servers (think: a connection pool of size c, or c event-loop workers):

```
ρ_per_server = λ / (c × μ)

// Erlang-C formula gives queue probability P_queue
// Exact form is complex; the key insight is:
W_queue = (Erlang_C(c, ρ_total) × S) / (c × (1 - ρ_per_server))
W_total  = W_queue + S
```

The good news: adding servers (c) dramatically shifts the knee to higher utilization.
A pool of 10 servers can sustain 85% utilization with much lower latency than a single server at 85%.
This is why Node's worker-thread pools and database connection pools have bounded sizes —
they are M/M/c queues and you need to size c to keep ρ_per_server well below 1.

> [!PRINCIPAL] libuv's UV_THREADPOOL_SIZE is an M/M/c queue
> Every `fs`, `crypto`, `dns.lookup`, and `zlib` call that uses libuv's thread pool lands in
> an M/M/c queue where c = `UV_THREADPOOL_SIZE` (default 4, max 1024). If your service does
> heavy bcrypt, file I/O, or blocking DNS and you see latency spikes but low CPU, increase
> the pool: `UV_THREADPOOL_SIZE=32 node server.js`. Measure with
> `--trace-event-categories node.async_hooks` and look at the event gap between
> "before" and "after" hooks on uv_work items.

## The Universal Scalability Law (USL)

The M/M/c model assumes all servers are independent and perfectly parallel. Real systems have
two additional costs first described by Neil Gunther in the **Universal Scalability Law**:

```
X(N) = (λ₁ × N) / (1 + α(N-1) + βN(N-1))
```

- **N** — number of servers / nodes / processes / threads
- **X(N)** — throughput at N nodes
- **λ₁** — throughput of a single node (baseline)
- **α** (alpha) — **contention** coefficient: serialized shared state (locks, single-writer queues,
  global interpreters). Models Amdahl's Law as a special case when β=0.
- **β** (beta) — **coherency** coefficient: the cost of keeping all nodes consistent
  (cache invalidation, distributed consensus, replication traffic). This term grows as N(N-1)
  — superlinearly — and is what causes throughput to *decrease* beyond a peak N.

### Reading the USL curve

```
α=0, β=0  → perfect linear scaling (impossible in practice)
α>0, β=0  → Amdahl's Law (contention only; plateau asymptote)
α>0, β>0  → USL: throughput peaks then declines (coherency overwhelms parallelism)
```

Real distributed systems have both α and β > 0. The USL predicts where adding nodes *hurts*.
For a Node.js cluster: α captures the overhead of the OS process scheduler and the shared
listening socket; β captures IPC / shared-state sync (e.g., a Redis session store that all
workers serialize through). If you have a hot Redis key every request touches, β is non-zero
and adding workers will not help beyond a small N.

> [!PRINCIPAL] The USL explains why "just add more pods" stops working
> When your service plateaus at 40 pods and latency does not improve, β is telling you something
> — likely a serialized resource (DB write primary, distributed lock, single-topic Kafka consumer
> group rebalance). Measure β by benchmarking at N=1, 2, 4, 8, 16 and fitting the USL curve.
> The shape tells you whether you have an α (lock contention) or β (coherency) problem and
> therefore whether you need finer-grained locking, sharding, or CRDT-style conflict-free
> data structures to recover linear scaling.

## Try it yourself

Run the calculator below. It plots Little's Law results, the M/M/1 response-time curve,
and a USL throughput curve for given alpha/beta values.

```js run
// Little's Law + M/M/1 response-time curve + USL throughput curve
// Pure browser JS, no Node APIs.

// --- Little's Law ---
function littlesLaw({ lambda, W, L }) {
  if (lambda !== undefined && W !== undefined)   return { L: lambda * W,       lambda, W };
  if (lambda !== undefined && L !== undefined)   return { W: L / lambda,       lambda, L };
  if (W !== undefined       && L !== undefined)  return { lambda: L / W,       L,      W };
  throw new Error("Provide exactly two of lambda, W, L");
}

// --- M/M/1 response time ---
function mm1ResponseTime(rho, S) {
  if (rho >= 1) return Infinity;
  return S / (1 - rho);
}

// --- Universal Scalability Law ---
function uslThroughput(N, lambda1, alpha, beta) {
  return (lambda1 * N) / (1 + alpha * (N - 1) + beta * N * (N - 1));
}

// =====================
// Little's Law examples
// =====================
console.log("=== Little's Law ===");
const ex1 = littlesLaw({ lambda: 1000, W: 0.080 });
console.log(`λ=1000 RPS, W=80ms → L=${ex1.L.toFixed(1)} concurrent requests in flight`);

const ex2 = littlesLaw({ L: 100, W: 0.050 });
console.log(`L=100 in-flight, W=50ms → λ=${ex2.lambda.toFixed(0)} RPS max throughput`);

const ex3 = littlesLaw({ lambda: 500, L: 40 });
console.log(`λ=500 RPS, L=40 in-flight → W=${(ex3.W * 1000).toFixed(1)}ms mean residence time`);

// =====================
// M/M/1 latency curve
// =====================
console.log("\n=== M/M/1 Response-Time Curve (S=50ms baseline) ===");
const S = 0.050; // 50 ms service time
const utilizations = [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99];
console.log("ρ (util)  W (ms)    Multiplier");
for (const rho of utilizations) {
  const W = mm1ResponseTime(rho, S);
  const mult = W / S;
  console.log(
    `  ${(rho * 100).toFixed(0).padStart(3)}%    ${(W * 1000).toFixed(1).padStart(7)}ms    ${mult.toFixed(2).padStart(6)}×`
  );
}

// =====================
// USL throughput curve
// =====================
console.log("\n=== USL Throughput Curve ===");
console.log("Params: λ₁=1000 RPS, α=0.05 (5% contention), β=0.002 (0.2% coherency)");
const lambda1 = 1000;
const alpha   = 0.05;
const beta    = 0.002;
const sizes = [1, 2, 4, 8, 16, 32, 64];
console.log("N nodes   X(N) RPS   Efficiency");
for (const N of sizes) {
  const X = uslThroughput(N, lambda1, alpha, beta);
  const ideal = lambda1 * N;
  const eff   = (X / ideal) * 100;
  console.log(
    `  ${String(N).padStart(2)}       ${X.toFixed(0).padStart(7)}     ${eff.toFixed(1).padStart(6)}%`
  );
}
console.log("(Throughput peaks then declines — coherency cost dominates at large N)");
```

## Exercise 1: Size your connection pool

Your Node service calls a Postgres database. Each DB query takes W_db = 15 ms on average.
Your service needs to handle λ = 500 RPS at steady state.
How many DB connections do you need in the pool? What utilization does that represent
if each connection can serve at most μ = 1/0.015 ≈ 66.7 queries/s?

<details>
<summary>Show solution</summary>

```js run
const lambda_db = 500;     // RPS hitting the DB
const W_db      = 0.015;   // 15 ms per query
const mu        = 1 / W_db; // 66.7 queries/s per connection

// Little's Law: pool size = concurrency = λ × W
const L = lambda_db * W_db;
console.log(`Pool size needed (L = λW): ${L} connections`);

// Each connection handles μ queries/s; at L connections:
const totalCapacity = L * mu;
console.log(`Pool capacity: ${totalCapacity} QPS (= exactly λ at ρ=1.0)`);

// At ρ=1.0 the queue explodes. We need headroom. Target ρ=0.70:
const targetRho = 0.70;
const safePoolSize = Math.ceil(lambda_db / (mu * targetRho));
console.log(`Safe pool size at ρ≤${targetRho}: ceil(${lambda_db} / (${mu.toFixed(1)} × ${targetRho})) = ${safePoolSize}`);

// M/M/1 latency at safe pool utilization (treating pool as M/M/c ≈ M/M/1 per connection):
const rhoPerConn = lambda_db / (safePoolSize * mu);
const W_total    = W_db / (1 - rhoPerConn);
console.log(`ρ per connection: ${(rhoPerConn * 100).toFixed(1)}%`);
console.log(`Expected response time with queue: ${(W_total * 1000).toFixed(1)} ms`);
```

You need `ceil(500 / 66.7) = 8` connections just to break even at ρ=1.0, and `ceil(500 / (66.7 × 0.7)) = 11` for a safe 70% utilization. M/M/1 at that utilization adds only ~3 ms of queue delay.
</details>

## Exercise 2: Identify the USL regime

You benchmark a distributed cache cluster at 1, 2, 4, 8, and 16 nodes and get:
1→480 RPS, 2→920 RPS, 4→1600 RPS, 8→2400 RPS, 16→2100 RPS.
Is this an α (contention) or β (coherency) problem?

<details>
<summary>Show solution</summary>

```js run
const data = [
  { N: 1,  X: 480 },
  { N: 2,  X: 920 },
  { N: 4,  X: 1600 },
  { N: 8,  X: 2400 },
  { N: 16, X: 2100 },
];

const lambda1 = 480;

console.log("N    X(actual)   X(ideal)   Efficiency");
for (const { N, X } of data) {
  const ideal = lambda1 * N;
  const eff   = (X / ideal) * 100;
  console.log(`${String(N).padStart(2)}   ${String(X).padStart(9)}   ${String(ideal).padStart(8)}   ${eff.toFixed(1).padStart(9)}%`);
}

// Throughput PEAKED at N=8 then FELL at N=16.
// This is the USL β≠0 regime: coherency cost dominates.
// With only contention (α>0, β=0) throughput would plateau, not decline.
console.log("\nConclusion: throughput declined from N=8→16 → β (coherency) is significant.");
console.log("Root cause: likely a hot shared key, leader election overhead, or gossip fan-out.");
console.log("Fix: shard the hot key, reduce replication factor, or switch to conflict-free data structures.");
```

The decline at N=16 is the hallmark USL β signature. Contention alone (Amdahl) causes a
plateau; coherency causes an actual decline. Profile inter-node traffic to find the chatty path.
</details>

## Common pitfalls

> [!PITFALL] Confusing M/M/1 with your real system and expecting exact predictions
> M/M/1 assumes Poisson arrivals and exponential service times. Real traffic has burstiness
> (heavy-tailed inter-arrival times) and real service times have multi-modal distributions
> (fast cache hit + slow DB miss). The model is directionally correct — the latency knee
> is real — but will underestimate tail latency for bursty arrivals. Use the model for
> *capacity planning headroom* (stay below 70% utilization) and *diagnosing* why latency
> blew up, not for SLA commitments.

A second trap: computing ρ against the wrong denominator. If your pool has 20 connections
and only 12 are healthy (the rest are in TCP TIME_WAIT or being recycled), your effective
c is 12 and ρ is higher than your dashboard shows. Instrument pool health, not just pool size.

## What you learned

- **Little's Law** (L=λW) relates concurrency, throughput, and latency — solve for any one
  given the other two. It works for any stable system, no distribution assumptions needed.
- **M/M/1** predicts that response time multiplies as `1/(1-ρ)` — at 90% utilization you pay
  a 10× latency penalty. The safe operating range is **ρ < 70%** on critical paths.
- **M/M/c** with c parallel workers shifts the knee to higher utilization; size pools and
  worker counts to keep ρ_per_worker well below 1.
- The **Universal Scalability Law** adds contention (α) and coherency (β) terms; when β > 0,
  adding nodes eventually *reduces* throughput — find and eliminate the coherency bottleneck.
- `UV_THREADPOOL_SIZE` is an M/M/c queue; size it for your workload's blocking-I/O concurrency.

## Next steps

Now that you can model how load translates to latency, the next lesson applies these insights
operationally: load shedding, backpressure, and adaptive concurrency limits that use Little's Law
in real time to keep your service on the safe side of the utilization knee.
*/});
