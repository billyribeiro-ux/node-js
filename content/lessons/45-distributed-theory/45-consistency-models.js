registerLessonSrc("45-consistency-models", function () {/*
---
id: 45-consistency-models
title: "Consistency Models: Linearizable to Eventual"
minutes: 28
level: advanced
objectives:
  - Map the full hierarchy of consistency models and their formal guarantees
  - Reason through CAP and PACELC tradeoffs with concrete latency numbers
  - Calculate quorum requirements and understand why strong consistency is expensive
---

# Consistency Models: Linearizable to Eventual

## Why this matters

Every distributed database, cache, and message broker you deploy makes a consistency promise — and almost nobody reads the fine print. "Strong consistency" on AWS DynamoDB (with transactions) costs 2× read units and adds a round-trip. "Eventual consistency" in Cassandra can return stale data for seconds or minutes under partition. The difference between linearizability and sequential consistency has caused production incidents at major companies. This lesson gives you the vocabulary and mental models to reason about these tradeoffs before they bite you.

## Learning objectives

- Explain the formal hierarchy: strict → linearizable → sequential → causal → monotonic → eventual.
- Apply CAP theorem and the sharper PACELC model with realistic latency numbers.
- Calculate quorum requirements (R + W > N) and the consistency guarantees each quorum gives.
- Identify read-your-writes, monotonic reads, and monotonic writes as session-level guarantees.

## The Consistency Hierarchy

Consistency models form a partial order — each level is strictly weaker than the one above, allowing more performance in exchange for weaker guarantees.

### Strict Consistency (Theoretical)

Every read sees the most recent write, globally, instantaneously. Requires zero propagation latency. Impossible in any real distributed system due to the speed of light. Mentioned only as the theoretical ideal — sometimes called "atomic" consistency in textbooks, but this is distinct from CPU atomics.

### Linearizability (the gold standard)

**Linearizability** (Herlihy & Wing, 1990) is the strongest *practical* consistency model. Informally: the system behaves as if there is a single copy of the data and every operation takes effect at a single, instantaneous point in time between its invocation and its response.

Crucially, linearizability is a *real-time* guarantee. If operation A completes before operation B starts, any observer must see A's effect before B's. This is what makes it feel like a single machine.

Systems that offer it: etcd (Raft-backed), ZooKeeper (ZAB-backed), CockroachDB, Spanner, PostgreSQL with synchronous replication + fencing. The cost is **one full network round-trip (or more) per operation** to achieve distributed agreement. At inter-datacenter latency of 50–100 ms, that's painful.

### Sequential Consistency (Lamport, 1979)

Weaker than linearizable: all operations appear to happen in *some* sequential order that is consistent with each process's local order, but there is **no real-time guarantee**. Two clients can observe the same operations in different orders, as long as each individual client sees a consistent sequence.

Sequential consistency is sufficient for most multi-core cache-coherence protocols (which is where Lamport introduced it), but it can mislead in distributed databases because it allows reads to appear "from the past."

### Causal Consistency

Operations that are causally related (A happened-before B in the Lamport sense) must be seen by all processes in causal order. Concurrent (causally unrelated) operations can be seen in any order.

This is what MongoDB's causally consistent sessions provide. Systems like COPS and Eiger implement causal+ consistency. The mechanism is **vector clocks or logical timestamps** — every write carries a causal dependency set; readers wait until dependencies are visible before serving the read.

> [!PRINCIPAL] Why causal is the sweet spot for many systems
> Causal consistency is the strongest model that avoids coordination overhead for non-conflicting writes. Facebook's Cassandra deployments and Amazon's Dynamo-style systems gravitate toward causal or "session causal" consistency because it eliminates the latency tax of global coordination while still preventing the most counterintuitive anomalies (seeing a reply before the original message, etc.). For user-facing data without hard financial invariants, this is usually the right tradeoff.

### Monotonic Reads / Monotonic Writes / Read-Your-Writes

These are **session-level** (client-scoped) guarantees, weaker than causal:

- **Read-your-writes (RYW)**: After you write a value, your subsequent reads always see it (or something newer). Essential for user experience — after you update your profile picture, you must see the updated one.
- **Monotonic reads**: Once you read value V, future reads never return a value "older" than V. Prevents time-going-backward.
- **Monotonic writes**: Your writes are applied in the order you issued them.

These can be implemented with **sticky sessions** (always route client to the same replica) or **session tokens** (version vectors attached to the client session, used to wait for the right replica state).

### Eventual Consistency

The system guarantees only that if no new updates are made to a given data item, eventually all replicas will converge to the same value. No bounds on *when*. In practice, DynamoDB's eventually consistent reads see data up to a few hundred milliseconds old under normal conditions — but during partition or overload, divergence can persist for much longer.

> [!PITFALL] "Eventual consistency" is not a specification
> It's a marketing term. Two systems both claiming eventual consistency can have wildly different convergence speeds and conflict-resolution semantics. Ask instead: what is the conflict resolution policy (last-write-wins, merge function, CRDT)? What is the measured tail latency for convergence under partition? Dynamo-style systems use LWW with wall-clock time — prone to silent data loss when clocks skew.

## CAP Theorem

Brewer's CAP theorem (2000, formalized by Gilbert & Lynch 2002): In the presence of a network **P**artition, you must choose between **C**onsistency (linearizability) and **A**vailability (every non-failing node responds).

Important nuances:
1. CAP's "consistency" means linearizability specifically — not any weaker model.
2. Partitions are rare but *must* be tolerated in any WAN system (you can't avoid P).
3. The choice isn't binary during normal operation — it's about what you do *when a partition occurs*.

CP systems (etcd, ZooKeeper, Consul): refuse writes (return error) during partition to maintain consistency. AP systems (Cassandra, Riak, CouchDB): accept writes on each side of the partition, reconcile on heal.

## PACELC: the real tradeoff model

CAP only discusses partitioned operation. **PACELC** (Abadi, 2010) extends it: even when the network is running normally (no partition), there is a latency/consistency tradeoff.

```
If Partition:  choose A or C
Else (normal): choose L(atency) or C(onsistency)
```

| System | Under Partition | Normal operation |
|---|---|---|
| etcd/ZooKeeper | CP (sacrifice A) | High C, high L (Raft round-trips) |
| DynamoDB (strong) | CP (sacrifice A) | High C, moderate L (quorum reads) |
| DynamoDB (eventual) | AP (sacrifice C) | Low L, low C |
| Cassandra (ONE) | AP | Low L, low C |
| Cassandra (QUORUM) | CP for local DC | Moderate L, high C |
| Spanner | CP | ~5ms global, TrueTime bounded |

The L cost in the "normal" column is the dominant factor for interactive workloads. At 10k RPS, adding 10 ms latency per operation to achieve linearizability means your 99th percentile doubles.

## Quorum Reads and Writes (R + W > N)

In a system with **N** replicas, a **quorum** is a majority (or any overlapping set) that guarantees you see at least one node with the latest write.

The key invariant: **R + W > N** guarantees strong consistency (you always read from at least one node that participated in the last write). Common configurations:

| N | W | R | Guarantee |
|---|---|---|---|
| 3 | 2 | 2 | Strong (quorum) |
| 3 | 3 | 1 | Strong, write-heavy latency |
| 3 | 1 | 3 | Strong, read-heavy latency |
| 3 | 1 | 1 | Eventual (no quorum overlap guaranteed) |
| 5 | 3 | 3 | Strong |
| 5 | 1 | 1 | Eventual |

The latency of a quorum operation is bounded by the **slowest of W (or R) replicas** — the kth-order statistic of replica response times. With W=2 out of N=3, you wait for the 2nd-fastest of 3 — which is much more predictable than waiting for all 3. This is why quorum is preferred over "wait for all" in practice.

> [!PRINCIPAL] Quorum does not eliminate anomalies without careful sequencing
> R + W > N guarantees *overlap*, meaning you'll always talk to a node that participated in the last acknowledged write — but only if writes are serialized by the coordinator. Without a linearizable compare-and-swap on the coordinator side, you can still get write-write conflicts (two coordinators pick the same slot). Cassandra's lightweight transactions use Paxos (SERIAL/LOCAL_SERIAL) precisely for this: a plain QUORUM write in Cassandra is not linearizable, only a CAS with IF NOT EXISTS is. Know what your database's "strong consistency" actually guarantees under concurrent writes.

## Try it yourself

Explore the full quorum space interactively. The simulation also models a "causal vs eventual" replication round to make divergence concrete.

```js run
// Quorum checker + causal vs eventual replication simulation

function checkQuorum(N, W, R) {
  const strong = (W + R) > N;
  const highAvailWrite = W <= Math.floor(N / 2) + 1;
  const highAvailRead  = R <= Math.floor(N / 2) + 1;
  return {
    N, W, R,
    strongConsistency: strong,
    writeAvailable: highAvailWrite,
    readAvailable:  highAvailRead,
    faultTolerance: Math.min(N - W, N - R),
    description: strong
      ? `STRONG: R+W=${W+R} > N=${N}; tolerates ${N-W} write failures, ${N-R} read failures`
      : `EVENTUAL: R+W=${W+R} <= N=${N}; reads may miss latest writes`
  };
}

console.log("=== Quorum Analysis ===");
const configs = [
  [3,2,2], [3,1,1], [3,3,1], [5,3,3], [5,2,2], [5,1,1], [7,4,4]
];
for (const [N,W,R] of configs) {
  const q = checkQuorum(N, W, R);
  console.log(`N=${N} W=${W} R=${R}: ${q.description}`);
}

// Causal vs eventual replication divergence model
console.log("\n=== Replication Divergence Simulation ===");

class Replica {
  constructor(id) {
    this.id = id;
    this.store = {};
    this.log = [];
  }
  write(key, value, vectorClock) {
    this.store[key] = { value, vc: vectorClock };
    this.log.push({ key, value, vc: vectorClock });
  }
  read(key) { return this.store[key]; }
}

// Simulate two replicas diverging then reconciling
const r1 = new Replica("R1");
const r2 = new Replica("R2");

// R1 gets write at t=1
r1.write("user:1", { name: "Alice", bal: 100 }, { R1: 1, R2: 0 });

// R2 gets a different write at t=1 (network partition scenario)
r2.write("user:1", { name: "Alice", bal: 90 },  { R1: 0, R2: 1 });

console.log("Before reconciliation:");
console.log("  R1 sees:", JSON.stringify(r1.read("user:1")));
console.log("  R2 sees:", JSON.stringify(r2.read("user:1")));

// Eventual: LWW — last timestamp wins (dangerous without synchronized clocks)
function lwwMerge(a, b) {
  // Compare total VC values as a naive proxy for "time"
  const aTime = Object.values(a.vc).reduce((s,v) => s+v, 0);
  const bTime = Object.values(b.vc).reduce((s,v) => s+v, 0);
  return aTime >= bTime ? a : b;
}

// Causal: detect conflict (concurrent writes), do NOT silently LWW
function causalCompare(vc1, vc2) {
  const keys = new Set([...Object.keys(vc1), ...Object.keys(vc2)]);
  let lt = false, gt = false;
  for (const k of keys) {
    const v1 = vc1[k] || 0, v2 = vc2[k] || 0;
    if (v1 < v2) lt = true;
    if (v1 > v2) gt = true;
  }
  if (!lt && !gt) return "equal";
  if (lt && !gt) return "before"; // vc1 happened-before vc2
  if (!lt && gt) return "after";  // vc1 happened-after vc2
  return "concurrent"; // genuine conflict
}

const v1 = r1.read("user:1");
const v2 = r2.read("user:1");
const relation = causalCompare(v1.vc, v2.vc);

console.log(`\nVector clock relation: ${relation}`);
if (relation === "concurrent") {
  console.log("Causal system: CONFLICT DETECTED — requires application-level resolution");
  console.log("LWW merge result:", JSON.stringify(lwwMerge(v1, v2).value));
  console.log("Better: use a CRDT (see lesson 45-clocks-crdts) or reject with optimistic locking");
} else {
  const winner = relation === "after" ? v1 : v2;
  console.log("Causal system: clear winner:", JSON.stringify(winner.value));
}
```

## Exercise: Model a real system's tradeoff

You are designing a payment ledger. Your SLA is 99.9% availability and balance correctness is non-negotiable (no double-spend).

1. Which consistency model do you require — and why?
2. What quorum configuration (N=5) gives you both correctness and fault tolerance?
3. What does PACELC say about your normal-operation latency?

<details>
<summary>Show solution</summary>

**1. Linearizability is required.** Payments involve compare-and-swap semantics (read current balance, conditionally deduct). Any weaker model risks anomalies under concurrent writes: two nodes could both read the same balance and both approve a spend, causing overdraft.

**2. N=5, W=4, R=3.** R+W=7 > 5. Tolerates 1 write failure and 2 read failures. This is aggressive on write quorum — common for financial ledgers. Alternatively: N=5, W=3, R=3 tolerates 2 write failures, still R+W=6>5.

**3. PACELC says**: even without partition, you pay latency for consistency. With W=4 across 5 replicas (potentially multi-AZ), your write latency is bounded by the 4th-fastest replica — likely P99 ~20-30ms in a single-region, multi-AZ setup. Across regions it becomes 100ms+. This is why Stripe and Visa keep financial state in a single-region primary and asynchronously replicate to DR, accepting some availability risk in exchange for single-digit-ms write latency.

```js run
// PACELC latency model: kth-order statistic of replica latencies
function simulateQuorumLatency(replicaLatencies, W) {
  // Sort ascending; quorum latency = Wth smallest (0-indexed: W-1)
  const sorted = [...replicaLatencies].sort((a, b) => a - b);
  return sorted[W - 1]; // must wait for the Wth response
}

// Simulated latencies (ms) for 5 replicas in a multi-AZ setup
const azLatencies = [2, 3, 4, 8, 25]; // p50s per AZ (last one is stretched)

for (const W of [1, 2, 3, 4, 5]) {
  const lat = simulateQuorumLatency(azLatencies, W);
  console.log(`W=${W}: quorum latency ~${lat}ms (R+W>5: ${W+3}>5: ${W+3>5})`);
}
```

</details>

## Common pitfalls

> [!PITFALL] Confusing read-your-writes with linearizability
> A system can guarantee read-your-writes (your own reads see your own writes) without being linearizable. DynamoDB's eventual reads + strongly consistent writes + client-side session routing gives you RYW without linearizability. This is fine for UI but inadequate for financial invariants. Always check whether the guarantee is *global* (all clients) or *session-local* (just this client).

> [!PITFALL] Assuming quorum = linearizable in Cassandra
> Cassandra QUORUM read+write satisfies R+W>N but Cassandra coordinators do not perform atomic compare-and-swap. Two concurrent coordinators can both read the same state and both write, creating a conflict resolved by LWW. Use Cassandra's lightweight transactions (SERIAL consistency, Paxos under the hood) when you need linearizability. Expect 3–4x latency increase.

## What you learned

- Consistency models form a hierarchy: strict → linearizable → sequential → causal → monotonic → eventual. Each step weakens guarantees and improves availability/latency.
- CAP says you can't have both C (linearizability) and A (availability) under partition; PACELC extends this to the normal-operation L vs C tradeoff.
- Read-your-writes, monotonic reads, and monotonic writes are *session-level* guarantees, weaker than causal.
- Quorum invariant R + W > N ensures overlap with the latest write, but linearizability also requires serialization at the coordinator.
- Strong consistency in WAN systems costs ~50–100ms per write; design accordingly.

## Next steps

Quorums and consistency models assume replicas can agree on what "the latest write" means. But how do multiple nodes agree on anything without a trusted coordinator? That's the consensus problem — covered next in Raft leader election and log replication.
*/});
