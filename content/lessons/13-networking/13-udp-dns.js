registerLessonSrc("13-udp-dns", function () {/*
---
id: 13-udp-dns
title: UDP with dgram & DNS Resolution
minutes: 24
level: advanced
objectives:
  - Send and receive UDP datagrams with node:dgram
  - Know when UDP is the right tool over TCP
  - Resolve hostnames with node:dns and understand the thread-pool implications
---

# UDP with dgram & DNS Resolution

## Why this matters

Not every network conversation needs a phone-call analogy. Sometimes a postcard is better — fire it off and move on. **UDP** powers DNS, video streaming, online gaming, telemetry, and service-discovery protocols like mDNS. Meanwhile, **DNS resolution** sits beneath every outbound connection your Node app makes: before any TCP socket opens, the OS must first resolve a hostname to an IP address. Knowing how both work lets you write faster, more predictable network code and debug the failures that plague production systems.

## Learning objectives

- Create UDP sockets with `dgram.createSocket` and exchange datagrams between two endpoints.
- Explain UDP's trade-offs: connectionless, unreliable, unordered, and fast.
- Use `dns.lookup` and `dns.resolve` correctly, and know the critical thread-pool difference between them.

## UDP: the connectionless protocol

**User Datagram Protocol** is TCP's stripped-down sibling. There is no handshake, no acknowledgement, no retransmission, and no ordering guarantee. Each datagram is independent — a discrete packet, not a byte stream. The kernel does not buffer or combine them.

| | TCP | UDP |
|---|---|---|
| Connection | Yes (3-way handshake) | No |
| Reliability | Guaranteed delivery | Best-effort |
| Ordering | In-order | May arrive out of order |
| Overhead | ~20 bytes header + handshake | ~8 bytes header |
| Use cases | HTTP, databases, SSH | DNS, video, gaming, telemetry |

> [!NOTE] UDP does have message boundaries
> Unlike TCP, each `send()` call produces exactly one datagram, and each `message` event on the receiver corresponds to exactly one datagram. You still have to handle loss and reordering — but you never have to reassemble a stream.

## Creating a UDP socket with `node:dgram`

```js
import dgram from "node:dgram";

// "udp4" for IPv4, "udp6" for IPv6
const server = dgram.createSocket("udp4");

server.on("message", (msg, rinfo) => {
  // msg is a Buffer; rinfo = { address, family, port, size }
  console.log(`received ${msg} from ${rinfo.address}:${rinfo.port}`);
  // Echo back to the sender
  server.send(msg, rinfo.port, rinfo.address);
});

server.on("error", (err) => {
  console.error("server error:", err.message);
  server.close();
});

server.bind(41234, () => {
  console.log("UDP server listening on port 41234");
});
```

> [!OUTPUT]
> UDP server listening on port 41234
> received hello from 127.0.0.1:54321

```js
import dgram from "node:dgram";

const client = dgram.createSocket("udp4");

const message = Buffer.from("hello");
client.send(message, 41234, "127.0.0.1", (err) => {
  if (err) { console.error(err); client.close(); return; }
  console.log("datagram sent");
});

client.on("message", (msg) => {
  console.log("echo:", msg.toString());
  client.close(); // UDP clients close themselves when done
});
```

> [!OUTPUT]
> datagram sent
> echo: hello

`send(buffer, offset, length, port, address, callback)` has a longer signature than TCP's `write()` because every send explicitly targets a destination — there is no persistent connection to remember it for you.

## When UDP beats TCP

UDP wins in scenarios where **timeliness matters more than completeness**:

- **Live video/audio**: A stale video frame is worse than a missing one. Receivers interpolate.
- **Online gaming**: Player position updates that arrive 200 ms late are useless. Drop and use the next one.
- **DNS queries**: Short request/response that fits in one packet. TCP handshake overhead would dominate.
- **Internal telemetry**: Millions of metrics per second where the occasional dropped point is acceptable.
- **Broadcast/multicast**: UDP supports one-to-many sends; TCP requires a separate connection per receiver.

> [!PRINCIPAL] Building reliability on UDP
> Many modern protocols — QUIC (used by HTTP/3), WebRTC, and game engines — implement their own reliability layer on top of UDP. This lets them tune retransmission, reordering, and congestion control to their specific workload rather than inheriting TCP's one-size-fits-all behaviour. If you need low-latency reliable delivery, look at QUIC or a library like `kcp` before reaching for raw TCP.

## DNS resolution with `node:dns`

Before your process can connect to `api.example.com`, the kernel must turn that string into an IP address. Node exposes two very different APIs for this.

### `dns.lookup` — the OS resolver

```js
import dns from "node:dns";

dns.lookup("nodejs.org", (err, address, family) => {
  if (err) throw err;
  console.log("address:", address, "family: IPv" + family);
});
```

> [!OUTPUT]
> address: 104.20.23.46 family: IPv4

`dns.lookup` calls `getaddrinfo` — the same function your C runtime uses. It respects `/etc/hosts`, local mDNS, VPN split-tunnels, and every other OS-level override. **The catch**: it runs on Node's libuv thread pool (default size: 4). Under heavy concurrent load, lookups queue up and block other libuv work (file I/O, crypto). For servers doing thousands of unique lookups per second, this pool becomes a bottleneck.

### `dns.resolve*` — the pure-JS resolver

```js
import dns from "node:dns/promises";

// Resolves A records directly via DNS protocol — bypasses OS resolver
const addresses = await dns.resolve4("nodejs.org");
console.log("A records:", addresses);

// Other record types
const mx = await dns.resolveMx("gmail.com");
console.log("MX records:", mx);

const txt = await dns.resolveTxt("nodejs.org");
console.log("TXT records:", txt);
```

> [!OUTPUT]
> A records: [ '104.20.22.46', '104.20.23.46' ]
> MX records: [ { exchange: 'gmail-smtp-in.l.google.com', priority: 5 }, ... ]
> TXT records: [ [ 'v=spf1 ...' ] ]

`dns.resolve4` (and its siblings) speak the DNS wire protocol directly, bypassing the OS resolver and the thread pool entirely. They run on Node's event loop. The trade-off: they ignore `/etc/hosts` and OS-level overrides — which is usually fine for server-to-server communication.

> [!PITFALL] dns.lookup is not the same as dns.resolve
> `dns.lookup("example.com")` and `dns.resolve4("example.com")` can return different IPs in the same process if your OS has VPN routing, split-horizon DNS, or a local hosts file entry. When you care about what a connection will actually use, test with `dns.lookup`. When you need raw DNS records (e.g. SRV records for service discovery), use `dns.resolve*`.

### Promises API

Both families have a promise-based version:

```js
import { lookup, resolve4 } from "node:dns/promises";

const { address } = await lookup("example.com");
const ips = await resolve4("nodejs.org");
console.log(address, ips);
```

> [!OUTPUT]
> 93.184.216.34 [ '104.20.22.46', '104.20.23.46' ]

## Try it yourself

UDP's unreliable nature is easy to simulate in pure JavaScript. The snippet below models a collection of datagrams being shuffled and randomly dropped — exactly what a lossy network does.

```js run
// Model UDP packet loss and reordering.
// A "network" that randomly drops ~25% of packets and delivers the rest out of order.

function simulateNetwork(packets, lossProbability) {
  // Drop packets randomly
  const surviving = packets.filter(() => Math.random() > lossProbability);
  // Shuffle the survivors to simulate reordering
  for (let i = surviving.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [surviving[i], surviving[j]] = [surviving[j], surviving[i]];
  }
  return surviving;
}

const datagrams = [
  { seq: 0, payload: "frame-0" },
  { seq: 1, payload: "frame-1" },
  { seq: 2, payload: "frame-2" },
  { seq: 3, payload: "frame-3" },
  { seq: 4, payload: "frame-4" },
];

const received = simulateNetwork(datagrams, 0.25);
console.log("Sent:    ", datagrams.map((d) => d.seq));
console.log("Received:", received.map((d) => d.seq));

// A receiver that reorders and detects gaps (sequence numbers)
const seqSet = new Set(received.map((d) => d.seq));
const gaps = datagrams.filter((d) => !seqSet.has(d.seq)).map((d) => d.seq);
if (gaps.length) {
  console.log("Dropped: ", gaps);
} else {
  console.log("No packets dropped this run!");
}

// Sort by sequence number — what a real receiver does before playback
received.sort((a, b) => a.seq - b.seq);
console.log("Reordered and playing:", received.map((d) => d.payload));
```

## Exercise: DNS round-trip timer

Write a pure-JS function that simulates the latency difference between a "cached" DNS answer (sub-millisecond) and a full recursive lookup (50-300 ms). Model a cache with a `Map` and measure time with `Date.now()`.

<details>
<summary>Show solution</summary>

```js run
function createDnsCache(ttlMs) {
  const cache = new Map();

  function fakeLookup(hostname) {
    return new Promise((resolve) => {
      // Simulate a real DNS lookup: 50-250 ms
      const latency = 50 + Math.random() * 200;
      setTimeout(() => resolve("93.184." + (Math.random() * 255 | 0) + ".1"), latency);
    });
  }

  return async function resolve(hostname) {
    const now = Date.now();
    const cached = cache.get(hostname);
    if (cached && now - cached.ts < ttlMs) {
      console.log(`[CACHE HIT]  ${hostname} -> ${cached.ip} (instant)`);
      return cached.ip;
    }
    const start = Date.now();
    const ip = await fakeLookup(hostname);
    const elapsed = Date.now() - start;
    console.log(`[DNS QUERY]  ${hostname} -> ${ip} (${elapsed} ms)`);
    cache.set(hostname, { ip, ts: Date.now() });
    return ip;
  };
}

async function run() {
  const resolve = createDnsCache(5000); // 5-second TTL
  await resolve("example.com");   // cold — triggers fake DNS query
  await resolve("example.com");   // warm — instant from cache
  await resolve("nodejs.org");    // cold again for a different host
  await resolve("nodejs.org");    // warm
}

run();
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting that UDP datagrams have a size limit
> A single UDP datagram's payload cannot exceed 65,507 bytes (IPv4) after the IP and UDP headers. Trying to send a larger buffer results in a `EMSGSIZE` error. For larger payloads, split manually or use TCP. In practice, stay well under the network MTU (~1,500 bytes) to avoid IP fragmentation, which partially defeats UDP's efficiency advantage.

A second pitfall: calling `socket.close()` on a UDP socket while a `send` is still in flight causes an `ERR_SOCKET_DGRAM_NOT_RUNNING` error. Always close inside the `send` callback (or after awaiting the promise version) to ensure the send is complete before teardown.

## What you learned

- `dgram.createSocket("udp4")` creates a UDP socket; `server.bind()` listens; `socket.send()` fires datagrams.
- UDP is connectionless, unordered, and unreliable — but fast and with true message boundaries.
- Use UDP for real-time data (video, games, telemetry) where dropping old data beats delaying new data.
- `dns.lookup` delegates to the OS (respects `/etc/hosts`, consumes thread-pool threads); `dns.resolve*` speaks raw DNS (event-loop-based, ignores OS overrides).
- Prefer `node:dns/promises` for clean async code; watch the thread-pool ceiling with `dns.lookup` at high concurrency.

## Next steps

You now know TCP's stream nature and UDP's datagram model. The next lesson takes the TCP framing problem head-on: building your own message protocol with length-prefix and delimiter framing, and culminating in a TCP chat server and a tiny RESP-protocol echo server.
*/});
