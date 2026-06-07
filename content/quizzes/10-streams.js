registerQuiz("10-stream-types", [
  {
    q: "What distinguishes a Transform stream from a Duplex stream?",
    options: [
      "Transform streams are read-only while Duplex streams are write-only",
      "In a Transform the readable side is derived from written data (it processes input to produce output); in a Duplex the read and write channels are independent",
      "Duplex streams support backpressure while Transform streams do not",
      "Transform streams work only in object mode while Duplex streams work in byte mode"
    ],
    answer: 1,
    explain: "Both are readable+writable, but a Duplex (like a TCP socket) has two independent channels. A Transform couples them: bytes you write in come back out the readable side after processing, like a gzip compressor or an uppercase converter."
  },
  {
    q: "A Node.js Readable stream starts in paused mode. What action switches it to flowing mode, causing `data` events to fire automatically?",
    options: [
      "Calling `stream.start()`",
      "Attaching a `data` event listener or calling `.pipe(destination)`",
      "Setting `stream.autoFlow = true`",
      "Calling `stream.read()` once"
    ],
    answer: 1,
    explain: "Attaching a `'data'` listener or calling `.pipe()` both switch a Readable to flowing mode. In flowing mode the stream pushes chunks automatically. In paused mode you must call `.read()` explicitly to pull chunks."
  },
  {
    q: "In object mode streams, what does `highWaterMark` count?",
    options: [
      "The total byte size of all objects in the buffer",
      "The number of objects (items) in the buffer, not bytes",
      "The number of active listeners consuming the stream",
      "The maximum allowed size in bytes of a single object"
    ],
    answer: 1,
    explain: "In object mode `highWaterMark` counts discrete objects (default: 16), not bytes. One 1 MB object and one 1 byte object each count as 1 item. This is why you cannot mix byte-mode and object-mode streams without an adapter Transform."
  }
]);

registerResources("10-stream-types", [
  { title: "Node.js Streams API overview", url: "https://nodejs.org/api/stream.html" },
  { title: "Readable streams", url: "https://nodejs.org/api/stream.html#class-streamreadable" },
  { title: "Writable streams", url: "https://nodejs.org/api/stream.html#class-streamwritable" },
  { title: "Transform streams", url: "https://nodejs.org/api/stream.html#class-streamtransform" },
  { title: "Duplex streams", url: "https://nodejs.org/api/stream.html#class-streamduplex" }
]);

registerQuiz("10-pipeline-backpressure", [
  {
    q: "What signal does a Writable stream send to indicate its internal buffer is full and the producer should slow down?",
    options: [
      "It emits a `'pause'` event",
      "`writable.write()` returns `false`; the producer should pause until the writable emits `'drain'`",
      "It sets `writable.paused = true` which the producer must check",
      "It throws a `BufferFullError` that the producer must catch"
    ],
    answer: 1,
    explain: "When the Writable's internal buffer reaches `highWaterMark`, `writable.write()` returns `false`. A well-behaved producer pauses the readable source and waits for the `'drain'` event before writing more, preventing unbounded memory growth."
  },
  {
    q: "What is the primary advantage of `stream.pipeline()` over `.pipe()` for production code?",
    options: [
      "pipeline() is significantly faster than .pipe() for large files",
      "pipeline() propagates errors from any stream and destroys all streams in the chain on failure; .pipe() does not propagate errors",
      "pipeline() supports object mode streams while .pipe() only handles byte streams",
      "pipeline() automatically adds backpressure handling that .pipe() lacks"
    ],
    answer: 1,
    explain: "`.pipe()` does not propagate errors between streams, leaving open file handles and dangling streams on failure. `stream.pipeline()` attaches error handlers to all stages and destroys every stream in the chain when any one errors, preventing resource leaks."
  },
  {
    q: "Which import gives you a Promise-based `pipeline()` function compatible with `async/await`?",
    options: [
      "\"node:stream\"",
      "\"node:stream/promises\"",
      "\"node:fs/promises\"",
      "\"node:util/promises\""
    ],
    answer: 1,
    explain: "`node:stream` exports a callback-based `pipeline`. `node:stream/promises` exports a version that returns a Promise, enabling `await pipeline(...)` syntax. Mixing up the two is a common mistake that produces subtle bugs."
  }
]);

registerResources("10-pipeline-backpressure", [
  { title: "stream.pipeline (promises)", url: "https://nodejs.org/api/stream.html#streampipelinestreams-callback" },
  { title: "Backpressure in streams guide", url: "https://nodejs.org/en/docs/guides/backpressuring-in-streams" },
  { title: "Writable.write() and drain event", url: "https://nodejs.org/api/stream.html#writablewritechunk-encoding-callback" },
  { title: "highWaterMark option", url: "https://nodejs.org/api/stream.html#buffering" }
]);

registerQuiz("10-transform-streams", [
  {
    q: "When implementing a `Transform` stream, what is the purpose of the `flush(callback)` method?",
    options: [
      "It is called on every chunk to flush the internal buffer to the readable side immediately",
      "It is called after all input is consumed, giving you a chance to push any remaining buffered state before the stream closes",
      "It forces the stream to emit all internally buffered data without waiting for more input",
      "It is called when the stream encounters an error to flush partial output and signal the error"
    ],
    answer: 1,
    explain: "`flush()` fires once, after the last chunk has been passed to `transform()`, before the readable side closes. It is essential for stateful transforms like line splitters that may hold a partial last line in memory after all chunks are processed."
  },
  {
    q: "How should you push multiple output chunks for a single input chunk in a Transform's `transform()` method?",
    options: [
      "Return an array from the `transform()` function",
      "Call `this.push(chunk1); this.push(chunk2);` multiple times, then call `callback()` once at the end",
      "Call `callback(null, chunk1, chunk2)` with multiple arguments",
      "Call `callback()` once per chunk you want to push"
    ],
    answer: 1,
    explain: "You can call `this.push()` as many times as needed before calling `callback()`. `callback()` must be called exactly once per `transform()` invocation. Calling it more than once, or returning multiple values, corrupts the stream state."
  },
  {
    q: "What do the `readableObjectMode` and `writableObjectMode` options allow when creating a Transform stream?",
    options: [
      "They enable the transform to emit events instead of streaming chunks",
      "They set object mode independently on each side, allowing a transform to accept bytes and emit objects (or vice versa), bridging byte and object pipelines",
      "They configure the stream to accept only plain objects and reject primitive values",
      "They are aliases for `objectMode: true` that apply to readable and writable separately but have the same effect"
    ],
    answer: 1,
    explain: "Setting `readableObjectMode: true` means the transform's output (readable side) emits objects; `writableObjectMode: true` means the input (writable side) accepts objects. This lets a single Transform bridge a byte-mode pipeline stage and an object-mode pipeline stage."
  }
]);

registerResources("10-transform-streams", [
  { title: "Transform stream API", url: "https://nodejs.org/api/stream.html#class-streamtransform" },
  { title: "Implementing a Transform stream", url: "https://nodejs.org/api/stream.html#implementing-a-transform-stream" },
  { title: "stream.pipeline documentation", url: "https://nodejs.org/api/stream.html#streampipelinestreams-callback" },
  { title: "Node.js zlib Transform streams", url: "https://nodejs.org/api/zlib.html" }
]);

registerQuiz("10-web-streams", [
  {
    q: "What method connects a `ReadableStream` to a `TransformStream` in the Web Streams API?",
    options: [
      ".pipe(transform)",
      ".pipeThrough(transform)",
      ".pipeTo(transform)",
      ".connect(transform)"
    ],
    answer: 1,
    explain: "`.pipeThrough(transformStream)` passes the readable through a `TransformStream` and returns a new `ReadableStream` that you can continue piping. `.pipeTo(writableStream)` is the terminal operation that returns a Promise."
  },
  {
    q: "How do you convert a Node.js `Readable` stream into a Web Streams `ReadableStream` for use with `fetch`-based APIs?",
    options: [
      "new ReadableStream(nodeReadable)",
      "Readable.toWeb(nodeReadable)",
      "nodeReadable.toWebStream()",
      "Web streams cannot interoperate with Node streams"
    ],
    answer: 1,
    explain: "`Readable.toWeb(nodeReadable)` (Node 18+) converts a Node Readable into a WHATWG `ReadableStream`. The reverse is `Readable.fromWeb(webReadableStream)`. These adapters let you mix Node-specific streams (fs, zlib) with web-standard fetch bodies."
  },
  {
    q: "When `fetch()` returns a response with a large body, what type does `response.body` have, and how does this affect reading it?",
    options: [
      "It is a Node.js Buffer; call `response.body.toString()` to get the text",
      "It is a WHATWG `ReadableStream`; consume it with `for await...of`, a reader, or convert it to a Node stream with `Readable.fromWeb()`",
      "It is a Node.js Readable stream; attach a `data` event listener to consume chunks",
      "It is a Promise that resolves to a string once the body is fully received"
    ],
    answer: 1,
    explain: "In Node 18+ the native `fetch()` API returns a WHATWG `ReadableStream` for `response.body`, not a Node Readable. Use `for await...of`, `response.body.getReader()`, or `Readable.fromWeb(response.body)` to consume it efficiently without buffering the entire body."
  }
]);

registerResources("10-web-streams", [
  { title: "WHATWG Streams Standard", url: "https://streams.spec.whatwg.org/" },
  { title: "MDN ReadableStream", url: "https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream" },
  { title: "MDN TransformStream", url: "https://developer.mozilla.org/en-US/docs/Web/API/TransformStream" },
  { title: "Node.js Web Streams API", url: "https://nodejs.org/api/webstreams.html" },
  { title: "Readable.fromWeb / Readable.toWeb", url: "https://nodejs.org/api/stream.html#streamreadablefromwebreadablestream-options" }
]);
