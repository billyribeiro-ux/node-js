registerLessonSrc("10-pipeline-backpressure", function () {/*
---
id: 10-pipeline-backpressure
title: "pipe vs pipeline & Backpressure Mechanics"
minutes: 24
level: advanced
objectives:
  - Explain backpressure and why ignoring it causes memory blow-ups
  - Use highWaterMark to tune buffer size between producer and consumer
  - Replace .pipe() with stream.pipeline() for correct error handling
---

# pipe vs pipeline & Backpressure Mechanics

## Why this matters

Streams would be useless if a fast producer could simply overwhelm a slow consumer. The mechanism that prevents this is **backpressure** — one of the most important (and most misunderstood) concepts in Node. Get it wrong and your server quietly allocates unbounded memory until it crashes. Get it right and you can pipe gigabytes through a 64 MB process all day.

## Learning objectives

- Define backpressure and explain when and why it occurs.
- Understand `highWaterMark` and how it controls buffer depth.
- Correctly use `.pipe()` and know its error-handling limitation.
- Use `stream.pipeline()` (and its promise variant) to connect streams safely.
- Simulate and observe backpressure in pure JavaScript.

## What is backpressure?

**Backpressure** is the signal a consumer sends to a producer saying: "slow down, I am not ready for more data yet."

Consider a fast Readable (e.g., reading from RAM) piped to a slow Writable (e.g., writing to a spinning disk or a slow network). If the Writable cannot keep up, Node's stream internals buffer the excess chunks in memory. Without any backpressure mechanism, that buffer grows without bound — a memory leak disguised as streaming.

```
Producer ──chunk──▶ [internal buffer] ──chunk──▶ Consumer
   fast               grows unbounded?              slow
```

The solution: when the Writable's internal buffer is full (its `highWaterMark` is reached), `writable.write()` returns `false`. A well-behaved producer **pauses** until the Writable emits `drain`, signalling the buffer is empty again.

```js
import { createReadStream, createWriteStream } from "node:fs";

const readable = createReadStream("huge.bin");
const writable = createWriteStream("copy.bin");

readable.on("data", (chunk) => {
  const ok = writable.write(chunk);
  if (!ok) {
    // Writable buffer is full — pause the source
    readable.pause();
    writable.once("drain", () => {
      // Buffer drained — resume the source
      readable.resume();
    });
  }
});

readable.on("end", () => writable.end());
readable.on("error", (err) => console.error("read error:", err));
writable.on("error", (err) => console.error("write error:", err));
```

> [!OUTPUT]
> (file copied without unbounded memory growth)

Writing that drain loop manually every time is tedious and error-prone. That is exactly what `.pipe()` does automatically.

## highWaterMark

Every stream has a `highWaterMark` (HWM) option — the number of bytes (or objects in object mode) the internal buffer should hold before signalling backpressure.

```js
import { createReadStream } from "node:fs";

// 1 MB chunks — useful when you want fewer, larger I/O operations
const rs = createReadStream("file.bin", { highWaterMark: 1024 * 1024 });

// 256 bytes — useful for low-latency, interactive streams
const smallRs = createReadStream("config.txt", { highWaterMark: 256 });
```

> [!NOTE] Default highWaterMark values
> For byte streams (strings, Buffers): 64 KB (65536 bytes). For object-mode streams: 16 objects. These defaults are good for general use — tune them only when you have measured a bottleneck.

> [!PRINCIPAL] HWM is a target, not a hard cap
> The internal buffer can momentarily exceed HWM. HWM is the *threshold* at which `write()` returns `false` to request backpressure — it does not physically prevent more data from being queued. If you ignore the `false` return value and keep calling `write()`, Node buffers everything you send. The HWM is a polite hint the stream trusts you to respect.

## .pipe(): the convenience wrapper

`.pipe(destination)` connects a Readable to a Writable and handles the drain/pause loop automatically:

```js
import { createReadStream, createWriteStream } from "node:fs";

// .pipe() returns the destination stream, enabling chaining
createReadStream("input.txt")
  .pipe(createWriteStream("output.txt"));
```

That is elegant. But `.pipe()` has a significant flaw: **it does not propagate errors**. If any stream in the chain emits an error, the other streams are neither closed nor cleaned up, leaving open file handles.

```js
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";

const src = createReadStream("input.txt");
const gz  = createGzip();
const dst = createWriteStream("output.gz");

// BAD: if gz errors, src and dst are not destroyed
src.pipe(gz).pipe(dst);

// You would need to manually attach error listeners to all three:
src.on("error", cleanup);
gz.on("error",  cleanup);
dst.on("error", cleanup);
function cleanup(err) {
  console.error(err);
  src.destroy();
  gz.destroy();
  dst.destroy();
}
```

That is boilerplate that is easy to get wrong. Enter `pipeline()`.

## stream.pipeline(): the right way

`stream.pipeline()` does everything `.pipe()` does, **and** it:
- Propagates errors from any stream to a single callback.
- Destroys all streams in the chain on error.
- Destroys all streams when the pipeline completes (preventing leaks).

```js
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream";

pipeline(
  createReadStream("input.txt"),
  createGzip(),
  createWriteStream("output.gz"),
  (err) => {
    if (err) {
      console.error("Pipeline failed:", err.message);
    } else {
      console.log("Pipeline succeeded.");
    }
  }
);
```

> [!OUTPUT]
> Pipeline succeeded.

### pipeline with promises (Node 15+)

```js
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

async function compress(src, dst) {
  await pipeline(
    createReadStream(src),
    createGzip(),
    createWriteStream(dst)
  );
  console.log("Compressed:", src, "->", dst);
}

compress("input.txt", "output.gz").catch(console.error);
```

> [!OUTPUT]
> Compressed: input.txt -> output.gz

> [!WARNING] Always import pipeline from "node:stream/promises" for async/await
> There are two `pipeline` exports: `node:stream` (callback-based) and `node:stream/promises` (returns a Promise). Mixing them up produces subtle bugs — the callback version does not return a useful promise.

## Try it yourself

Simulate backpressure in pure JavaScript — a producer that pauses when a bounded queue is full and resumes when the consumer drains it:

```js run
// Pure-JS backpressure simulation.
// Producer generates numbers; consumer processes them slowly (simulated with a counter).
// A bounded queue (highWaterMark) controls when the producer pauses.

function createBoundedQueue(hwm) {
  const buffer = [];
  let drainListeners = [];

  return {
    write(item) {
      buffer.push(item);
      const full = buffer.length >= hwm;
      if (full) return false; // signal backpressure
      return true;
    },
    drain() {
      // Consumer drains one item at a time
      const item = buffer.shift();
      if (buffer.length < hwm && drainListeners.length > 0) {
        const cb = drainListeners.shift();
        cb(); // signal producer to resume
      }
      return item;
    },
    onDrain(cb) {
      drainListeners.push(cb);
    },
    get size() { return buffer.length; }
  };
}

const HWM = 3;
const queue = createBoundedQueue(HWM);
const produced = [];
const consumed = [];

// Produce 10 items, respecting backpressure
function produce(i) {
  if (i > 10) {
    console.log("Producer done. Produced:", produced.join(","));
    return;
  }
  const ok = queue.write(i);
  produced.push(i);
  console.log("produced " + i + " | queue=" + queue.size + (ok ? "" : " [PAUSED]"));
  if (!ok) {
    // Queue full — wait for drain before continuing
    queue.onDrain(() => {
      console.log("  [RESUMED] queue=" + queue.size);
      produce(i + 1);
    });
  } else {
    produce(i + 1);
  }
}

// Consumer drains one item every "tick"
let tick = 0;
function consume() {
  const item = queue.drain();
  if (item !== undefined) {
    consumed.push(item);
    console.log("  consumed " + item + " | queue=" + queue.size);
  }
  tick++;
  if (tick < 20) setTimeout(consume, 0); // schedule next drain
  else console.log("Consumed:", consumed.join(","));
}

produce(1);
setTimeout(consume, 0); // start consumer after first batch of produces
```

## Exercises

**Exercise 1:** Rewrite the drain loop pattern from the top of the lesson as a reusable `safePipe(readable, writable)` function that handles backpressure and returns a Promise that resolves on finish or rejects on error.

<details>
<summary>Show solution</summary>

```js run
// Pure-JS safePipe — demonstrates the drain/pause/resume contract
function safePipe(readable, writable) {
  return new Promise((resolve, reject) => {
    readable.on("data", (chunk) => {
      const ok = writable.write(chunk);
      if (!ok) {
        readable.pause();
        writable.once("drain", () => readable.resume());
      }
    });
    readable.on("end", () => writable.end());
    readable.on("error", reject);
    writable.on("error", reject);
    writable.on("finish", resolve);
  });
}

// Simulate with simple event emitters (pure JS, no Node streams needed)
class FakeReadable {
  constructor(chunks) {
    this._chunks = chunks;
    this._handlers = {};
  }
  on(evt, fn) { this._handlers[evt] = fn; return this; }
  once(evt, fn) { this._handlers["once_" + evt] = fn; return this; }
  pause() { this._paused = true; }
  resume() {
    this._paused = false;
    if (this._handlers["once_resume"]) {
      this._handlers["once_resume"]();
    }
  }
  start() {
    for (const chunk of this._chunks) {
      if (this._handlers["data"]) this._handlers["data"](chunk);
    }
    if (this._handlers["end"]) this._handlers["end"]();
  }
}

// Instead of a full simulation, demonstrate the key concept:
console.log("Demonstration: write() returning false triggers pause + drain cycle");

const log = [];
const mockWritable = {
  _writes: 0,
  write(chunk) {
    this._writes++;
    log.push("write:" + chunk);
    // Signal backpressure on every 2nd write
    if (this._writes % 2 === 0) {
      setTimeout(() => { if (this._drainCb) this._drainCb(); }, 0);
      return false;
    }
    return true;
  },
  on(evt, fn) { if (evt === "error") this._errCb = fn; return this; },
  once(evt, fn) { if (evt === "drain") this._drainCb = fn; return this; },
  end() { log.push("end"); if (this._finishCb) setTimeout(this._finishCb, 0); },
  get onfinish() { return this._finishCb; },
  set onfinish(fn) { this._finishCb = fn; }
};

const chunks = ["a","b","c","d","e"];
let idx = 0;
let paused = false;

function pushNext() {
  while (idx < chunks.length && !paused) {
    const ok = mockWritable.write(chunks[idx++]);
    if (!ok) {
      paused = true;
      log.push("[paused at idx=" + idx + "]");
      mockWritable._drainCb = () => {
        paused = false;
        log.push("[resumed]");
        mockWritable._drainCb = null;
        pushNext();
      };
    }
  }
  if (idx >= chunks.length) mockWritable.end();
}

mockWritable._finishCb = () => console.log("Done. Event log:", log.join(" | "));
pushNext();
```

</details>

**Exercise 2:** Use `stream.pipeline` with the promise API to compress data through two transforms in sequence. Sketch the code (read-only style) and explain what happens if the gzip transform errors.

<details>
<summary>Show solution</summary>

In real Node:

```js
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip, createBrotliCompress } from "node:zlib";
import { pipeline } from "node:stream/promises";

// pipeline destroys ALL streams if any one of them errors
await pipeline(
  createReadStream("input.txt"),
  createGzip(),           // first transform
  createBrotliCompress(), // second transform
  createWriteStream("output.gz.br")
);
```

If `createGzip()` errors, `pipeline` immediately destroys all four streams (the file read handle is closed, the brotli transform is destroyed, the write stream is closed) and rejects the promise. No file handles leak. This is the key advantage over `.pipe()`.

```js run
// Pure-JS version: a pipeline() that destroys all stages on error
function purePipeline(...stages) {
  return new Promise((resolve, reject) => {
    function fail(err) {
      stages.forEach(s => { if (s.destroy) s.destroy(); });
      reject(err);
    }
    // Wire up: output of stage[i] is input of stage[i+1]
    for (let i = 0; i < stages.length - 1; i++) {
      stages[i].onData = (chunk) => {
        const ok = stages[i + 1].write(chunk);
        if (!ok) stages[i].pause();
      };
      stages[i + 1].onDrain = () => stages[i].resume();
      stages[i].onError = fail;
      stages[i + 1].onError = fail;
    }
    stages[stages.length - 1].onFinish = resolve;
    stages[0].start();
  });
}

console.log("pipeline() error-propagation principle demonstrated");
console.log("If any stage emits 'error', all stages are destroyed and the promise rejects.");
```

</details>

## Common pitfalls

> [!PITFALL] Using .pipe() in production code without error handlers
> `.pipe()` is fine for quick scripts, but every production pipeline should use `stream.pipeline()` or manually attach `error` handlers to all streams. A single missed error handler can leak file descriptors and eventually exhaust system limits.

> [!PITFALL] Ignoring the return value of writable.write()
> If you call `writable.write()` in a loop without checking its return value, you bypass backpressure entirely. The internal buffer will grow without bound until the process OOMs. The `drain` event and the `false` return value are the contract — respect them, or use `pipeline()` which does this for you.

## What you learned

- **Backpressure** is the signal from consumer to producer to slow down — ignoring it causes unbounded memory growth.
- `highWaterMark` is the buffer depth at which a Writable returns `false` from `.write()`, requesting a pause.
- `.pipe()` automates the drain/pause/resume loop but does **not** propagate errors between streams.
- `stream.pipeline()` connects streams correctly: it propagates errors and destroys all streams on failure.
- Use `node:stream/promises` for the async/await-friendly version of `pipeline`.

## Next steps

Now that you understand how streams are connected and how backpressure keeps them healthy, the next lesson builds on that foundation with **Transform streams** — how to write your own data-processing steps and chain them into powerful pipelines.
*/});
