registerLessonSrc("33-wasm", function () {/*
---
id: 33-wasm
title: "WebAssembly & WASI in Node"
minutes: 26
level: advanced
objectives:
  - Explain what WebAssembly is and why it matters for server-side Node workloads
  - Load and call a WASM module from Node using WebAssembly.instantiate
  - Understand WASM memory, imports/exports, and WASI system-access capabilities
---

# WebAssembly & WASI in Node

## Why this matters

Native addons give you raw C/C++/Rust performance, but they come with a fragile build story: one binary per platform-arch pair, a C++ toolchain in CI, and rebuild-on-upgrade risk. **WebAssembly** offers a different bargain — near-native speed in a sandboxed, portable binary that runs identically on Linux, macOS, Windows, ARM, and even the browser. Node has shipped first-class WASM support since Node 8 and added **WASI** (WebAssembly System Interface) in Node 12. Understanding both lets you choose the right escape hatch from pure JS.

## Learning objectives

- Explain **what WebAssembly is** at the binary and execution-model level.
- Load a WASM module with `WebAssembly.instantiate` and call its exported functions.
- Share memory between JS and WASM using `WebAssembly.Memory`.
- Understand **WASI** and what "system access" means for sandboxed WASM.
- Know the real-world toolchains: AssemblyScript and Rust-to-WASM.

## What is WebAssembly?

WebAssembly (WASM) is a **stack-based virtual machine bytecode** designed to be:

- **Portable** — the same `.wasm` binary runs in every WASM host (browser, Node, Deno, Wasmtime, Fastly Compute).
- **Safe** — execution is sandboxed; WASM code cannot touch memory outside its own linear memory unless you explicitly export a handle to it.
- **Fast** — WASM is compiled to native machine code by the host's JIT. Typical performance is 80–95% of equivalent native code.
- **Compact** — WASM binaries are dense bytecode, often smaller than equivalent JS bundles.

WASM modules communicate with the host (Node) through a well-defined import/export interface. They can import functions from JS and export functions back. They cannot independently access the file system, network, or timers — that boundary is the sandboxing mechanism.

```
  Node.js (host)
      |
  WebAssembly.instantiate(bytes, importObject)
      |
  WASM module instance
      |-- exports.add(a, b)        <-- host calls WASM
      |-- exports.memory           <-- shared linear memory
      |
  (WASM calls back into JS via importObject.env.log)
```

## Loading a WASM module in Node

Node exposes the `WebAssembly` global (the same Web API) plus the file system to read `.wasm` files. The core pattern:

```js
// load-wasm.mjs
import { readFileSync } from "node:fs";
import { WASM_PAGE_SIZE } from "./constants.mjs"; // hypothetical

const wasmBytes = readFileSync("./math.wasm");

// instantiate accepts a BufferSource (Buffer satisfies this)
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: {
    // Functions the WASM module may import from JS
    consoleLog: (value) => console.log("from wasm:", value),
  },
});

const { add, sumOfSquares, memory } = instance.exports;
console.log(add(3, 7));         // 10
console.log(sumOfSquares(5));   // 25+16+9+4+1 = 55 (hypothetical export)
```

> [!OUTPUT]
> 10
> 55

For a pre-compiled module you'll run repeatedly, cache the compiled form with `WebAssembly.compile` then `WebAssembly.instantiate(module, imports)` — compilation is the expensive step; instantiation is cheap.

```js
// wasm-cache.mjs
import { readFileSync } from "node:fs";

const bytes  = readFileSync("./math.wasm");
const module = await WebAssembly.compile(bytes);   // compile once

// create many independent instances cheaply:
const inst1 = await WebAssembly.instantiate(module, {});
const inst2 = await WebAssembly.instantiate(module, {});
```

> [!PRINCIPAL] Compile once, instantiate many
> Each WASM instance has its own isolated linear memory, so running the same module in a request handler or worker pool is safe. Compile the module at startup (or once globally) and cache the `WebAssembly.Module` object. Instantiation takes microseconds; compilation of a large module can take tens of milliseconds.

## WASM Memory: sharing data between JS and WASM

WASM's execution model is pure stack-based computation — functions receive and return numeric primitives (i32, i64, f32, f64). To pass arrays or strings you use **linear memory**: a raw `ArrayBuffer` shared between WASM and JS.

```js
// memory-sharing.mjs
import { readFileSync } from "node:fs";

const bytes = readFileSync("./vecmath.wasm");

// Provide 1 page (64 KiB) of shared memory
const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });

const { instance } = await WebAssembly.instantiate(bytes, {
  env: { memory }
});

// Write input array into WASM memory
const input = new Float64Array(memory.buffer, 0, 4);
input.set([1.0, 2.0, 3.0, 4.0]);

// WASM reads from offset 0, length 4, writes result at offset 32
const result = instance.exports.dotProduct(0, 4, 32);
console.log("dot product:", result);

// Read the output area
const output = new Float64Array(memory.buffer, 32, 1);
console.log("output[0]:", output[0]);
```

> [!OUTPUT]
> dot product: 30
> output[0]: 30

> [!WARNING] Memory is a flat byte array — no GC, no safety net
> WASM linear memory is a raw `ArrayBuffer`. Bugs in WASM code (or incorrect offset arithmetic in JS) write/read garbage silently. Unlike a JS bug that throws a TypeError, a bad WASM memory access just corrupts data. Always validate pointer arithmetic at the JS boundary.

## WASI: giving WASM system access

Plain WASM is pure computation. **WASI** (WebAssembly System Interface) is a *capability-based* API layer that lets WASM modules access the file system, clocks, environment variables, and standard I/O — but only the specific capabilities you hand to it. This is sandboxing with selective grants.

```js
// wasi-demo.mjs
import { WASI } from "node:wasi";
import { readFileSync } from "node:fs";

const wasi = new WASI({
  version: "preview1",
  args: process.argv,
  env: process.env,
  preopens: {
    "/sandbox": "/tmp/my-sandbox",   // grant access to this one directory only
  },
});

const wasmBytes = readFileSync("./my-cli.wasm");

const { instance } = await WebAssembly.instantiate(wasmBytes, {
  wasi_snapshot_preview1: wasi.wasiImport, // inject WASI imports
});

wasi.start(instance);   // calls the WASM module's _start / main
```

> [!OUTPUT]
> (output of the WASM CLI program, with access limited to /tmp/my-sandbox)

WASI is what makes it practical to compile programs like `grep`, `ffmpeg`, or your own Rust CLI to WASM and run them in Node with controlled access to the host file system.

## Real-world toolchains: how you produce .wasm files

### AssemblyScript (TypeScript → WASM)

AssemblyScript is a TypeScript subset that compiles directly to WASM. It's the fastest onramp if your team already knows TypeScript:

```js
// assembly/math.ts  (AssemblyScript — a TypeScript subset)
export function sumOfSquares(n: i32): f64 {
  let acc: f64 = 0;
  for (let i: i32 = 1; i <= n; i++) {
    acc += f64(i) * f64(i);
  }
  return acc;
}
```

```bash
# compile to wasm:
npx asc assembly/math.ts -o build/math.wasm --optimize
```

### Rust → WASM

Rust produces compact, performant WASM without a garbage collector. **wasm-pack** wraps the `wasm32-wasi` or `wasm32-unknown-unknown` Rust targets and generates JS glue code:

```bash
# in a Rust project:
cargo add wasm-bindgen
wasm-pack build --target nodejs
# produces pkg/my_lib.js + pkg/my_lib_bg.wasm
```

Use cases driving Rust+WASM adoption:

- **Image processing** (image-rs compiled to WASM powers several CDN edge workers)
- **Cryptographic primitives** (RustCrypto's constant-time algorithms)
- **Audio/video codecs** (Ogg, Opus, AV1 decoders)
- **PDF rendering** (PDFium wrappers)

> [!NOTE] C/C++ → WASM via Emscripten
> **Emscripten** transpiles C/C++ to WASM (and earlier, asm.js). It's more established than Rust/wasm-pack and used by projects like SQLite's official WASM build. The workflow is `emcc mycode.c -o mycode.wasm` with flags to control WASI vs. browser targets.

## Try it yourself

You can't run real WASM bytecode in this browser sandbox, but you *can* build and run a **stack-machine interpreter** — which is exactly how WASM executes internally. Here is a toy bytecode interpreter supporting four opcodes (`PUSH`, `ADD`, `MUL`, `PRINT`):

```js run
// A tiny WASM-like stack-machine interpreter.
// Opcodes match how real WASM works: a stack is the only state.
// Instructions push values or pop operands and push results.

const OP = { PUSH: 0, ADD: 1, MUL: 2, PRINT: 3 };

function execute(bytecode) {
  const stack = [];
  let ip = 0; // instruction pointer

  while (ip < bytecode.length) {
    const op = bytecode[ip++];

    if (op === OP.PUSH) {
      stack.push(bytecode[ip++]); // next byte is the operand
    } else if (op === OP.ADD) {
      const b = stack.pop();
      const a = stack.pop();
      stack.push(a + b);
    } else if (op === OP.MUL) {
      const b = stack.pop();
      const a = stack.pop();
      stack.push(a * b);
    } else if (op === OP.PRINT) {
      console.log("result:", stack.pop());
    } else {
      throw new Error("Unknown opcode: " + op);
    }
  }
}

// Program 1: (3 + 4) * 5
execute([
  OP.PUSH, 3,
  OP.PUSH, 4,
  OP.ADD,
  OP.PUSH, 5,
  OP.MUL,
  OP.PRINT,       // result: 35
]);

// Program 2: (10 * 10) + (6 * 7)
execute([
  OP.PUSH, 10,
  OP.PUSH, 10,
  OP.MUL,         // 100
  OP.PUSH, 6,
  OP.PUSH, 7,
  OP.MUL,         // 42
  OP.ADD,         // 142
  OP.PRINT,       // result: 142
]);

// Program 3: sum of squares 1^2 + 2^2 + 3^2 (unrolled)
execute([
  OP.PUSH, 1, OP.PUSH, 1, OP.MUL,  // 1
  OP.PUSH, 2, OP.PUSH, 2, OP.MUL,  // 4
  OP.ADD,                            // 5
  OP.PUSH, 3, OP.PUSH, 3, OP.MUL,  // 9
  OP.ADD,                            // 14
  OP.PRINT,                          // result: 14
]);
```

## Exercises

**Exercise 1.** Add a `SUB` opcode to the stack machine above. Then write a program that computes `(10 - 3) * (8 - 5)`.

<details>
<summary>Show solution</summary>

```js run
const OP = { PUSH: 0, ADD: 1, MUL: 2, PRINT: 3, SUB: 4 };

function execute(bytecode) {
  const stack = [];
  let ip = 0;
  while (ip < bytecode.length) {
    const op = bytecode[ip++];
    if (op === OP.PUSH)  { stack.push(bytecode[ip++]); }
    else if (op === OP.ADD)   { const b = stack.pop(); const a = stack.pop(); stack.push(a + b); }
    else if (op === OP.SUB)   { const b = stack.pop(); const a = stack.pop(); stack.push(a - b); }
    else if (op === OP.MUL)   { const b = stack.pop(); const a = stack.pop(); stack.push(a * b); }
    else if (op === OP.PRINT) { console.log("result:", stack.pop()); }
    else { throw new Error("Unknown opcode: " + op); }
  }
}

// (10 - 3) * (8 - 5) = 7 * 3 = 21
execute([
  OP.PUSH, 10,
  OP.PUSH, 3,
  OP.SUB,       // 7
  OP.PUSH, 8,
  OP.PUSH, 5,
  OP.SUB,       // 3
  OP.MUL,       // 21
  OP.PRINT,
]);
```

</details>

**Exercise 2.** Extend the interpreter to support a `DUP` opcode that duplicates the top of the stack (like WASM's `local.tee`). Use it to compute `x * x` from a single `PUSH x`.

<details>
<summary>Show solution</summary>

```js run
const OP = { PUSH: 0, ADD: 1, MUL: 2, PRINT: 3, DUP: 5 };

function execute(bytecode) {
  const stack = [];
  let ip = 0;
  while (ip < bytecode.length) {
    const op = bytecode[ip++];
    if (op === OP.PUSH)  { stack.push(bytecode[ip++]); }
    else if (op === OP.ADD)   { const b = stack.pop(); const a = stack.pop(); stack.push(a + b); }
    else if (op === OP.MUL)   { const b = stack.pop(); const a = stack.pop(); stack.push(a * b); }
    else if (op === OP.DUP)   { stack.push(stack[stack.length - 1]); }
    else if (op === OP.PRINT) { console.log("result:", stack.pop()); }
    else { throw new Error("Unknown opcode: " + op); }
  }
}

// 7 * 7 using DUP:
execute([
  OP.PUSH, 7,
  OP.DUP,   // stack: [7, 7]
  OP.MUL,   // 49
  OP.PRINT,
]);

// sum of squares 1..4 using DUP:
// 1^2 + 2^2 + 3^2 + 4^2 = 30
execute([
  OP.PUSH, 1, OP.DUP, OP.MUL,  // 1
  OP.PUSH, 2, OP.DUP, OP.MUL,  // 4
  OP.ADD,
  OP.PUSH, 3, OP.DUP, OP.MUL,  // 9
  OP.ADD,
  OP.PUSH, 4, OP.DUP, OP.MUL,  // 16
  OP.ADD,
  OP.PRINT,  // result: 30
]);
```

</details>

## Common pitfalls

> [!PITFALL] Passing strings or objects across the WASM boundary naively
> WASM functions only understand numeric types (i32, i64, f32, f64). Passing a JS string to a WASM function without serialising it into linear memory first is a silent bug — the function receives a meaningless numeric handle or zero. Always write string data into the shared `ArrayBuffer` as UTF-8 bytes and pass a (pointer, length) pair instead.

> [!PITFALL] Forgetting that WASM memory can grow
> `WebAssembly.Memory.grow(pages)` is valid WASM, and after it runs the old `ArrayBuffer` reference in JS is **detached** — reads on it throw. Always re-read `memory.buffer` after any operation that might grow the memory.

## What you learned

- **WebAssembly** is a portable, sandboxed stack-machine bytecode that runs at near-native speed inside Node's V8.
- Use `WebAssembly.instantiate(bytes, importObject)` to load a module and access its `exports`.
- Data interchange between JS and WASM goes through **linear memory** — a shared `ArrayBuffer` with explicit pointer arithmetic.
- **WASI** adds capability-based system access (files, clocks, stdio) to an otherwise sandboxed WASM module.
- **AssemblyScript** (TypeScript subset) and **Rust + wasm-pack** are the two most common toolchains for producing `.wasm` files targeting Node.
- A WASM stack machine processes `PUSH`/`ADD`/`MUL`/etc. instructions sequentially — the same mental model applies to reading real WASM text format (`.wat`).

## Next steps

You now know both native addons (N-API) and WebAssembly. The next lesson builds a **decision framework** for choosing between pure JS, Worker threads, WASM, and N-API — and ends with a project that benchmarks them head-to-head.
*/});
