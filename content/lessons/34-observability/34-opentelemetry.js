registerLessonSrc("34-opentelemetry", function () {/*
---
id: 34-opentelemetry
title: "Distributed Tracing with OpenTelemetry"
minutes: 28
level: principal
objectives:
  - Explain traces, spans, and context propagation across service boundaries
  - Instrument a Node.js service with the OpenTelemetry SDK and auto-instrumentation
  - Configure exporters and sampling strategies for production
---

# Distributed Tracing with OpenTelemetry

## Why this matters

You have a 400 ms p99 latency spike. Your Prometheus dashboard shows the slowdown exists but not *where*. Your logs are full of entries — but correlating them across four services by hand takes an hour. Distributed tracing gives you a single visual timeline of every operation a request touched — across services, databases, queues, and external APIs — with exact durations and causality. OpenTelemetry is the vendor-neutral, CNCF-backed standard that every major cloud provider and APM tool now supports. Instrument once; export to any backend.

## Learning objectives

- Understand **traces**, **spans**, and **span context** — and why context propagation across service boundaries is the hard part.
- Instrument a Node.js service with the **OpenTelemetry SDK** using both manual and auto-instrumentation.
- Choose an **exporter** (OTLP, Jaeger, console) and a **sampling strategy** that balances cost and coverage.

## Traces, spans, and context

A **trace** is the complete journey of one request — a tree of **spans**. Each span represents one unit of work:

```
Trace: handle-checkout  (400 ms total)
├── auth-verify          (12 ms)
├── inventory-check      (180 ms)
│   └── db-query         (175 ms)   ← the actual slow bit
├── payment-charge       (150 ms)
│   └── stripe-api-call  (148 ms)
└── send-confirmation    (22 ms)
    └── smtp-send        (20 ms)
```

Every span carries:
- **Trace ID** — shared by all spans in one request (128-bit hex string).
- **Span ID** — unique to this span (64-bit hex string).
- **Parent Span ID** — links child to parent, forming the tree.
- **Name, start time, end time** — what happened and when.
- **Attributes** — structured key/value metadata (`http.method`, `db.statement`).
- **Events** — timestamped annotations within a span (like a log pinned to a moment).
- **Status** — `OK`, `ERROR`, or `UNSET`.

## Context propagation

The magic of distributed tracing is that span context travels *across the wire* between services via HTTP headers (or message metadata). The W3C **Trace Context** standard defines the `traceparent` header:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              ^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  ^^
              ver        trace-id (128-bit)          span-id (64-bit)  flags
```

When Service A calls Service B, it injects this header. Service B extracts it and creates a child span — automatically linking both services' spans into the same trace tree. Without this header, Service B's spans are orphaned and you can't correlate them.

```js
// service-a.mjs — caller injects context
import { context, trace, propagation } from "@opentelemetry/api";
import { fetch } from "node:fetch";   // Node 22+

async function callServiceB() {
  const span = trace.getActiveSpan();
  const headers = {};
  propagation.inject(context.active(), headers);
  // headers now contains: { traceparent: "00-<traceId>-<spanId>-01" }

  const response = await fetch("http://service-b/api/data", { headers });
  return response.json();
}
```

```js
// service-b.mjs — receiver extracts context
import { context, trace, propagation } from "@opentelemetry/api";
import { createServer } from "node:http";

createServer((req, res) => {
  const parentCtx = propagation.extract(context.active(), req.headers);
  const tracer = trace.getTracer("service-b");

  tracer.startActiveSpan("handle-data", { }, parentCtx, (span) => {
    span.setAttribute("http.route", "/api/data");
    // ... do work ...
    span.end();
    res.end("ok");
  });
}).listen(4000);
```

> [!OUTPUT]
> [otel] Span: handle-data
>   traceId: 4bf92f3577b34da6a3ce929d0e0e4736
>   spanId:  a3ce929d0e0e4737
>   parentId: 00f067aa0ba902b7     ← linked to Service A's span
>   duration: 23ms

## Setting up the OpenTelemetry SDK

The SDK uses a **provider** registered at startup, before your application code loads. This is why you load it via `--require` or `--import` so it runs first:

```js
// instrumentation.mjs  — load this FIRST
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION }
  from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { ParentBasedSampler, TraceIdRatioBased } from "@opentelemetry/sdk-trace-base";

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: "checkout-service",
    [SEMRESATTRS_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
  }),
  // Auto-instrument http, express, pg, redis, dns, and 40+ more:
  instrumentations: [getNodeAutoInstrumentations()],
  // Sample 10% of new traces but always keep traces started by a parent:
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBased(0.1),
  }),
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
```

```bash
# Start your app with the SDK loaded first
node --import ./instrumentation.mjs server.mjs
```

> [!NOTE] Auto-instrumentation is remarkable
> `getNodeAutoInstrumentations()` monkey-patches Node's built-in `http`, `https`, `dns`, `net`, and dozens of popular packages (Express, Fastify, pg, mysql2, ioredis, grpc-js, kafkajs…). You get spans for every inbound request, outbound call, and DB query with zero changes to application code.

## Manual instrumentation

Auto-instrumentation covers infrastructure calls. For your *business logic*, add spans manually to capture what matters:

```js
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("checkout-service", "1.0.0");

async function processOrder(orderId) {
  return tracer.startActiveSpan("process-order", async (span) => {
    span.setAttribute("order.id", orderId);
    span.setAttribute("order.source", "web");

    try {
      const inventory = await checkInventory(orderId);
      span.addEvent("inventory-checked", { "items.available": inventory.count });

      const charge = await chargeCustomer(orderId);
      span.setAttribute("payment.amount_cents", charge.amountCents);

      span.setStatus({ code: SpanStatusCode.OK });
      return { success: true };
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();   // always end the span, even on error
    }
  });
}
```

> [!OUTPUT]
> Span: process-order
>   traceId: a3ce929d0e0e4736...
>   attributes:
>     order.id = "ord_42"
>     order.source = "web"
>     payment.amount_cents = 4999
>   events:
>     inventory-checked { items.available: 3 }  @ +12ms
>   status: OK
>   duration: 163ms

## Exporters

OpenTelemetry defines the **OTLP** (OpenTelemetry Protocol) as the universal wire format. All major backends accept it:

| Exporter | Use case |
|----------|---------|
| `ConsoleSpanExporter` | Development — prints spans to stdout |
| `OTLPTraceExporter` (HTTP/gRPC) | Jaeger, Tempo, Honeycomb, Datadog, Lightstep |
| `ZipkinExporter` | Legacy Zipkin deployments |
| `InMemorySpanExporter` | Unit tests — capture spans without a backend |

For development, the console exporter is invaluable:

```js
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

// In your SDK config during local dev:
sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  // ...
});
```

In production, use `BatchSpanProcessor` with `OTLPTraceExporter` — batching reduces overhead dramatically compared to sending every span immediately.

## Sampling strategies

Tracing every request in a high-traffic service is expensive. Sampling controls the fraction you keep:

- **AlwaysOn** — 100 % sampled. Great for development; expensive in production.
- **TraceIdRatioBased(0.05)** — sample 5 % of traces. Cheap but may miss rare errors.
- **ParentBased** — honour the sampling decision of the *caller*. Essential in microservices so the entire trace is either sampled or not — not half of it.
- **Custom** — implement `SamplerInterface` to sample 100 % of error traces and 1 % of success traces.

> [!PRINCIPAL] Tail-based sampling is the gold standard
> Head-based sampling (deciding at trace start) is simple but blind — you don't know yet if a trace will be interesting. Tail-based sampling (collectors like Jaeger's or OpenTelemetry Collector's `tailsampling` processor) buffer spans and decide *after* the root span ends, keeping all error traces and slow traces regardless of rate. This delivers full fidelity where it matters at a fraction of the storage cost. The tradeoff: it requires an OTel Collector with enough memory to buffer in-flight traces, adding operational complexity.

## Try it yourself

Build a pure-JavaScript tracer that creates nested parent/child spans, tracks durations, and prints the complete trace tree. This captures the core mechanics of every tracing SDK.

```js run
// ---- Pure-JS distributed tracer ----

function makeId(bytes) {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

function createTracer() {
  const spans = [];
  let activeSpanId = null;

  function startSpan(name) {
    const spanId = makeId(8);
    const span = {
      name,
      spanId,
      parentId: activeSpanId,
      traceId: spans[0]?.traceId ?? makeId(16),
      startMs: Date.now(),
      endMs: null,
      attributes: {},
      events: [],
      status: "UNSET",
    };
    spans.push(span);
    const prevActive = activeSpanId;
    activeSpanId = spanId;

    return {
      setAttribute(k, v) { span.attributes[k] = v; },
      addEvent(name, attrs = {}) {
        span.events.push({ name, relativeMs: Date.now() - span.startMs, attrs });
      },
      setStatus(code) { span.status = code; },
      end() {
        span.endMs = Date.now();
        activeSpanId = prevActive;   // restore parent as active
      },
    };
  }

  function printTree() {
    // Build child map
    const children = new Map();
    for (const s of spans) {
      const pid = s.parentId ?? "__root__";
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(s);
    }

    function printSpan(span, indent) {
      const duration = (span.endMs ?? Date.now()) - span.startMs;
      const attrs = Object.entries(span.attributes)
        .map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(
        `${"  ".repeat(indent)}[${span.status}] ${span.name} (${duration}ms)` +
        (attrs ? `  attrs: ${attrs}` : "")
      );
      for (const ev of span.events) {
        console.log(
          `${"  ".repeat(indent + 1)}* event: ${ev.name} @ +${ev.relativeMs}ms`
        );
      }
      for (const child of children.get(span.spanId) ?? []) {
        printSpan(child, indent + 1);
      }
    }

    console.log(`\nTrace: ${spans[0]?.traceId ?? "none"}`);
    for (const root of children.get("__root__") ?? []) {
      printSpan(root, 0);
    }
  }

  return { startSpan, printTree, spans };
}

// ---- Simulate a checkout request ----
const tracer = createTracer();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleCheckout(orderId) {
  const root = tracer.startSpan("handle-checkout");
  root.setAttribute("order.id", orderId);

  const authSpan = tracer.startSpan("auth-verify");
  authSpan.setAttribute("user.id", "usr_99");
  await sleep(5);
  authSpan.setStatus("OK");
  authSpan.end();

  const invSpan = tracer.startSpan("inventory-check");
  await sleep(2);
  const dbSpan = tracer.startSpan("db-query");
  dbSpan.setAttribute("db.statement", "SELECT stock FROM items WHERE id=?");
  await sleep(12);
  dbSpan.addEvent("rows-returned", { count: 3 });
  dbSpan.setStatus("OK");
  dbSpan.end();
  invSpan.setStatus("OK");
  invSpan.end();

  const paySpan = tracer.startSpan("payment-charge");
  paySpan.setAttribute("payment.provider", "stripe");
  await sleep(8);
  paySpan.addEvent("charge-created", { amount_cents: 4999 });
  paySpan.setStatus("OK");
  paySpan.end();

  root.setStatus("OK");
  root.end();
}

handleCheckout("ord_123").then(() => tracer.printTree());
```

## Project

**Instrument the microservice system end-to-end with OpenTelemetry traces and Prometheus metrics.**

You have a system of three Node.js services: an **API Gateway**, an **Order Service**, and an **Inventory Service**. Your task is to add full observability so that any slow request can be traced end-to-end and any degradation is visible in dashboards within 30 seconds.

**Acceptance criteria:**

1. Every inbound HTTP request to any service produces a trace with correct parent/child span linking via the W3C `traceparent` header.
2. Each service exposes a `/metrics` endpoint with at minimum: `http_requests_total` (Counter, labelled by method/route/status), `http_request_duration_seconds` (Histogram with 10 buckets), and `process_memory_bytes` (Gauge via `collectDefaultMetrics`).
3. Business-logic spans — `validate-order`, `check-inventory`, `reserve-stock` — are created manually with relevant attributes (`order.id`, `item.sku`, `qty.requested`).
4. Errors are recorded on spans via `span.recordException(err)` and `span.setStatus(ERROR)`, and are reflected in the `http_requests_total` counter with `status="5xx"`.
5. A `ParentBasedSampler` with `TraceIdRatioBased(0.2)` is configured in production; `AlwaysOn` in development (controlled by `NODE_ENV`).
6. An `OTLPTraceExporter` sends spans to a local Jaeger all-in-one instance; a working `docker-compose.yml` snippet is included that boots Jaeger and a Prometheus instance pre-configured to scrape all three services.

**Starter — the pure-logic tracer core from "Try it yourself" above is your foundation.** Extend it into a real instrumentation module:

```js run
// ---- Starter: tracer factory with context propagation ----

function makeId(bytes) {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

// Simulate W3C traceparent header encoding/decoding
const Propagator = {
  inject(traceId, spanId, headers) {
    headers["traceparent"] = `00-${traceId}-${spanId}-01`;
    return headers;
  },
  extract(headers) {
    const tp = headers["traceparent"];
    if (!tp) return null;
    const parts = tp.split("-");
    return { traceId: parts[1], parentSpanId: parts[2] };
  },
};

function createServiceTracer(serviceName) {
  const completedSpans = [];

  function startSpan(name, parentContext = null) {
    const traceId = parentContext?.traceId ?? makeId(16);
    const spanId = makeId(8);
    const startMs = Date.now();

    const span = {
      service: serviceName,
      name,
      traceId,
      spanId,
      parentSpanId: parentContext?.parentSpanId ?? null,
      attributes: { "service.name": serviceName },
      events: [],
      status: "UNSET",
      startMs,
      endMs: null,
    };

    return {
      setAttribute(k, v) { span.attributes[k] = v; },
      addEvent(name, attrs = {}) {
        span.events.push({ name, relativeMs: Date.now() - startMs, attrs });
      },
      recordException(err) {
        span.events.push({ name: "exception", relativeMs: Date.now() - startMs,
          attrs: { "exception.type": err.name, "exception.message": err.message } });
        span.status = "ERROR";
      },
      setStatus(code) { span.status = code; },
      injectHeaders(headers = {}) {
        return Propagator.inject(span.traceId, span.spanId, headers);
      },
      end() {
        span.endMs = Date.now();
        completedSpans.push(span);
      },
      get context() {
        return { traceId: span.traceId, parentSpanId: span.spanId };
      },
    };
  }

  function report() {
    console.log(`\n=== ${serviceName} spans ===`);
    for (const s of completedSpans) {
      const dur = s.endMs - s.startMs;
      console.log(`  [${s.status}] ${s.name} (${dur}ms) traceId=${s.traceId.slice(0, 8)}...`);
      if (s.parentSpanId) console.log(`         parent=${s.parentSpanId}`);
    }
  }

  return { startSpan, report };
}

// ---- Simulate: API Gateway -> Order Service -> Inventory Service ----

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const gateway = createServiceTracer("api-gateway");
const orderSvc = createServiceTracer("order-service");
const inventorySvc = createServiceTracer("inventory-service");

async function simulateRequest() {
  // 1. API Gateway handles inbound request
  const gwSpan = gateway.startSpan("POST /checkout");
  gwSpan.setAttribute("http.method", "POST");
  gwSpan.setAttribute("http.route", "/checkout");
  await sleep(3);

  // 2. Gateway calls Order Service — injects traceparent
  const outboundHeaders = gwSpan.injectHeaders();
  console.log("Propagated header:", outboundHeaders.traceparent);

  // 3. Order Service extracts context and creates child span
  const parentCtx = { traceId: gwSpan.context.traceId, parentSpanId: gwSpan.context.spanId };
  const orderSpan = orderSvc.startSpan("validate-order", parentCtx);
  orderSpan.setAttribute("order.id", "ord_42");
  await sleep(5);

  // 4. Order Service calls Inventory Service
  const invHeaders = orderSpan.injectHeaders();
  const invCtx = { traceId: orderSpan.context.traceId, parentSpanId: orderSpan.context.spanId };
  const invSpan = inventorySvc.startSpan("check-inventory", invCtx);
  invSpan.setAttribute("item.sku", "SKU-001");
  invSpan.setAttribute("qty.requested", 2);
  await sleep(8);
  invSpan.addEvent("stock-confirmed", { qty_available: 10 });
  invSpan.setStatus("OK");
  invSpan.end();

  orderSpan.setStatus("OK");
  orderSpan.end();

  gwSpan.setAttribute("http.status_code", 200);
  gwSpan.setStatus("OK");
  gwSpan.end();

  // Report
  gateway.report();
  orderSvc.report();
  inventorySvc.report();
}

simulateRequest();
```

## Common pitfalls

> [!PITFALL] Forgetting to call span.end()
> An unclosed span leaks memory in the SDK's active span table and never reaches the exporter. Always call `span.end()` in a `finally` block or use `startActiveSpan`'s callback form, which calls `end()` automatically when the callback returns or throws.

> [!PITFALL] Using string concatenation as span names
> Span names like `"GET /users/42"` create unbounded cardinality in your tracing backend — one time-series per user ID. Use normalised names like `"GET /users/:id"` or `"fetch-user"`. The raw URL belongs in an attribute (`http.target`), not in the span name.

> [!PITFALL] Loading the SDK after application code
> If you `import` your application before the OTel SDK registers its TracerProvider, all `trace.getTracer()` calls in application code resolve to a no-op provider — you get zero spans. Always load `instrumentation.mjs` first via `--import` or as the very first import in your entrypoint.

## What you learned

- A **trace** is a tree of **spans** sharing a trace ID; each span records name, duration, attributes, events, and status.
- The W3C **`traceparent` header** propagates span context across HTTP service calls, linking spans from different services into one trace tree.
- The **OpenTelemetry SDK** provides a `NodeSDK` entry point, auto-instrumentation for 40+ libraries, manual span creation via `trace.getTracer()`, and pluggable exporters (OTLP, console, Zipkin).
- **Sampling** is mandatory at scale: use `ParentBased` + `TraceIdRatioBased` for head-based sampling; consider tail-based sampling in the OTel Collector for maximum fidelity at minimum cost.
- Observability is the union of logs, metrics, and traces — each fills a gap the others leave.

## Next steps

With all three pillars in place — structured logs via Pino, metrics via Prometheus, and distributed traces via OpenTelemetry — your services are fully observable. The next module covers containerising and deploying them: Docker, CI/CD pipelines, and Kubernetes.
*/});
