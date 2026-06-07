registerLessonSrc("50-rfcs-adrs", function () {/*
---
id: 50-rfcs-adrs
title: "Leading with RFCs, ADRs & Decision Records"
minutes: 27
level: principal
objectives:
  - Anatomy of a great RFC and how to run async design review that actually resolves
  - Write immutable, lightweight ADRs that capture why, not just what
  - Use writing as a thinking tool — the act of drafting surfaces contradictions faster than any meeting
---

# Leading with RFCs, ADRs & Decision Records

## Why this matters

At the senior level, influence flows through conversations. At the principal level, influence
flows through documents. A well-written RFC that ships with a decision is infrastructure: every
engineer who joins a year from now can read why a choice was made, not just what was chosen.
Without it, context lives in Slack threads that expire, in the heads of engineers who leave,
and in tribal knowledge that makes onboarding painfully slow. Writing is how you scale yourself
beyond your timezone and your tenure.

## Learning objectives

- Construct a great RFC with all required sections and no filler.
- Distinguish an RFC (proposal, open for comment) from an ADR (record, immutable after decision).
- Run an async design review that converges — not a thread that meanders.
- Apply the disagree-and-commit discipline to close decisions cleanly.
- Use writing as a primary thinking tool, not a documentation afterthought.

## Anatomy of a great RFC

RFC stands for "Request for Comments." In engineering organisations it is a structured proposal
for a significant technical change. The goal is to make the decision process legible and async.
A great RFC has exactly enough structure to force rigour without becoming a bureaucratic ritual.

### Required sections

**1. Context / Background**
What is true today? State facts, not opinions. Include relevant metrics, failure modes, current
constraints. This is your diagnosis (Rumelt again). A reader who knows nothing about this
system should understand the problem from this section alone.

**2. Goals and Non-Goals**
Goals are the outcomes this RFC achieves if implemented. Non-goals are explicit exclusions —
"this RFC does not address multi-region failover" prevents scope creep in the review thread.
Both lists should be short (3-6 bullets each). Non-goals are not an apology; they are a
promise about what future RFCs will address.

**3. Options Considered (with tradeoffs)**
List 2-4 real options. Not strawmen. If you are recommending option B, you must steelman
option A. Each option gets: a description, the pros, the cons, and the open questions you
could not resolve before writing. This section is where engineering depth lives.

**4. Proposed Decision / Recommendation**
State the choice clearly in a single sentence. Then justify it using the tradeoffs above.
This is not a summary of the Options section — it is an argument that given *this context*
and *these goals*, option B dominates on the criteria that matter most.

**5. Risks and Mitigations**
Enumerate specific failure modes: what breaks, under what conditions, and what mitigates each.
Do not write "this could be risky." Write "if the migration script fails midway, rows in the
old table will be in an inconsistent state. Mitigation: run in a transaction with an explicit
rollback trigger and a feature flag to disable reads from the new table."

**6. Rollout / Implementation Plan**
Phases, gates, and rollback triggers. If the RFC proposes a schema migration: what is the
dark-launch phase, what is the cutover signal, what does rollback look like at each phase?
Engineers reviewing the RFC need to trust that the author has thought past "it works in
staging."

**7. Open Questions**
Things you don't know and need feedback on. Explicitly flagging uncertainty invites the right
people to answer, rather than having them passive-aggressively point out gaps in comments.

> [!PRINCIPAL]
> The sections you omit reveal what you haven't thought through. "Non-goals" left empty usually
> means scope is undefined. "Risks" left empty means the author is either overconfident or
> writing to achieve approval, not to achieve a good decision. As a reviewer, treat these
> omissions as the most important feedback you can give — ask for them to be filled before the
> review proceeds. A complete RFC forces the author to confront reality; an incomplete one
> defers that confrontation to production.

## Architecture Decision Records (ADRs)

An ADR is what you write *after* the decision is made. It is lightweight, immutable, and lives
in the repository alongside the code it describes. The immutability is the point: an ADR is not
a living document that gets updated — it is a snapshot of reasoning at a moment in time. If the
decision changes, you write a new ADR that supersedes the old one.

Michael Nygard's original format is three sections:

```
# ADR-0042: Use PostgreSQL LISTEN/NOTIFY for intra-service events

Status: Accepted  (Proposed | Accepted | Deprecated | Superseded by ADR-0067)
Date: 2026-03-14

## Context
We need lightweight pub/sub between components within the same PostgreSQL
transaction boundary. Adding Kafka for this use-case adds operational overhead
(cluster, ZooKeeper/KRaft, separate consumer group management) that is
disproportionate to the event volume (~200/s).

## Decision
Use PostgreSQL LISTEN/NOTIFY. All event channels are namespaced by service.
The notification payload is a JSON string capped at 8 KB (PostgreSQL limit).
Messages that exceed 8 KB are written to an outbox table; the subscriber polls.

## Consequences
Good: zero additional infrastructure; events are scoped to a DB transaction so
no phantom events on rollback; simple to test.
Bad: no persistence (LISTEN/NOTIFY is fire-and-forget; a subscriber that misses
a notification must recover via polling); payload size limit is a hard constraint.
Not suitable if event volume exceeds ~5 000/s or durability is required.
```

That is it. Three sections. No more than one page. The ADR format's power is its constraint:
it forces you to name the context (why this decision was non-obvious), the decision (what
was chosen and the essential mechanism), and the consequences (what you gave up). Consequences
are symmetric — both good and bad.

> [!PRINCIPAL]
> "Status: Superseded by ADR-0067" is one of the most valuable entries in a codebase. It
> tells a future engineer: the current approach replaced something, the old approach is
> documented, and there was a reason to change. Without this chain, engineers rediscover
> the old approach, re-implement it, hit the same failure modes, and waste weeks before
> someone on the original team explains the history. ADRs as a linked chain are institutional
> memory made durable.

## Running an async design review

The RFC process fails in two failure modes: it collapses into a meeting (defeating the async
goal), or it generates infinite comment threads with no convergence (defeating the decision
goal). The structure that prevents both:

**1. Author phase (1-2 days):** Author writes the RFC, fills all sections, and tags two or three
specific reviewers for each open question. Generic "please review" to a 40-person Slack channel
produces 40 opinions and zero decisions.

**2. Comment phase (3-5 business days):** Reviewers comment. The author responds to each comment
with one of: "Agree, updated section 3," "Disagree, here is why," or "Good question, added to
Open Questions." Comments should not be ignored. A reviewer who does not respond to a reply in
48 hours is considered unblocked.

**3. Convergence call (optional, 30 min):** If 3+ substantive objections remain open after the
comment phase, a 30-minute call with the named stakeholders resolves them. The call produces
a written summary posted to the RFC thread. Not a meeting where the decision happens — a meeting
where the remaining unknowns get resolved so the decision can happen in writing.

**4. Decision:** The RFC owner (usually the author) declares the decision. Not a vote — a
decision. They may accept objections as reasons to modify the proposal; they invoke
**disagree-and-commit** when objections are heard, understood, and overridden by explicit
reasoning. The decision is recorded in the RFC header: `Status: Accepted — 2026-04-02`.

> [!NOTE]
> Disagree-and-commit is not "the highest-paid person wins." It is: "I have heard your concern,
> I understand it, I disagree that it outweighs the benefits, and I am taking ownership of the
> outcome." The person who disagrees should be able to state the winning argument faithfully —
> that is the test that they were heard, not just overruled.

## Writing as thinking

The most underrated property of writing an RFC is that you discover contradictions before
the review phase. The act of writing "in option A, the subscriber processes events exactly
once because..." forces you to verify that claim. Most of the time, you cannot. The writing
reveals the gap. This is cheaper than discovering it in a review thread at 4 PM on a Friday
or in production at 2 AM on a Tuesday.

Distinguished engineers draft early and share rough drafts with one trusted peer before the
formal review. The signal from a five-minute read by someone who knows the domain is higher
than any amount of private refinement. Writing is a conversation in slow motion.

> [!PITFALL]
> The polish trap: spending two weeks on formatting and diagrams before the core argument
> is sound. An RFC with beautiful Mermaid diagrams and a flawed threat model is worse than a
> scrappy RFC with a rigorous threat model, because reviewers assume the polish implies
> correctness. Write the argument first. Polish is cosmetic; rigour is structural.

## Try it yourself

An RFC completeness scorer — given a document structure object, it checks for required
sections and flags gaps. This is the kind of tooling a platform team would add to a GitHub
Actions workflow to gate RFC merges.

```js run
// RFC completeness scorer
// In a real workflow this would parse Markdown headings; here we use a structured object.

const REQUIRED_SECTIONS = [
  { key: "context",      label: "Context / Background",        weight: 2 },
  { key: "goals",        label: "Goals",                        weight: 1 },
  { key: "nonGoals",     label: "Non-Goals",                    weight: 1 },
  { key: "options",      label: "Options Considered",           weight: 3 },
  { key: "decision",     label: "Proposed Decision",            weight: 3 },
  { key: "risks",        label: "Risks & Mitigations",          weight: 2 },
  { key: "rollout",      label: "Rollout / Implementation Plan",weight: 2 },
  { key: "openQuestions",label: "Open Questions",               weight: 1 },
];

// Minimum viable content: at least N words and at least N option entries
const MIN_WORDS = { context: 30, options: 20, decision: 15, risks: 20, rollout: 15 };
const MIN_OPTIONS = 2;

function wordCount(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function scoreRFC(doc) {
  const gaps = [];
  let totalWeight = 0;
  let earnedWeight = 0;

  for (const section of REQUIRED_SECTIONS) {
    totalWeight += section.weight;
    const val = doc[section.key];

    if (!val || (typeof val === "string" && wordCount(val) === 0) ||
        (Array.isArray(val) && val.length === 0)) {
      gaps.push({ section: section.label, severity: "MISSING", weight: section.weight });
      continue;
    }

    if (section.key === "options" && Array.isArray(val) && val.length < MIN_OPTIONS) {
      gaps.push({ section: section.label, severity: "THIN (only 1 option — no real tradeoff)", weight: section.weight * 0.5 });
      earnedWeight += section.weight * 0.5;
      continue;
    }

    const minW = MIN_WORDS[section.key];
    if (minW && typeof val === "string" && wordCount(val) < minW) {
      gaps.push({ section: section.label, severity: `THIN (${wordCount(val)} words, need ${minW})`, weight: section.weight * 0.5 });
      earnedWeight += section.weight * 0.5;
      continue;
    }

    earnedWeight += section.weight;
  }

  const pct = Math.round((earnedWeight / totalWeight) * 100);
  return { score: pct, gaps };
}

// Example 1: A thin RFC
const thinRFC = {
  context:       "We want to move to microservices.",
  goals:         ["faster deploys"],
  nonGoals:      [],
  options:       [{ name: "monolith split" }], // only one option
  decision:      "Split the monolith.",
  risks:         "",
  rollout:       "",
  openQuestions: [],
};

// Example 2: A solid RFC
const solidRFC = {
  context: "Our monolithic checkout service handles 4 200 req/s peak. The payment " +
           "and inventory sub-domains have independent scaling needs and separate " +
           "on-call rotations. Deployments take 18 minutes end-to-end because all " +
           "domains rebuild together.",
  goals:         ["Independent deploy cadence per domain", "Separate scaling policies", "Clear ownership boundaries"],
  nonGoals:      ["Re-platform the data store", "Address auth service latency"],
  options: [
    { name: "Strangler Fig", pros: "low-risk incremental", cons: "slow, proxy overhead" },
    { name: "Big-Bang Split", pros: "clean cut", cons: "high coordination risk, long freeze" },
    { name: "Modular Monolith first", pros: "fastest, reveals seams", cons: "defers network boundary benefits" },
  ],
  decision: "Adopt the Strangler Fig pattern starting with the inventory domain. " +
            "Use an API gateway routing rule to shadow traffic for 2 weeks before cutover.",
  risks: "If the gateway routing rule misconfigures, 100% of traffic hits the wrong backend. " +
         "Mitigation: canary at 1% with automated rollback on >0.5% 5xx rate. " +
         "Secondary risk: inventory service schema diverges. Mitigation: shared schema registry with CI validation.",
  rollout: "Phase 1 (weeks 1-2): deploy inventory service in shadow mode, gateway sends copies. " +
           "Phase 2 (week 3): shift 5% of live traffic. Gate: error rate <0.1%. " +
           "Phase 3 (week 4): 100% cutover. Rollback: revert gateway routing rule, no DB migration needed.",
  openQuestions: ["What SLA do we owe inventory consumers during the shadow phase?"],
};

for (const [label, doc] of [["Thin RFC", thinRFC], ["Solid RFC", solidRFC]]) {
  const { score, gaps } = scoreRFC(doc);
  console.log(`\n=== ${label} — completeness ${score}% ===`);
  if (gaps.length === 0) {
    console.log("  All sections present and substantive.");
  } else {
    for (const g of gaps) {
      console.log(`  [${g.severity.padEnd(40)}] ${g.section}`);
    }
  }
  if (score < 70) console.log("  --> NOT READY for broad review.");
  else if (score < 90) console.log("  --> Ready for review with caveats.");
  else console.log("  --> Ready for formal review.");
}
```

## Exercise

**Exercise 1:** The RFC above scores the Solid RFC on a fixed rubric. Add a check that verifies
each option object has both `pros` and `cons` keys with non-empty strings. If any option is
missing them, deduct half the options section weight and add a gap.

<details>
<summary>Show solution</summary>

```js run
function scoreOptions(options) {
  if (!Array.isArray(options) || options.length < 2) {
    return { penalty: 1.0, gap: "THIN (fewer than 2 options)" };
  }
  const incomplete = options.filter(o =>
    !o.pros || !o.cons ||
    o.pros.trim().length === 0 || o.cons.trim().length === 0
  );
  if (incomplete.length > 0) {
    return {
      penalty: 0.5,
      gap: `THIN (${incomplete.length}/${options.length} options missing pros/cons)`
    };
  }
  return { penalty: 0, gap: null };
}

const opts1 = [
  { name: "Option A", pros: "fast", cons: "fragile" },
  { name: "Option B", pros: "robust" }, // missing cons
];
const opts2 = [
  { name: "Option A", pros: "fast", cons: "fragile" },
  { name: "Option B", pros: "robust", cons: "slow" },
];

for (const [label, opts] of [["Incomplete", opts1], ["Complete", opts2]]) {
  const result = scoreOptions(opts);
  console.log(`${label}: penalty=${result.penalty} ${result.gap || "OK"}`);
}
```

Add `scoreOptions` into `scoreRFC` for the `options` key and sum the penalty into the gap
weight before computing `earnedWeight`. This is exactly how you'd build a GitHub Actions bot
that blocks RFC merges until the document is substantive.
</details>

## Common pitfalls

> [!PITFALL]
> **The RFC graveyard.** An organisation with 200 RFCs filed and 40 decisions recorded has
> a process problem, not a documentation problem. RFCs that never reach a decision status
> ("Proposed" for more than 30 days) should be auto-closed or escalated. The RFC process
> must have an explicit owner who tracks resolution rate. A 20% decision rate means engineers
> stop writing RFCs because they believe nothing will happen — and they are right.

**Writing for approval vs writing for correctness.** The strongest signal of a political RFC
is the Options section that contains one real option and two obvious strawmen. The reviewer
who notices this should name it directly: "Option A is a strawman. Please add a genuinely
competitive alternative or narrow the scope so only one option is viable." This is kind.
Approving a document written for a predetermined outcome produces bad decisions at scale.

## What you learned

- An RFC needs eight sections: context, goals, non-goals, options with tradeoffs, decision,
  risks with mitigations, rollout plan, and open questions. Missing sections are the review.
- ADRs are immutable snapshots of a decision's reasoning, chained by "Superseded by" links.
- Async design review converges with explicit roles, time-boxes, and disagree-and-commit closure.
- Writing an RFC is a thinking tool: contradictions surface in drafting, not in review.
- Completeness scoring (and tooling that enforces it) raises the quality floor for the whole org.

## Next steps

Documents scale your thinking; influence scales your impact. The next lesson covers the
staff-plus archetypes and how to multiply your leverage across an organisation that you do
not control.
*/});
