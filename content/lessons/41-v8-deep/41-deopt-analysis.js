registerLessonSrc("41-deopt-analysis", function () {/*
---
id: 41-deopt-analysis
title: "Deoptimization: Reading --trace-deopt & %-natives"
minutes: 27
level: advanced
objectives:
  - Understand every major deopt trigger and its bailout reason in V8
  - Distinguish eager, lazy, and soft deoptimization and their cost profiles
  - Read --trace-deopt output and map it back to source to eliminate production regressions
---

# Deoptimization: Reading --trace-deopt & %-natives

## Why this matters

Deoptimization is the hidden tax that silently turns your 200k req/s service into a 60k req/s
service after a seemingly unrelated code change. V8 emits no error, no warning — throughput just
drops. Engineers who can't read `--trace-deopt` output are flying blind. This lesson teaches you
to intercept deopts before they reach production, quantify their cost, and eliminate them for good.

## Learning objectives

- Describe the three deopt kinds (eager, lazy, soft) and their performance signatures.
- Name the top bailout reasons and the code patterns that cause them.
- Read and interpret real `--trace-deopt` log lines.
- Use `%GetOptimizationStatus` and `%DeoptimizeFunction` to write deopt-aware micro-benchmarks.
- Apply systematic fixes: shape normalisation, type narrowing, deopt-free try/catch patterns.

## What is deoptimization?

When TurboFan compiles a function speculatively it emits *deopt guards* — runtime checks that
verify the assumptions made during compilation are still valid. If a guard fails, V8:

1. Walks the TurboFan stack frame backward to reconstruct the *interpreted* frame state.
2. Resumes execution in Ignition at the exact bytecode offset where the check failed.
3. Marks the optimized code as invalid and eventually recompiles (or gives up).

The cost is not just one slow call. The frame reconstruction itself takes microseconds, and the
function now runs interpreted until it re-accumulates enough profiling data to be re-optimized —
which may or may not succeed depending on whether the bad feedback that caused the deopt is
still present.

## Three deopt kinds

### Eager deopt

The guard fails at a *specific instruction*. Execution stops there and transfers to the
interpreter. These are the most common and most diagnosable — `--trace-deopt` pinpoints the
instruction and gives a bailout reason.

Examples: `CheckMap` fails (object shape changed), `CheckSmi` fails (number overflowed into
heap number), `CheckBounds` fails (array out of bounds with -no-turbo-bounds-checks disabled).

### Lazy deopt

The deopt is not at the call site of the guard itself but is deferred until the function *returns*
control to its caller. This happens when a callee's optimized code is invalidated while the
caller is still on the stack. The next time the caller attempts to return, or enter a deopt
checkpoint, it gets patched out. Lazy deopts are harder to trace — the log entry timestamp can
appear well after the triggering event.

### Soft deopt

V8 marks the code for future deoptimization but does not immediately bail out. This is used
when a global assumption is invalidated (e.g., a prototype chain is modified, a
`Array.prototype.push` is patched), rather than a per-instance guard. The current call
completes; the next call to the function will be interpreted.

> [!PRINCIPAL] Soft deopts from prototype mutation are global — they invalidate ALL callers
> If user code writes `Array.prototype.myMethod = fn`, V8 must soft-deopt every function
> that ever passed through an array property check, across the entire heap. This is why
> prototype mutation in application code is catastrophic at scale: it is an O(heap) pause
> disguised as an assignment. Libraries that patch builtins (older polyfills, some test
> frameworks) are the most common culprit in production.

## Top bailout reasons in practice

| Bailout reason | Root cause | Fix |
|---|---|---|
| `wrong map` | Object shape changed after speculation | Normalize object shapes; use one constructor |
| `not a Smi` | Int overflowed to HeapNumber | Use `Math.imul` or typed arrays for int math |
| `insufficient type feedback` | Too few calls before optimization | Pre-warm critical paths in tests |
| `wrong number of arguments` | `arguments` object or rest spread mismatch | Use explicit parameters |
| `not a heap object` | `null` / `undefined` where object expected | Guard at function boundary |
| `division by zero` | Int division; Float64 division is fine | Check divisor |
| `out of bounds` | Array read beyond `length` | Stay within bounds; avoid sparse arrays |
| `deopt loop detected` | Function deopt'd > N times; V8 gives up | Fix the type instability |

## Reading --trace-deopt output

```bash
node --trace-deopt --allow-natives-syntax deopt_demo.js
```

```js
// deopt_demo.js
function processItem(item) {
  return item.x + item.y;
}

// Warm up with one shape
const a = { x: 1, y: 2 };
for (let i = 0; i < 5000; i++) processItem(a);

// Introduce a different shape — triggers deopt
processItem({ x: 1, y: 2, z: 3 }); // extra property = different map
```

> [!OUTPUT]
> [deoptimize (DEOPT eager): begin. deoptimizing 0x... <JSFunction processItem>]
>   ;;; deoptimize at <deopt_demo.js:2:14>, wrong map
>   reading input frame processItem => bytecode offset: 5, ...
> [deoptimize (DEOPT eager): end]

Each log line tells you:
- **DEOPT kind**: `eager`, `lazy`, or `soft`.
- **Function**: the JSFunction that was deoptimized.
- **Source location**: file, line, column — maps directly to your source.
- **Reason**: `wrong map`, `not a Smi`, etc.
- **Bytecode offset**: which bytecode instruction triggered the guard.

```bash
# With --trace-deopt-verbose you also get the full frame state reconstruction:
node --trace-deopt --trace-deopt-verbose server.js 2>&1 | grep "DEOPT" | head -40
```

> [!NOTE] Redirect stderr — V8 diagnostic flags write to stderr, not stdout
> `node --trace-deopt app.js 2>deopt.log` captures cleanly. In production containers,
> redirect before load testing; the volume at high req/s can be overwhelming — filter
> with `grep "DEOPT eager"` to focus on the most expensive class first.

## Using %-natives to drive and measure deopts

```js
// Run with: node --allow-natives-syntax deopt_natives.js
function add(a, b) { return a + b; }

// 1. Warm up monomorphically
add(1, 2); add(3, 4);

// 2. Force TurboFan
%OptimizeFunctionOnNextCall(add);
add(5, 6);

// 3. Verify it is TurboFan-compiled (status bit 32)
const statusBefore = %GetOptimizationStatus(add);
console.log("TurboFan:", Boolean(statusBefore & 32)); // true

// 4. Force a deopt by injecting a bad type
add("hello", "world"); // string feedback invalidates Int32 speculation

// 5. Check status again — bit 16 = deoptimized/marked for lazy deopt
const statusAfter = %GetOptimizationStatus(add);
console.log("Deoptimized:", Boolean(statusAfter & 16)); // true

// 6. Explicitly deoptimize for testing purposes:
%OptimizeFunctionOnNextCall(add);
add(1, 2); // re-optimize
%DeoptimizeFunction(add); // force deopt programmatically
console.log("After forced deopt, TurboFan:", Boolean(%GetOptimizationStatus(add) & 32)); // false
```

> [!OUTPUT]
> TurboFan: true
> Deoptimized: true
> After forced deopt, TurboFan: false

> [!PRINCIPAL] Build deopt assertions into your benchmark harness
> The correct way to benchmark a hot path is: (1) warm up, (2) force TurboFan via
> `%OptimizeFunctionOnNextCall`, (3) assert `status & 32` before timing, (4) assert
> `!(status & 16)` after timing. Without these assertions, you may be benchmarking
> interpreted code and report a false regression — or miss a real one because the function
> was deoptimized before the timed loop started. This three-step pattern is what the V8
> team itself uses in its internal test suite.

## Try it yourself

The runnable block implements a **deopt-trigger simulator**: a call site that starts
monomorphic, transitions through polymorphic, and reaches megamorphic — measuring the
simulated "throughput" cost at each IC state.

```js run
// Deopt-cost model: monomorphic -> polymorphic -> megamorphic
// Models how IC state degradation affects throughput for a property-access hot path.

const IC_STATES = ["uninitialized", "premonomorphic", "monomorphic", "polymorphic", "megamorphic"];
// Relative cost multiplier per call at each IC state (1.0 = monomorphic baseline)
const IC_COST   = [10.0, 2.0, 1.0, 2.5, 8.0];

function createCallSite(name) {
  return { name, seenMaps: new Set(), state: 0, totalCost: 0, callCount: 0 };
}

function recordCall(site, mapId) {
  site.seenMaps.add(mapId);
  const n = site.seenMaps.size;
  const prevState = site.state;
  if      (n === 0) site.state = 0;
  else if (n === 1 && site.state <= 1) site.state = Math.min(site.state + 1, 2);
  else if (n <= 4)  site.state = 3; // polymorphic
  else              site.state = 4; // megamorphic

  if (site.state !== prevState) {
    console.log(`[IC] ${site.name}: ${IC_STATES[prevState]} -> ${IC_STATES[site.state]} (${n} maps seen)`);
    if (site.state === 4) {
      console.log(`  ** megamorphic: TurboFan will not inline this call site **`);
    }
  }

  site.totalCost += IC_COST[site.state];
  site.callCount++;
}

function avgCost(site) {
  return (site.totalCost / site.callCount).toFixed(2);
}

const processItem = createCallSite("processItem.item.x");

console.log("=== Phase 1: monomorphic (all same shape) ===");
for (let i = 0; i < 2000; i++) recordCall(processItem, "MapA");
console.log(`Average cost: ${avgCost(processItem)}x\n`);

console.log("=== Phase 2: polymorphic (3 shapes) ===");
["MapB", "MapC"].forEach(m => {
  for (let i = 0; i < 200; i++) recordCall(processItem, m);
});
console.log(`Average cost: ${avgCost(processItem)}x\n`);

console.log("=== Phase 3: megamorphic (6+ shapes) ===");
["MapD", "MapE", "MapF", "MapG"].forEach(m => recordCall(processItem, m));
// Simulate 1000 more calls in megamorphic state
for (let i = 0; i < 1000; i++) recordCall(processItem, ["MapA","MapB","MapC","MapD","MapE","MapF","MapG"][i % 7]);
console.log(`\nFinal average cost: ${avgCost(processItem)}x`);
console.log(`Total calls: ${processItem.callCount}`);
console.log(`\nLesson: a megamorphic call site costs ~8x vs monomorphic.`);
console.log(`At 100k req/s this is the difference between 1ms and 8ms per hot path.`);
```

## Exercise: the deopt-loop trap

A function is optimized, then immediately deoptimized on the very next call, and V8 marks it
`never optimize` after a threshold. Write a pure-JS simulation showing how quickly this
"deopt loop" exhausts V8's retry budget.

<details>
<summary>Show solution</summary>

```js run
// Deopt-loop budget simulator
// V8 stops retrying optimization after ~3 deopts for the same function.
const MAX_DEOPT_RETRIES = 3;

function createOptimizedFn(name) {
  return {
    name,
    tier: "interpreted",      // "interpreted" | "optimized" | "neverOptimize"
    deoptCount: 0,
    callCount: 0,
    optimizeRequested: false,
  };
}

function callFn(fn, willDeopt) {
  fn.callCount++;

  if (fn.tier === "neverOptimize") {
    // Runs forever in interpreter — no JIT benefit
    return;
  }

  // Simulate call-count-triggered optimization
  if (fn.callCount === 100 && fn.tier === "interpreted") {
    fn.tier = "optimized";
    console.log(`[opt]   ${fn.name} → TurboFan at call #${fn.callCount}`);
  }

  if (fn.tier === "optimized" && willDeopt) {
    fn.deoptCount++;
    fn.tier = "interpreted";
    console.log(`[deopt] ${fn.name} deopt #${fn.deoptCount} at call #${fn.callCount} (wrong map)`);
    if (fn.deoptCount >= MAX_DEOPT_RETRIES) {
      fn.tier = "neverOptimize";
      console.log(`[bail]  ${fn.name} → NEVER OPTIMIZE (deopt loop detected after ${fn.deoptCount} deopts)`);
    } else {
      // Re-arm for next optimization attempt after more calls
      fn.callCount = 50; // reset counter so it tries again at 100
    }
  }
}

const badFn = createOptimizedFn("polymorphicHotFn");

// Simulate: optimizes, immediately deopts because caller keeps changing argument shapes
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < 120; i++) {
    // Every 110th call is a different shape → instant deopt
    callFn(badFn, i === 110);
  }
  if (badFn.tier === "neverOptimize") break;
}

console.log(`\nFinal state: ${badFn.tier}`);
console.log(`Total calls: ${badFn.callCount}, total deopts: ${badFn.deoptCount}`);
console.log(`\nFix: normalize input shapes so all callers pass the same hidden class.`);
console.log(`Use Object.assign({}, defaults, opts) to merge into one canonical shape.`);
```

</details>

## Common pitfalls

> [!PITFALL] try/catch blocks used to prevent TurboFan — but this changed
> In V8 versions before roughly 2017, a function containing a try/catch block could not be
> optimized by Crankshaft. This was widely documented and led to patterns like "move the hot
> code out of try." TurboFan fully supports try/catch — but old blog posts still circulate.
> Do NOT restructure code around this outdated advice. Verify assumptions with `--trace-opt`
> on your actual Node version; never cargo-cult old JIT lore.

> [!PITFALL] Measuring deopt cost with Date.now() is unreliable
> A single deopt takes microseconds, but the cold re-interpretation phase after may last
> hundreds of milliseconds. `Date.now()` has 1ms resolution. Use `performance.now()` (sub-ms)
> and loop the deopting code thousands of times to get a measurable signal. Better: compare
> P99 latency distributions in a load test before and after the fix, not a micro-benchmark.

## What you learned

- V8 deopts are **eager** (immediate guard fail), **lazy** (deferred on return), or **soft**
  (global assumption invalidated — e.g., prototype mutation).
- `--trace-deopt` gives you file, line, and a bailout reason string; always redirect stderr.
- The IC state sequence `uninitialized → premonomorphic → monomorphic → polymorphic →
  megamorphic` mirrors the feedback vector slot progression and predicts deopt risk.
- `%GetOptimizationStatus(fn) & 16` detects a deoptimized function; `& 32` confirms TurboFan.
- V8 marks a function `never optimize` after ~3 deopt loops — avoid polymorphic hot paths.

## Next steps

Deopts are caused by IC state instability, which is itself driven by hidden classes and the
feedback vector. The next lesson goes deeper into that system: Maps, transition trees,
and how to keep your property accesses in the fast path.
*/});
