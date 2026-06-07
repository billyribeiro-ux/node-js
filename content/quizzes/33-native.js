registerQuiz("33-napi", [
  {
    q: "What problem did Node-API (N-API) solve that existed with pre-N-API native addons?",
    options: [
      "Pre-N-API addons could not be loaded asynchronously",
      "Pre-N-API addons were compiled against V8 internal headers that changed between Node versions, requiring recompilation for every Node version",
      "Pre-N-API addons could not call back into JavaScript from C++",
      "Pre-N-API addons did not support TypeScript type definitions"
    ],
    answer: 1,
    explain: "Before N-API, addons compiled against V8 internal C++ headers would break on every Node version upgrade because those internals changed freely. N-API defines a stable C ABI that absorbs all V8 churn, so a compiled addon runs on any future Node version without recompilation."
  },
  {
    q: "What is the purpose of 'node-addon-api' (the npm package) when writing a native addon?",
    options: [
      "It is a build system that replaces node-gyp with a faster alternative",
      "It provides a C++ header-only wrapper over the raw N-API C interface, offering RAII handles and C++ exception mapping",
      "It compiles Rust source code to a .node binary automatically",
      "It publishes pre-built binaries to npm on behalf of addon authors"
    ],
    answer: 1,
    explain: "node-addon-api is a header-only C++ layer on top of the raw N-API C interface. It provides RAII handles (Napi::Value, Napi::Array), C++ exceptions that map to JavaScript exceptions, and a cleaner macro-based export syntax (NODE_API_MODULE), making addon code much less verbose than raw napi_* calls."
  },
  {
    q: "Which modern alternative to node-addon-api uses Rust macros to generate N-API glue code with the same ABI stability guarantee?",
    options: [
      "wasm-pack",
      "prebuild",
      "napi-rs",
      "Emscripten"
    ],
    answer: 2,
    explain: "napi-rs provides a Rust macro system (#[napi]) that generates all the N-API glue at compile time. The resulting .node file is indistinguishable from a C++ addon from Node's perspective. Projects like SWC and Biome use napi-rs in production."
  }
]);

registerResources("33-napi", [
  { title: "Node.js Node-API documentation", url: "https://nodejs.org/api/n-api.html" },
  { title: "node-addon-api (GitHub)", url: "https://github.com/nodejs/node-addon-api" },
  { title: "napi-rs — Rust bindings for Node-API", url: "https://napi.rs/" },
  { title: "Node.js C++ addons guide", url: "https://nodejs.org/api/addons.html" },
  { title: "prebuild — pre-built binaries for native addons", url: "https://github.com/prebuild/prebuild" }
]);

registerQuiz("33-wasm", [
  {
    q: "What is the correct way to pass a JavaScript string to a WebAssembly function?",
    options: [
      "Pass the string directly as a function argument -- WASM handles string conversion automatically",
      "Convert the string to a JavaScript Number first, then pass it",
      "Write the UTF-8 bytes into the shared linear memory (ArrayBuffer) and pass a (pointer, length) pair",
      "Use JSON.stringify and pass the resulting string as an i32"
    ],
    answer: 2,
    explain: "WASM functions only understand numeric types (i32, i64, f32, f64). Strings must be serialised as UTF-8 bytes into the shared linear memory (WebAssembly.Memory), and then the WASM function receives an integer pointer and integer length. The WASM code reads bytes from those offsets."
  },
  {
    q: "What does WASI (WebAssembly System Interface) add to a plain WASM module?",
    options: [
      "The ability to run WASM across multiple CPU threads in parallel",
      "Capability-based access to file system, clocks, environment variables, and standard I/O",
      "Automatic garbage collection for objects allocated in WASM linear memory",
      "A JIT compiler that optimises WASM bytecode to native machine code"
    ],
    answer: 1,
    explain: "Plain WASM is sandboxed pure computation with no OS access. WASI adds a capability-based API layer that grants a WASM module selective access to host resources: specific directories, clocks, environment variables, and stdio -- but only the capabilities you explicitly hand to it via the WASI constructor options."
  },
  {
    q: "When a WebAssembly module calls 'WebAssembly.Memory.grow()', what happens to existing 'ArrayBuffer' references held by JavaScript?",
    options: [
      "They automatically expand to reflect the new size",
      "They are cloned and the old references remain valid pointing to the old data",
      "They become detached -- any read or write on the old reference throws a TypeError",
      "They continue to work but now point to read-only memory"
    ],
    answer: 2,
    explain: "When WASM memory grows, the underlying ArrayBuffer is replaced. Any existing ArrayBuffer reference held by JavaScript becomes detached. Attempting to read or write through a detached ArrayBuffer throws a TypeError. You must re-read memory.buffer after any operation that may trigger a memory.grow()."
  }
]);

registerResources("33-wasm", [
  { title: "Node.js WASI API documentation", url: "https://nodejs.org/api/wasi.html" },
  { title: "MDN: WebAssembly JavaScript API", url: "https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface" },
  { title: "WebAssembly specification", url: "https://webassembly.github.io/spec/core/" },
  { title: "AssemblyScript (TypeScript to WASM)", url: "https://www.assemblyscript.org/" },
  { title: "wasm-pack -- Rust to WebAssembly", url: "https://rustwasm.github.io/wasm-pack/" }
]);

registerQuiz("33-native-tradeoffs", [
  {
    q: "According to the decision framework, which approach scores HIGHEST on portability?",
    options: [
      "N-API native addon",
      "WebAssembly (WASM)",
      "Worker threads",
      "Both Pure JS and Worker threads score highest, tied with WASM"
    ],
    answer: 3,
    explain: "Pure JS, Worker threads, and WASM all score 5 (highest) on portability -- they run identically on every platform and architecture. N-API addons score 2 because they produce platform-specific binaries requiring one build per OS/arch combination."
  },
  {
    q: "Why can Worker threads sometimes outperform N-API addons for array-heavy workloads?",
    options: [
      "Worker threads run at a higher OS scheduling priority than native addon callbacks",
      "Worker threads use SharedArrayBuffer for zero-copy data sharing, while N-API addons must marshal data across the JS-to-native boundary",
      "Worker threads bypass V8 and run JavaScript in a dedicated native thread pool",
      "N-API addons cannot handle Float64Array inputs directly"
    ],
    answer: 1,
    explain: "N-API addons must marshal each argument (JS value to C type) and unmarshal the return value when crossing the boundary. For large arrays, this can dominate the compute time. Worker threads can operate on SharedArrayBuffer with zero copy, passing a reference rather than copying the data, which often outperforms N-API for array-heavy work."
  },
  {
    q: "What is the recommended batch-call pattern when invoking an N-API addon from a tight loop?",
    options: [
      "Call the addon once per element inside the loop to keep JS and native in sync",
      "Use setImmediate between calls to avoid blocking the event loop",
      "Pass the entire array in one call so the native code does the iteration, paying FFI cost only once",
      "Convert the loop to async/await so the event loop can interleave addon calls"
    ],
    answer: 2,
    explain: "FFI overhead is paid once per call across the JS-to-native boundary. Calling addon.square(x) N times in a loop pays that overhead N times. Calling addon.sumOfSquares(array) once pays it only once and lets the native code iterate, which dramatically reduces the overhead for large N."
  }
]);

registerResources("33-native-tradeoffs", [
  { title: "Node.js Worker threads documentation", url: "https://nodejs.org/api/worker_threads.html" },
  { title: "Node.js Node-API documentation", url: "https://nodejs.org/api/n-api.html" },
  { title: "MDN: SharedArrayBuffer", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer" },
  { title: "WebAssembly JavaScript API -- MDN", url: "https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface" },
  { title: "napi-rs -- Rust native addons", url: "https://napi.rs/" }
]);
