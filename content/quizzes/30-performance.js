registerQuiz("30-cpu-profiling", [
  {
    q: "In a flamegraph, what does the WIDTH of a frame represent?",
    options: [
      "The number of times the function was called",
      "The proportion of total CPU samples that included that frame",
      "The stack depth at which the function was called",
      "The colour intensity of the heat map"
    ],
    answer: 1,
    explain: "The x-axis (width) of a flamegraph represents the proportion of total CPU samples that included that frame. Wider frames consumed more CPU time. Height represents stack depth, and colour does not indicate heat."
  },
  {
    q: "Which Node.js flag writes a '.cpuprofile' file that can be loaded directly in Chrome DevTools?",
    options: [
      "--prof",
      "--trace-deopt",
      "--cpu-prof",
      "--inspect"
    ],
    answer: 2,
    explain: "'--cpu-prof' tells V8 to sample the call stack and write a .cpuprofile file on exit. '--prof' writes a lower-level V8 tick log that requires post-processing with '--prof-process', and '--inspect' opens the DevTools remote-debugging protocol."
  },
  {
    q: "According to the measure-first methodology, what is the correct step AFTER identifying a hot path in a flamegraph?",
    options: [
      "Rewrite the entire module for clarity",
      "Change exactly one thing and then profile again to confirm improvement",
      "Increase the sampling interval to reduce overhead",
      "Disable V8 optimisations with --no-opt to get a cleaner profile"
    ],
    answer: 1,
    explain: "The golden rule is: measure, identify, change one thing, then measure again. Changing multiple things at once makes it impossible to know which change caused any improvement (or regression)."
  }
]);

registerResources("30-cpu-profiling", [
  { title: "Node.js CPU profiling flags (--cpu-prof, --prof)", url: "https://nodejs.org/en/docs/guides/simple-profiling" },
  { title: "clinic.js documentation", url: "https://clinicjs.org/documentation/" },
  { title: "0x flamegraph tool on GitHub", url: "https://github.com/nicolo-ribaudo/0x" },
  { title: "Chrome DevTools Performance panel", url: "https://developer.chrome.com/docs/devtools/performance/" },
  { title: "Node.js diagnostics and profiling guide", url: "https://nodejs.org/en/learn/diagnostics/memory/using-heap-profiler" }
]);

registerQuiz("30-benchmarking", [
  {
    q: "Why can V8's dead-code elimination make a naive micro-benchmark report zero overhead?",
    options: [
      "V8 clears the timer between iterations",
      "V8 detects that the result of the computation is never used and eliminates the entire loop",
      "V8 shares memory between runs so the second run is instantaneous",
      "The garbage collector runs between iterations and resets allocations"
    ],
    answer: 1,
    explain: "If the return value of a hot loop is never used, V8's JIT compiler may determine the computation has no side effects and eliminate it entirely. The fix is to consume the result (e.g., accumulate into a variable) so the compiler cannot skip the work."
  },
  {
    q: "When comparing two benchmark results, which statistical metric is MOST robust to outliers like GC pauses?",
    options: [
      "Mean (average) time per operation",
      "Total elapsed time across all iterations",
      "Median time per operation",
      "Maximum time per operation"
    ],
    answer: 2,
    explain: "The median is the middle value when samples are sorted, making it insensitive to occasional spikes caused by GC pauses or OS scheduling. The mean is pulled upward by outliers, making high-p99 latency invisible in the average."
  },
  {
    q: "What is Amdahl's Law's implication for micro-benchmarking results?",
    options: [
      "A function that is 2x faster in isolation may deliver only a small system-level improvement if it accounts for a small fraction of total CPU time",
      "Benchmarks must always be run with at least two CPU cores to be valid",
      "The JIT warm-up phase doubles the apparent benchmark time",
      "Increasing iteration count always reduces measurement noise linearly"
    ],
    answer: 0,
    explain: "Amdahl's Law states that the speedup of the whole system is limited by the fraction of time spent in the optimised part. A 2x faster function that accounts for 1% of total CPU time delivers at most a 0.5% overall improvement, making the micro-benchmark result misleading without system-level verification."
  }
]);

registerResources("30-benchmarking", [
  { title: "tinybench library (GitHub)", url: "https://github.com/tinylibs/tinybench" },
  { title: "mitata benchmarking library (GitHub)", url: "https://github.com/nicolo-ribaudo/mitata" },
  { title: "Node.js perf_hooks — performance.now()", url: "https://nodejs.org/api/perf_hooks.html#performancenow" },
  { title: "MDN: Performance.now()", url: "https://developer.mozilla.org/en-US/docs/Web/API/Performance/now" }
]);

registerQuiz("30-tracing", [
  {
    q: "What is the primary advantage of 'diagnostics_channel' over monkey-patching a library's internals?",
    options: [
      "diagnostics_channel has lower latency than direct function calls",
      "It completely decouples the publisher from the subscriber — neither side needs to know about the other",
      "It automatically serialises all events to JSON for log aggregators",
      "It works across worker_threads boundaries without extra configuration"
    ],
    answer: 1,
    explain: "diagnostics_channel is a publish/subscribe system where the library (publisher) and the tracing tool (subscriber) are fully decoupled. The library publishes events on a named channel regardless of whether anything is listening. This is how Node's own built-ins expose telemetry without monkey-patching."
  },
  {
    q: "Which Node.js API allows a request ID to flow automatically through async boundaries like Promises and setTimeout without passing it as a function parameter?",
    options: [
      "process.env",
      "EventEmitter",
      "AsyncLocalStorage",
      "diagnostics_channel"
    ],
    answer: 2,
    explain: "AsyncLocalStorage (from 'node:async_hooks') propagates a context store through Promises, setTimeout, setImmediate, and Node streams automatically. Any async descendant of an AsyncLocalStorage.run() call can retrieve the store with getStore() without the context being explicitly passed as a parameter."
  },
  {
    q: "In a span/trace model, what MUST always happen in the 'finally' block when wrapping async work in a span?",
    options: [
      "The parent span must be promoted to root span",
      "The span must be ended so its duration is recorded and its parent's timing is accurate",
      "The trace ID must be regenerated to avoid collisions",
      "AsyncLocalStorage must be cleared to prevent context leaks"
    ],
    answer: 1,
    explain: "Every span must be ended (via endSpan or span.end()) even when the wrapped async work throws. Without a finally block, an exception leaves the span open indefinitely, inflating the parent span's duration to infinity and causing the span to never reach the exporter."
  }
]);

registerResources("30-tracing", [
  { title: "Node.js diagnostics_channel API", url: "https://nodejs.org/api/diagnostics_channel.html" },
  { title: "Node.js async_hooks — AsyncLocalStorage", url: "https://nodejs.org/api/async_context.html#class-asynclocalstorage" },
  { title: "Node.js perf_hooks — PerformanceObserver & marks", url: "https://nodejs.org/api/perf_hooks.html" },
  { title: "OpenTelemetry Node.js SDK", url: "https://opentelemetry.io/docs/languages/js/" },
  { title: "W3C Trace Context specification", url: "https://www.w3.org/TR/trace-context/" }
]);
