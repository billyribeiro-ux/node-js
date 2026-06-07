registerLessonSrc("41-jit-pipeline-deep", function () {/*
---
id: 41-jit-pipeline-deep
title: "Inside TurboFan: IR, Sea of Nodes & Speculation"
minutes: 28
level: advanced
objectives:
  - Trace the complete V8 tiering pipeline from Ignition bytecode through TurboFan
  - Understand Sea-of-Nodes IR, speculative compilation, and feedback vectors
  - Use --trace-opt, --print-opt-code, --trace-turbo, and %-natives to observe and drive JIT behaviour
---

# Inside TurboFan: IR, Sea of Nodes & Speculation

## Why this matters

The difference between a Node.js service doing 50k req/s and 200k req/s on identical hardware is
almost always JIT quality. Understanding V8's tiering pipeline — what triggers each tier, what can
prevent promotion, and how speculation can collapse — lets you write code that stays fast instead of
accidentally pessimising the compiler. This is the mental model every performance-critical Node
engineer needs.

## Learning objectives

- Describe Ignition → Sparkplug → Maglev → TurboFan and when each tier fires.
- Explain Sea-of-Nodes IR: what it is, why V8 chose it, and what it enables.
- Read `--trace-opt` output and understand feedback vector slots.
- Use `%OptimizeFunctionOnNextCall` and `%GetOptimizationStatus` with `--allow-natives-syntax`.
- Diagnose and fix functions that refuse to tier up or get deoptimised.

## The V8 tiering pipeline

V8 compiles JavaScript through four progressively more aggressive compilers. Each tier trades
compilation latency for peak throughput.

```
Source JS
   │
   ▼ Parser → AST → Bytecode compiler
┌──────────┐
│ Ignition │  interpreter; walks Ignition bytecode;
│          │  ~1 ns per bytecode dispatch overhead;
│          │  collects type-feedback into FeedbackVector slots.
└──────────┘
   │  call-count threshold (~1–2 invocations) for Sparkplug
   ▼
┌───────────────┐
│  Sparkplug    │  baseline non-optimising JIT (added V8 9.1 / Node 18);
│               │  compiles bytecode → native 1:1 with NO IR;
│               │  ~20% faster than interpreted Ignition, zero speculation.
└───────────────┘
   │  invocation-count + OSR threshold for Maglev
   ▼
┌─────────────────┐
│  Maglev         │  mid-tier optimising JIT (V8 11.3 / Node 22);
│                 │  builds a simpler SSA IR from bytecode;
│                 │  does type specialisation from feedback but NOT full
│                 │  TurboFan optimisations (e.g. no full escape analysis);
│                 │  compile time ~5× faster than TurboFan, ~80% peak speed.
└─────────────────┘
   │  hot-function threshold (invocation counter overflows)
   ▼
┌────────────────────────────────────────┐
│  TurboFan (optimising compiler)        │
│  Sea-of-Nodes IR → scheduling → codegen│
│  full speculative optimisation         │
└────────────────────────────────────────┘
```

> [!NOTE] Thresholds are heuristic and environment-dependent
> V8 exposes `--interrupt-budget` (Ignition→Sparkplug) and `--invocation-count-for-turbofan`.
> Under Node 24 the defaults roughly produce: Sparkplug at ~1 invocation, Maglev around
> a few hundred calls, TurboFan around a few thousand for truly hot paths. Actual thresholds
> depend on bytecode size and whether OSR fires mid-loop.

## Sea-of-Nodes IR

TurboFan does **not** use a traditional basic-block CFG. Instead it uses a *Sea of Nodes* (SoN) IR,
pioneered in the Cliff Click / HotSpot C2 compiler paper (1995) and adapted by V8.

In a Sea of Nodes:
- Every operation is a **node** with typed inputs (value edges) and control edges.
- **Value edges** express data flow: `Add(a, b)` depends on `a` and `b`.
- **Control edges** express ordering only when strictly necessary (branches, stores, calls).
- There is no explicit notion of "this instruction is in block X" during optimization; nodes
  float freely and are *scheduled* into blocks only at the very end of the pipeline.

This decoupling enables:
1. **Global value numbering** — duplicate computations anywhere in the graph collapse trivially.
2. **Loop-invariant code motion** — a node with no control dependency on a loop is automatically
   outside it once scheduling runs.
3. **Aggressive inlining** — the callee's SoN subgraph grafts into the caller's graph; value edges
   just cross the former call boundary.

```
Example: (x + 1) * (x + 1)

Traditional CFG IR:          Sea-of-Nodes:
  t1 = x + 1                    Add(x, 1)
  t2 = x + 1                       |
  t3 = t1 * t2         Mul(Add(x,1), Add(x,1)) → GVN folds to Mul(t, t)
```

> [!PRINCIPAL] SoN is powerful but its compile time scales with graph size
> Large functions with many inline callees can explode the node count into the tens of thousands.
> V8 caps inlining depth and imposes node-count budgets to keep compile time bounded. If you see
> `--trace-opt` showing a function being deoptimised with reason "too much inlining" or
> "exceeds max inlined bytecode", that is the budget guard firing. The production lesson: keep
> hot functions small and focused — they inline better and produce smaller graphs.

## Speculative optimisation and feedback vectors

V8's superpower is **speculation**: it compiles based on the types observed at runtime, generating
fast monomorphic code and inserting *deopt guards* at check points.

### FeedbackVector

Every JSFunction gets a **FeedbackVector** — an array of typed *slots* allocated when the function
is first created. Ignition writes into these slots during interpretation:

| Slot kind | What it records |
|-----------|-----------------|
| `CALL` | callee identity (for inlining heuristics) |
| `LOAD_PROPERTY` | map (hidden class) of the receiver + field offset |
| `STORE_PROPERTY` | map of the receiver, field offset |
| `COMPARE_OP` | types seen on both sides |
| `BINARY_OP` | operand types (Int32, Float64, BigInt, …) |
| `LITERAL` | allocation site for object/array literals |

When TurboFan compiles the function it reads this feedback and emits *specialised* code:
- A `LOAD_PROPERTY` slot that has only ever seen Map M42 → emit a direct fixed-offset load
  guarded by a `CheckMap(M42)` node. No property lookup at runtime.
- A `BINARY_OP` slot that has only seen Int32 on both sides → emit a 32-bit integer add.
  A `Smi` overflow check is the only guard.

### On-Stack Replacement (OSR)

A loop that runs for millions of iterations before the enclosing function returns would never
benefit from TurboFan if we only optimized at function entry. **OSR** solves this: V8 detects a
hot backward-branch in the interpreter, pauses loop execution, compiles an OSR entry for that
loop's state (live registers, stack frame), and resumes inside TurboFan-compiled code — all while
the original stack frame is still live.

OSR compilations are more constrained than regular ones because the variable liveness at the loop
header must match the interpreted state exactly.

## Observing the pipeline with flags

```bash
# Show every function optimized (or why it was NOT optimized):
node --trace-opt server.js

# Show why functions were deoptimized:
node --trace-deopt server.js

# Dump the TurboFan graph for a specific function (produces JSON for Turbolizer):
node --trace-turbo --trace-turbo-filter=myHotFn server.js

# Print native code generated by TurboFan:
node --print-opt-code --allow-natives-syntax server.js

# Use natives syntax to drive and query the JIT manually:
node --allow-natives-syntax script.js
```

```js
// With --allow-natives-syntax:
function add(a, b) { return a + b; }

add(1, 2);                          // warm up feedback
add(3, 4);
%OptimizeFunctionOnNextCall(add);   // request TurboFan on next call
add(5, 6);                          // triggers optimization

// Optimization status bits (see v8/src/runtime/runtime-test.cc):
// 2 = always optimized, 4 = never optimized, 16 = maybe deopt'd,
// 32 = TurboFan optimized, 64 = Maglev optimized, 128 = Sparkplug
const status = %GetOptimizationStatus(add);
console.log("status bits:", status.toString(2));
```

> [!OUTPUT]
> status bits: 100000   // 32 = TurboFan optimized

```bash
# --trace-opt output sample (abbreviated):
[marking 0x... <JSFunction add> for optimization, reason: hot and stable]
[compiling method 0x... <JSFunction add> using TurboFan]
[optimized 0x... <JSFunction add> (time 0.12ms), context: 0x...]
```

> [!PRINCIPAL] %GetOptimizationStatus is your prod-perf microscope
> In a development build (or Node with --allow-natives-syntax) you can write micro-benchmarks
> that ASSERT the JIT tier of a function before measuring. If `status & 32` is zero, your
> function never went TurboFan and your benchmark is measuring the wrong thing. Use this to
> catch regressions early — a type-polymorphic argument added by a seemingly unrelated PR can
> silently drop a hot path from TurboFan to Maglev and cost 2–3× throughput.

## Try it yourself

The runnable block below implements a **tier-up simulator** that models V8's call-count
promotion logic and a **FeedbackVector** that tracks operand types. Watch how the simulated JIT
decides to promote a function and what happens to "throughput" at each tier.

```js run
// V8 tiering simulator with feedback-vector model
// Tiers: 0=Ignition, 1=Sparkplug, 2=Maglev, 3=TurboFan

const TIER_THRESHOLDS = [0, 1, 200, 2000]; // calls to reach each tier
const TIER_NAMES      = ["Ignition", "Sparkplug", "Maglev", "TurboFan"];
// Relative throughput multiplier at each tier (vs Ignition baseline)
const TIER_THROUGHPUT = [1, 1.4, 6, 18];

function createFeedbackVector(slots) {
  // Each slot tracks: observed types as a Set, IC state
  return Array.from({ length: slots }, () => ({
    types: new Set(),
    state: "uninitialized", // -> premonomorphic -> monomorphic -> polymorphic -> megamorphic
  }));
}

function updateFeedback(slot, type) {
  slot.types.add(type);
  const n = slot.types.size;
  if      (n === 0) slot.state = "uninitialized";
  else if (n === 1 && slot.state === "uninitialized") slot.state = "premonomorphic";
  else if (n === 1) slot.state = "monomorphic";
  else if (n <= 4)  slot.state = "polymorphic";
  else              slot.state = "megamorphic";
}

function createFunction(name, numFeedbackSlots) {
  return {
    name,
    callCount: 0,
    tier: 0,
    feedbackVector: createFeedbackVector(numFeedbackSlots),
    deoptCount: 0,
  };
}

function call(fn, argTypes) {
  fn.callCount++;
  // Update feedback slots
  argTypes.forEach((t, i) => {
    if (i < fn.feedbackVector.length) updateFeedback(fn.feedbackVector[i], t);
  });
  // Check for megamorphic demotion (can't optimize well)
  const megamorphic = fn.feedbackVector.some(s => s.state === "megamorphic");
  // Promote tier based on call count
  let newTier = 0;
  for (let t = TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (fn.callCount >= TIER_THRESHOLDS[t]) { newTier = t; break; }
  }
  if (megamorphic && newTier > 1) newTier = 1; // megamorphic → Sparkplug ceiling
  if (newTier > fn.tier) {
    console.log(`[tier-up] ${fn.name}: ${TIER_NAMES[fn.tier]} → ${TIER_NAMES[newTier]} at call #${fn.callCount}`);
  }
  fn.tier = newTier;
}

function throughput(fn) {
  return TIER_THROUGHPUT[fn.tier].toFixed(1) + "x";
}

// --- Demo ---
const add = createFunction("add", 2); // 2 feedback slots: arg0 type, arg1 type

// Phase 1: monomorphic (always Int32)
console.log("--- Phase 1: monomorphic Int32 calls ---");
for (let i = 0; i < 2200; i++) call(add, ["Int32", "Int32"]);
console.log(`After ${add.callCount} calls: tier=${TIER_NAMES[add.tier]}, throughput=${throughput(add)}`);
console.log(`Feedback: slot0=${add.feedbackVector[0].state}, slot1=${add.feedbackVector[1].state}`);

// Phase 2: introduce a Float64 — feedback changes but monomorphic per-slot
console.log("\n--- Phase 2: mixed Int32 + Float64 on slot0 ---");
for (let i = 0; i < 5; i++) call(add, ["Float64", "Int32"]);
console.log(`Feedback: slot0=${add.feedbackVector[0].state}`);

// Phase 3: go megamorphic — many types on slot0
console.log("\n--- Phase 3: megamorphic ---");
["String", "BigInt", "Boolean", "Object", "Undefined"].forEach(t => call(add, [t, "Int32"]));
console.log(`Feedback: slot0=${add.feedbackVector[0].state}`);
console.log(`After megamorphic: tier=${TIER_NAMES[add.tier]}, throughput=${throughput(add)}`);
```

## Exercise: OSR entry simulator

Model on-stack replacement. A function runs a tight loop. After the loop's backward-branch
counter crosses a threshold, OSR fires and the loop continues in the higher tier.

<details>
<summary>Show solution</summary>

```js run
// OSR simulator: loop that promotes mid-execution
const OSR_THRESHOLD = 500;
const TIER_NAMES = ["Ignition", "Sparkplug", "Maglev", "TurboFan"];

function simulateLoop(iterations) {
  let tier = 0;
  let backwardBranchCount = 0;
  let sum = 0;
  const osrLog = [];

  for (let i = 0; i < iterations; i++) {
    sum += i;
    backwardBranchCount++;

    // OSR check: V8 checks interrupt budget on backward branches
    if (backwardBranchCount === OSR_THRESHOLD && tier < 2) {
      tier = 2; // promote to Maglev via OSR
      osrLog.push(`OSR at iteration ${i}: promoted to ${TIER_NAMES[tier]}`);
    }
    if (backwardBranchCount === OSR_THRESHOLD * 4 && tier < 3) {
      tier = 3; // TurboFan OSR for very hot loops
      osrLog.push(`OSR at iteration ${i}: promoted to ${TIER_NAMES[tier]}`);
    }
  }
  return { sum, tier, osrLog };
}

const result = simulateLoop(3000);
result.osrLog.forEach(msg => console.log("[osr]", msg));
console.log(`Final tier: ${TIER_NAMES[result.tier]}`);
console.log(`Sum: ${result.sum}`);
console.log("Loop completed in higher tier — no restart needed (OSR replaces stack frame in place)");
```

</details>

## Common pitfalls

> [!PITFALL] Calling a function with different argument types across call sites prevents TurboFan
> If `processItem(item)` is called from ten places and each passes a differently-shaped object,
> the feedback vector slot for `item`'s map goes megamorphic. TurboFan bails out and the function
> runs in Sparkplug forever. The fix is to normalise the input shape: one hidden class, one path.
> Use `--trace-opt` and look for "does not match inlining blacklist" or "polymorphic" annotations.
> Also: avoid mixing `null` / `undefined` into type-sensitive hot paths — they pollute the type
> feedback even with a guard (`if (x == null) return`) because Ignition records feedback BEFORE
> the guard is evaluated.

## What you learned

- V8 has four tiers: **Ignition** (interpreter) → **Sparkplug** (baseline JIT) → **Maglev**
  (mid-tier SSA) → **TurboFan** (Sea-of-Nodes, full speculation).
- **FeedbackVector slots** drive all speculation: Ignition fills them; TurboFan reads them.
- **Sea of Nodes** IR keeps values and control separate, enabling global GVN and LICM without
  explicit CFG manipulation.
- **OSR** allows a loop to be promoted to a higher tier mid-execution without restarting.
- `--trace-opt`, `--trace-turbo`, `--allow-natives-syntax`, `%OptimizeFunctionOnNextCall`,
  and `%GetOptimizationStatus` are your diagnostic toolkit.

## Next steps

Now that you understand how V8 optimises, the next lesson covers what causes it to *undo* that
work — deoptimisation — how to read `--trace-deopt` output, and how to eliminate deopts in
production hot paths.
*/});
