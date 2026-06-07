registerLessonSrc("31-hidden-classes", function () {/*
---
id: 31-hidden-classes
title: "Hidden Classes & Inline Caches"
minutes: 24
level: advanced
objectives:
  - Understand how V8 represents objects internally using hidden classes (shapes/maps)
  - Explain why consistent object shapes lead to faster property access
  - Distinguish monomorphic, polymorphic, and megamorphic inline caches and their performance impact
---

# Hidden Classes & Inline Caches

## Why this matters

You have probably heard "avoid adding properties to objects dynamically" without ever understanding why. The reason is rooted in V8's object model: every object carries a **hidden class** that describes its shape, and every property access site carries an **inline cache** that bets on the shapes it has seen. Break that bet and V8 has to work much harder — sometimes orders of magnitude harder — for every single property read or write in a hot path.

@diagram:hidden-classes

## Learning objectives

- Describe what a hidden class (also called a *shape* or *map*) is and how V8 builds a transition tree.
- Explain how inline caches (ICs) use hidden classes to skip property-lookup work.
- Classify call sites as monomorphic, polymorphic, or megamorphic and understand the speed implications.
- Write constructors and factory functions that produce consistent shapes.

## How V8 represents objects: hidden classes

JavaScript objects are dynamically typed — you can add any property at any time. Naively, V8 could store them as hash maps, but hash-map lookups are slow. Instead, V8 assigns every object a **hidden class** (also called a *shape* or *map* in V8 source code). A hidden class records which property names exist, in which order, and at what fixed memory offset each value sits.

```js
// Both objects end up with the SAME hidden class because
// they add properties in the same order.
function Point(x, y) {
  this.x = x;   // transition 1: {} -> { x }
  this.y = y;   // transition 2: { x } -> { x, y }
}

const p1 = new Point(1, 2);
const p2 = new Point(3, 4);
// p1 and p2 share one hidden class — V8 can read p1.x and p2.x
// at the exact same memory offset, with no hash lookup at all.
```

> [!OUTPUT]
> (no output — demonstration only)

Each time you add a new property V8 transitions the object to a *new* hidden class. These transitions form a **transition tree** that V8 caches and reuses. Objects created through the same sequence of property additions share the same leaf hidden class.

```js
// node shapes-demo.js  (read-only illustration)
const a = {};
a.x = 1;   // HC0 -> HC1 (has x)
a.y = 2;   // HC1 -> HC2 (has x, y)

const b = {};
b.x = 10;  // reuses HC1 from the cache
b.y = 20;  // reuses HC2 — b shares a's hidden class

const c = {};
c.y = 99;  // HC0 -> HC3 (has y) — DIFFERENT tree branch!
c.x = 1;   // HC3 -> HC4 (has y, x) — different from HC2
console.log("a and b share a shape; c does not");
```

> [!OUTPUT]
> a and b share a shape; c does not

> [!NOTE] Property order is part of the shape
> `{ x, y }` and `{ y, x }` are *different* hidden classes even though they have the same keys. Always add properties in the same order across all instances of a "type".

## Inline caches (ICs): speeding up property access

Every property-access expression in your source — `obj.name`, `arr[i]`, `fn(a, b)` — compiles to a **call site** that V8 monitors. The first time the site executes, V8 records the hidden class of the object it saw. On subsequent calls it checks the hidden class and, if it matches, jumps directly to the precomputed offset. No hash lookup, no prototype walk. This is an **inline cache (IC)**.

ICs live in three states, and the state determines performance:

| State | What V8 saw | Cost |
|---|---|---|
| **Monomorphic** | Always the same hidden class | Cheapest — single direct comparison then direct load |
| **Polymorphic** | 2–4 different hidden classes | A small switch table — still fast |
| **Megamorphic** | 5 or more different hidden classes | Falls back to a global hash table — slow |

```js
// node ic-states.js
function getX(obj) { return obj.x; }   // the IC lives here

// Monomorphic: only ever sees Point objects
function Point(x, y) { this.x = x; this.y = y; }
const pts = Array.from({ length: 100_000 }, (_, i) => new Point(i, i));
pts.forEach(p => getX(p));  // IC: monomorphic -> fast

// Megamorphic: many different shapes funnel through getX
const shapes = [
  { x: 1 },
  { x: 2, extra: true },
  { a: 0, x: 3 },
  { b: 0, c: 0, x: 4 },
  { d: 0, e: 0, f: 0, x: 5 },
];
shapes.forEach(s => getX(s));  // IC: megamorphic -> slow
```

> [!PRINCIPAL] Megamorphic ICs propagate invisibly
> Once a call site goes megamorphic it stays megamorphic for the lifetime of the process — V8 does not spontaneously recover it. If a generic utility (`getX`, a serialiser, a logger) is called with objects of many different shapes, *every* call to that utility pays the megamorphic penalty. This is one of the most common hidden performance cliffs in large Node applications.

## Practical rules for shape-stable code

**1. Initialise all properties in the constructor.**

```js
// Good — one hidden class, allocated up front
class Vector {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

// Bad — shape mutates on every conditional branch
class BadVector {
  constructor(x, y, z) {
    this.x = x;
    if (y !== undefined) this.y = y;   // sometimes has y, sometimes doesn't
    if (z !== undefined) this.z = z;
  }
}
```

**2. Use `undefined` as a placeholder rather than omitting a property.**

```js
// Keeps the shape consistent — both branches share one hidden class
class Config {
  constructor(opts) {
    this.host    = opts.host    ?? "localhost";
    this.port    = opts.port    ?? 3000;
    this.timeout = opts.timeout ?? undefined;  // present but undefined is fine
  }
}
```

**3. Never delete properties from hot objects.**

```js
// delete obj.key transitions the object to a new (slower) dictionary mode
// Use obj.key = null or obj.key = undefined instead
```

> [!PITFALL] delete turns objects into "dictionary mode"
> Using `delete obj.prop` on an object that V8 has already given a hidden class forces V8 to demote that object to a slow hash-map representation (dictionary mode). All subsequent property accesses on that object pay hash-map costs. Set the property to `null` or `undefined` instead.

**4. Separate hot generic helpers into per-type specialisations.**

If you have a utility called with many shapes, consider separate functions per type so each function's IC stays monomorphic.

## Try it yourself

This benchmark compares property access on shape-consistent objects versus objects built with differing property orders. In a full V8 engine the consistent variant stays monomorphic; the inconsistent variant drives the IC megamorphic.

```js run
// Demonstrate the cost of inconsistent object shapes on a hot read path.

function makeConsistent(i) {
  // Always: x first, then y — one hidden class
  return { x: i, y: i * 2 };
}

function makeInconsistent(i) {
  // Alternates property order — two hidden classes interleaved
  if (i % 2 === 0) return { x: i, y: i * 2 };
  return { y: i * 2, x: i };
}

function sumXY(obj) { return obj.x + obj.y; }

const N = 50_000;

// Build both arrays first so allocation itself is not in the timed section.
const consistent   = Array.from({ length: N }, (_, i) => makeConsistent(i));
const inconsistent = Array.from({ length: N }, (_, i) => makeInconsistent(i));

// Warm up the consistent path so sumXY has a chance to get optimised.
let warmup = 0;
for (let i = 0; i < N; i++) warmup += sumXY(consistent[i]);

// --- Time consistent shapes ---
let t0 = performance.now();
let acc1 = 0;
for (let i = 0; i < N; i++) acc1 += sumXY(consistent[i]);
let t1 = performance.now();

// --- Time inconsistent shapes ---
let t2 = performance.now();
let acc2 = 0;
for (let i = 0; i < N; i++) acc2 += sumXY(inconsistent[i]);
let t3 = performance.now();

console.log(`Consistent shapes:   ${(t1 - t0).toFixed(2)} ms  (sum=${acc1})`);
console.log(`Inconsistent shapes: ${(t3 - t2).toFixed(2)} ms  (sum=${acc2})`);
console.log("Ratio:", ((t3 - t2) / (t1 - t0)).toFixed(2) + "x");
// Inconsistent is typically 1.5–5x slower in a real V8 engine.
```

## Exercise

**Challenge:** Write a `readProp` function that is intentionally kept monomorphic, and a second version where you funnel five different shapes through it. Measure the difference.

<details>
<summary>Show solution</summary>

```js run
function readProp(obj) { return obj.value; }

// Monomorphic — only one shape
const REPS = 100_000;
const mono = Array.from({ length: REPS }, (_, i) => ({ value: i }));

let t0 = performance.now();
let s1 = 0;
for (let i = 0; i < REPS; i++) s1 += readProp(mono[i]);
let mono_ms = performance.now() - t0;

// Megamorphic — five different shapes (note: in a sandbox engine the difference
// may be smaller than in production V8 because sandbox JIT is simpler)
const mega = [];
for (let i = 0; i < REPS; i++) {
  const r = i % 5;
  if      (r === 0) mega.push({ value: i });
  else if (r === 1) mega.push({ a: 0, value: i });
  else if (r === 2) mega.push({ b: 0, c: 0, value: i });
  else if (r === 3) mega.push({ d: 0, e: 0, f: 0, value: i });
  else              mega.push({ g: 0, h: 0, i: 0, j: 0, value: i });
}

// Re-create readProp so its IC starts fresh for the megamorphic test.
function readPropMega(obj) { return obj.value; }

let t1 = performance.now();
let s2 = 0;
for (let i = 0; i < REPS; i++) s2 += readPropMega(mega[i]);
let mega_ms = performance.now() - t1;

console.log(`Monomorphic:  ${mono_ms.toFixed(2)} ms`);
console.log(`Megamorphic:  ${mega_ms.toFixed(2)} ms`);
console.log(`Ratio: ${(mega_ms / mono_ms).toFixed(2)}x`);
```

</details>

## Common pitfalls

> [!PITFALL] Thinking only constructors matter
> Hidden classes are created by property-addition order regardless of whether you use `class`, a constructor function, or an object literal. `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are different shapes. Spread-merging objects (`{ ...defaults, ...overrides }`) can silently create many shapes if the key sets vary.

## What you learned

- V8 assigns every object a **hidden class** encoding its property names and offsets; objects with the same construction sequence share one hidden class.
- **Inline caches** use the hidden class to resolve property accesses in O(1) without a hash lookup.
- ICs degrade from **monomorphic** (fastest) to **polymorphic** to **megamorphic** (slowest) as they see more shapes.
- `delete` demotes objects to slow dictionary mode — use `null`/`undefined` instead.
- Initialise every property in the constructor, in a consistent order, to keep objects monomorphic.

## Next steps

Now that you know how V8 allocates and accesses objects, the next lesson dives into **garbage collection**: how V8 reclaims memory, what generational GC means, and how to write GC-friendly code that minimises pause times.
*/});
