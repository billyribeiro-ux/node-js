registerLessonSrc("10-web-streams", function () {/*
---
id: 10-web-streams
title: "Web Streams & Interop"
minutes: 28
level: advanced
objectives:
  - Use ReadableStream, WritableStream, and TransformStream from the Web Streams API
  - Interoperate between Node streams and Web Streams using toWeb/fromWeb
  - Build a streaming CSV-to-JSON transformer in constant memory
---

# Web Streams & Interop

## Why this matters

The web platform now has its own streaming API — **Web Streams** (the WHATWG Streams Standard). It is built into browsers, Deno, Bun, and, since Node 18, into Node.js core (`globalThis.ReadableStream`). The `fetch()` API returns a Web Streams `ReadableStream` for its response body. Edge runtimes (Cloudflare Workers, Vercel Edge) run *only* Web Streams. Knowing both APIs — and how to bridge them — makes you ready to write streaming code that runs anywhere.

## Learning objectives

- Explain the Web Streams API: `ReadableStream`, `WritableStream`, `TransformStream`.
- Consume a `ReadableStream` with `for await...of` and a reader.
- Convert between Node streams and Web Streams with `Readable.toWeb()` / `Readable.fromWeb()`.
- Build a complete streaming pipeline using only the Web Streams API.

## The Web Streams API

The three core classes mirror Node's stream types:

| Web Streams | Node streams | Role |
|---|---|---|
| `ReadableStream` | `Readable` | source of data |
| `WritableStream` | `Writable` | sink of data |
| `TransformStream` | `Transform` | processing step |

They differ from Node streams in important ways:
- Based on **Promises** and **async iterators** throughout — no callback style.
- **Backpressure** is built in via the `queuingStrategy` and the controller's `desiredSize`.
- Designed for the browser-first environment: cross-platform, no `EventEmitter`.

### Creating a ReadableStream

```js
// A ReadableStream with a custom pull() source
const stream = new ReadableStream({
  start(controller) {
    // optional: called immediately when the stream is created
  },
  pull(controller) {
    // called when the consumer wants more data
    // push data via controller.enqueue(), or close with controller.close()
    controller.enqueue("hello ");
    controller.enqueue("world\n");
    controller.close();   // signals end-of-stream
  },
  cancel(reason) {
    // called if the consumer cancels the stream
    console.log("cancelled:", reason);
  }
});
```

### Consuming a ReadableStream

```js
// Option 1: getReader() — low-level, fine-grained control
const reader = stream.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(value);
}
reader.releaseLock();

// Option 2: for await...of — clean and idiomatic (Node 18+)
for await (const chunk of stream) {
  console.log(chunk);
}
```

> [!OUTPUT]
> hello
> world

### TransformStream

```js
// A TransformStream with transform() and flush() — same concept as Node's Transform
const upperCase = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk.toString().toUpperCase());
  },
  flush(controller) {
    // push any final data here before closing
    controller.terminate(); // or just return
  }
});

// Chain: readable.pipeThrough(transform).pipeTo(writable)
const response = await fetch("https://example.com/data.txt");
await response.body
  .pipeThrough(new TextDecoderStream())  // Uint8Array -> string
  .pipeThrough(upperCase)
  .pipeTo(new WritableStream({
    write(chunk) {
      console.log(chunk);
    }
  }));
```

> [!OUTPUT]
> HELLO WORLD FROM EXAMPLE.COM

> [!NOTE] TextDecoderStream and TextEncoderStream
> `fetch()` gives you raw `Uint8Array` chunks. Wrap the stream with `new TextDecoderStream()` to decode bytes to strings, and `new TextEncoderStream()` to go the other way. Both are `TransformStream`s and compose naturally with `pipeThrough()`.

## Node stream interop: toWeb() and fromWeb()

Node 18+ provides static methods on its stream classes to convert between the two worlds:

```js
import { Readable, Writable } from "node:stream";

// Node Readable -> Web ReadableStream
const nodeReadable = Readable.from(["chunk1", "chunk2", "chunk3"]);
const webReadable  = Readable.toWeb(nodeReadable);

// Web ReadableStream -> Node Readable
const backToNode = Readable.fromWeb(webReadable);

// Node Writable -> Web WritableStream
const nodeWritable = new Writable({
  write(chunk, _enc, cb) { console.log("wrote:", chunk.toString()); cb(); }
});
const webWritable = Writable.toWeb(nodeWritable);
```

> [!OUTPUT]
> wrote: chunk1
> wrote: chunk2
> wrote: chunk3

This is critical for the **fetch ecosystem**. When you call `fetch()` in Node, the response body is a `ReadableStream`. Convert it to a Node Readable to use it with Node's `pipeline()`, Transform classes, or file system streams:

```js
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";

// Download a large file and gzip it on the fly — constant memory
const response = await fetch("https://example.com/large-dataset.csv");
const nodeReadable = Readable.fromWeb(response.body);

await pipeline(
  nodeReadable,
  createGzip(),
  createWriteStream("dataset.csv.gz")
);
console.log("Downloaded and compressed in constant memory.");
```

> [!OUTPUT]
> Downloaded and compressed in constant memory.

> [!PRINCIPAL] Web Streams are the portability layer
> If you write a processing pipeline using only Web Streams primitives (`ReadableStream`, `TransformStream`, `WritableStream`), it runs unchanged in a browser, in Cloudflare Workers, in Deno, and in Node 18+. This is an architectural advantage: your core data processing logic is not tied to Node. Use `Readable.fromWeb()` and `Readable.toWeb()` only at the integration boundaries where you need to use Node-specific streams (file system, zlib, net).

## Queuing strategies and backpressure

Web Streams handle backpressure through a **queuing strategy** that reports `desiredSize` — how much room is left in the internal queue.

```js
// ByteLengthQueuingStrategy: counts bytes (for binary streams)
const byteStream = new ReadableStream(
  {
    pull(controller) {
      // controller.desiredSize tells us how hungry the consumer is
      if (controller.desiredSize > 0) {
        controller.enqueue(new Uint8Array(1024)); // 1 KB chunk
      }
    }
  },
  new ByteLengthQueuingStrategy({ highWaterMark: 65536 }) // 64 KB HWM
);

// CountQueuingStrategy: counts items (for object streams)
const objectStream = new ReadableStream(
  {
    pull(controller) {
      controller.enqueue({ id: Math.random() });
    }
  },
  new CountQueuingStrategy({ highWaterMark: 16 })
);
```

> [!WARNING] Web Streams backpressure is automatic but not free
> When `desiredSize` is zero or negative, the stream's internal queue is full. If your `pull()` method ignores `desiredSize` and keeps enqueuing, you will still accumulate data in the queue — the same memory problem as ignoring `writable.write() === false` in Node streams. Always check `controller.desiredSize` in `pull()`.

## Try it yourself

Build and consume a small Web Streams pipeline in pure JS — a `ReadableStream` source piped through a `TransformStream` into a `WritableStream`. All three are available in the worker sandbox:

```js run
// End-to-end Web Streams pipeline — runs in the sandbox.
// Source: emits numbers 1-5 as strings.
// Transform: uppercases "item N" labels.
// Sink: collects results into an array.

const source = new ReadableStream({
  start(controller) {
    for (let i = 1; i <= 5; i++) {
      controller.enqueue("item " + i);
    }
    controller.close();
  }
});

const labelTransform = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue("[PROCESSED] " + chunk.toUpperCase());
  }
});

const results = [];
const sink = new WritableStream({
  write(chunk) {
    results.push(chunk);
  }
});

// pipeThrough returns a new ReadableStream; pipeTo returns a Promise
await source
  .pipeThrough(labelTransform)
  .pipeTo(sink);

console.log("Pipeline complete. Results:");
for (const r of results) {
  console.log(r);
}
console.log("Total items processed:", results.length);
```

## Project

### Build a streaming CSV-to-JSON transformer

**Goal:** Process a multi-GB CSV file in constant memory, converting it to newline-delimited JSON (NDJSON), and optionally gzip the output. The solution must use streaming throughout — no buffering of the entire file.

**Acceptance criteria:**

1. Memory stays near-constant (within ~100 MB) regardless of input file size — tested by running with `--max-old-space-size=128` on a 2 GB file.
2. The pipeline reads compressed input (`.csv.gz`) OR plain `.csv` and handles both transparently.
3. CSV parsing is stateful across chunk boundaries — a row split across two chunks must still parse correctly.
4. Each valid CSV row is emitted as a JSON object with headers as keys; malformed rows are skipped with a warning logged to stderr.
5. The output is valid NDJSON: one JSON object per line, UTF-8, LF line endings.
6. The pipeline can be composed with a gzip output stage — the final command-line call produces a `.ndjson.gz` file.

### Starter: pure-JS stateful CSV line parser

The hardest part is the stateful parser that handles chunks splitting rows mid-line. Here is the core logic you can build on:

```js run
// Pure-JS stateful CSV-to-object parser.
// Demonstrates the chunk-boundary problem and how to solve it with a remainder buffer.

function createCSVParser() {
  let headers = null;
  let remainder = "";
  let rowCount = 0;
  let skipped = 0;
  const output = [];

  function parseRow(line) {
    // Minimal CSV: split on comma, trim whitespace, handle empty fields
    return line.split(",").map(f => f.trim());
  }

  function processChunk(chunk) {
    // Prepend any leftover text from the previous chunk
    const text = remainder + chunk;
    const lines = text.split("\n");
    // The last element may be incomplete — save it for the next chunk
    remainder = lines.pop();

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const values = parseRow(line);

      if (!headers) {
        headers = values;
        continue;
      }

      if (values.length !== headers.length) {
        skipped++;
        // In real code: process.stderr.write("skipped malformed row\n");
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i]; });
      output.push(obj);
      rowCount++;
    }
  }

  function flush() {
    // Handle any trailing text not terminated by a newline
    if (remainder.trim() && headers) {
      const values = parseRow(remainder.trim());
      if (values.length === headers.length) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i]; });
        output.push(obj);
        rowCount++;
      } else {
        skipped++;
      }
    }
    remainder = "";
  }

  return { processChunk, flush, output, stats: () => ({ rowCount, skipped }) };
}

// Simulate a large CSV arriving in arbitrary chunk sizes (chunk boundary splits a row)
const csvData =
  "name,age,city\n" +
  "Alice,30,New York\n" +
  "Bob,25,London\n" +
  "Carol,28,Paris\n" +
  "Dave,35,Tokyo";    // no trailing newline — tests flush()

// Deliberately use a chunk size that splits rows in the middle
const CHUNK_SIZE = 20;
const parser = createCSVParser();

console.log("=== Processing chunks ===");
for (let i = 0; i < csvData.length; i += CHUNK_SIZE) {
  const chunk = csvData.slice(i, i + CHUNK_SIZE);
  console.log("chunk:", JSON.stringify(chunk));
  parser.processChunk(chunk);
}
parser.flush();

console.log("\n=== Parsed objects (NDJSON) ===");
for (const obj of parser.output) {
  console.log(JSON.stringify(obj));
}

const { rowCount, skipped } = parser.stats();
console.log("\nStats: " + rowCount + " rows parsed, " + skipped + " skipped");
```

<details>
<summary>Show the full Node.js pipeline (read-only — uses Node APIs)</summary>

```js
// csv-to-ndjson.mjs — full streaming pipeline
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function createCSVtoNDJSON() {
  let headers = null;
  let remainder = "";

  return new Transform({
    decodeStrings: true,

    transform(chunk, _enc, callback) {
      const text = remainder + chunk.toString("utf8");
      const lines = text.split("\n");
      remainder = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const values = line.split(",").map(f => f.trim());
        if (!headers) { headers = values; continue; }
        if (values.length !== headers.length) {
          process.stderr.write("skipped: " + JSON.stringify(line) + "\n");
          continue;
        }
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i]; });
        this.push(JSON.stringify(obj) + "\n");
      }
      callback();
    },

    flush(callback) {
      if (remainder.trim() && headers) {
        const values = remainder.split(",").map(f => f.trim());
        if (values.length === headers.length) {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = values[i]; });
          this.push(JSON.stringify(obj) + "\n");
        }
      }
      callback();
    }
  });
}

const [,, inputFile, outputFile] = process.argv;
const isCompressedInput  = inputFile.endsWith(".gz");
const isCompressedOutput = outputFile.endsWith(".gz");

await pipeline(
  createReadStream(inputFile),
  ...(isCompressedInput  ? [createGunzip()]  : []),
  createCSVtoNDJSON(),
  ...(isCompressedOutput ? [createGzip()]    : []),
  createWriteStream(outputFile)
);

console.log("Done:", inputFile, "->", outputFile);
```

Run: `node csv-to-ndjson.mjs data.csv.gz output.ndjson.gz`

</details>

## Common pitfalls

> [!PITFALL] Calling reader.releaseLock() before the stream is fully consumed
> If you use `getReader()` and then forget to call `reader.releaseLock()` (or do it before reading is complete), the stream remains locked and any subsequent attempt to read or pipe it will throw. Always use `try/finally` or prefer `for await...of`, which releases the lock automatically when the loop exits.

> [!PITFALL] Mixing Web Streams and Node streams without the adapter
> Passing a `ReadableStream` (Web) directly to Node's `pipeline()` throws a type error. Always convert with `Readable.fromWeb()` first. Conversely, passing a Node `Readable` to `.pipeThrough()` (Web) also fails — convert with `Readable.toWeb()`.

## What you learned

- Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) are the portable, Promise-based standard now available in Node, browsers, and edge runtimes.
- `pipeThrough()` connects a readable to a transform; `pipeTo()` connects it to a writable — both return Promises.
- Node 18+ provides `Readable.toWeb()` / `Readable.fromWeb()` to bridge between Node and Web Streams at integration boundaries.
- `ByteLengthQueuingStrategy` and `CountQueuingStrategy` control backpressure in Web Streams.
- The stateful remainder buffer pattern solves chunk-boundary problems in any streaming parser.

## Next steps

You have completed the Streams & Backpressure deep dive. The next module explores the **`process` object and CLI tooling** — environment variables, signals, stdin/stdout, and building real command-line tools with Node.
*/});
