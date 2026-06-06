registerLessonSrc("13-tcp", function () {/*
---
id: 13-tcp
title: TCP Servers & Clients with net
minutes: 22
level: advanced
objectives:
  - Create TCP servers and clients with node:net
  - Handle socket events (data, end, error) correctly
  - Understand why TCP is a byte stream with no message boundaries
---

# TCP Servers & Clients with net

## Why this matters

Every HTTP request, database query, and gRPC call rides on top of **TCP**. Understanding TCP at the raw socket level gives you a mental model that makes every higher-level protocol — HTTP, WebSockets, Redis, PostgreSQL wire protocol — immediately less mysterious. When production goes sideways and Wireshark tells you a socket is half-open, this is the layer you need to reason about.

## Learning objectives

- Create a TCP server with `net.createServer` and connect a client with `net.connect`.
- Subscribe to the core socket events: `data`, `end`, `error`, and `close`.
- Explain why TCP is a **byte stream** and why that matters for every protocol you build on it.

## TCP in 60 seconds

**Transmission Control Protocol** is a reliable, ordered, bidirectional byte stream between two endpoints. Reliable means the OS retransmits lost packets. Ordered means bytes arrive in the same sequence they were sent. Bidirectional means both sides can send at the same time.

What TCP is *not*: a message protocol. It delivers **bytes**, not packets or messages. The fact that you sent two separate `write()` calls does not mean the other side receives two separate `data` events. The OS is free to merge or fragment them however it likes. This is the single most important thing to understand before you write a single line of TCP code.

## Creating a server with `net.createServer`

```js
import net from "node:net";

const server = net.createServer((socket) => {
  // "socket" is a Duplex stream representing the connected client
  console.log("client connected", socket.remoteAddress, socket.remotePort);

  socket.on("data", (chunk) => {
    // chunk is a Buffer — raw bytes
    console.log("received:", chunk.toString());
    socket.write(chunk); // echo it back
  });

  socket.on("end", () => {
    // The client sent a FIN packet — it is done writing
    console.log("client disconnected (half-close)");
    socket.end(); // send our own FIN
  });

  socket.on("error", (err) => {
    // Always handle errors on sockets — an unhandled error event crashes the process
    console.error("socket error:", err.message);
  });
});

server.listen(9000, "127.0.0.1", () => {
  console.log("TCP echo server listening on port 9000");
});
```

> [!OUTPUT]
> TCP echo server listening on port 9000
> client connected 127.0.0.1 54321
> received: hello
> client disconnected (half-close)

`net.createServer` returns a `net.Server`. The callback fires for every new connection and receives a `net.Socket`, which is a full **Duplex stream** — you can pipe it, use `readline` on it, or attach standard stream events.

## Connecting a client with `net.connect`

```js
import net from "node:net";

const client = net.connect({ port: 9000, host: "127.0.0.1" }, () => {
  // "connect" event fired — safe to write
  console.log("connected to server");
  client.write("hello");
  client.write(" world"); // two writes may arrive as ONE data event on the server!
  client.end();
});

client.on("data", (chunk) => {
  console.log("echo:", chunk.toString());
});

client.on("end", () => {
  console.log("server closed the connection");
});

client.on("error", (err) => {
  console.error("connection error:", err.message);
});
```

> [!OUTPUT]
> connected to server
> echo: hello world
> server closed the connection

Notice "hello" and " world" appear merged. That is the byte-stream nature at work.

## The stream nature of TCP — no message boundaries

This is the framing problem, and it trips up even experienced engineers. Consider a timeline:

```
Client writes:   [ "hello" ]   [ " world" ]
Network packets: [ "hel" ] [ "lo wo" ] [ "rld" ]
Server data evt: [ "hel" ]   or   [ "hello world" ]  — OS decides
```

The OS TCP stack batches small writes via **Nagle's algorithm** and may split large writes across multiple packets. Your `data` event handler might receive one big chunk, many small chunks, or anything in between. You can disable Nagle with `socket.setNoDelay(true)`, but that only reduces latency — it does not give you message boundaries.

> [!PITFALL] Assuming one write = one data event
> The most common TCP bug: `socket.write(JSON.stringify(msg))` on one side, then `JSON.parse(data)` on the other. Works 99% of the time in local testing (writes are tiny and usually arrive together), then silently corrupts in production when a large payload splits across packets. Always implement framing.

## Socket lifecycle events

| Event | When it fires |
|---|---|
| `connect` | TCP handshake complete, socket is ready |
| `data` | Bytes arrived — `chunk` is a `Buffer` |
| `end` | Remote side sent FIN (half-close) |
| `finish` | Local side has sent all data after `socket.end()` |
| `close` | Socket fully closed (after `end` + `finish`) |
| `error` | A network error occurred; `close` follows |
| `timeout` | Inactivity timeout hit (set with `socket.setTimeout`) |

> [!NOTE] Half-close is a real TCP feature
> When one side calls `socket.end()`, it sends a TCP FIN saying "I'm done writing" — but the other side can still send data. This is called a half-close. The connection only fully closes when *both* sides have sent FIN. HTTP/1.1 relies on this for graceful shutdown.

## Useful socket options

```js
socket.setEncoding("utf8");    // auto-decode Buffers to strings
socket.setNoDelay(true);       // disable Nagle — send small writes immediately
socket.setTimeout(30_000);     // emit "timeout" after 30 s of silence
socket.keepAlive = true;       // ask OS to send TCP keep-alives
socket.setKeepAlive(true, 10_000); // keep-alive after 10 s idle
```

> [!PRINCIPAL] Backpressure matters even on raw sockets
> `socket.write()` returns `false` when the internal write buffer is full. If you ignore the return value and keep calling `write()`, you buffer data in memory indefinitely and can OOM the process. Listen for the `drain` event before resuming writes — or pipe through a Transform stream and let Node's stream backpressure machinery handle it.

## Try it yourself

TCP's byte-stream behavior can be modelled in pure JavaScript. The exercise below simulates a byte-stream accumulator: chunks arrive in arbitrary sizes (like TCP data events), and you collect them until you have a complete "message" — here, a newline-terminated line.

```js run
// Simulate a TCP receiver that accumulates arbitrary-sized chunks
// into complete newline-terminated messages.

function makeReceiver(onMessage) {
  let buffer = "";
  return function onChunk(chunk) {
    buffer += chunk;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      onMessage(line);
    }
  };
}

const receive = makeReceiver((msg) => console.log("complete message:", msg));

// Simulate TCP delivering bytes in weird chunk sizes
receive("hel");
receive("lo\nwor");   // "hello" is complete, "wor" is a partial next message
receive("ld\nbye\n"); // "world" and "bye" complete

// Expected:
// complete message: hello
// complete message: world
// complete message: bye
```

## Exercise: count bytes received

Write a receiver that tracks total bytes delivered across all chunks and prints a summary when it receives the sentinel message `"DONE"`.

<details>
<summary>Show solution</summary>

```js run
function makeByteCounter(onDone) {
  let totalBytes = 0;
  let messageCount = 0;
  let buffer = "";

  return function onChunk(chunk) {
    totalBytes += chunk.length;
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const msg = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (msg === "DONE") {
        onDone(messageCount, totalBytes);
        return;
      }
      messageCount++;
      console.log("msg:", msg);
    }
  };
}

const recv = makeByteCounter((count, bytes) => {
  console.log(`done — ${count} messages, ${bytes} total bytes`);
});

recv("ping\n");
recv("po");
recv("ng\nDO");
recv("NE\n");
```

</details>

## Common pitfalls

> [!PITFALL] Not handling the `error` event on every socket
> Node's `EventEmitter` throws unhandled `error` events as exceptions. A single client with a reset connection kills your entire server if you don't attach an `error` listener. Attach it always — even if the handler just logs and returns.

A second common mistake is forgetting `server.on("error", ...)` for the server itself. If port 9000 is already in use, `server.listen()` emits `error`, not an exception, unless you handle it.

## What you learned

- `net.createServer` creates a TCP server; each connection callback receives a `net.Socket` Duplex stream.
- `net.connect` opens a client TCP connection; the `connect` event signals readiness.
- Core socket events: `data` (bytes arrived), `end` (remote FIN), `error` (network failure), `close` (fully closed).
- TCP is a **byte stream** — one `write` call does not equal one `data` event. Framing is your responsibility.
- Always attach `error` handlers on both the server and every socket.

## Next steps

Now that you can push raw bytes over TCP, let's look at **UDP** — the connectionless alternative that trades reliability for speed — and **DNS** resolution, which underpins every network call your Node app makes.
*/});
