registerLessonSrc("34-structured-logging", function () {/*
---
id: 34-structured-logging
title: "Structured Logging with Pino & Correlation IDs"
minutes: 22
level: advanced
objectives:
  - Explain why structured JSON logs beat console.log in production systems
  - Use Pino for fast, levelled, child-logger-based structured logging
  - Thread correlation IDs through async call stacks with AsyncLocalStorage
---

# Structured Logging with Pino & Correlation IDs

## Why this matters

`console.log("user logged in")` is fine at your desk. In production, with a hundred microservices each emitting thousands of lines per second, it becomes a needle-in-a-haystack disaster. Structured logs are machine-readable JSON: every field is queryable, every request is traceable from ingress to database, and secrets can be stripped automatically. This is the foundation of any serious observability stack.

## Learning objectives

- Explain why **structured JSON logs** beat freeform text in production.
- Use **Pino** — the fastest Node.js logger — with levels, child loggers, and redaction.
- Thread a **correlation / request ID** through an entire async call stack with `AsyncLocalStorage` so every log line for a request shares the same `requestId`.

## Why console.log fails at scale

Text logs have two deep problems:

**1. Unqueryable.** When you grep for `"user 42"` across three services you get false positives, misaligned columns, and no way to combine fields. A log aggregator (Datadog, Loki, Elasticsearch) needs structured data to let you write `level=error AND requestId=abc AND userId=42`.

**2. No context propagation.** A bare `console.log` has no idea which HTTP request it belongs to. Every log line is an orphan.

Structured logging fixes both: emit JSON, mandate a shape, carry context.

## Pino: the fast structured logger

[Pino](https://getpino.io) is the de-facto standard for Node.js structured logging. It is 5-8x faster than Winston or Bunyan because it defers JSON serialisation to a separate worker stream and uses a minimal hot path.

```js
// logger.mjs — create a shared logger
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",   // filter by level at runtime
  redact: ["req.headers.authorization",     // strip secrets before they hit disk
            "*.password",
            "*.creditCard"],
});

export default logger;
```

```js
// server.mjs — basic usage
import logger from "./logger.mjs";

logger.info("server started");
// {"level":30,"time":1700000000000,"msg":"server started"}

logger.warn({ port: 3000 }, "binding to port");
// {"level":40,"time":...,"msg":"binding to port","port":3000}

logger.error({ err: new Error("boom") }, "unhandled error");
// {"level":50,...,"err":{"type":"Error","message":"boom","stack":"..."},"msg":"unhandled error"}
```

> [!OUTPUT]
> {"level":30,"time":1700000000000,"msg":"server started"}
> {"level":40,"time":1700000000001,"msg":"binding to port","port":3000}
> {"level":50,"time":1700000000002,"err":{"type":"Error","message":"boom","stack":"..."},"msg":"unhandled error"}

Pino log levels are numeric: `trace`=10, `debug`=20, `info`=30, `warn`=40, `error`=50, `fatal`=60. Setting `level: "warn"` silences everything below 40 — useful for production where info is too noisy.

## Child loggers: binding context fields

A **child logger** inherits all parent settings and permanently binds extra fields. Every log it emits carries those fields — no manual repetition.

```js
// Per-request child logger
import logger from "./logger.mjs";

function handleRequest(req, res) {
  const reqLogger = logger.child({
    requestId: req.headers["x-request-id"] ?? crypto.randomUUID(),
    method: req.method,
    path: req.url,
  });

  reqLogger.info("request received");
  // {"level":30,...,"requestId":"abc-123","method":"GET","path":"/users","msg":"request received"}

  doWork(reqLogger);

  reqLogger.info("request complete", { status: 200, durationMs: 12 });
}

function doWork(log) {
  log.debug("fetching from db");      // still carries requestId automatically
}
```

> [!OUTPUT]
> {"level":30,"requestId":"abc-123","method":"GET","path":"/users","msg":"request received"}
> {"level":20,"requestId":"abc-123","msg":"fetching from db"}
> {"level":30,"requestId":"abc-123","msg":"request complete","status":200,"durationMs":12}

Passing the logger as a parameter works but pollutes every function signature. The better approach is `AsyncLocalStorage`.

## Correlation IDs via AsyncLocalStorage

`AsyncLocalStorage` (part of Node's `async_hooks` module) gives you a context store that automatically flows through every `await`, `setTimeout`, and promise callback that descends from a given point — without touching function signatures.

```js
// context.mjs
import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage();
```

```js
// server.mjs
import { createServer } from "node:http";
import pino from "pino";
import { requestContext } from "./context.mjs";

const rootLogger = pino({ level: "info" });

function getLogger() {
  const store = requestContext.getStore();
  return store?.logger ?? rootLogger;
}

createServer((req, res) => {
  const requestId = req.headers["x-request-id"] ?? crypto.randomUUID();
  const reqLogger = rootLogger.child({ requestId });

  requestContext.run({ requestId, logger: reqLogger }, () => {
    reqLogger.info("request started");
    handleBusiness();
    res.end("ok");
    reqLogger.info("request ended");
  });
}).listen(3000);

function handleBusiness() {
  // No logger argument needed — pull from context
  const log = getLogger();
  log.info("inside business logic");        // carries requestId automatically
}
```

> [!OUTPUT]
> {"level":30,"requestId":"f47ac10b-...","msg":"request started"}
> {"level":30,"requestId":"f47ac10b-...","msg":"inside business logic"}
> {"level":30,"requestId":"f47ac10b-...","msg":"request ended"}

> [!PRINCIPAL] AsyncLocalStorage is not magic — it has a cost
> `AsyncLocalStorage` works by tagging every async resource (promises, timers, I/O callbacks) with a context ID and walking a tree on each transition. In throughput-critical hot paths — tight loops creating thousands of promises per second — you can measure a few percent overhead. For request-scoped logging this is almost always worth it. For per-item stream processing, pass context explicitly instead.

## Redaction of secrets

Pino's `redact` option uses a fast path-based filter. Paths can be dotted (`"user.password"`) or use wildcards (`"*.token"`). The field is replaced with `"[Redacted]"` before serialisation — it never touches the transport.

```js
const logger = pino({
  redact: {
    paths: ["req.headers.authorization", "body.password", "*.apiKey"],
    censor: "[REDACTED]",      // default is "[Redacted]"
  },
});

logger.info({
  req: { headers: { authorization: "Bearer supersecret" } },
  body: { username: "ada", password: "hunter2" },
}, "login attempt");
// authorization and password fields become "[REDACTED]" in output
```

> [!WARNING]
> Redaction is structural, not regex. It removes the *field* at the given path — it does not scrub text that happens to contain a secret embedded in a `msg` string. Never put secrets in the message string itself.

## Try it yourself

Build a mini structured logger from scratch — in pure JavaScript — that emits newline-delimited JSON lines with level filtering and automatically bound context fields. This transfers directly to understanding what Pino does under the hood.

```js run
// --- Mini structured logger ---

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function createLogger(options = {}) {
  const minLevel = LEVELS[options.level ?? "info"] ?? 30;
  const bound = options._bound ?? {};

  function emit(levelName, fields, msg) {
    const numeric = LEVELS[levelName];
    if (numeric < minLevel) return;

    const line = JSON.stringify({
      level: numeric,
      time: Date.now(),
      ...bound,
      ...(typeof fields === "string" ? {} : fields),
      msg: typeof fields === "string" ? fields : msg,
    });
    console.log(line);
  }

  return {
    trace: (f, m) => emit("trace", f, m),
    debug: (f, m) => emit("debug", f, m),
    info:  (f, m) => emit("info",  f, m),
    warn:  (f, m) => emit("warn",  f, m),
    error: (f, m) => emit("error", f, m),
    child(extraFields) {
      return createLogger({
        level: options.level ?? "info",
        _bound: { ...bound, ...extraFields },
      });
    },
  };
}

// ---- Demo ----
const log = createLogger({ level: "debug" });

log.info("server started");
log.debug({ port: 3000 }, "listening");

const reqLog = log.child({ requestId: "req-001", method: "GET" });
reqLog.info("request received");
reqLog.warn({ latencyMs: 450 }, "slow upstream");
reqLog.debug("this appears because level is debug");

// Filtered out (trace < debug)
reqLog.trace("this is suppressed");
```

## Exercise

**Add level filtering to a child logger.** Extend the mini logger so a child can *tighten* the level — e.g. `log.child({ module: "db" }, { level: "warn" })` — and verify that `info` from that child is suppressed while `warn` passes.

<details>
<summary>Show solution</summary>

```js run
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function createLogger(options = {}) {
  const minLevel = LEVELS[options.level ?? "info"] ?? 30;
  const bound = options._bound ?? {};

  function emit(levelName, fields, msg) {
    const numeric = LEVELS[levelName];
    if (numeric < minLevel) return;
    console.log(JSON.stringify({
      level: numeric,
      time: Date.now(),
      ...bound,
      ...(typeof fields === "string" ? {} : fields),
      msg: typeof fields === "string" ? fields : msg,
    }));
  }

  return {
    trace: (f, m) => emit("trace", f, m),
    debug: (f, m) => emit("debug", f, m),
    info:  (f, m) => emit("info",  f, m),
    warn:  (f, m) => emit("warn",  f, m),
    error: (f, m) => emit("error", f, m),
    child(extraFields, childOptions = {}) {
      // Child level must be >= parent level (can only tighten, not loosen)
      const childNumeric = LEVELS[childOptions.level ?? options.level ?? "info"] ?? 30;
      const effectiveLevel = Object.keys(LEVELS).find(
        k => LEVELS[k] === Math.max(minLevel, childNumeric)
      ) ?? "info";
      return createLogger({
        level: effectiveLevel,
        _bound: { ...bound, ...extraFields },
      });
    },
  };
}

const root = createLogger({ level: "debug" });
const dbLog = root.child({ module: "db" }, { level: "warn" });

root.info("root info is visible");         // visible
dbLog.info("db info is suppressed");       // suppressed — level tightened to warn
dbLog.warn("db warn is visible");          // visible
dbLog.error("db error is visible");        // visible
```

</details>

## Common pitfalls

> [!PITFALL] Logging inside a tight loop
> Do not call `logger.debug(...)` on every iteration of a loop processing thousands of items. Even with level filtering, the argument expressions are evaluated before the level check (in most loggers). Pino avoids most of this — but the safest guard is: only log on interesting transitions (first item, errors, summary), not every item.

> [!PITFALL] Circular references in JSON serialisation
> Passing an object with circular references to Pino will throw or produce truncated output. Pino has a `safe` serialiser option but it is slower. Prefer plain data shapes — never pass raw `req`/`res` objects directly; use a serialiser like `pino-std-serializers`.

## What you learned

- Structured JSON logs are **queryable and filterable** by log aggregators; free-text is not.
- **Pino** is the fastest Node.js logger: levels, child loggers, redaction, serialisers.
- **Child loggers** bind context fields permanently so every line carries metadata without manual repetition.
- **`AsyncLocalStorage`** propagates a request store through the entire async call graph, letting any function pull the current request's logger without extra parameters.
- **Redaction** strips sensitive field values before serialisation — never put secrets in the message string.

## Next steps

Logs tell you *what happened*; metrics tell you *how the system is behaving over time*. Next, you'll instrument your service with Prometheus counters and histograms to track request rates, error rates, and latency distributions.
*/});
