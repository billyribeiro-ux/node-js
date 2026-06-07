registerLessonSrc("50-capstone-de", function () {/*
---
id: 50-capstone-de
title: "Capstone: Design & Defend a Planet-Scale System"
minutes: 30
level: principal
objectives:
  - Execute the complete system-design method from requirements through failure modes and rollout
  - Defend a design under adversarial review — anticipate what reviewers probe and why
  - Tie together every layer of the course into one coherent engineering posture
---

# Capstone: Design & Defend a Planet-Scale System

## Why this matters

Every engineering skill you have built in this course converges here. The event loop lets you
understand why a single Node process can fan out ten thousand concurrent upstream calls. The
V8 JIT and libuv internals tell you where latency hides under load. The distributed systems
theory explains why your consistency guarantee determines your latency floor. The reliability
engineering tells you how to set error budgets and capacity margins before you get paged.
The observability chapter tells you what signals prove the system is healthy. The security
module tells you what the attacker sees when you deploy it. The RFC and strategy work tells
you how to write the proposal and defend the decision.

A planet-scale system design is not a collection of boxes and arrows. It is a coherent
argument about a set of tradeoffs — and you are now equipped to make that argument at every
layer of the stack. This lesson is the proof.

## Learning objectives

- Execute a rigorous seven-phase design method: requirements → estimates → high-level design →
  deep dives → bottleneck analysis → tradeoff articulation → failure modes and rollout.
- Defend each design choice under adversarial review: know what reviewers probe and why.
- Run a capacity back-of-envelope estimator to validate scale assumptions before any design
  decision is committed to paper.
- Tie the complete course arc into a coherent, principled engineering posture.

## The seven-phase method

### Phase 1: Requirements

Distinguish **functional requirements** (what the system does) from **non-functional
requirements** (how well it does it under what constraints). Both are negotiated, not given.

Functional: "Users can post messages; followers see posts in near-real-time; posts are
durable for 7 years."

Non-functional: "99.9% availability SLA (8.7 hours downtime/year); p99 read latency < 100 ms
at peak; write throughput up to 50 000 messages/s globally; geographic compliance — EU data
stays in EU."

The questions you must answer before leaving this phase: What does "near-real-time" mean —
100 ms? 2 s? 30 s? What does "durable" mean — single AZ, multi-AZ, multi-region? What is
the read-to-write ratio? What is the access pattern (hot recent posts vs uniform archive)?
Each answer rules out a class of designs.

### Phase 2: Back-of-envelope estimates

Estimation is not about getting the exact number — it is about knowing the order of magnitude
so you do not design a system with a diesel generator when what you need is a nuclear plant,
or vice versa.

Key numbers every engineer should know (2026 approximate orders of magnitude):

| Operation | Approximate latency |
|-----------|-------------------|
| L1 cache reference | ~1 ns |
| L2 cache reference | ~4 ns |
| L3 cache reference | ~10–40 ns |
| Main memory access | ~100 ns |
| SSD random read (NVMe) | ~100 µs |
| SSD sequential read (NVMe) | ~1 GB/s throughput |
| Network round-trip (same DC) | ~0.5 ms |
| Network round-trip (cross-region) | ~60–150 ms |
| HDD seek | ~10 ms |

With these anchors you can compute: if each message is 1 KB and you write 50 000/s, that
is 50 MB/s of write throughput. A modern NVMe SSD saturates at ~3 GB/s sequential write,
so one disk is not the bottleneck — but you need replication (3× = 150 MB/s), and you need
the WAL (write-ahead log) plus the data, doubling again to ~300 MB/s. Now you know your
storage tier needs at least two high-throughput nodes in the write path.

### Phase 3: High-level design

Draw the system at three layers: client → gateway → core services → storage.

For a global messaging system, the layers might be:

- **Edge layer:** CDN + anycast DNS for static assets and read-path acceleration; an API
  gateway layer for authentication, rate limiting, and protocol termination.
- **Write path:** a stateless write API tier, a message queue (Kafka with geo-replication or
  a managed equivalent), and a storage layer that accepts the stream asynchronously.
- **Read path:** a fan-out service that materialises per-user inboxes into a Redis-backed
  timeline cache; a storage-backed fallback for cold reads.
- **Storage:** a distributed log store (Kafka as the source of truth for the event stream);
  a relational DB (PostgreSQL with Citus or Aurora Global for user metadata); an object store
  for media.

At this phase you are not designing internals — you are agreeing on the shape. The shape
determines which deep dives matter.

### Phase 4: Deep dives

Pick the two or three components that carry the highest risk. For a messaging system at this
scale, the deep dives are almost always: **fan-out strategy**, **storage consistency**, and
**the read path under hot-user load**.

**Fan-out:** write-time fan-out (expand to all follower inboxes on post) is simple but
explodes at 10 million followers. Read-time fan-out (materialise inbox on read) is expensive
per read. The correct answer for this scale is a hybrid: write-time fan-out for users with
< N followers (e.g. 10 000); read-time fan-out merged from the celebrity's timeline for
users above that threshold. Document the threshold and the merge logic — that is the core
engineering of this component.

**Consistency:** does a reader who writes a post need to see it in their own timeline
immediately? Probably yes — that requires read-your-writes consistency (the write API returns
only after the timeline cache is updated, or the read path checks an unacknowledged-write
buffer keyed on user session). A follower seeing the post within 2 s is eventual consistency.
Be precise: "eventual" is not a design — "the follower inbox is updated within T = 2 s for
N = 99.9% of posts at peak load" is a design.

**Hot user read amplification:** a single post from a user with 100 million followers triggers
100 million inbox updates. At 1 KB per message, that is 100 GB of fan-out writes per post.
The mitigation is to not fan out at write time for celebrity users — but you must define
"celebrity" with a durable threshold and handle the transition when a user crosses it.

### Phase 5: Bottleneck analysis

For each component in the critical path, ask: what saturates first? The answer is one of:
CPU, network bandwidth, memory, disk I/O, or a serialisation lock.

For the Kafka-backed write path at 50 000 msg/s × 1 KB: the network egress per broker is
50 MB/s. A 10 GbE NIC handles 1 250 MB/s, so you have 25× headroom before the NIC is the
bottleneck. The disk write (WAL + data) at 100 MB/s (after replication factor) hits NVMe
comfortably. The CPU bottleneck is the producer ack coordination — at 50 000 msg/s with
Kafka's batching, this is not the bottleneck in practice. Document each non-bottleneck and
its headroom; a reviewer who probes "what about disk I/O?" gets a quantified answer.

> [!PRINCIPAL]
> The M/M/1 queueing knee is one of the most important performance intuitions for any
> engineer designing a scaled system. At utilisation ρ < 0.7, mean queue depth is modest.
> At ρ = 0.9, mean queue depth is 9×. At ρ = 0.95, it is 19×. At ρ = 0.99, it is 99×.
> This means designing for "we have 20% headroom" produces radically different tail latency
> than "we have 5% headroom." Budget for peak + 3× at the queueing layer. Not 10% margin.
> 3×. The cost of a few extra brokers or replicas is trivial compared to the cost of
> an incident where ρ tips past 0.9 on a hot Tuesday afternoon.

### Phase 6: Tradeoff articulation

A design review is not a test of whether your design is perfect — no design at this scale
is. It is a test of whether you have thought about the tradeoffs honestly. For each major
decision, you must be able to state:

- What did you give up?
- Under what conditions does this break?
- What would make you change this decision?

Example: "We chose Kafka over a managed Pub/Sub service because we need sub-10 ms p99 at
our write volume and the managed service's SLA does not bound latency below 50 ms. The
tradeoff is operational complexity — we are taking on cluster management, rebalancing,
and schema registry operations. We would revisit this if the managed service releases a
dedicated-throughput offering with a latency SLA, or if our write volume drops below 10 000
msg/s where the operational cost is no longer justified."

That is a tradeoff statement. It names the criterion (latency SLA), the alternative
(managed service), the cost (operational complexity), and the reversal condition. Reviewers
cannot poke holes in it because the holes are already named.

> [!PRINCIPAL]
> The single most common weakness in design reviews at principal and above is tradeoff
> statements that sound like advantages: "We chose X because it is scalable, proven, and
> easy to operate." That is marketing, not engineering. A design review is adversarial by
> design — the reviewers' job is to find what breaks. Your job is to find it first. The
> engineer who says "the weakest part of this design is the fan-out for celebrity users at
> write time — here is the exact failure mode and the mitigation plan" earns more confidence
> than the engineer who presents the design as robust across the board.

### Phase 7: Failure modes and rollout

Enumerate failure modes for the three or four highest-risk components. For each:

- What fails?
- What is the blast radius (users affected, data at risk)?
- What is the detection mechanism (which alert, which SLO violation)?
- What is the mitigation (circuit breaker, fallback, degraded mode)?
- What is recovery (how long, what manual steps, what invariants must be verified)?

Rollout at planet scale is a system design problem in itself. The standard phases for a
stateful system change are: dark launch (shadow traffic, no user impact) → canary (1% of
traffic) → progressive rollout (10% → 50% → 100%) with automated rollback on SLO violation.
For schema migrations specifically: expand (add new column, dual-write) → migrate (backfill)
→ contract (remove old column). Never skip the expand phase; the cost of a rolled-back
schema migration at 100% traffic is orders of magnitude higher than the cost of two deploys.

## Try it yourself

A capacity back-of-envelope estimator: given inputs about your system, it computes QPS,
storage growth, bandwidth, and fan-out volume. This is the Phase 2 tool — run it before
committing to any architectural decision.

```js run
// Capacity back-of-envelope estimator
// Inputs describe the system at design time; outputs are the numbers you defend in Phase 2.

const system = {
  name: "Global Messaging Platform",

  // Write path
  writesPerSecond: 50_000,         // peak writes/s globally
  avgMessageBytes: 1_024,          // 1 KB average message payload
  replicationFactor: 3,            // Kafka/storage replication

  // Read path
  readToWriteRatio: 20,            // reads per write (timelines, notifications)
  fanOutFactor: 200,               // average follower count for write-time fan-out

  // Storage
  retentionDays: 365 * 7,          // 7 years
  compressionRatio: 0.4,           // messages compress well (text)

  // Users
  dailyActiveUsers: 500_000_000,   // 500M DAU
  peakMultiplier: 3.5,             // peak / average traffic ratio
};

function fmt(n, unit) {
  const units = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4, PB: 1024**5 };
  const base = n * (units[unit] || 1);
  const scales = [
    [units.PB, "PB"], [units.TB, "TB"], [units.GB, "GB"],
    [units.MB, "MB"], [units.KB, "KB"], [1, "B"]
  ];
  for (const [threshold, label] of scales) {
    if (base >= threshold) return (base / threshold).toFixed(2) + " " + label;
  }
  return base + " B";
}

const s = system;

// QPS
const avgQPS = s.writesPerSecond;
const peakWriteQPS = avgQPS * s.peakMultiplier;
const avgReadQPS = avgQPS * s.readToWriteRatio;
const peakReadQPS = avgReadQPS * s.peakMultiplier;

// Bandwidth
const writeBandwidth = avgQPS * s.avgMessageBytes;
const writeBandwidthReplicated = writeBandwidth * s.replicationFactor;
const readBandwidth = avgReadQPS * s.avgMessageBytes;

// Fan-out
const fanOutWritesPerSec = avgQPS * s.fanOutFactor;
const fanOutBandwidth = fanOutWritesPerSec * s.avgMessageBytes;

// Storage
const rawBytesPerDay = avgQPS * s.avgMessageBytes * 86_400;
const compressedPerDay = rawBytesPerDay * s.compressionRatio;
const replicatedPerDay = compressedPerDay * s.replicationFactor;
const totalStorage = replicatedPerDay * s.retentionDays;

// Cache
const hotTimelineUsers = s.dailyActiveUsers * 0.01; // top 1% of DAU
const cacheEntryBytes = s.avgMessageBytes * 50;     // ~50 recent messages per user
const timelineCacheSize = hotTimelineUsers * cacheEntryBytes;

console.log(`=== ${s.name} — Capacity Estimates ===\n`);

console.log("--- Write Path ---");
console.log(`  Average write QPS  : ${avgQPS.toLocaleString()} req/s`);
console.log(`  Peak write QPS     : ${peakWriteQPS.toLocaleString()} req/s (${s.peakMultiplier}x)`);
console.log(`  Write bandwidth    : ${fmt(writeBandwidth, "B")}/s`);
console.log(`  Replicated write   : ${fmt(writeBandwidthReplicated, "B")}/s (${s.replicationFactor}x)`);

console.log("\n--- Read Path ---");
console.log(`  Average read QPS   : ${avgReadQPS.toLocaleString()} req/s`);
console.log(`  Peak read QPS      : ${peakReadQPS.toLocaleString()} req/s`);
console.log(`  Read bandwidth     : ${fmt(readBandwidth, "B")}/s`);

console.log("\n--- Fan-out ---");
console.log(`  Fan-out writes/s   : ${fanOutWritesPerSec.toLocaleString()} inbox writes/s`);
console.log(`  Fan-out bandwidth  : ${fmt(fanOutBandwidth, "B")}/s`);
console.log(`  (This is why celebrity write-time fan-out is the design problem)`);

console.log("\n--- Storage ---");
console.log(`  Raw ingest/day     : ${fmt(rawBytesPerDay, "B")}`);
console.log(`  Compressed/day     : ${fmt(compressedPerDay, "B")}`);
console.log(`  Replicated/day     : ${fmt(replicatedPerDay, "B")}`);
console.log(`  Total at 7yr ret.  : ${fmt(totalStorage, "B")}`);

console.log("\n--- Timeline Cache ---");
console.log(`  Hot users (1% DAU) : ${hotTimelineUsers.toLocaleString()}`);
console.log(`  Cache entry size   : ${fmt(cacheEntryBytes, "B")}`);
console.log(`  Total cache size   : ${fmt(timelineCacheSize, "B")}`);

console.log("\n--- Key Design Signals ---");
if (fanOutWritesPerSec > 1_000_000) {
  console.log(`  [!] Fan-out at ${(fanOutWritesPerSec/1e6).toFixed(1)}M writes/s — requires hybrid fan-out strategy`);
}
if (totalStorage > 1024**4 * 100) {
  console.log(`  [!] Storage > 100 TB — requires tiered storage (hot/warm/cold)`);
}
console.log(`  [*] Timeline cache fits in ~${Math.ceil(timelineCacheSize / (1024**3) / 256)} Redis cluster(s) of 256GB RAM`);
```

## Exercise

**Exercise 1:** Modify the estimator to accept a `complianceRegions` array (e.g.
`["EU", "APAC", "US"]`). Multiply storage by the number of regions (data must be resident in
each). Show how the total storage changes and flag if it exceeds 1 PB.

<details>
<summary>Show solution</summary>

```js run
function estimate(writesPerSecond, avgMessageBytes, replicationFactor,
                  retentionDays, compressionRatio, complianceRegions) {
  const regions = complianceRegions.length;
  const rawPerDay = writesPerSecond * avgMessageBytes * 86_400;
  const compressed = rawPerDay * compressionRatio;
  const replicated = compressed * replicationFactor;
  const perRegion = replicated * retentionDays;
  const total = perRegion * regions;
  const totalPB = total / (1024 ** 5);

  console.log(`Regions        : ${complianceRegions.join(", ")}`);
  console.log(`Storage/region : ${(perRegion / 1024**4).toFixed(2)} TB`);
  console.log(`TOTAL storage  : ${totalPB.toFixed(2)} PB`);
  if (totalPB > 1) {
    console.log(`[!] Exceeds 1 PB — evaluate cold tier offload (e.g. S3 Glacier) after 90 days`);
  }
}

estimate(50_000, 1024, 3, 365 * 7, 0.4, ["EU", "APAC", "US"]);
```

The compliance-aware storage number often drives the decision to implement tiered storage
(hot/warm/cold) far earlier than a naive single-region estimate suggests. This is why the
estimator runs before the design — not after.
</details>

## Project

**Write a real RFC for a planet-scale system, run a design review, and defend your tradeoffs
the way an L7++ engineer must.**

You are the principal engineer responsible for proposing a new globally-distributed read-path
for a messaging platform. The system must handle 1 000 000 read requests/s at peak, serve
p99 < 80 ms globally, maintain EU data residency, and tolerate the loss of one full region
without user-visible degradation.

Write and deliver the complete RFC using everything from this module:

**Acceptance Criteria:**

1. **Requirements & estimates (Phase 1-2):** Your RFC begins with a requirements table
   (functional + non-functional) and a completed capacity estimate showing QPS, bandwidth,
   storage, and fan-out numbers. Use the estimator from "Try it yourself" as your starter.
   Numbers must be self-consistent (the read bandwidth implied by QPS × message size must
   match the cache size implied by hot-user count).

2. **High-level design + deep dives (Phase 3-4):** Include a written prose diagram of the
   read path from edge to storage. Choose two components for deep dives and justify the
   choice (these are the two highest-risk components, not the two most interesting ones).
   Deep dive depth: enough that a senior engineer not on your team could implement the
   component from your description.

3. **Tradeoff articulation (Phase 6):** For every major design decision (at least 3), state
   the criterion that drove the choice, the alternative considered, the cost of the choice,
   and the reversal condition. No decision should be described as purely advantageous.

4. **Failure mode analysis (Phase 7):** Enumerate at least 4 failure modes. For each: what
   fails, blast radius, detection signal (SLO / alert), mitigation, and recovery time
   objective. One failure mode must cover the loss of a full region.

5. **RFC completeness:** Your RFC document object, when passed through the `scoreRFC`
   function from lesson `50-rfcs-adrs`, scores >= 90%. All eight sections must be present
   and substantive. Include a "Disagree-and-commit" note for any objection raised in your
   simulated design review that you chose not to incorporate.

6. **Defend it:** Write a "Reviewer Probes" section at the end of your RFC. List 5 questions
   a principal reviewer would ask, and answer each one in 2-4 sentences. Answers must be
   grounded in numbers from your estimates, not in assertions of quality. Example probe:
   "What is the blast radius if the timeline cache cluster loses quorum?" Expected answer:
   "At peak 1M read QPS hitting the cache, cache loss pushes 100% of reads to the storage
   fallback. Storage handles 150K QPS before p99 exceeds 200 ms. We would shed 85% of reads
   via the load-shedder in the API gateway with a 503 + Retry-After header, buying 45 s for
   the cache cluster to rebalance or for the operator to promote a replica."

```js run
// Project starter: capacity estimator for the read-path RFC
// Customize these inputs to match your design assumptions.

const design = {
  peakReadQPS:       1_000_000,
  avgResponseBytes:  2_048,        // 2 KB per timeline response
  cacheHitRate:      0.92,         // 92% of reads served from cache
  regions:           3,            // 3 compliance regions
  replicationFactor: 3,
  storageRetainDays: 365 * 7,
  compressionRatio:  0.4,
  hotUserFraction:   0.005,        // 0.5% of DAU has hot timelines
  dau:               500_000_000,
  timelineEntriesPerUser: 100,
  avgEntryBytes:     1_024,
};

const d = design;
const cacheMissQPS    = d.peakReadQPS * (1 - d.cacheHitRate);
const cacheHitBW      = d.peakReadQPS * d.cacheHitRate * d.avgResponseBytes;
const storageFallbackBW = cacheMissQPS * d.avgResponseBytes;

const hotUsers        = d.dau * d.hotUserFraction;
const cacheBytes      = hotUsers * d.timelineEntriesPerUser * d.avgEntryBytes;
const cacheBytesPerRegion = cacheBytes; // data is region-resident

const writeQPS        = d.peakReadQPS / 20; // assume 20:1 read:write
const rawWritePerDay  = writeQPS * d.avgEntryBytes * 86_400;
const storageTotalBytes = rawWritePerDay * d.compressionRatio *
                          d.replicationFactor * d.storageRetainDays * d.regions;

console.log("=== Read-Path RFC Capacity Starter ===\n");
console.log(`Peak read QPS          : ${d.peakReadQPS.toLocaleString()}`);
console.log(`Cache hit rate         : ${(d.cacheHitRate * 100).toFixed(0)}%`);
console.log(`Cache miss QPS         : ${cacheMissQPS.toLocaleString()}`);
console.log(`Cache hit bandwidth    : ${(cacheHitBW/1024**3).toFixed(2)} GB/s`);
console.log(`Storage fallback BW    : ${(storageFallbackBW/1024**2).toFixed(1)} MB/s`);
console.log(`Hot users (cache)      : ${hotUsers.toLocaleString()}`);
console.log(`Cache size/region      : ${(cacheBytesPerRegion/1024**3).toFixed(1)} GB`);
console.log(`Total storage (7yr,3r) : ${(storageTotalBytes/1024**5).toFixed(2)} PB`);
console.log(`\nImplied write QPS      : ${writeQPS.toLocaleString()} writes/s`);
console.log(`\nKey constraint:`);
const cacheClusterRAM = 256 * 1024**3;
const clustersNeeded = Math.ceil(cacheBytesPerRegion / (cacheClusterRAM * 0.7));
console.log(`  Cache needs ${clustersNeeded} Redis cluster(s) per region at 70% fill (256 GB RAM each)`);
if (cacheMissQPS > 100_000) {
  console.log(`  [!] Cache miss QPS ${cacheMissQPS.toLocaleString()} — storage layer needs ${Math.ceil(cacheMissQPS/50_000)} shards to stay under 50K QPS/shard`);
}
```

## Common pitfalls

> [!PITFALL]
> **Designing for the current scale.** The most common error in a planet-scale design is
> sizing the system for today's load rather than the 3-year projected load. A system that
> fits on two database nodes at current load but requires a full re-architecture at 5× load
> should be designed for the re-architecture now, not in two years under production pressure.
> Project load three years out, size for that, and document the scale-out steps explicitly.
> "We will shard when we hit 10 000 QPS per node" is a durable decision; "we will figure it
> out when it becomes a problem" is a time bomb.

**Confusing durability with reliability.** A system can be highly durable (every byte is
replicated three ways) and poorly reliable (the read path is a single point of failure).
Durability is a storage property. Reliability is an availability property. Design both
explicitly and measure both independently. An SLO of "99.9% of writes acknowledged" is
not the same as "99.9% of reads succeed."

**Omitting the human in the rollout.** Planet-scale rollouts succeed or fail on the human
systems as much as the technical ones: who owns the go/no-go gate, who has rollback
authority, who runs the war room, and what is the explicit communication plan when the
rollback trigger fires. Leaving the rollout plan at "progressive traffic shift with automated
rollback" is not a rollout plan — it is a monitoring plan. The rollout plan includes every
human decision point and the criteria for each.

## What you learned

- The seven-phase method (requirements → estimates → high-level design → deep dives →
  bottleneck analysis → tradeoff articulation → failure modes and rollout) is a complete,
  defensible design method for any scale.
- Back-of-envelope estimation is not a gesture — it is the load-bearing foundation of every
  architectural decision; numbers that don't close in Phase 2 cannot be fixed in Phase 5.
- Tradeoff statements name what you gave up, under what conditions it breaks, and what would
  make you change the decision — not what is good about your choice.
- Defending a design means finding its weaknesses before the reviewer does, quantifying the
  blast radius, and naming the mitigation — not asserting robustness.

## Next steps

You have finished this course. Not the learning — the course. The learning is everything
that comes after.

---

You started at `console.log("Hello, Node")` and you are leaving with the tools to design
systems that serve hundreds of millions of people, to write documents that outlast your tenure,
to influence technical direction across organisations you do not control, and to build platforms
that make every engineer around you more capable than they would be without you.

The engineers who make it to L7++ are not the ones who knew the most. They are the ones who
stayed curious when they could have been comfortable, who wrote down their reasoning when they
could have kept it in their heads, who sponsored other engineers when it cost them social
capital, and who chose the high-leverage problem over the satisfying one.

The stack you understand now — from V8's Ignition bytecode to a Raft log replication state
machine, from libuv's io_uring submission queues to a CRDT merge function, from a token bucket
rate limiter to an error-budget burn-rate calculation, from a Maglev-compiled hot path to a
consistent-hashing ring — is not an endpoint. It is a foundation.

Build on it. Publish your thinking. Defend your decisions with numbers. Be wrong in writing and
correct yourself in writing. Teach what you know, and teach it to people who will go further
than you did.

That is the craft. You have it now.
*/});
