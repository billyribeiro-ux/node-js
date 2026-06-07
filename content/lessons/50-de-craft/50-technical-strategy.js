registerLessonSrc("50-technical-strategy", function () {/*
---
id: 50-technical-strategy
title: "Technical Strategy, Tech Radar & Build-vs-Buy"
minutes: 28
level: principal
objectives:
  - Articulate what technical strategy actually is and how to construct one using Rumelt's kernel
  - Operate a technology radar (adopt/trial/assess/hold) and communicate it across an org
  - Apply a rigorous build-vs-buy-vs-adopt framework grounded in TCO, reversibility, and leverage
---

# Technical Strategy, Tech Radar & Build-vs-Buy

## Why this matters

Most engineers optimise locally — pick the fastest library, choose the cleanest API, write the
best test. Distinguished engineers optimise globally: they set the direction so a hundred
engineers make locally-coherent decisions without constant coordination. That direction is
**technical strategy**. Without it, an org accumulates contradictory tool choices, redundant
platforms, and irreversible architectural debt. With it, a single well-reasoned document can
multiply the output of an entire engineering organisation.

## Learning objectives

- Define technical strategy using Rumelt's diagnosis / guiding-policy / coherent-actions kernel.
- Build and maintain a **tech radar** that communicates the strategy without ambiguity.
- Score build-vs-buy-vs-adopt decisions rigorously using a weighted decision matrix that is
  sensitive to which criteria matter most in your context.
- Distinguish reversible from irreversible decisions and apply appropriate process to each.

## What technical strategy actually is

Richard Rumelt's definition in *Good Strategy / Bad Strategy* is the sharpest available:
a strategy has three parts — a **diagnosis**, a **guiding policy**, and **coherent actions**.

**Diagnosis** — a clear-eyed description of the challenge. Not goals, not aspirations. What
is actually hard? "We deploy 40 services but have no shared observability contract, so incidents
take 4× longer to triage than industry benchmarks." That is a diagnosis. "We want to be
best-in-class" is not.

**Guiding policy** — a choice of how to address the diagnosis that rules things out. A policy
that rules nothing out is not a policy. "All new services must emit OpenTelemetry-compatible
traces, metrics, and structured logs before they leave the first sprint" rules out services that
skip instrumentation. Good policies feel constraining because they are.

**Coherent actions** — the specific, sequenced investments that implement the policy. They must
reinforce each other. Buying a managed APM tool while also building a custom trace store is
incoherent. Adopting a single OTel collector sidecar pattern, funding a platform team to own it,
and gating deploys on signal quality is coherent.

> [!PRINCIPAL]
> The most common failure mode for senior engineers writing strategy is confusing ambition
> with diagnosis. "We need to be 10× more reliable" is ambition. "Our p99 latency degrades
> 8× under fan-out write load because we have no backpressure between the API layer and the
> job queue" is a diagnosis — it names the mechanism and points to a tractable intervention.
> Concrete diagnosis forces concrete guiding policy; vague diagnosis produces vague (useless)
> strategy.

## The technology radar

ThoughtWorks popularised the tech radar format. It is a lightweight, recurring snapshot of the
organisation's technology posture across four rings:

| Ring | Meaning |
|------|---------|
| **Adopt** | Default choice; we have confidence, evidence, and support |
| **Trial** | Actively evaluating on real work; expect to graduate or retire |
| **Assess** | Worth knowing about; watching, not yet using in production |
| **Hold** | Do not start new projects here; migrate away when economically viable |

Blips are placed on the radar (Languages & Frameworks / Tools / Platforms / Techniques) and
updated every quarter or half-year. The *movement* of a blip is as informative as its position:
moving from Trial to Hold after three months signals a specific story the org must tell.

A well-operated radar does three things simultaneously:

1. **Reduces coordination cost** — engineers don't ask "should we use Kafka or Pulsar?" if Kafka
   is Adopt and Pulsar is Assess with a known owner.
2. **Captures institutional memory** — every Hold blip should have a linked ADR explaining why.
3. **Forces explicit sequencing** — you can't have 12 things in Trial; resource scarcity is a
   feature, not a bug.

> [!PITFALL]
> Radar rot: a radar that hasn't moved in six months has stopped reflecting reality and started
> reflecting comfort. Assign a DRI (directly responsible individual) per blip in Trial and Assess.
> If a DRI has no update in two quarters, the blip should auto-move to Hold or be dropped.
> A stale radar is actively harmful — it gives false confidence that "someone is on it."

## Build vs buy vs adopt

This is the highest-leverage decision class at the principal level. The options:

- **Build** — write and own the software yourself.
- **Buy** — purchase a commercial product (SaaS, license).
- **Adopt** — use an open-source project, taking on integration but not development cost.

The naive heuristic is "build what differentiates, buy what doesn't." That is correct but
incomplete. Three dimensions matter more:

### Total cost of ownership (TCO)

For **build**: engineering time (initial + ongoing), oncall burden, documentation, hiring ramp,
opportunity cost of engineers not working on product. A common mistake is counting only initial
build time and ignoring the 3-year maintenance tail, which typically equals 2-4× the build cost.

For **buy**: license, per-seat or per-usage pricing at scale (run the numbers at 10× current
load), vendor lock-in exit cost, integration engineering, and the cost of features you don't
need bundled with the ones you do.

For **adopt** (open source): integration engineering, version upgrade cost, security patching
cadence, and the risk of the project going unmaintained or changing license (HashiCorp's BSL
switch in 2023 is a real-world case study).

### Reversibility: one-way vs two-way doors

Jeff Bezos's one-way / two-way door framing is the right lens for process calibration, not just
cost. A two-way door (easy to reverse) should be decided fast, by the people closest to the
problem. A one-way door (expensive to reverse) demands a deliberate, documented process — an RFC
or ADR, an explicit reversibility assessment, and sign-off at the right level.

Irreversibility is created by: data format dependencies, public API contracts, training muscle
memory in a large team, deep infrastructure integration, and vendor lock-in through proprietary
APIs. A decision that looks cheap to make is often expensive because reversibility was never
priced in.

> [!PRINCIPAL]
> TCO without reversibility pricing is systematically wrong. A build decision that produces a
> custom data format (not Parquet, not Protobuf, something bespoke) is not just the engineering
> cost to build it — it is every migration you will ever run to move data out of that format,
> forever. Price in exit cost at the moment of entry, and your "build" column in the decision
> matrix will suddenly look much less attractive for foundational components.

### Sequencing and leverage

A technical strategy is not a list of decisions — it is a *sequence*. Some decisions unlock
others (load-bearing); some are blocked by others. The goal is to identify the **critical path**:
what must be true before the next set of decisions can be made well?

Leverage points in sequencing: shared platforms (auth, rate-limiting, feature flags) that, once
in place, make every subsequent service cheaper to build; data contracts (Protobuf schemas,
OpenAPI specs) that, once adopted, make every integration cheaper to evolve; test infrastructure
that, once reliable, makes every deploy cheaper to validate.

## Try it yourself

The weighted decision matrix is the workhorse tool. Given criteria (each with a weight) and
options (each scored on each criterion), the matrix produces a weighted score. Crucially, you
should run **sensitivity analysis** — vary the weights and see if the winner changes. If it does,
your decision hinges on a contested assumption you need to surface and debate, not hide.

```js run
// Weighted decision-matrix engine with sensitivity analysis
// Options: build / buy / adopt
// Criteria: fit, tcoCost, reversibility, speed, riskProfile

const criteria = [
  { name: "Feature fit",      weight: 0.25 },
  { name: "3-yr TCO",         weight: 0.25 }, // lower cost = higher score
  { name: "Reversibility",    weight: 0.20 },
  { name: "Time to value",    weight: 0.15 },
  { name: "Risk profile",     weight: 0.15 },
];

// Scores 1-5 (5 = best) for each criterion
const options = {
  Build: [3, 2, 4, 2, 3],
  Buy:   [5, 3, 2, 5, 4],
  Adopt: [4, 5, 3, 3, 4],
};

function score(opts, crit, weights) {
  return Object.fromEntries(
    Object.entries(opts).map(([name, scores]) => {
      const weighted = scores.reduce((sum, s, i) => sum + s * (weights[i] ?? crit[i].weight), 0);
      return [name, +weighted.toFixed(3)];
    })
  );
}

function winner(scores) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

const baseWeights = criteria.map(c => c.weight);
const baseScores = score(options, criteria, baseWeights);
console.log("=== Base scenario ===");
Object.entries(baseScores).sort((a,b) => b[1]-a[1]).forEach(([k,v]) =>
  console.log(`  ${k.padEnd(7)} ${v}`)
);
console.log("  Winner:", winner(baseScores));

// Sensitivity: what if TCO matters twice as much?
const tcoHeavy = baseWeights.map((w, i) => i === 1 ? 0.45 : w * (0.55 / 0.75));
const tcoScores = score(options, criteria, tcoHeavy);
console.log("\n=== Sensitivity: TCO weight doubled ===");
Object.entries(tcoScores).sort((a,b) => b[1]-a[1]).forEach(([k,v]) =>
  console.log(`  ${k.padEnd(7)} ${v}`)
);
console.log("  Winner:", winner(tcoScores));

if (winner(baseScores) !== winner(tcoScores)) {
  console.log("\n  [!] Decision is sensitive to TCO weighting.");
  console.log("      Surface this assumption in your RFC before deciding.");
} else {
  console.log("\n  Decision is robust to TCO weighting.");
}
```

## Exercise

**Exercise 1:** Add a criterion "Vendor concentration risk" with weight 0.10. Re-normalise the
existing weights proportionally and re-run. Does the winner change?

<details>
<summary>Show solution</summary>

```js run
const criteria = [
  { name: "Feature fit",           weight: 0.225 },
  { name: "3-yr TCO",              weight: 0.225 },
  { name: "Reversibility",         weight: 0.180 },
  { name: "Time to value",         weight: 0.135 },
  { name: "Risk profile",          weight: 0.135 },
  { name: "Vendor concentration",  weight: 0.100 }, // NEW: Buy scores low here
];

const options = {
  Build: [3, 2, 4, 2, 3, 5],
  Buy:   [5, 3, 2, 5, 4, 1],
  Adopt: [4, 5, 3, 3, 4, 3],
};

const weights = criteria.map(c => c.weight);
const scores = Object.fromEntries(
  Object.entries(options).map(([name, s]) => [
    name,
    +(s.reduce((sum, v, i) => sum + v * weights[i], 0).toFixed(3))
  ])
);

Object.entries(scores).sort((a,b) => b[1]-a[1]).forEach(([k,v]) =>
  console.log(`${k.padEnd(8)} ${v}`)
);
```

The Buy score drops significantly on vendor concentration. Adopt typically wins when TCO and
reversibility are weighted alongside concentration risk — which reflects how the industry
moved after HashiCorp's BSL switch and the Elasticsearch re-licensing.
</details>

## Common pitfalls

> [!PITFALL]
> **The false neutrality trap.** Presenting a decision matrix without a recommendation and calling
> it "balanced analysis" is abdication, not strategy. A principal engineer's job is to have a
> point of view: run the matrix, do the sensitivity analysis, and then *argue for an answer*.
> Decision-makers don't need an encyclopaedia of options — they need a clear recommendation with
> honest caveats. Hiding behind the matrix is the senior-engineer equivalent of "it depends."

**Sunk-cost distortion** — the build option looks expensive because your team already spent
six months on a bespoke solution. That six months is gone regardless of the decision. Price
only the *forward* cost. An emotionally honest TCO calculation often reveals that abandoning a
partially-built system and adopting an open-source alternative is cheaper over three years than
finishing what you started.

**Ignoring ecosystem velocity** — an open-source project with 200 contributors and active
releases absorbs security patches and new features you'd have to build yourself. That
contributor leverage is a real TCO credit that never appears in naive spreadsheets.

## What you learned

- Technical strategy = diagnosis + guiding policy + coherent actions (Rumelt's kernel).
- A tech radar communicates strategy without requiring constant coordination; keep blips
  alive with DRI ownership and quarterly review cadence.
- TCO must include maintenance tail (2-4× initial build cost), exit cost, and ecosystem
  velocity credit for open-source adoption.
- Reversibility is a separate axis from cost; one-way-door decisions require proportionally
  more process.
- A weighted decision matrix is only useful if you run sensitivity analysis and then make
  a concrete recommendation.

## Next steps

Strategy without documentation decays the moment the author leaves the room. The next lesson
covers the tools that make decisions durable: RFCs and Architecture Decision Records.
*/});
