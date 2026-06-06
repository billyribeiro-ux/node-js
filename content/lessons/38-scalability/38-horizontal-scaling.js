registerLessonSrc("38-horizontal-scaling", function () {/*
---
id: 38-horizontal-scaling
title: "Horizontal Scaling & Statelessness"
minutes: 24
level: principal
objectives:
  - Distinguish vertical from horizontal scaling and know when each applies
  - Make a Node service stateless so it runs safely behind any load balancer
  - Understand consistent hashing and why it minimises cache churn during scale events
---

# Horizontal Scaling & Statelessness

## Why this matters

A single Node process can handle surprising throughput, but it is still one process on one machine with a ceiling of one CPU core's worth of JavaScript execution. The moment you need more capacity than one machine can deliver — or you need zero-downtime deploys, geographic redundancy, or fault tolerance — you must run multiple instances. Knowing *how* to scale horizontally, and what your app must give up to do so safely, is the difference between a service that grows gracefully and one that breaks mysteriously at 2 AM.

## Learning objectives

- Explain vertical vs horizontal scaling and the trade-offs of each.
- Design a Node service to be stateless so any instance can handle any request.
- Externalise sessions and in-process state to Redis or another shared store.
- Describe load-balancing strategies: round-robin, least-connections, and consistent hashing.
- Understand sticky sessions — and why you should almost never need them.
- Apply the Twelve-Factor App principles that govern scalable, production-grade services.

## Vertical vs horizontal scaling

**Vertical scaling** means buying a bigger machine: more CPU cores, more RAM. It is fast to apply (just resize the VM), requires no application changes, and works well up to a point. That point is real — you cannot buy an infinitely large machine, and a single machine is a single point of failure. More importantly, Node's event loop runs on *one* thread, so adding cores via vertical scaling does not automatically use them (you still need the cluster module or a process manager).

**Horizontal scaling** means running more instances — same-sized machines, more of them. It maps naturally onto how Node actually works: you spin up N processes (one per core per machine) and put a load balancer in front. Capacity grows linearly, and any instance can crash without taking the service down.

```
          ┌──────────────┐
clients → │ Load Balancer│
          └──────┬───────┘
       ┌─────────┼─────────┐
  ┌────▼───┐ ┌───▼────┐ ┌──▼─────┐
  │ Node 1 │ │ Node 2 │ │ Node 3 │
  └────────┘ └────────┘ └────────┘
       all read/write shared state
       from Redis, Postgres, S3 …
```

The key constraint horizontal scaling imposes is **shared-nothing**: each instance must be interchangeable. If instance A remembers something that instance B does not, requests routed to B will fail — and the load balancer has no idea.

## Statelessness: the non-negotiable prerequisite

A **stateless** service stores nothing in memory between requests that it cannot reconstruct or fetch from a shared store. Every request arrives with all the context the handler needs (credentials in a header, IDs in the URL, body payload), and any state that persists across requests lives *outside* the process — in Redis, a database, an object store.

### The classic failure: in-process sessions

```js
// WRONG — in-process session map
const sessions = new Map();  // lives in this process's heap, invisible to siblings

app.post("/login", (req, res) => {
  const token = crypto.randomUUID();
  sessions.set(token, { userId: req.body.userId });  // stored here, not in Redis
  res.json({ token });
});

app.get("/profile", (req, res) => {
  const session = sessions.get(req.headers["x-token"]);
  if (!session) return res.status(401).send("Unauthorised");  // fails on a different instance
  res.json({ userId: session.userId });
});
```

> [!OUTPUT]
> // Request 1 (login) hits Node 1 — token saved in Node 1's Map
> // Request 2 (profile) hits Node 2 — Map is empty → 401
> // Users see random auth failures under load

### The fix: Redis-backed sessions

```js
import { createClient } from "redis";
import { randomUUID } from "node:crypto";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const SESSION_TTL = 3600;  // seconds

app.post("/login", async (req, res) => {
  const token = randomUUID();
  await redis.setEx(`session:${token}`, SESSION_TTL, JSON.stringify({ userId: req.body.userId }));
  res.json({ token });
});

app.get("/profile", async (req, res) => {
  const raw = await redis.get(`session:${req.headers["x-token"]}`);
  if (!raw) return res.status(401).send("Unauthorised");
  const session = JSON.parse(raw);
  res.json({ userId: session.userId });
});
```

> [!OUTPUT]
> // Any instance can serve any request — all state is in Redis
> // Scale from 1 → 100 instances without application changes

Now `sessions` is in Redis, which every instance connects to. Adding a tenth Node instance requires no code change.

> [!PRINCIPAL] JWT vs server-side sessions
> JSON Web Tokens push session state *into the token itself*, signed but not stored anywhere server-side. This makes your service stateless without Redis — at the cost of inability to invalidate individual tokens before expiry. For most services, short-lived JWTs (15 min) with Redis-backed refresh-token revocation lists is the pragmatic middle ground: no sticky sessions, instant revocation when needed.

## Load balancing strategies

A **load balancer** distributes incoming connections across your instances. The strategy matters:

| Strategy | How it works | Best for |
|---|---|---|
| Round-robin | each request to the next instance in order | uniform, stateless requests |
| Least-connections | route to the instance with fewest open connections | variable request cost |
| IP hash | hash client IP → same instance | legacy; prefer Redis instead |
| Consistent hashing | hash a key across a virtual ring | caches, sharding |

**Round-robin** (the nginx and Node cluster default) works perfectly when your service is truly stateless. **Least-connections** handles heterogeneous workloads better — a slow database query on instance 1 should not block new requests when instance 2 is idle.

### Sticky sessions — and why to avoid them

**Sticky sessions** (also called *session affinity*) pin a client to one instance — often via a cookie — so that in-process state is always reachable. This feels like a solution but is actually technical debt:

- The pinned instance becomes a hot spot.
- When it restarts or is replaced, all its sessions vanish.
- You cannot freely scale out or replace instances without disrupting users.

Use sticky sessions only as a short-term workaround while you migrate state to a shared store.

## The Twelve-Factor App

The [Twelve-Factor App](https://12factor.net) is a methodology for building software-as-a-service. The factors most relevant to horizontal scaling are:

- **III. Config** — Store config in environment variables, not hardcoded values. Every instance reads from `process.env`, not from a file baked into the image.
- **VI. Processes** — Execute the app as one or more *stateless* processes. Share nothing via the filesystem or memory between processes.
- **VII. Port binding** — The service exports HTTP by binding to a port, not by relying on a web server container.
- **VIII. Concurrency** — Scale out via the process model: run more processes rather than threading within one.
- **IX. Disposability** — Processes can be started or stopped at any moment. Fast startup and graceful shutdown make horizontal scaling safe.

## Consistent hashing: minimal disruption when nodes change

When you use a cache layer (Redis cluster, Memcached, or a home-grown one), you need to know *which* node owns a given key. A naive `node = hash(key) % N` breaks badly when you add or remove a node — the denominator changes, and almost every key remaps.

**Consistent hashing** arranges virtual "slots" on a ring. Each node owns a range of the ring. When you add a node it takes over part of one neighbour's range — only those keys move. When you remove a node, its keys fall to the next node on the ring. Expected churn is `K/N` (keys divided by nodes), not `K`.

## Try it yourself

Below is a fully runnable consistent-hash ring. Add nodes, remove nodes, and watch how few keys need to remap.

```js run
// Consistent-hash ring using virtual nodes for even distribution.
// No require/import needed — pure logic.

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;  // FNV-1a, unsigned 32-bit
  }
  return h;
}

class ConsistentHashRing {
  constructor(virtualNodes = 40) {
    this.virtualNodes = virtualNodes;
    this.ring = new Map();  // point → nodeName
    this.sortedPoints = [];
  }

  addNode(name) {
    for (let i = 0; i < this.virtualNodes; i++) {
      const point = simpleHash(`${name}#${i}`);
      this.ring.set(point, name);
    }
    this.sortedPoints = [...this.ring.keys()].sort((a, b) => a - b);
  }

  removeNode(name) {
    for (let i = 0; i < this.virtualNodes; i++) {
      const point = simpleHash(`${name}#${i}`);
      this.ring.delete(point);
    }
    this.sortedPoints = [...this.ring.keys()].sort((a, b) => a - b);
  }

  getNode(key) {
    if (this.sortedPoints.length === 0) return null;
    const h = simpleHash(key);
    for (const p of this.sortedPoints) {
      if (h <= p) return this.ring.get(p);
    }
    return this.ring.get(this.sortedPoints[0]);  // wrap around the ring
  }
}

// --- demo ---
const ring = new ConsistentHashRing(40);
ring.addNode("node-A");
ring.addNode("node-B");
ring.addNode("node-C");

const keys = Array.from({ length: 20 }, (_, i) => `user:${1000 + i}`);
const before = new Map(keys.map(k => [k, ring.getNode(k)]));

console.log("=== Before adding node-D ===");
const countBefore = {};
for (const n of before.values()) countBefore[n] = (countBefore[n] || 0) + 1;
console.log("Distribution:", JSON.stringify(countBefore));

ring.addNode("node-D");
const after = new Map(keys.map(k => [k, ring.getNode(k)]));

let moved = 0;
for (const k of keys) {
  if (before.get(k) !== after.get(k)) moved++;
}

console.log("\n=== After adding node-D ===");
const countAfter = {};
for (const n of after.values()) countAfter[n] = (countAfter[n] || 0) + 1;
console.log("Distribution:", JSON.stringify(countAfter));
console.log(`Keys remapped: ${moved} / ${keys.length}  (${((moved/keys.length)*100).toFixed(0)}%)`);
console.log("Expected ~25% churn when going from 3 → 4 nodes (1/N of keys move)");
```

## Exercise: spot the stateful bugs

Review this pseudocode and identify every piece of state that breaks horizontal scaling. Then refactor each one.

```js run
// Broken stateful service — find all three problems
const rateLimitMap = new Map();   // problem 1: in-process rate limiting
const uploadCache  = new Map();   // problem 2: in-process upload dedup
let requestCount   = 0;           // problem 3: in-process counter

function handleUpload(userId, fileHash) {
  requestCount++;
  const calls = (rateLimitMap.get(userId) || 0) + 1;
  rateLimitMap.set(userId, calls);
  if (calls > 10) { console.log("rate limited:", userId); return; }

  if (uploadCache.has(fileHash)) { console.log("duplicate upload ignored"); return; }
  uploadCache.set(fileHash, true);
  console.log(`Stored file ${fileHash} for ${userId}. Total requests: ${requestCount}`);
}

handleUpload("alice", "abc123");
handleUpload("alice", "abc123");  // dedup works on THIS instance only
handleUpload("alice", "def456");
console.log("requestCount on this instance:", requestCount);
console.log("(other instances have their own counters — totals are siloed)");
```

<details>
<summary>Show solution</summary>

Each in-process store must move to Redis (or a database):

1. `rateLimitMap` → `redis.incr("ratelimit:{userId}")` with a TTL-based sliding window.
2. `uploadCache` → `redis.set("uploaded:{fileHash}", 1, "NX")` — set only if not exists.
3. `requestCount` → `redis.incr("global:requestCount")` or a time-series metric (Prometheus counter).

```js run
// Simulated Redis (in-memory, single-process — just to show the logic)
const fakeRedis = new Map();

function redisIncr(key) {
  const v = (fakeRedis.get(key) || 0) + 1;
  fakeRedis.set(key, v);
  return v;
}

function redisSetNX(key, value) {
  if (fakeRedis.has(key)) return false;
  fakeRedis.set(key, value);
  return true;
}

function handleUploadFixed(userId, fileHash) {
  redisIncr("global:requestCount");
  const calls = redisIncr(`ratelimit:${userId}`);
  if (calls > 10) { console.log("rate limited:", userId); return; }
  const isNew = redisSetNX(`uploaded:${fileHash}`, true);
  if (!isNew) { console.log("duplicate upload ignored"); return; }
  console.log(`Stored ${fileHash} for ${userId}. Requests: ${fakeRedis.get("global:requestCount")}`);
}

handleUploadFixed("alice", "abc123");
handleUploadFixed("alice", "abc123");
handleUploadFixed("alice", "def456");
```

</details>

## Common pitfalls

> [!PITFALL] The filesystem is not shared storage
> Writing uploaded files or generated reports to `./uploads/` on the local disk means instance B cannot read what instance A wrote. Use object storage (S3, GCS) or a network filesystem. The same applies to SQLite databases — they live on one machine and are not visible to other instances.

> [!PITFALL] Cron jobs running on every instance
> If your app registers a `setInterval` or a cron expression at startup, every instance will fire it. Move scheduled jobs to a dedicated worker process or use a distributed lock (Redis `SET NX PX`) so only one instance runs the job at a time.

## What you learned

- Horizontal scaling adds more instances; vertical scaling adds more resources to one — horizontal is the path to both capacity and resilience.
- A stateless service stores nothing in instance memory that crosses a request boundary; all durable state lives in a shared store.
- Move sessions, rate-limit counters, upload dedup, and any other cross-request state to Redis.
- Consistent hashing redistributes only `K/N` keys when adding or removing a node — far less churn than modulo-based sharding.
- Sticky sessions are a code smell; fix the underlying stateful design instead.
- The Twelve-Factor App's process and config factors encode the requirements for safe horizontal scaling.

## Next steps

Stateless instances are a prerequisite — but deploying them without dropping traffic requires zero-downtime deploy techniques. The next lesson covers rolling deploys, blue-green cutover, readiness probes, and graceful shutdown so your scale events and deploys are invisible to users.
*/});
