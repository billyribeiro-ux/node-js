registerLessonSrc("08-buffers-basics", function () {/*
---
id: 08-buffers-basics
title: "Buffers, TypedArrays & ArrayBuffers"
minutes: 24
level: intermediate
objectives:
  - Understand what a byte is and why raw binary data matters in Node
  - Distinguish Buffer, Uint8Array, TypedArray, and ArrayBuffer and know when to use each
  - Read and write integers from binary data using DataView and Buffer methods
  - Slice and create views that share the same underlying memory
---

# Buffers, TypedArrays & ArrayBuffers

## Why this matters

When you read a file, receive a network packet, or talk to a USB device, you get *raw bytes* — not a JavaScript string. Understanding how Node (and the browser) represent binary data lets you parse image headers, implement binary protocols, compress payloads, and avoid the subtle bugs that come from confusing text encoding with raw bytes. This is the foundation that streams, crypto, and network code are all built on.

## Learning objectives

- Define a **byte** and explain how it maps to numbers in JavaScript.
- Explain the relationship between **ArrayBuffer**, **TypedArray**, and **DataView**.
- Use **Buffer** (Node-specific subclass of `Uint8Array`) to allocate and inspect bytes.
- Read and write integers of different sizes and endianness.
- Understand how slices and typed-array views *share* underlying memory.

## What even is a byte?

A **bit** is a single 0 or 1. A **byte** is 8 bits, so it can represent 256 distinct values (0–255). Everything stored on disk or sent over a network is ultimately a sequence of bytes.

JavaScript's number type (`double`) can represent integers up to 2^53 exactly, so a single byte value fits comfortably in an ordinary `number`. But storing millions of bytes in an array of JS numbers is expensive (each `number` is 8 bytes internally). That's why the platform provides *typed binary buffers* — compact, fixed-size storage with the memory layout of C arrays.

## The three layers: ArrayBuffer, TypedArray, and DataView

The web platform (and Node, which adopted it) has a three-layer model:

```
┌─────────────────────────────────────────────────────┐
│  ArrayBuffer  — the raw memory, just bytes, no type │
└────────────────────────┬────────────────────────────┘
                         │ viewed through
          ┌──────────────┴──────────────┐
          │  TypedArray                 │  DataView
          │  (Uint8Array, Int16Array…)  │  (read/write any type at any offset)
          └─────────────────────────────┘
```

**ArrayBuffer** is a fixed-size block of memory. You cannot read or write it directly — it has no indexing and no methods. It is purely a memory owner.

**TypedArrays** are views over an ArrayBuffer that impose a type on every element. `Uint8Array` treats each byte as an unsigned 8-bit integer. `Int16Array` treats every two bytes as a signed 16-bit integer. `Float64Array` treats every eight bytes as a 64-bit float. All TypedArray views share the same interface: index with `[]`, iterate with `for...of`, and use `.length` for the element count.

**DataView** lets you read or write *any* type at *any* byte offset, and lets you choose byte order (endianness). This is the right tool when you're parsing a structured binary format where different fields have different types and alignments.

The full family of TypedArrays in JavaScript:

| TypedArray | Element size | Range |
|---|---|---|
| `Uint8Array` | 1 byte | 0–255 |
| `Int8Array` | 1 byte | −128–127 |
| `Uint16Array` | 2 bytes | 0–65535 |
| `Int16Array` | 2 bytes | −32768–32767 |
| `Uint32Array` | 4 bytes | 0–4294967295 |
| `Int32Array` | 4 bytes | −2147483648–2147483647 |
| `Float32Array` | 4 bytes | ~±3.4×10^38 |
| `Float64Array` | 8 bytes | ~±1.8×10^308 |
| `BigUint64Array` | 8 bytes | 0–2^64−1 |

## Node's Buffer: a Uint8Array with extras

Node's `Buffer` class is a **subclass of `Uint8Array`** that adds convenience methods for hex/base64 conversion, reading/writing multi-byte integers, and interop with Node APIs like `fs` and `net`. You'll see `Buffer` throughout the Node ecosystem, but because it is a `Uint8Array`, all TypedArray operations work on it too.

```js
// Creating Buffers — three main ways:
import { Buffer } from "node:buffer";

// 1. From existing data
const fromString = Buffer.from("hello", "utf8");        // encode a string
const fromArray  = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // from bytes
const fromHex    = Buffer.from("48656c6c6f", "hex");    // from hex string

// 2. Allocate zeroed-out memory
const zeroed = Buffer.alloc(16);    // 16 bytes, all 0x00

// 3. Allocate WITHOUT zeroing (faster, but may contain old memory!)
const fast = Buffer.allocUnsafe(16); // contents are undefined — MUST write before read
```

> [!PITFALL] allocUnsafe leaks old memory
> `Buffer.allocUnsafe` skips the zero-fill step for speed. The bytes it contains are whatever happened to be in that memory region before. Always write to every byte before reading, or use `Buffer.alloc` when you need guaranteed zeros.

### Reading and writing integers

```js
import { Buffer } from "node:buffer";

const buf = Buffer.alloc(8);

buf.writeUInt8(42, 0);          // write 42 at offset 0 (1 byte)
buf.writeUInt16BE(1000, 1);     // write 1000 in big-endian at offset 1 (2 bytes)
buf.writeUInt32LE(0xdeadbeef, 3); // write in little-endian at offset 3 (4 bytes)
buf.writeUInt8(255, 7);         // last byte

console.log(buf.readUInt8(0));      // 42
console.log(buf.readUInt16BE(1));   // 1000
console.log(buf.readUInt32LE(3).toString(16)); // deadbeef
```

> [!OUTPUT]
> 42
> 1000
> deadbeef

**Big-endian (BE)** stores the most significant byte first — the way humans write numbers. **Little-endian (LE)** stores the least significant byte first — the native byte order on most modern CPUs (x86, ARM). Network protocols traditionally use big-endian, which is why it is also called *network byte order*. File formats vary: PNG uses big-endian; WAV uses little-endian.

## Slices and shared memory

This is where beginners often get surprised. When you call `.subarray()` on a TypedArray or `.slice()` on a Buffer, the two operations behave differently:

```js
import { Buffer } from "node:buffer";

const original = Buffer.from([1, 2, 3, 4, 5]);

// subarray / subarray shares memory — a VIEW into the same bytes
const view = original.subarray(1, 4);  // bytes at index 1,2,3
view[0] = 99;
console.log(original[1]); // 99 — same memory!

// Buffer.slice (deprecated alias for subarray) also shares memory
// Buffer.copy and Buffer.from(slice) do NOT share — they copy
const copy = Buffer.from(original.subarray(1, 4));
copy[0] = 0;
console.log(original[1]); // still 99 — copy is independent
```

> [!OUTPUT]
> 99
> 99

> [!PRINCIPAL] Views vs copies — intentional sharing is a superpower
> Sharing memory between views is the foundation of zero-copy I/O. When Node reads a chunk off the network and hands you a `Buffer`, it may be a view into a larger internal pool buffer. Avoid unnecessary copies: pass views around rather than copying bytes unless you genuinely need an independent snapshot. The trade-off is aliasing bugs — a mutation you didn't expect to be visible suddenly is. Document shared views explicitly.

## Try it yourself

This runnable block uses `Uint8Array` and `DataView` — pure browser/worker APIs, no Node required. It builds a small binary "message": a 1-byte version field, a 2-byte (big-endian) payload length, and 4 bytes of payload. Then it reads it back.

```js run
// Build a tiny binary packet and parse it back.
// Layout: [version: u8][length: u16be][payload: 4 bytes]
const buf = new ArrayBuffer(7);
const view = new DataView(buf);
const bytes = new Uint8Array(buf);

// Write
view.setUint8(0, 1);           // version = 1
view.setUint16(1, 4, false);   // length = 4, big-endian (false = big-endian)
bytes[3] = 0xDE;
bytes[4] = 0xAD;
bytes[5] = 0xBE;
bytes[6] = 0xEF;

// Read back
const version = view.getUint8(0);
const length  = view.getUint16(1, false);
const payload = Array.from(bytes.subarray(3))
  .map(b => b.toString(16).padStart(2, "0"))
  .join(" ");

console.log("version:", version);
console.log("payload length:", length);
console.log("payload bytes:", payload);

// Demonstrate shared memory: mutate via bytes, read via DataView
bytes[0] = 2;
console.log("version after mutation:", view.getUint8(0)); // 2, same memory!
```

## Exercises

### Exercise 1: Pack and unpack a color

A common pattern in graphics is packing an RGBA color into a single 32-bit integer. Pack `r=255, g=128, b=64, a=200` into four bytes, then unpack them back.

<details>
<summary>Show solution</summary>

```js run
const buf = new ArrayBuffer(4);
const view = new DataView(buf);
const bytes = new Uint8Array(buf);

const r = 255, g = 128, b = 64, a = 200;

// Pack: store each channel in one byte
bytes[0] = r;
bytes[1] = g;
bytes[2] = b;
bytes[3] = a;

// Read as a single big-endian 32-bit unsigned int
const packed = view.getUint32(0, false);
console.log("packed (hex):", packed.toString(16).padStart(8, "0")); // ff8040c8

// Unpack
const ur = (packed >>> 24) & 0xff;
const ug = (packed >>> 16) & 0xff;
const ub = (packed >>>  8) & 0xff;
const ua =  packed         & 0xff;
console.log(`r=${ur} g=${ug} b=${ub} a=${ua}`);
```

</details>

### Exercise 2: View the same memory as different types

Create an `ArrayBuffer` of 8 bytes. Write the 64-bit float `1.5` using a `Float64Array`. Then read the same bytes as a `Uint8Array` and print each byte in hex. This reveals how floating-point numbers are stored in memory.

<details>
<summary>Show solution</summary>

```js run
const ab = new ArrayBuffer(8);
const floats = new Float64Array(ab);
const bytes  = new Uint8Array(ab);

floats[0] = 1.5;   // IEEE-754 double for 1.5

const hex = Array.from(bytes)
  .map(b => b.toString(16).padStart(2, "0"))
  .join(" ");

console.log("1.5 as 8 bytes (little-endian on most CPUs):", hex);
// On x86/ARM: 00 00 00 00 00 00 f8 3f
// The mantissa bits of 1.5 in IEEE-754 format
```

</details>

## Common pitfalls

> [!PITFALL] Buffer is Uint8Array but Uint8Array is not Buffer
> `Buffer.isBuffer(new Uint8Array(4))` returns `false`. When writing library code that must accept either, check `buf instanceof Uint8Array` instead. Most modern Node APIs accept any `Uint8Array`-compatible object.

Confusing `.length` (element count) and `.byteLength`: for a `Uint8Array` they are the same, but for `Float64Array([1,2,3])` `.length` is 3 and `.byteLength` is 24. Always use `.byteLength` when you care about the number of raw bytes.

Off-by-one writes are another trap. Writing `writeUInt16BE(value, offset)` at the very last byte of a buffer throws `ERR_OUT_OF_RANGE` — the write needs two bytes starting at `offset`. Track your cursor carefully.

## What you learned

- A **byte** holds 0–255 and is the atom of binary storage. Typed arrays give JS efficient, fixed-layout byte storage.
- **ArrayBuffer** owns memory; **TypedArray** and **DataView** are views over it.
- Node's **Buffer** is a `Uint8Array` subclass with extra convenience methods.
- Use `Buffer.alloc` for zeroed memory, `Buffer.allocUnsafe` only when you'll write every byte immediately.
- **Big-endian** (network byte order) vs **little-endian** (CPU byte order) matters when exchanging binary data.
- `.subarray()` returns a *shared* view; `Buffer.from(view)` makes an *independent* copy.

## Next steps

Now that you can manipulate raw bytes, the next lesson covers how text and bytes relate — character encodings like UTF-8, hex, and base64, plus the web-standard `TextEncoder`/`TextDecoder` API.
*/});
