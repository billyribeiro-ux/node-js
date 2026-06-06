registerLessonSrc("33-napi", function () {/*
---
id: 33-napi
title: "Node-API (N-API) & node-addon-api"
minutes: 24
level: advanced
objectives:
  - Explain why native addons exist and when to reach for them
  - Understand Node-API ABI stability and how it protects your addon across Node versions
  - Describe the node-addon-api C++ wrapper and the node-gyp build toolchain
---

# Node-API (N-API) & node-addon-api

## Why this matters

JavaScript is fast enough for most tasks, but two families of problems still force you to reach beyond it: **CPU-bound numeric work** (signal processing, image codecs, linear algebra, cryptographic primitives) where even optimised JS can't match native throughput, and **existing C, C++, or Rust libraries** that you want to call without rewriting them. Native addons are how Node bridges that gap. Understanding the machinery — why it's safer than it used to be, how the build works, when it's worth the complexity — lets you make the right call on real projects.

## Learning objectives

- Explain **why native addons exist** and identify the right use cases.
- Describe **Node-API (N-API)** ABI stability and why it matters across Node versions.
- Read a **node-addon-api** C++ hello-world and understand its structure.
- Know the **node-gyp** build pipeline and its moving parts.
- Recognise **napi-rs** as the modern Rust alternative.

## Why native addons?

Three legitimate reasons pull teams toward native code:

**1. CPU-bound numeric work.** A tight inner loop doing millions of floating-point operations — a convolution filter, a fast Fourier transform, a matrix multiply — can be 5–20x faster in native code. Pure JS (even with V8's JIT) pays overhead: dynamic type checks, GC pauses, array-bounds checks.

**2. Existing C/C++ libraries.** The world has decades of high-quality C and C++ libraries: LibTIFF, OpenSSL's EVP layer, libuv wrappers, FFmpeg, SQLite's raw API. Wrapping them is far cheaper than rewriting them.

**3. Low-level system access.** GPU compute via Vulkan or CUDA, SIMD intrinsics, memory-mapped hardware registers — JavaScript simply can't reach these.

> [!NOTE] Don't optimise prematurely
> Measure first. Node.js Worker threads and WASM (next lesson) often solve CPU-bound problems without the build-system complexity of a native addon. Reach for N-API when benchmarks prove JS isn't fast enough and the others don't fit.

## The ABI stability problem — and how N-API solves it

Before Node-API, addons were compiled against **V8's internal C++ headers**. V8's internals change between Node versions, so an addon built for Node 16 would crash on Node 18. Teams shipped pre-built binaries for every Node version and every OS/arch combination — a maintenance nightmare.

**Node-API** (stabilised in Node 8, now central to the platform) defines a **stable C ABI** that sits *between* the addon and V8. Node guarantees this surface never breaks — an addon compiled once runs on any future Node version that supports that N-API version, without recompilation.

```
  Your C/C++/Rust code
        |
   Node-API C layer   <-- stable, versioned ABI (napi_*)
        |
    V8 internals      <-- change freely; Node-API absorbs the churn
        |
   Node.js runtime
```

Node-API versions are integers (1–9 as of Node 24). You declare the minimum version you need in your `binding.gyp`:

```js
// binding.gyp excerpt
{
  "targets": [{
    "target_name": "myaddon",
    "defines": ["NAPI_VERSION=6"],
    "sources": ["src/addon.cc"]
  }]
}
```

> [!PRINCIPAL] ABI stability is the real value proposition of N-API
> Teams underestimate how painful pre-N-API addon maintenance was. CI had to build for every Node minor. Electron apps added a whole extra matrix. N-API's stable ABI turns a multiplicative maintenance burden into a one-time build. When you evaluate a third-party native dependency, always check: does it use N-API? If not, plan for more friction.

## node-addon-api: the C++ comfort layer

N-API's raw interface is pure C: every value is an opaque `napi_value`, every operation returns an error code, and you manually propagate exceptions. Correct, but verbose.

**node-addon-api** (`npm install node-addon-api`) is a header-only C++ wrapper that sits on top of N-API. It gives you RAII handles, C++ exceptions that map to JS exceptions, and a cleaner macro-based export syntax.

Here is a minimal "sum of squares" addon in C++ with node-addon-api:

```js
// src/addon.cc  (read-only — shows real C++ source)
#include <napi.h>

// The actual numeric work — pure C++
double sumOfSquares(const double* data, size_t len) {
  double acc = 0.0;
  for (size_t i = 0; i < len; i++) acc += data[i] * data[i];
  return acc;
}

// The N-API wrapper that Node calls
Napi::Value SumOfSquares(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!info[0].IsArray()) {
    Napi::TypeError::New(env, "Expected an Array").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Array arr = info[0].As<Napi::Array>();
  size_t len = arr.Length();

  // Copy JS array into a C++ vector
  std::vector<double> data(len);
  for (size_t i = 0; i < len; i++) {
    data[i] = arr.Get(i).As<Napi::Number>().DoubleValue();
  }

  double result = sumOfSquares(data.data(), len);
  return Napi::Number::New(env, result);
}

// Register exports — NODE_API_MODULE macro wires this up
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("sumOfSquares", Napi::Function::New(env, SumOfSquares));
  return exports;
}

NODE_API_MODULE(addon, Init)
```

The corresponding `binding.gyp` (GYP format — a JSON-like build spec):

```js
// binding.gyp
{
  "targets": [{
    "target_name": "addon",
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "sources": ["src/addon.cc"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
  }]
}
```

And calling it from JavaScript:

```js
// index.js
const addon = require("./build/Release/addon.node");

const data = Array.from({ length: 1_000_000 }, (_, i) => i + 1);
const result = addon.sumOfSquares(data);
console.log(result); // 333333833333500000
```

> [!OUTPUT]
> 333333833333500000

## The node-gyp build pipeline

`node-gyp` is Node's build-system bridge. It uses GYP files to generate platform-native build files (Makefile on Linux/macOS, MSVC project on Windows) and then compiles them.

```bash
# typical addon project lifecycle
npm install             # installs node-addon-api, node-gyp, etc.
npx node-gyp configure  # reads binding.gyp, generates build files
npx node-gyp build      # compiles -> build/Release/addon.node
node index.js           # loads the .node binary
```

`.node` files are native shared libraries (`.so` / `.dylib` / `.dll`) with a special extension. `require()` loads them via `dlopen` (or the Windows equivalent).

> [!WARNING] node-gyp requires a C++ toolchain
> On Linux: `build-essential` and Python 3. On macOS: Xcode command-line tools. On Windows: "Desktop development with C++" via Visual Studio. CI pipelines must install these explicitly. This is a key reason teams prefer WASM or Worker threads for portability.

## Distributing pre-built binaries with prebuild

Building from source on every `npm install` is slow and requires a C++ toolchain on the user's machine. Tools like **prebuild** and **prebuild-install** let you publish pre-compiled `.node` files to GitHub Releases, keyed by platform and Node version. Users with a matching binary skip compilation entirely.

```bash
# publish binaries for common targets:
npx prebuild --runtime node --target 22.0.0 --arch x64,arm64 --upload
```

## napi-rs: Native addons in Rust

Rust has emerged as the language of choice for new native Node addons. **napi-rs** (`napi.rs`) provides a Rust macro system that maps Rust functions to N-API exports with minimal boilerplate and no manual memory management.

```js
// src/lib.rs  (Rust source — read-only reference)
use napi_derive::napi;

#[napi]
fn sum_of_squares(data: Vec<f64>) -> f64 {
  data.iter().map(|x| x * x).sum()
}
```

The `#[napi]` macro generates all the N-API glue at compile time. The resulting `.node` file is identical to a C++ addon from Node's perspective. Projects like **SWC** (the Rust-based JavaScript transpiler used inside Next.js) and **Biome** use napi-rs in production, serving millions of developers.

## Try it yourself

While you can't compile C++ in this sandbox, the underlying numeric routine is pure math. Here is the "sum of squares" computation in pure JavaScript — the same logic you'd offload to native in a real project. Watch how it compares to what a native addon would do:

```js run
// Pure-JS implementation of the hot numeric routine
// In a real project, this inner loop would be the N-API addon.

function sumOfSquares(data) {
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    acc += data[i] * data[i];
  }
  return acc;
}

// Simple DSP: apply a one-pole low-pass filter (y[n] = alpha*x[n] + (1-alpha)*y[n-1])
function lowPassFilter(data, alpha) {
  const out = new Float64Array(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    out[i] = alpha * data[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

// Generate a test signal: sawtooth wave
const N = 1024;
const signal = new Float64Array(N);
for (let i = 0; i < N; i++) signal[i] = (i % 64) / 64.0;

const sos = sumOfSquares(Array.from(signal));
console.log("Sum of squares:", sos.toFixed(4));

const filtered = lowPassFilter(signal, 0.1);
console.log("Filtered[0..4]:", Array.from(filtered.slice(0, 4)).map(v => v.toFixed(4)).join(", "));

// Measure throughput (illustrative — sandbox timing is not reliable)
const start = Date.now();
for (let trial = 0; trial < 1000; trial++) sumOfSquares(Array.from(signal));
const elapsed = Date.now() - start;
console.log(`1000x sumOfSquares on ${N} elements: ${elapsed}ms`);
console.log("A native addon would run this 5-20x faster for large N.");
```

## Exercises

**Exercise 1.** Modify `sumOfSquares` above to also compute the mean and variance in a single pass (Welford's online algorithm). This is the kind of statistically useful routine that makes a great N-API addon candidate.

<details>
<summary>Show solution</summary>

```js run
function statsOnePass(data) {
  let n = 0, mean = 0, M2 = 0;
  for (const x of data) {
    n++;
    const delta = x - mean;
    mean += delta / n;
    const delta2 = x - mean;
    M2 += delta * delta2;
  }
  const variance = n > 1 ? M2 / (n - 1) : 0;
  return { mean, variance, stddev: Math.sqrt(variance) };
}

const data = [2, 4, 4, 4, 5, 5, 7, 9];
const stats = statsOnePass(data);
console.log("mean:", stats.mean);          // 5
console.log("variance:", stats.variance);  // 4
console.log("stddev:", stats.stddev);      // 2
```

</details>

**Exercise 2.** Sketch (in comments) what the `binding.gyp` changes would be if you wanted to link your addon against an external C library (e.g., FFTW) installed at `/usr/local`. What fields would you add?

<details>
<summary>Show solution</summary>

In `binding.gyp` you would add `"libraries"` and `"include_dirs"`:

```js run
// Conceptual binding.gyp additions — not runnable in browser,
// but the logic is expressed here as a JS object for clarity.

const gypFragment = {
  targets: [{
    target_name: "fftaddon",
    sources: ["src/fft_addon.cc"],
    include_dirs: [
      "<!@(node -p \"require('node-addon-api').include\")",
      "/usr/local/include/fftw3"   // <-- external lib headers
    ],
    libraries: [
      "-L/usr/local/lib",
      "-lfftw3"                    // <-- link against libfftw3
    ],
    defines: ["NAPI_VERSION=6"]
  }]
};

console.log("include_dirs:", gypFragment.targets[0].include_dirs[1]);
console.log("libraries:", gypFragment.targets[0].libraries[1]);
console.log("The -l flag names the library without the 'lib' prefix and without '.so'");
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to handle JS exceptions after N-API calls
> In raw N-API (C), every function returns `napi_status`. If you don't check it and propagate errors, your addon silently does the wrong thing or crashes. node-addon-api helps by throwing C++ exceptions, but you must compile with exceptions enabled. The most common mistake is copy-pasting a snippet with `NAPI_DISABLE_CPP_EXCEPTIONS` while also expecting C++ exception semantics.

> [!PITFALL] Treating .node files as portable binaries
> A `.node` compiled on macOS arm64 will not load on Linux x86_64 (or even macOS x86_64). You need one binary per platform-arch-Node version triple. If your CI doesn't cover all targets, users hit cryptic "invalid ELF header" or "wrong architecture" errors at runtime.

## What you learned

- Native addons are justified for **CPU-bound numeric work** and **wrapping existing C/C++/Rust libraries**.
- **Node-API** provides a **stable C ABI** — compile once, run across all future Node versions without recompilation.
- **node-addon-api** wraps N-API in a C++ comfort layer with RAII handles and exception mapping.
- **node-gyp** reads `binding.gyp`, generates platform build files, and compiles the `.node` binary.
- **napi-rs** offers idiomatic Rust bindings with the same N-API stability guarantee and is the modern default for new native addons.
- Distribute pre-built binaries with **prebuild** to avoid forcing users to compile from source.

## Next steps

Now that you understand native addons, the next lesson explores **WebAssembly and WASI** in Node — a portable, sandboxed alternative that avoids the build-system complexity while still escaping JavaScript's performance envelope.
*/});
