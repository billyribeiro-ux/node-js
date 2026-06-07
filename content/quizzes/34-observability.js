registerQuiz("34-structured-logging", [
  {
    q: "What is the primary reason Pino is significantly faster than Winston or Bunyan?",
    options: [
      "Pino skips log level filtering to avoid conditional checks",
      "Pino defers JSON serialisation to a separate worker stream and uses a minimal hot path",
      "Pino writes logs synchronously to avoid async overhead",
      "Pino compresses log output before writing to reduce I/O time"
    ],
    answer: 1,
    explain: "Pino achieves 5-8x faster throughput than Winston or Bunyan by deferring expensive JSON serialisation to a separate worker stream (pino-worker or pino-transport) and keeping the hot-path in the main thread minimal -- just a fast string build and a write call."
  },
  {
    q: "When using Pino's 'redact' option, what happens to a field listed in the redact paths?",
    options: [
      "The field is removed from the log line entirely",
      "The field value is replaced with '[Redacted]' before JSON serialisation -- the raw value never reaches the transport",
      "The field is encrypted with a process-specific key before writing",
      "The entire log line is dropped if any redacted field is present"
    ],
    answer: 1,
    explain: "Pino's redact option replaces the specified field VALUES with a censor string (default '[Redacted]') at serialisation time -- before the data reaches any transport or disk. The field key remains in the log so the shape is visible, but the sensitive value is gone. Note: redaction only works on fields, not on text embedded in message strings."
  },
  {
    q: "What is the advantage of using 'AsyncLocalStorage' over passing a child logger as a function parameter for correlation IDs?",
    options: [
      "AsyncLocalStorage is faster because it uses native C++ bindings instead of JavaScript closures",
      "AsyncLocalStorage makes the request ID available in any async descendant without modifying function signatures throughout the call stack",
      "AsyncLocalStorage automatically filters log lines below the current log level",
      "AsyncLocalStorage prevents duplicate log lines when the same function is called multiple times"
    ],
    answer: 1,
    explain: "AsyncLocalStorage.run() establishes a context store that any async descendant -- Promises, setTimeout callbacks, stream handlers -- can retrieve with getStore(), without any function needing to accept or pass a logger parameter. This eliminates prop-drilling of loggers while maintaining per-request context."
  }
]);

registerResources("34-structured-logging", [
  { title: "Pino logger documentation", url: "https://getpino.io/#/" },
  { title: "Node.js AsyncLocalStorage API", url: "https://nodejs.org/api/async_context.html#class-asynclocalstorage" },
  { title: "Pino redaction documentation", url: "https://getpino.io/#/docs/redaction" },
  { title: "pino-std-serializers", url: "https://github.com/pinojs/pino-std-serializers" },
  { title: "Node.js async_hooks module", url: "https://nodejs.org/api/async_hooks.html" }
]);

registerQuiz("34-metrics", [
  {
    q: "Which Prometheus metric type should you use to track the number of currently open WebSocket connections?",
    options: [
      "Counter, because connections are events that accumulate over time",
      "Histogram, because you need a distribution of connection durations",
      "Gauge, because active connections is a current value that can go up or down",
      "Summary, because you need client-side quantiles of connection counts"
    ],
    answer: 2,
    explain: "A Gauge models a value that can increase and decrease -- exactly what 'active connections' is. A Counter only ever goes up (or resets at restart), so it cannot reflect connections closing. Gauge.inc() on open and Gauge.dec() on close gives you the current live count."
  },
  {
    q: "Why does Prometheus documentation warn against using user IDs as label values?",
    options: [
      "User IDs contain characters that break the Prometheus text exposition format",
      "Each unique label value combination creates a new time-series; user IDs create unbounded cardinality, exhausting Prometheus RAM",
      "Prometheus cannot scrape metrics endpoints faster than once per unique user",
      "User ID labels cause PromQL rate() queries to return incorrect results"
    ],
    answer: 1,
    explain: "Every unique combination of label values creates a separate time-series stored in Prometheus RAM. With 100,000 users each generating their own series, a single metric balloons to 100,000 active time-series. This is called a cardinality explosion and can crash Prometheus. Labels must use low-cardinality values like method, route (normalised), or status class."
  },
  {
    q: "In the RED methodology for request-driven services, what does the 'D' stand for and which metric type typically measures it?",
    options: [
      "Dropped requests, measured with a Counter",
      "Duration (latency), measured with a Histogram",
      "Dependencies, measured with a Gauge per downstream service",
      "Data throughput, measured with a Summary"
    ],
    answer: 1,
    explain: "RED stands for Rate, Errors, and Duration. Duration (request latency) is best modelled with a Histogram, which records observations into configurable buckets and exposes count and sum. PromQL's histogram_quantile() function then computes p50/p95/p99 latency from the bucket data across all instances."
  }
]);

registerResources("34-metrics", [
  { title: "Prometheus data model and metric types", url: "https://prometheus.io/docs/concepts/metric_types/" },
  { title: "prom-client -- Node.js Prometheus client", url: "https://github.com/siimon/prom-client" },
  { title: "Prometheus -- choosing histogram buckets", url: "https://prometheus.io/docs/practices/histograms/" },
  { title: "Prometheus -- naming best practices", url: "https://prometheus.io/docs/practices/naming/" },
  { title: "USE and RED methods -- Brendan Gregg", url: "https://www.brendangregg.com/usemethod.html" }
]);

registerQuiz("34-opentelemetry", [
  {
    q: "What HTTP header does the W3C Trace Context standard define for propagating span context between services?",
    options: [
      "X-Request-Id",
      "traceparent",
      "X-B3-TraceId",
      "Authorization"
    ],
    answer: 1,
    explain: "The W3C Trace Context specification defines the 'traceparent' header (and an optional 'tracestate' header). It encodes the trace ID, parent span ID, and flags in a standardised format. When Service A calls Service B and injects this header, Service B extracts it and creates a child span linked to Service A's span, forming one unified trace tree."
  },
  {
    q: "Why must the OpenTelemetry SDK be loaded BEFORE application code when instrumenting a Node.js service?",
    options: [
      "The SDK must patch global.fetch before it is cached by the application module loader",
      "If application code imports before the SDK registers its TracerProvider, all trace.getTracer() calls resolve to a no-op provider and no spans are generated",
      "The SDK registers a SIGTERM handler that must run before Express registers its own",
      "The SDK rewrites require() to intercept module loads, which only works before any require calls"
    ],
    answer: 1,
    explain: "OpenTelemetry uses a global TracerProvider. If your application imports and calls trace.getTracer() before the SDK calls sdk.start() and registers the real provider, those calls resolve to the default no-op provider. The fix is to load the SDK first via --import instrumentation.mjs so it runs before any other code."
  },
  {
    q: "What is the key advantage of 'tail-based sampling' over 'head-based sampling' in a distributed tracing system?",
    options: [
      "Tail-based sampling has lower CPU overhead because decisions are made only once per trace",
      "Tail-based sampling can inspect the complete trace before deciding to keep it, ensuring error traces and slow traces are always retained",
      "Tail-based sampling requires no Collector infrastructure and works directly in the SDK",
      "Head-based sampling only works with HTTP, while tail-based works with any protocol"
    ],
    answer: 1,
    explain: "Head-based sampling decides at the trace start whether to sample, before knowing if the trace will be interesting. Tail-based sampling buffers spans in a Collector until the root span ends, then decides -- always keeping error traces and high-latency traces regardless of the overall sample rate. This delivers full fidelity for interesting traces at a fraction of the storage cost."
  }
]);

registerResources("34-opentelemetry", [
  { title: "OpenTelemetry Node.js SDK documentation", url: "https://opentelemetry.io/docs/languages/js/" },
  { title: "W3C Trace Context specification", url: "https://www.w3.org/TR/trace-context/" },
  { title: "OpenTelemetry auto-instrumentations for Node", url: "https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node" },
  { title: "OpenTelemetry Collector tail sampling processor", url: "https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor" },
  { title: "OpenTelemetry semantic conventions", url: "https://opentelemetry.io/docs/specs/semconv/" }
]);
