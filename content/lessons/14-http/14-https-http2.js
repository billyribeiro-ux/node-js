registerLessonSrc("14-https-http2", function () {/*
---
id: 14-https-http2
title: "HTTPS, TLS & HTTP/2"
minutes: 26
level: advanced
objectives:
  - Understand TLS mechanics — the handshake, certificates, and trust chains
  - Create HTTPS servers with node:https and node:tls
  - Explain HTTP/2 multiplexing, server push, and ALPN negotiation
  - Describe the HTTP/3 landscape and its relationship to QUIC
---

# HTTPS, TLS & HTTP/2

## Why this matters

Every production web service runs over HTTPS. Understanding TLS is not just security trivia — it directly affects latency (handshake cost), debugging ("certificate expired" errors), performance tuning (session resumption, ALPN), and the reason HTTP/2 exists as a protocol. Senior engineers configure TLS, troubleshoot certificate chains, and make informed decisions about HTTP versions. This lesson gives you the mental model behind the protocols your servers run every day.

## Learning objectives

- Explain TLS: handshake phases, certificates, CA trust chains, and cipher suites.
- Create an HTTPS server in Node with `node:https`, self-signed certs, and mutual TLS concepts.
- Explain HTTP/2's multiplexing model, stream IDs, header compression (HPACK), and server push.
- Understand ALPN — how a TLS connection negotiates which application protocol to use.
- Orient yourself in the HTTP/3 / QUIC landscape.

## TLS fundamentals

**TLS** (Transport Layer Security) is the cryptographic protocol that wraps TCP to give you:

1. **Confidentiality** — traffic is encrypted; eavesdroppers see ciphertext.
2. **Integrity** — a MAC on every record means tampering is detected.
3. **Authentication** — the server (and optionally the client) proves its identity with a certificate.

### The TLS handshake

Before any HTTP bytes flow, client and server must complete a handshake. In TLS 1.3 (the modern default) it takes **one round trip**:

```
Client                              Server
  |── ClientHello (supported ciphers, key share) ──►|
  |◄─ ServerHello (chosen cipher, key share,        |
  |   Certificate, CertificateVerify, Finished) ────|
  |── Finished ──────────────────────────────────── ►|
  |══ Encrypted application data (HTTP) ════════════|
```

The key exchange uses **Diffie-Hellman** (ECDHE in practice): both sides contribute a random public value; combined they produce a shared secret neither side ever transmitted — a mathematical miracle that enables **forward secrecy** (past traffic stays private even if the server's private key is later stolen).

> [!NOTE] TLS 1.2 vs TLS 1.3
> TLS 1.2 required two round trips for the handshake. TLS 1.3 reduced it to one (and supports 0-RTT session resumption for repeat connections at the cost of some replay-attack risk). Always configure servers to prefer TLS 1.3.

### Certificates and the chain of trust

A **certificate** is a signed document saying "this public key belongs to this domain". The signature comes from a **Certificate Authority (CA)** — an organisation browsers trust. The chain:

```
Root CA (self-signed, in OS/browser trust store)
  └─ Intermediate CA (signed by Root CA)
       └─ Your server certificate (signed by Intermediate CA, contains your public key)
```

When a client connects, it verifies the entire chain up to a trusted root. If any link is missing, broken, or expired, you get the dreaded `CERT_INVALID` or `ERR_CERT_AUTHORITY_INVALID` error.

> [!PITFALL] Self-signed certs in production
> Self-signed certificates work for local development (`NODE_TLS_REJECT_UNAUTHORIZED=0` or adding them to the OS trust store) but must never be used in production — clients will reject them. Use Let's Encrypt (free, automated) or a commercial CA for real services.

## HTTPS in Node.js

`node:https` mirrors `node:http` but wraps every connection in TLS. It requires a key and certificate:

```js
import https from "node:https";
import fs from "node:fs";

const options = {
  key:  fs.readFileSync("server.key"),   // private key (never share this)
  cert: fs.readFileSync("server.crt"),   // public certificate
  // ca: fs.readFileSync("ca.crt"),      // for mutual TLS: verify client certs
};

const server = https.createServer(options, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Secure Hello!\n");
});

server.listen(443, () => console.log("HTTPS server running on port 443"));
```

> [!OUTPUT]
> HTTPS server running on port 443

Generate a self-signed cert for local dev in one command:

```bash
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 365 -nodes -subj "/CN=localhost"
```

### The https.request client

```js
import https from "node:https";

https.get("https://api.github.com/zen", {
  headers: { "User-Agent": "node-course" }
}, (res) => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => console.log("GitHub says:", body));
});
```

> [!OUTPUT]
> GitHub says: It's not fully shipped until it's fast.

### TLS socket details

Every HTTPS request exposes the underlying TLS socket so you can inspect the negotiated cipher, protocol version, and peer certificate:

```js
import https from "node:https";

const req = https.get("https://nodejs.org", (res) => {
  const tlsSocket = res.socket;
  console.log("Protocol:", tlsSocket.getProtocol());    // TLSv1.3
  console.log("Cipher:",   tlsSocket.getCipher().name); // TLS_AES_256_GCM_SHA384
  console.log("Auth:", tlsSocket.authorized);           // true
  res.destroy();
});

req.on("error", () => {});
```

> [!OUTPUT]
> Protocol: TLSv1.3
> Cipher: TLS_AES_256_GCM_SHA384
> Auth: true

> [!PRINCIPAL] Cipher suite selection matters
> Prefer AEAD cipher suites (`AES-GCM`, `ChaCha20-Poly1305`). They provide authenticated encryption — confidentiality and integrity in one pass. Avoid CBC-mode ciphers (vulnerable to BEAST/POODLE). Node's defaults are already good; explicitly configure `minVersion: 'TLSv1.2'` and review `ciphers` only if compliance frameworks demand it.

## HTTP/2: multiplexing over TLS

HTTP/1.1 has a fundamental limitation: **head-of-line blocking**. On a single TCP connection, responses must arrive in order. Browsers work around it by opening 6–8 parallel connections per origin, which wastes resources.

HTTP/2 solves this with a **binary framing layer**:

```
One TCP connection
├─ Stream 1 (GET /index.html)   → frames interleaved
├─ Stream 3 (GET /style.css)    → on the same connection
├─ Stream 5 (GET /app.js)       → simultaneously
└─ Stream 7 (POST /api/data)    → no waiting
```

Key concepts:

| Concept | Explanation |
|---------|-------------|
| **Streams** | Bidirectional, independent logical channels, identified by an integer stream ID. Client-initiated streams use odd IDs; server-initiated (push) use even IDs. |
| **Frames** | The atomic data unit. `HEADERS`, `DATA`, `SETTINGS`, `PUSH_PROMISE`, `WINDOW_UPDATE`, `RST_STREAM`. |
| **HPACK** | Header compression. HTTP/1.1 headers are plain text, repeated on every request. HPACK uses a shared dynamic table and Huffman coding — headers like `content-type: application/json` are transmitted as a few bytes after the first occurrence. |
| **Flow control** | Per-stream and per-connection window sizes prevent a fast sender from overwhelming a slow receiver. |
| **Server push** | Server can send a resource the client hasn't asked for yet (`PUSH_PROMISE` + `DATA` frames). Useful to push CSS/JS alongside HTML. Largely replaced by `<link rel=preload>` in practice. |

### HTTP/2 server in Node

```js
import http2 from "node:http2";
import fs from "node:fs";

const server = http2.createSecureServer({
  key:  fs.readFileSync("server.key"),
  cert: fs.readFileSync("server.crt"),
});

server.on("stream", (stream, headers) => {
  const path = headers[":path"];       // HTTP/2 uses pseudo-headers
  const method = headers[":method"];
  console.log(`${method} ${path}`);

  stream.respond({
    ":status": 200,
    "content-type": "text/plain",
  });
  stream.end("HTTP/2 response\n");
});

server.listen(8443, () => console.log("HTTP/2 server on :8443"));
```

> [!OUTPUT]
> HTTP/2 server on :8443
> GET /

### Server push example

```js
server.on("stream", (stream, headers) => {
  if (headers[":path"] === "/") {
    // Proactively push the stylesheet
    stream.pushStream({ ":path": "/style.css" }, (err, pushStream) => {
      if (err) return;
      pushStream.respond({ ":status": 200, "content-type": "text/css" });
      pushStream.end("body { margin: 0; }");
    });

    stream.respond({ ":status": 200, "content-type": "text/html" });
    stream.end("<html><head><link rel='stylesheet' href='/style.css'></head></html>");
  }
});
```

> [!NOTE] HTTP/2 requires TLS in practice
> The HTTP/2 spec allows cleartext (h2c), but all major browsers require TLS. `http2.createSecureServer` is what you'll use in production. For local dev with self-signed certs, point your test client at `https://localhost:8443`.

## ALPN: negotiating the protocol in the handshake

**ALPN** (Application-Layer Protocol Negotiation) is a TLS extension that lets client and server agree on which application protocol to use — all within the TLS handshake, with zero extra round trips.

The client sends a list of protocols it supports in `ClientHello`:

```
ALPN extension: ["h2", "http/1.1"]
```

The server picks one and includes it in its reply. If it picks `"h2"`, HTTP/2 begins immediately after the handshake. This is why you see `alpnProtocol: 'h2'` when you inspect a TLS socket from an HTTP/2 connection.

```js
const tlsSocket = stream.session.socket;
console.log(tlsSocket.alpnProtocol); // "h2"
```

## HTTP/3 and QUIC: the next frontier

HTTP/3 replaces TCP with **QUIC** — a UDP-based transport that bakes TLS 1.3 into the transport layer itself:

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| TLS | separate | separate | built-in |
| HoL blocking | severe | TCP-level | eliminated |
| Handshake RTTs | 2 (TCP+TLS) | 2 (TCP+TLS) | 1 (or 0-RTT) |
| Multiplexing | no | yes | yes |

QUIC streams are independent at the transport layer, so a lost packet on one stream doesn't block others — eliminating the last source of head-of-line blocking that HTTP/2 over TCP still suffers from.

Node.js has experimental HTTP/3 support via the `node:http2` module's QUIC extensions and third-party libraries like `h3` and `@fastify/http2`. Nginx and Cloudflare Workers support HTTP/3 in production today.

> [!PRINCIPAL] Protocol choice at the infrastructure layer
> In most production architectures you don't configure HTTP/2 or HTTP/3 in your Node process directly — you put Nginx, Caddy, or a CDN in front, and it speaks modern protocols to clients while forwarding HTTP/1.1 to your Node process over a local socket. This separation keeps your Node code simple while the edge handles TLS termination and protocol negotiation. Understand the protocols so you can configure the edge layer correctly, not because you'll implement them from scratch.

## Try it yourself

The TLS handshake is a state machine. Let's model the key states and transitions in pure JavaScript — this builds a concrete mental model of what happens before any HTTP byte is exchanged:

```js run
// A tiny state machine modelling a simplified TLS 1.3 handshake
function createTLSHandshake(role) {
  const transitions = {
    client: {
      IDLE:               { action: "send ClientHello",             next: "WAIT_SERVER_HELLO" },
      WAIT_SERVER_HELLO:  { action: "process ServerHello+Cert",     next: "WAIT_FINISHED" },
      WAIT_FINISHED:      { action: "verify cert, send Finished",   next: "ESTABLISHED" },
      ESTABLISHED:        { action: "send application data",        next: "ESTABLISHED" },
    },
    server: {
      IDLE:               { action: "wait for ClientHello",         next: "WAIT_CLIENT_HELLO" },
      WAIT_CLIENT_HELLO:  { action: "recv ClientHello, send Hello+Cert+Finished", next: "WAIT_FINISHED" },
      WAIT_FINISHED:      { action: "recv client Finished",         next: "ESTABLISHED" },
      ESTABLISHED:        { action: "exchange application data",    next: "ESTABLISHED" },
    },
  };

  let state = "IDLE";

  return {
    get state() { return state; },
    step() {
      const map = transitions[role];
      if (!map[state]) throw new Error(`No transition from ${state}`);
      const { action, next } = map[state];
      console.log(`[${role.toUpperCase()} | ${state}] → ${action} → ${next}`);
      state = next;
      return next;
    },
    isEstablished() { return state === "ESTABLISHED"; }
  };
}

const client = createTLSHandshake("client");
const server = createTLSHandshake("server");

// Simulate the interleaved handshake
server.step(); // server starts listening
client.step(); // ClientHello sent
server.step(); // server processes, sends reply
client.step(); // client processes, sends Finished
server.step(); // server receives Finished

console.log("\nHandshake complete?", client.isEstablished() && server.isEstablished());

// Now application data can flow
client.step();
console.log("Client state:", client.state);
```

## Exercise

**Challenge:** Extend the state machine to track the elapsed time (in simulated milliseconds) at each transition and report the total handshake duration when both sides reach `ESTABLISHED`. Assume each `step()` call takes 10 ms of simulated network time.

<details>
<summary>Show solution</summary>

```js run
function createTLSHandshake(role) {
  const transitions = {
    client: {
      IDLE:              { action: "send ClientHello",           next: "WAIT_SERVER_HELLO", ms: 10 },
      WAIT_SERVER_HELLO: { action: "process ServerHello+Cert",   next: "WAIT_FINISHED",     ms: 10 },
      WAIT_FINISHED:     { action: "verify cert, send Finished", next: "ESTABLISHED",       ms: 10 },
      ESTABLISHED:       { action: "send application data",      next: "ESTABLISHED",       ms: 0  },
    },
    server: {
      IDLE:              { action: "wait for ClientHello",        next: "WAIT_CLIENT_HELLO", ms: 0  },
      WAIT_CLIENT_HELLO: { action: "recv ClientHello, send reply",next: "WAIT_FINISHED",     ms: 10 },
      WAIT_FINISHED:     { action: "recv client Finished",        next: "ESTABLISHED",       ms: 10 },
      ESTABLISHED:       { action: "exchange application data",   next: "ESTABLISHED",       ms: 0  },
    },
  };

  let state = "IDLE";
  let elapsed = 0;

  return {
    get state() { return state; },
    get elapsed() { return elapsed; },
    step() {
      const map = transitions[role];
      if (!map[state]) throw new Error(`No transition from ${state}`);
      const { action, next, ms } = map[state];
      elapsed += ms;
      console.log(`[${role.toUpperCase()} +${elapsed}ms | ${state}] ${action}`);
      state = next;
    },
    isEstablished() { return state === "ESTABLISHED"; }
  };
}

const client = createTLSHandshake("client");
const server = createTLSHandshake("server");

server.step();
client.step();
server.step();
client.step();
server.step();

const handshakeMs = Math.max(client.elapsed, server.elapsed);
console.log(`\nHandshake complete. Total time: ${handshakeMs}ms`);
console.log("Both established:", client.isEstablished() && server.isEstablished());
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to handle certificate errors in http.request
> When using `https.request` or `https.get` against a host with a self-signed or expired cert, Node throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `CERT_HAS_EXPIRED`. Setting `NODE_TLS_REJECT_UNAUTHORIZED=0` silences this globally — dangerous in production. Instead pass `{ rejectUnauthorized: false }` only for that specific request in dev, or add the CA cert via the `ca` option.

> [!PITFALL] HTTP/2 and HTTP/1.1 middleware are not interchangeable
> `http2.createSecureServer` emits `stream` events, not `request` events. Express and many middlewares are built for `node:http`'s `IncomingMessage`/`ServerResponse` interface. Use the `http2` compatibility layer (`http2.createSecureServer({ allowHTTP1: true })`) if you need to support both protocols with legacy middleware.

## What you learned

- TLS provides confidentiality, integrity, and authentication via a Diffie-Hellman key exchange and a certificate trust chain — all before any HTTP data flows.
- `node:https` wraps `node:http` with TLS; you provide `key` and `cert` options.
- HTTP/2 multiplexes many independent streams over one TLS connection, uses binary framing, and compresses headers with HPACK — eliminating HTTP/1.1 head-of-line blocking.
- ALPN lets client and server negotiate the application protocol (h2 vs http/1.1) inside the TLS handshake at zero extra cost.
- HTTP/3 moves to QUIC (UDP + built-in TLS) for even lower latency; in most architectures TLS and protocol negotiation live at the Nginx/CDN edge, not in Node code.

## Next steps

You now understand the HTTP stack from raw TCP to TLS to HTTP/2. Next we put it all together: build a **tiny web framework** from scratch — routing, middleware chains, and body parsing — so you can see exactly how Express-style frameworks work under the hood.
*/});
