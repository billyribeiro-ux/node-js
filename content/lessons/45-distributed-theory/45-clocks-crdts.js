registerLessonSrc("45-clocks-crdts", function () {/*
---
id: 45-clocks-crdts
title: "Logical Clocks, Vector Clocks & CRDTs"
minutes: 28
level: advanced
objectives:
  - Explain physical clock problems and how logical clocks solve ordering
  - Use vector clocks to determine happens-before vs concurrent events
  - Implement G-Counter, PN-Counter, LWW-Register, and OR-Set CRDTs with their merge semantics
---

# Logical Clocks, Vector Clocks & CRDTs

## Why this matters

You cannot trust wall-clock time in a distributed system. NTP corrections can move clocks backward. Quartz oscillator drift is ~1 ms/day on idle machines, worse under thermal load. At microsecond precision (required for financial audit logs and distributed tracing), two independently synchronized servers can easily be 100 µs apart. Without a shared notion of order, distributed nodes cannot agree on which write "happened last" — leading to silent data loss. CRDTs sidestep the problem entirely by defining merge operations that are mathematically guaranteed to converge, regardless of message order or delivery.

## Learning objectives

- Explain clock skew, NTP jitter, and why wall-clock timestamps cannot establish causality.
- Build a Lamport clock and trace through its happens-before relation.
- Implement vector clocks and the concurrent / ordered comparison algorithm.
- Implement and merge G-Counter, PN-Counter, LWW-Register, and OR-Set CRDTs.

## Physical Clock Problems

Distributed systems commonly assume "use the system clock for ordering." This breaks in several ways:

**Clock skew:** Two servers A and B are synchronized by NTP to within ±10 ms. Server A writes at wall-time T=100, server B writes at T=99. B's write has a lower timestamp despite happening later. If you use LWW (last-write-wins) with wall clocks, A's write is lost.

**NTP step corrections:** NTP can *step* the clock backward when drift exceeds a threshold (default ~128 ms in many configurations). A process writing at "T=1000" and then at "T=998" (post-step) has a write with a smaller timestamp that came *after*.

**Leap seconds:** POSIX time does not represent leap seconds; they are smeared or hidden. Systems using raw epoch arithmetic get silent anomalies during smear windows.

Google Spanner avoids this with **TrueTime**: GPS receivers + atomic clocks per datacenter, giving a bounded clock uncertainty of ~7 ms. Spanner waits out this uncertainty before committing to guarantee real-time ordering. Nobody else replicates this infrastructure.

## Lamport Clocks

Lamport (1978) introduced a simple algorithm to capture *causal order* using a single integer:

```
Rules:
1. Each process maintains a counter C, initialized to 0.
2. Before each local event: C = C + 1.
3. When sending a message: piggyback C on the message.
4. When receiving a message with timestamp Cm: C = max(C, Cm) + 1.
```

This gives us: if event A happened-before event B (A → B), then C(A) < C(B). But the converse is NOT guaranteed — C(A) < C(B) does NOT mean A → B. Two events with different timestamps might be concurrent (causally unrelated).

Lamport clocks establish a total order that's consistent with causality, but they cannot *detect* concurrency. That requires vector clocks.

> [!PRINCIPAL]
> Lamport clocks are used in practice not for concurrency detection but for total ordering of events for logging, debugging, and ordering operations in a single Raft group. Hybrid Logical Clocks (HLC), used by CockroachDB and YugabyteDB, combine a Lamport clock with wall-clock time: `hlc = max(wallClock, lastSeen) + logicalCounter`. HLC provides both human-readable timestamps and causal ordering — the best of both worlds for audit logs and follower reads.

## Vector Clocks

A vector clock for a system of N processes is an array of N integers, one per process. Rules:

```
1. Initialize VC[i] = 0 for all i.
2. Before local event on process i: VC[i]++.
3. Send message: attach current VC.
4. Receive message with VCm: VC[j] = max(VC[j], VCm[j]) for all j; then VC[i]++.
```

Comparison: given VCs A and B,
- A == B: all entries equal.
- A happened-before B (A → B): all entries A[i] <= B[i] AND at least one A[i] < B[i].
- B happened-before A: symmetric.
- **Concurrent** (A || B): neither dominates — some A[i] > B[i] AND some A[j] < B[j].

Concurrency detection is what enables CRDTs and optimistic replication: if two events are concurrent, no ordering is correct — merge semantics must handle both.

> [!PRINCIPAL]
> Vector clocks grow with the number of processes — O(N) space per message. In large clusters (1000s of nodes), this becomes prohibitive. Practical systems use **dotted version vectors** (Riak's approach), **interval tree clocks**, or **hybrid logical clocks** to bound metadata size. Dynamo-style vector clocks also require periodic pruning to prevent unbounded growth; Riak caps vector clock size and uses a pruning algorithm. This is a real operational concern for high-cardinality key-value stores.

## CRDTs: Conflict-Free Replicated Data Types

A **CRDT** is a data type with a mathematically defined merge operation (called join or ⊔) that is:
- **Commutative**: merge(A, B) = merge(B, A) — order doesn't matter.
- **Associative**: merge(merge(A, B), C) = merge(A, merge(B, C)) — grouping doesn't matter.
- **Idempotent**: merge(A, A) = A — duplicates don't matter.

These three properties guarantee that any set of replicas, receiving updates in any order (even duplicated), will converge to the same state when all updates are eventually delivered.

### G-Counter (Grow-only Counter)

Each replica maintains its own slot in an array. Increment only your own slot. Query = sum of all slots. Merge = element-wise max.

```
G-Counter with 3 replicas:
  R0: [5, 0, 0]  (incremented 5 times)
  R1: [0, 3, 0]  (incremented 3 times)
  R2: [0, 0, 2]  (incremented 2 times)
Merge: [max(5,0,0), max(0,3,0), max(0,0,2)] = [5, 3, 2]
Value: 5 + 3 + 2 = 10
```

### PN-Counter (Positive-Negative Counter)

Two G-Counters: P (increments) and N (decrements). Value = sum(P) - sum(N). Merge each G-Counter independently.

### LWW-Register (Last-Write-Wins Register)

Each replica stores (value, timestamp). Merge = whichever timestamp is higher. Requires a trusted timestamp source (Lamport or HLC, not wall clock). Convergent but can silently discard writes — use with care.

### OR-Set (Observed-Remove Set)

Each element is tagged with a unique ID (UUID) when added. Remove marks that specific tag as deleted (tombstoned). Merge = union of all adds, minus all removes *for those specific tags*. Concurrent add and remove of the same element resolves in favor of **add** — hence "add wins." This is the model used by collaborative editing systems (Figma, Notion) for presence and shared element lists.

> [!PITFALL]
> LWW-Register is deceptively dangerous. Using wall-clock time means a node with a fast clock silently wins all conflicts. Under NTP sync, "last write wins" can mean "the node with the most aggressive NTP offset wins." Always use logical or hybrid timestamps with LWW. Even then, LWW loses the other write entirely — it's not a merge, it's a discard. Use PN-Counter or OR-Set when you need convergence without data loss.

## Try it yourself

The code below implements all four CRDTs with their merge operations, plus the vector clock comparison algorithm. Run it and observe convergence after simulated out-of-order replication.

```js run
// === Vector Clock ===
function vcCreate(nodes) {
  const vc = {};
  for (const n of nodes) vc[n] = 0;
  return vc;
}
function vcIncrement(vc, nodeId) {
  const next = { ...vc };
  next[nodeId] = (next[nodeId] || 0) + 1;
  return next;
}
function vcMerge(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result = {};
  for (const k of keys) result[k] = Math.max(a[k] || 0, b[k] || 0);
  return result;
}
function vcCompare(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let lt = false, gt = false;
  for (const k of keys) {
    const av = a[k] || 0, bv = b[k] || 0;
    if (av < bv) lt = true;
    if (av > bv) gt = true;
  }
  if (lt && gt) return "concurrent";
  if (lt) return "before";
  if (gt) return "after";
  return "equal";
}

console.log("=== Vector Clocks ===");
let vcA = vcCreate(["R0","R1","R2"]);
let vcB = vcCreate(["R0","R1","R2"]);
vcA = vcIncrement(vcA, "R0");
vcA = vcIncrement(vcA, "R0");
vcB = vcIncrement(vcB, "R1");
console.log("A:", JSON.stringify(vcA), "B:", JSON.stringify(vcB));
console.log("Relation:", vcCompare(vcA, vcB)); // concurrent

const vcC = vcMerge(vcA, vcB);
const vcD = vcIncrement(vcC, "R0");
console.log("C (merged):", JSON.stringify(vcC));
console.log("D (after C):", JSON.stringify(vcD));
console.log("C->D:", vcCompare(vcC, vcD)); // before

// === G-Counter CRDT ===
function gcCreate(nodes) { return Object.fromEntries(nodes.map(n => [n, 0])); }
function gcIncrement(gc, nodeId) { return { ...gc, [nodeId]: gc[nodeId] + 1 }; }
function gcValue(gc) { return Object.values(gc).reduce((s, v) => s + v, 0); }
function gcMerge(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result = {};
  for (const k of keys) result[k] = Math.max(a[k] || 0, b[k] || 0);
  return result;
}

console.log("\n=== G-Counter ===");
let gc0 = gcCreate(["R0","R1","R2"]);
let gc1 = { ...gc0 };
gc0 = gcIncrement(gcIncrement(gcIncrement(gc0, "R0"), "R0"), "R0"); // R0 increments 3x
gc1 = gcIncrement(gcIncrement(gc1, "R1"), "R1"); // R1 increments 2x
console.log("R0 local:", gc0, "value:", gcValue(gc0));
console.log("R1 local:", gc1, "value:", gcValue(gc1));
const merged = gcMerge(gc0, gc1);
console.log("Merged:", merged, "value:", gcValue(merged)); // 5

// === PN-Counter ===
function pnCreate(nodes) { return { p: gcCreate(nodes), n: gcCreate(nodes) }; }
function pnIncrement(pn, nodeId) { return { ...pn, p: gcIncrement(pn.p, nodeId) }; }
function pnDecrement(pn, nodeId) { return { ...pn, n: gcIncrement(pn.n, nodeId) }; }
function pnValue(pn) { return gcValue(pn.p) - gcValue(pn.n); }
function pnMerge(a, b) { return { p: gcMerge(a.p, b.p), n: gcMerge(a.n, b.n) }; }

console.log("\n=== PN-Counter ===");
let pn0 = pnCreate(["R0","R1"]);
let pn1 = { p: { ...pn0.p }, n: { ...pn0.n } };
pn0 = pnIncrement(pnIncrement(pnIncrement(pn0, "R0"), "R0"), "R0"); // +3
pn1 = pnDecrement(pn1, "R1"); // -1
console.log("R0 value:", pnValue(pn0), "R1 value:", pnValue(pn1));
console.log("Merged value:", pnValue(pnMerge(pn0, pn1))); // 2

// === LWW-Register ===
function lwwCreate() { return { value: null, ts: -Infinity }; }
function lwwWrite(reg, value, ts) { return ts > reg.ts ? { value, ts } : reg; }
function lwwMerge(a, b) { return a.ts >= b.ts ? a : b; }
function lwwRead(reg) { return reg.value; }

console.log("\n=== LWW-Register ===");
let lA = lwwCreate(), lB = lwwCreate();
lA = lwwWrite(lA, "Alice", 100);
lB = lwwWrite(lB, "Bob", 105); // Bob arrives later (simulated with higher ts)
const lwwResult = lwwMerge(lA, lB);
console.log("LWW winner:", lwwRead(lwwResult), "(ts="+lwwResult.ts+")"); // Bob

// Danger: concurrent write with same ts
lA = lwwWrite(lwwCreate(), "Alice", 100);
lB = lwwWrite(lwwCreate(), "Bob", 100);
console.log("Same-ts conflict (implementation-dependent):", lwwRead(lwwMerge(lA, lB)));

// === OR-Set ===
function orCreate() { return { adds: new Map(), removes: new Set() }; }
function orAdd(set, elem) {
  const tag = elem + "_" + Math.random().toString(36).slice(2);
  const tags = set.adds.get(elem) || new Set();
  tags.add(tag);
  const newAdds = new Map(set.adds); newAdds.set(elem, tags);
  return { adds: newAdds, removes: new Set(set.removes) };
}
function orRemove(set, elem) {
  const tags = set.adds.get(elem) || new Set();
  const newRemoves = new Set(set.removes);
  for (const t of tags) newRemoves.add(t);
  return { adds: new Map(set.adds), removes: newRemoves };
}
function orMerge(a, b) {
  const adds = new Map(a.adds);
  for (const [elem, tags] of b.adds) {
    const existing = adds.get(elem) || new Set();
    const merged = new Set([...existing, ...tags]);
    adds.set(elem, merged);
  }
  const removes = new Set([...a.removes, ...b.removes]);
  return { adds, removes };
}
function orQuery(set) {
  const result = [];
  for (const [elem, tags] of set.adds) {
    const alive = [...tags].some(t => !set.removes.has(t));
    if (alive) result.push(elem);
  }
  return result.sort();
}

console.log("\n=== OR-Set (add-wins) ===");
let sA = orCreate(), sB = orCreate();
sA = orAdd(sA, "apple");
sA = orAdd(sA, "banana");
sB = orAdd(sB, "cherry");
// Concurrent: A removes "apple", B adds "apple" again
sA = orRemove(sA, "apple");
sB = orAdd(sB, "apple"); // B adds concurrently — add WINS
const sM = orMerge(sA, sB);
console.log("OR-Set after merge:", orQuery(sM)); // apple (from B), banana, cherry
```

## Exercise: CRDT convergence

Two replicas of an OR-Set diverge: R0 adds "user:1" then removes it; R1 (partitioned) adds "user:1" independently with a new unique tag. After healing, does "user:1" appear in the merged set?

<details>
<summary>Show solution</summary>

Yes — "user:1" appears. R0's removal tombstones only R0's original add-tag. R1's independent add carries a different unique tag, which is not tombstoned. The merge takes the union of adds minus the union of removes. R1's add tag is alive. This is the "add wins" semantics of OR-Set — intentional for collaborative applications (concurrent resurrection is usually the right UX).

```js run
function makeTag(node, seq) { return `${node}#${seq}`; }

// R0 adds "user:1" with tag R0#1, then removes it (tombstones R0#1)
// R1 adds "user:1" with tag R1#1 (concurrent with R0's remove)
const adds  = new Map([["user:1", new Set(["R0#1", "R1#1"])]]);
const removes = new Set(["R0#1"]); // R0's tombstone

function orQueryDirect(adds, removes) {
  const result = [];
  for (const [elem, tags] of adds) {
    const alive = [...tags].some(t => !removes.has(t));
    if (alive) result.push(elem);
  }
  return result;
}
console.log("Present after merge:", orQueryDirect(adds, removes)); // ["user:1"]
console.log("R0#1 tombstoned:", removes.has("R0#1")); // true
console.log("R1#1 alive:", !removes.has("R1#1")); // true
```

</details>

## Common pitfalls

> [!PITFALL]
> Assuming vector clock size is constant. Every new process added to the system expands every vector clock. In a microservice architecture where pods are ephemeral (new pod ID on each deploy), vector clocks grow without bound. Use a stable, small set of logical node identities (e.g., shard IDs, datacenter IDs) rather than pod UUIDs as the vector clock key space. Alternatively, use hybrid logical clocks which encode causality in a constant-size timestamp pair.

> [!PITFALL]
> Using CRDTs as a drop-in for general state. CRDTs work for commutative, associative operations. "Set account balance to X" is NOT commutative — it's a conditional operation that requires consensus. CRDTs are ideal for: counters, sets of items, collaborative text (Operational Transforms / RGA CRDT), presence/status flags. They are wrong for: financial balances, inventory counts that can't go negative, any invariant that depends on a global bound.

## What you learned

- Physical clocks cannot establish causality: NTP skew, drift, and step-corrections make wall-clock LWW unsafe.
- Lamport clocks give a causal ordering (A→B implies C(A)<C(B)) but cannot detect concurrency.
- Vector clocks detect concurrent events (neither dominates) — essential for conflict detection.
- CRDTs (G-Counter, PN-Counter, LWW-Register, OR-Set) use commutative, associative, idempotent merge functions to guarantee convergence without coordination.
- OR-Set's add-wins semantic, PN-Counter's split P/N counters, and LWW-Register's timestamp comparison are the core merge patterns.

## Next steps

Convergent state and logical ordering solve the "how do replicas agree without coordination" problem. But application-level side effects — sending emails, charging cards, updating external APIs — cannot be merged. That requires a different approach: idempotency, the transactional outbox, and exactly-once processing, covered next.
*/});
