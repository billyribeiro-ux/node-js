registerLessonSrc("41-inline-caches-deep", function () {/*
---
id: 41-inline-caches-deep
title: "Inline Caches, Maps & Feedback Vectors"
minutes: 26
level: advanced
objectives:
  - Explain V8 hidden classes (Maps), property storage, and transition trees
  - Trace IC state transitions from uninitialized through megamorphic
  - Understand feedback vector slots and how TurboFan reads them to specialize code
---

# Inline Caches, Maps & Feedback Vectors

## Why this matters

Every property access in your hot path — `obj.x`, `arr[i]`, `fn(arg)` — goes through an
inline cache. When those caches stay monomorphic, V8 generates direct memory-offset loads that
compile down to a handful of native instructions. When they go megamorphic, V8 falls back to
a hash-table lookup on every access, and your throughput collapses. Understanding the hidden
class system is what separates engineers who write genuinely fast Node code from those who
write accidentally fast code that breaks under load.

## Learning objectives

- Describe hidden classes (Maps) and the transition tree they form.
- Trace an IC slot through its five states and name what triggers each transition.
- Explain how FeedbackVector slots connect Ignition's profiling to TurboFan's specialization.
- Diagnose and fix monomorphism-breaking patterns: property addition order, `delete`, dict mode.

## Hidden classes (Maps)

V8 does not store property names in each object. Instead, every object has a pointer to a
**Map** (V8's internal name for a hidden class) that describes:

- The **set of properties** on the object, their **order**, and their **offset** within the
  object's in-object property storage.
- The **element kind** of the backing store (SMI_ELEMENTS, DOUBLE_ELEMENTS, HOLEY_ELEMENTS, etc.).
- Pointers to the prototype chain.
- A **descriptor array** mapping property names to field indices.

Two objects with the same properties in the same order share the same Map. When you read
`obj.x`, V8 checks the Map, finds the field index for `x` (e.g., field 2), and loads
`obj + offset(2)` directly. No dictionary lookup at runtime.

```
const a = {};      // Map0 (empty)
a.x = 1;          // Map0 → transition("x") → Map1 {x: field 0}
a.y = 2;          // Map1 → transition("y") → Map2 {x: field 0, y: field 1}

const b = {};      // Map0 (same empty map)
b.x = 10;         // Map0 → Map1 (SAME Map1 as a.x — shared!)
b.y = 20;         // Map1 → Map2 (shared)

// a and b share Map2 — identical IC behaviour
```

### Transition trees

Maps form a tree rooted at the empty Map. Each edge is labeled with the property name (and
value representation: Smi, HeapObject, Double) that caused the transition. V8 caches these
transitions so that constructing two identical objects follows the same path and ends up at
the same leaf Map.

```
          Map0 (empty)
         /            \
  +x:Smi               +y:Smi
  Map1{x}               Map3{y}
      |                    |
  +y:Smi               +x:Smi
  Map2{x,y}             Map4{y,x}   ← DIFFERENT map from Map2!
```

> [!PITFALL] Property addition order determines the Map — and must be consistent
> `{ x: 1, y: 2 }` and `{ y: 2, x: 1 }` end up at different leaf Maps even though the
> final property set is identical. A call site that receives both will immediately go
> polymorphic. Always create objects from a single constructor or object literal with a
> fixed property order. The cost of this mistake: a perfectly warm IC goes from 1ns to 8ns
> per access, silently, across the entire call graph of that shape.

### Dictionary mode (slow properties)

When V8 decides it can no longer maintain a Map for an object, it switches the object to
**dictionary mode** (also called *slow mode*): properties are stored in a hash table on a
separate `NameDictionary` heap object. Triggers:

- More than ~1023 fast properties (configurable, heap-layout dependent).
- Use of `delete` on a property that is not the last property added.
- Assigning a property to an object that has been accessed via `Object.keys()` under certain
  conditions.
- Calling `Object.defineProperty` with non-trivial attributes on an existing property.

In dictionary mode, every property access is a hash-table lookup — roughly 10-50× slower than
a direct in-object offset load.

```js
// Show the cost of delete — use --allow-natives-syntax to check:
function hasFastProperties(obj) {
  return %HasFastProperties(obj); // true = fast map; false = dictionary
}

const obj = { x: 1, y: 2, z: 3 };
console.log(hasFastProperties(obj)); // true

delete obj.y; // makes obj lose the shared Map — transitions to dict mode
console.log(hasFastProperties(obj)); // false — now slow
```

> [!OUTPUT]
> true
> false

## Inline cache states

An **inline cache** (IC) is a call-site-level optimization: V8 patches the bytecode dispatch
or generated stub with a fast-path handler tailored to the observed type. There are five IC
states, and each corresponds to what V8 can do at compile time:

| State | Maps seen | Handler | TurboFan action |
|---|---|---|---|
| `uninitialized` | 0 | generic | No feedback yet |
| `premonomorphic` | 1 (1st call) | miss handler | Wait one more call |
| `monomorphic` | 1 (stable) | direct offset load | Emit CheckMap + field load |
| `polymorphic` | 2–4 | small inline dispatch table | Emit inline type-switch |
| `megamorphic` | 5+ | global megamorphic stub | No specialization; hash lookup |

The state machine transitions are **one-way** upward — once megamorphic, an IC never returns
to monomorphic without a full reset (which requires a full GC cycle and feedback clearing).

> [!PRINCIPAL] The 4-map polymorphic budget is intentional and measurable
> V8 engineers chose 4 because hardware branch-prediction handles a 4-way conditional chain
> efficiently. The inline dispatch for a 2-map polymorphic IC fits in the instruction cache
> and executes in ~2-3ns. Megamorphic falls out of the IC and into the runtime — ~25-80ns
> per access depending on hash collision rate. If you see a property access IC that must
> handle 3-4 shapes, investigate whether you can reduce to 1-2 with a type tag field.
> The boundary between "acceptable polymorphism" and "megamorphic catastrophe" is at exactly 4.

## FeedbackVector in detail

Every compiled `JSFunction` has a **FeedbackVector** allocated alongside its `SharedFunctionInfo`.
It is an array of typed *slots*. Ignition writes feedback into slots during interpretation;
TurboFan reads slots during compilation.

Slot types relevant to property access:

```
LoadIC slot (LOAD_PROPERTY):
  ┌─────────────────────────┐
  │ state: monomorphic      │
  │ map: Map2               │  ← the specific Map seen
  │ handler: field offset 1 │  ← resolved field position
  └─────────────────────────┘

StoreIC slot (STORE_PROPERTY):
  ┌─────────────────────────┐
  │ state: polymorphic      │
  │ maps: [Map2, Map3]      │
  │ handlers: [offset 1, offset 0] │
  └─────────────────────────┘

CallIC slot (CALL):
  ┌─────────────────────────┐
  │ state: monomorphic      │
  │ callee: <JSFunction foo>│  ← used for inlining decisions
  │ count: 4821             │  ← how often this callee was called
  └─────────────────────────┘
```

When TurboFan compiles the function it reads these slots and emits:
- `LoadIC monomorphic Map2, offset 1` → `CheckMap(receiver, Map2); Load(receiver, offset 1)`
- `StoreIC polymorphic [Map2, Map3]` → `CheckMap(receiver, Map2); Store(receiver, offset 1);
  else CheckMap(receiver, Map3); Store(receiver, offset 0);`
- A megamorphic CallIC gets no inlining and generates a generic call.

## Try it yourself

The runnable block implements a complete **IC state machine** that transitions as it sees
new object shapes, computing the simulated cost of each property access.

```js run
// IC state machine with transition tracking and cost model
// Simulates V8's LoadIC for a single property access call site.

const IC_STATE = { UNINIT: 0, PREMONO: 1, MONO: 2, POLY: 3, MEGA: 4 };
const IC_NAMES = ["uninitialized", "premonomorphic", "monomorphic", "polymorphic", "megamorphic"];

// Simulated access cost in nanoseconds
const IC_COST_NS = [50, 30, 1.2, 3.5, 28];

function createIC(name) {
  return {
    name,
    state: IC_STATE.UNINIT,
    maps: [],       // list of map IDs seen
    totalCost: 0,
    accesses: 0,
  };
}

function accessProperty(ic, mapId) {
  ic.accesses++;

  if (!ic.maps.includes(mapId)) {
    ic.maps.push(mapId);
  }

  const prev = ic.state;
  const n = ic.maps.length;

  if      (n === 0)  ic.state = IC_STATE.UNINIT;
  else if (n === 1 && ic.state === IC_STATE.UNINIT) ic.state = IC_STATE.PREMONO;
  else if (n === 1)  ic.state = IC_STATE.MONO;
  else if (n <= 4)   ic.state = IC_STATE.POLY;
  else               ic.state = IC_STATE.MEGA;

  if (ic.state !== prev) {
    const arrow = `${IC_NAMES[prev]} -> ${IC_NAMES[ic.state]}`;
    const extra = n >= 5 ? " *** MEGAMORPHIC — TurboFan gives up ***" : "";
    console.log(`[IC ${ic.name}] ${arrow} (${n} maps seen)${extra}`);
  }

  ic.totalCost += IC_COST_NS[ic.state];
}

function report(ic) {
  const avg = (ic.totalCost / ic.accesses).toFixed(2);
  console.log(`\n  State: ${IC_NAMES[ic.state]}`);
  console.log(`  Maps seen: ${ic.maps.join(", ")}`);
  console.log(`  Average cost: ${avg} ns/access`);
  console.log(`  Total accesses: ${ic.accesses}`);
}

const loadX = createIC("obj.x");

// Phase 1 — single constructor, monomorphic
console.log("=== Phase 1: monomorphic (Map_Point) ===");
for (let i = 0; i < 1000; i++) accessProperty(loadX, "Map_Point");
report(loadX);

// Phase 2 — introduce a subclass with extra property
console.log("\n=== Phase 2: add Map_Point3D (polymorphic) ===");
for (let i = 0; i < 300; i++) accessProperty(loadX, "Map_Point3D");
report(loadX);

// Phase 3 — more shapes from unexpected callers
console.log("\n=== Phase 3: megamorphic flood ===");
["Map_Rect", "Map_Circle", "Map_Line", "Map_Bezier"].forEach(m => {
  for (let i = 0; i < 50; i++) accessProperty(loadX, m);
});
report(loadX);

console.log("\nCost ratio (megamorphic vs monomorphic):",
  (IC_COST_NS[IC_STATE.MEGA] / IC_COST_NS[IC_STATE.MONO]).toFixed(0) + "x");
console.log("At 1M accesses/s: mono=1.2ms overhead, mega=28ms overhead.");
```

## Exercise: the transition tree

Write a pure-JS simulation of a Map transition tree. Start with an empty Map, add properties
one by one, and verify that two objects built with the same properties in the same order share
the same leaf Map — but two built in different order do not.

<details>
<summary>Show solution</summary>

```js run
// Map transition tree simulator
// Maps are identified by sorted descriptor list + insertion order

class HiddenClassMap {
  constructor(id, descriptors) {
    this.id = id;
    this.descriptors = descriptors; // [{name, fieldIndex}]
    this.transitions = {};          // propName -> child Map
  }
  fieldIndex(name) {
    const d = this.descriptors.find(d => d.name === name);
    return d ? d.fieldIndex : -1;
  }
}

const MAP_REGISTRY = new Map(); // key -> HiddenClassMap
let nextMapId = 0;

function getOrCreateMap(descriptors) {
  // Key is the ordered list of property names
  const key = descriptors.map(d => d.name).join(",");
  if (!MAP_REGISTRY.has(key)) {
    MAP_REGISTRY.set(key, new HiddenClassMap(`Map${nextMapId++}`, descriptors));
  }
  return MAP_REGISTRY.get(key);
}

const emptyMap = getOrCreateMap([]);

function addProperty(currentMap, propName) {
  if (currentMap.transitions[propName]) {
    return currentMap.transitions[propName]; // follow existing transition
  }
  const newDescriptors = [
    ...currentMap.descriptors,
    { name: propName, fieldIndex: currentMap.descriptors.length }
  ];
  const newMap = getOrCreateMap(newDescriptors);
  currentMap.transitions[propName] = newMap;
  console.log(`  transition: ${currentMap.id} --[${propName}]--> ${newMap.id}`);
  return newMap;
}

console.log("=== Object a: x then y ===");
let mapA = emptyMap;
mapA = addProperty(mapA, "x");
mapA = addProperty(mapA, "y");
console.log(`a's final Map: ${mapA.id}, descriptors: ${mapA.descriptors.map(d=>d.name).join(", ")}`);

console.log("\n=== Object b: x then y (same order) ===");
let mapB = emptyMap;
mapB = addProperty(mapB, "x"); // reuses existing transition — no new Map created
mapB = addProperty(mapB, "y");
console.log(`b's final Map: ${mapB.id}`);
console.log(`a and b share same Map: ${mapA === mapB}`); // true

console.log("\n=== Object c: y then x (different order!) ===");
let mapC = emptyMap;
mapC = addProperty(mapC, "y"); // new transition from empty Map
mapC = addProperty(mapC, "x");
console.log(`c's final Map: ${mapC.id}`);
console.log(`c shares Map with a/b: ${mapC === mapA}`); // false — different Map!

console.log(`\nTotal Maps created: ${MAP_REGISTRY.size}`);
console.log("a and b are monomorphic with each other; c is a second shape -> polymorphic IC.");
```

</details>

## Common pitfalls

> [!PITFALL] Object.assign and spread create a new Map per call-site shape
> `const opts = { ...defaults, ...userOpts }` produces a fresh literal whose property order
> depends on the insertion order of both spreads. If `defaults` and `userOpts` have different
> optional properties in different calls, the resulting object will have different Maps every
> time. Prefer a canonical factory function that always adds properties in the same order,
> or use a class with all fields initialized in the constructor (even to `undefined`).
> Pre-allocating all fields in the constructor is the single most effective V8 performance
> technique available to application-level code.

> [!PITFALL] JSON.parse always produces dictionary-mode objects for large payloads
> Objects produced by `JSON.parse` start in fast mode but V8 may downgrade them if the key
> count or structure doesn't fit the fast-property layout. Deserializing large API responses
> and immediately iterating properties with `Object.keys()` in a hot path is a common source
> of unexpected megamorphic ICs. Consider a typed schema parser (e.g., `fast-json-stringify`
> in reverse, or a hand-written deserializer) for latency-critical paths.

## What you learned

- V8 **Maps** (hidden classes) encode property name, order, and in-object offset. Two objects
  with the same properties in the same order share a Map.
- The **transition tree** is shared — adding the same property to any Map-0 object follows the
  same path and lands at the same leaf Map, enabling cache sharing.
- IC states progress from `uninitialized` through `megamorphic`; the 4-map polymorphic budget
  is the last stop before the expensive hash-table stub.
- **FeedbackVector slots** record Maps and handlers seen; TurboFan reads them to emit
  `CheckMap` guards and direct field loads — the foundation of speculative optimization.
- `delete`, out-of-order property addition, and large dynamic objects cause **dictionary mode**
  — avoid them in hot paths.

## Next steps

Now that you understand how V8 inlines and caches at runtime, the final lesson covers how V8
avoids paying this startup cost at all: startup snapshots, code cache, and how Node's
Single Executable Application embeds a snapshot to eliminate cold-start entirely.
*/});
