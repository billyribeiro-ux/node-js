registerLessonSrc("26-scaling-realtime", function () {/*
---
id: 26-scaling-realtime
title: "Scaling Real-Time with a Redis Adapter"
minutes: 28
level: principal
objectives:
  - Explain why real-time state breaks when multiple server instances exist behind a load balancer
  - Configure the Socket.IO Redis adapter to fan out events across instances via pub/sub
  - Evaluate sticky sessions and SSE as complementary strategies
---

# Scaling Real-Time with a Redis Adapter

## Why this matters

A single Socket.IO process can comfortably handle tens of thousands of concurrent connections. But traffic grows, you deploy a second instance, and suddenly half of your users stop receiving messages from the other half — because the two processes share nothing. This is the **multi-instance problem**, and every production real-time system must solve it. The canonical solution in the Node.js ecosystem is a **Redis pub/sub adapter** that turns Redis into a shared message bus: one instance publishes, Redis fans out to all instances, each instance delivers to its local clients. Understanding this pattern is what separates a toy chat app from a production-grade one.

## Learning objectives

- Describe the **multi-instance problem** and why it silently breaks room broadcasts.
- Configure `@socket.io/redis-adapter` to share rooms and events across Node processes.
- Compare **sticky sessions**, the Redis adapter, and **SSE** as complementary tools.

## The multi-instance problem

Imagine two Socket.IO server instances (A and B) behind a round-robin load balancer. Alice's WebSocket connection lands on instance A; Bob's lands on instance B. Alice sends a message to room `"general"`:

```
Alice ──WS──▶ Instance A
                  │
                  ▼
            io.to("general").emit(msg)
                  │
             [A's in-memory room map]
                  │ only reaches clients on A
                  ▼
              Carol (connected to A) ✓
              Bob   (connected to B) ✗  ← never receives it
```

Instance A has no knowledge of Bob. `io.to("general")` looks up A's local in-memory room map, finds Carol, and stops there. Bob is invisible to A.

> [!PITFALL] This bug is silent in development
> You almost always test with a single process locally, so everything works. The breakage only surfaces when you horizontally scale — often in production under load. If you're building anything real-time, plan for multi-instance from day one.

## The Redis pub/sub adapter

**Redis pub/sub** is a lightweight messaging primitive: clients `SUBSCRIBE` to a channel and receive any message another client `PUBLISH`es to that channel. The Socket.IO Redis adapter uses it as a shared backbone:

1. When instance A calls `io.to("general").emit("chat", msg)`, the adapter **publishes** a serialised packet to a Redis channel.
2. Redis delivers that packet to all instances subscribed to that channel (A and B).
3. Each instance deserialises the packet and delivers it to its locally connected clients who are in room `"general"`.

```
Alice ──WS──▶ Instance A
                  │
                  ├──PUBLISH──▶ Redis ──▶ Instance A (self, skipped)
                  │                  └──▶ Instance B
                  │                            │
                  ▼                            ▼
             Carol (A) ✓                  Bob (B) ✓
```

### Installing

```bash
npm install @socket.io/redis-adapter ioredis
```

### Wiring it up

```js
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "ioredis";

const pubClient = createClient({ host: "localhost", port: 6379 });
const subClient = pubClient.duplicate(); // Redis requires separate pub/sub clients

await Promise.all([pubClient.connect(), subClient.connect()]);

const httpServer = createServer();
const io = new Server(httpServer);
io.adapter(createAdapter(pubClient, subClient));

io.on("connection", (socket) => {
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("message", ({ roomId, text }) => {
    // This emit now fans out across ALL instances via Redis
    io.to(roomId).emit("message", { from: socket.id, text });
  });
});

httpServer.listen(process.env.PORT ?? 3000);
console.log("Instance running on port", process.env.PORT ?? 3000);
```

> [!OUTPUT]
> Instance running on port 3000
> (on instance B, port 3001)
> Instance running on port 3001

The application code is **unchanged**. You added three lines: import the adapter, create two Redis clients, and call `io.adapter(...)`. All `emit`, `to`, `broadcast` calls now automatically fan out.

> [!PRINCIPAL] The adapter is eventually consistent, not atomic
> The Redis adapter serialises and re-delivers events asynchronously. Under network partition or Redis downtime, messages can be lost. For systems where every message must be persisted (banking, audit logs), pair the adapter with a persistent message store (e.g., write each message to Postgres in the event handler, then emit). Real-time delivery is best-effort; durability requires a second mechanism.

## Room state across instances

There is a subtlety: room *membership* is still tracked per-instance by default. If you call `io.sockets.adapter.rooms` on instance A, you only see A's clients. For presence counts that reflect the global picture, use the Redis adapter's `serverCount()` and `fetchSockets()` APIs:

```js
// How many sockets across ALL instances are in "general"?
const sockets = await io.in("general").fetchSockets();
console.log("global member count:", sockets.length);

// Emit to a specific socket ID regardless of which instance it's on
await io.in(targetSocketId).emit("dm", { text: "hello" });
```

> [!NOTE] fetchSockets() is async because it queries all instances via Redis
> In a single-process setup it returns synchronously, but the API is always Promise-based to work correctly in both modes. Always `await` it.

## Sticky sessions

Even with the Redis adapter handling broadcasts, there is one remaining requirement: **WebSocket connections must stay on the same instance for the duration of the session**. WebSocket is a persistent TCP connection, so the load balancer must route all traffic for a given client to the same upstream — this is called a **sticky session** (or session affinity).

```
Load balancer configuration (nginx example):

upstream socketio_servers {
  ip_hash;  // route a given client IP to the same upstream always
  server 10.0.0.1:3000;
  server 10.0.0.2:3000;
}
```

Without sticky sessions, the HTTP upgrade request and subsequent WebSocket frames may hit different instances, immediately terminating the connection. Most cloud load balancers (AWS ALB, GCP HTTPS LB, nginx) support sticky sessions via a cookie or IP hash.

> [!NOTE] Socket.IO's HTTP long-polling fallback needs sticky sessions even more urgently
> With long-polling, each HTTP request in the same logical session must hit the same instance. Without stickiness, polling sessions break instantly. WebSocket is more tolerant — once the upgrade completes, all frames travel the same TCP connection.

## SSE as a complement

**Server-Sent Events (SSE)** is a simpler alternative for unidirectional push — server-to-client only, no client-to-server messages over the same channel. SSE uses plain HTTP, works through proxies that block WebSocket, and is natively supported by browsers with automatic reconnection.

```js
// SSE endpoint in an Express app
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("connected", { ts: Date.now() });

  // Subscribe to Redis so this instance forwards cross-node events
  const sub = redisClient.duplicate();
  sub.subscribe("sse:updates", (message) => {
    send("update", JSON.parse(message));
  });

  req.on("close", () => {
    sub.unsubscribe();
    sub.disconnect();
  });
});
```

> [!OUTPUT]
> event: connected
> data: {"ts":1717660800000}
> event: update
> data: {"type":"score","value":42}

Use SSE when you need push-only (dashboards, live feeds, notification banners) and prefer HTTP simplicity. Use WebSocket/Socket.IO when you need bidirectional communication (chat, collaborative editing, games).

## Try it yourself

The runnable block below simulates the cross-instance fan-out that the Redis adapter provides. A shared `PubSubBus` (standing in for Redis) connects two independent node instances. When instance A broadcasts to a room, the bus delivers the packet to B, which then delivers to its local clients.

```js run
// Simulate multi-instance pub/sub fan-out — the core idea behind the Redis adapter.

// The "Redis" bus: a simple in-process pub/sub event hub
function createBus() {
  const subscribers = new Map(); // channel → [fn]
  return {
    publish(channel, message) {
      for (const fn of subscribers.get(channel) ?? []) fn(message);
    },
    subscribe(channel, fn) {
      if (!subscribers.has(channel)) subscribers.set(channel, []);
      subscribers.get(channel).push(fn);
    }
  };
}

// A single server instance with its own in-memory room map
function createInstance(name, bus) {
  const rooms = new Map(); // roomId → Set<clientId>

  // Subscribe to cross-node packets from the bus
  bus.subscribe("io:packet", ({ fromInstance, roomId, event, data }) => {
    if (fromInstance === name) return; // don't echo to self
    deliver(roomId, event, data, null);
  });

  function join(clientId, roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(clientId);
    console.log(`[${name}] ${clientId} joined ${roomId}`);
  }

  function deliver(roomId, event, data, skipId) {
    for (const id of rooms.get(roomId) ?? []) {
      if (id === skipId) continue;
      console.log(`  [${name}→${id}] ${event}:`, data);
    }
  }

  function emit(fromClientId, roomId, event, data) {
    // Deliver to local clients (excluding sender)
    deliver(roomId, event, data, fromClientId);
    // Publish so other instances can deliver to their local clients
    bus.publish("io:packet", { fromInstance: name, roomId, event, data });
  }

  return { join, emit };
}

// Two instances sharing one bus
const bus = createBus();
const instanceA = createInstance("A", bus);
const instanceB = createInstance("B", bus);

// Clients connect to their respective instances
instanceA.join("alice", "general");
instanceA.join("carol", "general");
instanceB.join("bob",   "general");
instanceB.join("dave",  "music");

console.log("\n-- Alice (on A) sends a message to general --");
instanceA.emit("alice", "general", "chat", { text: "hello from alice" });

console.log("\n-- Dave (on B) sends a message to music --");
instanceB.emit("dave", "music", "chat", { text: "any jazz fans?" });
// (only dave is in music; no other instance has music members)
```

## Project

**Build a multi-room real-time chat with presence and typing indicators that scales horizontally across instances.**

### Acceptance criteria

1. **Room join/leave**: clients emit `join-room` with a room ID and username; the server adds them to the room and broadcasts a `presence` event with the current online count to all room members.
2. **Chat messages**: clients emit `message` with `{ roomId, text }`; the server broadcasts it to the room with sender metadata (username, timestamp); the emit must work correctly when the sender and recipient are on different instances.
3. **Typing indicators**: clients emit `typing-start` / `typing-stop`; the server broadcasts `typing` events carrying the list of currently-typing usernames to others in the room.
4. **Redis adapter**: the server uses `@socket.io/redis-adapter` so that all broadcasts reach clients regardless of which instance they are connected to.
5. **Graceful disconnect**: on `disconnect`, the server removes the user from all rooms, cleans up typing state, and broadcasts updated presence counts to affected rooms.
6. **Acknowledgements**: `join-room` uses an acknowledgement to confirm success or return an error (e.g., invalid room name); the client can `await socket.emitWithAck("join-room", ...)`.

### Starter — the rooms manager (pure logic, runnable)

This starter implements acceptance criteria 1, 3, and 5 at the pure-logic level. Wire it into a real Socket.IO server and add the Redis adapter to complete the project.

```js run
// Rooms manager — the pure-logic core of the project.
// Covers: join/leave, presence, typing indicators, graceful disconnect.

function createRoomsManager() {
  const rooms    = new Map(); // roomId → Set<userId>
  const member   = new Map(); // userId → Set<roomId>
  const typing   = new Map(); // roomId → Set<userId>

  function join(userId, roomId) {
    if (!roomId || roomId.length > 64) return { error: "invalid room name" };
    if (!rooms.has(roomId))  rooms.set(roomId, new Set());
    if (!member.has(userId)) member.set(userId, new Set());
    rooms.get(roomId).add(userId);
    member.get(userId).add(roomId);
    console.log(`[join] ${userId} → ${roomId} | presence: ${presence(roomId)}`);
    return { ok: true, roomId, onlineCount: presence(roomId) };
  }

  function leave(userId, roomId) {
    rooms.get(roomId)?.delete(userId);
    member.get(userId)?.delete(roomId);
    typing.get(roomId)?.delete(userId);
    if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
    console.log(`[leave] ${userId} ← ${roomId} | presence: ${presence(roomId)}`);
    return { onlineCount: presence(roomId) };
  }

  function startTyping(userId, roomId) {
    if (!typing.has(roomId)) typing.set(roomId, new Set());
    typing.get(roomId).add(userId);
    const list = typers(roomId);
    console.log(`[typing] ${roomId}:`, list);
    return list;
  }

  function stopTyping(userId, roomId) {
    typing.get(roomId)?.delete(userId);
    const list = typers(roomId);
    console.log(`[typing] ${roomId}:`, list);
    return list;
  }

  function typers(roomId)   { return [...(typing.get(roomId) ?? [])]; }
  function presence(roomId) { return rooms.get(roomId)?.size ?? 0; }

  function disconnect(userId) {
    const updates = [];
    for (const roomId of member.get(userId) ?? []) {
      rooms.get(roomId)?.delete(userId);
      typing.get(roomId)?.delete(userId);
      if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
      updates.push({ roomId, onlineCount: presence(roomId), typers: typers(roomId) });
    }
    member.delete(userId);
    console.log(`[disconnect] ${userId} | affected rooms:`, updates.map(u => u.roomId));
    return updates; // caller broadcasts presence+typing updates to each room
  }

  return { join, leave, startTyping, stopTyping, typers, presence, disconnect };
}

// --- Simulate a multi-user session ---
const rm = createRoomsManager();

// Users join
rm.join("alice", "general");
rm.join("bob",   "general");
rm.join("carol", "general");
rm.join("carol", "music");

// Acknowledgement test: invalid room name
const ack = rm.join("dave", "");
console.log("join ack (invalid):", ack);

// Chat simulation (just presence, not message relay — that lives in Socket.IO layer)
console.log("\n-- typing indicators --");
rm.startTyping("alice", "general");
rm.startTyping("bob",   "general");
rm.stopTyping("alice",  "general");

console.log("\n-- carol disconnects --");
const updates = rm.disconnect("carol");
console.log("presence updates to broadcast:", updates);
```

## Common pitfalls

> [!PITFALL] Forgetting to duplicate the Redis client for the subscriber
> Redis does not allow a connection in pub/sub mode to issue regular commands. You must create **two** clients: one for publishing (also used for other Redis commands) and one exclusively for subscribing. The `ioredis` `client.duplicate()` method clones the connection config cleanly.

Also watch for:

- **No sticky sessions**: if your load balancer routes WebSocket frames across instances, connections drop. Configure IP hash or cookie-based affinity before adding the Redis adapter.
- **Redis downtime silently breaks broadcasts**: the adapter does not queue packets when Redis is unavailable — they are lost. Run Redis in a sentinel or cluster configuration for production, and monitor `pubClient.on("error", ...)`.
- **`fetchSockets()` overhead under high load**: querying all instances' socket lists via Redis for every request is expensive. Cache presence counts in Redis hashes (`HSET presence:roomId userId 1`) instead of calling `fetchSockets()` on every join.
- **Namespace isolation**: the adapter is applied per `Server` instance. If you create multiple namespaces, they all share the adapter — you do not need to call `io.adapter()` per namespace.

## What you learned

- The multi-instance problem: in-memory room state is invisible across processes, silently dropping broadcasts to clients on other instances.
- The Redis adapter solves this by publishing every `emit` to a shared Redis pub/sub channel that all instances subscribe to.
- Sticky sessions (IP hash or cookie affinity) are a separate requirement: the load balancer must keep each WebSocket connection on the same upstream.
- SSE is a lighter-weight HTTP-native alternative for server-to-client-only push scenarios.
- Presence and typing state still need explicit cross-instance coordination — use Redis hashes or query `fetchSockets()` sparingly.

## Next steps

With real-time delivery solved, the next frontier is **durable messaging**: what happens when a client is offline and misses events? The following module explores job queues (BullMQ, Redis Streams) for reliable, persistent message delivery that complements the ephemeral WebSocket channel.
*/});
