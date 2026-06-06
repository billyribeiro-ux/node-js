registerLessonSrc("08-encodings", function () {/*
---
id: 08-encodings
title: "Encodings: utf8, hex, base64 & TextEncoder"
minutes: 22
level: intermediate
objectives:
  - Explain the difference between a character and a byte, and why the distinction matters
  - Understand how UTF-8 encodes multi-byte characters including emoji
  - Convert bytes to and from hex, base64, and base64url representations
  - Use TextEncoder and TextDecoder to transcode between strings and Uint8Arrays
---

# Encodings: utf8, hex, base64 & TextEncoder

## Why this matters

A string in your program is not the same as bytes on disk or in a network packet. Every time data crosses a boundary — written to a file, sent over HTTP, stored in a database — it goes through an encoding step. Getting that encoding wrong produces garbled text, incorrect byte counts, broken authentication tokens, and subtle security bugs. Understanding the encoding layer is non-negotiable for any backend engineer.

## Learning objectives

- Explain the difference between a **character** (abstract) and a **byte** (concrete storage).
- Describe how **UTF-8** encodes ASCII and multi-byte characters.
- Encode and decode **hex** and **base64** in both Node and the browser.
- Use `TextEncoder` / `TextDecoder` — the web-standard API also available in Node — to convert strings to `Uint8Array` and back.

## Characters vs bytes

A **character** is a human-readable symbol: the letter `A`, the emoji 🔥, the Chinese character 中. A **byte** is an 8-bit number (0–255) stored in memory. The question *how do we represent this character as bytes?* is what an **encoding** answers.

There are hundreds of encodings. In Node.js (and on the web), you'll mostly encounter three families:

| Encoding | Description |
|---|---|
| `utf8` (default) | Unicode; 1–4 bytes per character |
| `latin1` / `binary` | 1 byte per character, code points 0–255 |
| `ascii` | 1 byte, only 7-bit values (0–127) |
| `hex` | Each byte represented as 2 hex digits |
| `base64` | 3 bytes → 4 ASCII printable characters |
| `base64url` | Like base64 but URL-safe (`+`→`-`, `/`→`_`) |

## UTF-8: the universal encoding

**UTF-8** is a *variable-width* encoding for the Unicode standard. Unicode assigns a **code point** (a number) to every character ever defined — over 140,000 of them. UTF-8 then encodes those numbers as 1–4 bytes:

- Code points 0–127 (ASCII characters: letters, digits, basic punctuation) use **1 byte**. The byte value equals the code point.
- Code points 128–2047 use **2 bytes**.
- Code points 2048–65535 (most common non-ASCII scripts, common CJK characters) use **3 bytes**.
- Code points 65536–1114111 (emoji, rare scripts) use **4 bytes**.

This has a critical consequence for backend code: `string.length` in JavaScript counts **UTF-16 code units**, not bytes. An emoji like 🔥 has `.length === 2` (two UTF-16 code units called a surrogate pair) but occupies **4 bytes** in UTF-8. Always use `Buffer.byteLength` or `TextEncoder` when you need the byte count.

```js
import { Buffer } from "node:buffer";

const ascii = "Hello";
const emoji = "🔥";
const cjk   = "中文";

console.log(ascii.length, Buffer.byteLength(ascii, "utf8")); // 5  5
console.log(emoji.length, Buffer.byteLength(emoji, "utf8")); // 2  4
console.log(cjk.length,   Buffer.byteLength(cjk,   "utf8")); // 2  6
```

> [!OUTPUT]
> 5 5
> 2 4
> 2 6

> [!PITFALL] Truncating UTF-8 at an arbitrary byte offset
> If you split a UTF-8 string at a fixed byte count (e.g. for a database column limit), you may cut in the middle of a multi-byte character sequence, producing an invalid byte sequence. Always decode first, truncate by character, then re-encode — or use a library that is aware of the encoding.

## Hex encoding

**Hex** (hexadecimal) represents each byte as exactly two characters: `0`–`9` and `a`–`f`. It is not a compression format — hex output is exactly twice as long as the raw bytes. Its value is *human readability and ASCII-safety*: hex digits are printable and unambiguous, which is why debug output, hash values, and crypto keys are often displayed in hex.

```js
import { Buffer } from "node:buffer";

const buf = Buffer.from("Node");

const hexStr = buf.toString("hex");          // "4e6f6465"
const back   = Buffer.from(hexStr, "hex");   // back to bytes
console.log(hexStr);                          // 4e6f6465
console.log(back.toString("utf8"));           // Node

// Individual byte in hex:
console.log(buf[0].toString(16).padStart(2, "0")); // 4e  (ASCII 'N')
```

> [!OUTPUT]
> 4e6f6465
> Node
> 4e

## Base64 encoding

**Base64** encodes arbitrary bytes as a sequence of 64 printable ASCII characters (`A`–`Z`, `a`–`z`, `0`–`9`, `+`, `/`, with `=` padding). The math: every 3 input bytes produce 4 output characters, so base64 expands size by about 33%.

Base64 is used everywhere binary data must travel through text channels: HTTP Basic Auth headers, JSON payloads carrying image data, email attachments (MIME), and JWTs.

**Base64url** is a URL-safe variant that replaces `+` with `-` and `/` with `_` and omits the `=` padding. Use it when the base64 string will appear in a URL, filename, or cookie value.

```js
import { Buffer } from "node:buffer";

const data = Buffer.from("binary data: \x01\x02\x03");

const b64    = data.toString("base64");        // standard base64
const b64url = data.toString("base64url");     // URL-safe variant

console.log(b64);    // YmluYXJ5IGRhdGE6IAECAR==
console.log(b64url); // YmluYXJ5IGRhdGE6IAECAR  (no padding, safe chars)

// Decoding
const decoded = Buffer.from(b64, "base64");
console.log(decoded.toString("utf8"));  // binary data: ...
```

> [!OUTPUT]
> YmluYXJ5IGRhdGE6IAECAR==
> YmluYXJ5IGRhdGE6IAECAR
> binary data: ...

> [!NOTE] Base64 is encoding, not encryption
> Base64 is trivially reversible. Never use it to "hide" sensitive data — use proper encryption. It is only a transport encoding.

## TextEncoder and TextDecoder

`TextEncoder` and `TextDecoder` are **web-standard APIs** (part of the WHATWG Encoding specification) that live in browsers, Deno, Bun, and Node.js (available globally since Node 18, or via `node:util`). They provide a clean, promise-free interface to convert between strings and `Uint8Array`.

`TextEncoder` always produces UTF-8. `TextDecoder` can decode many encodings (UTF-8, latin-1, UTF-16, etc.) but UTF-8 is the default.

```js
// Available globally in Node 18+ (no import needed):
const enc = new TextEncoder();
const dec = new TextDecoder();          // defaults to "utf-8"

// String → Uint8Array
const bytes = enc.encode("Hello 🌍");
console.log(bytes.byteLength);          // 10  (6 ASCII + 4 for the emoji)
console.log(bytes);
// Uint8Array(10) [ 72, 101, 108, 108, 111, 32, 240, 159, 140, 141 ]

// Uint8Array → string
const str = dec.decode(bytes);
console.log(str);                        // Hello 🌍
```

> [!OUTPUT]
> 10
> Uint8Array(10) [ 72, 101, 108, 108, 111, 32, 240, 159, 140, 141 ]
> Hello 🌍

`TextDecoder` also has a **streaming mode** via `decode(chunk, { stream: true })`, which is essential when you receive a UTF-8 byte stream in chunks: a multi-byte character might be split across two chunks, and the streaming mode buffers incomplete sequences between calls.

```js
const dec = new TextDecoder();
// The UTF-8 bytes for "🌍" are [0xF0, 0x9F, 0x8C, 0x8D]
// Simulate receiving them split across two network chunks:
const chunk1 = new Uint8Array([0xF0, 0x9F]);
const chunk2 = new Uint8Array([0x8C, 0x8D]);

const partial = dec.decode(chunk1, { stream: true });
const rest    = dec.decode(chunk2);               // final call flushes
console.log(JSON.stringify(partial));  // ""  (incomplete — waiting for more bytes)
console.log(JSON.stringify(rest));     // "🌍"
```

> [!OUTPUT]
> ""
> "🌍"

> [!PRINCIPAL] Prefer TextEncoder/TextDecoder for cross-runtime code
> `TextEncoder` and `TextDecoder` are the web standard. Code that uses them runs in browsers, Deno, Bun, Cloudflare Workers, and Node without any imports or polyfills. Code that uses `Buffer.from(str, "utf8")` is Node-only. For library code that might run in multiple runtimes, reach for `TextEncoder`/`TextDecoder` first. The only capability you lose is other encodings — `TextEncoder` only ever produces UTF-8.

## Node's Buffer.toString — all encodings in one place

When you already have a `Buffer`, you can convert to any supported encoding directly:

```js
import { Buffer } from "node:buffer";

const buf = Buffer.from([78, 111, 100, 101, 32, 49, 56]);
console.log(buf.toString("utf8"));      // Node 18
console.log(buf.toString("hex"));       // 4e6f64652031 38  (no spaces in real output)
console.log(buf.toString("base64"));    // Tm9kZSAxOA==
console.log(buf.toString("ascii"));     // Node 18
```

> [!OUTPUT]
> Node 18
> 4e6f646520313838
> Tm9kZSAxOA==
> Node 18

## Try it yourself

This runnable block uses `TextEncoder` and `TextDecoder` — both available in the Web Worker sandbox. Observe how byte counts differ between ASCII, accented characters, and emoji.

```js run
const enc = new TextEncoder();
const dec = new TextDecoder();

const samples = [
  "A",           // 1 byte  — basic ASCII
  "é",           // 2 bytes — Latin with accent (U+00E9)
  "中",          // 3 bytes — CJK ideograph (U+4E2D)
  "🔥",          // 4 bytes — emoji (U+1F525, surrogate pair in JS string)
  "Hello, 世界!", // mixed
];

for (const s of samples) {
  const bytes = enc.encode(s);
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(`"${s}"  js.length=${s.length}  utf8-bytes=${bytes.byteLength}  hex=[${hex}]`);
}

// Demonstrate round-trip
const original = "Node.js 🚀";
const encoded  = enc.encode(original);
const decoded  = dec.decode(encoded);
console.log("round-trip ok:", original === decoded);
```

## Exercises

### Exercise 1: Count bytes, not characters

Write a function `byteLength(str)` using `TextEncoder` that returns the UTF-8 byte count. Test it with an emoji string.

<details>
<summary>Show solution</summary>

```js run
function byteLength(str) {
  return new TextEncoder().encode(str).byteLength;
}

const tests = [
  ["hello", 5],
  ["🎉", 4],
  ["café", 5],
  ["日本語", 9],
];

for (const [str, expected] of tests) {
  const got = byteLength(str);
  const ok = got === expected ? "✓" : `✗ (expected ${expected})`;
  console.log(`byteLength("${str}") = ${got}  ${ok}`);
}
```

</details>

### Exercise 2: Implement a base64-like nibble encoder

Without using `Buffer` or `btoa`, implement a hex encoder: given a `Uint8Array`, return a string where each byte is two lowercase hex digits. Then write the decoder.

<details>
<summary>Show solution</summary>

```js run
function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  if (hex.length % 2 !== 0) throw new Error("hex string must have even length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const original = "Node 🚀";
const bytes    = enc.encode(original);
const hexStr   = toHex(bytes);
const restored = fromHex(hexStr);
const text     = dec.decode(restored);

console.log("hex:       ", hexStr);
console.log("restored:  ", text);
console.log("round-trip:", text === original);
```

</details>

## Common pitfalls

> [!PITFALL] Using string.length as a byte count
> In JavaScript, `"🔥".length === 2` because emoji outside the Basic Multilingual Plane are represented as two UTF-16 surrogate code units. This is neither the Unicode code-point count (1) nor the UTF-8 byte count (4). If you pass `string.length` as a byte offset into a buffer, you will silently use the wrong value. Use `TextEncoder.encode(str).byteLength` or `Buffer.byteLength(str, "utf8")`.

Mixing up `latin1` and `utf8` when reading files is another frequent source of bugs. If you open a UTF-8 file with `encoding: "latin1"`, multi-byte sequences decode incorrectly and the string cannot be re-encoded to the same bytes. When in doubt, always default to UTF-8.

## What you learned

- **Characters** are abstract symbols; **bytes** are concrete storage. The mapping between them is an **encoding**.
- **UTF-8** is variable-width: ASCII characters take 1 byte, emoji take 4 bytes. `string.length` counts UTF-16 code units, not bytes.
- **Hex** makes bytes human-readable (1 byte → 2 chars). **Base64** makes arbitrary bytes safe for text channels (3 bytes → 4 chars, +33% size).
- `TextEncoder` / `TextDecoder` are the web-standard way to convert strings to `Uint8Array` and back; they work in Node, browsers, and all modern runtimes.
- Use `TextDecoder` in **streaming mode** when decoding chunked data to avoid splitting multi-byte sequences.

## Next steps

With a solid understanding of bytes and encodings, you're ready for the most advanced topic in this module: parsing real binary file formats — magic bytes, structured headers, endianness in practice, and building a hex-dump tool.
*/});
