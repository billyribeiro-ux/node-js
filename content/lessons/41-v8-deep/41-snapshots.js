registerLessonSrc("41-snapshots", function () {/*
---
id: 41-snapshots
title: "Startup Snapshots, Code Cache & the SEA Blob"
minutes: 30
level: advanced
objectives:
  - Explain V8 startup snapshots, what they serialize, and how they eliminate cold-start overhead
  - Use the v8.startupSnapshot API and --build-snapshot / --snapshot-blob to create custom snapshots
  - Apply vm.Script cachedData for code-cache warm-up and understand how SEA embeds a snapshot
---

# Startup Snapshots, Code Cache & the SEA Blob

## Why this matters

A vanilla `node -e "require('.')"` of a medium-sized Express application can spend 80-200ms
just parsing and compiling JavaScript before running a single line of your code. For serverless
functions, this is your entire cold-start budget. V8 snapshots serialize the heap — including
compiled bytecode, initialized objects, and even partially-JIT-compiled code — into a binary
blob that the engine can restore in microseconds via a `mmap` + pointer-fixup pass. Understanding
this system is the difference between a 200ms cold start and a 5ms cold start.

## Learning objectives

- Describe what a V8 startup snapshot serializes and how deserialization works.
- Use `--build-snapshot` + `--snapshot-blob` to capture and restore a custom heap state.
- Use the `v8.startupSnapshot` API to register serialization/deserialization callbacks.
- Apply `vm.Script` `cachedData` for in-process code caching.
- Understand how SEA (Single Executable Application) embeds a snapshot blob.
- Measure cold-start wins from each technique and know their failure modes.

## V8 startup snapshots: the mechanism

When Node.js itself starts, before any user code runs, V8 loads a binary blob called
`snapshot_blob.bin` that is compiled into the Node binary. This blob was created at build time
by the Node build system: it ran the V8 bootstrapper (`lib/internal/bootstrap/`), initialized
the global scope, created all built-in objects (`Array`, `Object`, `Promise`, …), and then
**serialized the entire heap into a flat binary**.

At runtime, restoring from snapshot is:
1. `mmap` the snapshot blob into memory (zero-copy if on the same machine as build).
2. Allocate V8 heap spaces (new-space, old-space, code-space, etc.).
3. Copy / fixup pointers — a single linear scan adjusting all embedded pointers from
   snapshot-relative to runtime-virtual addresses.
4. Mark the snapshot region as read-only and protect it.

Total time: **under 1 ms** for the standard Node snapshot. Compare this to re-parsing and
re-executing `lib/internal/bootstrap/node.js` from source, which took ~15-40 ms in pre-snapshot
Node versions.

### What the snapshot can and cannot capture

| Serializable | Not serializable |
|---|---|
| Object shapes (Maps, descriptors) | File descriptors, sockets |
| Initialized JS objects and their values | External C++ references |
| Compiled bytecode (Ignition bytecode, NOT JIT code) | Native handles, libuv handles |
| String literals, ArrayBuffer content | Platform-specific addresses |
| Function prototypes, class hierarchies | Closures over native values |

> [!NOTE] JIT-compiled machine code is NOT in the snapshot
> The snapshot stores Ignition bytecode, not TurboFan-generated native code. The JIT must
> re-warm after restore. However, since the bytecode and feedback vectors can be pre-populated,
> the JIT re-warms faster than a cold start. V8's code cache (see below) can supplement this.

## Custom startup snapshots with --build-snapshot

Node 18+ (V8 10.x) exposes the ability to create application-level snapshots.

```bash
# Step 1: Run your app initialization in snapshot build mode
#   The process runs init code, then instead of starting the event loop, serializes the heap.
node --build-snapshot snapshot_builder.js --snapshot-blob app.blob

# Step 2: Start future instances from the snapshot
node --snapshot-blob app.blob entry.js
```

```js
// snapshot_builder.js — runs at build time
const v8 = require("v8");

// Pre-initialize expensive structures
const preBuiltIndex = buildSearchIndex(require("./data/corpus.json")); // 50ms work
const compiledTemplates = preCompileTemplates(require("./templates"));

// Register a deserializer callback — runs when snapshot is restored
v8.startupSnapshot.addDeserializeCallback(() => {
  // Re-attach anything that can't be serialized (file descriptors, etc.)
  global.__index = preBuiltIndex;
  global.__templates = compiledTemplates;
});

// Store data that CAN be serialized directly in the snapshot
v8.startupSnapshot.setDeserializeMainFunction(() => {
  // This function body runs when the snapshot is loaded instead of the normal entry point
  require("./entry.js");
});

function buildSearchIndex(corpus) { return {}; } // implementation omitted
function preCompileTemplates(tmpl) { return {}; } // implementation omitted
```

> [!OUTPUT]
> Snapshot written to: app.blob (size: 4.2 MB)

```bash
# Measure cold-start improvement
time node entry.js              # cold: ~180ms
time node --snapshot-blob app.blob entry.js  # warm: ~12ms
```

> [!PRINCIPAL] Snapshot size vs startup gain: the mmap trade-off
> A snapshot blob is mapped read-only and shared between all Node worker processes on the same
> host. A 10 MB snapshot costs almost nothing per process in physical RAM (shared pages), but
> its pointer-fixup pass is O(number of objects in snapshot). For snapshots above ~20 MB,
> the fixup pass itself can exceed the cold-init cost it was meant to eliminate. Profile with
> `--trace-gc` to see if fixup GC is happening at startup. The sweet spot is typically
> 2-8 MB for application snapshots.

## vm.Script code cache (in-process warm-up)

For finer-grained caching — caching compiled bytecode for a specific script without a full
snapshot — use `vm.Script` with `cachedData`:

```js
const vm = require("node:vm");
const fs = require("node:fs");

const CACHE_FILE = "/tmp/my-script.cache";
const source = fs.readFileSync("./hot-script.js", "utf8");

// First run: compile and save the bytecode cache
let script = new vm.Script(source, { filename: "hot-script.js" });
const cache = script.createCachedData();
fs.writeFileSync(CACHE_FILE, cache);
console.log(`Cached ${cache.byteLength} bytes of bytecode`);

// Subsequent runs: restore from cache (skips parsing + bytecode compilation)
const cachedData = fs.readFileSync(CACHE_FILE);
const cachedScript = new vm.Script(source, {
  filename: "hot-script.js",
  cachedData,          // V8 verifies this matches the source hash
});
if (cachedScript.cachedDataRejected) {
  console.warn("Cache was stale — recompiled from source");
}
cachedScript.runInThisContext();
```

> [!OUTPUT]
> Cached 28432 bytes of bytecode

> [!NOTE] cachedData is invalidated by source changes and V8 version upgrades
> The bytecode format is versioned. A `node` binary upgrade will always reject existing caches.
> Store the Node version alongside the cache key and invalidate on mismatch.

## SEA and snapshots

Node's **Single Executable Application** (SEA, stable since Node 21) embeds your application
into the Node binary. When a snapshot is included in a SEA, the startup sequence is:

```
Node binary startup
  ↓ Load built-in snapshot_blob (embedded at compile time)
  ↓ Initialize V8 heap from built-in snapshot
  ↓ Detect SEA bundle (via injected fuse byte in binary)
  ↓ Read SEA config: { main, blob? }
  ↓ If blob present: restore app-level snapshot from SEA blob section
  ↓ Run deserialized main function (entry point already in heap)
```

```json
// sea-config.json
{
  "main": "dist/bundle.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": true,
  "useCodeCache": true
}
```

```bash
node --experimental-sea-config sea-config.json
# Produces: app.blob
# Then inject into a copied node binary:
cp $(which node) ./myapp
npx postject ./myapp NODE_SEA_BLOB app.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

> [!PRINCIPAL] SEA + snapshot is the correct architecture for edge/serverless deployment
> A SEA with snapshot gives you: (1) single binary — no node_modules to ship, (2) snapshot
> cold-start — 5-15ms instead of 150-200ms, (3) no source exposure — bytecode only.
> The failure mode is that the snapshot is tied to a specific Node binary version; every
> security patch to Node requires rebuilding and redeploying the SEA. Build the snapshot
> creation into your CI pipeline and treat the blob as an artifact alongside your Docker image.
> This is the same pattern V8/Chrome uses for its built-in snapshot — it regenerates on every
> Chromium build.

## Try it yourself

The runnable block implements a **cold-start timing model** that simulates the phases of
Node startup (parse, bytecode compile, snapshot restore, JIT warm-up) and compares total
latency across three configurations: cold, code-cache, and full snapshot.

```js run
// Cold-start latency model
// Simulates startup phases and compares cold / code-cache / snapshot strategies.

const phases = {
  // Phase durations in milliseconds (realistic orders of magnitude for a medium app)
  coldStart: [
    { name: "parse JS source",         ms: 45 },
    { name: "compile to bytecode",     ms: 30 },
    { name: "init global scope",       ms: 12 },
    { name: "require() module graph",  ms: 80 },
    { name: "first-run init code",     ms: 35 },
  ],
  codeCache: [
    { name: "restore bytecode cache",  ms: 8  },  // skip parse+compile
    { name: "init global scope",       ms: 12 },
    { name: "require() module graph",  ms: 80 },
    { name: "first-run init code",     ms: 35 },
  ],
  snapshot: [
    { name: "mmap snapshot blob",      ms: 1  },
    { name: "pointer fixup pass",      ms: 3  },
    { name: "run deserialize callbacks", ms: 2 },
    // require() and init code already serialized into the snapshot
  ],
};

function simulateStartup(name, phaseList) {
  console.log(`\n--- ${name} ---`);
  let total = 0;
  for (const phase of phaseList) {
    // Add ±20% jitter to simulate real variance
    const jitter = phase.ms * (0.8 + Math.random() * 0.4);
    const t = Math.round(jitter * 10) / 10;
    console.log(`  ${phase.name.padEnd(32)} ${t.toFixed(1).padStart(6)} ms`);
    total += t;
  }
  console.log(`  ${"TOTAL".padEnd(32)} ${total.toFixed(1).padStart(6)} ms`);
  return total;
}

const results = {};
results.cold      = simulateStartup("Cold start (no cache)",      phases.coldStart);
results.codeCache = simulateStartup("Code cache (bytecode warm)", phases.codeCache);
results.snapshot  = simulateStartup("Snapshot restore",           phases.snapshot);

console.log("\n=== Summary ===");
console.log(`Cold start:  ${results.cold.toFixed(1)} ms (baseline)`);
console.log(`Code cache:  ${results.codeCache.toFixed(1)} ms  (${(results.cold/results.codeCache).toFixed(1)}x faster)`);
console.log(`Snapshot:    ${results.snapshot.toFixed(1)} ms  (${(results.cold/results.snapshot).toFixed(1)}x faster)`);
console.log("\nAt a serverless scale of 1000 cold starts/minute:");
const costPerMs = 0.000016; // $0.016 / GB-second, 512MB instance
const savingsPerStart = (results.cold - results.snapshot) / 1000; // seconds
const monthlySavings = savingsPerStart * 1000 * 60 * 24 * 30 * costPerMs * 0.512;
console.log(`Snapshot saves ~${(savingsPerStart * 1000).toFixed(0)}ms/start`);
console.log(`Estimated monthly compute savings: $${monthlySavings.toFixed(2)}`);
```

## Exercise: code-cache invalidation detector

Implement a pure-JS model of a code-cache entry that tracks a source hash and a runtime
version. On each "startup", check if the cache is valid, use it, or rebuild and store it.

<details>
<summary>Show solution</summary>

```js run
// Code-cache invalidation detector
// Models the cache validity logic used by vm.Script cachedData

function hashString(str) {
  // Simple djb2 hash for simulation
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return h.toString(16);
}

class CodeCache {
  constructor() {
    this.entries = new Map(); // key -> { sourceHash, nodeVersion, bytecodeSize, hits }
  }

  lookup(key, source, nodeVersion) {
    const entry = this.entries.get(key);
    if (!entry) {
      console.log(`[cache MISS] ${key}: no cache entry`);
      return null;
    }
    const currentHash = hashString(source);
    if (entry.sourceHash !== currentHash) {
      console.log(`[cache MISS] ${key}: source changed (${entry.sourceHash} -> ${currentHash})`);
      this.entries.delete(key);
      return null;
    }
    if (entry.nodeVersion !== nodeVersion) {
      console.log(`[cache MISS] ${key}: Node version changed (${entry.nodeVersion} -> ${nodeVersion})`);
      this.entries.delete(key);
      return null;
    }
    entry.hits++;
    console.log(`[cache HIT ] ${key}: bytecode=${entry.bytecodeSize}B, hits=${entry.hits}`);
    return entry;
  }

  store(key, source, nodeVersion, bytecodeSize) {
    this.entries.set(key, {
      sourceHash: hashString(source),
      nodeVersion,
      bytecodeSize,
      hits: 0,
    });
    console.log(`[cache STORE] ${key}: ${bytecodeSize}B cached`);
  }
}

const cache = new CodeCache();
const NODE_VER = "24.0.0";

// Simulate 5 startup cycles
const sourceV1 = "function add(a,b){return a+b;} module.exports=add;";
const sourceV2 = "function add(a,b){return a+b+0;} module.exports=add;"; // modified

for (let startup = 1; startup <= 5; startup++) {
  console.log(`\n--- Startup #${startup} ---`);
  const source = startup === 3 ? sourceV2 : sourceV1; // source changes on startup 3
  const nodeVer = startup === 5 ? "24.1.0" : NODE_VER; // node upgrades on startup 5

  const hit = cache.lookup("app/lib/math.js", source, nodeVer);
  if (!hit) {
    // "Compile" from source — simulate 30ms work
    const fakeBytecodeSizeBytes = Math.floor(source.length * 12 + Math.random() * 500);
    cache.store("app/lib/math.js", source, nodeVer, fakeBytecodeSizeBytes);
  }
}

console.log("\nTotal cache entries:", cache.entries.size);
for (const [k, v] of cache.entries) {
  console.log(`  ${k}: sourceHash=${v.sourceHash}, node=${v.nodeVersion}, hits=${v.hits}`);
}
```

</details>

## Project

**"Profile a hot path with --trace-opt/--trace-deopt, eliminate the deopts, and ship a custom
startup snapshot — measure each win."**

You are the performance lead for a Node 24 API service. The service starts slowly (180ms cold
start) and a profiler shows 3 hot functions that deoptimize under load. Your task is to:

1. Capture the baseline: run with `--trace-opt --trace-deopt` and collect deopt reasons for
   the three hot functions.
2. Apply targeted fixes (type normalization, shape consistency, removing problematic patterns).
3. Verify the fix: each fixed function must show `status & 32` (TurboFan-compiled) and never
   appear in `--trace-deopt` output under the same load pattern.
4. Build a startup snapshot that pre-initializes the module graph and any expensive setup.
5. Measure each win: baseline → fixed-deopts → code-cache → snapshot, reporting P50/P99
   startup latency and steady-state req/s.
6. Package as a SEA blob with `useSnapshot: true`.

**Acceptance criteria:**

1. A `profiler.js` script that runs with `--allow-natives-syntax` and uses
   `%GetOptimizationStatus` to assert that all three hot functions are TurboFan-compiled
   and zero-deopt after the fix.
2. A `snapshot_builder.js` that uses `v8.startupSnapshot.addDeserializeCallback` and
   `v8.startupSnapshot.setDeserializeMainFunction` correctly, with comments explaining what
   each callback does and why.
3. A `benchmark.js` that measures and compares startup latency (via `performance.now()` or
   `process.hrtime.bigint()`) across cold / code-cache / snapshot in a single run.
4. The three fixed hot functions each have an inline comment referencing the exact bailout
   reason that was eliminated (e.g., `// fix: normalize shape — was "wrong map" deopt`).
5. A `sea-config.json` with `useSnapshot: true` and `useCodeCache: true`.
6. All three startup strategies run end-to-end without error; the snapshot strategy achieves
   at least 10x faster startup than the cold baseline.

**Starter: optimization-tracking harness (pure JS, runnable)**

```js run
// Optimization-tracking harness
// Models the three-phase performance improvement pipeline:
// Phase 1: baseline (deopts present)
// Phase 2: deopts eliminated (monomorphic, TurboFan stable)
// Phase 3: snapshot (pre-initialized heap)

const PHASES = ["baseline", "deopt-fixed", "snapshot"];

// Simulated function profiles (name, deopt count, tier, startup contribution ms)
const functions = [
  { name: "parseRequest",   deopts: 3, tier: "interpreted", startupMs: 18 },
  { name: "validateSchema", deopts: 7, tier: "interpreted", startupMs: 22 },
  { name: "buildResponse",  deopts: 1, tier: "maglev",      startupMs: 14 },
];

const startupBase = 180; // ms cold start before any optimization

function runPhase(phase, fns, baseMs) {
  console.log(`\n=== Phase: ${phase} ===`);
  let totalDeoptMs = 0;
  let totalStartupSaved = 0;
  let jitQualityScore = 0;

  for (const fn of fns) {
    const deoptCostMs = fn.deopts * 0.8; // each deopt costs ~0.8ms amortized
    let tier = fn.tier;
    let deopts = fn.deopts;
    let startupMs = fn.startupMs;

    if (phase === "deopt-fixed") {
      deopts = 0;
      tier = "turbofan";
      deoptCostMs; // already declared, will be 0 below
    }
    if (phase === "snapshot") {
      deopts = 0;
      tier = "turbofan";
      startupMs = 0.1; // near-zero: already in snapshot heap
    }

    const effectiveDeoptCost = phase === "baseline" ? fn.deopts * 0.8 : 0;
    totalDeoptMs += effectiveDeoptCost;
    totalStartupSaved += phase === "snapshot" ? fn.startupMs - 0.1 : 0;

    const tierScore = { interpreted: 1, sparkplug: 2, maglev: 4, turbofan: 8 }[tier] || 1;
    jitQualityScore += tierScore;

    console.log(`  ${fn.name.padEnd(20)} tier=${tier.padEnd(12)} deopts=${String(phase === "baseline" ? fn.deopts : 0).padStart(2)}  cost=${effectiveDeoptCost.toFixed(1)}ms  startupMs=${startupMs.toFixed(1)}`);
  }

  const snapshotBonus = phase === "snapshot" ? totalStartupSaved : 0;
  const totalStartup = Math.max(4, baseMs - totalDeoptMs * 3 - snapshotBonus);
  console.log(`  Deopt overhead: ${totalDeoptMs.toFixed(1)} ms`);
  console.log(`  Startup savings from snapshot: ${snapshotBonus.toFixed(1)} ms`);
  console.log(`  JIT quality score: ${jitQualityScore} / ${fns.length * 8}`);
  console.log(`  --> Effective cold start: ${totalStartup.toFixed(1)} ms`);
  return totalStartup;
}

const results = {};
for (const phase of PHASES) {
  results[phase] = runPhase(phase, functions, startupBase);
}

console.log("\n=== Summary ===");
for (const [phase, ms] of Object.entries(results)) {
  const ratio = (results["baseline"] / ms).toFixed(1);
  console.log(`  ${phase.padEnd(14)}: ${ms.toFixed(1).padStart(6)} ms  (${ratio}x faster than baseline)`);
}
console.log(`\nTarget: snapshot achieves >10x speedup vs baseline.`);
console.log(`Actual: ${(results["baseline"]/results["snapshot"]).toFixed(1)}x`);
```

## Common pitfalls

> [!PITFALL] Serializing live handles into a snapshot crashes the process on restore
> If your snapshot builder code opens a TCP socket, creates a `setTimeout`, or initializes
> a `Worker`, those handles are not serializable. V8 will either silently drop them or crash
> the deserialization with "cannot deserialize external reference." Always use
> `v8.startupSnapshot.addDeserializeCallback` to re-create runtime resources after restore.
> Test your snapshot with `node --snapshot-blob app.blob --check` before shipping.

> [!PITFALL] Code cache built on one OS/arch is invalid on another
> `vm.Script` `cachedData` contains native-pointer-sized data and is architecture-dependent.
> A cache built on arm64 macOS is rejected by x86-64 Linux. If you ship cached data as part
> of your npm package or Docker layer, build it on the same architecture as your runtime.
> Monorepos with mixed dev environments (M-series Macs + x86 CI) are the most common trap.

## What you learned

- V8 **startup snapshots** serialize the heap as a flat binary blob; restoration is
  essentially `mmap` + pointer-fixup, taking under 5ms regardless of snapshot content size.
- `--build-snapshot` and `v8.startupSnapshot` let you pre-initialize your application's
  module graph, warmed objects, and expensive setup into the snapshot.
- `vm.Script` `cachedData` caches compiled bytecode for individual scripts; it is
  invalidated by source changes or Node version upgrades.
- **SEA** with `useSnapshot: true` embeds the snapshot into the binary, combining
  single-file deployment with near-zero cold start.
- The snapshot-to-speedup sweet spot is 2-8 MB; larger blobs pay increasing fixup costs.
- Always test snapshot restore correctness before deploying; serialization failures are
  silent in build mode and catastrophic in production.

## Next steps

You've now traced V8 from raw JavaScript through every JIT tier, through deopt and recovery,
through IC states and hidden classes, and finally through the startup and caching layer. The
next module goes equally deep into the runtime underneath V8: libuv, io_uring, and the actual
mechanics of the event loop.
*/});
