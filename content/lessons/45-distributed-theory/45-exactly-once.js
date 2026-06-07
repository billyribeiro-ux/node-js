registerLessonSrc("45-exactly-once", function () {/*
---
id: 45-exactly-once
title: "Idempotency, the Outbox & Exactly-Once Myths"
minutes: 30
level: advanced
objectives:
  - Explain why exactly-once delivery is impossible and how exactly-once effects are achieved
  - Design an idempotency key + dedup window pattern for safe at-least-once consumers
  - Implement the transactional outbox and inbox patterns with Node.js
---

# Idempotency, the Outbox & Exactly-Once Myths

## Why this matters

"We guarantee exactly-once delivery" is one of the most dangerous lies in distributed systems marketing. Every message broker — Kafka, SQS, RabbitMQ, Kinesis — is at-least-once under some failure conditions. Exactly-once *delivery* is provably impossible in a system where the sender does not know if the receiver crashed after processing but before acknowledging. But exactly-once *effects* — ensuring a payment is charged once, an email is sent once — are achievable through careful design. The Transactional Outbox and idempotent consumers are the production-grade patterns that make this work.

## Learning objectives

- State precisely why exactly-once delivery is impossible in any real message system.
- Implement idempotency keys with a dedup store and TTL window.
- Design a transactional outbox that atomically links a business write with event publication.
- Explain 2PC vs sagas and when each applies for distributed transactions.

## Why Exactly-Once Delivery is Impossible

Consider the simplest case: producer P sends a message M to consumer C. C processes M (charges a credit card) and then needs to acknowledge receipt to P (so P can stop retrying).

Between "C processes M" and "C sends ACK to P" the network can fail, C can crash, or P can time out. P retries, sending M again. C must now detect the duplicate.

This is the **Two Generals Problem** variant: there is no protocol that can guarantee both delivery and exactly-once processing with a faulty channel and no shared durable state between P and C. The academic result: in an asynchronous system with crash-stop failures, there is no protocol with exactly-once delivery guarantees without shared persistent state visible to both sides.

Even Kafka's "exactly-once semantics" (EOS) — which it has had since 0.11 — works only within the Kafka ecosystem: producer dedup (sequence numbers + producer ID) prevents duplicate records in the broker, and transactions allow atomic read-commit-write within Kafka. The moment you consume a Kafka message and write to an external database, you are back to at-least-once unless *you* implement idempotent consumers.

> [!PRINCIPAL]
> Exactly-once semantics in Kafka use three mechanisms together: (1) **idempotent producers** — each message gets a sequence number; the broker deduplicates retries from the same producer session; (2) **transactions** — a producer can atomically publish to multiple partitions, visible only on commit; (3) **read-process-write EOS** — consume, process, and produce to Kafka atomically within one transaction. The transaction coordinator uses a two-phase commit internally. None of this helps when your "process" step writes to PostgreSQL or calls a REST API — that's your responsibility.

## Idempotency Keys

An **idempotency key** is a client-generated unique ID attached to a request or message. The server checks: "have I processed a request with this key?" If yes, return the same response without re-processing. If no, process and record.

Requirements for the dedup store:
1. The "record" step must be **atomic with the processing** — write the key and execute the side effect in the same transaction (or use an outbox to link them).
2. Keys must have a **TTL** (dedup window). After the window expires, a reused key is treated as a new request. Common windows: 24 hours (Stripe), 7 days (Braintree).
3. The store must be **durable** — an in-memory cache loses keys on restart, allowing duplicate processing after crash recovery.

```js
// Node.js: idempotent charge endpoint using node:sqlite (Node 24 built-in)
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

async function idempotentCharge(idempotencyKey, amount, customerId) {
  // Prune expired keys first
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  db.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").run(cutoff);

  // Check existing
  const existing = db.prepare(
    "SELECT response FROM idempotency_keys WHERE key = ?"
  ).get(idempotencyKey);

  if (existing) {
    return { cached: true, ...JSON.parse(existing.response) };
  }

  // Process (call Stripe, update ledger, etc.)
  const chargeResult = { chargeId: "ch_" + Math.random().toString(36).slice(2), amount, customerId };

  // Record atomically (in real code: within the same DB transaction as the ledger update)
  db.prepare(
    "INSERT INTO idempotency_keys (key, response, created_at) VALUES (?, ?, ?)"
  ).run(idempotencyKey, JSON.stringify(chargeResult), Date.now());

  return { cached: false, ...chargeResult };
}
```

> [!OUTPUT]
> // First call: processes and stores
> { cached: false, chargeId: 'ch_abc123', amount: 99, customerId: 'cus_1' }
> // Retry with same key: returns stored response
> { cached: true, chargeId: 'ch_abc123', amount: 99, customerId: 'cus_1' }

## The Transactional Outbox

The core problem: you want to update a database record *and* publish an event atomically. If the publish happens before the DB commit and the transaction rolls back, you have a ghost event. If the DB commits and then the publish fails, you have a lost event.

The **Transactional Outbox** pattern solves this with a single atomic write:

1. In the same database transaction as your business write, insert a row into an **outbox table**.
2. A separate relay process (or Debezium CDC connector) polls the outbox table (or tails the WAL) and publishes events to the message broker.
3. On successful publish, the relay deletes or marks the outbox row as sent.
4. The relay uses idempotency keys when publishing so that retried publishes are deduplicated at the broker.

```js
// Transactional outbox write (Node.js + node:sqlite)
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT, amount INTEGER);
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    aggregate_type TEXT,
    aggregate_id TEXT,
    event_type TEXT,
    payload TEXT,
    created_at INTEGER,
    published INTEGER DEFAULT 0
  );
`);

function placeOrder(orderId, amount) {
  // Single DB transaction: business write + outbox write
  db.prepare("BEGIN").run();
  try {
    db.prepare("INSERT INTO orders VALUES (?, 'pending', ?)").run(orderId, amount);
    db.prepare(`
      INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at)
      VALUES (?, 'Order', ?, 'OrderPlaced', ?, ?)
    `).run(
      crypto.randomUUID(),
      orderId,
      JSON.stringify({ orderId, amount, status: "pending" }),
      Date.now()
    );
    db.prepare("COMMIT").run();
    return { success: true };
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }
}

// Relay: polls outbox, publishes, marks sent
function relayOutbox(publish) {
  const rows = db.prepare(
    "SELECT * FROM outbox WHERE published = 0 ORDER BY created_at LIMIT 100"
  ).all();

  for (const row of rows) {
    try {
      publish(row.event_type, JSON.parse(row.payload)); // idempotent at broker
      db.prepare("UPDATE outbox SET published = 1 WHERE id = ?").run(row.id);
    } catch (err) {
      // Leave unpublished; relay retries on next poll
      console.error("Relay error for", row.id, err.message);
    }
  }
}
```

> [!OUTPUT]
> // placeOrder("ord_1", 99) succeeds: order inserted + outbox row inserted atomically
> // relay picks up unpublished row, publishes to broker, marks published=1
> // On crash between publish and mark: relay retries, broker deduplicates via message id

### Transactional Inbox

The inbox pattern is the consumer-side complement: before processing a message, insert its ID into an **inbox table** in the same transaction as your business write. If the consumer crashes after processing but before ACKing, the redelivered message is detected by the inbox check and skipped.

## 2PC vs Sagas

When a business operation spans multiple services (place order → reserve inventory → charge card), you need a distributed transaction strategy.

**Two-Phase Commit (2PC):**
A coordinator sends Prepare to all participants. All must vote Yes to proceed. Coordinator then sends Commit. If any vote No or time out, coordinator sends Abort. Provides atomicity across services but:
- Blocking: if coordinator crashes after Prepare and before Commit, all participants block indefinitely.
- Tight coupling: all participants must be online and reachable.
- Not widely supported across heterogeneous systems.

2PC is used in: XA transactions (Java EE), some databases for cross-shard transactions, Kafka's internal EOS coordinator. It's appropriate when all participants support XA, you have low latency requirements, and you can tolerate the coordinator as an SPOF.

**Sagas:**
A saga is a sequence of local transactions, each publishing an event that triggers the next. If any step fails, previously completed steps are undone by **compensating transactions**. Two variants:
- **Choreography**: each service listens for events and decides its own next step. Decoupled but hard to trace.
- **Orchestration**: a saga orchestrator sends commands to services and handles their replies. Explicit control flow, easier to monitor.

Sagas do not provide isolation: intermediate states are visible. You compensate rather than prevent. Design compensating actions for every step that can succeed (charge card → refund card).

> [!PRINCIPAL]
> 2PC is rarely the right answer in modern microservices. The blocking-coordinator failure mode is too dangerous in async cloud environments. Sagas, combined with outbox/inbox patterns for reliable messaging, give you eventual atomicity without distributed locks. The practical tradeoff: sagas allow dirty reads of intermediate states — if this is unacceptable (e.g., a seat booking where two users must not both see a seat as "available"), you need either 2PC, a saga with a reservation step and a confirm/cancel step (like Stripe's PaymentIntent), or explicit UI-level compensation.

## Try it yourself

An idempotent consumer with a dedup store that processes duplicate messages exactly once.

```js run
// Idempotent consumer with dedup store (pure browser JS — Map-based)

class DedupStore {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.store = new Map(); // key -> { result, expiresAt }
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.result;
  }
  set(key, result) {
    this.store.set(key, { result, expiresAt: Date.now() + this.ttlMs });
  }
  size() { return this.store.size; }
}

// Simulated "process message" side effect — tracks actual invocations
let processedCount = 0;
function processMessage(payload) {
  processedCount++;
  return { status: "charged", amount: payload.amount, invokeCount: processedCount };
}

// Idempotent consumer
class IdempotentConsumer {
  constructor(dedupTtlMs) {
    this.dedup = new DedupStore(dedupTtlMs);
    this.results = [];
  }

  consume(messageId, payload) {
    const cached = this.dedup.get(messageId);
    if (cached) {
      this.results.push({ messageId, duplicate: true, result: cached });
      return cached;
    }
    const result = processMessage(payload);
    this.dedup.set(messageId, result);
    this.results.push({ messageId, duplicate: false, result });
    return result;
  }
}

// Simulate at-least-once delivery: some messages delivered 2-3 times
const consumer = new IdempotentConsumer(60_000); // 60s TTL

const messages = [
  { id: "msg-001", payload: { amount: 99 } },
  { id: "msg-002", payload: { amount: 50 } },
  { id: "msg-001", payload: { amount: 99 } }, // duplicate delivery
  { id: "msg-003", payload: { amount: 25 } },
  { id: "msg-002", payload: { amount: 50 } }, // duplicate delivery
  { id: "msg-001", payload: { amount: 99 } }, // triple delivery
];

console.log("=== Processing messages (at-least-once delivery) ===");
for (const { id, payload } of messages) {
  const r = consumer.consume(id, payload);
  const entry = consumer.results[consumer.results.length - 1];
  console.log(`${id}: ${entry.duplicate ? "DUPLICATE (skipped)" : "PROCESSED"} -> invokeCount=${r.invokeCount}`);
}

console.log(`\nUnique messages: 3`);
console.log(`Total deliveries: ${messages.length}`);
console.log(`Actual processing invocations: ${processedCount} (expected: 3)`);
console.log(`Dedup store size: ${consumer.dedup.size()}`);

// Verify: each unique message processed exactly once
const uniqueResults = new Map(consumer.results.filter(r => !r.duplicate).map(r => [r.messageId, r.result]));
console.log("\nUnique results:");
for (const [id, result] of uniqueResults) {
  console.log(` ${id}: amount=${result.amount} (invoke #${result.invokeCount})`);
}
```

## Exercise: Design the outbox for a payment service

A `PaymentService` places an order in a PostgreSQL `payments` table and must also publish a `payment.created` event to Kafka. Sketch the outbox schema and relay logic. What happens if the relay crashes between "publish to Kafka" and "mark as sent"?

<details>
<summary>Show solution</summary>

```js run
// Outbox schema (conceptual) and relay idempotency analysis

const outboxSchema = `
  CREATE TABLE outbox (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    sent_at     TIMESTAMPTZ,             -- null = not yet sent
    idempotency_key TEXT UNIQUE          -- used as Kafka message key for broker dedup
  );
`;

// The relay process
function relay(db, kafkaProducer) {
  // 1. Fetch batch of unsent rows (with SELECT FOR UPDATE SKIP LOCKED for concurrent relays)
  // 2. Publish each to Kafka using the outbox row id as the idempotency/deduplication key
  // 3. Mark sent_at
  // If crash between step 2 and step 3:
  //   - On restart, relay finds the row still unsent
  //   - Re-publishes to Kafka with the same idempotency key
  //   - Kafka broker or consumer deduplicates using that key
  //   - Marks sent_at
  console.log("Relay logic (idempotent publish via outbox row id):");
  console.log("  SELECT ... WHERE sent_at IS NULL FOR UPDATE SKIP LOCKED");
  console.log("  for each row: kafka.produce({ key: row.id, value: row.payload })");
  console.log("  UPDATE outbox SET sent_at = now() WHERE id = row.id");
  console.log("\nCrash recovery: row remains unsent -> re-published with same key -> deduplicated");
  console.log("Consumer uses inbox table: INSERT INTO inbox (msg_id) ON CONFLICT DO NOTHING");
  console.log("  -> if conflict: skip; else: process + commit atomically");
}

relay(null, null);
```

The key insight: the relay is idempotent because it publishes with a stable key (the outbox row UUID). The consumer is idempotent because it uses an inbox table keyed by message ID. Neither side needs distributed coordination — just two local atomic writes.

</details>

## Project

**Portfolio project: Exactly-Once-Effectively Pipeline**

Build a system demonstrating exactly-once-effective processing across three components: a Raft-style leader election state machine (from lesson 45-consensus), a CRDT state store (from lesson 45-clocks-crdts), and an idempotent consumer pipeline with outbox/inbox semantics.

**Acceptance criteria:**

1. **Raft leader election** — Implement a 5-node Raft state machine (follower/candidate/leader transitions, term tracking, vote granting with log-up-to-date check). Simulate a leader failure and verify a new leader is elected without split-brain.
2. **CRDT state** — Implement a PN-Counter CRDT that tracks message processing counts across 3 replicas. After simulated partition and heal, verify all replicas converge to the same total via merge.
3. **Idempotent consumer** — Implement an `IdempotentConsumer` class with a persistent dedup store (use `node:sqlite` with `DatabaseSync`). Process a stream of 100 messages where 30% are duplicates. Verify exactly 70 unique side effects occur.
4. **Transactional outbox** — Implement `placeOrder(orderId, amount)` using a SQLite transaction that atomically writes to an `orders` table and an `outbox` table. Simulate a relay that publishes outbox events and marks them sent.
5. **Inbox deduplication** — Implement a consumer that writes message IDs to an `inbox` table (`ON CONFLICT DO NOTHING` semantics) before processing. Verify that re-delivered messages are skipped.
6. **End-to-end trace** — Run a scenario: leader is elected, leader receives a client command, command goes through outbox, consumer processes it, CRDT is updated, duplicate delivery is detected by inbox. Print a trace log showing each step.

**Starter (pure-JS core — the idempotent consumer engine):**

```js run
// Starter: idempotent consumer engine + PN-Counter CRDT for tracking
// Extend this for the full project

// --- PN-Counter CRDT ---
function pnCreate(nodes) {
  return { p: Object.fromEntries(nodes.map(n=>[n,0])), n: Object.fromEntries(nodes.map(n=>[n,0])) };
}
function pnInc(pn, node) { return { ...pn, p: { ...pn.p, [node]: pn.p[node]+1 } }; }
function pnDec(pn, node) { return { ...pn, n: { ...pn.n, [node]: pn.n[node]+1 } }; }
function pnVal(pn) {
  return Object.values(pn.p).reduce((a,b)=>a+b,0) - Object.values(pn.n).reduce((a,b)=>a+b,0);
}
function pnMerge(a, b) {
  const keys = new Set([...Object.keys(a.p), ...Object.keys(b.p)]);
  const p = {}, n = {};
  for (const k of keys) { p[k] = Math.max(a.p[k]||0, b.p[k]||0); n[k] = Math.max(a.n[k]||0, b.n[k]||0); }
  return { p, n };
}

// --- Dedup store (Map-backed for browser) ---
class DedupStore {
  constructor(ttlMs) { this.ttlMs = ttlMs; this.store = new Map(); }
  has(key) {
    const e = this.store.get(key);
    if (!e) return false;
    if (Date.now() > e.exp) { this.store.delete(key); return false; }
    return true;
  }
  set(key) { this.store.set(key, { exp: Date.now() + this.ttlMs }); }
}

// --- Idempotent consumer ---
class IdempotentConsumer {
  constructor(nodeId, dedupTtlMs) {
    this.nodeId = nodeId;
    this.dedup = new DedupStore(dedupTtlMs);
    this.crdt = pnCreate(["node0","node1","node2"]);
    this.log = [];
  }
  process(msgId, payload) {
    if (this.dedup.has(msgId)) {
      this.log.push(`SKIP duplicate ${msgId}`);
      return { duplicate: true };
    }
    // Side effect
    this.crdt = pnInc(this.crdt, this.nodeId);
    this.dedup.set(msgId);
    this.log.push(`PROCESS ${msgId}: amount=${payload.amount} totalProcessed=${pnVal(this.crdt)}`);
    return { duplicate: false, crdt: this.crdt };
  }
}

// Simulate 10 messages with 40% duplicate rate
const consumer = new IdempotentConsumer("node0", 60_000);
const msgs = [];
for (let i = 0; i < 7; i++) msgs.push({ id: `msg-${i}`, amount: 10*(i+1) });
// add duplicates
msgs.push({ id: "msg-2", amount: 30 });
msgs.push({ id: "msg-5", amount: 60 });
msgs.push({ id: "msg-0", amount: 10 });

for (const m of msgs) consumer.process(m.id, m);
consumer.log.forEach(l => console.log(l));
console.log(`\nFinal CRDT value (unique processed): ${pnVal(consumer.crdt)}`);
console.log(`Total deliveries: ${msgs.length}, Unique: 7, Duplicates: 3`);
```

## Common pitfalls

> [!PITFALL]
> Using a cache (Redis, Memcached) as your dedup store without persistence. If the cache is flushed, evicted, or the pod restarts, duplicate messages sail through. The dedup window must survive restarts. Use a database table with a TTL index, or Redis with AOF persistence and a careful key expiry policy. Always test your dedup logic with a simulated restart.

> [!PITFALL]
> Forgetting that saga compensations must also be idempotent. If your "refund charge" compensating transaction is retried (because the saga orchestrator crashed), you must not double-refund. Apply idempotency keys to compensating transactions just as you do to forward transactions.

## What you learned

- Exactly-once delivery is impossible in any async system with faulty channels; exactly-once *effects* are achievable with idempotency keys and dedup stores.
- Idempotency keys must be recorded atomically with the side effect — use the same DB transaction or the outbox pattern.
- The transactional outbox atomically links a business write with event publication; the relay is idempotent; the consumer uses an inbox table.
- Kafka EOS provides exactly-once within Kafka; external effects still require idempotent consumers.
- Sagas with compensating transactions provide distributed atomicity without 2PC's blocking-coordinator risk.

## Next steps

You now have the full distributed systems theory toolkit: consistency models, consensus, logical clocks, CRDTs, and exactly-once effects. Apply these patterns together in your next distributed system design review — and in the portfolio project above.
*/});
