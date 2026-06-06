registerLessonSrc("32-heap-snapshots", function () {/*
---
id: 32-heap-snapshots
title: "Heap Snapshots & Comparison"
minutes: 24
level: advanced
objectives:
  - Understand what a heap snapshot captures and how V8 allocates objects
  - Take heap snapshots using multiple methods and load them in Chrome DevTools
  - Interpret shallow vs retained size and use snapshot comparison to find growth
---

# Heap Snapshots & Comparison

## Why this matters

Memory leaks are among the most treacherous production bugs: they rarely crash immediately, they
disguise themselves as "the server just needs a restart sometimes", and they can silently degrade
latency for hours before anyone notices. Heap snapshots are the X-ray machine for Node's memory:
they freeze every live object, how much space it occupies, and who is keeping it alive. Knowing how
to take, compare, and read them is the difference between spending two hours and two weeks tracking
down a leak.

## Learning objectives

- Explain what a heap snapshot is and what information it records.
- Take a snapshot with `--heapsnapshot-signal`, `v8.writeHeapSnapshot()`, and Chrome DevTools.
- Distinguish **shallow size** from **retained size** and know which one to chase.
- Compare two snapshots to locate objects that grew between them.
- Identify the **dominator** of a leaked object and understand why it matters.

## What a heap snapshot actually is

When you ask V8 to produce a heap snapshot it performs a **stop-the-world** traversal of every
object reachable from the GC roots (global object, call stacks, native handles). For each object it
records:

- The object **type** (Array, Map, Object, closure, string, …).
- **Shallow size** — the bytes the object itself occupies, not counting anything it points to.
- **Retained size** — the bytes that would be freed if *this object and everything it exclusively
  keeps alive* were collected. This is the metric that tells you the blast radius of a leak.
- All **outgoing references** (the object graph edges).

The result is a JSON file (`.heapsnapshot`) that Chrome DevTools knows how to load and render as
a searchable table and a visual retainer tree.

```
GC Roots
  └─ global object
       └─ cache (Map, shallow: 56 B, retained: 480 MB)  ← the leak is HERE
            ├─ entry "req-1" → Response object (200 KB)
            ├─ entry "req-2" → Response object (200 KB)
            └─ … 2 400 more entries
```

## Taking a snapshot

### Method 1 — `v8.writeHeapSnapshot()` in code

The simplest way to instrument your own service:

```js
import v8 from "node:v8";

// Write a snapshot on demand — returns the file path written.
const filePath = v8.writeHeapSnapshot();
console.log("Snapshot written to", filePath);
// Snapshot written to Heap.20240601.142301.12345.0.001.heapsnapshot
```

> [!OUTPUT]
> Snapshot written to Heap.20240601.142301.12345.0.001.heapsnapshot

You can wire this to an HTTP endpoint so you can trigger it without restarting:

```js
import http from "node:http";
import v8 from "node:v8";

http.createServer((req, res) => {
  if (req.url === "/snapshot" && req.method === "POST") {
    const file = v8.writeHeapSnapshot();
    res.end(JSON.stringify({ file }));
  } else {
    res.end("ok");
  }
}).listen(3000);
```

> [!WARNING] Taking a snapshot pauses the process
> `writeHeapSnapshot()` triggers a full GC followed by a stop-the-world traversal. On a 500 MB
> heap this can take 3-10 seconds. Plan for this in production — capture during a low-traffic
> window or use a canary instance.

### Method 2 — `--heapsnapshot-signal`

Tell Node to write a snapshot whenever it receives a signal, with zero code changes:

```bash
node --heapsnapshot-signal=SIGUSR2 server.js
# later, from another terminal:
kill -SIGUSR2 <PID>
```

The `.heapsnapshot` file appears in the current working directory. This is the safest way to
capture a snapshot of a *running* production service because it requires no deployment.

### Method 3 — Chrome DevTools

Connect Chrome to a running Node process:

```bash
node --inspect server.js
# open chrome://inspect in Chrome, click "inspect"
# Memory tab → Take heap snapshot
```

DevTools shows the snapshot inline so you can drill into the retainer tree interactively without
leaving the browser.

## Shallow vs retained size

This distinction is where most developers go wrong the first time.

| Metric | What it means | When to use it |
|---|---|---|
| **Shallow size** | Bytes for the object itself only | Understanding struct layout |
| **Retained size** | Bytes freed if this object were deleted | Finding the root of a leak |

A `Map` object has a shallow size of ~56 bytes — just its header and a pointer to its internal
hash table. But if that Map has 50 000 entries each holding a 10 KB object, its retained size is
~500 MB. The retained size tells you *where the memory really lives*.

> [!PRINCIPAL] Chase retained size, not shallow size
> When scanning a snapshot for leaks, sort by **retained size descending** and work from the top.
> An object at the top with a tiny shallow size but enormous retained size is almost always the
> leak anchor. It's holding the entire leaked subgraph alive through a single reference that the
> GC cannot break.

## Comparing two snapshots to find growth

The most powerful workflow is the **comparison**:

1. Let the server warm up and take **snapshot A** (baseline).
2. Drive load through the system (or wait for the suspicious growth window).
3. Take **snapshot B** (after suspected leak period).
4. In DevTools: load snapshot B → click the dropdown that says "Summary" → switch to
   **"Comparison"** → select snapshot A as the base.

DevTools shows every constructor whose instance count or size **increased** between the two
snapshots. Objects with `+count` and `+size` columns in red are the prime suspects.

```
Constructor          # New  Size Delta
─────────────────────────────────────
RequestContext        +2400  +48 MB    ← look here first
Array                   +12    +2 KB
```

> [!NOTE] Force a GC before taking each snapshot
> In DevTools: check "Collect garbage before taking snapshot". In code, call
> `global.gc()` (requires `--expose-gc` flag). This ensures you're comparing *live* objects, not
> objects that happen not to have been collected yet.

## Dominators

The **dominator** of an object O is the single object D such that every path from any GC root to O
passes through D. If you delete D, O becomes unreachable.

```
root → A → B → LeakedObject
root → A → C → LeakedObject
```

In this graph `A` dominates `LeakedObject` — deleting `A` is sufficient to free it, even though
it is reachable through both `B` and `C`. The DevTools "Dominators" view makes this tree explicit,
letting you navigate from a leaked object straight to the single object you need to nullify or
unregister to fix the leak.

## Try it yourself

This runnable block models the retained-size concept: it builds a reference graph and computes
reachability from a root to calculate which objects would be freed if a given node were removed.

```js run
// Model a reference graph and compute "retained" objects.
// nodes: Map<id, Set<id>> (adjacency: id -> set of ids it references)
function buildGraph() {
  const graph = new Map();
  const add = (id, ...refs) => graph.set(id, new Set(refs));
  // root -> cache -> [a, b, c];  root also references d directly
  add("root",  "cache", "d");
  add("cache", "a", "b", "c");
  add("a",     "shared");
  add("b",     "shared");
  add("c");
  add("d",     "shared");
  add("shared");
  return graph;
}

function reachableFrom(graph, startId) {
  const visited = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const ref of (graph.get(id) || [])) stack.push(ref);
  }
  return visited;
}

function retainedBy(graph, nodeId) {
  // Objects retained by nodeId = reachable(root) - reachable(root without nodeId)
  const allReachable = reachableFrom(graph, "root");

  // Build graph without nodeId
  const pruned = new Map(graph);
  pruned.set("root", new Set([...graph.get("root")].filter(r => r !== nodeId)));
  pruned.delete(nodeId);

  const afterRemoval = reachableFrom(pruned, "root");

  const retained = [...allReachable].filter(id => !afterRemoval.has(id));
  return retained;
}

const graph = buildGraph();
console.log("All reachable:", [...reachableFrom(graph, "root")].sort().join(", "));
console.log("Retained by 'cache':", retainedBy(graph, "cache").sort().join(", "));
console.log("Retained by 'd':",     retainedBy(graph, "d").sort().join(", "));
// 'shared' is also reachable via 'd', so removing 'cache' alone does NOT free 'shared'
```

## Exercise

**Challenge:** Modify the graph above so that `cache` has an additional direct reference to
`"d"`. Then re-run `retainedBy(graph, "cache")` — does `d` and `shared` now become retained by
`cache`? Explain why.

<details>
<summary>Show solution</summary>

When `cache` also references `"d"`, removing `cache` from root's edges eliminates the only path to
`d` (since now `d` is only reachable *through* `cache`, not directly from root). So `d` and
`shared` both become retained by `cache`.

```js run
function buildGraph2() {
  const graph = new Map();
  const add = (id, ...refs) => graph.set(id, new Set(refs));
  // cache now references d as well
  add("root",  "cache");        // root ONLY goes through cache now
  add("cache", "a", "b", "c", "d");
  add("a",     "shared");
  add("b",     "shared");
  add("c");
  add("d",     "shared");
  add("shared");
  return graph;
}

function reachableFrom(graph, startId) {
  const visited = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const ref of (graph.get(id) || [])) stack.push(ref);
  }
  return visited;
}

function retainedBy(graph, nodeId) {
  const allReachable = reachableFrom(graph, "root");
  const pruned = new Map(graph);
  pruned.set("root", new Set([...graph.get("root")].filter(r => r !== nodeId)));
  pruned.delete(nodeId);
  const afterRemoval = reachableFrom(pruned, "root");
  return [...allReachable].filter(id => !afterRemoval.has(id));
}

const graph = buildGraph2();
console.log("Retained by 'cache':", retainedBy(graph, "cache").sort().join(", "));
// cache, a, b, c, d, shared — everything is now retained by cache
```

</details>

## Common pitfalls

> [!PITFALL] Comparing snapshots without forcing GC first
> If you skip the GC step before snapshot B, you'll see hundreds of "new" objects that are actually
> just garbage not yet collected. Always force a GC before both snapshots so the comparison shows
> true survivors, not GC lag. In DevTools the checkbox does this for you; in code pass `--expose-gc`
> and call `global.gc()` before `v8.writeHeapSnapshot()`.

Another common mistake is looking at **shallow size** in the summary view and chasing small utility
objects. Always switch to sorting by **retained size** first. A `Map` holding 50 000 response
bodies will show up as 56 bytes shallow — utterly invisible — but 500 MB retained.

## What you learned

- A heap snapshot records every reachable object, its type, shallow size, retained size, and all
  outgoing references.
- Take snapshots via `v8.writeHeapSnapshot()`, `--heapsnapshot-signal=SIGUSR2`, or Chrome DevTools.
- **Shallow size** is the object itself; **retained size** is everything freed if it were deleted —
  always sort by retained size when hunting leaks.
- The snapshot **comparison** view highlights constructors whose count or size grew between two
  snapshots — that's your starting point.
- The **dominator** of a leaked object is the single ancestor you must delete to free it.

## Next steps

Now you can locate *what* is leaking — next you'll learn the usual suspects *why* things leak:
unbounded caches, forgotten event listeners, closures, and timers, plus the WeakMap/WeakRef tools
that prevent these patterns from the start.
*/});
