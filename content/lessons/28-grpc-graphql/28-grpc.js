registerLessonSrc("28-grpc", function () {/*
---
id: 28-grpc
title: "gRPC: Protobuf, Unary & Streaming"
minutes: 24
level: advanced
objectives:
  - Understand the RPC model and why gRPC outperforms REST for internal services
  - Read and write Protocol Buffer schemas and map them to Node.js generated code
  - Distinguish the four gRPC call types and know when to use each
---

# gRPC: Protobuf, Unary & Streaming

## Why this matters

Most public APIs use REST over HTTP/1.1 with JSON. But inside a large system — thousands of microservice-to-microservice calls per second — REST's verbosity becomes expensive. **gRPC** is Google's open protocol that replaces JSON with compact binary encoding (Protocol Buffers), replaces HTTP/1.1 with multiplexed HTTP/2, and replaces ad-hoc URL routing with a typed, code-generated interface. At companies like Netflix, Lyft, and Cloudflare, gRPC slashes inter-service latency by 30–70 % compared with JSON/REST.

## Learning objectives

- Explain the **RPC** model and where gRPC fits in your architecture.
- Read and write a `.proto` schema file; understand how code is generated.
- Use the **four call types**: unary, server-streaming, client-streaming, and bidirectional streaming.
- Configure **deadlines**, understand HTTP/2 multiplexing, and spot common pitfalls.

## The RPC mental model

**Remote Procedure Call (RPC)** is the idea that calling a function on another machine should look, from the caller's perspective, just like calling a local function. You write `userService.getUser({ id: 42 })` and get back a user object — the network is hidden.

gRPC is a specific, modern implementation of that idea:

```
Client                              Server
  │                                   │
  │── getUser({ id: 42 }) ──────────► │
  │                                   │  runs GetUser()
  │◄─────── { id:42, name:"Ada" } ─── │
```

Everything travels over a single HTTP/2 connection, multiplexed — dozens of concurrent calls share one TCP socket with no head-of-line blocking.

## Protocol Buffers: the IDL and wire format

The centrepiece of gRPC is **Protocol Buffers** ("protobuf"): a language-neutral **Interface Definition Language** (IDL) that also defines a compact binary serialisation format. You write a `.proto` file; the `protoc` compiler generates client stubs and server skeletons in your language of choice.

```js
// user.proto
// (shown as a JS comment block — .proto is its own language)

// syntax = "proto3";
//
// package user;
//
// service UserService {
//   rpc GetUser    (GetUserRequest)   returns (User);                        // unary
//   rpc ListUsers  (ListRequest)      returns (stream User);                 // server-streaming
//   rpc UploadLogs (stream LogEntry)  returns (UploadSummary);              // client-streaming
//   rpc Chat       (stream Message)   returns (stream Message);              // bidi-streaming
// }
//
// message GetUserRequest { uint32 id = 1; }
// message User           { uint32 id = 1; string name = 2; string email = 3; }
// message ListRequest    { uint32 page_size = 1; }
// message LogEntry       { string text = 1; int64 ts_ms = 2; }
// message UploadSummary  { uint32 count = 1; }
// message Message        { string sender = 1; string body = 2; }
```

Key proto3 rules:
- Every field has a **type** (`uint32`, `string`, `bool`, `bytes`, …), a **name**, and a **field number** (the integer after `=`). Field numbers, not names, go on the wire — renaming a field is safe; renumbering it is a breaking change.
- `stream` before the request type means the client sends a stream; `stream` before the return type means the server sends a stream.
- Messages nest freely; enums, `oneof`, `map<K,V>`, and `repeated` cover most modelling needs.

### Code generation in Node

```bash
# Install tooling once
npm install @grpc/grpc-js @grpc/proto-loader
# For TypeScript + generated types:
npm install -D ts-proto
```

```js
// server.js — loading a proto at runtime (no code-gen step needed for JS)
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const pkgDef = protoLoader.loadSync("user.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const { user: { UserService } } = grpc.loadPackageDefinition(pkgDef);

// Implement the service
const impl = {
  GetUser(call, callback) {
    const { id } = call.request;
    callback(null, { id, name: "Ada Lovelace", email: "ada@example.com" });
  },
};

const server = new grpc.Server();
server.addService(UserService.service, impl);
server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), () => {
  console.log("gRPC server listening on :50051");
});
```

> [!OUTPUT]
> gRPC server listening on :50051

```js
// client.js — calling the server
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const pkgDef = protoLoader.loadSync("user.proto", { keepCase: true, defaults: true });
const { user: { UserService } } = grpc.loadPackageDefinition(pkgDef);

const client = new UserService(
  "localhost:50051",
  grpc.credentials.createInsecure()
);

// Unary call — a single request, a single response
client.GetUser({ id: 42 }, (err, user) => {
  if (err) throw err;
  console.log("Got user:", user.name, user.email);
});
```

> [!OUTPUT]
> Got user: Ada Lovelace ada@example.com

## The four call types

### 1 — Unary

One request in, one response out. Identical in feel to an HTTP POST. Best for lookups, writes, and anything that naturally fits request/response.

### 2 — Server-streaming

Client sends one message; server replies with an ordered stream. Good for: push notifications, paginated results too large for a single message, event feeds.

```js
// server-side implementation
ListUsers(call) {
  const users = getUsersFromDb();
  for (const u of users) {
    call.write(u);         // stream each user as soon as it's ready
  }
  call.end();
}

// client-side consumption
const stream = client.ListUsers({ page_size: 100 });
stream.on("data", (user) => console.log(user.name));
stream.on("end",  ()     => console.log("done"));
stream.on("error",(err)  => console.error(err));
```

> [!OUTPUT]
> Ada Lovelace
> Charles Babbage
> done

### 3 — Client-streaming

Client sends a stream of messages; server replies once when the stream ends. Good for: bulk uploads, log ingestion, telemetry batching.

```js
// client-side: upload a batch of log entries
const call = client.UploadLogs((err, summary) => {
  console.log(`Uploaded ${summary.count} entries`);
});
for (const entry of logEntries) {
  call.write(entry);
}
call.end();
```

> [!OUTPUT]
> Uploaded 1500 entries

### 4 — Bidirectional streaming

Both sides send streams independently. Good for: real-time chat, live telemetry dashboards, collaborative editing. The two streams are fully independent — either side can write at any time.

```js
// bidi chat handler on the server
Chat(call) {
  call.on("data", (msg) => {
    call.write({ sender: "server", body: `echo: ${msg.body}` });
  });
  call.on("end", () => call.end());
}
```

> [!PRINCIPAL] Deadlines are mandatory, not optional
> Every gRPC call should carry a **deadline** (an absolute timestamp by which the call must complete). Without it, a slow downstream service causes unbounded thread / event-loop stalls that cascade into your own timeout budget. Set `deadline` on every client call: `client.GetUser({ id }, { deadline: Date.now() + 2000 }, callback)`. On the server, check `call.cancelled` and `call.deadline` to abort expensive work early. This single practice prevents most distributed-system "grey failures."

## HTTP/2 transport benefits

gRPC's use of HTTP/2 gives you:

- **Multiplexing** — many concurrent RPC calls share one TCP connection; no per-request connection overhead.
- **Header compression (HPACK)** — metadata like auth tokens are compressed on subsequent calls.
- **Flow control** — both sides negotiate how much data can be in-flight, preventing fast producers from overwhelming slow consumers.
- **TLS by default** — production gRPC uses TLS; in Node, swap `createInsecure()` for `grpc.credentials.createSsl(...)`.

## Try it yourself

The binary encoding in protobuf is built on **varints** — variable-length integers that use 7 bits per byte, with the high bit indicating "more bytes follow." This keeps small numbers (the common case) tiny on the wire. Let's implement a varint encoder/decoder from scratch.

```js run
// Protobuf varint encoder/decoder — the same algorithm protobuf uses on the wire.
// A varint stores 7 bits of data per byte; MSB = 1 means "more bytes follow".

function encodeVarint(n) {
  const bytes = [];
  while (n > 127) {
    bytes.push((n & 0x7f) | 0x80); // low 7 bits | continuation bit
    n >>>= 7;
  }
  bytes.push(n & 0x7f); // final byte, no continuation bit
  return bytes;
}

function decodeVarint(bytes) {
  let result = 0;
  let shift = 0;
  for (const byte of bytes) {
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break; // no continuation bit — we're done
    shift += 7;
  }
  return result >>> 0; // treat as unsigned 32-bit
}

// Test small numbers (1 byte on the wire)
console.log(encodeVarint(1));    // [1]
console.log(encodeVarint(127));  // [127]

// 128 needs 2 bytes: [0x80, 0x01]
const encoded128 = encodeVarint(128);
console.log(encoded128);         // [128, 1]
console.log(decodeVarint(encoded128)); // 128

// 300 = 0b100101100 → split into [0xAC, 0x02]
const encoded300 = encodeVarint(300);
console.log(encoded300);         // [172, 2]
console.log(decodeVarint(encoded300)); // 300

// Round-trip several values
[0, 1, 127, 128, 255, 300, 16383, 16384, 2097151].forEach(n => {
  const rt = decodeVarint(encodeVarint(n));
  console.log(`encode→decode(${n}) = ${rt}  ${rt === n ? "✓" : "FAIL"}`);
});
```

## Exercises

### Exercise 1: zigzag encoding

Protobuf uses **zigzag encoding** for signed integers to keep negative numbers small. The formula: `(n << 1) ^ (n >> 31)` for 32-bit values. Encode and decode `-1`, `-2`, `1`, `2`.

<details>
<summary>Show solution</summary>

```js run
function zigzagEncode(n) {
  // Convert JS number to 32-bit signed treatment
  n = n | 0; // coerce to int32
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

function zigzagDecode(n) {
  return ((n >>> 1) ^ -(n & 1)) | 0;
}

[-2, -1, 0, 1, 2, -2147483648, 2147483647].forEach(n => {
  const encoded = zigzagEncode(n);
  const decoded = zigzagDecode(encoded);
  console.log(`zigzag(${n}) = ${encoded}, decoded = ${decoded}  ${decoded === n ? "✓" : "FAIL"}`);
});
// -2 → 3, -1 → 1, 0 → 0, 1 → 2, 2 → 4
// Negative numbers become small positive numbers — perfect for varint compression.
```

</details>

### Exercise 2: field tag encoding

A protobuf field on the wire is prefixed with a **tag**: `(field_number << 3) | wire_type`. Wire type 0 = varint, 2 = length-delimited. Build a function that returns the tag for field 1 (varint) and field 2 (length-delimited).

<details>
<summary>Show solution</summary>

```js run
// Wire types used by protobuf
const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

function makeTag(fieldNumber, wireType) {
  return (fieldNumber << 3) | wireType;
}

function parseTag(tag) {
  return {
    fieldNumber: tag >>> 3,
    wireType: tag & 0x07,
  };
}

const tag1 = makeTag(1, WIRE_VARINT);
const tag2 = makeTag(2, WIRE_LENGTH_DELIMITED);

console.log("tag for field 1 (varint):", tag1);      // 8  (1<<3 | 0)
console.log("tag for field 2 (len-del):", tag2);     // 18 (2<<3 | 2)
console.log(parseTag(tag1)); // { fieldNumber: 1, wireType: 0 }
console.log(parseTag(tag2)); // { fieldNumber: 2, wireType: 2 }
```

</details>

## Common pitfalls

> [!PITFALL] Breaking the wire format by renumbering fields
> Field numbers, not names, identify fields in the binary encoding. Changing `string name = 2` to `string name = 3` silently corrupts messages from old clients — their `name` bytes are now parsed as an unknown field and discarded. Treat field numbers as permanent. Deprecate by adding `reserved 2;` and introducing a new field number. Names, by contrast, are safe to rename.

> [!PITFALL] Forgetting deadlines on every call
> A gRPC call without a deadline can block forever if the server hangs. Always set a deadline. Use a per-RPC deadline and a shorter one when you are deep in a call chain — propagate the remaining budget, don't reset it to a full value.

## What you learned

- **RPC** makes remote calls look local; gRPC implements RPC over HTTP/2 with protobuf encoding.
- `.proto` files define messages and services; field numbers are permanent, names are not.
- The **four call types** — unary, server-streaming, client-streaming, bidi-streaming — cover every real-time and batch communication pattern.
- **Varints** store small integers efficiently; field tags encode field number + wire type in one compact integer.
- **Deadlines** are mandatory; HTTP/2 multiplexing eliminates per-call TCP overhead.

## Next steps

Now that you understand the typed, binary world of gRPC, the next lesson explores GraphQL — a query language that sits at the opposite end of the spectrum, giving API consumers fine-grained control over exactly which fields they fetch.
*/});
