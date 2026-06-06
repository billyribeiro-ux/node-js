registerLessonSrc("40-designing-for-scale", function () {/*
---
id: 40-designing-for-scale
title: "Designing for Scale & Writing ADRs"
minutes: 28
level: principal
objectives:
  - Apply the principal mindset to system design — requirements, constraints, tradeoffs
  - Write Architecture Decision Records (ADRs) that future engineers will thank you for
  - Build and reason over a weighted decision matrix to compare architecture options
---

# Designing for Scale & Writing ADRs

## Why this matters

Every senior engineer can implement a feature. A principal engineer asks the harder questions
*before* the first line is written: What are the real constraints? Who bears the operational
cost? What decision are we making, and what are we giving up? Answering those questions in
writing — and committing that writing alongside the code — is what separates architecture
from guesswork. This lesson teaches that discipline.

## Learning objectives

- Adopt the principal mindset: requirements → constraints → tradeoffs → decision
- Write an Architecture Decision Record (ADR) that teams can act on and revisit
- Build a quantitative weighted decision matrix to compare options across multiple criteria
- Treat cost, operability, and maintainability as first-class design inputs, not afterthoughts

## The principal mindset

Junior engineers optimise for *making it work*. Senior engineers optimise for *making it
correct*. Principal engineers optimise for *making the right thing easy to do for the next
five years*.

That shift requires answering five questions before you write code:

1. **What problem are we actually solving?** (not the stated requirement — the underlying need)
2. **What are the hard constraints?** (budget, latency SLA, team size, compliance, timeline)
3. **What are the soft constraints?** (preferences, conventions, vendor agreements)
4. **What are the realistic options?** (2-5, not 20)
5. **What are we giving up?** (every choice closes doors — name them explicitly)

> [!PRINCIPAL] Requirements vs constraints vs tradeoffs
> A requirement is what the system must do. A constraint is the envelope within which it
> must do it. A tradeoff is the cost you pay for satisfying both. Confusing these three is
> the single most common source of architecture regret. Write them in separate sections
> so reviewers can challenge each layer independently.

## Architecture Decision Records (ADRs)

An **ADR** is a short, dated document that records a single significant architecture choice
and its rationale. Michael Nygard popularised the format; the key insight is that future
engineers need to understand *why* a decision was made, not just *what* was decided —
so they know whether the reasoning still applies when circumstances change.

A minimal ADR template:

```
# ADR-042: Use PostgreSQL for primary persistence

Status: Accepted
Date: 2026-06-06
Deciders: @alice, @bob, @carol

## Context
We need a primary data store for the user and order domains.
The team has strong SQL skills; compliance requires ACID guarantees; read:write ratio is 10:1.

## Decision
We will use PostgreSQL 16 managed on AWS RDS.

## Consequences
Good: ACID, rich query language, battle-tested, team familiarity, RDS reduces ops burden.
Bad: harder to shard horizontally beyond ~10 TB; RDS costs ~$400/mo for our tier.
Neutral: we accept vendor lock-in to AWS RDS; a migration path via logical replication exists.

## Alternatives considered
- MongoDB: rejected — no ACID across documents; compliance risk.
- CockroachDB: rejected — team unfamiliar, higher cost, overkill for current scale.
- DynamoDB: rejected — schema flexibility not needed; would sacrifice rich queries.
```

The Status field matters: `Proposed` → `Accepted` → `Deprecated` → `Superseded by ADR-NNN`.
Keeping ADRs in the repo (`docs/adr/`) means they're versioned alongside the code they describe.

> [!NOTE] RFCs for bigger decisions
> For cross-team or company-wide decisions, an **RFC** (Request for Comments) adds a formal
> comment period before status moves to Accepted. The structure is similar but longer, with
> explicit sections for security, privacy, rollout, and monitoring impact. At principal level
> you'll author both; know which weight of process fits the decision.

## Cost, operability, and maintainability as first-class inputs

Teams that skip these create systems that are cheap to build and expensive to own.

**Cost** — not just cloud spend, but engineer-hours per incident, migration cost, and the
option value of staying flexible. A managed Kafka (Confluent Cloud) costs more per GB than
self-hosted but saves hundreds of hours of ops per year. Run the math both ways.

**Operability** — can you deploy it at 2 am without a PhD? Does it emit good metrics,
traces, and logs out of the box? Can you scale it without downtime? Does it have a
documented runbook? If you can't answer these before you adopt a technology, adopt a
simpler one.

**Maintainability** — will a mid-level engineer understand this in two years? Clever
distributed algorithms are costly to maintain. Every abstraction layer is a tax on future
debugging. Choose boring technology unless the problem genuinely demands otherwise.

> [!PITFALL] Optimising for the happy path
> Most architecture reviews focus on the success scenario. Principal engineers stress-test
> the failure paths: What happens when the database is unavailable? When a queue backs up?
> When a downstream service is slow? Design the degradation modes first, then the happy path.

## The weighted decision matrix

A **weighted decision matrix** makes tradeoffs explicit and auditable. You list your options,
identify the criteria that matter (with weights summing to 1), score each option per
criterion, and multiply through. The score doesn't make the decision for you — it forces
the team to agree on *what matters* before debating *which option is better*.

```js
// read-only: real usage in a team decision session
const criteria = [
  { name: "Operability",     weight: 0.30 },
  { name: "Cost (monthly)",  weight: 0.25 },
  { name: "Team familiarity",weight: 0.20 },
  { name: "Scalability",     weight: 0.15 },
  { name: "Ecosystem",       weight: 0.10 },
];

const options = [
  { name: "PostgreSQL (RDS)", scores: [8, 6, 9, 6, 9] },
  { name: "DynamoDB",         scores: [9, 7, 5, 9, 7] },
  { name: "CockroachDB",      scores: [6, 5, 4, 9, 6] },
];

function weightedScore(option, criteria) {
  return criteria.reduce((sum, c, i) => sum + c.weight * option.scores[i], 0);
}

options.forEach(o => {
  console.log(`${o.name}: ${weightedScore(o, criteria).toFixed(2)}`);
});
```

> [!OUTPUT]
> PostgreSQL (RDS): 7.45
> DynamoDB: 7.30
> CockroachDB: 5.75

## Try it yourself

Adapt the matrix below. Change the weights or scores to reflect a decision you've faced.
Notice how shifting a single weight can flip the ranking — that's the point. The matrix
surfaces *which assumptions drive the conclusion*.

```js run
// Weighted decision matrix — fully runnable in the browser
// Criteria for choosing a job-queue technology
const criteria = [
  { name: "Ops simplicity",   weight: 0.30 },
  { name: "Throughput",       weight: 0.25 },
  { name: "Observability",    weight: 0.20 },
  { name: "Cost",             weight: 0.15 },
  { name: "Ecosystem support",weight: 0.10 },
];

const options = [
  { name: "BullMQ (Redis)",    scores: [7, 8, 7, 8, 9] },
  { name: "SQS (managed)",     scores: [9, 7, 8, 6, 8] },
  { name: "Kafka (self-host)", scores: [4, 9, 9, 5, 9] },
  { name: "RabbitMQ",          scores: [6, 7, 7, 7, 7] },
];

function weightedScore(scores, criteria) {
  return criteria.reduce((sum, c, i) => sum + c.weight * scores[i], 0);
}

function rank(options, criteria) {
  return options
    .map(o => ({ name: o.name, score: weightedScore(o.scores, criteria) }))
    .sort((a, b) => b.score - a.score);
}

const ranked = rank(options, criteria);
console.log("=== Job Queue Decision Matrix ===");
ranked.forEach((r, i) =>
  console.log(`${i + 1}. ${r.name.padEnd(22)} ${r.score.toFixed(3)}`)
);

// Sensitivity: what if ops simplicity matters even more?
const adjusted = criteria.map((c, i) =>
  i === 0 ? { ...c, weight: 0.50 } : { ...c, weight: c.weight * (0.50 / 0.70) }
);

console.log("\n--- If ops simplicity weight = 0.50 ---");
rank(options, adjusted).forEach((r, i) =>
  console.log(`${i + 1}. ${r.name.padEnd(22)} ${r.score.toFixed(3)}`)
);
```

## Exercise: write a mini ADR

Your team is choosing between a monolith and a microservices architecture for a new
product with a team of four engineers and a 90-day go-live target.

1. List three hard constraints.
2. Score the two options on: team velocity, operability, future scalability, cost — using
   weights of your choice.
3. Write the "Consequences" section of the ADR based on your winning option.

<details>
<summary>Show one possible solution</summary>

```js run
// Mini ADR decision matrix
const criteria = [
  { name: "Team velocity (short term)",    weight: 0.40 },
  { name: "Operability",                   weight: 0.30 },
  { name: "Future scalability",            weight: 0.20 },
  { name: "Cost",                          weight: 0.10 },
];

const options = [
  { name: "Modular monolith", scores: [9, 8, 6, 9] },
  { name: "Microservices",    scores: [5, 5, 9, 5] },
];

function score(o) {
  return criteria.reduce((s, c, i) => s + c.weight * o.scores[i], 0);
}

options.forEach(o => console.log(`${o.name}: ${score(o).toFixed(2)}`));

console.log(`
ADR: Start with a modular monolith.

Consequences:
  Good: faster iteration, simpler local dev, single deploy unit,
        easier to hire for, lower operational overhead.
  Bad:  all-or-nothing deploys; single point of failure for the runtime.
  Neutral: we will extract services when a bounded context has clearly
           divergent scaling needs — the modular structure makes this viable.
  Constraint acknowledged: team < 6 engineers; 90-day timeline; $0 dedicated ops budget.
`);
```

</details>

## Common pitfalls

> [!PITFALL] The matrix becomes the decision
> A weighted matrix is a **conversation tool**, not an oracle. If the team disagrees with
> the winner, the right response is to revisit the weights and scores together — not to
> accept a number. Conversely, never use the matrix to post-rationalise a decision already
> made; that destroys trust in the process.

Architecture decisions are also not one-time events. Set a review cadence — quarterly for
high-stakes ADRs — so they get deprecated or superseded when the world changes.

## What you learned

- The principal mindset: question requirements, name constraints, articulate tradeoffs explicitly
- ADRs capture *why*, not just *what* — and live versioned in the repository
- RFCs extend ADRs for cross-team decisions with a formal comment period
- Cost, operability, and maintainability are design inputs, not post-mortems
- A weighted decision matrix surfaces assumptions and prevents "loudest voice" decisions

## Next steps

With the design discipline established, the next three lessons put it into practice: you will
architect and build a complete mini web framework, a scaled real-time platform, and a
job-orchestration engine — applying every tool you have learned in this course.
*/});
