registerLessonSrc("38-zero-downtime", function () {/*
---
id: 38-zero-downtime
title: "Zero-Downtime Deploys & Health Checks"
minutes: 24
level: principal
objectives:
  - Distinguish rolling, blue-green, and canary deploy strategies and when to use each
  - Implement readiness and liveness probes that keep traffic away from unhealthy instances
  - Perform graceful shutdown and connection draining so in-flight requests finish cleanly
---

# Zero-Downtime Deploys & Health Checks

## Why this matters

Shipping code that works is table stakes. Shipping it without waking users up at 3 AM —
without dropped connections, 502 errors, or half-migrated database schemas — is what
separates a mature engineering team from one that schedules maintenance windows every
release. Zero-downtime deployment is not a single trick; it is a discipline that touches
your load balancer, your health-check endpoints, your startup code, your signal handlers,
and your database migration strategy all at once.

## Learning objectives

- Compare rolling, blue-green, and canary deploy strategies and choose the right one.
- Write `/healthz/ready` and `/healthz/live` endpoints that your orchestrator can trust.
- Drain in-flight requests and close resources cleanly on `SIGTERM`.
- Design database migrations using the expand/contract pattern so old and new code coexist.

## Deploy strategies

### Rolling deploy

A **rolling deploy** replaces instances one at a time (or in small batches) while keeping
the rest serving traffic. The load balancer briefly drains each instance, kills it, starts
the new version, waits for it to pass its readiness probe, then moves on to the next.

```
Capacity: [old] [old] [old] [old]   → start
           [new] [old] [old] [old]   → instance 1 replaced
           [new] [new] [old] [old]   → instance 2 replaced
           [new] [new] [new] [old]   → instance 3 replaced
           [new] [new] [new] [new]   → done
```

**Pros:** simple, uses existing fleet, no extra infrastructure cost.
**Cons:** old and new versions run simultaneously — your code (and your DB schema) must
tolerate both. If the new version is broken you detect it after some requests have already
been served by it.

### Blue-green deploy

**Blue-green** keeps two identical environments — "blue" is live, "green" is idle. You
deploy the new version to green, run your smoke tests, then flip the load balancer (a single
DNS or routing change) to send all traffic to green. Blue becomes the new idle environment.

```
  ┌──────────────┐
  │ Load Balancer│── live traffic
  └──────┬───────┘
         │
    [blue: v1]  (serves all requests)

  ... deploy v2 to green, test it ...

  ┌──────────────┐
  │ Load Balancer│── live traffic
  └──────┬───────┘
         │
    [green: v2]  (now live)
    [blue:  v1]  (warm standby → rollback in seconds)
```

**Pros:** instant rollback (flip the router back); green is fully tested before any user
traffic reaches it.
**Cons:** doubles infrastructure cost; both environments share the same database, so schema
changes still need care.

### Canary deploy

A **canary** routes a small percentage of real traffic (say 1 %, then 10 %, then 50 %) to
the new version while the majority stays on the old one. You watch error rates, latency, and
business metrics. If everything looks good you graduate the canary to 100 %.

```js
// nginx weight-based canary (conceptual read-only example)
upstream backend {
  server old-pod:3000 weight=90;
  server new-pod:3000 weight=10;   // 10% canary traffic
}
```

> [!OUTPUT]
> # 90% of requests go to old-pod, 10% to new-pod.
> # Watch Grafana dashboards; promote when p99 matches old baseline.

**Pros:** real production traffic validates the new code; risk is bounded to canary users.
**Cons:** most complex to orchestrate; requires good observability to know when to proceed.

> [!PRINCIPAL] Choosing the right strategy
> Rolling deploy is the right default for most teams — it is simple, cheap, and Kubernetes
> does it natively. Reach for blue-green when you need instant rollback with zero in-flight
> request loss (financial transactions, compliance-sensitive flows). Use canary when the risk
> of a bad deploy is high and you have the observability infrastructure to evaluate it. Start
> with rolling and graduate to canary as your monitoring matures.

## Readiness vs liveness probes

Your orchestrator (Kubernetes, ECS, a load balancer) needs two separate signals from each
instance:

| Probe | Question | Failing action |
|---|---|---|
| **Liveness** | Is the process alive and not stuck? | Kill and restart the pod |
| **Readiness** | Is the instance ready to serve traffic? | Remove from the load-balancer pool |

These answer different questions and should never be collapsed into one endpoint.

```js
import Fastify from "fastify";
import { createClient } from "redis";

const app = Fastify();
const redis = createClient({ url: process.env.REDIS_URL });

let isReady = false;

app.get("/healthz/live", (req, reply) => {
  // Liveness: is the event loop responsive?
  // Keep it cheap — do NOT check external deps here.
  reply.code(200).send({ status: "alive" });
});

app.get("/healthz/ready", async (req, reply) => {
  // Readiness: can we actually serve requests?
  if (!isReady) return reply.code(503).send({ status: "starting" });
  try {
    await redis.ping();  // ensure the dependency we need is reachable
    reply.code(200).send({ status: "ready" });
  } catch (err) {
    reply.code(503).send({ status: "deps-unavailable", detail: err.message });
  }
});

// Warm up connections, caches, etc., then flip the flag
async function start() {
  await redis.connect();
  // ... preload caches, run any startup checks ...
  isReady = true;
  await app.listen({ port: 3000, host: "0.0.0.0" });
  console.log("Listening on :3000 — marked ready");
}
start();
```

> [!OUTPUT]
> Listening on :3000 — marked ready
> GET /healthz/ready → 200 { status: "ready" }
> GET /healthz/live  → 200 { status: "alive" }

> [!WARNING] Do not check downstream deps in the liveness probe
> If your liveness probe calls Redis or Postgres and those are temporarily slow, Kubernetes
> will kill and restart your perfectly healthy pod — making a partial outage total. Liveness
> should only confirm the process itself is responsive. Readiness is where you check deps.

## Graceful shutdown & connection draining

When an instance receives `SIGTERM` (the signal Kubernetes or your process manager sends
before stopping a pod), it must:

1. **Stop accepting new connections** — remove itself from the load-balancer pool first.
2. **Drain in-flight requests** — wait for active handlers to finish.
3. **Close resources** — database pools, Redis connections, file handles.
4. **Exit cleanly** — `process.exit(0)`.

```js
import http from "node:http";

const server = http.createServer((req, res) => {
  // Simulate a slow handler (e.g. DB query)
  setTimeout(() => res.end("ok"), 200);
});

server.listen(3000, () => console.log("Listening on :3000"));

let shuttingDown = false;

process.on("SIGTERM", () => {
  console.log("SIGTERM received — starting graceful shutdown");
  shuttingDown = true;

  // Stop accepting new connections immediately
  server.close(() => {
    console.log("All in-flight requests finished — exiting");
    process.exit(0);
  });

  // Hard-kill safety net after 30 s — prevents zombie processes
  setTimeout(() => {
    console.error("Shutdown timeout — forcing exit");
    process.exit(1);
  }, 30_000).unref();
});
```

> [!OUTPUT]
> Listening on :3000
> SIGTERM received — starting graceful shutdown
> All in-flight requests finished — exiting

> [!PITFALL] Forgetting the hard-kill timeout
> `server.close()` waits for keep-alive connections to close naturally. A browser holding an
> idle HTTP/1.1 keep-alive connection can prevent shutdown for minutes. Always set a
> hard-kill timeout (30 s is conventional) and call `.unref()` so it does not prevent the
> event loop from exiting on its own if everything else finishes first.

## Database migration safety: expand/contract

Rolling and canary deploys mean **old and new versions run at the same time against the
same database**. A migration that renames or drops a column will break the old version that
still references the old name. The solution is the **expand/contract** pattern:

**Phase 1 — Expand:** add the new column (nullable or with a default); write to both old
and new columns. Old code reads the old column and is unaware of the new one.

**Phase 2 — Backfill:** migrate existing rows to populate the new column. This runs
independently of deploys, at any pace you choose.

**Phase 3 — Deploy new code:** update the application to read from the new column. Both
phases have now shipped; old code is gone.

**Phase 4 — Contract:** once old code is completely retired, drop the old column. This is
the only safe time to remove it.

```
Deploy:  v1 only   →  v1 + v2 coexist  →  v2 only
Column:  old only  →  old + new (both)  →  old + new  →  new only
                                                           (drop old)
```

This is intentionally slower than a one-step rename — the payoff is that you can always
roll back without data loss.

## Try it yourself

Below is a pure-JS rolling-deploy simulator. It replaces instances one at a time, verifies
each passes a readiness check before proceeding, and ensures total capacity never drops
below a threshold. Experiment with the `readinessDelay` and `threshold` values.

```js run
// Rolling-deploy simulator — pure JS, no Node APIs needed.

function makeInstance(id, version, readyAfterMs) {
  const startedAt = Date.now();
  return {
    id,
    version,
    isReady() { return Date.now() - startedAt >= readyAfterMs; },
    toString() { return `[${id} v${version}]`; }
  };
}

async function waitForReady(instance, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!instance.isReady()) {
    if (Date.now() > deadline) throw new Error(`${instance} timed out`);
    await new Promise(r => setTimeout(r, 50));
  }
}

async function rollingDeploy(instances, newVersion, opts = {}) {
  const { minCapacityPct = 0.75, readyDelayMs = 100 } = opts;
  const total = instances.length;
  const minUp = Math.ceil(total * minCapacityPct);
  const results = [...instances];

  console.log(`Starting rolling deploy to v${newVersion}. Fleet: ${total} instances, min capacity: ${minUp}`);

  for (let i = 0; i < total; i++) {
    const upCount = total - i; // instances not yet replaced in this cycle
    if (upCount - 1 < minUp) {
      console.log(`  Skipping drain of ${results[i]} — would drop below min capacity`);
      continue;
    }
    console.log(`  Draining ${results[i]}...`);
    // Start new instance
    const fresh = makeInstance(results[i].id, newVersion, readyDelayMs);
    console.log(`  Started ${fresh}, waiting for readiness...`);
    await waitForReady(fresh, 3000);
    results[i] = fresh;
    console.log(`  ${fresh} is ready. Capacity: ${results.filter(r => r.version === newVersion).length}/${total} on new version`);
  }

  const succeeded = results.filter(r => r.version === newVersion).length;
  console.log(`\nDeploy complete: ${succeeded}/${total} instances running v${newVersion}`);
  return results;
}

// Initial fleet: 4 instances on v1
const fleet = [
  makeInstance("pod-1", 1, 0),
  makeInstance("pod-2", 1, 0),
  makeInstance("pod-3", 1, 0),
  makeInstance("pod-4", 1, 0),
];

rollingDeploy(fleet, 2, { minCapacityPct: 0.75, readyDelayMs: 80 });
```

## Exercise: implement a readiness-gate

Write a `ReadinessGate` class that tracks multiple named dependencies. It exposes an
`isReady()` method that returns `true` only when all registered deps have reported healthy.
Simulate two deps — `db` and `cache` — with staggered delays.

<details>
<summary>Show solution</summary>

```js run
class ReadinessGate {
  constructor(depNames) {
    this.state = new Map(depNames.map(n => [n, false]));
  }

  markHealthy(name) {
    if (!this.state.has(name)) throw new Error(`Unknown dep: ${name}`);
    this.state.set(name, true);
    console.log(`  ${name} is healthy. Ready: ${this.isReady()}`);
  }

  isReady() {
    for (const [, ok] of this.state) if (!ok) return false;
    return true;
  }

  status() {
    return Object.fromEntries(this.state);
  }
}

const gate = new ReadinessGate(["db", "cache", "featureFlags"]);

async function simulateStartup() {
  console.log("Starting up...");
  await new Promise(r => setTimeout(r, 50));
  gate.markHealthy("db");

  await new Promise(r => setTimeout(r, 30));
  gate.markHealthy("cache");

  await new Promise(r => setTimeout(r, 20));
  gate.markHealthy("featureFlags");

  console.log("All deps healthy:", gate.status());
  console.log("Flipping ready flag:", gate.isReady());
}

simulateStartup();
```

</details>

## Common pitfalls

> [!PITFALL] Deploying schema migrations in the same commit as application code
> If your migration drops a column and the app deploy uses rolling updates, the old pods will
> crash the moment the migration runs. Always separate the migration deploy from the code
> deploy by at least one full release cycle. Run migrations before code, never after.

> [!PITFALL] Health checks that always return 200
> A health endpoint that never returns 5xx provides zero value and gives operators false
> confidence. Test your health endpoints by deliberately taking a dependency offline —
> verify that `/healthz/ready` returns 503 and that the load balancer stops sending traffic.

## What you learned

- Rolling deploys replace instances one at a time; blue-green flips the router; canary
  graduates a small traffic slice before full promotion.
- Readiness probes check external deps and control load-balancer membership; liveness
  probes only check process health and should be dependency-free.
- Graceful shutdown means: stop accepting connections, drain in-flight requests, close
  resources, then exit — with a hard-kill timeout as a safety net.
- The expand/contract pattern decouples database schema changes from application deploys
  so old and new code coexist safely at the same time.

## Next steps

Now that your instances deploy without dropping requests, the next question is: how many
do you actually need? The following lesson covers load testing, latency percentiles, and
capacity planning so you can answer that question with data instead of guesswork.
*/});
