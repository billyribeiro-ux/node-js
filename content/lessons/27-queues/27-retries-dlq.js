registerLessonSrc("27-retries-dlq", function () {/*
---
id: 27-retries-dlq
title: "Retries, Backoff & Dead-Letter Queues"
minutes: 22
level: principal
objectives:
  - Distinguish transient from permanent failures and choose the right response to each
  - Implement exponential backoff with jitter to avoid retry storms
  - Route jobs that exhaust retries to a dead-letter queue for inspection and replay
---

# Retries, Backoff & Dead-Letter Queues

## Why this matters

Distributed systems fail. Downstream APIs go down, databases deadlock, network packets are dropped. A background job system that crashes and silently loses work is not a feature — it is a liability. The discipline of retry strategy — when to retry, how long to wait, and what to do when retries run out — is what separates a toy queue from a production-grade system. Getting it wrong leads to **retry storms** that take your dependencies offline, or silent data loss that nobody notices until a customer complains.

## Learning objectives

- Recognise the difference between **transient** failures (safe to retry) and **permanent** failures (pointless or dangerous to retry).
- Calculate exponential backoff delays with **full jitter** to spread load across retrying workers.
- Implement a **dead-letter queue (DLQ)** that captures exhausted jobs for human inspection and eventual replay.

## Transient vs permanent failures

Before you retry anything, classify the error:

| Category | Example | Right action |
|---|---|---|
| Transient | HTTP 429 Too Many Requests, TCP timeout, DB deadlock | Retry with backoff |
| Transient (temporary) | Service restarting, DNS hiccup | Retry with longer delay |
| Permanent | HTTP 400 Bad Request, validation error, missing record | Do NOT retry — send to DLQ |
| Permanent | Disk full on destination | Do NOT retry — alert humans |

Retrying a permanent failure wastes resources and can cause harm (duplicate charges, double-sends). Your processor should distinguish error types and either re-throw (to trigger a retry) or mark the job as permanently failed.

```js
// worker.js — differentiating error classes
import { Worker, UnrecoverableError } from "bullmq";

const worker = new Worker("payments", async (job) => {
  try {
    await chargeCard(job.data);
  } catch (err) {
    if (err.code === "CARD_DECLINED") {
      // Permanent — wrapping in UnrecoverableError skips all retries
      throw new UnrecoverableError(`Card declined: ${err.message}`);
    }
    // Anything else: re-throw so BullMQ retries with backoff
    throw err;
  }
}, { connection, attempts: 5, backoff: { type: "exponential", delay: 1000 } });
```

> [!OUTPUT]
> (permanent failures move straight to the failed set; transient ones retry up to 5 times)

## Exponential backoff with jitter

Naïve retry: wait a fixed time, say 1 second, between every attempt. The problem: if 1,000 jobs all fail simultaneously (e.g., a downstream service restarts), they all retry at the same moment, creating a **thundering herd** that hammers the recovering service and makes the outage worse.

**Exponential backoff** spaces retries further and further apart:

```
attempt 1 → wait 1 s
attempt 2 → wait 2 s
attempt 3 → wait 4 s
attempt 4 → wait 8 s
```

The formula: `delay = base * 2^(attempt - 1)`, capped at a `maxDelay`.

**Full jitter** multiplies by a random fraction `[0, 1)` so retrying workers spread their load across the backoff window instead of all waking up at the same instant:

```
jitteredDelay = Math.random() * base * 2^(attempt - 1)
```

This is the **AWS full jitter** strategy — proven to dramatically reduce retry contention.

```js
// backoff.js — pure utility, no dependencies
export function exponentialBackoff(attempt, { base = 1000, maxDelay = 30_000 } = {}) {
  const exp = Math.min(base * Math.pow(2, attempt - 1), maxDelay);
  return Math.random() * exp; // full jitter: uniform [0, exp)
}
```

> [!PRINCIPAL] Jitter is not optional at scale
> Without jitter, exponential backoff still synchronises retries because all workers see the same base delay formula. At 10,000 failing jobs, backoff without jitter can generate traffic spikes indistinguishable from a DDoS. Full jitter provably minimises contention and server load — measure the difference in production by graphing your downstream RPS during an outage recovery. Adding it costs two characters: `Math.random() *`.

## Max attempts and the dead-letter queue

Every job must have a **max attempts** ceiling — otherwise a permanent failure retries forever, clogging the queue and wasting resources. Once a job exceeds its limit it should go to a **dead-letter queue (DLQ)**: a separate queue (or set) where failed jobs are stored safely for:

- Human inspection ("what went wrong?")
- Alerting ("page the on-call when the DLQ depth exceeds 10")
- Replay ("fix the bug, then re-enqueue")

In BullMQ, exhausted jobs land in the queue's `failed` set automatically. You can also forward them explicitly to a dedicated DLQ queue:

```js
// dlq-forwarder.js — forward exhausted jobs to a dedicated DLQ
import { Worker, Queue } from "bullmq";

const dlq = new Queue("payments-dlq", { connection });

const worker = new Worker("payments", async (job) => {
  await chargeCard(job.data);
}, {
  connection,
  concurrency: 5
});

worker.on("failed", async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    // Max attempts exhausted — park in DLQ with diagnostic metadata
    await dlq.add("exhausted", {
      originalJob: { name: job.name, data: job.data, id: job.id },
      error: err.message,
      failedAt: new Date().toISOString()
    });
    console.error(`[DLQ] Job ${job.id} moved to DLQ after ${job.attemptsMade} attempts`);
  }
});
```

> [!OUTPUT]
> [DLQ] Job 42 moved to DLQ after 5 attempts

## Idempotency: the safety net for retries

Retries are only safe if your processor is **idempotent** — running it twice produces the same result as running it once. Common techniques:

- **Idempotency key**: include a unique key in the job data and check whether the work was already done before doing it.
- **Upsert, not insert**: use `INSERT ... ON CONFLICT DO NOTHING` or `updateOne({ upsert: true })`.
- **State machine**: record the job's progress in the database so a re-run knows where to resume.

```js
async function sendWelcomeEmail(job) {
  const alreadySent = await db.emails.findOne({ idempotencyKey: job.data.key });
  if (alreadySent) {
    console.log("email already sent, skipping");
    return; // safe to return — result is the same
  }
  await mailer.send(job.data);
  await db.emails.insertOne({ idempotencyKey: job.data.key, sentAt: new Date() });
}
```

> [!NOTE] BullMQ job IDs as idempotency keys
> You can pass `{ jobId: "unique-key" }` when adding a job. BullMQ will refuse to enqueue a duplicate job with the same ID that is still active or waiting — effectively deduplicating at the queue level. This is a cheap first-line defence.

## Try it yourself

This runnable block implements exponential backoff with jitter from scratch and wraps it in a retry function that moves work to a DLQ array after max attempts — all pure JavaScript, no Redis.

```js run
// --- Backoff calculator ---
function jitteredBackoff(attempt, base = 200, maxDelay = 5000) {
  const cap = Math.min(base * Math.pow(2, attempt - 1), maxDelay);
  return Math.random() * cap;
}

// --- DLQ ---
const deadLetterQueue = [];

// --- Retry wrapper ---
async function withRetry(name, fn, data, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(data);
      console.log(`[OK]  "${name}" succeeded on attempt ${attempt}:`, result);
      return result;
    } catch (err) {
      if (err.permanent) {
        console.log(`[DLQ] "${name}" has a permanent error — no retry:`, err.message);
        deadLetterQueue.push({ name, data, error: err.message, attempt });
        return;
      }
      const wait = jitteredBackoff(attempt);
      console.log(`[RETRY] "${name}" attempt ${attempt} failed (${err.message}), retrying in ${wait.toFixed(0)} ms`);
      if (attempt === maxAttempts) {
        console.log(`[DLQ] "${name}" exhausted ${maxAttempts} attempts`);
        deadLetterQueue.push({ name, data, error: err.message, attempt });
        return;
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// --- Simulate a flaky operation that fails twice then succeeds ---
let callCount = 0;
async function flakyService(data) {
  callCount++;
  if (callCount < 3) throw new Error("upstream timeout");
  return `processed: ${data.id}`;
}

// --- Simulate a permanently failing operation ---
async function permanentFailure(data) {
  const err = new Error("invalid payload schema");
  err.permanent = true;
  throw err;
}

await withRetry("flaky-job", flakyService, { id: 99 });
callCount = 0; // reset for clarity

await withRetry("bad-job", permanentFailure, { id: 7 });

console.log("\nDead-letter queue contents:");
deadLetterQueue.forEach(entry =>
  console.log(` - ${entry.name} | ${entry.error}`)
);
```

## Exercise

**Challenge:** Modify the retry wrapper so it uses a **capped exponential** backoff (no jitter) and prints the delay for each retry attempt, showing how delays grow geometrically then plateau.

<details>
<summary>Show solution</summary>

```js run
function cappedExponentialBackoff(attempt, base = 100, maxDelay = 800) {
  return Math.min(base * Math.pow(2, attempt - 1), maxDelay);
}

async function withCappedRetry(name, fn, data, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(data);
      console.log(`[OK] "${name}" succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      const wait = cappedExponentialBackoff(attempt);
      console.log(`[RETRY] attempt ${attempt}/${maxAttempts} — waiting ${wait} ms`);
      if (attempt === maxAttempts) {
        console.log(`[DLQ] "${name}" moved to dead-letter queue`);
        return;
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

let n = 0;
async function alwaysFails() {
  n++;
  throw new Error(`transient error #${n}`);
}

await withCappedRetry("stubborn-job", alwaysFails, {});
// Delays: 100, 200, 400, 800 (capped) — geometric then flat
```

Notice how the delays double each time until they hit the 800 ms cap. In production you would replace the `await new Promise` with the actual next-attempt scheduling mechanism your queue provides.

</details>

## Common pitfalls

> [!PITFALL] Unbounded retries with no DLQ
> Setting `attempts: Infinity` or very large numbers without a DLQ guarantees that a bad job will clog a queue slot indefinitely. Always pair a finite `maxAttempts` with a DLQ. Failing visibly is far better than failing silently forever.

> [!PITFALL] Not distinguishing error types before retrying
> Retrying a `400 Bad Request` or a schema validation error wastes compute and delays detection of bugs. Classify errors at the catch site — use custom error classes or HTTP status codes — and throw `UnrecoverableError` (or equivalent) for permanent failures.

## What you learned

- **Transient** failures should be retried; **permanent** failures should be moved to a dead-letter queue immediately.
- **Exponential backoff** grows the delay geometrically between retries; **full jitter** (`Math.random() * delay`) prevents thundering-herd retry storms.
- A **dead-letter queue** preserves exhausted jobs so engineers can inspect, fix, and replay them rather than lose them silently.
- **Idempotency** (unique keys, upserts, state machines) makes retries safe — the same operation can run multiple times without harmful side effects.

## Next steps

You have reliable retry mechanics. Next we zoom out to the broader ecosystem: how RabbitMQ, Kafka, and NATS differ in their messaging models, and when to pick each.
*/});
