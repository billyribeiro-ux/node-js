registerQuiz("08-buffers-basics", [
  {
    q: "What is the relationship between Node's `Buffer` class and `Uint8Array`?",
    options: [
      "Buffer and Uint8Array are completely separate types with no relationship",
      "Buffer is a subclass of Uint8Array, so all TypedArray operations work on it",
      "Uint8Array is a subclass of Buffer, extending it with web-standard methods",
      "Buffer wraps a Uint8Array internally but does not extend it"
    ],
    answer: 1,
    explain: "Node's `Buffer` extends `Uint8Array`, which means every TypedArray method (`subarray`, `copyWithin`, `forEach`, etc.) works on a Buffer. However, `Buffer.isBuffer(new Uint8Array())` returns false — the inheritance is one-directional."
  },
  {
    q: "What is the difference between `Buffer.alloc(16)` and `Buffer.allocUnsafe(16)`?",
    options: [
      "`Buffer.alloc` is asynchronous; `Buffer.allocUnsafe` is synchronous",
      "`Buffer.alloc` zeroes all bytes before returning; `Buffer.allocUnsafe` skips zeroing and may contain old memory content",
      "`Buffer.alloc` uses the V8 heap; `Buffer.allocUnsafe` uses native memory",
      "`Buffer.allocUnsafe` throws if the requested size exceeds 1 MB"
    ],
    answer: 1,
    explain: "`Buffer.alloc` fills every byte with 0x00 before returning, making it safe to read immediately. `Buffer.allocUnsafe` skips that step for speed, so bytes may contain stale memory — you must write to every byte before reading."
  },
  {
    q: "When you call `buffer.subarray(1, 4)` on a Buffer, does the result share memory with the original?",
    options: [
      "No — subarray always creates an independent copy of the bytes",
      "Yes — subarray returns a view into the same underlying memory; mutating one affects the other",
      "It depends on the size; slices smaller than 4 KB share memory, larger ones are copied",
      "Yes, but only if the original Buffer was created with `Buffer.alloc`"
    ],
    answer: 1,
    explain: "`subarray()` (and the deprecated `slice()`) return a view backed by the same ArrayBuffer as the original. Modifying a byte via the subarray changes the original too. Use `Buffer.from(original.subarray(...))` to get an independent copy."
  }
]);

registerResources("08-buffers-basics", [
  { title: "Node.js Buffer API", url: "https://nodejs.org/api/buffer.html" },
  { title: "MDN ArrayBuffer", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer" },
  { title: "MDN TypedArray", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray" },
  { title: "MDN DataView", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView" },
  { title: "Node.js Buffer vs Uint8Array", url: "https://nodejs.org/api/buffer.html#buffers-and-typedarrays" }
]);

registerQuiz("08-encodings", [
  {
    q: "Why does `'🔥'.length === 2` in JavaScript, and how many bytes does that emoji occupy in UTF-8?",
    options: [
      "length is 2 because the emoji is stored as two UTF-8 bytes",
      "length counts UTF-16 code units; the emoji requires a surrogate pair (2 units), but it occupies 4 bytes in UTF-8",
      "length is 2 because emoji are always represented as two ASCII characters internally",
      "length counts Unicode code points; the emoji is U+1F525 which maps to 2 code points"
    ],
    answer: 1,
    explain: "JavaScript strings are UTF-16. The fire emoji (U+1F525) is outside the Basic Multilingual Plane and needs a surrogate pair — two UTF-16 code units — giving `.length === 2`. In UTF-8 it encodes to 4 bytes."
  },
  {
    q: "What is the key advantage of `base64url` over standard `base64` encoding?",
    options: [
      "base64url produces smaller output because it omits padding",
      "base64url replaces `+` with `-` and `/` with `_`, making it safe to use in URLs, filenames, and cookies without percent-encoding",
      "base64url is faster to encode and decode than standard base64",
      "base64url is a newer standard that also compresses the data"
    ],
    answer: 1,
    explain: "Standard base64 uses `+`, `/`, and `=` which are special characters in URLs. base64url substitutes `-` for `+` and `_` for `/` (and drops padding), producing strings that can appear in URLs, HTTP headers, and cookies without escaping."
  },
  {
    q: "What is the purpose of passing `{ stream: true }` to `TextDecoder.decode(chunk, { stream: true })`?",
    options: [
      "It makes the decode operation asynchronous so it does not block the event loop",
      "It tells the decoder to buffer incomplete multi-byte sequences between calls, so characters split across chunks are decoded correctly",
      "It enables the decoder to handle multiple encodings in a single stream",
      "It activates lazy decoding, which only converts bytes when the resulting string is accessed"
    ],
    answer: 1,
    explain: "In streaming mode the decoder retains any incomplete multi-byte sequence at the end of a chunk and prepends it to the next call. Without this, a 4-byte emoji arriving split across two network chunks would produce garbled output."
  }
]);

registerResources("08-encodings", [
  { title: "Node.js Buffer encodings", url: "https://nodejs.org/api/buffer.html#buffers-and-character-encodings" },
  { title: "MDN TextEncoder", url: "https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder" },
  { title: "MDN TextDecoder", url: "https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder" },
  { title: "WHATWG Encoding specification", url: "https://encoding.spec.whatwg.org/" },
  { title: "Unicode UTF-8 explained", url: "https://www.unicode.org/faq/utf_bom.html" }
]);

registerQuiz("08-binary-parsing", [
  {
    q: "What are 'magic bytes' and why are they more reliable for file-type detection than file extensions?",
    options: [
      "Magic bytes are random bytes added by the OS to prevent file corruption; extensions can be spoofed by renaming",
      "Magic bytes are fixed byte sequences at offset 0 of a file that identify its format; extensions are just strings anyone can rename",
      "Magic bytes are cryptographic signatures embedded by the author; extensions only describe the intended application",
      "Magic bytes are the final bytes of a file used as a checksum; extensions describe the encoding"
    ],
    answer: 1,
    explain: "Most binary formats begin with a fixed signature (e.g., PNG starts with `89 50 4E 47`). These bytes are part of the format specification, not a user-editable label. A file extension is just a hint that can be changed by renaming the file without altering its content."
  },
  {
    q: "The PNG format uses big-endian integers while the WAV/RIFF format uses little-endian. What `DataView` second argument controls this?",
    options: [
      "Pass `true` for big-endian and `false` for little-endian",
      "Pass `false` for big-endian and `true` for little-endian",
      "Pass `\"BE\"` or `\"LE\"` as the second argument",
      "Endianness is set at DataView construction time, not per-read"
    ],
    answer: 1,
    explain: "DataView methods like `getUint32(offset, littleEndian)` take a boolean second argument. Pass `false` (or omit it) for big-endian (PNG, network byte order) and `true` for little-endian (WAV, most CPU-native formats)."
  },
  {
    q: "What problem does the cursor/offset pattern solve when parsing binary formats?",
    options: [
      "It prevents the DataView from reading past the end of the buffer",
      "It encapsulates the current byte position and advances it atomically with each read, eliminating manual offset arithmetic and its associated bugs",
      "It caches parsed values to avoid re-reading bytes from disk",
      "It converts between little-endian and big-endian automatically based on the file format"
    ],
    answer: 1,
    explain: "Manually tracking `offset += N` after every read is error-prone. A cursor object wraps the DataView, increments the position inside each `read*()` method, and exposes a clean sequential API that makes the parsing code read like the format specification."
  }
]);

registerResources("08-binary-parsing", [
  { title: "MDN DataView", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView" },
  { title: "PNG specification — file structure", url: "https://www.w3.org/TR/PNG/#5Chunk-layout" },
  { title: "WAV/RIFF format specification", url: "http://soundfile.sapp.org/doc/WaveFormat/" },
  { title: "Node.js Buffer read methods", url: "https://nodejs.org/api/buffer.html#bufreaduint8offset" },
  { title: "MDN Uint8Array", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array" }
]);
