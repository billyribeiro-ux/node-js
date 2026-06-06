registerLessonSrc("26-socketio", function () {/*
---
id: 26-socketio
title: "Socket.IO: Rooms, Namespaces & Presence"
minutes: 26
level: advanced
objectives:
  - Explain how Socket.IO layers reconnection and fallbacks on top of WebSocket
  - Organise connections into rooms and namespaces with targeted broadcasting
  - Track presence (who is online, in which room) using acknowledgements and server state
---

# Socket.IO: Rooms, Namespaces & Presence

## Why this matters

Raw WebSocket gives you a pipe. Real applications need higher-level primitives: automatic reconnection so mobile users survive a brief loss of signal, rooms so a chat message goes to "room:42" rather than everyone, acknowledgements so the sender knows the server received a critical event, and presence so the UI can show "Alice is typing…". **Socket.IO** provides all of this with a thin, well-tested layer on top of the WebSocket protocol — and gracefully degrades to HTTP long-polling when WebSocket is unavailable (corporate proxies, some mobile networks).

## Learning objectives

- Explain what Socket.IO adds over raw `ws`: **transport fallback**, **auto-reconnect**, **namespaces**, **rooms**, and **acknowledgements**.
- Use the server API to join/leave rooms and broadcast to room members.
- Build a presence tracker that counts online users per room.

## What Socket.IO adds over raw ws

Socket.IO is not a thin rename of the `ws` package. It adds a full protocol layer:

| Feature | Raw ws | Socket.IO |
|---|---|---|
| Transport fallback (HTTP polling) | No | Yes |
| Automatic reconnection + backoff | No | Built-in |
| Rooms (logical groups) | Manual Set | `socket.join("room")` |
| Namespaces (virtual servers) | No | `/chat`, `/admin` |
| Acknowledgements (RPC-style) | Manual | Callback / Promise |
| Binary support | Yes | Yes |
| Middleware | No | Yes |

### Installing

```bash
npm install socket.io        # server
npm install socket.io-client # Node.js client
```

### A minimal server

```js
import { createServer } from "node:http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" } // adjust for production
});

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("message", (data) => {
    console.log("message from", socket.id, data);
  });

  socket.on("disconnect", (reason) => {
    console.log("disconnected:", socket.id, reason);
  });
});

httpServer.listen(3000);
console.log("Socket.IO server on http://localhost:3000");
```

> [!OUTPUT]
> Socket.IO server on http://localhost:3000
> connected: BKF3dkYexZ1l_AAAAB
> message from BKF3dkYexZ1l_AAAAB { text: 'hello' }
> disconnected: BKF3dkYexZ1l_AAAAB transport close

> [!NOTE] Socket IDs are unique per connection, not per user
> Every time a client reconnects it gets a new `socket.id`. If you need a stable user identity, authenticate the socket and store `socket.data.userId = user.id` in the `connection` middleware.

## Rooms

A **room** is a named channel that sockets can join and leave. Socket.IO maintains the membership on the server; clients never see room names directly.

```js
io.on("connection", (socket) => {
  // Join a room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`${socket.id} joined room ${roomId}`);

    // Broadcast to everyone else in the room
    socket.to(roomId).emit("user-joined", { id: socket.id });
  });

  // Leave a room
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("user-left", { id: socket.id });
  });

  // Send a message to a room (including the sender)
  socket.on("room-message", ({ roomId, text }) => {
    io.to(roomId).emit("room-message", { from: socket.id, text });
  });

  // On disconnect Socket.IO automatically removes the socket from all rooms
  socket.on("disconnect", () => {
    // socket.rooms is already empty here — cleanup is automatic
  });
});
```

> [!OUTPUT]
> BKF3dkYexZ1l_AAAAB joined room general
> Cq7rGmNb0aL2_BBBBB joined room general
> (event) user-joined → { id: 'Cq7rGmNb0aL2_BBBBB' }

Targeting syntax at a glance:

| Expression | Audience |
|---|---|
| `socket.emit("ev", data)` | This socket only |
| `socket.to(room).emit(...)` | Room members, excluding sender |
| `io.to(room).emit(...)` | Room members, including sender |
| `socket.broadcast.emit(...)` | Everyone except sender |
| `io.emit(...)` | Literally everyone |

> [!PRINCIPAL] Rooms are stored in an in-memory adapter by default
> In a single-process server, room membership lives in RAM. When you run two instances behind a load balancer, instance A has no knowledge of instance B's rooms — `io.to("general").emit(...)` only reaches clients connected to A. This is the core scaling problem solved in the next lesson with the Redis adapter.

## Namespaces

A **namespace** is a virtual server endpoint — like a separate Socket.IO server sharing the same HTTP port. Use namespaces to cleanly separate concerns without running multiple HTTP servers:

```js
const chatNsp = io.of("/chat");
const adminNsp = io.of("/admin");

chatNsp.on("connection", (socket) => {
  console.log("chat user:", socket.id);
});

adminNsp.use((socket, next) => {
  // Middleware: only allow authenticated admins
  if (socket.handshake.auth.token === "secret") return next();
  next(new Error("unauthorized"));
});

adminNsp.on("connection", (socket) => {
  console.log("admin user:", socket.id);
});
```

```js
// Client connects to a namespace:
import { io } from "socket.io-client";
const chatSocket = io("http://localhost:3000/chat");
const adminSocket = io("http://localhost:3000/admin", {
  auth: { token: "secret" }
});
```

> [!OUTPUT]
> chat user: abc123...
> admin user: def456...

## Acknowledgements

An **acknowledgement** turns a one-way `emit` into a simple RPC call. The sender passes a callback; the receiver calls it when it's done:

```js
// Server
socket.on("create-room", (name, callback) => {
  if (!name || name.length > 32) {
    return callback({ error: "invalid room name" });
  }
  socket.join(name);
  callback({ ok: true, roomId: name });
});

// Client
socket.emit("create-room", "general", (response) => {
  if (response.error) {
    console.error("Could not create room:", response.error);
  } else {
    console.log("Joined room:", response.roomId);
  }
});
```

> [!OUTPUT]
> Joined room: general

In modern Socket.IO you can also use `socket.emitWithAck(event, ...args)` on the client, which returns a Promise — cleaner with async/await.

## Presence tracking

Presence means knowing *who* is online and *where* (which room). The server is the single source of truth:

```js
const presence = new Map(); // userId → Set of roomIds

io.on("connection", (socket) => {
  const userId = socket.handshake.auth.userId;
  socket.data.userId = userId;

  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    if (!presence.has(userId)) presence.set(userId, new Set());
    presence.get(userId).add(roomId);

    // Broadcast updated count
    const count = io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
    io.to(roomId).emit("presence", { roomId, onlineCount: count });
  });

  socket.on("disconnect", () => {
    // Notify each room this user was in
    for (const roomId of presence.get(userId) ?? []) {
      const count = (io.sockets.adapter.rooms.get(roomId)?.size ?? 1) - 1;
      socket.to(roomId).emit("presence", { roomId, onlineCount: count });
    }
    presence.delete(userId);
  });
});
```

> [!OUTPUT]
> (event) presence → { roomId: 'general', onlineCount: 3 }
> (event) presence → { roomId: 'general', onlineCount: 2 }  // after disconnect

## Try it yourself

The rooms manager below is pure JavaScript — no Socket.IO required. It captures the core logic of join/leave/broadcast-to-room with presence counts. This same logic powers the Socket.IO server above.

```js run
// A rooms manager modelling Socket.IO's room semantics.
// Connections are objects; rooms are Sets of connection IDs.

function createRoomsManager() {
  const rooms = new Map();       // roomId → Set<socketId>
  const membership = new Map();  // socketId → Set<roomId>

  function join(socketId, roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socketId);

    if (!membership.has(socketId)) membership.set(socketId, new Set());
    membership.get(socketId).add(roomId);

    console.log(`[join] ${socketId} → ${roomId} (${rooms.get(roomId).size} members)`);
  }

  function leave(socketId, roomId) {
    rooms.get(roomId)?.delete(socketId);
    membership.get(socketId)?.delete(roomId);
    if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
    console.log(`[leave] ${socketId} ← ${roomId}`);
  }

  function broadcast(fromId, roomId, event, data, includeSender = false) {
    const members = rooms.get(roomId);
    if (!members) { console.log(`[warn] room ${roomId} does not exist`); return; }
    let sent = 0;
    for (const id of members) {
      if (!includeSender && id === fromId) continue;
      console.log(`  → [${id}] event:${event}`, data);
      sent++;
    }
    console.log(`[broadcast] ${fromId} → ${roomId}: "${event}" delivered to ${sent}`);
  }

  function disconnect(socketId) {
    for (const roomId of membership.get(socketId) ?? []) {
      rooms.get(roomId)?.delete(socketId);
      if (rooms.get(roomId)?.size === 0) rooms.delete(roomId);
    }
    membership.delete(socketId);
    console.log(`[disconnect] ${socketId} removed from all rooms`);
  }

  function presence(roomId) {
    return rooms.get(roomId)?.size ?? 0;
  }

  return { join, leave, broadcast, disconnect, presence };
}

const rm = createRoomsManager();

rm.join("alice", "general");
rm.join("bob",   "general");
rm.join("carol", "general");
rm.join("carol", "music");

rm.broadcast("alice", "general", "chat", { text: "hello" });
console.log("presence in general:", rm.presence("general")); // 3
console.log("presence in music:",   rm.presence("music"));   // 1

rm.disconnect("carol");
console.log("presence in general after carol leaves:", rm.presence("general")); // 2
console.log("presence in music after carol leaves:",   rm.presence("music"));   // 0
```

## Exercises

### Exercise 1: Typing indicators

Add `startTyping(socketId, roomId)` and `stopTyping(socketId, roomId)` methods to the rooms manager. Track which users are currently typing per room and expose a `typers(roomId)` method that returns an array of IDs.

<details>
<summary>Show solution</summary>

```js run
function createRoomsManager() {
  const rooms = new Map();
  const membership = new Map();
  const typing = new Map(); // roomId → Set<socketId>

  const join = (socketId, roomId) => {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socketId);
    if (!membership.has(socketId)) membership.set(socketId, new Set());
    membership.get(socketId).add(roomId);
  };

  const startTyping = (socketId, roomId) => {
    if (!typing.has(roomId)) typing.set(roomId, new Set());
    typing.get(roomId).add(socketId);
    console.log(`[typing] ${socketId} is typing in ${roomId}`, typers(roomId));
  };

  const stopTyping = (socketId, roomId) => {
    typing.get(roomId)?.delete(socketId);
    console.log(`[typing] ${socketId} stopped typing in ${roomId}`, typers(roomId));
  };

  const typers = (roomId) => [...(typing.get(roomId) ?? [])];

  return { join, startTyping, stopTyping, typers };
}

const rm = createRoomsManager();
rm.join("alice", "general");
rm.join("bob",   "general");

rm.startTyping("alice", "general");
rm.startTyping("bob",   "general");
console.log("currently typing:", rm.typers("general")); // ['alice', 'bob']

rm.stopTyping("alice", "general");
console.log("currently typing:", rm.typers("general")); // ['bob']
```

</details>

### Exercise 2: Acknowledgement simulator

Write a `createAckEmitter()` that models Socket.IO acknowledgements. `emit(event, data, callback)` invokes the registered handler and passes the handler's return value into the callback. If no handler is registered, call `callback({ error: "no handler" })`.

<details>
<summary>Show solution</summary>

```js run
function createAckEmitter() {
  const handlers = new Map();

  const on = (event, handler) => handlers.set(event, handler);

  const emit = (event, data, callback) => {
    const handler = handlers.get(event);
    if (!handler) {
      callback({ error: `no handler for "${event}"` });
      return;
    }
    // Handler may call callback directly (Socket.IO style) or return a value
    try {
      const result = handler(data, callback);
      // If the handler returned without calling callback, call it with result
      if (result !== undefined) callback(result);
    } catch (err) {
      callback({ error: err.message });
    }
  };

  return { on, emit };
}

const emitter = createAckEmitter();

emitter.on("create-room", (name, cb) => {
  if (!name || name.length > 32) { cb({ error: "invalid name" }); return; }
  cb({ ok: true, roomId: name });
});

emitter.emit("create-room", "general", (res) => {
  console.log("create-room response:", res); // { ok: true, roomId: 'general' }
});

emitter.emit("create-room", "", (res) => {
  console.log("create-room response:", res); // { error: 'invalid name' }
});

emitter.emit("unknown-event", {}, (res) => {
  console.log("unknown response:", res); // { error: 'no handler for "unknown-event"' }
});
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting that `socket.to(room)` excludes the sender — `io.to(room)` includes them
> This distinction bites everyone at least once. Use `socket.to(room)` for "notify others"; use `io.to(room)` for "notify the whole room including the action's originator".

Also watch for:

- **Room cleanup on disconnect**: Socket.IO removes the socket from all rooms automatically on disconnect, but any *application-level* state you maintain (your own presence Maps, typing sets) must be cleaned up in the `"disconnect"` handler.
- **Namespace confusion**: by default all connections land on the `/` namespace. If you add namespaces later, clients must explicitly target them — `io("/chat")` not `io()`.
- **Missing acknowledgement timeouts**: if the client crashes before calling the ack callback, the server-side closure leaks. In Socket.IO 4+ use `socket.timeout(ms).emitWithAck(...)` to add a timeout.

## What you learned

- Socket.IO layers **transport fallback**, **auto-reconnect**, **rooms**, **namespaces**, and **acknowledgements** on top of the WebSocket protocol.
- `socket.join(room)` / `socket.leave(room)` manage membership; `socket.to(room).emit(...)` broadcasts to others; `io.to(room).emit(...)` includes the sender.
- Presence tracking lives on the server as a `Map<userId, Set<roomId>>` kept in sync with `"connection"` and `"disconnect"` events.
- Acknowledgements turn events into RPC calls with a callback or Promise.
- The default **in-memory adapter** works for one process only — scaling requires the Redis adapter covered next.

## Next steps

A single Socket.IO server handles thousands of connections comfortably — but when you scale horizontally to multiple instances, rooms and broadcasts break across process boundaries. The next lesson tackles that with the Redis pub/sub adapter and sticky sessions.
*/});
