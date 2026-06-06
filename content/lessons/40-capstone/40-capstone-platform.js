registerLessonSrc("40-capstone-platform", function () {/*
---
id: 40-capstone-platform
title: "Capstone B: A Scaled Real-Time Platform"
minutes: 30
level: principal
objectives:
  - Architect a multi-service real-time platform with a gateway, WebSocket service, pub/sub bus, and persistence
  - Trace a message from client to recipient across every service boundary
  - Design the data-flow and scaling strategy for each layer including OTel instrumentation
---

# Capstone B: A Scaled Real-Time Platform

## Why this matters

Real-time features — chat, collaborative editing, live dashboards, multiplayer — look simple
from the outside and are genuinely hard at scale. They force you to reason about stateful
connections, horizontal scaling across multiple nodes, fan-out to potentially thousands of
subscribers, backpressure, and reconnection. Designing this well, drawing on queues,
pub/sub, WebSockets, gRPC, observability, and persistence, is a signature principal-level
skill. This lesson builds the blueprint.

## Learning objectives

- Describe the full data-flow of a real-time message across: client → gateway → WS service → pub/sub → peer WS service → client
- Choose the right technology for each layer (Redis Streams vs Pub/Sub, Kafka vs SQS, PostgreSQL vs TimescaleDB)
- Design horizontal scaling for a stateful WebSocket tier without dropping messages
- Instrument every service boundary with OpenTelemetry spans so you can trace a message end-to-end

## Platform architecture

The platform has five logical services. Each is deployed as a separate container and scaled
independently:

```
┌─────────────────────────────────────────────────────────────────┐
│  Clients (browser / mobile)                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS / WSS
┌────────────────────▼────────────────────────────────────────────┐
│  API Gateway  (HTTP/2, TLS termination, auth, rate-limit)       │
└──────┬─────────────────────────────┬──────────────────────────┘
       │ REST/gRPC                   │ WebSocket upgrade
┌──────▼──────────┐        ┌─────────▼────────────────────────────┐
│  REST API       │        │  WebSocket Service  (multiple nodes)  │
│  (Fastify)      │        │  - rooms mapped to connections        │
└──────┬──────────┘        └─────────┬────────────────────────────┘
       │ write                       │ publish / subscribe
┌──────▼────────────────────────────▼────────────────────────────┐
│  Redis Pub/Sub (fan-out across WS nodes)                        │
│  + Redis Streams (durable event log, consumer groups)           │
└────────────────────────────┬────────────────────────────────────┘
                             │ async, at-least-once
┌────────────────────────────▼────────────────────────────────────┐
│  Persistence Worker  (reads Streams, writes PostgreSQL)         │
└─────────────────────────────────────────────────────────────────┘
```

> [!PRINCIPAL] The hardest problem: stateful WebSockets across multiple nodes
> HTTP is stateless — any load-balanced node can serve any request. WebSocket connections
> are stateful and long-lived. Client A is connected to node 1; Client B is connected to
> node 2. When A sends a message to B's room, node 1 must somehow deliver it to node 2.
> Redis Pub/Sub solves this: every WS node subscribes to all room channels. When any node
> receives a message for a room, it publishes to Redis; every other node receives that
> publication and forwards it to any local client in that room. This is the canonical
> fan-out pattern for scaled WebSocket tiers.

## The API Gateway layer

The gateway is an nginx or Envoy proxy (or a Node process using `node:http2`) that does:

- **TLS termination** — clients speak TLS; internal traffic is plain HTTP/2
- **Authentication** — validates JWT; attaches `userId` and `tenantId` to the forwarded request
- **Rate limiting** — per-user, per-tenant, per-IP using a token bucket in Redis
- **WebSocket upgrade** — upgrades the connection and proxies it to the WS service tier

> [!NOTE] Why not merge the gateway and WS service?
> Separation lets you scale and deploy them independently. The gateway is CPU-light and
> replaces rarely; the WS tier is memory-heavy (one socket per connected client) and
> scales horizontally. Keeping them separate means you can have 10 WS nodes and 2 gateway
> nodes without over-provisioning either.

## The WebSocket Service

Each WS node maintains an in-memory map of `roomId → Set<WebSocket>`. On receiving a
message from a client:

```js
// Read-only: simplified WS node message handler
import { WebSocketServer } from "ws";
import { createClient } from "redis";

const wss = new WebSocketServer({ port: 4000 });
const pub = createClient(); // for publishing
const sub = createClient(); // for subscribing — MUST be a separate connection
await pub.connect(); await sub.connect();

const rooms = new Map(); // roomId → Set<WebSocket>

function joinRoom(ws, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  sub.subscribe(roomId, (message) => {
    for (const client of rooms.get(roomId) ?? []) {
      if (client.readyState === 1) client.send(message);
    }
  });
}

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "join") { joinRoom(ws, msg.roomId); return; }
    if (msg.type === "chat") {
      const envelope = JSON.stringify({ from: msg.userId, text: msg.text });
      await pub.publish(msg.roomId, envelope);
      await pub.xAdd("events", "*", { roomId: msg.roomId, payload: envelope });
    }
  });
  ws.on("close", () => {
    for (const [, set] of rooms) set.delete(ws);
  });
});
```

> [!OUTPUT]
> WS service listening on 4000

## Redis: Pub/Sub vs Streams

Use both, for different purposes:

| | Redis Pub/Sub | Redis Streams |
|---|---|---|
| Delivery | fire-and-forget | at-least-once (consumer groups) |
| Persistence | none | configurable (`MAXLEN`) |
| Fan-out | instant, all subscribers | pull-based, per consumer group |
| Use here | live delivery to WS nodes | durable log for persistence worker |

The WS node publishes to both simultaneously. Pub/Sub delivers the message in milliseconds
to all connected WS nodes; the Stream gives the persistence worker a reliable queue to
consume from.

## Persistence and the event log

The persistence worker is a standalone Node process that reads from the Redis Stream
using consumer groups (so multiple workers share the load and a crash does not lose events):

```js
// Read-only: persistence worker reading from Redis Streams
const STREAM = "events";
const GROUP = "persistence";

async function startWorker(redis, db) {
  await redis.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true }).catch(() => {});

  while (true) {
    const results = await redis.xReadGroup(GROUP, "worker-1", [
      { key: STREAM, id: ">" }
    ], { COUNT: 100, BLOCK: 1000 });

    if (!results) continue;
    for (const { messages } of results) {
      for (const { id, message } of messages) {
        await db.query(
          "INSERT INTO events (room_id, payload, created_at) VALUES ($1, $2, NOW())",
          [message.roomId, message.payload]
        );
        await redis.xAck(STREAM, GROUP, id);
      }
    }
  }
}
```

> [!WARNING] XACK after successful write only
> Acknowledge the message (`XACK`) **after** the database write succeeds, not before.
> If you ACK first and the DB write fails, the event is silently lost. At-least-once
> semantics mean you write idempotently (use the Redis Stream ID as the database primary key
> or a UNIQUE constraint) so re-delivery on crash is safe.

## OpenTelemetry: tracing across services

Every service boundary is a potential performance cliff and a debugging dead-end without
distributed tracing. Use the OpenTelemetry SDK to propagate a `traceparent` header from
the client through the gateway to the WS node and into the persistence worker:

```js
// Read-only: OTel span around a message fan-out
import { trace, context, propagation } from "@opentelemetry/api";

const tracer = trace.getTracer("ws-service");

async function handleMessage(raw, carrier) {
  const ctx = propagation.extract(context.active(), carrier);
  const span = tracer.startSpan("ws.message.fanout", {}, ctx);

  try {
    const msg = JSON.parse(raw);
    span.setAttributes({ "room.id": msg.roomId, "msg.type": msg.type });
    await fanOutToRoom(msg);
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: 2, message: err.message });
  } finally {
    span.end();
  }
}
```

## Try it yourself

This runnable example simulates the cross-node fan-out using an in-process shared bus —
the same logical structure as Redis Pub/Sub across multiple WS nodes.

```js run
// Simulated multi-node WebSocket platform with shared pub/sub bus
// No Node or Redis APIs — pure logic, fully runnable.

// ---- Shared pub/sub bus (simulates Redis Pub/Sub) ----
class PubSubBus {
  constructor() { this._channels = new Map(); }

  subscribe(channel, handler) {
    if (!this._channels.has(channel)) this._channels.set(channel, new Set());
    this._channels.get(channel).add(handler);
  }

  publish(channel, message) {
    for (const handler of this._channels.get(channel) ?? [])
      handler(message);
  }
}

// ---- A single WebSocket node ----
class WsNode {
  constructor(id, bus) {
    this.id = id;
    this._bus = bus;
    this._rooms = new Map(); // roomId → Set<clientId>
    this._clients = new Map(); // clientId → { id, received: [] }
  }

  connect(clientId) {
    this._clients.set(clientId, { id: clientId, received: [] });
    return clientId;
  }

  join(clientId, roomId) {
    if (!this._rooms.has(roomId)) this._rooms.set(roomId, new Set());
    this._rooms.get(roomId).add(clientId);

    // Subscribe to the room channel on the bus (idempotent per channel per node)
    const channelKey = `room:${roomId}`;
    if (!this._subscribed) this._subscribed = new Set();
    if (!this._subscribed.has(channelKey)) {
      this._subscribed.add(channelKey);
      this._bus.subscribe(channelKey, (envelope) => {
        this._deliverToRoom(roomId, envelope);
      });
    }
    console.log(`[${this.id}] client ${clientId} joined room ${roomId}`);
  }

  _deliverToRoom(roomId, envelope) {
    for (const clientId of this._rooms.get(roomId) ?? []) {
      const client = this._clients.get(clientId);
      if (client) {
        client.received.push(envelope);
        console.log(`[${this.id}] delivered to ${clientId}: "${envelope.text}" from ${envelope.from}`);
      }
    }
  }

  send(fromClientId, roomId, text) {
    const envelope = { from: fromClientId, text, ts: Date.now() };
    console.log(`[${this.id}] publishing to room:${roomId}`);
    this._bus.publish(`room:${roomId}`, envelope);
  }

  getReceived(clientId) {
    return this._clients.get(clientId)?.received ?? [];
  }
}

// ---- Persistent event log (simulates Redis Streams + PostgreSQL) ----
const eventLog = [];
function persistenceWorker(bus) {
  // Subscribe to a special "persist" channel
  bus.subscribe("persist", (event) => {
    eventLog.push({ ...event, savedAt: Date.now() });
  });
}

// ---- Wire it up: 3 nodes, 1 shared bus ----
const bus = new PubSubBus();
persistenceWorker(bus);

const node1 = new WsNode("node-1", bus);
const node2 = new WsNode("node-2", bus);
const node3 = new WsNode("node-3", bus);

// Clients connect to different nodes
node1.connect("alice");
node2.connect("bob");
node3.connect("carol");

// All join the same room
node1.join("alice", "room-general");
node2.join("bob", "room-general");
node3.join("carol", "room-general");

console.log("\n--- Alice sends a message from node-1 ---");
node1.send("alice", "room-general", "Hello from Alice!");

console.log("\n--- Bob sends a message from node-2 ---");
node2.send("bob", "room-general", "Hey everyone!");

console.log("\n--- Messages received per client ---");
console.log("alice received:", node1.getReceived("alice").length, "messages");
console.log("bob received:", node2.getReceived("bob").length, "messages");
console.log("carol received:", node3.getReceived("carol").length, "messages");
```

## Exercise: add a private message (DM) channel

Extend the simulation above so that `sendDm(fromClientId, toClientId, text)` delivers a
message only to the target client, regardless of which node they are connected to.

<details>
<summary>Show solution</summary>

```js run
// The key insight: use a per-client channel (e.g., "dm:alice") so any node
// can publish a DM and only the node hosting that client delivers it.

class PubSubBus {
  constructor() { this._channels = new Map(); }
  subscribe(ch, fn) {
    if (!this._channels.has(ch)) this._channels.set(ch, new Set());
    this._channels.get(ch).add(fn);
  }
  publish(ch, msg) { for (const fn of this._channels.get(ch) ?? []) fn(msg); }
}

class WsNode {
  constructor(id, bus) {
    this.id = id; this._bus = bus;
    this._clients = new Map(); this._subscribed = new Set();
  }
  connect(clientId) {
    this._clients.set(clientId, { id: clientId, received: [] });
    const dmChannel = `dm:${clientId}`;
    if (!this._subscribed.has(dmChannel)) {
      this._subscribed.add(dmChannel);
      this._bus.subscribe(dmChannel, (envelope) => {
        const client = this._clients.get(clientId);
        if (client) {
          client.received.push(envelope);
          console.log(`[${this.id}] DM to ${clientId}: "${envelope.text}" from ${envelope.from}`);
        }
      });
    }
  }
  sendDm(fromClientId, toClientId, text) {
    this._bus.publish(`dm:${toClientId}`, { from: fromClientId, text });
  }
  getReceived(clientId) { return this._clients.get(clientId)?.received ?? []; }
}

const bus = new PubSubBus();
const node1 = new WsNode("node-1", bus);
const node2 = new WsNode("node-2", bus);

node1.connect("alice");
node2.connect("bob");

console.log("Alice sends a DM to Bob:");
node1.sendDm("alice", "bob", "Hey Bob, private message!");

console.log("Bob sends a DM to Alice:");
node2.sendDm("bob", "alice", "Got it, Alice!");

console.log("Alice received DMs:", node1.getReceived("alice").length);
console.log("Bob received DMs:", node2.getReceived("bob").length);
```

</details>

## Project

**Architect and partially implement a scaled real-time platform** that could serve a
production team-chat product. Use the architecture above as your starting point.

**Acceptance criteria:**

1. **Gateway service** — a Fastify or raw `node:http2` server that validates JWTs
   (`jose`), enforces a per-user rate limit (token bucket in Redis), and proxies both
   REST and WebSocket connections to downstream services.
2. **WebSocket service** — at least two instances behind the gateway; each maintains
   in-process room maps and uses Redis Pub/Sub for cross-node fan-out; graceful
   shutdown closes all connections and unsubscribes cleanly.
3. **Redis Streams persistence** — a standalone worker reads from a Redis Stream using
   consumer groups and writes to PostgreSQL idempotently (Stream entry ID as deduplication
   key); at-least-once delivery with retry on DB failure.
4. **REST API** — `GET /rooms/:id/history?limit=50&before=<timestamp>` served from
   PostgreSQL; `POST /rooms` and `POST /rooms/:id/members` for room management; all routes
   authenticated by the gateway.
5. **OpenTelemetry** — every service initialises the OTLP exporter; every cross-service
   message propagates a `traceparent`; end-to-end traces are visible in a local
   Grafana Tempo instance (`docker-compose up`).
6. **Load test** — `artillery` or `k6` script simulates 500 concurrent WebSocket clients
   in 10 rooms; the system sustains ≥ 5 000 messages/second with p99 delivery latency
   < 150 ms; results are committed as `docs/load-test-results.md`.

## Common pitfalls

> [!PITFALL] Subscribing to Redis once per message instead of once per room per node
> A common mistake is calling `sub.subscribe(roomId, handler)` inside the message handler —
> so every message triggers a new subscription. Redis has a connection-level subscription
> count limit and you will exhaust it. Subscribe once when the first client joins the room,
> and unsubscribe when the last client leaves. Track subscription state in a Set on the node.

A second classic mistake: **not handling backpressure on the WebSocket**. If a client is
slow and you keep pushing messages, the socket's send buffer fills and Node silently drops
writes. Check `ws.bufferedAmount` (browser) or the writable stream's drain event (server)
and pause fan-out when the client cannot keep up.

## What you learned

- A scaled real-time platform has five distinct layers each with a different scaling axis
- Redis Pub/Sub handles in-flight fan-out; Redis Streams handle durable, replayable event logs
- WebSocket nodes are stateful — pub/sub is the canonical pattern for cross-node delivery
- Persistence workers use consumer groups for load sharing and ACK-after-write for safety
- OTel `traceparent` propagation across every boundary is what makes distributed debugging possible

## Next steps

The final capstone — Capstone C — zooms into the job-orchestration layer: you will design
and build a BullMQ-like engine with queues, workers, retries, priorities, DAG workflows,
and a dashboard, then assemble everything into a horizontally-scaled, fully documented
production system.
*/});
