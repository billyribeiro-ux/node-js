registerLessonSrc("07-reading-writing", function () {/*
---
id: 07-reading-writing
title: "Reading & Writing Files (sync, callback, promises)"
minutes: 22
level: beginner
objectives:
  - Use all three flavours of the fs module — sync, callback, and promises
  - Read, write, and append files with correct encodings and flags
  - Decide when synchronous I/O is acceptable and when it is not
---

# Reading & Writing Files (sync, callback, promises)

## Why this matters

Almost every real Node program touches the filesystem: config files, log files, uploads, build artifacts, data pipelines. Node exposes three distinct APIs for the same underlying syscalls, and picking the wrong one can freeze a server or make a script unnecessarily complex. This lesson gives you a precise mental model of each flavour and the judgment to choose the right one.

## Learning objectives

- Use `readFile`, `writeFile`, and `appendFile` in sync, callback, and promise forms.
- Understand character encodings and open flags.
- Know when synchronous I/O is safe and when it is dangerous.

## The three flavours of `node:fs`

Node bundles *three different API surfaces* for filesystem operations in one built-in package. They all do the same work at the OS level — the difference is how they hand results back to your code.

```js
// Sync — blocks until done, returns the value directly
import { readFileSync, writeFileSync } from "node:fs";

// Callback — starts I/O, calls the function when done
import { readFile, writeFile } from "node:fs";

// Promises — like callback but returns a Promise
import { readFile, writeFile } from "node:fs/promises";
```

> [!NOTE] `node:fs/promises` is a separate import path
> `node:fs` has a `.promises` property too (`fs.promises.readFile`), but the cleaner approach is to import from `"node:fs/promises"` directly — that way you get named tree-shakeable imports.

### 1 — Synchronous

```js
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const contents = readFileSync("config.json", "utf8"); // returns string
const raw      = readFileSync("image.png");           // returns Buffer (no encoding)

writeFileSync("output.txt", "Hello, world!\n", "utf8");   // creates or overwrites
appendFileSync("log.txt",   "2026-06-06 boot\n", "utf8"); // append to existing
```

> [!OUTPUT]
> (no output — the functions return/throw synchronously)

### 2 — Callback

```js
import { readFile, writeFile, appendFile } from "node:fs";

readFile("config.json", "utf8", (err, data) => {
  if (err) { console.error(err); return; }
  console.log(data);
});

writeFile("output.txt", "Hello!\n", "utf8", (err) => {
  if (err) console.error("write failed:", err);
});
```

> [!OUTPUT]
> (contents of config.json printed, or an error message)

### 3 — Promises (`node:fs/promises`)

```js
import { readFile, writeFile, appendFile } from "node:fs/promises";

const data = await readFile("config.json", "utf8");
console.log(data);

await writeFile("output.txt", "Hello!\n", "utf8");
await appendFile("log.txt", new Date().toISOString() + "\n");
```

> [!OUTPUT]
> (contents of config.json)

This is the recommended style for modern Node — `async/await` on top of promises keeps your code flat and readable.

## Encodings and flags

### Encodings

When you pass an encoding string (`"utf8"`, `"ascii"`, `"base64"`, `"hex"`, `"latin1"`), Node decodes the bytes and returns a `string`. Omit the encoding and you get a raw `Buffer` — useful for images, binary formats, or when you need to inspect bytes directly.

```js
import { readFile } from "node:fs/promises";

const text = await readFile("hello.txt", "utf8");   // string  ✔
const buf  = await readFile("hello.txt");            // Buffer  — manual decode
console.log(buf.toString("utf8"));                   // same result
```

### Flags

The `flag` option controls *how* the file is opened. The defaults are sensible but worth knowing:

| flag | meaning |
|------|---------|
| `"r"` | read (default for `readFile`) |
| `"w"` | write, create or truncate (default for `writeFile`) |
| `"a"` | append, create if missing (default for `appendFile`) |
| `"wx"` | write, but **fail** if file already exists |
| `"r+"` | read and write, file must exist |

```js
import { writeFile } from "node:fs/promises";

// Fail if the file already exists — safer for "create-once" logic
await writeFile("unique-report.json", JSON.stringify(data), { flag: "wx" });
```

> [!PITFALL] `appendFile` is not atomic across processes
> Two processes appending to the same log file can interleave partial writes. For high-throughput concurrent logging, use a dedicated logger library that serialises writes through a single writable stream, or use `O_APPEND` at the OS level via a stream.

## When sync is OK — and when it is not

Synchronous calls **block the event loop** — no other JavaScript runs while the disk is busy. In a long-running server that is almost always wrong: a slow disk read can delay every request.

```
┌─────────────────────────────────────────────────────────┐
│  SERVER (DON'T use sync)         SCRIPT (sync is fine)  │
│  readFileSync blocks all clients  blocks only this PID  │
│  → latency spike for everyone    → fine, you're done    │
└─────────────────────────────────────────────────────────┘
```

**Safe places for sync I/O:**
- Startup / bootstrap code that runs once before accepting requests (reading a config file, loading a private key).
- One-shot CLI scripts and build tools where you own the process start-to-finish.
- Tests that isolate filesystem setup.

**Prefer async/promises everywhere else** — especially in HTTP handlers, background workers, or anything that serves concurrent users.

> [!PRINCIPAL] Startup sync is a deliberate tradeoff
> Many production servers use `readFileSync` for their initial config load. The argument is sound: the server isn't yet handling traffic, the config is small, and synchronous code is simpler and harder to mis-sequence. Once the server is up and listening, switch entirely to async I/O. This is not laziness — it is a conscious architectural decision that trades a few milliseconds at startup for reduced complexity at the most critical code path.

## Try it yourself

The browser sandbox can't access the real filesystem, but the *shape* of the API is what matters. Below is a pure-JS in-memory "file system" that mirrors `readFile / writeFile / appendFile`. Run it and explore:

```js run
// In-memory filesystem — mirrors the node:fs/promises API shape
function createMemFs() {
  const store = new Map();

  async function writeFile(path, data, options = {}) {
    const flag = (options && options.flag) || "w";
    if (flag === "wx" && store.has(path)) {
      throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), { code: "EEXIST" });
    }
    store.set(path, String(data));
  }

  async function appendFile(path, data) {
    const existing = store.get(path) || "";
    store.set(path, existing + String(data));
  }

  async function readFile(path, encoding) {
    if (!store.has(path)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
    }
    return store.get(path); // always a string in this demo
  }

  return { writeFile, appendFile, readFile };
}

// --- Demo ---
const fs = createMemFs();

(async () => {
  await fs.writeFile("hello.txt", "Hello, Node!\n");
  await fs.appendFile("hello.txt", "Second line.\n");
  await fs.appendFile("hello.txt", "Third line.\n");

  const content = await fs.readFile("hello.txt", "utf8");
  console.log("=== hello.txt ===");
  console.log(content);

  // Flags: wx should fail if file exists
  try {
    await fs.writeFile("hello.txt", "oops", { flag: "wx" });
  } catch (e) {
    console.log("Caught expected error:", e.code, e.message);
  }

  // Read a missing file
  try {
    await fs.readFile("missing.txt", "utf8");
  } catch (e) {
    console.log("Caught expected error:", e.code);
  }
})();
```

## Exercise

**Challenge:** Extend the in-memory fs above to support a `copyFile(src, dest)` method that reads `src` and writes to `dest`. If `src` doesn't exist, it should throw. Test it with a file you created.

<details>
<summary>Show solution</summary>

```js run
function createMemFs() {
  const store = new Map();

  async function writeFile(path, data) {
    store.set(path, String(data));
  }

  async function readFile(path) {
    if (!store.has(path)) {
      throw Object.assign(new Error(`ENOENT: '${path}'`), { code: "ENOENT" });
    }
    return store.get(path);
  }

  async function copyFile(src, dest) {
    const data = await readFile(src); // throws ENOENT if missing
    await writeFile(dest, data);
  }

  return { writeFile, readFile, copyFile };
}

const fs = createMemFs();

(async () => {
  await fs.writeFile("original.txt", "Important data\n");
  await fs.copyFile("original.txt", "backup.txt");

  console.log(await fs.readFile("backup.txt")); // Important data

  try {
    await fs.copyFile("ghost.txt", "nowhere.txt");
  } catch (e) {
    console.log("Copy failed as expected:", e.code);
  }
})();
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to `await` a promise-based call
> `writeFile(...)` returns a Promise. If you don't `await` it (or chain `.then`), the write may not have completed before the next line reads the file — or before your process exits. This is one of the most common "my file is empty" bugs.

Also watch out for: mixing callback-style `fs` imports with `fs/promises` imports in the same file — they look the same but behave differently. Use a linter rule or pick one style per file.

## What you learned

- `node:fs` offers three API surfaces: **sync** (blocking), **callback** (event-loop-friendly, older style), and **promises** (`node:fs/promises`, the modern choice).
- `readFile` / `writeFile` / `appendFile` handle the common cases; the `flag` option controls open behaviour.
- Pass an **encoding** string to get a `string` back; omit it to get a raw `Buffer`.
- **Sync I/O is safe only at startup** or in single-purpose scripts — never inside request handlers.

## Next steps

Now that you can read and write individual files, it's time to navigate the filesystem itself: working with paths, creating directories, listing their contents, and using the new `fs.glob`.
*/});
