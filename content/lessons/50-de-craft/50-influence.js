registerLessonSrc("50-influence", function () {/*
---
id: 50-influence
title: "Scope, Influence & the Staff+ Archetypes"
minutes: 26
level: principal
objectives:
  - Identify the four staff-plus archetypes and recognise which one you are operating as in a given context
  - Exercise influence without authority using concrete multiplier techniques
  - Apply a leverage model to choose high-impact problems over locally-satisfying ones
---

# Scope, Influence & the Staff+ Archetypes

## Why this matters

The transition from senior to staff is not a promotion in degree — it is a change in kind.
A senior engineer's scope is their team and their codebase. A staff engineer's scope is the
engineering organisation, or a significant cross-cutting slice of it. The technical skills
that got you to senior are necessary but no longer sufficient: the rate-limiter shifts to
organisational skill, written communication, and the ability to move people and systems you
do not control. Understanding the archetypes and the levers available to you determines
whether you operate as a principal engineer or merely as a senior engineer with a new title.

## Learning objectives

- Recognise and operate within the four staff-plus archetypes (Tech Lead, Architect, Solver,
  Right Hand).
- Apply specific multiplier techniques — paved roads, glue work, mentoring, standards-setting.
- Choose high-leverage problems using an impact × reach / effort model.
- Navigate ambiguity and organisational politics with a durable ethical compass.
- Distinguish sponsorship from mentorship and understand why the former is rarer and more
  valuable at this level.

## The four staff-plus archetypes

Will Larson's research (documented in *Staff Engineer*) identifies four recurring archetypes.
No individual is a pure type; you will shift between them across projects and career phases.
The important thing is to be intentional about which one the current situation calls for.

### Tech Lead

Scope: one team or one closely-related cluster of teams. You set the technical direction,
represent the team in cross-team forums, and are the tiebreaker on ambiguous technical calls.
You are still writing code — typically 30-50% of your time — but the code you write is
designed to establish patterns that five other engineers will follow. Your leverage multiplier
is the patterns and conventions you establish; every engineer on the team inherits them.

The failure mode: becoming the team's senior IC again. You have a great pull request open,
you are the fastest to review, you pair-program constantly. The team ships well but no one
else is growing, and you are a single point of failure.

### Architect

Scope: a domain or a technical area across multiple teams (e.g. data platform, API gateway,
mobile foundations). You rarely write production code in the core product; you write
decision documents, reference implementations, and the guardrails that shape how teams build.
Your leverage multiplier is the platform surface you define — every team building on it
inherits your constraints and your capabilities.

The failure mode: architecture that lives in diagrams and RFCs but not in running systems.
Architects who are not close enough to production to see where their models break become
irrelevant over time. Spend at least 10% of your time in the on-call rotation or deeply
reading production traces.

### Solver

Scope: wherever the most important unsolved problem is. You are assigned (or you seek out)
the hard problem that other teams have stalled on — the latency mystery that has persisted
for six months, the data consistency bug that nobody can reproduce, the migration that three
teams have tried and abandoned. You go deep, produce a solution and a written post-mortem,
then hand off and move to the next hard problem.

The failure mode: becoming a firefighter. If every Solver engagement is reactive (someone
called you in emergency), you are not shaping the organisation's trajectory — you are
absorbing its entropy. Great Solvers also identify problems proactively, before they become
on-call incidents.

### Right Hand

Scope: amplifying a specific executive or VP of Engineering. You operate with delegated
authority, run working groups, and unblock cross-functional decisions that need organisational
weight. You are part of the leadership system, not just the technical system.

The failure mode: becoming a project manager. If your output is meeting notes and Jira tickets
rather than technical insight and written strategy, you have drifted from the engineering
gravity that makes the archetype valuable. The Right Hand is an engineering function, not an
operations one.

> [!PRINCIPAL]
> Most principal-and-above job descriptions describe all four archetypes simultaneously. No
> individual can do all four at once. The organisational system works when different people
> operate in different archetypes and coordinate. Your job in any given quarter is to identify
> which archetype is most needed by the organisation right now, and whether you are the right
> person to fill that gap. Saying "I think the organisation needs a Solver in the data platform
> area this half, and I am not the right person — here is who is" is a principal-level
> contribution.

## Influence without authority

Authority is granted by the org chart. Influence is earned by demonstrated judgment. At the
principal level, you will routinely need to move people and systems that do not report to you
and that your manager cannot compel. The levers available:

**Credibility through written track record.** Every RFC you write that turns out to be correct,
every ADR whose consequences you predicted accurately, and every design review where your
feedback prevented a production incident — these compound. The org builds a model of your
judgment. That model is your primary influence asset. Protect it: be right for documented
reasons, and update publicly when you are wrong.

**Paved roads.** The most scalable form of influence is building the path of least resistance
that leads to the right outcome. If you want teams to adopt distributed tracing, write the
OpenTelemetry Node.js instrumentation library, publish the standard Grafana dashboards, and
make adoption a one-line package install. Teams will adopt not because you told them to —
because it is easier than building their own. Paved roads scale to the whole org without
any management authority.

**Glue work.** The coordination, documentation, cross-team facilitation, and process work that
keeps a large engineering effort coherent is real engineering work that is systematically
under-credited. At the principal level, you perform glue work explicitly and make it visible.
"I spent two days writing the migration runbook that reduced oncall escalations by 40%" is a
principal-level output. Naming it, tracking it, and reporting it — rather than letting it be
invisible — is how you model to junior engineers that this work matters and is done by people
they should aspire to be.

**Mentoring and sponsorship.** Mentoring is giving advice — answering questions, sharing
experience. Sponsorship is using your credibility and network to create opportunities for
someone: recommending them for a high-visibility project, including them in a technical
review they would not otherwise be invited to, naming them in a performance review as someone
ready for the next level. Mentoring scales linearly. Sponsorship scales through the careers
of the people you sponsor.

> [!PRINCIPAL]
> Sponsorship is the more powerful lever and the rarer one. Most senior engineers mentor
> generously but sponsor sparingly — because sponsorship requires spending social capital,
> and social capital feels finite. It is finite in the short run. In the long run, the engineers
> you sponsor become the future staff and principal engineers who sponsor others. Your credibility
> grows as theirs does. Underinvestment in sponsorship is the most common leverage mistake at
> the L6/L7 boundary.

## Choosing high-leverage problems

The defining discipline of the principal level is the ability to identify which problem to work
on. The technically interesting problem and the high-leverage problem are not the same problem.

The leverage model: `leverage = impact × reach / effort`

- **Impact:** how much does solving this problem improve the system? Quantify where possible.
  "Reduces p99 latency of checkout by 120 ms" beats "improves code quality."
- **Reach:** how many engineers, teams, customers, or revenue streams does the solution affect?
  A library used by 60 teams has 60× the reach of a library used by one team.
- **Effort:** engineer-weeks to a durable solution, including the maintenance tail.

The model has two failure modes. The first is local optimisation: choosing the problem with
the highest impact for your team rather than the highest leverage across the org. The second
is effort underestimation: a paved road that 60 teams adopt sounds like leverage, but if it
requires constant maintenance and breaks on every Node version upgrade, the denominator grows
without bound and the leverage collapses.

## Navigating ambiguity and org politics

At the principal level, many of the highest-leverage problems are ambiguous: unclear ownership,
unclear requirements, multiple stakeholders with competing interests, and no obvious correct
answer. The engineers who thrive are not the ones who avoid ambiguity — they are the ones
who can operate in it without becoming paralysed or cynical.

**Useful tactics:** Write down your current understanding of the problem (even a half-page
doc) and share it before you have a solution. "Here is how I understand the situation — am I
missing anything?" surfaces misalignments before they are embedded in a design. Move toward
the ambiguity rather than waiting for it to resolve itself; ambiguity left alone generates
entropy, not clarity.

**Ethical compass:** Org politics at this level often involves situations where the correct
technical decision is blocked by a non-technical consideration (a VP who owns the competing
platform, a reorg that changed incentives, a company goal that creates perverse incentives
for quality). The right posture is to name the constraint explicitly, not to work around it
invisibly. "The correct technical decision is X, but the current org incentives make X harder
than Y. Here is what would need to change for X to be chosen. In the meantime, here is the
least-bad version of Y." That is an honest and durable position. Invisible workarounds rot.

> [!PITFALL]
> Scope creep disguised as ambition. "No one owns this, so I will" is a correct impulse up
> to a point. Beyond that point it is scope accumulation that spreads you too thin to do
> anything well. The discipline is to take ownership of a problem, drive it to a resolved
> state, and hand it off — not to accumulate ownership indefinitely. Principal engineers who
> cannot let go become single points of failure and block the growth of the engineers below
> them who should own these problems next.

## What L7++ actually means

The internal framing for "distinguished" (L7++ in many large-company levelling systems) is
not "more senior than staff." It is a different scope of impact: company-wide technical
direction, industry-level influence, or a specific domain so deep that the company's
competitive position depends on that expertise being resident.

The concrete markers: you are cited in RFCs written by people you have never met. Your
opinions on technology choices are sought by teams outside your reporting chain as a matter
of course. You have made at least one technical call that turned out to be wrong at scale
and you have a written account of what you learned and what you changed. The last point is
rarely discussed but is consistently present in the profiles of engineers at this level —
distinguished engineers have made large-scope mistakes, processed them honestly, and emerged
with better judgment. The track record of correctness is not perfect; it is deep.

## Try it yourself

A leverage calculator that ranks initiatives by the impact × reach / effort model. In a real
org you would populate this from a planning doc; here we demonstrate the ranking model and
its sensitivity to estimation changes.

```js run
// Leverage calculator: rank initiatives by impact * reach / effort
// All scores on a 1-10 scale. Effort is in engineer-weeks.

const initiatives = [
  {
    name: "OTel paved road",
    desc: "Instrumentation library + dashboards for all 60 Node services",
    impact: 7,   // significant latency visibility improvement
    reach: 9,    // 60 teams
    effort: 8,   // weeks
  },
  {
    name: "Checkout p99 fix",
    desc: "Diagnose and fix 120ms tail latency in checkout service",
    impact: 9,   // high direct revenue impact
    reach: 2,    // one service
    effort: 3,   // weeks
  },
  {
    name: "Auth library refactor",
    desc: "Replace bespoke JWT lib with standard, used by 20 services",
    impact: 6,   // security + dev ergonomics
    reach: 6,    // 20 services
    effort: 5,   // weeks
  },
  {
    name: "Internal RFC process tooling",
    desc: "Completeness scorer + GitHub Actions gate for all RFCs",
    impact: 5,   // process quality improvement
    reach: 10,   // every engineer
    effort: 2,   // weeks
  },
  {
    name: "ML feature store",
    desc: "Build first-party feature store for ML platform",
    impact: 8,   // enables new product capabilities
    reach: 3,    // data + ML teams
    effort: 20,  // weeks — large
  },
];

function leverage(i) {
  return (i.impact * i.reach) / i.effort;
}

const ranked = [...initiatives].sort((a, b) => leverage(b) - leverage(a));

console.log("=== Initiative Leverage Ranking ===\n");
console.log("Rank  Leverage  Initiative");
ranked.forEach((item, idx) => {
  const lev = leverage(item).toFixed(2);
  console.log(`  ${idx + 1}   ${lev.padStart(6)}   ${item.name}`);
  console.log(`         (impact=${item.impact} reach=${item.reach} effort=${item.effort}wk)`);
  console.log(`         ${item.desc}`);
  if (idx < ranked.length - 1) console.log("");
});

// Sensitivity: what if OTel effort doubles (maintenance underestimated)?
console.log("\n=== Sensitivity: OTel effort doubles (underestimated) ===");
const adjusted = initiatives.map(i =>
  i.name === "OTel paved road" ? { ...i, effort: 16 } : i
);
const reranked = [...adjusted].sort((a, b) => leverage(b) - leverage(a));
reranked.forEach((item, idx) => {
  console.log(`  ${idx + 1}. ${item.name} — leverage ${leverage(item).toFixed(2)}`);
});
```

## Exercise

**Exercise 1:** Add a "strategic multiplier" column (1.0–2.0) that boosts leverage for
initiatives aligned with a stated company goal (e.g. "reliability" or "developer productivity").
Re-rank and see how alignment changes prioritisation.

<details>
<summary>Show solution</summary>

```js run
const companyGoal = "reliability";

const initiatives = [
  { name: "OTel paved road",      impact: 7, reach: 9, effort: 8,  tags: ["reliability", "devex"] },
  { name: "Checkout p99 fix",     impact: 9, reach: 2, effort: 3,  tags: ["reliability"] },
  { name: "Auth library refactor",impact: 6, reach: 6, effort: 5,  tags: ["security"] },
  { name: "RFC tooling",          impact: 5, reach: 10, effort: 2, tags: ["devex"] },
  { name: "ML feature store",     impact: 8, reach: 3, effort: 20, tags: ["ml-platform"] },
];

function strategicMultiplier(tags, goal) {
  return tags.includes(goal) ? 1.5 : 1.0;
}

function leverage(i) {
  return (i.impact * i.reach / i.effort) * strategicMultiplier(i.tags, companyGoal);
}

const ranked = [...initiatives].sort((a, b) => leverage(b) - leverage(a));
console.log(`Ranked by leverage * strategic multiplier (goal: ${companyGoal})\n`);
ranked.forEach((item, idx) => {
  const mult = strategicMultiplier(item.tags, companyGoal);
  console.log(`${idx + 1}. ${item.name}`);
  console.log(`   base=${((item.impact * item.reach) / item.effort).toFixed(2)}  mult=${mult}  final=${leverage(item).toFixed(2)}`);
});
```

The strategic multiplier makes the implicit org priority explicit and quantified. In a real
planning doc you would derive the multiplier from OKRs, not from intuition.
</details>

## Common pitfalls

> [!PITFALL]
> **The brilliant jerk trap in reverse.** Principal engineers are often told they need to
> be "more strategic and less tactical." Some overcorrect — they stop reviewing PRs, stop
> writing code, stop pairing with junior engineers, and spend all their time in documents
> and meetings. The result is an engineer who has influence on paper but has lost the
> technical credibility that makes the influence real. Stay connected to the system. Read
> traces. Review the post-mortem from last week's incident. Write at least one non-trivial
> piece of production code per month. The credibility that buys you influence is perishable.

## What you learned

- The four staff-plus archetypes (Tech Lead, Architect, Solver, Right Hand) describe scopes
  and failure modes; operating effectively requires knowing which the situation calls for.
- Influence without authority accretes through written track record, paved roads, glue work,
  and sponsorship — not through seniority assertions.
- Leverage = impact × reach / effort; the highest-leverage work is rarely the most locally
  interesting.
- L7++ is characterised by company-wide technical influence, honest public reckoning with
  large-scope mistakes, and a compounding track record of documented judgment.

## Next steps

You have the strategy, the documentation practices, and the influence model. The final lesson
is the capstone: designing, estimating, and defending a planet-scale system the way an L7++
engineer must.
*/});
