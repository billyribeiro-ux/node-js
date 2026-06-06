registerLessonSrc("39-threat-modeling", function () {/*
---
id: 39-threat-modeling
title: "Threat Modeling & Secure Defaults"
minutes: 24
level: principal
objectives:
  - Apply the STRIDE framework to identify threats in a Node.js system
  - Define trust boundaries, attack surfaces, and least-privilege design
  - Score and prioritise threats using a likelihood × impact matrix
---

# Threat Modeling & Secure Defaults

## Why this matters

Security bugs found in production cost orders of magnitude more than those caught during design. Threat modeling is the disciplined practice of asking "what can go wrong?" before writing a line of code. Senior engineers who skip it consistently ship systems with architectural holes that no amount of runtime hardening can patch. Learning to think like an attacker — and baking secure defaults in from the start — is what separates principal-level engineers from the rest.

## Learning objectives

- Explain what threat modeling is and when to do it.
- Apply **STRIDE** to enumerate threats against a Node.js service.
- Identify **trust boundaries**, **attack surface**, and the principle of **least privilege**.
- Score threats with a **likelihood × impact** risk matrix and prioritise mitigations.
- Recognise common secure-default patterns and defence-in-depth layers.

## Thinking like an attacker

The attacker's job is easier than yours: they only need one way in; you have to defend everything. Threat modeling flips your mindset — instead of asking "does this feature work?" you ask "how would I break this?". You do this systematically so nothing obvious is missed.

**When to threat-model:** at design time (highest leverage), when adding significant new features, when changing authentication or data flows, and after a security incident reveals blind spots.

## STRIDE: a threat taxonomy

Microsoft's **STRIDE** is the most widely used framework for enumerating threat categories:

| Letter | Threat | Violated property | Node.js examples |
|--------|--------|-------------------|-----------------|
| **S** | Spoofing | Authentication | Forged JWTs, stolen API keys |
| **T** | Tampering | Integrity | Body manipulation, SQL injection |
| **R** | Repudiation | Non-repudiation | Missing audit logs, log injection |
| **I** | Information Disclosure | Confidentiality | Stack traces in prod, over-fetching |
| **D** | Denial of Service | Availability | ReDoS, missing rate limits |
| **E** | Elevation of Privilege | Authorisation | IDOR, JWT role tampering |

Walk each component of your system against every STRIDE category. You will not catch everything, but you will catch the *obvious* things that attackers exploit first.

```js
// Example: STRIDE analysis notes for a hypothetical REST endpoint
// POST /api/users/:id/promote  (admin-only: promotes user to admin role)
//
// S — Could a non-admin forge an admin session token?
//     Mitigation: verify JWT signature with strong secret; short expiry.
//
// T — Could the caller tamper with the :id in the URL?
//     Mitigation: validate id is a positive integer, authorise ownership.
//
// R — Is the promotion event logged with actor identity?
//     Mitigation: structured audit log: who promoted whom, at what time.
//
// I — Does the response include the full user record (including PII)?
//     Mitigation: return only the new role, not the full document.
//
// D — Can a flood of promotion requests overwhelm the DB?
//     Mitigation: rate-limit per IP and per authenticated user.
//
// E — Could a regular user reach this endpoint and elevate themselves?
//     Mitigation: middleware that checks role === 'admin' before handler.
```

> [!NOTE] STRIDE is a checklist, not a guarantee
> STRIDE helps you remember to ask the questions. The depth of your answers depends on how well you understand your own system. Always draw the data-flow diagram first.

## Attack surface and trust boundaries

**Attack surface** is the sum of all the ways an attacker can feed input into your system: HTTP endpoints, environment variables, third-party webhooks, uploaded files, database results, even log messages. The smaller the attack surface, the safer the system.

**Trust boundaries** are the lines where data crosses from a less-trusted context to a more-trusted one. Every crossing point is a candidate threat. Classic trust boundaries in a Node app:

```
 [Browser / mobile app]         ← untrusted
         |  HTTPS
         ↓
 [API Gateway / Load balancer]  ← semi-trusted (controls TLS, rate limits)
         |  internal HTTP
         ↓
 [Node.js service]              ← trusted (runs your code)
         |  TCP
         ↓
 [PostgreSQL / Redis]           ← trusted but should be validated anyway
```

At every boundary, validate and sanitise input. Never trust data just because it arrived over an internal network — lateral movement is a real attack vector.

## Least privilege

Every component should have the minimum permissions needed to do its job, and no more:

- An API service that only reads should connect to the DB as a **read-only** user.
- A background worker processing jobs should have no inbound network access.
- A Node process running in a container should drop to a **non-root user**.
- Secrets (DB passwords, API keys) should live in a secret manager, not in env vars baked into a Docker image.

```js
// Read-only DB connection example (concept — real code uses your DB client)
const db = createPool({
  user: process.env.DB_READONLY_USER,   // separate read-only Postgres role
  password: process.env.DB_READONLY_PASS,
  // no INSERT/UPDATE/DELETE permissions on this role in the DB
});

// Child process spawned with least privilege
import { spawn } from 'node:child_process';
const worker = spawn('node', ['worker.js'], {
  uid: Number(process.env.WORKER_UID), // non-root UID
  env: {
    PATH: process.env.PATH,
    // only the env vars the worker actually needs
    REDIS_URL: process.env.REDIS_URL,
  }
});
```

> [!PRINCIPAL] Blast radius as a design constraint
> When a component is compromised, how much damage can an attacker cause before they hit the next boundary? Designing for **minimal blast radius** — small trust zones, ephemeral credentials, per-service secrets — is what principal engineers bake into architecture before the first sprint. It is not retrofit-able cheaply.

## Secure defaults

A system is secure by default when the safest configuration is the out-of-the-box configuration — users have to *opt out* of security, not opt in. Examples in Node:

```js
// Helmet sets secure HTTP headers by default
import helmet from 'helmet';
app.use(helmet()); // Content-Security-Policy, HSTS, X-Frame-Options, etc.

// Cookie defaults: always set httpOnly, secure, sameSite
res.cookie('session', token, {
  httpOnly: true,   // not accessible to JS (XSS mitigation)
  secure: true,     // HTTPS only
  sameSite: 'Lax',  // CSRF mitigation
  maxAge: 3600_000, // 1 hour — short sessions limit exposure
});

// Never reveal the tech stack
app.disable('x-powered-by');

// Rate-limiting on by default, not something teams add "later"
import rateLimit from 'express-rate-limit';
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
```

> [!WARNING] "We'll add security later" is the most expensive statement in software
> Security retrofitted onto an insecure architecture almost always leaves gaps. Secure defaults cost nearly nothing at design time; they cost enormously after an incident.

## Defence in depth

No single control is perfect. **Defence in depth** means layering independent controls so that a failure in one does not result in a breach:

```
Layer 1 — Network:   VPC/firewall; no public DB endpoints; TLS everywhere
Layer 2 — Edge:      WAF, DDoS protection, rate limiting at the gateway
Layer 3 — App:       Input validation, parameterised queries, CSP headers
Layer 4 — Data:      Encryption at rest, field-level encryption for PII
Layer 5 — Identity:  MFA, short-lived tokens, scoped IAM roles
Layer 6 — Detection: Audit logs, anomaly alerts, SIEMs
```

Each layer catches what the one above missed. An attacker who bypasses your WAF still hits your input validation. If they exploit an injection vulnerability, field-level encryption still protects the PII.

## Try it yourself

Let's build a pure-JS risk scorer. Each threat gets a **likelihood** (1–5) and an **impact** (1–5). The risk score is their product (max 25). We sort threats highest-first to produce a prioritised backlog:

```js run
// Threat risk scorer: likelihood x impact matrix
const threats = [
  { id: "S1", name: "Forged admin JWT",         likelihood: 2, impact: 5 },
  { id: "T1", name: "SQL injection via search",  likelihood: 4, impact: 5 },
  { id: "R1", name: "Missing audit log on delete", likelihood: 3, impact: 3 },
  { id: "I1", name: "Stack trace in 500 response", likelihood: 4, impact: 2 },
  { id: "D1", name: "ReDoS in user-input regex",  likelihood: 3, impact: 4 },
  { id: "E1", name: "IDOR on /api/invoices/:id",  likelihood: 4, impact: 4 },
];

function scoreThreats(threats) {
  return threats
    .map(t => ({ ...t, score: t.likelihood * t.impact }))
    .sort((a, b) => b.score - a.score);
}

function riskLabel(score) {
  if (score >= 15) return "CRITICAL";
  if (score >= 8)  return "HIGH";
  if (score >= 4)  return "MEDIUM";
  return "LOW";
}

const scored = scoreThreats(threats);
console.log("=== Threat Risk Register ===");
scored.forEach(t => {
  const label = riskLabel(t.score);
  console.log(`[${label.padEnd(8)}] ${t.id} score=${t.score.toString().padStart(2)} — ${t.name}`);
});

console.log("\nTop priority:", scored[0].name);
```

## Exercises

**Exercise 1 — Add a new threat.** A misconfigured S3 bucket is publicly readable (likelihood 3, impact 5). Add it to the threat list above and verify it is ranked correctly.

<details>
<summary>Show solution</summary>

```js run
const threats = [
  { id: "S1", name: "Forged admin JWT",          likelihood: 2, impact: 5 },
  { id: "T1", name: "SQL injection via search",   likelihood: 4, impact: 5 },
  { id: "R1", name: "Missing audit log on delete",likelihood: 3, impact: 3 },
  { id: "I1", name: "Stack trace in 500 response",likelihood: 4, impact: 2 },
  { id: "D1", name: "ReDoS in user-input regex",  likelihood: 3, impact: 4 },
  { id: "E1", name: "IDOR on /api/invoices/:id",  likelihood: 4, impact: 4 },
  { id: "I2", name: "Public S3 bucket (data leak)",likelihood: 3, impact: 5 }, // new
];

const scored = threats
  .map(t => ({ ...t, score: t.likelihood * t.impact }))
  .sort((a, b) => b.score - a.score);

const riskLabel = s => s >= 15 ? "CRITICAL" : s >= 8 ? "HIGH" : s >= 4 ? "MEDIUM" : "LOW";

scored.forEach(t =>
  console.log(`[${riskLabel(t.score).padEnd(8)}] ${t.id} score=${t.score} — ${t.name}`)
);
// I2 scores 15 (CRITICAL) and lands at the top alongside T1
```

The public S3 bucket scores 15 (CRITICAL) and rises to the top of the register.
</details>

**Exercise 2 — Identify trust boundaries.** A Node service calls an internal micro-service via HTTP. List at least three threats at that trust boundary using STRIDE, then score them.

<details>
<summary>Show solution</summary>

```js run
// Internal service-to-service call: Node API → Payment Service
// Trust boundary: internal HTTP, no TLS, caller identity based on IP only
const internalThreats = [
  { id: "S-int", name: "Attacker spoofs caller IP to skip auth", likelihood: 2, impact: 5 },
  { id: "T-int", name: "MITM tampers with payment amount in transit", likelihood: 2, impact: 5 },
  { id: "I-int", name: "Payment service returns full card data to caller", likelihood: 3, impact: 4 },
];

const scored = internalThreats
  .map(t => ({ ...t, score: t.likelihood * t.impact }))
  .sort((a, b) => b.score - a.score);

scored.forEach(t => console.log(`score=${t.score} — ${t.name}`));

// Key takeaway: internal services still need mTLS, scoped tokens, and field filtering.
console.log("\nMitigation: use mTLS + service-identity tokens between internal services.");
```

</details>

## Common pitfalls

> [!PITFALL] Threat modeling once and forgetting it
> Teams do a threat model at project kick-off, then never revisit it. New features added over 18 months introduce entirely new attack surfaces — SSRF via a new webhook handler, IDOR via a new sharing feature — none of which appear in the original model. Treat the threat model as a **living document**, updated every time the data-flow diagram changes.

Also watch for: confusing "no known vulnerabilities" with "secure". A package with zero CVEs is not safe if it has no tests, no maintainers, and runs install scripts with network access.

## What you learned

- **STRIDE** gives you six threat categories to check systematically against every component.
- **Trust boundaries** are where you validate and authorise; never trust data just because it is "internal".
- **Least privilege** and **minimal blast radius** are architectural properties set during design, not bolt-ons.
- **Secure defaults** mean the safe configuration requires no extra effort from the developer.
- A **likelihood × impact** matrix lets you turn a list of threats into a prioritised backlog.
- **Defence in depth** ensures no single control failure results in a breach.

## Next steps

With a threat model in hand, the next question is: what external code are you trusting implicitly? The dependency tree of a typical Node project is enormous — and each package is a potential attack vector. Next up: supply-chain security, SBOM, and provenance.
*/});
