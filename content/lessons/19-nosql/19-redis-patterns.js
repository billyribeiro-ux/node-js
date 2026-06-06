registerLessonSrc("19-redis-patterns", function () {/*
---
id: 19-redis-patterns
title: "Pub/Sub, Rate Limits & Distributed Locks"
minutes: 28
level: advanced
objectives:
  - Use Redis pub/sub to decouple services with real-time messaging
  - Implement token-bucket and sliding-window rate limiting
  - Acquire and safely release distributed locks with SET NX PX
---

# Pub/Sub, Rate Limits & Distributed Locks

## Why this matters

Once your system grows past a single process, you need ways for services to talk to each other without tight coupling, to enforce fair usage without a shared-memory mutex, and to coordinate actions that must happen exactly once across a fleet of nodes. Redis gives you all three in one place: **pub/sub** for event broadcasting, **atomic commands** for rate limiting, and **distributed locks** for mutual exclusion. Getting these patterns right is the difference between a system that holds up under load and one that falls apart in production.

## Learning objectives

- Build a publisher and subscriber with Redis pub/sub and understand its delivery guarantees.
- Implement a **token-bucket** rate limiter using Redis atomic operations.
- Implement a **sliding-window** rate limiter and compare the two approaches.
- Acquire a distributed lock with `SET NX PX` and understand Redlock caveats.
- Know when to use **Redis Streams** instead of basic pub/sub.

## Redis pub/sub

Redis pub/sub is a **fire-and-forget** broadcast mechanism. A publisher sends a message to a **channel**; all clients currently subscribed to that channel receive it. If no one is subscribed, the message is dropped. There is no persistence and no replay.

```
Publisher ──▶ PUBLISH orders.created "{ orderId: 99 }"
                    │
                    ▼
           Redis channel: orders.created
                    │
           ┌────────┴────────┐
           ▼                 ▼
     Subscriber A      Subscriber B
   (email service)  (analytics service)
```

```js
// publisher.mjs
import { createClient } from "redis";

const pub = createClient();
await pub.connect();

const order = { orderId: 99, userId: "u1", total: 49.99 };
const count = await pub.publish("orders.created", JSON.stringify(order));
console.log(`Message delivered to ${count} subscriber(s)`);
await pub.disconnect();
```

> [!OUTPUT]
> Message delivered to 2 subscriber(s)

```js
// subscriber.mjs — must use a SEPARATE client connection
import { createClient } from "redis";

const sub = createClient();
await sub.connect();

await sub.subscribe("orders.created", (message, channel) => {
  const order = JSON.parse(message);
  console.log(`[${channel}] New order #${order.orderId} — $${order.total}`);
  // trigger email, update analytics, etc.
});
```

> [!OUTPUT]
> [orders.created] New order #99 — $49.99

> [!NOTE] Subscriptions block the connection
> A Redis client that calls `subscribe` enters a special mode: it can only receive messages, not issue other commands. Always create **two separate client instances** — one for publishing, one for subscribing.

> [!PRINCIPAL] Pub/sub vs. Streams — the delivery guarantee gap
> Redis pub/sub has **at-most-once** delivery: if a subscriber is offline when a message is published, it is lost forever. **Redis Streams** (`XADD` / `XREADGROUP`) give you a persistent log with consumer groups, acknowledgements, and replay — closer to Kafka for simple use cases. For notifications where a missed event is acceptable (live dashboards, presence updates), pub/sub is perfect. For anything business-critical (order events, payment confirmations), use Streams or a dedicated message broker.

### Pattern channels with PSUBSCRIBE

You can subscribe to multiple channels matching a glob pattern:

```js
// Subscribe to all order events
await sub.pSubscribe("orders.*", (message, channel) => {
  console.log(`Event on ${channel}:`, JSON.parse(message));
});
// Matches: orders.created, orders.shipped, orders.cancelled, ...
```

> [!OUTPUT]
> Event on orders.shipped: { orderId: 99, carrier: 'UPS' }

## Rate limiting

Rate limiting protects your API from abuse and ensures fair resource allocation. Two common algorithms:

### Token bucket

Imagine a bucket with a maximum capacity of `N` tokens. Tokens refill at a fixed rate. Each request consumes one token. If the bucket is empty, the request is rejected.

Properties: handles **bursts** up to the bucket capacity; smooth refill rate; simple state (just the token count and last refill timestamp).

```js
async function tokenBucket(client, userId, limit = 10, windowSec = 60) {
  const key = `rate:tb:${userId}`;
  const now = Date.now();

  // Use a Redis hash to track tokens and last refill time
  const raw = await client.hGetAll(key);
  const lastRefill = Number(raw.lastRefill || now);
  const elapsed = (now - lastRefill) / 1000; // seconds
  const refillRate = limit / windowSec;      // tokens per second

  let tokens = Math.min(limit, Number(raw.tokens ?? limit) + elapsed * refillRate);

  if (tokens < 1) {
    return { allowed: false, remaining: 0 };
  }

  tokens -= 1;
  await client.hSet(key, { tokens: tokens.toFixed(4), lastRefill: now });
  await client.expire(key, windowSec * 2);

  return { allowed: true, remaining: Math.floor(tokens) };
}
```

> [!OUTPUT]
> { allowed: true, remaining: 9 }   // first request
> { allowed: true, remaining: 8 }   // second request
> { allowed: false, remaining: 0 }  // after 10 requests in < 60 s

### Sliding window (fixed counter)

Simpler but less burst-tolerant: count requests in the current fixed window using `INCR` + `EXPIRE`.

```js
async function slidingWindow(client, userId, limit = 10, windowSec = 60) {
  const window = Math.floor(Date.now() / (windowSec * 1000)); // current window bucket
  const key = `rate:sw:${userId}:${window}`;

  // INCR is atomic — safe under concurrent requests
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, windowSec); // set TTL on first request

  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count), count };
}
```

> [!OUTPUT]
> { allowed: true, remaining: 9, count: 1 }
> { allowed: false, remaining: 0, count: 11 }

> [!PITFALL] The fixed-window boundary problem
> A fixed-window rate limiter can be gamed: send 10 requests at 11:59:59 and 10 more at 12:00:01 — you get 20 requests in 2 seconds but both windows report "10 allowed". A **sliding-window log** or **sliding-window counter** (two adjacent buckets, weighted by overlap) fixes this at the cost of slightly more Redis state.

## Distributed locks

A distributed lock ensures only one process or worker runs a critical section at a time — across a fleet of Node instances, containers, or lambdas that share no memory.

The canonical Redis lock:

```js
// Acquire: SET key uuid NX PX ttlMs
// NX = "only if Not eXists"  PX = millisecond expiry (safety net)
// Returns "OK" if acquired, null if already held

async function acquireLock(client, resource, ttlMs = 5000) {
  const lockKey = `lock:${resource}`;
  const token = crypto.randomUUID(); // unique so we only delete OUR lock
  const result = await client.set(lockKey, token, { NX: true, PX: ttlMs });
  return result === "OK" ? token : null;
}

// Release: only delete the lock if it is still ours (Lua script for atomicity)
const releaseScript = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

async function releaseLock(client, resource, token) {
  return client.eval(releaseScript, { keys: [`lock:${resource}`], arguments: [token] });
}

// Usage
const token = await acquireLock(client, "invoice:generate");
if (!token) {
  console.log("Lock held by another worker — skipping");
} else {
  try {
    await generateInvoice(); // critical section
  } finally {
    await releaseLock(client, "invoice:generate", token);
  }
}
```

> [!OUTPUT]
> // Worker 1: lock acquired, running critical section
> // Worker 2: Lock held by another worker — skipping

> [!PRINCIPAL] Redlock and its caveats
> The Redlock algorithm (from the Redis author) tries to acquire locks on N independent Redis nodes (usually 5) and considers the lock acquired only if a majority succeed. This protects against a single Redis node failing and causing two clients to both believe they hold the lock. However, Redlock has well-documented failure modes under clock drift and GC pauses (Martin Kleppmann's 2016 analysis is required reading). For most web applications, a **single Redis with fencing tokens** — where the protected resource validates a monotonically increasing token before acting — is simpler and sufficient. Use Redlock only if you have independently replicated Redis nodes and have accepted the complexity.

## Redis Streams

Streams extend pub/sub with persistence, consumer groups, and acknowledgements — closer to Kafka Streams in a Redis footprint.

```js
// Producer: append to stream
await client.xAdd("events:orders", "*", { // "*" = auto-generate ID
  orderId: "99",
  event: "created",
  userId: "u1",
});

// Consumer: read new entries (block up to 2 s if empty)
const entries = await client.xRead(
  [{ key: "events:orders", id: "0" }], // "0" = from the beginning
  { COUNT: 10, BLOCK: 2000 }
);
```

> [!OUTPUT]
> [ { name: 'events:orders', messages: [ { id: '1717...', message: { orderId: '99', event: 'created' } } ] } ]

Use Streams when: messages must survive subscriber restarts, you need consumer groups for horizontal scaling, or you want replay of historical events.

## Try it yourself

A **token-bucket rate limiter** in pure JavaScript — the same algorithm Redis-backed implementations use, fully runnable here.

```js run
// Token-bucket rate limiter — pure browser JS

class TokenBucket {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.refillRate = limit / windowMs; // tokens per ms
    this.buckets = new Map();           // userId -> { tokens, lastRefill }
  }

  consume(userId) {
    const now = Date.now();
    if (!this.buckets.has(userId)) {
      this.buckets.set(userId, { tokens: this.limit, lastRefill: now });
    }

    const bucket = this.buckets.get(userId);
    const elapsed = now - bucket.lastRefill;

    // Refill tokens based on elapsed time (cap at limit)
    bucket.tokens = Math.min(this.limit, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return { allowed: false, remaining: 0 };
    }

    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }
}

// 5 requests per 1000ms
const limiter = new TokenBucket(5, 1000);

// Simulate 8 rapid requests
for (let i = 1; i <= 8; i++) {
  const result = limiter.consume("user:1");
  console.log(`Request ${i}: allowed=${result.allowed}, remaining=${result.remaining}`);
}

// Simulate a request after a brief refill pause
setTimeout(() => {
  const result = limiter.consume("user:1");
  console.log(`After 300ms pause: allowed=${result.allowed}, remaining=${result.remaining}`);
}, 300);
```

## Exercises

**Exercise 1:** Extend the `TokenBucket` class above to support multiple rate limit tiers. Add a `configure(userId, limit, windowMs)` method so different users can have different bucket sizes (e.g. free vs. paid tier).

<details>
<summary>Show solution</summary>

```js run
class TokenBucket {
  constructor(defaultLimit, defaultWindowMs) {
    this.defaultLimit = defaultLimit;
    this.defaultWindowMs = defaultWindowMs;
    this.buckets = new Map();
    this.configs = new Map(); // per-user config overrides
  }

  configure(userId, limit, windowMs) {
    this.configs.set(userId, { limit, refillRate: limit / windowMs });
  }

  consume(userId) {
    const now = Date.now();
    const config = this.configs.get(userId) ?? {
      limit: this.defaultLimit,
      refillRate: this.defaultLimit / this.defaultWindowMs,
    };

    if (!this.buckets.has(userId)) {
      this.buckets.set(userId, { tokens: config.limit, lastRefill: now });
    }

    const bucket = this.buckets.get(userId);
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(config.limit, bucket.tokens + elapsed * config.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) return { allowed: false, remaining: 0 };
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }
}

const limiter = new TokenBucket(3, 1000); // free: 3 req/s
limiter.configure("paid:user:1", 20, 1000); // paid: 20 req/s

console.log("--- Free tier (3/s) ---");
for (let i = 1; i <= 5; i++) {
  const r = limiter.consume("free:user:1");
  console.log(`req ${i}: allowed=${r.allowed}`);
}

console.log("--- Paid tier (20/s) ---");
for (let i = 1; i <= 5; i++) {
  const r = limiter.consume("paid:user:1");
  console.log(`req ${i}: allowed=${r.allowed}, remaining=${r.remaining}`);
}
```

</details>

**Exercise 2:** Implement a `SlidingWindowCounter` class that tracks requests in two adjacent fixed windows and computes a weighted count to smooth the fixed-window boundary problem. Accept `limit` and `windowMs` in the constructor, and a `consume(userId)` method that returns `{ allowed, count }`.

<details>
<summary>Show solution</summary>

```js run
// Sliding window counter — weighted blend of two fixed windows
class SlidingWindowCounter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map(); // userId -> { currentCount, prevCount, windowStart }
  }

  consume(userId) {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;

    if (!this.windows.has(userId)) {
      this.windows.set(userId, { currentCount: 0, prevCount: 0, windowStart });
    }

    const state = this.windows.get(userId);

    if (windowStart > state.windowStart) {
      // Window rolled over — previous current becomes previous
      state.prevCount = state.currentCount;
      state.currentCount = 0;
      state.windowStart = windowStart;
    }

    // Weight of the previous window that still overlaps the current sliding window
    const elapsed = now - windowStart;
    const prevWeight = 1 - elapsed / this.windowMs;

    const weightedCount = state.prevCount * prevWeight + state.currentCount;

    if (weightedCount >= this.limit) {
      return { allowed: false, count: Math.ceil(weightedCount) };
    }

    state.currentCount++;
    return { allowed: true, count: Math.ceil(weightedCount + 1) };
  }
}

const limiter = new SlidingWindowCounter(5, 1000);

console.log("Sending 7 requests:");
for (let i = 1; i <= 7; i++) {
  const r = limiter.consume("u1");
  console.log(`  req ${i}: allowed=${r.allowed}, weighted count=${r.count}`);
}
```

</details>

## Project

**Add a Redis cache + pub/sub layer and a MongoDB-backed analytics store to your API.**

Your API (built in earlier modules) likely queries a database on every request, has no rate limiting, and services talk to each other through HTTP. In this project you will add three Redis-powered layers and one MongoDB analytics collection.

### Acceptance criteria

1. **Cache-aside on GET endpoints.** At least one `GET` route (e.g. `GET /products/:id` or `GET /users/:id`) reads from Redis first. On a cache miss it queries MongoDB or PostgreSQL, stores the result with a 5-minute TTL, and returns it. A subsequent identical request must not hit the database (verify by logging DB calls).

2. **Cache invalidation on mutations.** When a `PUT`, `PATCH`, or `DELETE` request modifies the same entity, the corresponding cache key is deleted so the next `GET` returns fresh data.

3. **Token-bucket rate limiter middleware.** An Express (or Fastify) middleware applies the token-bucket algorithm to each incoming request keyed by IP address or API key. Requests exceeding the limit receive a `429 Too Many Requests` response with a `Retry-After` header.

4. **Pub/sub event bus.** When an order (or equivalent resource) is created, publish a `JSON` event to a Redis channel (e.g. `orders.created`). A separate subscriber process (or a second connection in the same process) listens and writes a denormalized analytics document to a MongoDB `analytics` collection (fields: `event`, `resourceId`, `timestamp`, `metadata`).

5. **MongoDB analytics query endpoint.** Add a `GET /analytics/summary` route that runs an aggregation pipeline over the `analytics` collection: group by `event` type, count occurrences, and return results sorted by count descending.

6. **Graceful shutdown.** On `SIGTERM`, the application flushes any pending pub/sub messages, waits for in-flight requests to complete, then disconnects Redis and MongoDB clients cleanly.

### Starter — token-bucket rate limiter (pure logic, fully runnable)

The following implements the entire rate-limiting logic you will wire into Express middleware. Run it here to confirm behaviour before integrating it:

```js run
// Token-bucket rate limiter — ready to lift into Express middleware

class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.refillRate = limit / windowMs;
    this.store = new Map();
  }

  consume(key) {
    const now = Date.now();
    if (!this.store.has(key)) {
      this.store.set(key, { tokens: this.limit, lastRefill: now });
    }

    const bucket = this.store.get(key);
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.limit, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - bucket.tokens) / this.refillRate);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }
}

// Simulate Express middleware wiring:
// app.use((req, res, next) => {
//   const result = limiter.consume(req.ip);
//   if (!result.allowed) {
//     res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
//     return res.status(429).json({ error: "Too many requests" });
//   }
//   res.set("X-RateLimit-Remaining", String(result.remaining));
//   next();
// });

const limiter = new RateLimiter(5, 2000); // 5 requests per 2 seconds

console.log("Simulating 8 requests from the same IP:");
for (let i = 1; i <= 8; i++) {
  const r = limiter.consume("192.168.1.1");
  if (r.allowed) {
    console.log(`Request ${i}: 200 OK  | remaining tokens: ${r.remaining}`);
  } else {
    console.log(`Request ${i}: 429 Too Many Requests | retry after ${r.retryAfterMs}ms`);
  }
}

// Simulate recovery after partial window
setTimeout(() => {
  const r = limiter.consume("192.168.1.1");
  console.log(`After 800ms: ${r.allowed ? "200 OK" : "429"} | remaining: ${r.remaining}`);
}, 800);
```

## Common pitfalls

> [!PITFALL] Using pub/sub for reliable event delivery
> Redis pub/sub has no persistence, no acknowledgements, and no replay. A subscriber that crashes between events loses every message published while it was down. Engineers who treat pub/sub like a message queue (expecting "at-least-once delivery") discover this the hard way in production. If your event must not be lost — an order, a payment, a notification — use Redis Streams with consumer groups, or a purpose-built broker (RabbitMQ, Kafka, SQS). Use pub/sub only for truly ephemeral events where loss is acceptable.

## What you learned

- Redis pub/sub broadcasts messages to all current subscribers on a channel; missed messages are dropped. Use `PSUBSCRIBE` for pattern-matching channels.
- The **token-bucket** algorithm allows bursts up to the bucket capacity and refills smoothly; the **sliding-window counter** prevents boundary exploitation at the cost of slightly more state.
- Distributed locks use `SET key token NX PX ttlMs` to atomically acquire; a Lua script ensures you only release your own lock. A unique per-acquisition token prevents accidental lock theft.
- **Redlock** adds majority-quorum across multiple Redis nodes but carries complexity and failure modes under clock skew — use fencing tokens for most workloads.
- **Redis Streams** (`XADD`/`XREADGROUP`) provide persistent, replayable, acknowledged delivery when pub/sub's fire-and-forget is not sufficient.

## Next steps

You now have a full data layer: SQL with ORMs, MongoDB for documents, and Redis for caching and coordination. Next we tackle **authentication and authorization** — JWT tokens, OAuth 2.0, session management, and protecting your API routes.
*/});
