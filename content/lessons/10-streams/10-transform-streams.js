registerLessonSrc("10-transform-streams", function () {/*
---
id: 10-transform-streams
title: "Building Transform Streams"
minutes: 23
level: advanced
objectives:
  - Implement custom Transform streams using transform() and flush()
  - Chain multiple transforms into a pipeline
  - Build object-mode transforms for structured data processing
---

# Building Transform Streams

## Why this matters

Reading and writing are the ends of a pipeline. Transform streams are the *middle* — the processing steps that make streaming useful: parsing, compressing, encrypting, filtering, mapping, aggregating. Understanding how to build your own transforms turns streams from a consumption API into a composition model for building complex data pipelines out of small, testable pieces.

## Learning objectives

- Implement the `transform()` method to process each chunk.
- Implement `flush()` to emit any buffered data after the last chunk.
- Chain multiple transforms together with `stream.pipeline()`.
- Build object-mode transforms that work with structured data.

## The Transform class

A Transform is a Duplex stream where the readable side is derived from the writable side. You write data in, the transform method processes it, and data comes out the readable end. All you implement are two methods:

- `transform(chunk, encoding, callback)` — called for each input chunk. Call `callback(null, outputChunk)` to push output, or `this.push(chunk)` + `callback()`.
- `flush(callback)` — called after all input is consumed but before the stream closes. Use it to emit any remaining buffered state.

```js
import { Transform } from "node:stream";

// A simple uppercase transform
const toUpperCase = new Transform({
  transform(chunk, encoding, callback) {
    // chunk is a Buffer by default; toString() converts it
    callback(null, chunk.toString().toUpperCase());
  }
  // flush is optional — no buffered state here
});

// Use it as a pipeline stage
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

await pipeline(
  createReadStream("input.txt"),
  toUpperCase,
  createWriteStream("output.txt")
);
```

> [!OUTPUT]
> (output.txt contains uppercased contents of input.txt)

## The flush() method: draining buffered state

Some transforms accumulate state across chunks — a line splitter, a JSON parser, a checksum calculator. The `flush()` method fires after all input chunks have been processed, giving you a chance to push any final output.

```js
import { Transform } from "node:stream";

// A transform that splits a byte stream into complete lines.
// It buffers the last incomplete line across chunks.
class LineByLine extends Transform {
  constructor(options) {
    super(options);
    this._remainder = "";
  }

  transform(chunk, _encoding, callback) {
    const text = this._remainder + chunk.toString();
    const lines = text.split("\n");
    // The last element may be incomplete — hold it for the next chunk
    this._remainder = lines.pop();
    for (const line of lines) {
      this.push(line + "\n");
    }
    callback();
  }

  flush(callback) {
    // Emit any trailing text that did not end with a newline
    if (this._remainder) {
      this.push(this._remainder);
    }
    callback();
  }
}
```

```js
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

let lineCount = 0;
await pipeline(
  createReadStream("server.log"),
  new LineByLine(),
  new Writable({
    write(line, _enc, done) {
      lineCount++;
      done();
    }
  })
);
console.log("Total lines:", lineCount);
```

> [!OUTPUT]
> Total lines: 42837

> [!PRINCIPAL] Design each transform to do one thing
> The power of transforms is composition. A `LineByLine` transform does not know about JSON parsing; a `JSONParse` transform does not know about filtering; a `FilterByField` transform does not know about serialization. Each is independently testable. Combining them with `pipeline` builds a complex processing chain from simple, correct parts — the Unix pipe philosophy applied to Node.js.

## Chaining transforms in a pipeline

Transforms compose naturally. Here is a pipeline that reads a gzipped NDJSON log, decompresses it, parses lines, filters errors, and writes to a new file:

```js
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

// Parse each line as a JSON object (object mode output)
const parseJSON = new Transform({
  readableObjectMode: true,   // outputs objects
  transform(chunk, _enc, cb) {
    try {
      cb(null, JSON.parse(chunk.toString().trim()));
    } catch {
      cb(); // skip malformed lines silently
    }
  }
});

// Filter objects by a field value (object mode in, object mode out)
function filterBy(field, value) {
  return new Transform({
    objectMode: true,
    transform(obj, _enc, cb) {
      if (obj[field] === value) this.push(obj);
      cb();
    }
  });
}

// Re-serialize objects back to NDJSON (object mode in, string out)
const toNDJSON = new Transform({
  writableObjectMode: true,   // accepts objects
  transform(obj, _enc, cb) {
    cb(null, JSON.stringify(obj) + "\n");
  }
});

await pipeline(
  createReadStream("app.log.gz"),
  createGunzip(),
  new LineByLine(),     // from the previous example
  parseJSON,
  filterBy("level", "error"),
  toNDJSON,
  createWriteStream("errors.ndjson")
);
console.log("Errors extracted.");
```

> [!OUTPUT]
> Errors extracted.

> [!NOTE] readableObjectMode vs writableObjectMode
> When a Transform bridges byte mode and object mode, set both sides independently. `readableObjectMode: true` means the readable side emits objects; `writableObjectMode: true` means the writable side accepts objects. You can mix them to build type-crossing adapters.

## Object-mode transforms

When the data in your pipeline is already structured (after a parse step), object-mode transforms let you work with plain JS objects instead of Buffers:

```js
import { Transform } from "node:stream";

// Compute a running average of a numeric field
class RunningAverage extends Transform {
  constructor(field) {
    super({ objectMode: true });
    this._field = field;
    this._sum = 0;
    this._count = 0;
  }

  transform(obj, _enc, cb) {
    this._sum += obj[this._field] || 0;
    this._count++;
    // Pass the object through, augmented with the current running average
    cb(null, { ...obj, runningAvg: this._sum / this._count });
  }
}
```

> [!OUTPUT]
> { value: 10, runningAvg: 10 }
> { value: 20, runningAvg: 15 }
> { value: 30, runningAvg: 20 }

## Try it yourself

A Transform pipeline is really a **function composition** over chunks. Model it in pure JS: compose an array of transform functions (each taking a value and returning a new value) into a single pipeline function, then run data through it incrementally:

```js run
// Pure-JS transform pipeline composition.
// Each "transform" is a function: value -> value (or null to filter the item out).
function composePipeline(...transforms) {
  return function process(value) {
    let current = value;
    for (const t of transforms) {
      if (current === null || current === undefined) return null;
      current = t(current);
    }
    return current;
  };
}

// Define transform steps
const toUpperCase  = (s) => s.toUpperCase();
const trim         = (s) => s.trim();
const addPrefix    = (s) => "[LOG] " + s;
const filterShort  = (s) => s.length > 10 ? s : null; // filter out short lines

const pipeline = composePipeline(trim, toUpperCase, filterShort, addPrefix);

// Simulate a stream of chunks (lines from a log file)
const inputChunks = [
  "  error: disk full  ",
  "ok",
  "  warning: memory high  ",
  "  info: restarted  ",
  "x",
];

console.log("=== Pipeline output ===");
let emitted = 0;
for (const chunk of inputChunks) {
  const result = pipeline(chunk);
  if (result !== null) {
    console.log(result);
    emitted++;
  }
}
console.log("Emitted " + emitted + " of " + inputChunks.length + " chunks (filtered " + (inputChunks.length - emitted) + ")");
```

## Exercises

**Exercise 1:** Implement a `ChunkCounter` transform that passes all data through unchanged but counts the total number of chunks and total bytes seen. At flush time, it should push a final summary line: `"--- chunks: N, bytes: B\n"`.

<details>
<summary>Show solution</summary>

```js run
// ChunkCounter: pass-through transform that adds a summary at the end
function createChunkCounter() {
  let chunks = 0;
  let bytes = 0;

  // Simulate transform() and flush() logic in pure JS
  const results = [];

  function transform(chunk) {
    chunks++;
    bytes += chunk.length;
    results.push(chunk); // pass through
  }

  function flush() {
    results.push("--- chunks: " + chunks + ", bytes: " + bytes);
  }

  return { transform, flush, results };
}

const counter = createChunkCounter();
const inputs = ["Hello, ", "world!", " This is", " streaming."];

for (const chunk of inputs) counter.transform(chunk);
counter.flush();

console.log("Output:");
for (const line of counter.results) console.log(line);
```

</details>

**Exercise 2:** Write a `CSVToObjects` transform (object mode output) that takes newline-delimited CSV text chunks, splits on lines, parses the first line as headers, and emits subsequent lines as plain objects.

<details>
<summary>Show solution</summary>

```js run
// Pure-JS CSVToObjects: stateful line-by-line CSV parser
function createCSVToObjects() {
  let headers = null;
  let remainder = "";
  const output = [];

  function transform(chunk) {
    const text = remainder + chunk;
    const lines = text.split("\n");
    remainder = lines.pop(); // hold incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const values = trimmed.split(",");
      if (!headers) {
        headers = values.map(h => h.trim());
      } else {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (values[i] || "").trim(); });
        output.push(obj);
      }
    }
  }

  function flush() {
    if (remainder.trim() && headers) {
      const values = remainder.split(",");
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (values[i] || "").trim(); });
      output.push(obj);
    }
  }

  return { transform, flush, output };
}

const parser = createCSVToObjects();
// Simulate chunked CSV arriving in arbitrary pieces
parser.transform("name,age,city\nAli");
parser.transform("ce,30,New York\nBob,25,");
parser.transform("London\nCarol,28,Paris");
parser.flush();

console.log("Parsed objects:");
for (const obj of parser.output) {
  console.log(JSON.stringify(obj));
}
```

</details>

## Common pitfalls

> [!PITFALL] Calling callback() more than once in transform()
> Each call to `transform(chunk, enc, callback)` must call `callback` exactly once. Calling it twice causes the stream to enter a broken state and emit duplicate data or errors. If you push multiple output chunks for one input chunk, use multiple `this.push()` calls and then call `callback()` once at the end.

> [!PITFALL] Forgetting flush() when your transform is stateful
> If your transform buffers partial state across chunks (e.g., a line splitter holding an incomplete line), and you forget to implement `flush()`, the last partial chunk is silently dropped. Always implement `flush()` whenever you accumulate state.

## What you learned

- A Transform stream implements `transform(chunk, encoding, callback)` to process each chunk and `flush(callback)` to emit any final buffered state.
- Transforms compose cleanly: each does one thing, and `pipeline()` chains them.
- Use `readableObjectMode` / `writableObjectMode` when a transform bridges byte streams and object streams.
- Object-mode transforms let you work with plain JS values (objects, arrays) instead of Buffers — essential for structured data pipelines.

## Next steps

The final lesson in this module covers **Web Streams** — the browser-native streaming API that is now built into Node as well — and how to interoperate between Node streams and Web Streams. You will also build the module's capstone project: a streaming CSV-to-JSON transformer in constant memory.
*/});
