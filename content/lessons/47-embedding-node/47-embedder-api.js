registerLessonSrc("47-embedder-api", function () {/*
---
id: 47-embedder-api
title: "Embedding Node & the Node-API Embedder Interface"
minutes: 27
level: advanced
objectives:
  - Understand the Node embedder API surface (node::Start, Environment, MultiIsolatePlatform) and the lifecycle of an embedded runtime
  - Reason about the tradeoffs of multiple Environments vs multiple Isolates vs multiple processes
  - Model worker/isolate isolation in pure JavaScript and map that model to the real C++ API
---

# Embedding Node & the Node-API Embedder Interface

## Why this matters

Electron, VSCode, Adobe's scripting host, Figma's plugin runtime, and dozens of commercial products run the Node.js runtime *inside* their own C++ application — not as a subprocess, but as an embedded library. When you embed Node you control exactly which APIs the guest JavaScript can reach, how many isolated JS environments coexist in one process, and how the event loop interleaves with your native event loop. This is the highest-leverage lever for building secure, multi-tenant JS runtimes.

## Learning objectives

- Trace the lifecycle of an embedded Node runtime from `node::InitializeOncePerProcess` through `node::LoadEnvironment` to `node::SpinEventLoop`.
- Distinguish between a V8 `Isolate`, a Node `Environment`, and a `Worker` — and when you want each.
- Implement a safe multi-environment manager that runs isolated JS "scripts" with scoped globals.

## The embedding architecture

Embedding Node means linking against `libnode` (the shared library form of the runtime) and calling into its public C++ API. The public surface lives in `<node/node.h>`, `<node/node_api.h>`, and `<node/uv.h>`.

```cpp
// Minimal embedder skeleton — read-only, C++17
#include <node/node.h>
#include <node/uv.h>
#include <cassert>

int main(int argc, char** argv) {
  // 1. One-time initialisation: parse CLI args, set up OpenSSL, V8 platform
  auto init_result = node::InitializeOncePerProcess(
    { argv, argv + argc },
    {
      node::ProcessInitializationFlags::kNoInitializeV8,
      node::ProcessInitializationFlags::kNoInitializeNodeV8Platform,
    }
  );
  assert(init_result->early_return() == false);

  // 2. Create the V8 platform (thread pool, task runners)
  auto platform = node::MultiIsolatePlatform::Create(4); // 4 worker threads
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();

  // 3. Per-Environment setup
  std::vector<std::string> errors;
  auto setup = node::CommonEnvironmentSetup::Create(
    platform.get(), &errors, init_result->args(), init_result->exec_args()
  );

  {
    v8::Locker locker(setup->isolate());
    v8::Isolate::Scope isolate_scope(setup->isolate());
    v8::HandleScope handle_scope(setup->isolate());
    v8::Context::Scope context_scope(setup->context());

    // 4. Load and run JavaScript
    node::LoadEnvironment(setup->env(),
      "const { createRequire } = require('node:module');"
      "// your bootstrap JS here"
    );

    // 5. Run the event loop until it drains
    node::SpinEventLoop(setup->env()).ToChecked();
  }

  // 6. Teardown
  node::TearDownEnvironment(setup->env());
  node::TearDownOncePerProcess();
  return 0;
}
```

> [!OUTPUT]
> (no output — skeleton only; the bootstrap JS would produce output)

### Key types and their responsibilities

| Type | V8/Node layer | Isolation | Shares |
|------|--------------|-----------|--------|
| `v8::Isolate` | V8 | Full JS heap isolation | Nothing with other Isolates |
| `v8::Context` | V8 | Separate global object | Heap with its Isolate |
| `node::Environment` | Node | Node globals, module registry | Isolate heap |
| `node::Worker` | Node | Separate Environment + Isolate | Process, file descriptors |

One `Isolate` per thread is the invariant V8 enforces. You **cannot** run JS from two threads on the same Isolate concurrently — you must use a `v8::Locker`. Multiple `Environment`s on one `Isolate` is unusual and requires careful lifecycle management; multiple `Isolate`s with one-per-thread is the standard approach for parallelism.

> [!PRINCIPAL]
> The critical invariant: V8 is **not thread-safe**. Every access to an `Isolate` must happen on the thread that "owns" it, gated by a `v8::Locker` (if multiple threads may contend). `node::Worker` (the runtime backing `worker_threads`) creates its own `Isolate` on its own libuv thread, which is why workers achieve true parallelism. When embedding, if you want multiple concurrent JS environments, model after `worker_threads`: one Isolate per OS thread, message-passing between them via `uv_async_t` or similar. Shared memory via `SharedArrayBuffer` is the only zero-copy data path between Isolates.

## The `node::MultiIsolatePlatform` and task scheduling

`MultiIsolatePlatform` owns the V8 background thread pool — the threads that V8 uses for garbage collection (concurrent marking, sweeping), Maglev/TurboFan background compilation, and Wasm compilation. It is shared across all `Isolate`s in the process. In a typical embedded setup:

- 4–8 background threads is reasonable for a desktop application.
- Too few threads starves background GC, increasing main-thread pause time.
- `uv_loop_t` (one per Environment) drives the I/O event loop; embedders can pump it manually with `uv_run(loop, UV_RUN_NOWAIT)` to interleave with their own native event loop.

```cpp
// Interleaving the Node event loop with a native game loop — read-only
while (app_running) {
  // Pump Node's event loop once without blocking
  uv_run(setup->event_loop(), UV_RUN_NOWAIT);
  // Do native rendering, input, etc.
  render_frame();
  poll_input();
}
```

> [!OUTPUT]
> (no output — structural example)

## Exposing APIs to embedded JavaScript

The whole point of embedding is controlling what the guest JS *can* reach. You do this by populating the `v8::Context`'s global object before calling `LoadEnvironment`:

```cpp
// Add a custom global function "hostLog" accessible from JS — read-only
v8::Local<v8::Context> ctx = setup->context();
v8::Local<v8::Object> global = ctx->Global();

auto host_log = [](const v8::FunctionCallbackInfo<v8::Value>& info) {
  v8::String::Utf8Value msg(info.GetIsolate(), info[0]);
  fprintf(stderr, "[HOST] %s\n", *msg);
};

global->Set(ctx,
  v8::String::NewFromUtf8Literal(setup->isolate(), "hostLog"),
  v8::Function::New(ctx, host_log).ToLocalChecked()
).Check();
```

> [!OUTPUT]
> (no output — the JS would call hostLog("hello") and print [HOST] hello)

For more complex APIs, **N-API** (the ABI-stable C layer) is safer than raw V8 handles. N-API objects survive across minor V8 upgrades because they go through a compatibility shim:

```c
// N-API version of the same — read-only
napi_value host_log_napi(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  char buf[256];
  size_t len;
  napi_get_value_string_utf8(env, args[0], buf, sizeof(buf), &len);
  fprintf(stderr, "[HOST] %s\n", buf);
  return NULL; // undefined
}
```

## Versus `child_process` — when to embed vs spawn

| Factor | Embed (`libnode`) | Spawn (`child_process`) |
|--------|-------------------|------------------------|
| Latency to call JS | ~microseconds (function call) | ~1-10 ms (IPC round-trip) |
| Memory | Shared heap — no copy | Separate process — no sharing |
| Isolation | Isolate-level (crashes can corrupt host) | Process-level (crash contained) |
| Security | You control the API surface exactly | Process boundary, OS enforces |
| Complexity | High — must manage V8 lifecycle | Low — just spawn a process |
| Use case | Plugin host, scripting, tight integration | Untrusted code, heavy isolation |

> [!PRINCIPAL]
> In practice, embedding is the right choice only when you need sub-millisecond call latency or must share binary data (e.g., large `ArrayBuffer`s) without copying. For most "run user scripts safely" scenarios, a child process with a permission-constrained Node (`--allow-fs-read=/safe/path --allow-net=off`) is far simpler and meaningfully safer. The permission model introduced in Node 20 (stable in Node 22+) makes the subprocess approach viable even for moderately complex API surfaces. Reserve embedding for plugin runtimes that are already deeply integrated into a host binary (e.g., a game engine, a creative tool, a database server with a JS scripting layer).

## Try it yourself

The runnable block below models a multi-environment manager in pure JavaScript. Each "environment" has its own global scope and module registry. This is the conceptual heart of what the embedder API does in C++.

```js run
// Isolate/Environment manager simulator
// Models: multiple isolated JS contexts with scoped globals and a message bus

class FakeIsolate {
  constructor(id) {
    this.id = id;
    this.heap = new Map(); // shared within isolate
    this.contexts = [];
  }
  createContext(globals = {}) {
    const ctx = new FakeContext(this, globals);
    this.contexts.push(ctx);
    return ctx;
  }
}

class FakeContext {
  constructor(isolate, globals) {
    this.isolate = isolate;
    this.global = { ...globals };
    this.moduleRegistry = new Map();
  }
  defineModule(name, factory) {
    this.moduleRegistry.set(name, factory(this.global));
  }
  run(code) {
    // Simulate running code in this context by calling a provided function
    return code(this.global, (name) => this.moduleRegistry.get(name));
  }
}

class EnvironmentManager {
  constructor() {
    this.isolates = new Map();
    this.messageQueue = [];
  }
  createIsolate(id) {
    const iso = new FakeIsolate(id);
    this.isolates.set(id, iso);
    return iso;
  }
  postMessage(fromIso, toIso, msg) {
    // Only SharedArrayBuffer-like data crosses isolate boundaries
    // Here we simulate by JSON-cloning (structured clone)
    this.messageQueue.push({ from: fromIso, to: toIso, data: JSON.parse(JSON.stringify(msg)) });
  }
  drainMessages() {
    const q = this.messageQueue.splice(0);
    q.forEach(({ from, to, data }) =>
      console.log(`[MSG] ${from} -> ${to}:`, JSON.stringify(data))
    );
  }
}

// Demo: two isolated environments
const mgr = new EnvironmentManager();

const isoA = mgr.createIsolate("worker-A");
const ctxA = isoA.createContext({ hostLog: (m) => console.log("[A]", m) });
ctxA.defineModule("config", (g) => ({ maxRetries: 3, region: "us-east-1" }));

const isoB = mgr.createIsolate("worker-B");
const ctxB = isoB.createContext({ hostLog: (m) => console.log("[B]", m) });
ctxB.defineModule("config", (g) => ({ maxRetries: 5, region: "eu-west-1" }));

// Run "scripts" in each isolated context
ctxA.run((globals, require) => {
  const cfg = require("config");
  globals.hostLog("region=" + cfg.region + " retries=" + cfg.maxRetries);
});

ctxB.run((globals, require) => {
  const cfg = require("config");
  globals.hostLog("region=" + cfg.region + " retries=" + cfg.maxRetries);
});

// Cross-isolate messaging (structured clone)
mgr.postMessage("worker-A", "worker-B", { type: "task_done", taskId: 42, result: "ok" });
mgr.drainMessages();

// Verify isolation: mutating A's global doesn't affect B
ctxA.global.sharedState = "A-local";
console.log("B sees A's sharedState?", ctxB.global.sharedState === undefined ? "no (isolated)" : "yes (LEAK!)");
```

## Exercise

**Challenge:** Extend the environment manager to enforce a capability list per context — e.g., `["fs", "net"]`. If a context tries to `require()` a module not in its capability list, throw a `PermissionDeniedError`. Demonstrate that two contexts with different capability lists cannot access each other's modules.

<details>
<summary>Show solution</summary>

```js run
class SecureContext {
  constructor(id, allowedCaps) {
    this.id = id;
    this.caps = new Set(allowedCaps);
    this.modules = new Map();
    this.global = {
      log: (m) => console.log(`[${id}]`, m),
    };
  }
  register(name, impl) { this.modules.set(name, impl); }
  require(name) {
    if (!this.caps.has(name)) throw new Error(`PermissionDenied: ${this.id} cannot access '${name}'`);
    if (!this.modules.has(name)) throw new Error(`ModuleNotFound: ${name}`);
    return this.modules.get(name);
  }
}

// Shared module registry (host-provided, not shared between contexts without cap check)
const hostModules = {
  fs: { readFile: (p) => `contents-of-${p}` },
  net: { fetch: (u) => `response-from-${u}` },
  crypto: { hash: (s) => s.split("").reverse().join("") },
};

function createEnv(id, caps) {
  const ctx = new SecureContext(id, caps);
  for (const [name, impl] of Object.entries(hostModules)) ctx.register(name, impl);
  return ctx;
}

const envA = createEnv("plugin-A", ["fs", "crypto"]);
const envB = createEnv("plugin-B", ["net"]);

// A can use fs
const fsA = envA.require("fs");
envA.global.log(fsA.readFile("/data/report.csv"));

// A cannot use net
try { envA.require("net"); }
catch (e) { envA.global.log("BLOCKED: " + e.message); }

// B can use net
const netB = envB.require("net");
envB.global.log(netB.fetch("https://api.example.com/data"));

// B cannot use fs
try { envB.require("fs"); }
catch (e) { envB.global.log("BLOCKED: " + e.message); }
```

</details>

## Common pitfalls

> [!PITFALL]
> **Accessing an `Isolate` from the wrong thread without a `Locker`.** In C++ embedding this is undefined behaviour and manifests as sporadic crashes under load. In the JS model above, the equivalent is sharing mutable state between workers without `SharedArrayBuffer`/`Atomics`. Always treat each context as single-threaded and use explicit message passing for cross-context communication.

A second classic mistake: **forgetting to drain the event loop before teardown**. If you call `node::TearDownEnvironment` while pending libuv handles (timers, I/O watchers) are still active, you leak file descriptors and get EBADF or use-after-free in the next allocator run. Always call `uv_loop_close` after `uv_run(loop, UV_RUN_DEFAULT)` reaches zero handles.

## What you learned

- The Node embedder API lifecycle: `InitializeOncePerProcess` → `MultiIsolatePlatform::Create` → `CommonEnvironmentSetup::Create` → `LoadEnvironment` → `SpinEventLoop` → teardown.
- An `Isolate` owns the heap; a `Context` owns the global scope; an `Environment` owns Node's module registry and event loop handles — these are composable primitives.
- Multiple `Isolate`s (one per thread) is the safe path for concurrency; multiple `Context`s on one `Isolate` share a heap and require careful synchronisation.
- The embedder API is the right choice when you need microsecond-latency calls to JS or must share large binary buffers zero-copy; for untrusted code, the Node permission model + subprocess is safer.
- N-API is more ABI-stable than raw V8 handles and should be preferred for any API that must survive Node major version upgrades.

## Next steps

You can build a custom Node and embed it in a host application. The next lesson closes the loop: once your embedded or standard runtime is running, how do you instrument *every* module import at scale using custom ESM loaders and the `module.register()` API?
*/});
