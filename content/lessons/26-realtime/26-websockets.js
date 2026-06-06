registerLessonSrc("26-websockets", function () {/*
---
id: 26-websockets
title: "The WebSocket Protocol & ws"
minutes: 24
level: advanced
objectives:
  - Explain the HTTP upgrade handshake and how a WebSocket connection is established
  - Build a WebSocket server with the ws library that broadcasts messages and handles heartbeats
  - Use the native WebSocket client built into modern Node.js
---

# The WebSocket Protocol & ws

## Why this matters

HTTP is request/response: the client asks, the server answers, and the connection closes (or idles). That model breaks down the moment you need the server to *push* data unprompted — a live score update, a collaborative edit, a chat message. **WebSocket** turns a single HTTP connection into a full-duplex channel that stays open indefinitely, letting both sides send frames whenever they want. Understanding the protocol and the `ws` library is the foundation of every real-time Node.js feature.

## Learning objectives

- Explain the **HTTP upgrade handshake** that promotes a TCP connection to WebSocket.
- Write a WebSocket server with `ws`: accept connections, broadcast messages, and run ping/pong heartbeats.
- Use the **native WebSocket client** (`new WebSocket(...)`) introduced in Node 21 without any extra package.

## The HTTP upgrade handshake

A WebSocket connection starts life as a regular HTTP/1.1 request. The client sends an `Upgrade` header and a random nonce; the server responds with `101 Switching Protocols` and a derived `Sec-WebSocket-Accept` header. After that single round-trip the TCP socket is handed over to the WebSocket framing layer and HTTP never touches it again.

```
Client → Server
  GET /chat HTTP/1.1
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
  Sec-WebSocket-Version: 13

Server → Client
  HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

The `Sec-WebSocket-Accept` value is `base64(SHA-1(key + GUID))` — a lightweight proof that the server understood the handshake. After this moment the connection is alive as a bidirectional stream of **frames**.

> [!NOTE] WebSocket runs over TCP (or TLS for `wss://`)
> There is no HTTP overhead after the handshake. Each frame has a small header (2–10 bytes) and a payload, making it far more efficient than polling or long-polling for high-frequency updates.

## Frames and opcodes

WebSocket data travels in **frames**. Each frame carries an opcode that tells the receiver how to interpret the payload:

| Opcode | Meaning |
|--------|---------|
| `0x1`  | Text frame (UTF-8 string) |
| `0x2`  | Binary frame |
| `0x8`  | Close |
| `0x9`  | Ping |
| `0xA`  | Pong |

Frames can be **fragmented**: a large message may be split into multiple frames, each with a "continuation" opcode, and the receiver reassembles them. The `ws` library handles all of this transparently.

> [!PITFALL] Always use text frames for JSON
> Sending binary when the other side expects text (or vice-versa) is a common early mistake. Decide on a convention — usually JSON strings via text frames — and stick to it across both client and server.

## The ws library

`ws` is the most widely used WebSocket package in the Node.js ecosystem. It is a thin, spec-correct wrapper around the protocol with no framework opinions.

```bash
npm install ws
```

### A minimal echo server

```js
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (socket, request) => {
  console.log("client connected:", request.socket.remoteAddress);

  socket.on("message", (data, isBinary) => {
    const text = isBinary ? data : data.toString();
    console.log("received:", text);
    socket.send(`echo: ${text}`); // send back to this client only
  });

  socket.on("close", (code, reason) => {
    console.log("disconnected", code, reason.toString());
  });

  socket.on("error", (err) => {
    console.error("socket error:", err.message);
  });
});

console.log("WebSocket server running on ws://localhost:8080");
```

> [!OUTPUT]
> WebSocket server running on ws://localhost:8080
> client connected: 127.0.0.1
> received: hello
> disconnected 1001 Going Away

### Broadcasting to all connected clients

The `wss.clients` property is a `Set` of all currently open `WebSocket` instances. Broadcasting is a `for…of` loop:

```js
import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({ port: 8080 });

function broadcast(message, sender) {
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    broadcast(data.toString(), socket); // forward to everyone else
  });
});
```

> [!OUTPUT]
> (no stdout — broadcast silently fans messages out to peers)

> [!PRINCIPAL] The `readyState` guard is non-negotiable
> A client in `wss.clients` might be in any of four states: `CONNECTING`, `OPEN`, `CLOSING`, or `CLOSED`. Calling `send()` on a non-OPEN socket throws. Always guard with `client.readyState === WebSocket.OPEN`. In production you would also catch and log the rare synchronous error `send()` can throw even on OPEN sockets during network teardown.

## Ping/pong heartbeats

TCP connections can silently drop behind NAT devices, load balancers, or mobile networks. The WebSocket protocol has a built-in mechanism: the server sends a **Ping** frame and the client must reply with a **Pong**. If no pong arrives within a timeout, the server terminates the connection and removes the client from the set.

```js
import { WebSocketServer, WebSocket } from "ws";

const HEARTBEAT_MS = 30_000;
const wss = new WebSocketServer({ port: 8080 });

function heartbeat() {
  this.isAlive = true; // "this" is the socket that sent the pong
}

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", heartbeat);
});

// Every 30 s, ping all clients and terminate the ones that don't pong back
const interval = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate(); // kill the dead connection
      continue;
    }
    socket.isAlive = false;     // assume dead until pong arrives
    socket.ping();              // send a ping frame
  }
}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(interval));
```

> [!OUTPUT]
> (interval fires every 30 s; dead sockets are terminated silently)

## The native WebSocket client in Node

Since Node 21, `WebSocket` is available globally — no `import` required. This mirrors the browser API exactly, making isomorphic client code trivial.

```js
// No "npm install" needed — native since Node 21
const ws = new WebSocket("ws://localhost:8080");

ws.addEventListener("open", () => {
  console.log("connected");
  ws.send(JSON.stringify({ type: "join", room: "general" }));
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log("server says:", msg);
});

ws.addEventListener("close", (event) => {
  console.log("closed", event.code, event.reason);
});
```

> [!OUTPUT]
> connected
> server says: { type: 'welcome', room: 'general' }
> closed 1000

> [!NOTE] Before Node 21 use the ws package's WebSocket class
> `import { WebSocket } from "ws"` provides the same API. The global landed in Node 21 behind `--experimental-websocket` and became stable in Node 22.

## Try it yourself

The core insight of a WebSocket server is that it maintains a **set of open connections** and can route messages between them. That state management is pure logic. Let's model it:

```js run
// A tiny in-browser event hub modelling a WebSocket server's connection set.
// Each "connection" is an object with an id and a message inbox.

function createEventHub() {
  const connections = new Map(); // id → { id, inbox: [] }
  let nextId = 1;

  function connect() {
    const id = nextId++;
    connections.set(id, { id, inbox: [] });
    console.log(`[hub] client ${id} connected (total: ${connections.size})`);
    return id;
  }

  function disconnect(id) {
    connections.delete(id);
    console.log(`[hub] client ${id} disconnected (total: ${connections.size})`);
  }

  function broadcast(senderId, text) {
    let delivered = 0;
    for (const [id, conn] of connections) {
      if (id !== senderId) {
        conn.inbox.push(`from:${senderId} → ${text}`);
        delivered++;
      }
    }
    console.log(`[hub] broadcast from ${senderId}: "${text}" → ${delivered} peer(s)`);
  }

  function subscribe(topic, id) {
    const conn = connections.get(id);
    if (conn) {
      conn.inbox.push(`[subscribed to ${topic}]`);
      console.log(`[hub] client ${id} subscribed to "${topic}"`);
    }
  }

  function drain(id) {
    const conn = connections.get(id);
    return conn ? conn.inbox.splice(0) : [];
  }

  return { connect, disconnect, broadcast, subscribe, drain };
}

const hub = createEventHub();

const a = hub.connect(); // 1
const b = hub.connect(); // 2
const c = hub.connect(); // 3

hub.subscribe("sports", a);
hub.broadcast(a, "hello everyone");

console.log("inbox b:", hub.drain(b));
console.log("inbox c:", hub.drain(c));

hub.disconnect(b);
hub.broadcast(a, "b is gone");
console.log("inbox c:", hub.drain(c));
```

## Exercises

### Exercise 1: Add a `sendTo` (direct message) function

Extend the hub above so that `sendTo(fromId, toId, text)` delivers a private message to exactly one peer. If the target doesn't exist, log a warning.

<details>
<summary>Show solution</summary>

```js run
function createEventHub() {
  const connections = new Map();
  let nextId = 1;

  const connect = () => {
    const id = nextId++;
    connections.set(id, { id, inbox: [] });
    return id;
  };

  const disconnect = (id) => connections.delete(id);

  const broadcast = (senderId, text) => {
    for (const [id, conn] of connections) {
      if (id !== senderId) conn.inbox.push(`[broadcast] from:${senderId}: ${text}`);
    }
  };

  const sendTo = (fromId, toId, text) => {
    const target = connections.get(toId);
    if (!target) {
      console.log(`[warn] client ${toId} not found`);
      return;
    }
    target.inbox.push(`[dm] from:${fromId}: ${text}`);
    console.log(`[dm] ${fromId} → ${toId}: "${text}"`);
  };

  const drain = (id) => {
    const conn = connections.get(id);
    return conn ? conn.inbox.splice(0) : [];
  };

  return { connect, disconnect, broadcast, sendTo, drain };
}

const hub = createEventHub();
const a = hub.connect();
const b = hub.connect();
const c = hub.connect();

hub.broadcast(a, "hey all");
hub.sendTo(a, b, "private message for b");
hub.sendTo(a, 99, "this should warn");

console.log("b inbox:", hub.drain(b));
console.log("c inbox:", hub.drain(c));
```

</details>

### Exercise 2: Heartbeat tracker

Write a `HeartbeatTracker` class that tracks which connection IDs are "alive". On each tick, IDs that did not pong since the last tick are removed and returned as dead. Model `pong(id)` and `tick()` methods.

<details>
<summary>Show solution</summary>

```js run
class HeartbeatTracker {
  constructor() {
    this.alive = new Set();   // ponged this round
    this.known = new Set();   // all tracked IDs
  }

  register(id) {
    this.known.add(id);
    this.alive.add(id); // starts alive
    console.log(`[hb] registered ${id}`);
  }

  pong(id) {
    this.alive.add(id);
    console.log(`[hb] pong from ${id}`);
  }

  tick() {
    const dead = [];
    for (const id of this.known) {
      if (!this.alive.has(id)) {
        dead.push(id);
        this.known.delete(id);
      }
    }
    // reset alive set — everyone must pong again next round
    this.alive.clear();
    if (dead.length) console.log(`[hb] terminated dead connections:`, dead);
    return dead;
  }
}

const hb = new HeartbeatTracker();
hb.register(1);
hb.register(2);
hb.register(3);

// Round 1: 1 and 3 pong; 2 goes silent
hb.pong(1);
hb.pong(3);
const dead1 = hb.tick();
console.log("dead after round 1:", dead1); // [2]

// Round 2: 3 pongs; 1 goes silent
hb.pong(3);
const dead2 = hb.tick();
console.log("dead after round 2:", dead2); // [1]
```

</details>

## Common pitfalls

> [!PITFALL] Not handling the `error` event causes an unhandled exception crash
> In Node.js EventEmitter, an `"error"` event with no listener throws and crashes the process. Always attach `socket.on("error", handler)` to every WebSocket socket. Network errors, premature closes, and malformed frames all emit `"error"`.

Also watch for:
- **Sending before OPEN**: check `socket.readyState === WebSocket.OPEN` before calling `send()`.
- **Memory leaks in the client set**: if you store extra references to sockets in other data structures (rooms, user maps), clean them up in the `"close"` handler — otherwise the GC cannot collect closed sockets.
- **Missing TLS in production**: always use `wss://` (WebSocket over TLS) in production. Many load balancers terminate TLS and forward plain `ws://` internally, which is fine — just make sure the *public* endpoint is `wss://`.

## What you learned

- WebSocket starts as an HTTP `101 Switching Protocols` upgrade and then becomes a persistent full-duplex TCP channel with a lightweight frame protocol.
- The `ws` library exposes `WebSocketServer` with a `clients` Set; broadcast is a loop guarded by `readyState === OPEN`.
- Ping/pong heartbeats detect silently dropped connections — always run them in production.
- Node 22+ includes a native global `WebSocket` client identical to the browser API.
- Shared state (the connection set, room memberships) is the real complexity — the protocol itself is simple.

## Next steps

A single `ws` server works well for one process — but what happens when you deploy multiple instances behind a load balancer? That's where Socket.IO's rooms, namespaces, and adapters come in, which we cover next.
*/});
