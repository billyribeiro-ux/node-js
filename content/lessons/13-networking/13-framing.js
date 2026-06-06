registerLessonSrc("13-framing", function () {/*
---
id: 13-framing
title: Message Framing & Protocols
minutes: 28
level: advanced
objectives:
  - Explain the framing problem and why TCP requires it
  - Implement length-prefix and delimiter framing from scratch
  - Build a TCP chat server, chat client, and a RESP-protocol echo server
---

# Message Framing & Protocols

## Why this matters

Every high-level network protocol — HTTP, Redis, PostgreSQL, gRPC — solves the same fundamental problem: how do you pull structured messages out of a raw byte stream? Getting this wrong corrupts data silently in production. Getting it right gives you the foundation to implement *any* protocol. Senior engineers who understand framing never have to guess why JSON.parse is throwing in their TCP handler.

## Learning objectives

- Define the **framing problem** and explain why TCP alone cannot solve it.
- Implement **length-prefix framing**: encode a 4-byte message length before each payload.
- Implement **delimiter framing**: split a stream on newlines (or another sentinel byte).
- Build a working TCP chat server + client and a minimal RESP-protocol echo server (project).

## The framing problem

Recall from the TCP lesson: `socket.write("hello")` and `socket.write(" world")` may arrive as one `data` event, zero `data` events (buffered), or two `data` events — whatever the OS decides. You need a rule that lets the receiver know where one message ends and the next begins. That rule is called **framing**.

There are two dominant strategies:

```
Strategy 1 — Length-prefix framing
┌────────────────┬──────────────────────────────┐
│  4-byte length │  payload (N bytes)            │
└────────────────┴──────────────────────────────┘
"Send the size first, then the bytes."

Strategy 2 — Delimiter framing
┌──────────────────────────────┬──────┐
│  payload (variable)          │  \n  │
└──────────────────────────────┴──────┘
"Keep reading until you see the magic byte."
```

## Length-prefix framing

This is the most common binary-protocol framing strategy. The sender writes a fixed-width header containing the payload length, followed by the payload. The receiver reads until it has the full header, extracts the length, then reads exactly that many bytes.

```js
import net from "node:net";

// --- Encoder: wraps a message in a 4-byte length prefix ---
function encode(message) {
  const payload = Buffer.from(message, "utf8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0); // big-endian length
  payload.copy(frame, 4);
  return frame;
}

// --- Decoder: extracts complete messages from a growing byte buffer ---
function makeDecoder(onMessage) {
  let buf = Buffer.alloc(0);

  return function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);

    while (true) {
      if (buf.length < 4) break; // not enough bytes to read header
      const msgLen = buf.readUInt32BE(0);
      if (buf.length < 4 + msgLen) break; // payload not fully arrived yet
      const payload = buf.slice(4, 4 + msgLen).toString("utf8");
      buf = buf.slice(4 + msgLen); // advance past this frame
      onMessage(payload);
    }
  };
}

// --- Usage ---
const server = net.createServer((socket) => {
  const decode = makeDecoder((msg) => {
    console.log("server received:", msg);
    socket.write(encode("ACK: " + msg));
  });
  socket.on("data", decode);
  socket.on("error", (err) => console.error("socket error:", err.message));
});

server.listen(9100, () => {
  const client = net.connect(9100, () => {
    const decode = makeDecoder((msg) => console.log("client received:", msg));
    client.on("data", decode);
    client.write(encode("hello"));
    client.write(encode("world"));
  });
});
```

> [!OUTPUT]
> server received: hello
> server received: world
> client received: ACK: hello
> client received: ACK: world

> [!PRINCIPAL] Choosing your header width
> A 4-byte (UInt32) length field supports messages up to 4 GiB. For most internal APIs that is enormous overkill and a 2-byte (UInt16, max 65,535 bytes) or varint (Protocol Buffers style) header is leaner. Always document the endianness: big-endian (network byte order) is the conventional choice, and `readUInt32BE` / `writeUInt32BE` makes that explicit.

## Delimiter framing

HTTP/1.1, SMTP, Redis (RESP3), and IRC all use delimiter framing. The simplest form is newline-terminated lines. Node's built-in `node:readline` wraps a Readable stream and handles the accumulation for you:

```js
import net from "node:net";
import readline from "node:readline";

const server = net.createServer((socket) => {
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });

  rl.on("line", (line) => {
    console.log("line received:", line);
    socket.write(line.split("").reverse().join("") + "\n"); // reverse and send back
  });

  socket.on("error", (err) => console.error(err.message));
});

server.listen(9101, () => console.log("delimiter server on 9101"));
```

> [!OUTPUT]
> delimiter server on 9101
> line received: hello
> line received: ping

> [!PITFALL] Binary data inside delimited protocols
> Delimiter framing breaks the moment payload data contains the delimiter byte. HTTP handles this by switching protocols (to `Transfer-Encoding: chunked`) for large or binary bodies. If you might send binary payloads, use length-prefix framing or Base64-encode the content before delimiting.

## A tiny RESP protocol

Redis speaks **RESP** (REdis Serialization Protocol) — a delimiter-framed text protocol. A simple command looks like:

```
*3\r\n          ← array of 3 elements
$3\r\n          ← bulk string of length 3
SET\r\n
$3\r\n
key\r\n
$5\r\n
value\r\n
```

Inline commands (like PING) are simpler:

```
PING\r\n        → +PONG\r\n
```

We can parse inline RESP with readline and a tiny state machine:

```js
import net from "node:net";
import readline from "node:readline";

function handleRespCommand(cmd, socket) {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0].toUpperCase();

  if (command === "PING") {
    socket.write("+PONG\r\n");
  } else if (command === "ECHO" && parts[1]) {
    const msg = parts[1];
    socket.write(`$${msg.length}\r\n${msg}\r\n`);
  } else if (command === "SET" && parts[1] && parts[2]) {
    socket.write("+OK\r\n");
  } else {
    socket.write(`-ERR unknown command '${command}'\r\n`);
  }
}

const respServer = net.createServer((socket) => {
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
  rl.on("line", (line) => handleRespCommand(line, socket));
  socket.on("error", (err) => console.error(err.message));
});

respServer.listen(6399, () => console.log("Tiny RESP server on 6399"));
```

> [!OUTPUT]
> Tiny RESP server on 6399

## Try it yourself

Below is a pure-JS length-prefix frame decoder. It works on raw byte arrays (represented as `Uint8Array`) so you can run it in the browser sandbox. Extend it, break it, and observe the boundary handling.

```js run
// Pure-JS length-prefix framing — no Node APIs needed.
// Frames: [4-byte big-endian length][payload bytes]

function writeUInt32BE(buf, value, offset) {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8)  & 0xff;
  buf[offset + 3] =  value         & 0xff;
}

function readUInt32BE(buf, offset) {
  return (buf[offset] * 0x1000000) +
         ((buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]);
}

function encode(str) {
  const payload = new TextEncoder().encode(str);
  const frame = new Uint8Array(4 + payload.length);
  writeUInt32BE(frame, payload.length, 0);
  frame.set(payload, 4);
  return frame;
}

function makeDecoder(onMessage) {
  let buf = new Uint8Array(0);

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  return function onChunk(chunk) {
    buf = concat(buf, chunk);
    while (true) {
      if (buf.length < 4) break;
      const len = readUInt32BE(buf, 0);
      if (buf.length < 4 + len) break;
      const payload = new TextDecoder().decode(buf.subarray(4, 4 + len));
      buf = buf.slice(4 + len);
      onMessage(payload);
    }
  };
}

// Encode two messages
const frame1 = encode("hello");
const frame2 = encode("world");

// Concatenate them into one "network chunk" — simulates TCP merging writes
const merged = new Uint8Array(frame1.length + frame2.length);
merged.set(frame1, 0);
merged.set(frame2, frame1.length);

// Deliver in three arbitrary pieces — simulates TCP fragmentation
const piece1 = merged.subarray(0, 4);   // just the length header of msg 1
const piece2 = merged.subarray(4, 9);   // partial payload + start of msg 2
const piece3 = merged.subarray(9);      // rest

const decode = makeDecoder((msg) => console.log("decoded:", msg));
decode(piece1);
decode(piece2);
decode(piece3);
// Expected:
// decoded: hello
// decoded: world
```

## Exercise: add a message type byte

Extend the encoder/decoder above so each frame has a 1-byte **type** field between the length header and the payload: type `0x01` = "chat", type `0x02` = "system". The decoder should pass both the type and the decoded string to `onMessage`.

<details>
<summary>Show solution</summary>

```js run
function writeUInt32BE(buf, value, offset) {
  buf[offset]     = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8)  & 0xff;
  buf[offset + 3] =  value         & 0xff;
}
function readUInt32BE(buf, offset) {
  return (buf[offset] * 0x1000000) +
         ((buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]);
}

const HEADER = 5; // 4 bytes length + 1 byte type

function encode(type, str) {
  const payload = new TextEncoder().encode(str);
  const frame = new Uint8Array(HEADER + payload.length);
  writeUInt32BE(frame, payload.length, 0);
  frame[4] = type;
  frame.set(payload, HEADER);
  return frame;
}

function makeDecoder(onMessage) {
  let buf = new Uint8Array(0);
  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a); out.set(b, a.length); return out;
  }
  return function onChunk(chunk) {
    buf = concat(buf, chunk);
    while (true) {
      if (buf.length < HEADER) break;
      const len = readUInt32BE(buf, 0);
      if (buf.length < HEADER + len) break;
      const type = buf[4];
      const text = new TextDecoder().decode(buf.subarray(HEADER, HEADER + len));
      buf = buf.slice(HEADER + len);
      onMessage(type, text);
    }
  };
}

const decode = makeDecoder((type, text) => {
  const label = type === 0x01 ? "chat" : type === 0x02 ? "system" : "unknown";
  console.log(`[${label}] ${text}`);
});

// Mix two message types in one delivery
const f1 = encode(0x01, "Ada: hello!");
const f2 = encode(0x02, "server: Ada joined");
const all = new Uint8Array(f1.length + f2.length);
all.set(f1); all.set(f2, f1.length);
decode(all);
// [chat] Ada: hello!
// [system] server: Ada joined
```

</details>

## Project

**Build a TCP chat server + client and a tiny Redis-protocol (RESP) echo server.**

Use `node:net` and `node:readline`. The project has two parts:

**Part A — TCP chat server & client**
A multi-client chat server where every message from one client is broadcast to all connected clients.

**Part B — RESP echo server**
A server that speaks a subset of RESP: `PING`, `ECHO <message>`, and `SET <key> <value>` (respond `+OK`, no actual storage required). Test it with `redis-cli -p 6399` or a raw `nc` connection.

### Acceptance criteria

1. The chat server accepts multiple simultaneous TCP connections on a configurable port (default 9200).
2. When a client sends a newline-terminated message, every *other* connected client receives it prefixed with a sequential client ID, e.g. `[client-3] hello`.
3. When a client disconnects, the remaining clients receive a `[client-3 left]` system message.
4. The RESP server correctly responds to `PING` with `+PONG\r\n`, to `ECHO foo` with `$3\r\nfoo\r\n`, and to unrecognised commands with `-ERR unknown command\r\n`.
5. All sockets have `error` handlers; a single bad client cannot crash the server.
6. The chat client reads from `process.stdin` and prints received messages to `process.stdout`.

### Starter: pure-JS broadcast logic

The core of the chat server — tracking clients and broadcasting — translates directly to the real implementation. Run this to verify your broadcast logic before adding TCP:

```js run
// Model a multi-client broadcast hub without any network I/O.

function createHub() {
  let nextId = 1;
  const clients = new Map(); // id -> { send }

  function join(sendFn) {
    const id = nextId++;
    clients.set(id, { send: sendFn });
    broadcast(id, `client-${id} joined`, true);
    return {
      send(text) { broadcast(id, text, false); },
      leave() {
        clients.delete(id);
        broadcast(id, `client-${id} left`, true);
      }
    };
  }

  function broadcast(fromId, text, isSystem) {
    const prefix = isSystem ? `[system] ${text}` : `[client-${fromId}] ${text}`;
    for (const [id, client] of clients) {
      if (!isSystem && id === fromId) continue; // don't echo to sender
      client.send(prefix);
    }
  }

  return { join };
}

// Simulate three clients connecting and chatting
const hub = createHub();

const msgs1 = [];
const msgs2 = [];
const msgs3 = [];

const c1 = hub.join((m) => msgs1.push(m));
const c2 = hub.join((m) => msgs2.push(m));
const c3 = hub.join((m) => msgs3.push(m));

c1.send("hello from 1");
c2.send("hi from 2");
c3.leave();

console.log("client-1 inbox:", msgs1);
console.log("client-2 inbox:", msgs2);
console.log("client-3 inbox:", msgs3);
```

## Common pitfalls

> [!PITFALL] Allocating a new Buffer on every data event
> A naive decoder does `buf = Buffer.concat([buf, chunk])` in every `data` event, which O(n) copies the entire accumulated buffer each time. For high-throughput servers, use a pre-allocated ring buffer or a linked list of chunks that you only flatten when you have a complete message. Libraries like `bl` (BufferList) do this for you.

A second pitfall: in RESP, line endings are `\r\n` (CRLF), not just `\n`. Passing `crlfDelay: Infinity` to `readline.createInterface` handles mixed line endings, but make sure your *responses* always use `\r\n` — the Redis client will reject responses with bare `\n`.

## What you learned

- TCP is a byte stream; **framing** gives it message boundaries using length-prefix or delimiter strategies.
- Length-prefix framing: write a fixed-size header with the payload length, then the payload; read header first, then exactly that many bytes.
- Delimiter framing: accumulate bytes until a sentinel (newline, `\r\n`) appears; `node:readline` handles this for streams.
- RESP is a delimiter-framed text protocol; the inline subset is easy to implement with a readline + switch.
- Broadcast hubs, protocol parsers, and frame codecs all follow the same accumulator pattern.

## Next steps

With raw TCP and custom protocols under your belt, the next module explores the HTTP layer that sits on top — request/response semantics, Node's `http` module, and how frameworks like Express abstract the socket machinery you just built by hand.
*/});
