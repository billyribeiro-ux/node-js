registerLessonSrc("29-boundaries", function () {/*
---
id: 29-boundaries
title: "Service Boundaries & Communication"
minutes: 26
level: principal
objectives:
  - Evaluate when microservices help and when they hurt, using concrete tradeoffs
  - Define service boundaries using Domain-Driven Design bounded contexts
  - Choose between synchronous (REST/gRPC) and asynchronous (event) communication patterns
---

# Service Boundaries & Communication

## Why this matters

Almost every engineering team eventually debates "should we break this monolith apart?" Getting the answer wrong is expensive either way: slice too early and you have a distributed monolith with all the operational pain and none of the benefits; slice too late and every team is blocked by the same codebase. Understanding *where* to draw the lines — and *how* the resulting pieces talk to each other — is one of the highest-leverage architectural skills you can develop.

## Learning objectives

- Explain the genuine tradeoffs between a monolith and microservices, not the hype.
- Use **bounded contexts** from Domain-Driven Design to identify good service boundaries.
- Choose between sync (REST, gRPC) and async (events, queues) communication with intention.
- Sketch an **API gateway** and **service registry** and explain why each exists.

## Monolith vs microservices: an honest comparison

A **monolith** is a single deployable unit. All modules share the same process, memory, and database. It is not a dirty word — it is often the correct choice, especially early in a product's life.

A **microservices** architecture splits the system into independently deployable services that communicate over a network. Each service owns its data and can be deployed, scaled, and rewritten independently.

| Dimension | Monolith | Microservices |
|---|---|---|
| Deployment | One artifact | Many artifacts, CI pipelines per service |
| Scaling | Scale everything | Scale only the bottleneck |
| Data consistency | Transactions | Eventual consistency, sagas |
| Team ownership | Shared codebase | Team owns a service end-to-end |
| Latency | In-process calls | Network hops (add 1–10 ms per call) |
| Failure modes | Process crash | Cascading failures, partial degradation |
| Operational complexity | Low | High (service mesh, observability, discovery) |

> [!PRINCIPAL] Start with a well-structured monolith
> The microservices hype obscures a key fact: the hard part is finding good boundaries, and you usually cannot find them without first building the thing. A monolith with clear module boundaries (enforced via package structure or a monorepo) lets you learn where the seams naturally fall. Extract services when: (a) a module has genuinely different scaling needs, (b) teams are blocked on each other's code, or (c) you need a different deployment cadence. Never extract for its own sake.

## Bounded contexts: where the lines should go

**Domain-Driven Design (DDD)** gives us the concept of a **bounded context** — a subsystem where a single coherent domain model applies. Within a bounded context, terms have precise meanings. Outside of it, the same word might mean something different.

Consider an e-commerce platform. "Order" means something specific to:

- **Inventory** — a reservation of stock
- **Payments** — a charge event with a total
- **Shipping** — a parcel with a destination address
- **Customer support** — a ticket with a history

Each of these is a natural bounded context. When you find teams constantly having to coordinate on the meaning of the same noun, you have found a context boundary worth enforcing as a service boundary.

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Catalogue   │    │   Orders     │    │  Inventory   │
│  Service     │    │   Service    │    │  Service     │
│              │    │              │    │              │
│  product     │    │  order       │    │  reservation │
│  listing     │    │  line item   │    │  stock level │
└──────────────┘    └──────────────┘    └──────────────┘
```

A **good** boundary means the service can do its job without constantly calling its neighbours. If service A calls service B for every single request, they are really one service — merge them.

## Synchronous communication: REST and gRPC

Sync communication means the caller waits for an answer before proceeding. It is natural when the result is needed immediately.

**REST over HTTP** is the default for most teams. It is human-readable, tooling is abundant, and every language speaks HTTP. Use it for:
- Client-to-service calls (browsers, mobile apps)
- Service-to-service calls where latency SLAs are loose (< 50 ms)
- Public APIs

**gRPC** uses Protocol Buffers and HTTP/2. It is faster (binary encoding, no HTTP overhead), strongly typed (protobuf schema as a contract), and supports streaming. Use it for:
- High-throughput internal service-to-service calls
- When you need strict schema enforcement across teams
- When you need streaming (server-push, bidi)

```js
// Conceptual: what a service client looks like in each style

// REST client (using fetch)
const order = await fetch("http://orders-svc/orders/42").then(r => r.json());

// gRPC client (using @grpc/grpc-js)
// const order = await ordersClient.getOrder({ id: 42 });
// — strongly typed, ~3x smaller on the wire, same logical call
```

The key cost of sync calls: **temporal coupling**. If `orders-svc` is down, whatever depends on it is also degraded. Every new synchronous dependency adds to your blast radius.

## Asynchronous communication: events and queues

Async communication means the sender fires a message and moves on. The receiver processes it later. This breaks temporal coupling — the sender does not care whether the receiver is up right now.

**Event-driven** — a service emits events when something meaningful happens. Interested services subscribe and react. No point-to-point coupling.

```
OrdersService ──► "order.placed" ──► InventoryService (reserves stock)
                                  └► EmailService    (sends confirmation)
                                  └► AnalyticsService (records event)
```

**Point-to-point queues** — sender puts a task on a queue addressed to one receiver. Used for work distribution (job queues, command patterns).

> [!NOTE] Events are facts; commands are requests
> An event ("order.placed") is a statement of what happened — the publisher does not care who listens. A command ("reserve-stock") is a request to do something specific. Mixing these up leads to tight coupling hiding inside an async channel.

Choose async when:
- A result is not needed immediately (emails, notifications, analytics)
- You need to decouple scaling (the publisher bursts; the consumer can drain at its own pace)
- You want resilience (the queue buffers work during downtime)

## API gateway

When clients talk to many services directly, they face a fragmented API surface: different ports, authentication schemes, versioning. An **API gateway** is a single entry point that:

- Routes requests to the right backend service
- Handles cross-cutting concerns: authentication, rate limiting, CORS, request logging
- Can aggregate multiple downstream calls into one response (API composition)

```
Browser / Mobile
      │
      ▼
 ┌──────────┐
 │  Gateway │  ← auth, rate-limit, routing
 └──────────┘
   │    │    │
   ▼    ▼    ▼
 Orders Inventory Users
  svc    svc     svc
```

In Node.js, teams commonly use a thin Fastify or Express service as a gateway, or managed solutions like AWS API Gateway, Kong, or Envoy.

## Service discovery

In a static world, services have fixed IP addresses. In a dynamic container environment (Kubernetes, ECS), instances come and go. **Service discovery** solves this: each service registers itself at startup and deregisters on shutdown. Callers look up the address at call time.

Two patterns:
- **Client-side discovery** — the caller queries the registry and picks an instance itself (with load-balancing logic client-side).
- **Server-side discovery** — the caller asks a load balancer; the load balancer queries the registry and forwards the request.

## Try it yourself

A service registry with round-robin load balancing — the core primitive of client-side discovery. Pure JavaScript, fully runnable.

```js run
// In-memory service registry with round-robin instance selection

function createRegistry() {
  const services = new Map(); // name -> [{ id, address, healthy }]
  const cursors  = new Map(); // name -> current round-robin index

  return {
    register(name, id, address) {
      if (!services.has(name)) services.set(name, []);
      const instances = services.get(name);
      // Avoid duplicate registration
      if (!instances.find(i => i.id === id)) {
        instances.push({ id, address, healthy: true });
        console.log(`[registry] registered ${name}/${id} at ${address}`);
      }
    },

    deregister(name, id) {
      if (!services.has(name)) return;
      const before = services.get(name).length;
      services.set(name, services.get(name).filter(i => i.id !== id));
      const after = services.get(name).length;
      if (before !== after) console.log(`[registry] deregistered ${name}/${id}`);
    },

    markHealth(name, id, healthy) {
      const inst = services.get(name)?.find(i => i.id === id);
      if (inst) inst.healthy = healthy;
    },

    discover(name) {
      const healthy = (services.get(name) || []).filter(i => i.healthy);
      if (healthy.length === 0) return null;
      const idx = (cursors.get(name) || 0) % healthy.length;
      cursors.set(name, idx + 1);
      return healthy[idx];
    },

    list(name) {
      return services.get(name) || [];
    }
  };
}

// --- demo ---
const registry = createRegistry();

// Three instances of the orders service register on startup
registry.register("orders", "orders-1", "10.0.0.1:3000");
registry.register("orders", "orders-2", "10.0.0.2:3000");
registry.register("orders", "orders-3", "10.0.0.3:3000");

// Round-robin across healthy instances
console.log("\nRound-robin discovery:");
for (let i = 0; i < 5; i++) {
  const inst = registry.discover("orders");
  console.log(`  request ${i + 1} -> ${inst.address}`);
}

// One instance goes unhealthy
registry.markHealth("orders", "orders-2", false);
console.log("\nAfter orders-2 becomes unhealthy:");
for (let i = 0; i < 4; i++) {
  const inst = registry.discover("orders");
  console.log(`  request ${i + 1} -> ${inst.address}`);
}

// Deregister on shutdown
registry.deregister("orders", "orders-1");
console.log("\nAfter orders-1 deregisters:");
console.log("  remaining:", registry.list("orders").map(i => i.address));

// Discover unknown service
const missing = registry.discover("payments");
console.log("\nDiscover unknown service 'payments':", missing);
```

## Exercise

**Challenge:** Extend the registry so each instance carries a `weight` (integer 1–10). Discover instances with weighted random selection — an instance with weight 2 should be chosen roughly twice as often as one with weight 1. This models traffic splitting (canary deployments).

<details>
<summary>Show solution</summary>

```js run
function createWeightedRegistry() {
  const services = new Map();

  return {
    register(name, id, address, weight = 1) {
      if (!services.has(name)) services.set(name, []);
      services.get(name).push({ id, address, weight, healthy: true });
    },
    markHealth(name, id, healthy) {
      const inst = services.get(name)?.find(i => i.id === id);
      if (inst) inst.healthy = healthy;
    },
    discover(name) {
      const healthy = (services.get(name) || []).filter(i => i.healthy);
      if (healthy.length === 0) return null;
      const total = healthy.reduce((s, i) => s + i.weight, 0);
      let r = Math.random() * total;
      for (const inst of healthy) {
        r -= inst.weight;
        if (r <= 0) return inst;
      }
      return healthy[healthy.length - 1];
    }
  };
}

const reg = createWeightedRegistry();
reg.register("orders", "stable",  "10.0.0.1:3000", 9); // 90 % traffic
reg.register("orders", "canary",  "10.0.0.2:3000", 1); // 10 % traffic

const counts = { stable: 0, canary: 0 };
for (let i = 0; i < 1000; i++) {
  const inst = reg.discover("orders");
  counts[inst.id]++;
}
console.log("stable hits:", counts.stable, "(expected ~900)");
console.log("canary hits:", counts.canary, "(expected ~100)");
```

</details>

## Common pitfalls

> [!PITFALL] Extracting services before you understand the domain
> Splitting a monolith prematurely freezes bad boundaries in place. Changing a boundary later means migrating data, rewriting APIs, and coordinating multiple teams. A wrong service boundary is more expensive than a monolith. Use the "strangler fig" pattern: run the service and the monolith in parallel, migrating traffic gradually, so you can validate the boundary is right before committing.

> [!PITFALL] Synchronous chains that span many services
> If request A calls B calls C calls D synchronously, your end-to-end latency is the sum of all four, and your availability is the *product* of all four uptime percentages (0.99 × 0.99 × 0.99 × 0.99 = 0.96). Four-nines uptime for each service gives you only 96.1 % end-to-end. Prefer async where a response is not immediately needed.

## What you learned

- A monolith is often the right starting point; microservices make sense when scaling, team ownership, or deployment independence is genuinely needed.
- **Bounded contexts** (DDD) are the right lens for service boundary decisions — find where domain terms diverge.
- **Synchronous** (REST, gRPC) communication adds temporal coupling; use it when results are needed immediately.
- **Asynchronous** (events, queues) communication decouples producers from consumers in time and scale.
- An **API gateway** centralises routing, auth, and rate limiting; a **service registry** enables dynamic service discovery with health-aware load balancing.

## Next steps

Good boundaries are only half the story — services in a distributed system *will* fail. Next we look at how to build resilient services that survive the inevitable with timeouts, retries, and the circuit breaker pattern.
*/});
