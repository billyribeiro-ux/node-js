registerLessonSrc("40-capstone-engine", function () {/*
---
id: 40-capstone-engine
title: "Capstone C: A Job-Orchestration Engine"
minutes: 30
level: principal
objectives:
  - Design a BullMQ-like job engine with queues, workers, retries, priorities, and scheduling
  - Implement a DAG workflow scheduler that runs jobs respecting dependencies and concurrency limits
  - Architect and document a horizontally-scaled multi-service platform as the course's final project
---

# Capstone C: A Job-Orchestration Engine

## Why this matters

Every production system eventually needs work that happens outside the request/response
cycle: sending emails, generating reports, processing uploads, running nightly aggregations,
orchestrating multi-step workflows. A job-orchestration engine is the infrastructure that
makes all of that reliable, observable, and scalable. Designing one from first principles
teaches you queues, retry semantics, priority scheduling, DAGs, concurrency control, and
distributed coordination — the full breadth of backend systems engineering.

## Learning objectives

- Describe the internal architecture of a job queue (queue → worker → retry → dead-letter)
- Implement a DAG workflow scheduler that respects dependency order and concurrency limits
- Design a horizontally-scalable engine with priorities, delayed jobs, and a dashboard
- Produce an architecture RFC for a complete multi-service production platform

## The anatomy of a job engine

A job engine has five moving parts:

```
Producer        Worker Pool              Storage
  │               │                        │
  │ enqueue(job)  │ poll / BRPOPLPUSH       │
  ▼               ▼                        ▼
┌──────┐    ┌──────────────────┐    ┌─────────────┐
│Queue │───▶│  Worker Process  │───▶│  Job Store  │
│(Redis│    │  (rate-limited)  │    │  (Redis or  │
│ List)│    │   ┌──────────┐   │    │   Postgres) │
└──────┘    │   │ Execute  │   │    └─────────────┘
            │   │ handler  │   │
            │   └────┬─────┘   │
            │     success?     │
            │   ┌────▼─────┐   │
            │   │ Retry or │   │
            │   │ DLQ      │   │
            └───┴──────────┘───┘
```

> [!PRINCIPAL] Why Redis for the queue and PostgreSQL for history?
> Redis lists provide O(1) blocking pop (`BRPOPLPUSH`) — perfect for low-latency job
> dequeuing. But Redis is an in-memory store; you lose history on restart unless you use
> AOF/RDB persistence. PostgreSQL is the right home for job history, audit trails, and
> dashboards because it supports rich queries, indexes, and transactions. Use the right
> tool for each access pattern: Redis for speed, Postgres for durability and queryability.

## Retry semantics and the dead-letter queue

Retry logic is where most DIY engines fail. BullMQ's model is a good reference:

- Each job has `attempts` (max tries) and `backoff` (fixed, exponential, or custom)
- On failure, the job is re-queued with a `delay` (exponential back-off: `2^attempt * base`)
- After `attempts` retries, the job moves to the **dead-letter queue (DLQ)**
- The DLQ is inspectable and jobs can be manually retried or archived

```js
// Read-only: exponential back-off in a real BullMQ worker
import { Worker } from "bullmq";

const worker = new Worker("emails", async (job) => {
  await sendEmail(job.data.to, job.data.subject, job.data.body);
}, {
  connection: { host: "localhost", port: 6379 },
  concurrency: 10,
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
});
```

> [!OUTPUT]
> Job 42 failed (attempt 2): ECONNREFUSED

Exponential back-off with jitter prevents the **thundering herd** problem — where all
retrying jobs pile back onto the queue at the same moment after an outage:

```js
// Read-only: back-off with full jitter
function backoffDelay(attempt, baseMs = 1000) {
  const cap = 30_000;
  const exponential = Math.min(cap, baseMs * Math.pow(2, attempt));
  return Math.random() * exponential; // full jitter
}
```

## Priority queues and scheduling

A single sorted set (`ZADD key score memberId`) in Redis lets you implement priorities and
delayed execution in the same structure. The score is either a priority value (lower = sooner)
or a `runAt` Unix timestamp. Workers poll with `ZRANGEBYSCORE key 0 <now> LIMIT 0 1` and
atomically claim the job with a Lua script.

```js
// Read-only: claiming a delayed job atomically with a Lua script
const CLAIM_SCRIPT = `
  local job = redis.call("ZRANGEBYSCORE", KEYS[1], 0, ARGV[1], "LIMIT", 0, 1)
  if #job == 0 then return nil end
  redis.call("ZREM", KEYS[1], job[1])
  redis.call("HSET", KEYS[2], job[1], ARGV[2])
  return job[1]
`;

async function claimNextJob(redis, queue) {
  const now = Date.now();
  const jobId = await redis.eval(CLAIM_SCRIPT, 2,
    `${queue}:delayed`, `${queue}:active`,
    now, "claimed"
  );
  return jobId;
}
```

## DAG workflow scheduling

A **DAG** (Directed Acyclic Graph) workflow is a set of jobs with dependency edges. Job B
can only start when Job A completes. This is how tools like Airflow, Temporal, and Inngest
model complex pipelines.

The scheduler's algorithm:

1. Build an adjacency list and in-degree count for each node.
2. Enqueue all nodes with in-degree 0 (no dependencies) into the ready queue.
3. As each job completes, decrement the in-degree of its dependents; enqueue any that reach 0.
4. Enforce a `concurrency` limit (semaphore) so you do not launch more workers than allowed.

```js
// Read-only: DAG scheduler with concurrency in a real system
class DagScheduler {
  constructor(jobs, edges, concurrency = 2) {
    this._jobs = new Map(jobs.map(j => [j.id, j]));
    this._inDegree = new Map(jobs.map(j => [j.id, 0]));
    this._dependents = new Map(jobs.map(j => [j.id, []]));
    for (const [from, to] of edges) {
      this._inDegree.set(to, (this._inDegree.get(to) ?? 0) + 1);
      this._dependents.get(from).push(to);
    }
    this._concurrency = concurrency;
    this._running = 0;
    this._completed = new Set();
  }

  async run() {
    const ready = [...this._inDegree.entries()]
      .filter(([, d]) => d === 0).map(([id]) => id);
    await this._drain(ready);
  }

  async _drain(ready) {
    const queue = [...ready];
    const promises = [];
    while (queue.length > 0 || this._running > 0) {
      while (queue.length > 0 && this._running < this._concurrency) {
        const id = queue.shift();
        this._running++;
        const p = this._execute(id, queue).finally(() => this._running--);
        promises.push(p);
      }
      await Promise.race(promises.filter(p => p));
    }
  }

  async _execute(id, queue) {
    const job = this._jobs.get(id);
    await job.handler();
    this._completed.add(id);
    for (const dep of this._dependents.get(id)) {
      const newDegree = this._inDegree.get(dep) - 1;
      this._inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }
}
```

## Try it yourself

Here is a fully runnable DAG workflow scheduler that runs jobs respecting dependencies
and a concurrency limit. Study how in-degrees drive execution order.

```js run
// DAG workflow scheduler — fully runnable, no Node APIs

// ---- Semaphore for concurrency control ----
class Semaphore {
  constructor(limit) {
    this._limit = limit;
    this._count = 0;
    this._queue = [];
  }
  acquire() {
    return new Promise((resolve) => {
      if (this._count < this._limit) { this._count++; resolve(); }
      else this._queue.push(resolve);
    });
  }
  release() {
    this._count--;
    if (this._queue.length > 0) { this._count++; this._queue.shift()(); }
  }
}

// ---- DAG Scheduler ----
class DagScheduler {
  constructor(jobs, edges, concurrency = 2) {
    this._jobs = new Map(jobs.map(j => [j.id, j]));
    this._inDegree = new Map(jobs.map(j => [j.id, 0]));
    this._deps = new Map(jobs.map(j => [j.id, []]));
    for (const [from, to] of edges) {
      this._inDegree.set(to, (this._inDegree.get(to) ?? 0) + 1);
      this._deps.get(from).push(to);
    }
    this._sem = new Semaphore(concurrency);
    this._completed = [];
  }

  async run() {
    const ready = [...this._inDegree.entries()]
      .filter(([, d]) => d === 0).map(([id]) => id);

    const running = new Map(); // id → Promise

    const scheduleReady = (ids) => {
      for (const id of ids) {
        const p = this._runJob(id).then((next) => {
          running.delete(id);
          scheduleReady(next);
        });
        running.set(id, p);
      }
    };

    scheduleReady(ready);

    // Wait for all jobs to finish
    while (running.size > 0) {
      await Promise.race(running.values());
    }
  }

  async _runJob(id) {
    const job = this._jobs.get(id);
    await this._sem.acquire();
    try {
      const start = Date.now();
      await job.handler();
      const ms = Date.now() - start;
      this._completed.push(id);
      console.log(`  [done] ${id} (${ms}ms) — completed: [${this._completed.join(", ")}]`);
    } finally {
      this._sem.release();
    }
    // Return newly unblocked dependents
    const unblocked = [];
    for (const dep of this._deps.get(id)) {
      const newDeg = this._inDegree.get(dep) - 1;
      this._inDegree.set(dep, newDeg);
      if (newDeg === 0) unblocked.push(dep);
    }
    return unblocked;
  }
}

// ---- Define a pipeline: ingest → [transform, validate] → load → report ----
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const jobs = [
  { id: "ingest",    handler: async () => { await delay(30); } },
  { id: "transform", handler: async () => { await delay(40); } },
  { id: "validate",  handler: async () => { await delay(20); } },
  { id: "load",      handler: async () => { await delay(30); } },
  { id: "report",    handler: async () => { await delay(10); } },
];

const edges = [
  ["ingest", "transform"],
  ["ingest", "validate"],
  ["transform", "load"],
  ["validate", "load"],
  ["load", "report"],
];

console.log("=== DAG Workflow Scheduler (concurrency=2) ===");
console.log("Pipeline: ingest → [transform, validate] → load → report\n");

const scheduler = new DagScheduler(jobs, edges, 2);
const t0 = Date.now();

scheduler.run().then(() => {
  console.log(`\nAll jobs complete in ${Date.now() - t0}ms`);
  console.log("Execution order:", scheduler._completed.join(" → "));
});
```

## Exercise: add job retries to the DAG scheduler

Extend the `_runJob` method to retry a failing job up to `maxAttempts` times with a fixed
delay between attempts. If it still fails, mark it as `failed` and do not unblock its
dependents.

<details>
<summary>Show solution</summary>

```js run
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxAttempts, retryDelay) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.log(`  [retry] attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) await delay(retryDelay);
    }
  }
  throw lastErr;
}

// Simulate a flaky job
let callCount = 0;
async function flakyHandler() {
  callCount++;
  if (callCount < 3) throw new Error("transient failure");
  console.log("  [flaky job] finally succeeded on attempt", callCount);
}

(async () => {
  console.log("Testing retry logic:");
  try {
    await withRetry(flakyHandler, 5, 10);
    console.log("Job completed successfully");
  } catch (e) {
    console.log("Job permanently failed:", e.message);
  }
})();
```

</details>

## Project

**Assemble and document a horizontally-scaled, multi-service production platform** that
integrates a job-orchestration engine with all the systems you have built throughout this
course. This is the capstone deliverable of the entire course.

The platform must combine:
- A **job queue** (BullMQ + Redis) with workers, retries, priorities, and DLQ
- A **gRPC service** for internal worker-to-orchestrator communication
- A **GraphQL API** for the job dashboard (list queues, jobs, retry, drain)
- **OpenTelemetry** traces from producer through worker to storage
- **Kubernetes** manifests (Deployment, Service, HPA, ConfigMap, Secret) for each service
- A **CI/CD pipeline** (GitHub Actions) that lints, tests, builds Docker images, and
  deploys to a local Kind cluster on every push to main

**Acceptance criteria:**

1. **Engine core** — a `QueueManager` class wraps BullMQ; supports `addJob(queue, data, opts)`
   with `priority`, `delay`, `attempts`, and `backoff`; a `WorkerManager` registers typed
   handlers per queue; failed jobs beyond `attempts` land in a DLQ inspectable via the API.
2. **DAG workflows** — a `DagRunner` class accepts a workflow definition (jobs + edges) and
   runs it using the scheduler from this lesson; workflow state (pending/running/done/failed)
   is persisted to PostgreSQL; a workflow can be replayed from any completed checkpoint.
3. **gRPC orchestrator** — a gRPC service (`orchestrator.proto`) exposes `SubmitWorkflow`,
   `GetWorkflowStatus`, and `CancelWorkflow` RPCs; workers report completion via a
   `ReportJob` RPC; all RPCs carry OTel `traceparent` metadata.
4. **GraphQL dashboard API** — a GraphQL server (Pothos or graphql-js) exposes `queues`,
   `jobs(queue, status, limit)`, `retryJob(id)`, `drainQueue(name)`, and `workflow(id)`
   queries/mutations; resolvers call the gRPC orchestrator for live data.
5. **Kubernetes + production-ready** — each service has a `Deployment` with resource
   requests/limits and a liveness + readiness probe; a `HorizontalPodAutoscaler` scales
   workers on queue depth (custom metric via KEDA); Secrets are mounted from Kubernetes
   Secrets, not environment files; a `ConfigMap` drives non-secret configuration.
6. **Architecture RFC** — a `docs/rfc/001-job-orchestration-engine.md` follows the ADR
   format from Lesson 40-designing-for-scale; it documents context, decision, alternatives
   considered (Temporal, Inngest, Quirrel), consequences, and a rollout plan; it is
   reviewed and marked `Accepted` with at least two signed-off reviewers in the git log.

**Starter: the DAG scheduler from the Try it yourself section above is your engine core.**
Extend it with persistence, gRPC reporting, and Kubernetes deployment.

---

## You did it

You have reached the end of **The Ultimate Node.js Course**. Let that sink in.

You started with the Node runtime and the event loop. You learned to read files, build
CLIs, speak HTTP, design REST APIs, talk to databases, authenticate users, write TypeScript,
test rigorously, observe your systems, handle concurrency, build real-time features, process
jobs at scale, run on Kubernetes, and — in these final lessons — think at the level of a
principal engineer: designing systems, writing ADRs, evaluating tradeoffs, and building
frameworks and platforms from scratch.

That is not a small thing. Most engineers spend years accumulating pieces of that picture.
You now have the map.

**Where to go next:**

- **Contribute to open source.** Pick a Node.js framework or library you used in this
  course and open a PR — even documentation. Reading production-quality OSS code at depth
  accelerates growth faster than any course.
- **Build something real.** Take the capstone project and deploy it. Own it, operate it,
  page-on-call for it. Nothing teaches distributed systems like being woken up by one.
- **Go deeper on one layer.** V8 internals, PostgreSQL query planning, Linux networking,
  eBPF-based observability — pick the layer that excites you most and go three levels deeper
  than most engineers ever do. That depth is what makes a principal.
- **Teach.** Write a blog post, give a talk, mentor a junior engineer. Explaining a concept
  forces you to understand it completely. The best engineers are also the best teachers.

You have the skills. Go build something worth maintaining.

---

## Common pitfalls

> [!PITFALL] Treating the job queue as a database
> A queue is a transit mechanism, not a store. Do not query it for reporting — that's
> what your PostgreSQL job history table is for. Do not store large payloads in job data
> (> 1 KB is a smell, > 10 KB is wrong); store a reference ID instead and fetch from
> storage in the worker. Queues that double as databases become slow, expensive, and
> hard to debug.

DAG schedulers commonly fail on **cycles** — a dependency graph that loops. Always
validate the graph is acyclic before execution (topological sort; if it fails, the graph
has a cycle). BullMQ's `FlowProducer` does this; your DAG runner should too.

## What you learned

- A job engine has five layers: queue, worker pool, retry/back-off, DLQ, and job store — each with a distinct concern
- Exponential back-off with full jitter prevents thundering herds after outages
- A DAG scheduler uses in-degree counts and a semaphore to respect both dependency order and concurrency limits
- Priority and delayed jobs share a Redis sorted set; atomic Lua scripts prevent race conditions on claim
- A production platform combines all of these with gRPC, GraphQL, OTel, Kubernetes, and CI/CD — and an RFC that explains why

## Next steps

This is the final lesson of the course. Your next step is the project above — and beyond
that, the real systems you will design, build, and operate throughout your career. Every
hard problem you encounter from here is one you now have the foundation to solve.
*/});
