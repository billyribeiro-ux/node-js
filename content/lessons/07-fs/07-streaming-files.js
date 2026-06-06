registerLessonSrc("07-streaming-files", function () {/*
---
id: 07-streaming-files
title: "Working With Large Files Safely"
minutes: 28
level: intermediate
objectives:
  - Explain why readFile on large files causes memory problems
  - Read and write large files using createReadStream / createWriteStream
  - Process files line-by-line with constant memory usage
---

# Working With Large Files Safely

## Why this matters

A 4 GB log file, a CSV with ten million rows, a video upload — these exist in real systems. `readFile` loads the *entire file into RAM* before you can touch a single byte. On a server handling many concurrent requests, that's a fast path to an out-of-memory crash. Streams let you process data as it arrives, keeping memory flat no matter how large the file is. This lesson shows you the practical pattern; Module 10 goes deep on streams as a general abstraction.

## Learning objectives

- Explain why `readFile` on large files is dangerous.
- Open file streams with `createReadStream` and `createWriteStream`.
- Process a file line-by-line using the `readline` module.
- Understand what "constant memory" means and how to verify it.

## The problem with `readFile` on large files

`fs.readFile` reads the *entire* file, builds a `Buffer` or string in memory, then calls your callback. For a 10 MB config file that's fine. For a 2 GB server log it looks like this:

```
[Disk]                      [Node process]
 ┌─────────────────┐         ┌────────────────────────────────┐
 │  2 GB log file  │──────►  │  2 GB Buffer in heap           │
 └─────────────────┘         │  + your code                   │
                              │  → OOM if heap limit exceeded  │
                              └────────────────────────────────┘
```

With a stream, Node reads a small **chunk** at a time (default 64 KB), processes it, and discards it. Memory stays at roughly chunk-size regardless of file size:

```
[Disk]       [Node]      [Destination / processing]
 64 KB ──►  process ──►  write / count / parse
 64 KB ──►  process ──►  (previous chunk already GC'd)
  ...
```

> [!PRINCIPAL] Streaming is a contract about time vs space
> `readFile` trades memory for simplicity — you get the whole file at once. Streaming trades that simplicity for bounded memory and the ability to start producing output before the input is fully read. In a server context, bounded memory is almost always worth it for anything over a few megabytes. The rule of thumb: if the file could be larger than your available RAM divided by the number of concurrent requests you expect, stream it.

## `createReadStream` — reading in chunks

```js
import { createReadStream } from "node:fs";

const stream = createReadStream("access.log", {
  encoding: "utf8",  // decode each chunk as a string
  highWaterMark: 64 * 1024, // chunk size in bytes (default 64 KB)
});

stream.on("data", (chunk) => {
  process.stdout.write(chunk); // chunk is a string (or Buffer without encoding)
});

stream.on("end", () => {
  console.log("\n--- done ---");
});

stream.on("error", (err) => {
  console.error("read error:", err.message);
});
```

> [!OUTPUT]
> (file contents printed chunk by chunk)
> --- done ---

> [!NOTE] Omit `encoding` to get raw Buffers
> Without `encoding`, each `"data"` event gives you a `Buffer`. Useful when processing binary files (images, SQLite databases, zip archives) where UTF-8 decoding would corrupt the data.

## `createWriteStream` — writing in chunks

```js
import { createWriteStream } from "node:fs";

const out = createWriteStream("output.log", { flags: "a" }); // append mode

out.write("Line one\n");
out.write("Line two\n");
out.end("Final line\n"); // flushes and closes the stream

out.on("finish", () => console.log("all written"));
out.on("error", (err) => console.error("write error:", err.message));
```

> [!OUTPUT]
> all written

### Piping — the cleanest way to copy or transform

The `pipe` method wires a readable stream's output into a writable stream, handling backpressure automatically:

```js
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

// Compress a log file in a single streaming pipeline — constant memory!
await pipeline(
  createReadStream("access.log"),
  createGzip(),
  createWriteStream("access.log.gz")
);
console.log("compressed!");
```

> [!OUTPUT]
> compressed!

Use `stream/promises pipeline` rather than `.pipe()` directly — it properly propagates errors and cleans up all streams in the chain if one fails.

## Processing line-by-line with `readline`

Chunks don't respect line boundaries — a chunk may end mid-line. The `node:readline` module wraps a readable stream and emits one `"line"` event per newline:

```js
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({
  input: createReadStream("access.log", { encoding: "utf8" }),
  crlfDelay: Infinity, // handle Windows \r\n line endings
});

let lineCount = 0;
let errorCount = 0;

rl.on("line", (line) => {
  lineCount++;
  if (line.includes("ERROR")) errorCount++;
});

rl.on("close", () => {
  console.log(`Scanned ${lineCount} lines, found ${errorCount} errors`);
});
```

> [!OUTPUT]
> Scanned 84203 lines, found 17 errors

For `async/await` style, `readline` exposes an async iterator:

```js
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({
  input: createReadStream("data.csv", { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const [id, name, score] = line.split(",");
  if (Number(score) > 90) console.log(`High scorer: ${name}`);
}
```

> [!OUTPUT]
> High scorer: Ada
> High scorer: Grace

The `for await...of` loop pauses at each `await`, naturally applying backpressure — it won't read faster than you can process.

> [!PITFALL] `readline` only works with text files
> `createInterface` assumes newline-delimited text. Don't use it for binary files (images, SQLite, etc.) — you'll corrupt the data. For binary formats, process raw `Buffer` chunks from a `createReadStream` without an encoding option.

## Try it yourself

The key insight — chunked processing with running totals — is pure JS. Here's a simulation of streaming a large CSV and computing stats with constant memory:

```js run
// Simulate processing a large CSV file in chunks (no real I/O needed).
// The trick: maintain running state, never accumulate the full dataset.

function processChunk(chunk, state) {
  // chunk is an array of rows (simulating lines from readline)
  for (const row of chunk) {
    const [, , scoreStr] = row.split(",");
    const score = Number(scoreStr);
    if (Number.isNaN(score)) continue;
    state.count++;
    state.sum += score;
    if (score > state.max) state.max = score;
    if (score < state.min) state.min = score;
  }
}

// Build a fake "large file" as chunks of rows
function generateChunks(totalRows, chunkSize) {
  const chunks = [];
  for (let i = 0; i < totalRows; i += chunkSize) {
    const chunk = [];
    for (let j = i; j < Math.min(i + chunkSize, totalRows); j++) {
      chunk.push(`${j},user${j},${Math.floor(Math.random() * 100)}`);
    }
    chunks.push(chunk);
  }
  return chunks;
}

const TOTAL_ROWS = 100_000;
const CHUNK_SIZE = 1_000;

const state = { count: 0, sum: 0, min: Infinity, max: -Infinity };
const chunks = generateChunks(TOTAL_ROWS, CHUNK_SIZE);

console.log(`Processing ${TOTAL_ROWS} rows in ${chunks.length} chunks...`);
for (const chunk of chunks) {
  processChunk(chunk, state);
}

console.log(`Rows processed : ${state.count}`);
console.log(`Average score  : ${(state.sum / state.count).toFixed(2)}`);
console.log(`Min / Max      : ${state.min} / ${state.max}`);
console.log(`Peak objects in memory: 1 chunk (~${CHUNK_SIZE} rows), not ${TOTAL_ROWS}`);
```

## Exercise

**Challenge:** Extend `processChunk` above to also count how many rows have a score above 75. Print it at the end.

<details>
<summary>Show solution</summary>

```js run
function processChunk(chunk, state) {
  for (const row of chunk) {
    const [, , scoreStr] = row.split(",");
    const score = Number(scoreStr);
    if (Number.isNaN(score)) continue;
    state.count++;
    state.sum += score;
    if (score > state.max) state.max = score;
    if (score < state.min) state.min = score;
    if (score > 75) state.highScorers++;
  }
}

function generateChunks(totalRows, chunkSize) {
  const chunks = [];
  for (let i = 0; i < totalRows; i += chunkSize) {
    const chunk = [];
    for (let j = i; j < Math.min(i + chunkSize, totalRows); j++) {
      chunk.push(`${j},user${j},${Math.floor(Math.random() * 100)}`);
    }
    chunks.push(chunk);
  }
  return chunks;
}

const state = { count: 0, sum: 0, min: Infinity, max: -Infinity, highScorers: 0 };
const chunks = generateChunks(50_000, 1_000);

for (const chunk of chunks) {
  processChunk(chunk, state);
}

console.log(`Total rows     : ${state.count}`);
console.log(`Average score  : ${(state.sum / state.count).toFixed(2)}`);
console.log(`High scorers   : ${state.highScorers} (score > 75)`);
```

</details>

## Project

### Build a recursive directory tree + disk-usage analyzer CLI

Build a `du.js` CLI tool (a simplified `du -sh`) that:

1. **Accepts a root path** as a command-line argument (default: `.`).
2. **Recursively walks** the directory tree using `fs.readdir` with `{ withFileTypes: true, recursive: true }` and `fs.stat` to read each file's size.
3. **Prints a tree view** of directories with their total sizes (sum of all files inside), formatted in human-readable units (B, KB, MB, GB).
4. **Shows a grand total** at the end, matching `du -sh .` output.
5. **Adds a `--watch` flag** that re-runs the analysis every time a file in the tree changes, using `fs.watch` with debouncing so it doesn't hammer the filesystem.
6. **Handles errors gracefully** — permission-denied files should be counted as 0 bytes with a warning, not crash the tool.

### Acceptance criteria

1. `node du.js ./src` prints a size-annotated tree of `src/` and exits.
2. `node du.js` with no argument defaults to `.`.
3. All sizes are printed in the most appropriate unit (auto-scale B → KB → MB → GB).
4. `node du.js ./src --watch` re-prints the tree within 500 ms of any file change, thanks to a 300 ms debounce.
5. A file that cannot be `stat`-ed (permissions) prints a warning to stderr and is counted as 0 bytes — the rest of the tree is unaffected.
6. An empty directory shows `0 B`.

### Pure-JS starter — the recursive size-sum core

The logic that sums a nested tree is pure JS — build and test it in the sandbox, then wire it up to the real `fs` APIs:

```js run
// Simulate the in-memory tree that your real fs walk would produce.
// Each node: { name, size (0 for dirs), children: [] }

function buildSampleTree() {
  const file = (name, size) => ({ name, size, children: [] });
  const dir  = (name, ...children) => ({ name, size: 0, children });

  return dir("project",
    dir("src",
      file("index.js",   4200),
      file("utils.js",   1800),
      dir("components",
        file("Button.js",  900),
        file("Modal.js",  2100)
      )
    ),
    dir("test",
      file("index.test.js", 3300)
    ),
    file("package.json",    620),
    file("README.md",      1400)
  );
}

// Recursively compute total bytes for a node
function totalSize(node) {
  if (node.children.length === 0) return node.size; // leaf = file
  return node.children.reduce((sum, child) => sum + totalSize(child), 0);
}

// Format bytes into a human-readable string
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Print the tree with indentation and sizes
function printTree(node, indent = "") {
  const size = totalSize(node);
  const isDir = node.children.length > 0;
  const label = isDir ? `${node.name}/` : node.name;
  console.log(`${indent}${label.padEnd(30 - indent.length)} ${humanSize(size)}`);
  for (const child of node.children) {
    printTree(child, indent + "  ");
  }
}

const tree = buildSampleTree();
printTree(tree);
console.log("---");
console.log("Grand total:", humanSize(totalSize(tree)));
```

## Common pitfalls

> [!PITFALL] Forgetting backpressure when piping manually
> If you call `readable.on("data", ...)` and write to a writable inside the handler without checking the return value of `writable.write()`, you can overwhelm a slow destination (network socket, slow disk). `writable.write()` returns `false` when the internal buffer is full — you should pause the readable until the writable emits `"drain"`. The `pipeline` helper handles all of this for you automatically. Prefer `pipeline` over manual `.pipe()` or `"data"` event wiring.

## What you learned

- `readFile` loads the entire file into memory; use streams to keep memory flat at chunk size regardless of file size.
- `createReadStream` and `createWriteStream` open efficient file streams; `stream/promises pipeline` composes them safely.
- `readline.createInterface` handles line-by-line text processing and exposes an async iterator for clean `for await...of` loops.
- Running aggregations (sum, min, max, count) over chunks gives you full-file statistics with constant memory.

## Next steps

Streams are a foundational Node abstraction used in HTTP, compression, encryption, and inter-process communication. Module 10 explores the full Streams API — Readable, Writable, Transform, and Duplex — so you can build your own stream-based pipelines.
*/});
