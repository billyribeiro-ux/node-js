registerLessonSrc("19-redis-caching", function () {/*
---
id: 19-redis-caching
title: "Redis: Caching & Expiry Strategies"
minutes: 25
level: advanced
objectives:
  - Understand Redis as an in-memory data store and when to reach for it
  - Apply the cache-aside pattern with GET/SET/EX using the Node.js client
  - Configure TTLs and eviction policies to keep memory bounded under load
---

# Redis: Caching & Expiry Strategies

## Why this matters

A MongoDB or PostgreSQL query that takes 20 ms in a test environment can balloon to 200 ms under real load because every concurrent request hits disk. **Redis** keeps the hottest data in RAM, answering identical requests in under a millisecond. Understanding *how* to cache — when to set a key, how long to keep it, what happens when memory fills up, and how to avoid thundering herds — separates engineers who add caching as an afterthought from those who design it deliberately.

## Learning objectives

- Describe Redis's data model and the role it plays alongside a primary database.
- Use `GET`, `SET`, and `EX` (expiry) via the `redis` npm client in Node.
- Implement the **cache-aside** pattern with proper cache invalidation.
- Configure **TTL** and reason about **eviction policies** (LRU vs. LFU).
- Explain and mitigate the **cache stampede** problem.

## Redis: an in-memory data structure store

Redis stores data as key-value pairs entirely in RAM. It is single-threaded (one event loop, much like Node) but achieves 100k+ operations per second because every operation avoids disk I/O. The key primitives:

| Command | Description |
|---------|-------------|
| `SET key value` | Store a string value. |
| `GET key` | Retrieve a value (`null` if missing). |
| `SET key value EX seconds` | Store with an expiry (TTL). |
| `DEL key` | Delete a key. |
| `EXISTS key` | Check presence (0 or 1). |
| `TTL key` | Seconds remaining before expiry (-1 = no expiry, -2 = gone). |
| `INCR / DECR key` | Atomic integer increment. |

Redis also has hashes, lists, sorted sets, streams, and pub/sub — but for caching, strings are all you need.

## Connecting from Node.js

```bash
npm install redis
```

```js
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost:6379" });
client.on("error", (err) => console.error("Redis error:", err));
await client.connect();

// Basic SET and GET
await client.set("greeting", "hello");
const val = await client.get("greeting");
console.log(val); // hello

// SET with EX — expires in 60 seconds
await client.set("session:abc", JSON.stringify({ userId: 42 }), { EX: 60 });
const raw = await client.get("session:abc");
const session = JSON.parse(raw);
console.log(session.userId); // 42
```

> [!OUTPUT]
> hello
> 42

> [!NOTE] Always serialize objects to JSON
> Redis stores strings. Use `JSON.stringify` when writing and `JSON.parse` when reading objects. The `redis` v4 client does not automatically serialize for you.

## The cache-aside pattern

The most common caching pattern is **cache-aside** (also called lazy loading): the application code is responsible for populating the cache on a miss, not a background process.

```
Request arrives
       │
       ▼
  Check cache ──HIT──▶ Return cached value
       │
      MISS
       │
       ▼
  Query DB ──▶ Store result in cache (with TTL) ──▶ Return value
```

```js
async function getUserById(id) {
  const cacheKey = `user:${id}`;

  // 1. Try cache first
  const cached = await client.get(cacheKey);
  if (cached) {
    return JSON.parse(cached); // cache HIT
  }

  // 2. Cache MISS — hit the database
  const user = await db.collection("users").findOne({ _id: id });
  if (!user) return null;

  // 3. Populate the cache with a 5-minute TTL
  await client.set(cacheKey, JSON.stringify(user), { EX: 300 });

  return user;
}
```

> [!OUTPUT]
> // First call: DB query + cache write (~20 ms)
> // Subsequent calls: cache read (~0.5 ms)

**Cache invalidation on write** — when you update the database, delete the stale cache entry:

```js
async function updateUser(id, patch) {
  await db.collection("users").updateOne({ _id: id }, { $set: patch });
  await client.del(`user:${id}`); // invalidate so the next read re-fetches
}
```

> [!PITFALL] Write-through vs. cache-aside confusion
> With cache-aside, you delete (not update) the cache on writes. If you try to update both DB and cache atomically without a transaction, you risk a race where another request reads a stale key between your two writes. Deleting is safer: the next reader takes a cache miss and fetches fresh data.

## TTL: choosing the right expiry

A TTL is a contract about how stale you are willing to be.

| Data type | Typical TTL |
|-----------|-------------|
| Session tokens | 15 min – 24 h |
| User profile | 2 – 5 min |
| Product catalogue | 10 – 60 min |
| Top-10 leaderboard | 30 s – 2 min |
| Real-time inventory | No cache or 1 – 5 s |

A short TTL limits staleness but increases DB load. A long TTL reduces DB load but can serve stale data. There is no universal answer — calibrate per entity by asking: "If this data is 5 minutes old, would a user notice or be harmed?"

```js
// Sliding TTL — reset expiry on each read (keep hot keys alive)
const raw = await client.getEx(cacheKey, { EX: 300 });

// Peek remaining TTL
const remaining = await client.ttl(cacheKey);
console.log(`Key expires in ${remaining}s`);
```

> [!OUTPUT]
> Key expires in 298s

## Eviction policies

Redis has a fixed `maxmemory` limit (set in `redis.conf`). When it is full and a new key arrives, Redis runs an **eviction policy**:

| Policy | Behaviour |
|--------|-----------|
| `noeviction` | Return an error on writes (default, dangerous for cache use) |
| `allkeys-lru` | Evict the **L**east **R**ecently **U**sed key across all keys |
| `allkeys-lfu` | Evict the **L**east **F**requently **U**sed key (better for skewed access) |
| `volatile-lru` | LRU eviction only among keys **with a TTL** set |
| `volatile-ttl` | Evict the key with the shortest remaining TTL first |

For a pure cache, set `maxmemory-policy allkeys-lru` or `allkeys-lfu` in `redis.conf`. LFU is preferred when your access pattern is power-law (a small fraction of keys get the vast majority of traffic).

```bash
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lfu
```

> [!PRINCIPAL] LRU vs. LFU in practice
> LRU works well when recency of access is the best predictor of future access (most general caches). LFU wins when a small set of "celebrity" keys are accessed constantly — LFU keeps them even if they were not touched in the last few seconds. Netflix found LFU significantly outperformed LRU for their content metadata cache because title popularity follows a Zipf distribution. The right choice depends on your access distribution; add metrics before deciding.

## Cache stampede (thundering herd)

When a popular cached key expires, hundreds of concurrent requests all miss, all hit the database simultaneously, and all try to re-populate the cache at the same time. This **cache stampede** can collapse the database under load.

Mitigation strategies:

**1. Probabilistic early recomputation (PER)** — recompute the cache slightly before it expires, based on remaining TTL. The first request with enough "urgency" regenerates it while others still serve the old value.

**2. Lock-based refresh (mutex)** — when a miss occurs, the first request acquires a short Redis lock (`SET lock:key 1 NX EX 5`), regenerates the value, then releases. Other requests either wait or serve a slightly stale value.

```js
async function getWithLock(cacheKey, fetchFn, ttl = 60) {
  const cached = await client.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const lockKey = `lock:${cacheKey}`;
  // NX = only set if Not eXists; EX = expire in 5 s
  const acquired = await client.set(lockKey, "1", { NX: true, EX: 5 });

  if (!acquired) {
    // Another process is refreshing — back off briefly and retry
    await new Promise(r => setTimeout(r, 50));
    return getWithLock(cacheKey, fetchFn, ttl);
  }

  try {
    const value = await fetchFn();
    await client.set(cacheKey, JSON.stringify(value), { EX: ttl });
    return value;
  } finally {
    await client.del(lockKey);
  }
}
```

> [!OUTPUT]
> // Only one DB query fires even under 500 concurrent cache misses

## Try it yourself

Build a Map-based LRU cache with TTL in pure JavaScript — the same data-structure logic Redis implements under the hood.

```js run
// LRU Cache with TTL — pure browser JS (no Node APIs)

class LRUCache {
  constructor(capacity, defaultTtlMs = 5000) {
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map(); // insertion-order Map gives us LRU for free
  }

  // Move key to end (most recently used)
  _touch(key) {
    const entry = this.store.get(key);
    this.store.delete(key);
    this.store.set(key, entry);
  }

  get(key) {
    if (!this.store.has(key)) return null;
    const entry = this.store.get(key);
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key); // expired
      return null;
    }
    this._touch(key);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) this.store.delete(key); // refresh position
    if (this.store.size >= this.capacity) {
      // Evict least recently used (first entry in Map)
      const lruKey = this.store.keys().next().value;
      this.store.delete(lruKey);
      console.log(`[EVICT] key="${lruKey}"`);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  ttl(key) {
    if (!this.store.has(key)) return -2;
    const remaining = this.store.get(key).expiresAt - Date.now();
    return remaining > 0 ? Math.round(remaining) : -2;
  }
}

// Demo — capacity 3, 200ms TTL
const cache = new LRUCache(3, 200);

cache.set("a", "alpha");
cache.set("b", "beta");
cache.set("c", "gamma");

console.log("a =", cache.get("a")); // alpha (also refreshes a's LRU position)
cache.set("d", "delta");            // evicts "b" (LRU after a was touched)

console.log("b =", cache.get("b")); // null — evicted
console.log("d =", cache.get("d")); // delta

// TTL expiry demo
const shortCache = new LRUCache(10, 50); // 50 ms TTL
shortCache.set("x", "will-expire");
console.log("before expiry:", shortCache.get("x")); // will-expire

setTimeout(() => {
  console.log("after expiry:", shortCache.get("x")); // null
}, 80);
```

## Exercises

**Exercise 1:** Add a `delete(key)` method and a `size` getter to the `LRUCache` above. Then demonstrate invalidating a key and confirming the size decreases.

<details>
<summary>Show solution</summary>

```js run
class LRUCache {
  constructor(capacity, defaultTtlMs = 5000) {
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  _touch(key) {
    const e = this.store.get(key);
    this.store.delete(key);
    this.store.set(key, e);
  }

  get(key) {
    if (!this.store.has(key)) return null;
    const entry = this.store.get(key);
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    this._touch(key);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) this.store.delete(key);
    if (this.store.size >= this.capacity) {
      this.store.delete(this.store.keys().next().value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  // NEW
  delete(key) { return this.store.delete(key); }
  get size()  { return this.store.size; }
}

const cache = new LRUCache(5);
cache.set("user:1", { name: "Ada" });
cache.set("user:2", { name: "Bob" });
console.log("size before delete:", cache.size); // 2

cache.delete("user:1");
console.log("size after delete:", cache.size);  // 1
console.log("user:1 value:", cache.get("user:1")); // null
console.log("user:2 value:", cache.get("user:2").name); // Bob
```

</details>

**Exercise 2:** Modify the `LRUCache` so that `get()` also accepts an optional `fallback` async function. If the key is missing or expired, it calls `fallback()`, stores the result, and returns it — implementing the cache-aside pattern entirely within the class.

<details>
<summary>Show solution</summary>

```js run
class LRUCacheWithFallback {
  constructor(capacity, defaultTtlMs = 5000) {
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  _touch(key) {
    const e = this.store.get(key); this.store.delete(key); this.store.set(key, e);
  }

  async get(key, fallback = null, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      const entry = this.store.get(key);
      if (Date.now() <= entry.expiresAt) {
        this._touch(key);
        return entry.value;
      }
      this.store.delete(key);
    }
    if (!fallback) return null;
    const value = await fallback();
    this.set(key, value, ttlMs);
    return value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) this.store.delete(key);
    if (this.store.size >= this.capacity) {
      this.store.delete(this.store.keys().next().value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

// Simulate an async DB fetch
let dbCalls = 0;
async function fetchUserFromDb(id) {
  dbCalls++;
  return { id, name: "Ada", fetchedAt: Date.now() };
}

const cache = new LRUCacheWithFallback(10, 300);

// First call: cache miss → calls DB
const user1 = await cache.get("user:1", () => fetchUserFromDb(1));
console.log("user:", user1.name, "| dbCalls:", dbCalls); // Ada | 1

// Second call: cache hit → DB not called
const user2 = await cache.get("user:1", () => fetchUserFromDb(1));
console.log("user:", user2.name, "| dbCalls:", dbCalls); // Ada | 1 (still 1)
```

</details>

## Common pitfalls

> [!PITFALL] Caching mutable aggregates without invalidation
> A common trap: caching the result of an expensive aggregation (e.g. "total orders today") with a long TTL but forgetting to invalidate or update it when the underlying data changes. You end up showing users a counter that is minutes or hours stale. Either use a short TTL you can live with, or build explicit invalidation into every write path. There is no middle ground that gives you both correctness and long TTLs without work.

## What you learned

- Redis is an in-memory key-value store offering sub-millisecond reads and writes.
- `SET key value EX seconds` stores a value with automatic expiry; `GET` retrieves or returns `null`.
- The **cache-aside** pattern: check cache → on miss, query DB → write to cache → return. Invalidate on write by deleting the key, not updating it.
- TTLs are a staleness contract — choose based on how much drift your users can tolerate.
- **LRU** evicts the least recently used key; **LFU** evicts the least frequently used — LFU wins for power-law access distributions.
- **Cache stampede** occurs when many requests simultaneously miss the same expired key; mitigate with a mutex lock or probabilistic early refresh.

## Next steps

You have learned how to cache data. Next, we will push Redis further: **pub/sub** messaging between services, **token-bucket** rate limiting, and **distributed locks** — patterns that make Redis a coordination hub for your entire system.
*/});
