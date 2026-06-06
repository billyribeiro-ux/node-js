registerLessonSrc("10-stream-types", function () {/*
---
id: 10-stream-types
title: "The Four Stream Types"
minutes: 22
level: advanced
objectives:
  - Explain why streams are Node's memory-efficient superpower for large data
  - Distinguish Readable, Writable, Duplex, and Transform stream types
  - Understand flowing vs paused mode and the events that drive each
---

# The Four Stream Types

## Why this matters

Imagine reading a 10 GB log file into a string. Your process needs 10 GB of RAM just to hold it — before doing any work. Streams flip this on its head: instead of loading everything at once, you process a small **chunk** at a time, keeping memory nearly constant no matter the file size. That is why every major I/O subsystem in Node — file system, network, HTTP — exposes streams. Understanding them unlocks Node's true scalability story.

## Learning objectives

- Explain why streams use constant memory regardless of data size.
- Name and describe all four stream types: Readable, Writable, Duplex, Transform.
- Differentiate **flowing mode** from **paused mode** and know what triggers each.
- Use `data`, `end`, and `error` events correctly on a Readable.
- Know when to use **object mode** streams.

## Why streams: constant memory over huge data

Consider two approaches to processing a 1 GB file:

```js
// Approach A — buffer everything (dangerous for large files)
import { readFile, writeFile } from "node:fs/promises";
const data = await readFile("huge.log");        // 1 GB in RAM right now
const result = data.toString().toUpperCase();
await writeFile("huge.upper.log", result);      // another copy in RAM
```

```js
// Approach B — stream it (constant ~64 KB of RAM)
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";

const upper = new Transform({
  transform(chunk, _enc, done) {
    done(null, chunk.toString().toUpperCase());
  }
});

createReadStream("huge.log")
  .pipe(upper)
  .pipe(createWriteStream("huge.upper.log"));
```

> [!OUTPUT]
> (file written incrementally — heap stays near 64 KB throughout)

The stream version processes one **highWaterMark**-sized chunk at a time (default 64 KB for byte streams). Memory stays flat even for files that are gigabytes in size.

> [!PRINCIPAL] Streams are a protocol, not magic
> The core idea is a push/pull contract: a producer signals data is available; the consumer decides when to pull. The sophistication is in what happens when they run at different speeds — that is **backpressure**, covered in the next lesson. Understanding the contract (not just the API) lets you reason about any streaming system: web streams, gRPC, WebSockets, database cursors. The pattern is universal.

## The four stream types

Node's `node:stream` module defines four abstract classes. Every concrete stream — file, HTTP request, socket, zlib, crypto — extends one of these.

| Type | Can Read? | Can Write? | Example in Node |
|---|---|---|---|
| **Readable** | yes | no | `fs.createReadStream`, `http.IncomingMessage` |
| **Writable** | no | yes | `fs.createWriteStream`, `http.ServerResponse` |
| **Duplex** | yes | yes | `net.Socket` (TCP socket — reads and writes independently) |
| **Transform** | yes | yes | `zlib.createGzip()`, `crypto.createCipheriv()` |

A **Duplex** has two independent channels — write side and read side are not coupled. A TCP socket is the classic example: you write bytes to the remote end and independently read bytes from it.

A **Transform** is a special Duplex where the written data is *transformed* and becomes what is readable — think of it as a processing step in a pipeline.

### Creating a Readable from scratch

```js
import { Readable } from "node:stream";

// Option 1: push-based constructor
const readable = new Readable({
  read() {
    // called when the consumer wants data
    this.push("hello ");
    this.push("world\n");
    this.push(null);    // null signals end-of-stream
  }
});

// Option 2: the modern generator shortcut (Node 12+)
const fromGenerator = Readable.from(async function* () {
  yield "chunk 1\n";
  yield "chunk 2\n";
}());
```

> [!OUTPUT]
> hello world
> chunk 1
> chunk 2

### Creating a Writable from scratch

```js
import { Writable } from "node:stream";

const writable = new Writable({
  write(chunk, encoding, callback) {
    // process the chunk, then call callback to signal readiness for more
    process.stdout.write(chunk);
    callback();   // no argument means success; pass an Error to signal failure
  }
});

readable.pipe(writable);
```

> [!OUTPUT]
> hello world

## Flowing mode vs paused mode

A Readable starts in **paused mode** — it will not emit data until you ask for it. Switching to **flowing mode** means `data` events fire automatically.

```js
import { createReadStream } from "node:fs";

const rs = createReadStream("data.txt", { encoding: "utf8" });

// flowing mode — attach a 'data' listener and chunks flow automatically
rs.on("data", (chunk) => {
  process.stdout.write(chunk);
});

// 'end' fires when there is no more data
rs.on("end", () => console.log("\nAll data consumed."));

// ALWAYS handle errors on every stream
rs.on("error", (err) => console.error("stream error:", err.message));
```

> [!OUTPUT]
> ...file contents here...
> All data consumed.

```js
// paused mode — pull chunks manually with .read()
import { createReadStream } from "node:fs";

const rs = createReadStream("data.txt");

rs.on("readable", () => {
  let chunk;
  while ((chunk = rs.read()) !== null) {
    console.log(`Got ${chunk.length} bytes`);
  }
});

rs.on("end", () => console.log("Done."));
```

> [!OUTPUT]
> Got 65536 bytes
> Got 65536 bytes
> Got 8192 bytes
> Done.

How mode switching works:

| Action | Result |
|---|---|
| `.on("data", fn)` | switches to flowing |
| `.pipe(dest)` | switches to flowing |
| `.resume()` | switches to flowing |
| `.on("readable", fn)` | stays paused, you call `.read()` |
| `.pause()` | switches back to paused |

> [!WARNING] Unhandled stream errors crash your process
> If you do not attach an `error` listener to a stream, the error event becomes an unhandled `EventEmitter` error and kills the process. Always `.on("error", handler)` every stream you create or consume. The `pipeline()` function (next lesson) handles this automatically.

## Object mode streams

By default, streams work with `Buffer` and `string` chunks. **Object mode** lets you push arbitrary JavaScript values — objects, arrays, numbers — as chunks:

```js
import { Readable, Writable } from "node:stream";

const objectSource = new Readable({
  objectMode: true,
  read() {
    this.push({ id: 1, name: "Alice" });
    this.push({ id: 2, name: "Bob" });
    this.push(null);
  }
});

const objectSink = new Writable({
  objectMode: true,
  write(obj, _enc, done) {
    console.log("received:", obj.name);
    done();
  }
});

objectSource.pipe(objectSink);
```

> [!OUTPUT]
> received: Alice
> received: Bob

> [!NOTE] Object mode changes highWaterMark semantics
> In object mode, `highWaterMark` counts *items* not bytes (default: 16 objects). One huge object and one tiny one both count as 1. You cannot mix object-mode and byte-mode streams in a pipeline without an adapter Transform.

## Try it yourself

A Readable stream is conceptually a **lazy sequence** — it produces values on demand. Build a pull-based "lazy stream" modeled as a generator. No buffering of the full dataset, just-in-time production:

```js run
// Model a Readable stream as a generator: values produced on demand.
function* rangeChunks(from, to, chunkSize) {
  let current = from;
  while (current <= to) {
    const end = Math.min(current + chunkSize - 1, to);
    const chunk = [];
    for (let i = current; i <= end; i++) chunk.push(i);
    yield chunk;
    current = end + 1;
  }
}

// "Consumer" — pulls chunks one at a time (paused mode analogy)
let totalItems = 0;
let chunkCount = 0;
for (const chunk of rangeChunks(1, 100, 15)) {
  totalItems += chunk.length;
  chunkCount++;
  console.log(
    "chunk " + chunkCount + ": [" + chunk[0] + ".." + chunk[chunk.length - 1] + "]" +
    " (" + chunk.length + " items)"
  );
}
console.log("Total items consumed: " + totalItems + " in " + chunkCount + " chunks");
```

Notice how the generator never holds more than one chunk in memory at a time — the same contract a real Readable stream holds with its `read()` method.

## Exercises

**Exercise 1:** Implement a `pagedSource` generator that simulates a paginated API — yield page objects `{ page, items }` one at a time, 5 pages of 4 items each. Count total items consumed.

<details>
<summary>Show solution</summary>

```js run
function* pagedSource(totalPages, pageSize) {
  let itemId = 1;
  for (let page = 1; page <= totalPages; page++) {
    const items = [];
    for (let i = 0; i < pageSize; i++) items.push(itemId++);
    yield { page, items };
  }
}

let total = 0;
for (const { page, items } of pagedSource(5, 4)) {
  total += items.length;
  console.log("Page " + page + ": " + items.join(", "));
}
console.log("Total items: " + total);
```

</details>

**Exercise 2:** Write two consumers of the same generator — one that reads all chunks (flowing), one that stops after 2 chunks (paused, early exit).

<details>
<summary>Show solution</summary>

```js run
function* source() {
  for (let i = 1; i <= 5; i++) yield "chunk-" + i;
}

// Flowing: consume everything
console.log("=== FLOWING ===");
for (const chunk of source()) {
  console.log("got:", chunk);
}

// Paused: pull exactly 2 then stop
console.log("=== PAUSED (first 2 only) ===");
const gen = source();
let result = gen.next();
let count = 0;
while (!result.done && count < 2) {
  console.log("pulled:", result.value);
  count++;
  result = gen.next();
}
console.log("stopped early — remaining chunks never produced");
```

</details>

## Common pitfalls

> [!PITFALL] Attaching a 'data' listener after an async delay
> If you create a Readable and attach `.on("data", ...)` after an asynchronous delay, the stream may have already emitted all data before your handler is attached. Always attach listeners synchronously right after creating the stream, or use `pipeline()` which manages this safely.

Another classic mistake: forgetting that `chunk` is a `Buffer`, not a string. Always call `chunk.toString()` or set `{ encoding: "utf8" }` in the stream options when you need text.

## What you learned

- Streams process data in chunks, keeping memory near-constant regardless of input size.
- Node has four stream types: **Readable** (source), **Writable** (sink), **Duplex** (both, independent), **Transform** (both, coupled — transforms written data into readable data).
- Readables start in **paused mode**; attaching a `data` listener or calling `.pipe()` switches to **flowing mode**.
- The `data`, `end`, and `error` events are the core Readable event API; always handle `error`.
- **Object mode** streams pass arbitrary JS values as chunks instead of Buffers.

## Next steps

Now that you understand what streams are, the next lesson tackles the hardest part of streaming: **backpressure** — what happens when the producer is faster than the consumer — and why `stream.pipeline()` handles this correctly while naive `.pipe()` chaining does not.
*/});
