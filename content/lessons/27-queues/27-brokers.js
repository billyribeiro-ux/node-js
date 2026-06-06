registerLessonSrc("27-brokers", function () {/*
---
id: 27-brokers
title: "Brokers: RabbitMQ, Kafka & NATS"
minutes: 28
level: principal
objectives:
  - Contrast the queue, partitioned-log, and pub/sub messaging models
  - Explain how RabbitMQ exchanges, Kafka consumer groups, and NATS subjects work
  - Model a partitioned log with consumer-group offset tracking in pure JavaScript
---

# Brokers: RabbitMQ, Kafka & NATS

## Why this matters

BullMQ + Redis is excellent for background jobs on a single team's service. But once you are building a platform — multiple services, millions of events per second, or strict audit-log requirements — you need to choose a **message broker** whose data model matches your problem. The wrong choice is expensive to undo: rewriting a Kafka consumer as a RabbitMQ listener touches every service in the topology. Understanding the fundamental differences between queues, logs, and subjects saves months of rework.

## Learning objectives

- Distinguish the three core messaging models: **queue** (RabbitMQ), **partitioned log** (Kafka), **subject/pub-sub** (NATS).
- Describe how RabbitMQ exchanges route messages, how Kafka consumer groups track offsets, and how NATS achieves low latency.
- Make an informed broker choice given throughput, durability, and replay requirements.

## The three models

### Model 1 — Queue (RabbitMQ / AMQP)

A **queue** holds messages until a consumer pops and acknowledges them. Once acknowledged, the message is gone. Multiple consumers on the same queue **compete** — each message is delivered to exactly one of them (work-queue semantics). Consumers on *different* queues bound to the same **exchange** each receive a copy (pub-sub semantics).

RabbitMQ's killer feature is its **exchange** layer. Producers send to an exchange, not a queue. Exchanges apply routing rules:

- `direct` — route by exact routing key (`billing.invoice.created`).
- `topic` — route by pattern (`billing.#` matches all billing events).
- `fanout` — broadcast to all bound queues regardless of key.
- `headers` — route by message header attributes.

```js
// rabbitmq-producer.js  (requires amqplib)
import amqp from "amqplib";

const conn = await amqp.connect("amqp://localhost");
const ch = await conn.createChannel();

await ch.assertExchange("events", "topic", { durable: true });

// This message is routed to any queue bound with "billing.*" or "#"
ch.publish("events", "billing.invoice.created", Buffer.from(JSON.stringify({
  invoiceId: "inv-001",
  amount: 4900,
  currency: "USD"
})), { persistent: true });

await ch.close();
await conn.close();
```

> [!OUTPUT]
> (message silently stored in exchange; routed to matching queues)

```js
// rabbitmq-consumer.js  (requires amqplib)
import amqp from "amqplib";

const conn = await amqp.connect("amqp://localhost");
const ch = await conn.createChannel();

await ch.assertExchange("events", "topic", { durable: true });
const { queue } = await ch.assertQueue("billing-service", { durable: true });
await ch.bindQueue(queue, "events", "billing.#");

ch.consume(queue, (msg) => {
  const data = JSON.parse(msg.content.toString());
  console.log("received:", data);
  ch.ack(msg); // remove from queue only after successful processing
});
```

> [!OUTPUT]
> received: { invoiceId: 'inv-001', amount: 4900, currency: 'USD' }

### Model 2 — Partitioned Log (Kafka)

Kafka is not a queue — it is an **append-only log** partitioned across brokers. Messages (called *records*) are never deleted on consumption; they stay for a configurable retention period (days, weeks, forever). Consumers track their position in the log using an **offset**, a monotonically increasing integer.

Key concepts:

- **Topic** — a named log, split into one or more **partitions** for parallelism.
- **Partition** — an ordered, immutable sequence of records. Ordering is guaranteed *within* a partition.
- **Consumer group** — a set of consumers that collectively consume a topic. Each partition is assigned to exactly one consumer in the group. Two groups read the same topic independently — the same record is delivered to each group.
- **Offset** — the consumer's cursor in a partition. Committed to Kafka (or managed externally) so consumers can resume after a crash.

```js
// kafka-producer.js  (requires kafkajs)
import { Kafka } from "kafkajs";

const kafka = new Kafka({ clientId: "my-app", brokers: ["localhost:9092"] });
const producer = kafka.producer();
await producer.connect();

await producer.send({
  topic: "user-events",
  messages: [
    { key: "user-42", value: JSON.stringify({ event: "signed_up", ts: Date.now() }) },
    { key: "user-43", value: JSON.stringify({ event: "signed_up", ts: Date.now() }) }
  ]
});
await producer.disconnect();
```

> [!OUTPUT]
> (records appended to partition; offset incremented)

```js
// kafka-consumer.js  (requires kafkajs)
import { Kafka } from "kafkajs";

const kafka = new Kafka({ clientId: "my-app", brokers: ["localhost:9092"] });
const consumer = kafka.consumer({ groupId: "analytics-service" });

await consumer.connect();
await consumer.subscribe({ topic: "user-events", fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const data = JSON.parse(message.value.toString());
    console.log(`[partition ${partition}] offset ${message.offset}:`, data);
    // offset is committed automatically after eachMessage resolves
  }
});
```

> [!OUTPUT]
> [partition 0] offset 0: { event: 'signed_up', ts: 1748995200000 }
> [partition 1] offset 0: { event: 'signed_up', ts: 1748995200001 }

### Model 3 — Subjects / Pub-Sub (NATS)

NATS is a **lightweight, cloud-native** messaging system built for low latency (sub-millisecond) and high simplicity. Messages are sent to **subjects** (dot-separated strings like `billing.invoice.created`). Subscribers express interest with exact subjects or wildcards (`billing.*`, `billing.>`).

NATS Core is fire-and-forget: if no subscriber is online, the message is dropped. **NATS JetStream** adds persistence, consumer groups, and at-least-once delivery — the features that make it competitive with Kafka for many workloads.

```js
// nats-example.js  (requires nats)
import { connect, StringCodec } from "nats";

const nc = await connect({ servers: "nats://localhost:4222" });
const sc = StringCodec();

// Subscriber
const sub = nc.subscribe("events.>");
(async () => {
  for await (const msg of sub) {
    console.log(`[${msg.subject}]`, sc.decode(msg.data));
  }
})();

// Publisher
nc.publish("events.user.created", sc.encode(JSON.stringify({ userId: 1 })));
nc.publish("events.order.placed", sc.encode(JSON.stringify({ orderId: 99 })));

await nc.drain(); // flush and close
```

> [!OUTPUT]
> [events.user.created] {"userId":1}
> [events.order.placed] {"orderId":99}

## Broker comparison at a glance

| | RabbitMQ | Kafka | NATS (JetStream) |
|---|---|---|---|
| Model | Queue + exchange routing | Partitioned append-only log | Subject pub/sub + streams |
| Message retention | Until acknowledged | Time- or size-based (indefinite) | Configurable per stream |
| Replay | No (messages deleted on ack) | Yes — seek any offset | Yes (JetStream) |
| Ordering | Per queue | Per partition | Per subject/stream |
| Throughput | ~50k msg/s | Millions/s | ~1M msg/s |
| Latency | Very low (~1 ms) | Low (5-50 ms batching) | Ultra-low (<1 ms) |
| Consumer groups | Competing consumers per queue | Native — offsets tracked per group | JetStream push/pull consumers |
| Best for | Task routing, RPC, flexible topologies | Event sourcing, audit log, analytics | IoT, microservices, low-latency |
| Complexity | Medium | High (Zookeeper/KRaft, tuning) | Low |

> [!PRINCIPAL] Choose by data model, not popularity
> The single most important question is: **do consumers need to replay messages?** If yes, reach for Kafka or NATS JetStream — they are logs, not queues, and replay is a first-class feature. If each message should be processed once and forgotten, RabbitMQ's AMQP model is simpler to operate. A common mistake is choosing Kafka for task queues (where deletion-on-ack is fine) because it "scales better" — you inherit Kafka's operational complexity with none of its unique benefits.

## Try it yourself

Here we model a **partitioned log with consumer-group offset tracking** — the core Kafka abstraction — in pure JavaScript. No broker needed; the mechanics are identical.

```js run
// Partitioned log with consumer-group offset tracking

function createPartitionedLog(numPartitions = 3) {
  // Each partition is an ordered array of records
  const partitions = Array.from({ length: numPartitions }, () => []);

  // Route by key hash (like Kafka's default partitioner)
  function partitionFor(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(hash) % numPartitions;
  }

  return {
    // Producer: append a record
    produce(key, value) {
      const p = partitionFor(key);
      const offset = partitions[p].length;
      partitions[p].push({ key, value, offset });
      return { partition: p, offset };
    },

    // Consumer: read records from a partition starting at a given offset
    consume(partition, fromOffset, limit = 10) {
      return partitions[partition].slice(fromOffset, fromOffset + limit);
    },

    stats() {
      return partitions.map((p, i) => `partition ${i}: ${p.length} records`);
    }
  };
}

// Consumer group tracks one offset per partition
function createConsumerGroup(log, numPartitions, groupId) {
  const offsets = new Array(numPartitions).fill(0);

  return {
    // Poll all partitions, process, then advance offsets
    poll(handler) {
      let total = 0;
      for (let p = 0; p < numPartitions; p++) {
        const records = log.consume(p, offsets[p]);
        for (const record of records) {
          handler(p, record);
          offsets[p] = record.offset + 1; // commit offset
          total++;
        }
      }
      return total;
    },
    offsets: () => [...offsets]
  };
}

// --- Demo ---
const log = createPartitionedLog(3);

// Produce events — same key always goes to same partition
const events = [
  ["user-1", "signed_up"],
  ["user-2", "signed_up"],
  ["user-1", "purchased"],
  ["user-3", "signed_up"],
  ["user-2", "purchased"],
  ["user-1", "referred"]
];

for (const [key, value] of events) {
  const { partition, offset } = log.produce(key, value);
  console.log(`produced [${key}] "${value}" -> partition ${partition}, offset ${offset}`);
}

console.log("\nLog stats:", log.stats());

// Two independent consumer groups
const analytics = createConsumerGroup(log, 3, "analytics");
const billing   = createConsumerGroup(log, 3, "billing");

console.log("\n--- analytics group polling ---");
analytics.poll((partition, record) =>
  console.log(`  [p${partition}@${record.offset}] ${record.key}: ${record.value}`)
);

// Billing only cares about "purchased" events
console.log("\n--- billing group polling (purchased only) ---");
billing.poll((partition, record) => {
  if (record.value === "purchased")
    console.log(`  [p${partition}@${record.offset}] ${record.key}: ${record.value}`);
});

console.log("\nanalytics offsets:", analytics.offsets());
console.log("billing offsets:  ", billing.offsets());
// Both groups consumed ALL records; billing just filtered some
// Key insight: same records, two independent cursors
```

## Exercise

**Challenge 1:** Add a second poll call for `analytics` — it should receive zero new records since all offsets were already committed. Then produce two more events and poll again — only the new records should appear.

<details>
<summary>Show solution</summary>

```js run
function createPartitionedLog(numPartitions = 2) {
  const partitions = Array.from({ length: numPartitions }, () => []);
  function partitionFor(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(h) % numPartitions;
  }
  return {
    produce(key, value) {
      const p = partitionFor(key);
      const offset = partitions[p].length;
      partitions[p].push({ key, value, offset });
      return { partition: p, offset };
    },
    consume(partition, fromOffset, limit = 10) {
      return partitions[partition].slice(fromOffset, fromOffset + limit);
    }
  };
}

function createConsumerGroup(log, numPartitions) {
  const offsets = new Array(numPartitions).fill(0);
  return {
    poll(handler) {
      let count = 0;
      for (let p = 0; p < numPartitions; p++) {
        const records = log.consume(p, offsets[p]);
        for (const r of records) { handler(p, r); offsets[p] = r.offset + 1; count++; }
      }
      return count;
    }
  };
}

const log = createPartitionedLog(2);
log.produce("user-1", "signed_up");
log.produce("user-2", "signed_up");

const group = createConsumerGroup(log, 2);
console.log("First poll:");
group.poll((p, r) => console.log(`  p${p}@${r.offset}: ${r.key}=${r.value}`));

console.log("Second poll (should be empty):");
const received = group.poll((p, r) => console.log(`  p${p}@${r.offset}: ${r.key}=${r.value}`));
console.log("  records received:", received); // 0

log.produce("user-1", "purchased");
log.produce("user-3", "signed_up");

console.log("Third poll (only new records):");
group.poll((p, r) => console.log(`  p${p}@${r.offset}: ${r.key}=${r.value}`));
```

</details>

## Project

**Build a distributed job-processing system with retries, priorities, and a live dashboard.**

Design and implement a self-contained Node.js application that simulates a multi-queue job-processing platform. The system should be realistic enough to demonstrate the core engineering tradeoffs you have learned in this module.

### Acceptance criteria

1. **Multiple named queues with priorities.** Support at least two queue types (e.g., `email` and `render`). Each queue accepts jobs with a numeric `priority` — higher priority jobs are processed first within the queue.
2. **Worker concurrency.** Each queue has a configurable `concurrency` setting. Workers pick up `concurrency` jobs at a time and process them in parallel (Promise-based concurrency, not sequential).
3. **Retries with exponential backoff and jitter.** Failed jobs are retried up to a configurable `maxAttempts`. Each retry waits an exponential-jittered delay before re-queuing.
4. **Dead-letter queue.** Jobs that exhaust all retry attempts are moved to a per-queue DLQ. The DLQ stores the original job data, the error, and the number of attempts made.
5. **Live dashboard.** A function `printDashboard()` prints the current state of all queues: waiting count, active count, completed count, DLQ count.
6. **Idempotency guard.** The system rejects duplicate job IDs that are still waiting or active, returning an error rather than enqueuing twice.

### Starter

```js run
// Priority queue + worker core — expand this into the full project

class PriorityJobQueue {
  constructor(name, { concurrency = 2, maxAttempts = 3 } = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.waiting = [];    // sorted highest-priority first
    this.active = new Set();
    this.completed = [];
    this.dlq = [];
    this.seenIds = new Set();
    this._nextId = 1;
  }

  add(jobName, data, { priority = 0, id } = {}) {
    const jobId = id || `${this.name}-${this._nextId++}`;
    if (this.seenIds.has(jobId)) {
      console.log(`[${this.name}] DUPLICATE rejected: ${jobId}`);
      return null;
    }
    this.seenIds.add(jobId);
    const job = { id: jobId, name: jobName, data, priority, attempts: 0 };
    this._insert(job);
    console.log(`[${this.name}] enqueued ${jobId} (p${priority})`);
    this._drain();
    return jobId;
  }

  _insert(job) {
    let i = this.waiting.length;
    while (i > 0 && this.waiting[i - 1].priority < job.priority) i--;
    this.waiting.splice(i, 0, job);
  }

  _jitteredDelay(attempt, base = 100, cap = 2000) {
    return Math.random() * Math.min(base * Math.pow(2, attempt - 1), cap);
  }

  _drain() {
    while (this.active.size < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      this.active.add(job.id);
      this._process(job);
    }
  }

  async _process(job) {
    job.attempts++;
    try {
      const result = await this.processor(job);
      this.active.delete(job.id);
      this.completed.push({ id: job.id, result });
      console.log(`[${this.name}] completed ${job.id}`);
    } catch (err) {
      this.active.delete(job.id);
      if (job.attempts >= this.maxAttempts) {
        this.dlq.push({ id: job.id, data: job.data, error: err.message, attempts: job.attempts });
        console.log(`[${this.name}] DLQ ${job.id} after ${job.attempts} attempts: ${err.message}`);
      } else {
        const wait = this._jitteredDelay(job.attempts);
        console.log(`[${this.name}] retry ${job.id} (attempt ${job.attempts}) in ${wait.toFixed(0)} ms`);
        setTimeout(() => { this._insert(job); this._drain(); }, wait);
        return; // don't drain here — timer will do it
      }
    }
    this._drain();
  }

  // Attach a processor function
  process(fn) { this.processor = fn; return this; }

  dashboard() {
    return {
      queue: this.name,
      waiting: this.waiting.length,
      active: this.active.size,
      completed: this.completed.length,
      dlq: this.dlq.length
    };
  }
}

// --- Wire up two queues ---
const emailQueue  = new PriorityJobQueue("email",  { concurrency: 2, maxAttempts: 3 });
const renderQueue = new PriorityJobQueue("render", { concurrency: 1, maxAttempts: 2 });

const delay = (ms) => new Promise(r => setTimeout(r, ms));

emailQueue.process(async (job) => {
  await delay(40 + Math.random() * 60);
  if (Math.random() < 0.3) throw new Error("SMTP timeout");
  return `email sent to ${job.data.to}`;
});

renderQueue.process(async (job) => {
  await delay(80 + Math.random() * 80);
  if (Math.random() < 0.4) throw new Error("render OOM");
  return `rendered ${job.data.file}`;
});

// Enqueue jobs with varying priorities
emailQueue.add("welcome",   { to: "ada@example.com"  }, { priority: 5 });
emailQueue.add("marketing", { to: "list@example.com" }, { priority: 1 });
emailQueue.add("alert",     { to: "ops@example.com"  }, { priority: 9 });

renderQueue.add("thumbnail", { file: "video.mp4"  }, { priority: 3 });
renderQueue.add("banner",    { file: "banner.png" }, { priority: 7 });

// Idempotency guard test
emailQueue.add("welcome", { to: "dup@example.com" }, { priority: 5, id: emailQueue.waiting[0]?.id });

function printDashboard(queues) {
  console.log("\n=== DASHBOARD ===");
  for (const q of queues) {
    const d = q.dashboard();
    console.log(`${d.queue.padEnd(8)} | waiting:${d.waiting} active:${d.active} done:${d.completed} dlq:${d.dlq}`);
  }
  console.log("=================\n");
}

await delay(800);
printDashboard([emailQueue, renderQueue]);
```

## Common pitfalls

> [!PITFALL] Treating Kafka as a task queue
> Kafka does not delete messages on consumption. If you use it for job queues without a compaction or deletion policy, the log grows forever and operational costs balloon. BullMQ + Redis is simpler and correct for task-queue semantics. Use Kafka where you need indefinite replay, audit trails, or fan-out to many independent consumer groups.

> [!PITFALL] No consumer group management for RabbitMQ scaling
> RabbitMQ queues are shared across consumers by default (competing consumers). If you add a new service that needs to *independently* process every message, you must bind a *new queue* to the exchange — you cannot share one queue between two logically separate services. Designing your exchange topology upfront saves painful queue-surgery later.

## What you learned

- **RabbitMQ** uses an exchange-and-queue model with rich routing (direct, topic, fanout) and at-most-once delivery-on-ack; messages are gone after acknowledgement.
- **Kafka** is an append-only partitioned log; consumer groups track offsets independently so every group can replay the full history.
- **NATS** offers ultra-low-latency pub/sub on subjects with wildcard routing; JetStream adds persistence and at-least-once delivery.
- Choose by data model: if consumers need replay choose a log (Kafka/NATS JetStream); if each message should be processed once and discarded, a queue (RabbitMQ/BullMQ) is simpler.
- A partitioned log guarantees ordering *within* a partition and scales throughput by adding partitions — but a key's records always land in the same partition, preserving per-entity order.

## Next steps

You have mastered the messaging layer. Next module explores gRPC and GraphQL — typed, schema-first communication protocols that bring structure to the service-to-service and client-to-server channels that sit alongside your message queues.
*/});
