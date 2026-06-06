registerLessonSrc("34-metrics", function () {/*
---
id: 34-metrics
title: "Metrics with Prometheus"
minutes: 24
level: advanced
objectives:
  - Distinguish the three pillars of observability and explain when each shines
  - Use the four Prometheus metric types correctly and expose a /metrics endpoint
  - Apply RED and USE methods and avoid high-cardinality label traps
---

# Metrics with Prometheus

## Why this matters

Logs tell you what happened to one request. Metrics tell you how the whole system behaves right now — and over the past week. When your SRE team's phone goes off at 3 AM it's almost always a metric threshold that fired: p99 latency spiked, error rate crossed 1 %, or queue depth hit 10 000. Understanding Prometheus metric types and safe labelling practices is the difference between an alert that fires in seconds and one that never fires — or one that fires on every deploy.

## Learning objectives

- Name the **three pillars of observability** and know when to reach for each.
- Understand all four **Prometheus metric types**: Counter, Gauge, Histogram, Summary.
- Expose a `/metrics` endpoint with `prom-client` and query it with PromQL.
- Apply the **RED** and **USE** methodologies and avoid **cardinality explosions**.

## The three pillars of observability

Modern observability rests on three signal types that complement each other:

| Pillar | Answers | Examples |
|--------|---------|---------|
| **Logs** | What happened to this request? | error messages, audit trails |
| **Metrics** | How is the system behaving right now? | request rate, CPU, queue depth |
| **Traces** | Why did this request take 400 ms? | span tree across services |

Metrics are cheap to store (numbers, not strings) and fast to query. They are your first line of defence for alerting. Logs and traces explain the *why* once an alert fires.

## Prometheus metric types

Prometheus defines four metric types. Each models a different kind of measurement.

### Counter

A **Counter** only ever goes up (or resets to zero on restart). Use it for totals: requests served, errors thrown, bytes sent.

```js
// prom-client counter
import { Counter } from "prom-client";

const httpRequests = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "status_code", "route"],
});

// In your request handler:
httpRequests.inc({ method: "GET", status_code: "200", route: "/users" });
```

PromQL rate: `rate(http_requests_total[5m])` gives you requests per second over a rolling 5-minute window.

### Gauge

A **Gauge** can go up or down. Use it for current values: active connections, queue size, memory used, cache hit rate.

```js
import { Gauge } from "prom-client";

const activeConnections = new Gauge({
  name: "websocket_connections_active",
  help: "Number of currently open WebSocket connections",
});

// When a connection opens:
activeConnections.inc();

// When it closes:
activeConnections.dec();

// Or set directly:
activeConnections.set(42);
```

### Histogram

A **Histogram** samples observations into configurable buckets and also tracks sum and count. This is how you measure latency distributions and percentiles.

```js
import { Histogram } from "prom-client";

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// Time a request:
const end = httpDuration.startTimer({ method: "GET", route: "/users" });
await doWork();
end();   // records the duration in the right bucket
```

> [!NOTE] Choosing histogram buckets
> Buckets must match your expected latency range. The default prom-client buckets span 5 ms to 10 s, which is fine for most HTTP services. For cache lookups you may want sub-millisecond buckets; for batch jobs, second-scale ones. Wrong buckets mean every observation lands in the catch-all `+Inf` bucket and your percentile PromQL queries return 100 %.

### Summary

A **Summary** computes quantiles client-side in a sliding time window. It is accurate for the service that produces it but cannot be aggregated across instances. Prefer Histograms in microservice architectures where multiple replicas run.

```js
import { Summary } from "prom-client";

const dbQueryDuration = new Summary({
  name: "db_query_duration_seconds",
  help: "DB query duration",
  percentiles: [0.5, 0.9, 0.99],
});
```

## The /metrics endpoint with prom-client

`prom-client` auto-registers all metrics and exposes them through a single async call.

```js
// metrics-server.mjs
import { createServer } from "node:http";
import { register, collectDefaultMetrics, Counter, Histogram } from "prom-client";

collectDefaultMetrics();   // CPU, memory, event-loop lag, GC — all for free

const requests = new Counter({
  name: "api_requests_total",
  help: "API requests total",
  labelNames: ["method", "route", "status"],
});

const latency = new Histogram({
  name: "api_request_duration_seconds",
  help: "API request duration in seconds",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
    return;
  }

  const end = latency.startTimer({ method: req.method, route: req.url });
  // ... handle request ...
  requests.inc({ method: req.method, route: req.url, status: "200" });
  end();
  res.end("ok");
}).listen(3000);
```

> [!OUTPUT]
> # HELP api_requests_total API requests total
> # TYPE api_requests_total counter
> api_requests_total{method="GET",route="/users",status="200"} 42
>
> # HELP api_request_duration_seconds API request duration in seconds
> # TYPE api_request_duration_seconds histogram
> api_request_duration_seconds_bucket{le="0.005",method="GET",route="/users"} 37
> api_request_duration_seconds_bucket{le="0.01",method="GET",route="/users"} 40
> api_request_duration_seconds_bucket{le="+Inf",method="GET",route="/users"} 42
> api_request_duration_seconds_sum{method="GET",route="/users"} 0.312
> api_request_duration_seconds_count{method="GET",route="/users"} 42

Prometheus scrapes this endpoint on a configurable interval (default 15 s) and stores the time-series data. Grafana then queries it.

## RED and USE methodologies

Two mental frameworks guide *what* to measure:

**RED** (for request-driven services — APIs, microservices):
- **R**ate — how many requests per second?
- **E**rror rate — what fraction fail?
- **D**uration — what is the p50/p95/p99 latency?

**USE** (for resources — CPU, memory, queues, connection pools):
- **U**tilization — what fraction of capacity is used?
- **S**aturation — is work queued because the resource is full?
- **E**rrors — is the resource producing errors?

These two frameworks together give you a complete picture: RED tells you if users are hurting, USE tells you which resource is the cause.

> [!PRINCIPAL] Cardinality is the enemy of scale
> Every unique combination of label values creates a new time-series in Prometheus. A label like `user_id` with 100 000 users means 100 000 series for that metric alone. Prometheus stores all active series in RAM — high cardinality can crash your Prometheus server. Rule of thumb: keep per-metric series count under ~10 000. Use low-cardinality labels: `method`, `route` (normalised, not raw URL), `status_code` class (`2xx`), `region`. Never label with request IDs, user IDs, or other unbounded values.

## Try it yourself

Build a Counter and a Histogram from first principles and render them in Prometheus text exposition format. This is exactly what `prom-client` produces when you call `register.metrics()`.

```js run
// ---- Pure-JS Prometheus text exposition renderer ----

function createCounter(name, help, labelNames) {
  const series = new Map();

  function labelsKey(labels) {
    return labelNames.map(l => `${l}="${labels[l] ?? ""}"`).join(",");
  }

  return {
    inc(labels = {}, value = 1) {
      const key = labelsKey(labels);
      series.set(key, (series.get(key) ?? 0) + value);
    },
    render() {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
      for (const [labelStr, val] of series) {
        lines.push(`${name}{${labelStr}} ${val}`);
      }
      return lines.join("\n");
    },
  };
}

function createHistogram(name, help, labelNames, buckets) {
  const allBuckets = [...buckets, Infinity];
  const series = new Map();

  function getOrCreate(key) {
    if (!series.has(key)) {
      series.set(key, { counts: new Array(allBuckets.length).fill(0), sum: 0, total: 0 });
    }
    return series.get(key);
  }

  function labelsKey(labels) {
    return labelNames.map(l => `${l}="${labels[l] ?? ""}"`).join(",");
  }

  return {
    observe(labels, value) {
      const key = labelsKey(labels);
      const s = getOrCreate(key);
      s.sum += value;
      s.total += 1;
      for (let i = 0; i < allBuckets.length; i++) {
        if (value <= allBuckets[i]) s.counts[i]++;
      }
    },
    render() {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
      for (const [labelStr, s] of series) {
        let cumulative = 0;
        for (let i = 0; i < allBuckets.length; i++) {
          cumulative += s.counts[i];
          const le = allBuckets[i] === Infinity ? "+Inf" : allBuckets[i];
          lines.push(`${name}_bucket{${labelStr},le="${le}"} ${cumulative}`);
        }
        lines.push(`${name}_sum{${labelStr}} ${s.sum.toFixed(3)}`);
        lines.push(`${name}_count{${labelStr}} ${s.total}`);
      }
      return lines.join("\n");
    },
  };
}

// ---- Demo ----
const requests = createCounter(
  "http_requests_total",
  "Total HTTP requests",
  ["method", "status"]
);

requests.inc({ method: "GET", status: "200" }, 17);
requests.inc({ method: "GET", status: "200" }, 5);
requests.inc({ method: "POST", status: "201" }, 3);
requests.inc({ method: "GET", status: "500" }, 1);

const latency = createHistogram(
  "http_request_duration_seconds",
  "Request latency",
  ["method"],
  [0.01, 0.05, 0.1, 0.5, 1]
);

// Simulate some requests
[0.004, 0.008, 0.02, 0.06, 0.12, 0.45, 0.9].forEach(v =>
  latency.observe({ method: "GET" }, v)
);

console.log(requests.render());
console.log("");
console.log(latency.render());
```

## Exercise

**Add a Gauge.** Implement a `createGauge(name, help)` function with `set(value)`, `inc()`, and `dec()` methods, and a `render()` that outputs the Prometheus text format. Test it by simulating connections opening and closing.

<details>
<summary>Show solution</summary>

```js run
function createGauge(name, help, labelNames = []) {
  const series = new Map();

  function key(labels) {
    if (!labelNames.length) return "__default__";
    return labelNames.map(l => `${l}="${labels[l] ?? ""}"`).join(",");
  }

  function get(labels) { return series.get(key(labels)) ?? 0; }

  return {
    set(value, labels = {}) { series.set(key(labels), value); },
    inc(labels = {}) { series.set(key(labels), get(labels) + 1); },
    dec(labels = {}) { series.set(key(labels), get(labels) - 1); },
    render() {
      const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
      for (const [labelStr, val] of series) {
        const ls = labelStr === "__default__" ? "" : `{${labelStr}}`;
        lines.push(`${name}${ls} ${val}`);
      }
      return lines.join("\n");
    },
  };
}

const conns = createGauge("active_connections", "Active WebSocket connections");

conns.inc(); conns.inc(); conns.inc();
console.log("after 3 opens:");
console.log(conns.render());

conns.dec();
console.log("\nafter 1 close:");
console.log(conns.render());

conns.set(10);
console.log("\nafter set(10):");
console.log(conns.render());
```

</details>

## Common pitfalls

> [!PITFALL] Using a Counter where a Gauge is needed
> Counters only go up. If you use a Counter for "active connections" it will keep climbing and never reflect closed connections. Counters are for *total accumulated events*; Gauges are for *current state*.

> [!PITFALL] High-cardinality labels crashing Prometheus
> Labelling with user IDs, session tokens, request IDs, or raw URL paths creates unbounded cardinality. Normalise routes (`/users/:id` not `/users/42`), bucket status codes (`2xx`), and never use free-form strings as label values.

## What you learned

- **Logs, metrics, and traces** are complementary — metrics are cheap, queryable, and ideal for alerting.
- **Counter** (monotone total), **Gauge** (current value), **Histogram** (distribution/buckets), **Summary** (client-side quantiles) each model different phenomena.
- `prom-client`'s `collectDefaultMetrics()` gives you CPU, memory, GC, and event-loop lag for free.
- **RED** (Rate/Errors/Duration) guides service metrics; **USE** (Utilization/Saturation/Errors) guides resource metrics.
- **Cardinality** is RAM — keep label values low-cardinality or Prometheus will run out of memory.

## Next steps

You can now see *what* is failing and *how bad* it is. The final piece of the observability puzzle is understanding *why* — tracing the exact path a request took across every service. Next up: distributed tracing with OpenTelemetry.
*/});
