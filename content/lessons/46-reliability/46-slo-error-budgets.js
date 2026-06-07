registerLessonSrc("46-slo-error-budgets", function () {/*
---
id: 46-slo-error-budgets
title: "SLIs, SLOs & Error Budgets"
minutes: 26
level: advanced
objectives:
  - Distinguish SLI, SLO, and SLA and choose measurable SLIs for latency, availability, and quality
  - Calculate an error budget from an SLO target and interpret multi-window burn-rate alerts
  - Apply error-budget policy — when to freeze releases, do toil-reduction sprints, or accept risk
---

# SLIs, SLOs & Error Budgets

## Why this matters

Reliability is not "uptime" — it is an economic contract between your team and your users.
Every minute you spend making a system more reliable beyond what users notice is wasted;
every minute it is less reliable than they need is a disaster. SLOs give you the mathematical
language to express that contract precisely and to make objective decisions about when to ship
features versus when to pay down reliability debt.

## Learning objectives

- Distinguish SLI, SLO, and SLA and choose measurable SLIs for latency, availability, and quality.
- Calculate an error budget from an SLO target and interpret multi-window burn-rate alerts.
- Apply error-budget policy — when to freeze releases, do toil-reduction sprints, or accept risk.

## The Vocabulary: SLI → SLO → SLA

**SLI (Service Level Indicator)** — a quantitative measure of some aspect of the level of service.
It is a ratio: `good_events / total_events` over a rolling or calendar window.
Good SLIs are *user-visible*, *measurable at the service boundary*, and *actionable*.

**SLO (Service Level Objective)** — an internal target for an SLI: `SLI ≥ target%`.
It is your reliability engineering target, not a legal commitment.

**SLA (Service Level Agreement)** — an external, contractual promise (usually to enterprise
customers), typically set 10–20% *below* the SLO so internal alerts fire before you breach the
legal threshold. SLAs carry financial penalties; SLOs do not.

```
           ┌──────────────────────────────────────────────────────────┐
           │  SLI: good_requests / total_requests = 99.95%            │
           │  SLO: >= 99.9%   (internal target — drives alerts)       │
           │  SLA: >= 99.5%   (external contract — drives penalties)  │
           └──────────────────────────────────────────────────────────┘
```

> [!PRINCIPAL] Pick SLIs at the user-visible boundary, not deep in the stack
> An SLI measured at an internal cache layer or a database read replica tells you something about
> that component, not about user experience. Instrument your SLIs at the outermost gateway or
> load balancer. A cache miss that is transparently retried is NOT a bad event. A user who got
> a 5xx or waited > 2 s IS a bad event, regardless of how your internals behaved.

## Choosing Good SLIs

### Availability SLI

The simplest and most common: what fraction of requests succeeded (non-5xx)?

```
availability_SLI = (requests - errors) / requests
```

Measure errors at the reverse-proxy layer so you capture the full blast radius, including
those that never reached your application (e.g., TLS handshake failures, upstream timeouts).

### Latency SLI

A *ratio* SLI: what fraction of requests completed in under the target latency?

```
latency_SLI = requests_under_threshold / total_requests
```

This is better than a simple percentile metric because it composes as a ratio and integrates
naturally with the error-budget model. Common targets: `p99 < 500 ms` → `99% of requests < 500 ms`.

> [!NOTE] Use multiple latency thresholds
> Define two thresholds: one "fast" (p90 < 200 ms) and one "tolerable" (p99 < 1 s).
> The SLO covers the stricter one; the softer one is a leading indicator of degradation.

### Quality / Freshness SLIs

For async systems (recommendation engines, caches, ML pipelines):

- **Freshness**: fraction of responses served from data < N minutes old.
- **Correctness**: fraction of responses passing a validation check (e.g., non-empty, valid schema).
- **Coverage**: fraction of items in a corpus that were processed by the pipeline in < 24 h.

## The Nines — and Their Real Downtime

| SLO | Error budget per year | Per month | Per week |
|-----|----------------------|-----------|----------|
| 99% (two nines) | 87.6 h | 7.3 h | 1.68 h |
| 99.5% | 43.8 h | 3.65 h | 50 min |
| 99.9% (three nines) | 8.76 h | 43.8 min | 10 min |
| 99.95% | 4.38 h | 21.9 min | 5 min |
| 99.99% (four nines) | 52.6 min | 4.38 min | 1 min |
| 99.999% (five nines) | 5.26 min | 26 s | 6 s |

Five nines over a month is 26 seconds of tolerated downtime. A single deploy that takes a rolling
restart will eat that in seconds. This is why five nines is the wrong target for almost everyone —
it means you cannot ship software. Aim for the SLO that reflects user pain, not engineering ego.

> [!PRINCIPAL] The "right" SLO is the one that generates the right incentives
> If your SLO is too tight, every incident freezes the release pipeline and all engineering energy
> pours into toil. If it is too loose, the team ships recklessly. The correct SLO is calibrated
> against *measured user churn* data: find the error rate at which users stop returning, then set
> the SLO just above it. Google's SRE Book calls this "error budget as innovation rate controller."

## Error Budgets

The **error budget** is the allowed fraction of bad events implied by the SLO:

```
error_budget_total = (1 - SLO_target) * window_requests
error_budget_remaining = error_budget_total - actual_bad_events
```

The budget resets each calendar window (usually 28 or 30 days). The team "spends" budget through
incidents, planned maintenance, and risky releases. When the budget is exhausted, the policy kicks in:
releases freeze, and all engineering goes into reliability work.

### Multi-Window Multi-Burn-Rate Alerting

Simple threshold alerts ("error rate > 1% for 5 min") have two failure modes: they page you at
3 am for a blip that exhausted 0.001% of the budget, or they miss a slow burn that exhausts 20%
of the budget over a week.

The Google SRE Workbook recommends **multi-window, multi-burn-rate** alerts with two properties:

1. **Burn rate** — how fast you are consuming the budget relative to the neutral pace.
   A burn rate of `1.0` means you will exactly exhaust the budget at end of window.
   A burn rate of `14.4` means you burn a 30-day budget in 50 hours.

2. **Two windows** — a short window (e.g., 1 h) to confirm the burn is real;
   a long window (e.g., 6 h) to catch slow burns that the short window misses.

Alert thresholds commonly used:

| Severity | Burn rate | Long window | Short window | Budget consumed by trigger |
|----------|-----------|-------------|--------------|----------------------------|
| Page (P0) | 14.4× | 1 h | 5 min | 2% in 1 h |
| Page (P1) | 6× | 6 h | 30 min | 5% in 6 h |
| Ticket | 3× | 3 days | 6 h | 10% in 3 days |
| Warning | 1× | 30 days | — | on pace to exhaust |

A burn-rate `b` over a 30-day window at error rate `e` satisfies:
`b = e / (1 - SLO_target)` — if SLO = 99.9% then 1-target = 0.001, so a 1.44% error rate = burn rate 14.4.

```js
// Real Prometheus alerting rule (read-only reference)
// Alert fires when BOTH windows show elevated burn rate.
// groups:
//   - name: slo_alerts
//     rules:
//       - alert: HighBurnRate
//         expr: |
//           (
//             rate(http_requests_total{status=~"5.."}[1h])
//             / rate(http_requests_total[1h])
//           ) > (14.4 * 0.001)
//           and
//           (
//             rate(http_requests_total{status=~"5.."}[5m])
//             / rate(http_requests_total[5m])
//           ) > (14.4 * 0.001)
//         labels:
//           severity: page
//         annotations:
//           summary: "SLO burn rate critical (14.4x over 1h + 5m windows)"
```

## Toil

**Toil** in SRE parlance is manual, repetitive, automatable work that scales linearly with load
and provides no enduring value. Restarting a service, manually rotating a secret, clearing a
stuck queue — these are toil. The SRE rule of thumb: keep toil below 50% of on-call time.
When the error budget is healthy (plenty remaining), teams have license to ship features.
When it is burned down, toil-reduction work takes priority.

## Try it yourself

Run the error-budget and burn-rate calculator below. Edit `sloTarget`, `windowDays`,
`requestsPerDay`, and `currentErrorRate` to model your own service.

```js run
// Error budget + multi-window burn-rate calculator
// Pure browser JS — no Node APIs needed.

function calcErrorBudget({
  sloTarget,       // e.g. 0.999
  windowDays,      // e.g. 30
  requestsPerDay,  // e.g. 1_000_000
  currentErrorRate // e.g. 0.002 (0.2%)
}) {
  const totalRequests   = windowDays * requestsPerDay;
  const budgetFraction  = 1 - sloTarget;
  const budgetRequests  = totalRequests * budgetFraction;
  const badRequests     = totalRequests * currentErrorRate;
  const remaining       = budgetRequests - badRequests;
  const pctConsumed     = (badRequests / budgetRequests) * 100;

  // burn rate: how fast relative to neutral (1.0 = exact pace to exhaust at end of window)
  const burnRate = currentErrorRate / budgetFraction;

  // time to exhaustion at current rate (days)
  const timeToExhaust = remaining > 0
    ? (remaining / (requestsPerDay * currentErrorRate))
    : 0;

  // multi-window alert thresholds
  const alerts = [
    { label: "P0 page",  burnThreshold: 14.4, longWindow: "1h",    shortWindow: "5m"  },
    { label: "P1 page",  burnThreshold: 6,    longWindow: "6h",    shortWindow: "30m" },
    { label: "Ticket",   burnThreshold: 3,    longWindow: "3d",    shortWindow: "6h"  },
    { label: "Warning",  burnThreshold: 1,    longWindow: "30d",   shortWindow: "—"   },
  ];

  console.log("=== Error Budget Report ===");
  console.log(`SLO target:          ${(sloTarget * 100).toFixed(3)}%`);
  console.log(`Window:              ${windowDays} days`);
  console.log(`Total requests:      ${totalRequests.toLocaleString()}`);
  console.log(`Budget (allowed bad):${budgetRequests.toLocaleString()} requests`);
  console.log(`Actual bad requests: ${badRequests.toLocaleString()}`);
  console.log(`Budget remaining:    ${remaining.toLocaleString()} (${(100 - pctConsumed).toFixed(2)}% left)`);
  console.log(`Burn rate:           ${burnRate.toFixed(2)}x`);
  console.log(`Time to exhaustion:  ${remaining > 0 ? timeToExhaust.toFixed(1) + " days" : "ALREADY EXHAUSTED"}`);
  console.log("");
  console.log("=== Active Alerts ===");
  for (const a of alerts) {
    const firing = burnRate >= a.burnThreshold;
    console.log(`  ${firing ? "🔥 FIRING" : "   ok   "} ${a.label.padEnd(10)} (threshold ${a.burnThreshold}x, windows ${a.longWindow} + ${a.shortWindow})`);
  }
}

calcErrorBudget({
  sloTarget:       0.999,   // 99.9% SLO
  windowDays:      30,
  requestsPerDay:  1_000_000,
  currentErrorRate: 0.0025  // currently 0.25% error rate
});
```

## Exercise: Model a latency SLO

Your service has an SLO that 99.5% of requests complete in < 300 ms (latency SLI).
Over the last 24 hours (1,440,000 requests), 12,600 requests exceeded 300 ms.
What is your error rate, burn rate (30-day window, 99.5% SLO), and budget remaining?

<details>
<summary>Show solution</summary>

```js run
const totalRequests   = 1_440_000;
const slowRequests    = 12_600;
const sloTarget       = 0.995;
const windowDays      = 30;
const requestsPerDay  = totalRequests / 1; // 24-hour sample

const errorRate       = slowRequests / totalRequests;
const budgetFraction  = 1 - sloTarget;      // 0.005
const burnRate        = errorRate / budgetFraction;

const totalWindowReq  = requestsPerDay * windowDays;
const budgetReq       = totalWindowReq * budgetFraction;
const usedToday       = requestsPerDay * errorRate;
const remaining       = budgetReq - usedToday;

console.log(`Error rate:      ${(errorRate * 100).toFixed(4)}%`);
console.log(`Budget fraction: ${(budgetFraction * 100).toFixed(2)}%`);
console.log(`Burn rate:       ${burnRate.toFixed(2)}x`);
console.log(`Budget used today: ${usedToday.toLocaleString()} requests`);
console.log(`Budget remaining:  ${remaining.toLocaleString()} requests`);
console.log(`Alert: ${burnRate >= 6 ? "P1 PAGE (>= 6x burn)" : burnRate >= 3 ? "Ticket (>= 3x burn)" : "OK"}`);
// Error rate 0.875%, burn rate ~1.75x → Ticket threshold
```

The error rate is 0.875% against a 0.5% budget — a 1.75x burn rate. This files a ticket
but does not page. The team has time to investigate during business hours.
</details>

## Common pitfalls

> [!PITFALL] Setting the SLO to "five nines" because it sounds impressive
> Five nines means 26 seconds of allowed downtime per month. A single deploy with a bad health-check
> window will consume it instantly. Teams that set aspirational SLOs without understanding the
> budget mechanics end up either ignoring the system entirely or creating massive alert fatigue.
> Start at 99.9%, measure reality, and adjust from there. The SLO should describe what users
> actually need, not what engineering aspires to.

A secondary pitfall: counting all errors equally. A 503 during a planned maintenance window with
advance notice is not the same as a surprise 503 at peak. Most teams exclude planned downtime from
the error budget; encode that in your alerting rules and runbooks.

## What you learned

- **SLI** is the measured ratio; **SLO** is the target; **SLA** is the external contract.
- Good SLIs are user-visible, ratio-based, and measured at the service boundary.
- The **error budget** is `(1 - SLO_target) × total_events`; it resets each window.
- **Multi-window, multi-burn-rate** alerts fire on fast burns (14.4×) and slow burns (3×) independently.
- When the budget is healthy, ship features; when it is exhausted, pay down reliability debt.
- Toil consumes engineering capacity; keep it below 50% and track it as a first-class metric.

## Next steps

With SLOs and error budgets defined, you need to understand *why* your service degrades under
load. Next: queueing theory — Little's Law, utilization thresholds, and the Universal Scalability
Law give you the physics of latency blow-up before it happens.
*/});
