registerLessonSrc("08-binary-parsing", function () {/*
---
id: 08-binary-parsing
title: "Parsing Binary File Formats"
minutes: 28
level: advanced
objectives:
  - Read structured binary data using magic numbers, headers, and byte offsets
  - Apply big-endian and little-endian reads correctly for real file formats
  - Implement a cursor/offset pattern to traverse binary data without losing your place
  - Build a hex-dump tool and a binary header parser as reusable utilities
---

# Parsing Binary File Formats

## Why this matters

Every JPEG, MP3, PDF, ZIP, and database file is a carefully structured sequence of bytes. When Node reads a file with `fs.readFile`, you get those raw bytes. Knowing how to decode them lets you build image processors, audio analysers, protocol parsers, and debugging tools that inspect binary formats directly — skills that separate systems engineers from those who can only work with JSON.

## Learning objectives

- Use **magic bytes** to identify a file format without relying on file extensions.
- Parse structured **headers** by reading fields at known byte offsets with correct endianness.
- Apply the **cursor/offset pattern** to traverse a binary buffer cleanly.
- Implement a **hex-dump** utility, the Swiss Army knife of binary debugging.
- Understand conceptually how PNG and WAV headers are organised.

## Magic bytes: binary file identification

Almost every binary format starts with a signature — a fixed sequence of bytes at offset 0 — called **magic bytes** or a **magic number**. File-type detection tools like the Unix `file` command use nothing but magic bytes; the `.png` extension is just a hint that could be wrong.

Some well-known magic byte signatures:

| Format | Offset 0 bytes (hex) | Human-readable |
|---|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `\x89PNG\r\n\x1a\n` |
| JPEG | `FF D8 FF` | — |
| GIF | `47 49 46 38` | `GIF8` |
| ZIP / DOCX / JAR | `50 4B 03 04` | `PK\x03\x04` |
| WAV (RIFF) | `52 49 46 46` | `RIFF` |
| PDF | `25 50 44 46` | `%PDF` |
| ELF (Linux binary) | `7F 45 4C 46` | `\x7FELF` |

```js
import { readFile } from "node:fs/promises";

async function detectFormat(filePath) {
  // Read only the first 8 bytes — no need to load the whole file
  const fd = await import("node:fs/promises").then(m => m.open(filePath));
  const buf = Buffer.alloc(8);
  await fd.read(buf, 0, 8, 0);
  await fd.close();

  const magic = buf.subarray(0, 4);
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "PNG";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "JPEG";
  if (magic.toString("ascii") === "RIFF") return "WAV/AVI (RIFF)";
  if (magic.toString("ascii") === "GIF8") return "GIF";
  if (buf[0] === 0x50 && buf[1] === 0x4B) return "ZIP-based";
  return "unknown";
}
```

## Anatomy of a PNG header

A PNG file starts with an 8-byte signature, then a series of **chunks**. Each chunk has the same layout:

```
Offset   Size   Field
──────   ────   ─────────────────────────
0        8      Signature: 89 50 4E 47 0D 0A 1A 0A
8        4      Chunk length (big-endian uint32)
12       4      Chunk type  (ASCII: "IHDR", "IDAT", "IEND", …)
16       4      Width  (big-endian uint32)  — inside IHDR data
20       4      Height (big-endian uint32)
24       1      Bit depth
25       1      Color type
26       1      Compression method
27       1      Filter method
28       1      Interlace method
29       4      CRC32 checksum
```

Key observations:
- All multi-byte integers are **big-endian** — the most-significant byte first.
- The first chunk is always `IHDR` and contains image dimensions.
- You can read width and height with just 28 bytes; you do not need to parse the entire file.

```js
import { readFile } from "node:fs/promises";

async function readPngDimensions(filePath) {
  const buf = await readFile(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Verify PNG signature
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error("Not a PNG file");
  }

  // IHDR chunk starts at offset 8
  // bytes 8-11: chunk data length
  // bytes 12-15: chunk type "IHDR"
  // bytes 16-19: width (big-endian)
  // bytes 20-23: height (big-endian)
  const width  = view.getUint32(16, false); // false = big-endian
  const height = view.getUint32(20, false);
  const depth  = view.getUint8(24);
  const colorType = view.getUint8(25);

  return { width, height, depth, colorType };
}
```

> [!OUTPUT]
> { width: 1920, height: 1080, depth: 8, colorType: 2 }

## Anatomy of a WAV header

WAV uses the **RIFF** container format — a completely different philosophy from PNG. RIFF is **little-endian** throughout (a reminder that you must always check a format's byte order). The header:

```
Offset   Size   Endian   Field
──────   ────   ──────   ──────────────────────────────
0        4      —        Chunk ID: "RIFF"
4        4      LE       File size minus 8
8        4      —        Format: "WAVE"
12       4      —        Subchunk1 ID: "fmt "
16       4      LE       Subchunk1 size (usually 16)
20       2      LE       Audio format (1 = PCM)
22       2      LE       Num channels (1 = mono, 2 = stereo)
24       4      LE       Sample rate (e.g. 44100)
28       4      LE       Byte rate (SampleRate * NumChannels * BitsPerSample / 8)
32       2      LE       Block align
34       2      LE       Bits per sample (e.g. 16)
```

```js
import { readFile } from "node:fs/promises";

async function readWavInfo(filePath) {
  const buf = await readFile(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const riff = buf.subarray(0, 4).toString("ascii");
  const wave = buf.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("Not a WAV file");

  const audioFormat  = view.getUint16(20, true); // true = little-endian
  const numChannels  = view.getUint16(22, true);
  const sampleRate   = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  return { audioFormat, numChannels, sampleRate, bitsPerSample };
}
```

> [!OUTPUT]
> { audioFormat: 1, numChannels: 2, sampleRate: 44100, bitsPerSample: 16 }

> [!NOTE] "fmt " with a trailing space
> The WAV subchunk ID is exactly 4 bytes: `"fmt "` — note the trailing space. Binary format identifiers are fixed-width ASCII fields, not null-terminated strings. Always compare them as fixed-length byte sequences.

## The cursor/offset pattern

When parsing a multi-field binary format, keeping track of your current position is error-prone if you do arithmetic ad hoc. The **cursor pattern** encapsulates the current offset and advances it cleanly:

```js
function createCursor(dataView) {
  let offset = 0;
  return {
    readUint8()  { const v = dataView.getUint8(offset);           offset += 1; return v; },
    readUint16LE(){ const v = dataView.getUint16(offset, true);   offset += 2; return v; },
    readUint16BE(){ const v = dataView.getUint16(offset, false);  offset += 2; return v; },
    readUint32LE(){ const v = dataView.getUint32(offset, true);   offset += 4; return v; },
    readUint32BE(){ const v = dataView.getUint32(offset, false);  offset += 4; return v; },
    readBytes(n) {
      const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, n);
      offset += n;
      return bytes;
    },
    readAscii(n) { return new TextDecoder("ascii").decode(this.readBytes(n)); },
    skip(n)  { offset += n; },
    get pos(){ return offset; },
  };
}
```

With this pattern, parsing becomes a linear, readable sequence:

```js
const cursor = createCursor(view);
const magic       = cursor.readAscii(4);  // "RIFF"
const fileSize    = cursor.readUint32LE();
const format      = cursor.readAscii(4);  // "WAVE"
const fmtChunk    = cursor.readAscii(4);  // "fmt "
const fmtSize     = cursor.readUint32LE();
const audioFmt    = cursor.readUint16LE();
const channels    = cursor.readUint16LE();
const sampleRate  = cursor.readUint32LE();
```

## The hex dump: your binary debugger

A **hex dump** displays bytes in a two-column format: hex on the left, printable ASCII on the right. It is the go-to tool when you need to inspect a binary file or debug a parser. The classic format from the `xxd` utility:

```
00000000: 4865 6c6c 6f2c 2057 6f72 6c64 210a      Hello, World!.
```

- The left column is the byte offset in hex.
- The middle shows bytes in groups of 2 (16 bytes per row).
- The right column shows the byte as ASCII, or `.` for non-printable bytes.

```js
function hexDump(bytes, bytesPerRow = 16) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += bytesPerRow) {
    const row  = bytes.subarray(i, i + bytesPerRow);
    const addr = i.toString(16).padStart(8, "0");
    const hex  = Array.from(row)
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(bytesPerRow * 3 - 1, " ");
    const ascii = Array.from(row)
      .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".")
      .join("");
    lines.push(`${addr}: ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}
```

> [!PRINCIPAL] Binary parsers should be lazy and zero-copy
> For large files, never read the entire file into memory just to inspect the header. Open the file descriptor, read only the bytes you need (a few dozen for most headers), close it. When you do have the whole buffer, use `subarray` views rather than copying slices. A production image metadata service might receive thousands of files per second — the difference between reading 32 bytes vs a 10 MB file is the difference between scaling and crashing.

## Try it yourself

This runnable block creates a fake binary format entirely in JS, uses a cursor to parse it, and includes a hex-dump function — no Node APIs needed.

```js run
// Define a tiny "TLV" format: Tag(1 byte) + Length(2 bytes LE) + Value(N bytes)
// We'll build a message containing two fields, then parse it back.

function createCursor(dv) {
  let pos = 0;
  return {
    readU8()     { return dv.getUint8(pos++); },
    readU16LE()  { const v = dv.getUint16(pos, true); pos += 2; return v; },
    readBytes(n) { const v = new Uint8Array(dv.buffer, dv.byteOffset + pos, n); pos += n; return v; },
    get offset() { return pos; },
    get done()   { return pos >= dv.byteLength; },
  };
}

function hexDump(bytes, width = 16) {
  const rows = [];
  for (let i = 0; i < bytes.length; i += width) {
    const row   = bytes.subarray(i, i + width);
    const addr  = i.toString(16).padStart(6, "0");
    const hex   = Array.from(row).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : ".").join("");
    rows.push(`${addr}: ${hex.padEnd(width * 3 - 1)}  ${ascii}`);
  }
  return rows.join("\n");
}

// Build the message
const enc = new TextEncoder();
const nameBytes = enc.encode("Alice");
const buf = new ArrayBuffer(1 + 2 + nameBytes.length + 1 + 2 + 1);
const dv  = new DataView(buf);
const raw = new Uint8Array(buf);

let offset = 0;
// Field 1: tag=0x01 (name), length=5, value="Alice"
dv.setUint8(offset, 0x01); offset += 1;
dv.setUint16(offset, nameBytes.length, true); offset += 2;
raw.set(nameBytes, offset); offset += nameBytes.length;

// Field 2: tag=0x02 (age), length=1, value=30
dv.setUint8(offset, 0x02); offset += 1;
dv.setUint16(offset, 1, true); offset += 2;
dv.setUint8(offset, 30); offset += 1;

// Hex dump the raw bytes
console.log("-- hex dump --");
console.log(hexDump(raw));

// Parse it back with the cursor
console.log("\n-- parsed fields --");
const dec = new TextDecoder();
const cur = createCursor(new DataView(buf));
while (!cur.done) {
  const tag = cur.readU8();
  const len = cur.readU16LE();
  const val = cur.readBytes(len);
  if (tag === 0x01) console.log("name:", dec.decode(val));
  if (tag === 0x02) console.log("age: ", val[0]);
}
```

## Exercises

### Exercise 1: Parse a BMP file width and height

BMP is the simplest image format. After a 14-byte file header, there is a 40-byte DIB header. Width (4 bytes LE) is at offset 18, height (4 bytes LE, may be negative meaning top-down) is at offset 22. Given the byte array below (a fake 100x200 BMP), extract width and height.

<details>
<summary>Show solution</summary>

```js run
// Fake a minimal BMP header: first 26 bytes
const bmp = new Uint8Array(26);
const dv  = new DataView(bmp.buffer);

// File header (14 bytes)
bmp[0] = 0x42; bmp[1] = 0x4D; // "BM" signature
dv.setUint32(2, 26, true);     // file size (LE)
dv.setUint32(6, 0, true);      // reserved
dv.setUint32(10, 14, true);    // pixel data offset

// DIB header (starts at 14)
dv.setUint32(14, 40, true);    // header size = 40
dv.setInt32(18, 100, true);    // width  = 100 (LE, signed)
dv.setInt32(22, 200, true);    // height = 200 (LE, signed, positive = bottom-up)

// Parse
const sig    = String.fromCharCode(bmp[0], bmp[1]);
const width  = dv.getInt32(18, true);
const height = dv.getInt32(22, true);

console.log("signature:", sig);              // BM
console.log("width px: ", width);            // 100
console.log("height px:", Math.abs(height)); // 200 (abs handles top-down flag)
```

</details>

### Exercise 2: Chunk iterator for RIFF-style formats

RIFF files are made of variable-length chunks. Each chunk: 4-byte ASCII ID, 4-byte LE size, then `size` bytes of data. Write a function that yields each chunk's ID and data given a Uint8Array.

<details>
<summary>Show solution</summary>

```js run
function parseChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder("ascii");
  const chunks = [];
  let pos = 0;

  while (pos + 8 <= bytes.length) {
    const id   = dec.decode(bytes.subarray(pos, pos + 4));
    const size = dv.getUint32(pos + 4, true);          // LE
    const data = bytes.subarray(pos + 8, pos + 8 + size);
    chunks.push({ id, size, data });
    pos += 8 + size;
    if (size % 2 !== 0) pos += 1; // RIFF chunks are word-aligned (even sizes)
  }

  return chunks;
}

// Build a fake RIFF-style stream with two chunks
const enc  = new TextEncoder();
const body = enc.encode("Hello!");              // 6 bytes
const buf  = new Uint8Array(8 + 6 + 8 + 1);    // two chunks: 6-byte + 1-byte
const dv   = new DataView(buf.buffer);

// Chunk 1: id="helo", size=6, data="Hello!"
buf.set(enc.encode("helo"), 0);
dv.setUint32(4, 6, true);
buf.set(body, 8);

// Chunk 2: id="cnt ", size=1, data=[42]
buf.set(enc.encode("cnt "), 14);
dv.setUint32(18, 1, true);
buf[22] = 42;

const chunks = parseChunks(buf);
for (const c of chunks) {
  console.log(`chunk "${c.id}" size=${c.size}`);
  if (c.id === "helo") console.log("  data:", new TextDecoder().decode(c.data));
  if (c.id === "cnt ") console.log("  value:", c.data[0]);
}
```

</details>

## Project

**Build a binary file-format parser (PNG/WAV header reader) and a hex-dump tool.**

Your project combines everything from this module: raw byte manipulation, endianness, the cursor pattern, and hex output. Because we're in a browser sandbox, the project uses a synthetic binary blob — but the logic is identical to what runs against real files in Node.

### Acceptance criteria

1. **Magic byte detection**: A `detectFormat(bytes)` function correctly identifies at least three formats (PNG, WAV/RIFF, JPEG) by inspecting the first 4–8 bytes, returning a format name string or `"unknown"`.
2. **PNG dimension reader**: A `parsePngHeader(bytes)` function reads width, height, bit depth, and color type from the IHDR chunk (bytes 16–28), throwing a descriptive error if the magic bytes do not match.
3. **WAV info reader**: A `parseWavHeader(bytes)` function reads audio format, channel count, sample rate, and bits-per-sample using a little-endian DataView, throwing on bad magic bytes.
4. **Cursor abstraction**: The parsers must use a reusable cursor object (not raw offset arithmetic scattered through parsing logic).
5. **Hex dump**: A `hexDump(bytes, width)` function produces `xxd`-style output: 8-char hex address, space-separated byte pairs, two-space gap, printable ASCII (`.` for non-printable), `width` bytes per row (default 16).
6. **Round-trip test**: After parsing, re-encoding the extracted values into a new buffer and re-parsing it must yield the same values.

### Starter code

```js run
// ─── Cursor abstraction ────────────────────────────────────────────────────
function makeCursor(dv) {
  let p = 0;
  const dec = new TextDecoder("ascii");
  return {
    u8()      { return dv.getUint8(p++); },
    u16be()   { const v = dv.getUint16(p, false); p += 2; return v; },
    u16le()   { const v = dv.getUint16(p, true);  p += 2; return v; },
    u32be()   { const v = dv.getUint32(p, false); p += 4; return v; },
    u32le()   { const v = dv.getUint32(p, true);  p += 4; return v; },
    bytes(n)  { const v = new Uint8Array(dv.buffer, dv.byteOffset + p, n); p += n; return v; },
    ascii(n)  { return dec.decode(this.bytes(n)); },
    skip(n)   { p += n; },
    get pos() { return p; },
  };
}

// ─── Hex dump ─────────────────────────────────────────────────────────────
function hexDump(bytes, width = 16) {
  const rows = [];
  for (let i = 0; i < bytes.length; i += width) {
    const row   = bytes.subarray(i, i + width);
    const addr  = i.toString(16).padStart(8, "0");
    const hex   = Array.from(row).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
    rows.push(`${addr}: ${hex.padEnd(width * 3 - 1)}  ${ascii}`);
  }
  return rows.join("\n");
}

// ─── Magic byte detection ──────────────────────────────────────────────────
function detectFormat(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "PNG";
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "JPEG";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "WAV/RIFF";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "PDF";
  return "unknown";
}

// ─── Fake PNG header builder (for testing without a real file) ─────────────
function makeFakePng(width, height) {
  const buf = new ArrayBuffer(33);
  const dv  = new DataView(buf);
  const raw = new Uint8Array(buf);
  // PNG signature
  [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A].forEach((b, i) => { raw[i] = b; });
  // IHDR chunk: 4-byte length, 4-byte type, then fields
  dv.setUint32(8,  13,     false); // IHDR data length
  raw[12]=0x49; raw[13]=0x48; raw[14]=0x44; raw[15]=0x52; // "IHDR"
  dv.setUint32(16, width,  false); // width BE
  dv.setUint32(20, height, false); // height BE
  raw[24] = 8;  // bit depth
  raw[25] = 2;  // color type: RGB
  return raw;
}

// ─── PNG parser ────────────────────────────────────────────────────────────
function parsePngHeader(bytes) {
  const sig = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) throw new Error("Not a PNG: invalid signature");
  }
  const dv  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cur = makeCursor(dv);
  cur.skip(8);           // skip signature
  cur.skip(4);           // skip IHDR chunk length
  const type   = cur.ascii(4);
  if (type !== "IHDR") throw new Error("Expected IHDR chunk, got: " + type);
  const width  = cur.u32be();
  const height = cur.u32be();
  const depth  = cur.u8();
  const color  = cur.u8();
  return { width, height, depth, color };
}

// ─── Fake WAV header builder ───────────────────────────────────────────────
function makeFakeWav(sampleRate, channels, bitsPerSample) {
  const buf = new ArrayBuffer(44);
  const dv  = new DataView(buf);
  const raw = new Uint8Array(buf);
  const enc = new TextEncoder();
  raw.set(enc.encode("RIFF"), 0);
  dv.setUint32(4, 36, true);           // file size - 8
  raw.set(enc.encode("WAVE"), 8);
  raw.set(enc.encode("fmt "), 12);
  dv.setUint32(16, 16, true);          // fmt chunk size
  dv.setUint16(20, 1,  true);          // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * bitsPerSample / 8, true);
  dv.setUint16(32, channels * bitsPerSample / 8, true);
  dv.setUint16(34, bitsPerSample, true);
  raw.set(enc.encode("data"), 36);
  dv.setUint32(40, 0, true);
  return raw;
}

// ─── WAV parser ────────────────────────────────────────────────────────────
function parseWavHeader(bytes) {
  const dv  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cur = makeCursor(dv);
  const riff = cur.ascii(4);
  if (riff !== "RIFF") throw new Error("Not a RIFF file");
  cur.skip(4);                         // file size
  const wave = cur.ascii(4);
  if (wave !== "WAVE") throw new Error("Not a WAV file: missing WAVE marker");
  cur.skip(4);                         // "fmt "
  cur.skip(4);                         // fmt chunk size
  const audioFormat   = cur.u16le();
  const numChannels   = cur.u16le();
  const sampleRate    = cur.u32le();
  cur.skip(4);                         // byte rate
  cur.skip(2);                         // block align
  const bitsPerSample = cur.u16le();
  return { audioFormat, numChannels, sampleRate, bitsPerSample };
}

// ─── Run all the things ────────────────────────────────────────────────────
const pngBytes = makeFakePng(1920, 1080);
const wavBytes = makeFakeWav(44100, 2, 16);
const jpgMagic = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);

console.log("=== Format Detection ===");
console.log("PNG bytes:", detectFormat(pngBytes)); // PNG
console.log("WAV bytes:", detectFormat(wavBytes)); // WAV/RIFF
console.log("JPEG bytes:", detectFormat(jpgMagic)); // JPEG

console.log("\n=== PNG Header ===");
const png = parsePngHeader(pngBytes);
console.log("width:", png.width, "height:", png.height);
console.log("bit depth:", png.depth, "color type:", png.color);

console.log("\n=== WAV Header ===");
const wav = parseWavHeader(wavBytes);
console.log("channels:", wav.numChannels, "sampleRate:", wav.sampleRate);
console.log("bits/sample:", wav.bitsPerSample, "format:", wav.audioFormat === 1 ? "PCM" : "other");

console.log("\n=== Hex Dump (first 33 bytes of PNG) ===");
console.log(hexDump(pngBytes));
```

## Common pitfalls

> [!PITFALL] Forgetting that Buffer views share the underlying ArrayBuffer
> When you do `const dv = new DataView(nodeBuffer.buffer)`, the DataView covers the *entire* underlying ArrayBuffer — which may be larger than your Buffer if Node pooled your allocation. Always pass `buf.buffer, buf.byteOffset, buf.byteLength` as the three DataView constructor arguments, or use `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`. Forgetting `byteOffset` is a source of mysterious off-by-one errors with pooled Buffers.

Endianness errors are silent: reading a big-endian `uint32` as little-endian returns a completely different number without throwing. Always check the spec and test with a known-good file.

## What you learned

- **Magic bytes** at offset 0 identify a file format more reliably than file extensions.
- **PNG** is big-endian; **WAV/RIFF** is little-endian — always check the spec, never assume.
- The **cursor/offset pattern** makes binary parsers linear and readable; raw offset arithmetic leads to bugs.
- A **hex dump** (offset + hex bytes + ASCII) is the fundamental tool for inspecting binary data.
- Combine `DataView` for multi-byte integers with `Uint8Array` for byte-by-byte access over the same `ArrayBuffer`.

## Next steps

You now have a complete toolkit for raw binary data. The next module explores Node's **Events** system — the `EventEmitter` class that underlies streams, HTTP, and nearly every async API in the ecosystem.
*/});
