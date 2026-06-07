registerLessonSrc("48-threat-modeling-scale", function () {/*
---
id: 48-threat-modeling-scale
title: "Threat Modeling & Trust Boundaries at Scale"
minutes: 28
level: principal
objectives:
  - Apply STRIDE and attack trees to a real distributed Node.js system
  - Identify trust boundaries and draw precise data-flow diagrams
  - Build a quantitative risk-scoring engine that ranks threats by likelihood × impact
---

# Threat Modeling & Trust Boundaries at Scale

## Why this matters

A senior engineer who only thinks about security at the code level is playing defense on the wrong field. Threat modeling is what shifts security left — it forces you to reason about your system's attack surface *before* a line of code is written and to quantify where blast radius is largest. At L7 scale you're making architectural decisions that will survive for years; missing a trust-boundary crossing early costs 100x more to fix after launch than during design.

## Learning objectives

- Apply **STRIDE** categorically and build **attack trees** for a real distributed system.
- Draw **data-flow diagrams (DFDs)** with explicit trust boundaries and identify all crossing points.
- Derive **abuse cases** from normal use cases and turn them into tracked security invariants.
- Use **defense in depth** and **blast-radius reduction** as first-class architectural concerns.
- Understand the **Node.js permission model** (Node 24) as one technical control in a broader defense stack.

## STRIDE in a distributed system

STRIDE is a mnemonic for six threat categories, invented at Microsoft and still the sharpest general-purpose taxonomy:

| Letter | Threat | Violates | Example in Node services |
|--------|--------|----------|--------------------------|
| **S**poofing | identity | Authentication | Forged JWT `kid` header points to attacker key |
| **T**ampering | integrity | Integrity | gRPC request body mutated in transit |
| **R**epudiation | accountability | Non-repudiation | Worker crashes after side-effect, no audit log |
| **I**nformation Disclosure | confidentiality | Confidentiality | Stack trace leaks internal IP in 500 response |
| **D**enial of Service | availability | Availability | Uncapped query returns 2 M rows, OOMs the process |
| **E**levation of Privilege | authorization | Authorization | Plugin runs `child_process.exec` as the host user |

> [!PRINCIPAL]
> STRIDE is a *brainstorming accelerator*, not a guarantee of completeness. The dangerous gaps are almost always in the intersections — an API that is individually authenticated and individually authorized, but whose composition allows a privilege chain. Walk every trust-boundary crossing with all six STRIDE lenses, then walk the cross-product of "what if two controls fail simultaneously." That's where real incidents live.

## Data-flow diagrams and trust boundaries

A DFD has four element types: **processes** (circles), **external entities** (rectangles), **data stores** (parallel lines), and **data flows** (arrows). A **trust boundary** is a dashed rectangle drawn around elements that share the same principal context. Every arrow that crosses a trust boundary is a mandatory threat-modeling target.

```
[Browser]  ─ HTTPS ──▶ ┌──────────────────────────────────┐
                        │  Trust Zone: Public Edge          │
                        │  [API Gateway / TLS terminator]   │
                        └────────────┬─────────────────────┘
                                     │ mTLS (internal)
                        ┌────────────▼─────────────────────┐
                        │  Trust Zone: Services Mesh        │
                        │  [Auth Service]  [Order Service]  │
                        │       │                │          │
                        └───────┼────────────────┼─────────┘
                                │                │
                    [IAM DB]◀───┘       [Orders DB]◀──────┘
```

Rules that follow from this diagram:
1. The API gateway must strip or re-sign headers before forwarding — it sits exactly on the trust boundary.
2. Services inside the mesh trust the calling service's *identity*, not the original user's raw JWT.
3. Both databases are fully inside the inner zone — no direct public reach.

> [!NOTE]
> In Node 24 you can enforce parts of this mechanically with the **permission model** (`--allow-fs-read`, `--allow-fs-write`, `--allow-net`, `--allow-child-process`, `--allow-worker`). A service that only needs to read a config directory and call one internal endpoint can be started with exactly those permissions; anything outside raises an `ERR_ACCESS_DENIED` before the attacker even controls code.

```bash
node --experimental-permission \
     --allow-fs-read=/etc/myservice/config \
     --allow-net=10.0.1.5:5432 \
     server.mjs
```

> [!OUTPUT]
> # Normal operation — startup works, DB connection works.
> # Attempt to open /tmp/evil → throws:
> Error [ERR_ACCESS_DENIED]: Access to FileSystemRead was blocked
>   by the Node.js permissions policy (path: /tmp/evil)

## Attack trees

An attack tree roots at a **goal** (attacker achieves X) and branches into sub-goals connected by AND/OR gates. Quantifying each leaf with *likelihood* and *impact* lets you prioritize.

```
GOAL: exfiltrate customer PII from Orders DB
├─ OR: compromise Orders Service process
│     ├─ AND: exploit RCE in npm dep  (L=0.05, I=10)
│     └─ AND: SSRF → metadata endpoint → IAM creds (L=0.15, I=10)
├─ OR: compromise DB credentials
│     ├─ leaked .env in public repo (L=0.20, I=10)
│     └─ brute-force weak password  (L=0.10, I=10)
└─ OR: compromise backup export pipeline (L=0.08, I=10)
```

Risk score = likelihood × impact. You triage by score, then by whether the threat crosses a trust boundary (which escalates it regardless of score, because boundary crossings amplify blast radius).

## Abuse cases and security invariants

Every normal use case has a shadow: its **abuse case**. Derive them systematically.

| Normal use case | Abuse case | Security invariant |
|-----------------|------------|-------------------|
| User places order | User places 10 M orders via scripted loop | Rate limit: ≤ 20 req/min per authenticated user |
| Admin exports report | Admin exports entire users table | Data minimization: export scoped to own-org only |
| Plugin runs user code | Plugin reads `/etc/passwd` | Plugin must run in separate process with `--experimental-permission` |

A **security invariant** is a property that must hold in *all* states. Name them explicitly, encode them as tests, and make them visible in code review. If an invariant cannot be verified automatically, treat it as a risk until it can.

## Defense in depth and blast-radius reduction

Defense in depth means no single control failure should result in full compromise. Layers for a typical Node microservice:

1. **Network** — private subnets, security groups, mTLS between services.
2. **Runtime isolation** — containers with minimal capabilities (`--cap-drop ALL`, `--security-opt seccomp`), no shared PID namespace.
3. **Process** — Node permission model restricts FS/net/child-process to exactly what's needed.
4. **Application** — input validation (zod/joi), output encoding, SQL parameterization.
5. **Data** — encryption at rest, field-level encryption for PII, short-lived credentials (AWS IRSA / Workload Identity).
6. **Monitoring** — structured audit logs, anomaly detection, alert on invariant violations.

**Blast-radius reduction** means assuming every layer eventually fails and designing so that the *consequence* of one layer's failure is bounded. Concrete techniques:

- Separate processes per trust level (no mixing plugin execution and auth logic in one process).
- Short-lived credentials that expire before an attacker can pivot (15-minute token TTLs).
- Canary tokens in sensitive data stores that alert when accessed without a valid request context.
- Read replicas for analytics workloads — compromise of the analytics process cannot write to primary.

> [!PRINCIPAL]
> The xz-utils backdoor (2024) and the npm `event-stream` incident are canonical examples of blast-radius that was *structurally unbounded*: because the compromised component ran with the same privileges as everything else, a single insertion point gave the attacker nearly unlimited reach. The fix is not "better code review" — it's designing so the compromised component can never *reach* the sensitive resource in the first place. Capability-based isolation is the architectural answer.

> [!PITFALL]
> Teams often draw trust-boundary diagrams during design, file them, and never update them. Within six months the actual system looks nothing like the diagram — new services, new DB connections, new external vendors. Make DFD maintenance a mandatory part of your RFC/ADR process: no new service or external dependency without a trust-boundary review. Stale threat models are worse than no threat model because they give false confidence.

## Try it yourself

The runnable block below implements a **risk-scoring engine**. It ingests an array of threats, each with `likelihood` (0–1), `impact` (1–10), a `strideCategory`, and a `crossesTrustBoundary` flag. It ranks threats by composite risk score, applies a boundary-crossing multiplier (1.5×), and emits a prioritized report.

```js run
// Risk-scoring engine: ranks threats by likelihood × impact,
// with a 1.5× multiplier for trust-boundary crossings.

const STRIDE_WEIGHTS = {
  Spoofing: 1.2,
  Tampering: 1.1,
  Repudiation: 0.9,
  'Information Disclosure': 1.3,
  'Denial of Service': 1.0,
  'Elevation of Privilege': 1.5,
};

function scoreThreats(threats) {
  return threats
    .map(t => {
      const base = t.likelihood * t.impact;
      const strideW = STRIDE_WEIGHTS[t.strideCategory] ?? 1.0;
      const boundaryW = t.crossesTrustBoundary ? 1.5 : 1.0;
      const score = +(base * strideW * boundaryW).toFixed(3);
      return { ...t, score };
    })
    .sort((a, b) => b.score - a.score);
}

function printReport(ranked) {
  console.log('=== Threat Risk Report (highest first) ===\n');
  ranked.forEach((t, i) => {
    const boundary = t.crossesTrustBoundary ? ' [BOUNDARY CROSSING]' : '';
    console.log(
      `${i + 1}. [${t.strideCategory}]${boundary}\n` +
      `   ${t.description}\n` +
      `   Likelihood=${t.likelihood} Impact=${t.impact} Score=${t.score}\n`
    );
  });
}

const threats = [
  {
    description: 'Forged JWT kid header redirects to attacker JWKS endpoint',
    strideCategory: 'Spoofing',
    likelihood: 0.12,
    impact: 9,
    crossesTrustBoundary: true,
  },
  {
    description: 'Uncapped DB query returns full users table → OOM crash',
    strideCategory: 'Denial of Service',
    likelihood: 0.30,
    impact: 7,
    crossesTrustBoundary: false,
  },
  {
    description: 'Plugin executes arbitrary child_process as host user',
    strideCategory: 'Elevation of Privilege',
    likelihood: 0.08,
    impact: 10,
    crossesTrustBoundary: true,
  },
  {
    description: 'Stack trace in 500 response leaks internal service IPs',
    strideCategory: 'Information Disclosure',
    likelihood: 0.45,
    impact: 4,
    crossesTrustBoundary: false,
  },
  {
    description: 'SSRF to cloud metadata endpoint retrieves IAM credentials',
    strideCategory: 'Information Disclosure',
    likelihood: 0.15,
    impact: 10,
    crossesTrustBoundary: true,
  },
  {
    description: 'Admin export API returns data outside caller org scope',
    strideCategory: 'Elevation of Privilege',
    likelihood: 0.20,
    impact: 8,
    crossesTrustBoundary: false,
  },
];

const ranked = scoreThreats(threats);
printReport(ranked);

// Highlight threats that need immediate attention
const critical = ranked.filter(t => t.score >= 1.5);
console.log(`\nCritical threats (score >= 1.5): ${critical.length}`);
critical.forEach(t => console.log(`  ✗ ${t.description}`));
```

## Exercises

**Exercise 1:** Add a new STRIDE category weight for `Repudiation` that reflects the severity of an audit-log gap in a payment service, and insert two Repudiation threats. Do the scores change ranking?

<details>
<summary>Show solution</summary>

```js run
const STRIDE_WEIGHTS = {
  Spoofing: 1.2,
  Tampering: 1.1,
  Repudiation: 1.4,  // elevated for payment context
  'Information Disclosure': 1.3,
  'Denial of Service': 1.0,
  'Elevation of Privilege': 1.5,
};

function score(t) {
  const base = t.likelihood * t.impact;
  const s = STRIDE_WEIGHTS[t.strideCategory] ?? 1.0;
  const b = t.crossesTrustBoundary ? 1.5 : 1.0;
  return +(base * s * b).toFixed(3);
}

const threats = [
  { description: 'Payment worker crashes mid-charge, no audit entry', strideCategory: 'Repudiation', likelihood: 0.18, impact: 9, crossesTrustBoundary: false },
  { description: 'Refund request processed twice, second not logged', strideCategory: 'Repudiation', likelihood: 0.10, impact: 8, crossesTrustBoundary: true },
  { description: 'SSRF to metadata endpoint', strideCategory: 'Information Disclosure', likelihood: 0.15, impact: 10, crossesTrustBoundary: true },
];

const ranked = threats.map(t => ({ ...t, score: score(t) })).sort((a,b) => b.score - a.score);
ranked.forEach((t,i) => console.log(`${i+1}. score=${t.score}  ${t.description}`));
```

</details>

**Exercise 2:** Add a `controls` array to each threat and adjust the effective likelihood downward by 0.1 per control (floor 0.01). Recalculate.

<details>
<summary>Show solution</summary>

```js run
function scoreWithControls(t) {
  const effectiveLikelihood = Math.max(0.01, t.likelihood - 0.1 * (t.controls?.length ?? 0));
  const base = effectiveLikelihood * t.impact;
  const strideW = { 'Elevation of Privilege': 1.5, 'Information Disclosure': 1.3 }[t.strideCategory] ?? 1.0;
  const boundaryW = t.crossesTrustBoundary ? 1.5 : 1.0;
  return { ...t, effectiveLikelihood: +effectiveLikelihood.toFixed(3), score: +(base * strideW * boundaryW).toFixed(3) };
}

const threats = [
  { description: 'Plugin RCE as host user', strideCategory: 'Elevation of Privilege', likelihood: 0.08, impact: 10, crossesTrustBoundary: true, controls: ['permission-model', 'seccomp', 'read-only-fs'] },
  { description: 'SSRF to metadata', strideCategory: 'Information Disclosure', likelihood: 0.15, impact: 10, crossesTrustBoundary: true, controls: ['IMDSv2-required'] },
];

threats.map(scoreWithControls).sort((a,b) => b.score - a.score)
  .forEach((t,i) => console.log(`${i+1}. score=${t.score} effL=${t.effectiveLikelihood}  ${t.description}`));
```

</details>

## Common pitfalls

> [!PITFALL]
> **Treating threat modeling as a one-time document.** The most dangerous threat model is the one that was done once at kickoff and never revisited. Every new service, every new vendor integration, every permission expansion is a potential new trust-boundary crossing. Build threat-model review into your RFC/PR process. At L7 you are often the person who enforces this norm — set the precedent.

A second common failure is confusing *policy* with *enforcement*. Writing "plugins must not access the filesystem" in a README is not a control. The Node permission model, a seccomp filter, or a separate process boundary is a control. Policy without enforcement is just documentation of your hopes.

## What you learned

- **STRIDE** provides a categorical taxonomy for threat analysis; walk every trust-boundary crossing with all six lenses.
- **Data-flow diagrams** with explicit trust boundaries make crossing points visible and reviewable.
- **Abuse cases** derived from normal use cases become **security invariants** that can be tested and enforced.
- **Defense in depth** stacks controls so that no single failure yields full compromise; **blast-radius reduction** bounds the consequence of each layer's failure.
- The **Node permission model** (`--experimental-permission` in Node 22+, stabilizing in 24) is a real, enforceable runtime control, not just documentation.
- A quantitative **risk-scoring engine** (likelihood × impact × STRIDE weight × boundary multiplier) turns subjective threat lists into actionable, ranked backlogs.

## Next steps

With a threat model in hand you know *what* to protect. The next question is *how* to trust the software you ship — that means SLSA levels, provenance attestation, and reproducible builds.
*/});
