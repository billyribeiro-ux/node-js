registerLessonSrc("27-bullmq", function () {/*
---
id: 27-bullmq
title: "Job Queues with BullMQ & Redis"
minutes: 24
level: advanced
objectives:
  - Explain why background jobs exist and what problems they solve
  - Model a BullMQ Queue, Worker, and Job and understand their lifecycle
  - Configure concurrency, delays, repeatable jobs, and event listeners
---

# Job Queues with BullMQ & Redis

## Why this matters

Every serious web application has work that must not block the HTTP response: sending welcome emails, resizing uploaded images, generating PDF reports, syncing to third-party APIs. Doing this work inline makes your server slow and brittle. A **job queue** lets you hand off that work to a background **worker** process so the HTTP handler returns in milliseconds — and the heavy lifting happens reliably, out of band, at whatever concurrency makes sense for your infrastructure.

BullMQ is the Node.js job-queue library most teams reach for in 2026. It is built on Redis (or Valkey), battle-tested at scale, and ships first-class TypeScript types.

## Learning objectives

- Explain why background jobs solve latency and reliability problems.
- Use BullMQ's `Queue`, `Worker`, and `Job` classes to enqueue and process work.
- Control concurrency, add delays, schedule repeatable jobs, and handle events.

## The core problem: doing work outside the request/response cycle

Imagine a user signs up. Your handler needs to:

1. Insert a database row — fast, must be synchronous.
2. Send a welcome email — can take 300 ms, can fail, and the user does not need to wait for it.
3. Resize their profile picture — CPU-intensive, could take seconds.

Without a queue you either block the response (bad UX) or fire-and-forget (work is lost if the process crashes). A job queue gives you both: return immediately *and* guarantee the work runs, even across restarts.

```
HTTP Handler ──► Queue (Redis) ──► Worker Process
   returns           stores job        picks up job
  instantly         durably            executes it
                                       retries on fail
```

## BullMQ architecture: Queue, Worker, Job

**Queue** — the producer side. You call `queue.add()` to push a job into Redis.

**Worker** — the consumer side. You instantiate a `Worker` with a processor function; it polls Redis, picks up jobs, calls your function, and marks jobs completed or failed.

**Job** — the data envelope. Each job has a name, a data payload, options (delay, attempts, priority), and a lifecycle: `waiting → active → completed | failed`.

```js
// producer.js  (Node — requires Redis running on localhost:6379)
import { Queue } from "bullmq";

const emailQueue = new Queue("email", {
  connection: { host: "localhost", port: 6379 }
});

// Add a one-off job
await emailQueue.add("welcome", {
  to: "ada@example.com",
  subject: "Welcome!",
  template: "welcome-v2"
});

// Add a delayed job — process 5 minutes from now
await emailQueue.add("nudge", { to: "ada@example.com" }, {
  delay: 5 * 60 * 1000
});

// Add a repeatable job — runs every hour
await emailQueue.add("digest", { period: "hourly" }, {
  repeat: { every: 60 * 60 * 1000 }
});

await emailQueue.close();
```

> [!OUTPUT]
> (no console output — jobs are silently stored in Redis)

```js
// worker.js  (a separate long-running Node process)
import { Worker } from "bullmq";

const worker = new Worker("email", async (job) => {
  console.log(`Processing job ${job.id} — ${job.name}`, job.data);

  if (job.name === "welcome") {
    await sendWelcomeEmail(job.data.to);   // your real mailer
  } else if (job.name === "digest") {
    await sendDigestEmail(job.data);
  }
  // Return value becomes job.returnvalue
  return { sent: true, at: Date.now() };
}, {
  connection: { host: "localhost", port: 6379 },
  concurrency: 5   // process up to 5 jobs in parallel
});

worker.on("completed", (job, result) =>
  console.log(`Job ${job.id} done`, result));

worker.on("failed", (job, err) =>
  console.error(`Job ${job.id} failed`, err.message));
```

> [!OUTPUT]
> Processing job 1 — welcome { to: 'ada@example.com', subject: 'Welcome!', template: 'welcome-v2' }
> Job 1 done { sent: true, at: 1748995200000 }

## Concurrency: the right number of workers

BullMQ's `concurrency` option on a `Worker` controls how many jobs that *single Worker instance* runs in parallel. If your processor is I/O-bound (HTTP calls, DB queries), you can push concurrency to 20–50 and the event loop handles it efficiently. If your processor is CPU-bound (image resizing), keep concurrency at 1 per CPU core and spawn multiple worker processes.

```js
// I/O-heavy worker: high in-process concurrency
const ioWorker = new Worker("fetch-jobs", fetchProcessor, {
  connection,
  concurrency: 20
});

// CPU-heavy worker: one job at a time, scale by spawning processes
const cpuWorker = new Worker("image-resize", resizeProcessor, {
  connection,
  concurrency: 1
});
```

> [!PRINCIPAL] Workers are just processes
> There is no magic — BullMQ workers are ordinary Node processes that hold a Redis connection and call `BRPOPLPUSH` (or equivalent Lua scripts) to atomically move jobs from "waiting" to "active". You can run them on different machines, in containers, in Lambda — as long as they reach the same Redis. This means horizontal scaling is trivial: add more worker processes, and throughput scales linearly until Redis is the bottleneck.

## Delayed and repeatable jobs

A **delayed job** becomes eligible for processing only after `delay` milliseconds. Use it for scheduled reminders, rate-limit backpressure, or phased rollouts.

A **repeatable job** is re-enqueued automatically on a cron expression or `every` interval. BullMQ deduplicates them by key so restarting producers does not create duplicate scheduled jobs.

```js
// Delayed: send a follow-up 3 days after sign-up
await queue.add("follow-up", { userId: 42 }, {
  delay: 3 * 24 * 60 * 60 * 1000
});

// Cron: run every weekday at 09:00 UTC
await queue.add("morning-report", {}, {
  repeat: { pattern: "0 9 * * 1-5" }
});
```

## Events: observing the queue

`Queue` and `Worker` both emit events. Use them for logging, metrics, or alerting:

```js
import { QueueEvents } from "bullmq";

const events = new QueueEvents("email", { connection });

events.on("completed", ({ jobId, returnvalue }) =>
  console.log("done", jobId, returnvalue));

events.on("failed", ({ jobId, failedReason }) =>
  console.error("failed", jobId, failedReason));

events.on("progress", ({ jobId, data }) =>
  console.log("progress", jobId, data));
```

> [!NOTE] QueueEvents vs Worker events
> `worker.on("completed", ...)` only fires on that worker process. `QueueEvents` connects to Redis and fires for every job across all workers — ideal for a monitoring dashboard.

## Try it yourself

Here we model an in-memory job queue — no Redis, pure JavaScript — to internalise the producer/consumer/concurrency mechanics. The queue, worker, and job lifecycle are identical in spirit to BullMQ.

```js run
// In-memory job queue with worker concurrency limit

function createQueue(concurrency = 2) {
  const waiting = [];
  let active = 0;
  const completed = [];
  const failed = [];

  function tryProcess() {
    while (active < concurrency && waiting.length > 0) {
      const job = waiting.shift();
      active++;
      console.log(`[worker] starting job ${job.id} — ${job.name}`);

      Promise.resolve()
        .then(() => job.processor(job.data))
        .then((result) => {
          active--;
          completed.push({ id: job.id, result });
          console.log(`[worker] completed job ${job.id}, result:`, result);
          tryProcess(); // pick up next job
        })
        .catch((err) => {
          active--;
          failed.push({ id: job.id, error: err.message });
          console.log(`[worker] failed job ${job.id}:`, err.message);
          tryProcess();
        });
    }
  }

  let nextId = 1;

  return {
    add(name, data, processor) {
      const id = nextId++;
      waiting.push({ id, name, data, processor });
      console.log(`[queue]  enqueued job ${id} — ${name}`);
      tryProcess();
    },
    stats: () => ({ active, waiting: waiting.length, completed: completed.length, failed: failed.length })
  };
}

// --- demo ---
const queue = createQueue(2); // concurrency = 2

const delay = (ms) => new Promise(r => setTimeout(r, ms));

queue.add("email", { to: "ada@example.com" }, async (data) => {
  await delay(50);
  return `sent to ${data.to}`;
});

queue.add("resize", { file: "photo.jpg" }, async (data) => {
  await delay(80);
  return `resized ${data.file}`;
});

queue.add("report", { period: "weekly" }, async () => {
  await delay(30);
  return "report generated";
});

queue.add("bad-job", {}, async () => {
  await delay(10);
  throw new Error("downstream service unavailable");
});

await delay(300);
console.log("stats:", queue.stats());
```

## Exercise

**Challenge:** Add priority support to the in-memory queue. Higher-priority jobs should be processed before lower-priority ones, regardless of insertion order.

<details>
<summary>Show solution</summary>

```js run
function createPriorityQueue(concurrency = 2) {
  const waiting = []; // sorted highest priority first
  let active = 0;
  const log = [];

  function insert(job) {
    // insertion sort by priority descending
    let i = waiting.length;
    while (i > 0 && waiting[i - 1].priority < job.priority) i--;
    waiting.splice(i, 0, job);
  }

  function tryProcess() {
    while (active < concurrency && waiting.length > 0) {
      const job = waiting.shift();
      active++;
      Promise.resolve()
        .then(() => job.processor(job.data))
        .then((result) => {
          active--;
          log.push(`done  [p${job.priority}] ${job.name} => ${result}`);
          tryProcess();
        })
        .catch(() => {
          active--;
          tryProcess();
        });
    }
  }

  let nextId = 1;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  return {
    add(name, data, priority, processor) {
      insert({ id: nextId++, name, data, priority, processor });
      tryProcess();
    },
    printLog: () => log.forEach(l => console.log(l))
  };
}

const pq = createPriorityQueue(1); // concurrency=1 makes ordering visible
const delay = (ms) => new Promise(r => setTimeout(r, ms));

pq.add("low-priority-email",  {}, 1, async () => { await delay(20); return "done"; });
pq.add("critical-payment",    {}, 9, async () => { await delay(20); return "done"; });
pq.add("medium-notification", {}, 5, async () => { await delay(20); return "done"; });

await delay(200);
pq.printLog();
// critical-payment (p9) runs before medium (p5) before low (p1)
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to close the Queue and Worker
> BullMQ keeps an open Redis connection. If you forget `await queue.close()` and `await worker.close()` in tests or short-lived scripts, the process hangs. Always close in teardown. In production workers this is handled with a `SIGTERM` handler: `process.on("SIGTERM", () => worker.close())`.

> [!PITFALL] Making the processor non-idempotent
> Workers can crash mid-job and BullMQ will re-run it on restart. If your processor sends an email and then crashes before marking complete, the email could be sent twice. Design processors to be idempotent: check whether the work was already done before doing it.

## What you learned

- Background job queues decouple slow, failure-prone work from HTTP request handlers, improving latency and resilience.
- BullMQ's three primitives are `Queue` (producer), `Worker` (consumer), and `Job` (data envelope with lifecycle state).
- `concurrency` controls how many jobs a single Worker runs in parallel; scale horizontally by adding worker processes.
- Delayed jobs become eligible after a timeout; repeatable jobs re-enqueue on a cron or interval.
- `QueueEvents` lets any process observe all jobs across all workers via Redis pub/sub.

## Next steps

Jobs fail. Networks are unreliable. Next we'll look at how to make your queue resilient with exponential backoff, jitter, and dead-letter queues so permanent failures never silently disappear.
*/});
