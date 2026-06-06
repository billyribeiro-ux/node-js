registerLessonSrc("28-api-tradeoffs", function () {/*
---
id: 28-api-tradeoffs
title: "REST vs gRPC vs GraphQL"
minutes: 28
level: principal
objectives:
  - Apply a structured decision framework to choose REST, gRPC, or GraphQL
  - Articulate performance, caching, tooling, and operational tradeoffs for each style
  - Design a dual-exposure architecture that serves gRPC internally and GraphQL externally
---

# REST vs gRPC vs GraphQL

## Why this matters

Choosing the wrong API style is an architectural decision that haunts teams for years. A public API redesigned from REST to GraphQL after launch carries a migration cost measured in quarters. An internal microservice on GraphQL when gRPC would have sufficed burns CPU on JSON parsing under load. Every senior engineer is eventually asked: *"Which should we use?"* This lesson gives you a rigorous, defensible answer — not a preference, but a framework rooted in first principles.

## Learning objectives

- Evaluate **REST**, **gRPC**, and **GraphQL** across six concrete dimensions.
- Know the canonical use case for each and the warning signs you've picked the wrong one.
- Design a **dual-exposure** service that speaks gRPC to internal consumers and GraphQL to external clients.
- Understand how **subscriptions backed by Redis pub/sub** scale GraphQL real-time across replicas.

## The decision dimensions

Before comparing, define what you actually care about:

1. **Consumer type** — who calls this API? Internal services, a known first-party client (mobile app), or arbitrary third parties?
2. **Schema rigidity** — do you know every field every client needs, or do clients have wildly varying data requirements?
3. **Performance budget** — is this on a hot path (thousands of calls/second, microsecond budgets) or a user-facing feature (tens of calls/second, human-perceptible latency)?
4. **Real-time requirements** — do clients need pushed updates, or is poll/request-response enough?
5. **Operational maturity** — does your team have the infrastructure (gRPC load balancers, GraphQL gateway) and know-how to run this in production?
6. **Caching strategy** — must responses be cached at the CDN/HTTP layer, or is application-level caching acceptable?

## The three styles at a glance

### REST

**REST** (Representational State Transfer) maps resources to URLs and actions to HTTP verbs (`GET /users/42`, `POST /posts`). It is not a protocol but a set of architectural constraints. The wire format is almost always JSON over HTTP/1.1 or HTTP/2.

**When REST shines:**
- **Public APIs** consumed by third parties who can't control their client libraries.
- Anything that must be **cached by a CDN** or a reverse proxy (GET requests with stable URLs).
- Simple CRUD surfaces where the resource model fits neatly.
- Teams with limited API experience — REST has the lowest learning curve and the richest ecosystem of documentation, testing, and mocking tools.

**Watch out when:** the client has complex, varying data requirements (you'll over-fetch); when you have many related resources (you'll under-fetch and chain requests); or when performance between services is paramount.

### gRPC

**gRPC** is a typed RPC framework using HTTP/2 and Protocol Buffers. Calls look like local function calls; the schema (`.proto`) is the contract; code is generated for both client and server.

**When gRPC shines:**
- **Internal service-to-service** communication where both sides are under your control.
- **High-throughput, low-latency** paths — protobuf serialisation is 3–10× faster than JSON; HTTP/2 multiplexing eliminates TCP overhead.
- **Bidirectional streaming** — real-time telemetry, log ingestion, live data feeds.
- **Polyglot environments** — generate clients in Go, Java, Python, and Node from the same `.proto`.

**Watch out when:** you need a browser client (gRPC-Web adds friction); you want human-readable wire traffic (binary protobuf is opaque without tooling); or when your load balancer or service mesh doesn't understand HTTP/2 trailers (some legacy infrastructure doesn't).

### GraphQL

**GraphQL** is a query language and runtime. Clients declare exactly the fields they need; the server fulfils exactly that shape. A single endpoint (`POST /graphql`) serves all queries.

**When GraphQL shines:**
- **Flexible first-party clients** — mobile apps and SPAs with divergent data needs across screens.
- **Aggregation gateways** — a single GraphQL layer that stitches data from multiple backend services (REST, gRPC, databases).
- **Rapid product iteration** — front-end teams add fields without coordinating a back-end release, as long as the schema is additive.
- **Rich developer experience** — introspection, GraphiQL, and code-gen (graphql-codegen) are world-class.

**Watch out when:** HTTP-level caching is critical (GraphQL POST requests don't cache trivially); when your data model is simple and REST would suffice; or when you have a small, stable client that always needs the same shape (REST is simpler).

## Side-by-side comparison

| Dimension | REST | gRPC | GraphQL |
|---|---|---|---|
| Wire format | JSON (human readable) | Protobuf binary (compact) | JSON (human readable) |
| Transport | HTTP/1.1 or HTTP/2 | HTTP/2 (required) | HTTP/1.1 or HTTP/2 |
| Schema | Optional (OpenAPI) | Mandatory `.proto` | Mandatory SDL |
| Serialisation speed | Baseline | 3–10× faster | ~same as REST |
| Streaming | Limited (SSE, chunked) | First-class (4 types) | Subscriptions (WebSocket) |
| HTTP caching | Excellent (GET) | Poor (binary, POST-like) | Poor (POST); persisted queries help |
| Browser support | Native | Via gRPC-Web proxy | Native |
| Over/under-fetching | Both possible | Neither (exact contract) | Neither (client specifies) |
| N+1 problem | N/A | N/A | Yes (need DataLoader) |
| Code generation | Optional | Mandatory (recommended) | Optional (codegen helps) |
| Learning curve | Low | Medium | Medium–High |
| Best for | Public APIs, CRUD | Internal, high-throughput | Flexible clients, gateways |

> [!PRINCIPAL] Don't pick one style for your whole organization
> The best architectures use all three — gRPC between microservices for performance, a GraphQL gateway at the edge to aggregate and expose a flexible API, and REST for public/partner integrations that need CDN caching and simple tooling. The question isn't "which is best?" but "which fits this boundary?" Draw the boundary first; the style follows.

## Performance deep-dive

For a concrete intuition: a JSON REST response for a user record might be 200 bytes; the equivalent protobuf message 40 bytes. At 100 000 calls/second on an internal bus that's 160 MB/s of savings — meaningful at scale. More important than raw bytes is **parsing cost**: JSON is a string format that allocates heap objects per field; protobuf is a binary format decoded directly into typed structs with far fewer allocations, easing GC pressure.

HTTP/2 multiplexing means gRPC's 100 concurrent RPCs share one TCP connection with no head-of-line blocking between streams. REST on HTTP/1.1 requires 100 connections or queues them.

## Caching strategies by style

- **REST**: Use HTTP semantics. `GET` + a good URL scheme + `Cache-Control` lets CDNs (Cloudflare, Fastly) serve responses with zero application-server load. This is REST's killer feature for public read-heavy APIs.
- **gRPC**: No HTTP-level caching. Cache at the application layer (Redis, in-process LRU) or at the service mesh layer (Envoy's gRPC transcoding + response caching).
- **GraphQL**: `POST /graphql` bypasses CDN caches by default. Solutions: **persisted queries** (client sends a hash; server maps it to the query; CDN caches the hash → GET); or **Automatic Persisted Queries (APQ)** in Apollo Router. For subscriptions, caching is irrelevant — they are stateful push channels.

## Try it yourself

A scoring function that maps weighted requirements to an API style recommendation:

```js run
// API style recommendation engine.
// Each requirement is weighted 0–1; each style scores 0–3 on each dimension.

const styles = {
  REST:    { publicConsumers: 3, strictSchema: 1, highThroughput: 1, realTime: 1, caching: 3, simplicity: 3 },
  gRPC:    { publicConsumers: 1, strictSchema: 3, highThroughput: 3, realTime: 3, caching: 1, simplicity: 2 },
  GraphQL: { publicConsumers: 2, strictSchema: 2, highThroughput: 1, realTime: 2, caching: 1, simplicity: 1 },
};

function recommend(weights) {
  const scores = {};
  for (const [style, dims] of Object.entries(styles)) {
    scores[style] = Object.entries(weights).reduce((sum, [dim, w]) => {
      return sum + (dims[dim] ?? 0) * w;
    }, 0);
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  console.log("Recommendation:");
  for (const [style, score] of sorted) {
    const bar = "#".repeat(Math.round(score));
    console.log(`  ${style.padEnd(8)} ${bar.padEnd(12)} ${score.toFixed(2)}`);
  }
  console.log("  Winner:", sorted[0][0]);
}

// Scenario A: public partner API, must cache at CDN, simple CRUD
console.log("=== Public partner API ===");
recommend({ publicConsumers: 1, strictSchema: 0.5, highThroughput: 0.3, realTime: 0, caching: 1, simplicity: 0.8 });

// Scenario B: internal microservice mesh, high RPS, some streaming
console.log("\n=== Internal microservice ===");
recommend({ publicConsumers: 0, strictSchema: 1, highThroughput: 1, realTime: 0.8, caching: 0.2, simplicity: 0.3 });

// Scenario C: mobile app BFF with varied screen data requirements
console.log("\n=== Mobile BFF ===");
recommend({ publicConsumers: 0.5, strictSchema: 0.5, highThroughput: 0.4, realTime: 0.6, caching: 0.3, simplicity: 0.4 });
```

## Exercises

### Exercise 1: extend the scoring model

Add a `streaming` requirement with scores REST:1, gRPC:3, GraphQL:2. Re-run Scenario B (internal microservice with `streaming: 1.0`). Verify gRPC still wins but by a wider margin.

<details>
<summary>Show solution</summary>

```js run
const styles = {
  REST:    { publicConsumers: 3, strictSchema: 1, highThroughput: 1, realTime: 1, caching: 3, simplicity: 3, streaming: 1 },
  gRPC:    { publicConsumers: 1, strictSchema: 3, highThroughput: 3, realTime: 3, caching: 1, simplicity: 2, streaming: 3 },
  GraphQL: { publicConsumers: 2, strictSchema: 2, highThroughput: 1, realTime: 2, caching: 1, simplicity: 1, streaming: 2 },
};

function recommend(label, weights) {
  const scores = {};
  for (const [style, dims] of Object.entries(styles)) {
    scores[style] = Object.entries(weights).reduce((sum, [dim, w]) => {
      return sum + (dims[dim] ?? 0) * w;
    }, 0);
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  console.log(`=== ${label} ===`);
  for (const [style, score] of sorted) {
    console.log(`  ${style.padEnd(8)} ${score.toFixed(2)}`);
  }
  console.log("  Winner:", sorted[0][0], "\n");
}

recommend("Internal microservice (with streaming)", {
  publicConsumers: 0, strictSchema: 1, highThroughput: 1,
  realTime: 0.8, caching: 0.2, simplicity: 0.3, streaming: 1.0,
});
// gRPC leads by even more once streaming weight is added
```

</details>

### Exercise 2: DataLoader batcher starter

Implement the core coalescing loop: keys are collected with `load(key)` calls during a tick, then a single `batchFn` fires. Duplicate keys should only appear once in the batch.

<details>
<summary>Show solution</summary>

```js run
function createDeduplicatingLoader(batchFn) {
  let keySet = new Set();
  let keyOrder = [];
  let resolverMap = new Map(); // key → [resolve, ...]
  let scheduled = false;

  function dispatch() {
    const keys = keyOrder;
    const resolvers = resolverMap;
    keySet = new Set();
    keyOrder = [];
    resolverMap = new Map();
    scheduled = false;

    batchFn(keys).then(values => {
      for (let i = 0; i < keys.length; i++) {
        const waiting = resolvers.get(keys[i]) ?? [];
        for (const resolve of waiting) resolve(values[i]);
      }
    });
  }

  return {
    load(key) {
      return new Promise(resolve => {
        if (!resolverMap.has(key)) {
          resolverMap.set(key, []);
          keyOrder.push(key);
        }
        resolverMap.get(key).push(resolve);
        if (!keySet.has(key)) keySet.add(key);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(dispatch);
        }
      });
    },
  };
}

let calls = 0;
const loader = createDeduplicatingLoader(async (ids) => {
  calls++;
  console.log(`Batch fired with unique ids: [${ids.join(", ")}]`);
  return ids.map(id => `result-${id}`);
});

async function main() {
  const results = await Promise.all([
    loader.load("a"),
    loader.load("b"),
    loader.load("a"), // duplicate
    loader.load("c"),
    loader.load("b"), // duplicate
  ]);
  console.log("Results:", results);
  console.log("Batch call count:", calls); // 1, with unique keys [a, b, c]
}

main();
```

</details>

## Project

**Expose your domain over both gRPC and GraphQL, with a GraphQL subscription backed by Redis pub/sub.**

Design and scaffold a **dual-exposure** service: a product catalogue that internal services consume over gRPC (fast, typed, binary) while an external web/mobile client queries it over GraphQL (flexible, self-describing). Real-time price change events are broadcast to GraphQL subscribers through Redis pub/sub so that all GraphQL server replicas receive and forward events to their connected clients.

### Architecture

```
Internal services
       │
       ▼
  gRPC Server (:50051)
       │
  ┌────┴──────────────────┐
  │   Domain Logic         │
  │   ProductService       │
  └────┬──────────────────┘
       │
  GraphQL Server (:4000)
       │
External clients (browser / mobile)
       │
  Redis PubSub ──► Subscription resolvers
  (shared across replicas)
```

### Acceptance criteria

1. **Proto contract**: a `product.proto` defines `Product { id, name, price }`, a `GetProduct(id)` unary RPC, and a `WatchPrices(Empty)` server-streaming RPC that emits price updates.
2. **gRPC server**: implements both RPCs; `WatchPrices` emits a price update every 500 ms for demonstration.
3. **GraphQL schema**: exposes `Query.product(id)`, `Mutation.updatePrice(id, price)`, and `Subscription.priceUpdated` which emits whenever a price changes.
4. **Shared domain layer**: the gRPC and GraphQL servers call the same `ProductService` class — no duplicated business logic.
5. **Redis pub/sub bridge**: `Mutation.updatePrice` publishes to a Redis channel; all GraphQL server instances subscribe and push to connected WebSocket clients.
6. **DataLoader**: the GraphQL layer uses a DataLoader to batch `product` lookups so fetching a list of products in one query issues a single batch call to the domain layer.

### Starter — the pure-logic core (DataLoader batcher, runs in-browser)

```js run
// Starter: the DataLoader batch coalescer at the heart of criterion 6.
// In production this wraps real DB calls; here we simulate with an in-memory map.

const productStore = new Map([
  ["p1", { id: "p1", name: "Widget", price: 9.99 }],
  ["p2", { id: "p2", name: "Gadget", price: 24.99 }],
  ["p3", { id: "p3", name: "Doohickey", price: 4.49 }],
]);

function createProductLoader() {
  let pendingIds = [];
  let pendingResolvers = [];
  let scheduled = false;

  function dispatch() {
    const ids = pendingIds;
    const resolvers = pendingResolvers;
    pendingIds = [];
    pendingResolvers = [];
    scheduled = false;

    // Simulate a single batched DB call
    console.log(`[DataLoader] batch fetch: [${ids.join(", ")}]`);
    const results = ids.map(id => productStore.get(id) ?? null);
    for (let i = 0; i < resolvers.length; i++) resolvers[i](results[i]);
  }

  return {
    load(id) {
      return new Promise(resolve => {
        pendingIds.push(id);
        pendingResolvers.push(resolve);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(dispatch);
        }
      });
    },
  };
}

// Simulate 3 GraphQL resolvers firing concurrently for a product list query
async function runQuery(ids) {
  const loader = createProductLoader(); // one per request
  const products = await Promise.all(ids.map(id => loader.load(id)));
  products.forEach(p => p && console.log(`  ${p.id}: ${p.name} $${p.price}`));
}

runQuery(["p1", "p2", "p3", "p1"]) // p1 appears twice — one batch, one fetch
  .then(() => console.log("Query complete"));
```

The complete project wires this loader into an Apollo Server context factory, connects a `graphql-redis-subscriptions` `RedisPubSub` instance to the `Subscription.priceUpdated` resolver, and implements the gRPC server with `@grpc/grpc-js` loading the same domain `ProductService`. See the module's example repo for the full implementation.

## Common pitfalls

> [!PITFALL] Conflating "internal" with "not needing a schema"
> Some teams run REST internally and skip schema tooling, thinking "it's just for us." Over time, undocumented internal APIs become maintenance nightmares — no type safety, no auto-generated clients, no contract tests. Whether you use REST, gRPC, or GraphQL internally, define the schema formally. gRPC's mandatory `.proto` is one of its underappreciated features: the schema discipline is non-optional.

> [!PITFALL] Using GraphQL where REST caching would have saved you
> A product catalogue with millions of reads per day and relatively slow-changing data is a perfect CDN-caching target. Putting it behind GraphQL (POST-only, no CDN caching by default) and then bolting on persisted queries, APQ, and a CDN plugin is significant complexity. When your primary concern is read-through caching at the edge, start with REST GET endpoints. Don't pay the GraphQL complexity tax for something REST solves for free.

## What you learned

- **REST** is best for public APIs, CDN caching, and simple CRUD — its HTTP semantics are its superpower.
- **gRPC** is best for internal service-to-service calls — protobuf is compact, HTTP/2 multiplexes, and streaming is first-class.
- **GraphQL** is best for flexible client-driven queries and aggregation gateways — it eliminates over/under-fetching but trades away trivial HTTP caching.
- A **dual-exposure** architecture (gRPC internally, GraphQL externally) gets the best of both: performance on the internal bus and flexibility at the edge.
- **Redis pub/sub** is the standard bridge for scaling GraphQL subscriptions across multiple server replicas.
- A **scoring model** based on consumer type, throughput, caching, streaming, and simplicity gives you a defensible, repeatable way to make this decision.

## Next steps

With the three major API paradigms mastered, the next module explores **microservices architecture** — how to decompose a monolith into services, manage inter-service communication (using the very protocols you just learned), and deal with distributed system concerns like service discovery, circuit breaking, and distributed tracing.
*/});
