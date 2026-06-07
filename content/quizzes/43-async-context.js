registerQuiz("43-async-hooks", [
  {
    q: "In the async_hooks module, what does 'triggerAsyncId' represent when the 'init' callback fires for a new async resource?",
    options: [
      "The asyncId of the resource that will be executed next after this one",
      "The asyncId of the async context that was executing (executionAsyncId()) at the moment this resource was created",
      "A monotonically increasing global sequence number unrelated to the parent resource",
      "The asyncId of the event loop root, always equal to 1"
    ],
    answer: 1,
    explain: "triggerAsyncId in the init callback is the executionAsyncId() value at the time the resource was created — the asyncId that was actively running when this resource came into existence. This is the causality link used by APM agents to reconstruct the parent-child tree: by walking triggerAsyncId chains up to the root, agents can determine which HTTP request triggered any given callback."
  },
  {
    q: "Why must async_hooks callbacks use 'fs.writeSync' or similar synchronous I/O instead of 'console.log' for diagnostic output?",
    options: [
      "console.log is not available within the async_hooks module scope",
      "console.log schedules an async write, which would trigger additional hook callbacks and cause infinite recursion",
      "Synchronous I/O is faster and avoids adding latency to the measured async operations",
      "The async_hooks API prohibits calling any function that returns a Promise from within a hook"
    ],
    answer: 1,
    explain: "console.log internally schedules an asynchronous write operation. Inside a hook callback, that would create a new async resource, triggering the init hook again, which would call console.log again, and so on indefinitely. Using fs.writeSync(1, ...) performs a synchronous write that does not create async resources and does not re-enter the hook."
  },
  {
    q: "What is the primary performance cost of enabling async_hooks in a Promise-heavy Node.js server, and what Node version introduced a lighter-weight alternative?",
    options: [
      "async_hooks adds a fixed 5 ms overhead per event-loop iteration regardless of promise activity",
      "Every promise creation, resolution, and microtask step invokes a V8 PromiseHook C++ callback, causing 10-30% throughput reduction; Node 22 introduced AsyncContextFrame as a lighter replacement used by AsyncLocalStorage",
      "async_hooks disables TurboFan optimisation for all async functions, reducing throughput by 2-3x",
      "async_hooks forces all fs operations to use the thread pool even when io_uring is available, causing latency spikes"
    ],
    answer: 1,
    explain: "The PromiseHook API that async_hooks relies on fires on every promise init, resolve, and microtask step. At tens of thousands of promises per second this alone causes 10-30% throughput loss. Node 22 shipped AsyncContextFrame, a lighter V8 mechanism where context is stored as an immutable pointer in each Promise's internal slot rather than via hook callbacks. AsyncLocalStorage now uses AsyncContextFrame, reducing overhead to under 1%."
  }
]);

registerResources("43-async-hooks", [
  { title: "Node.js Docs: async_hooks module", url: "https://nodejs.org/api/async_hooks.html" },
  { title: "Node.js Docs: AsyncResource class", url: "https://nodejs.org/api/async_context.html#class-asyncresource" },
  { title: "Node.js Docs: executionAsyncId and triggerAsyncId", url: "https://nodejs.org/api/async_hooks.html#async_hooksexecutionasyncid" },
  { title: "TC39 Async Context Proposal", url: "https://github.com/tc39/proposal-async-context" },
  { title: "Node.js: Diagnostics Working Group — async context tracking", url: "https://nodejs.org/en/learn/diagnostics/diagnostics-101" }
]);

registerQuiz("43-async-local-storage", [
  {
    q: "In Node 22+, how does AsyncLocalStorage propagate context across 'await' boundaries using AsyncContextFrame, compared to the earlier PromiseHook implementation?",
    options: [
      "AsyncContextFrame copies the entire store map into each Promise on creation, just like PromiseHook but using a faster memcpy",
      "AsyncContextFrame stores an immutable linked-list pointer inside each Promise's V8 internal slot at creation time; V8 restores this pointer before running a microtask — no user-space hook callback fires",
      "AsyncContextFrame uses a global thread-local variable that is swapped on every context switch by the libuv event loop",
      "AsyncContextFrame replaces the Promise prototype to intercept .then() calls and manually propagate the store"
    ],
    answer: 1,
    explain: "In the AsyncContextFrame implementation, when a Promise is created V8 captures the current AsyncContextFrame pointer into the Promise's internal slot — a cheap pointer assignment. When the microtask runs, V8 restores that frame before invoking the callback. No PromiseHook callback fires, so the 10-30% throughput penalty of the old path drops to under 1%."
  },
  {
    q: "An EventEmitter listener is registered OUTSIDE an AsyncLocalStorage.run() call, but the emit() is called INSIDE. What does getStore() return inside the listener, and why?",
    options: [
      "getStore() returns the store from the run() call because emit() propagates the context to all registered listeners",
      "getStore() returns undefined because the listener captured its async context frame at registration time, which was outside any run() scope",
      "getStore() throws a ReferenceError because AsyncLocalStorage is not available in EventEmitter callbacks",
      "getStore() returns the store only on the first emit(); subsequent emits return undefined"
    ],
    answer: 1,
    explain: "AsyncLocalStorage context is captured when an async resource is created, not when it is invoked. An EventEmitter listener captures the AsyncContextFrame at the time 'emitter.on()' is called. If that call happens outside any run() scope, the captured frame has no store. The fix is to either register the listener inside run() so it captures the right frame, or use AsyncResource.bind() to explicitly bind the listener to the desired context."
  },
  {
    q: "What is the key difference between AsyncLocalStorage.run(store, fn) and AsyncLocalStorage.enterWith(store), and why is run() generally safer?",
    options: [
      "run() is asynchronous and returns a Promise; enterWith() is synchronous",
      "run() installs the store for the duration of fn's async subtree and automatically reverts when fn's scope exits; enterWith() permanently mutates the current async context with no automatic revert, and affects all future callbacks inheriting from the current context",
      "enterWith() accepts an object while run() only accepts primitive values",
      "run() works only in worker threads; enterWith() works on the main thread"
    ],
    answer: 1,
    explain: "AsyncLocalStorage.run(store, fn) creates a scoped context: the store is active for the synchronous execution of fn and for all async resources created within it, but it automatically reverts when the scope exits. enterWith(store) mutates the current context frame in place with no revert boundary. If called at the top level or in middleware it permanently changes the store for all future callbacks that inherit from that context, which can cause unexpected cross-request contamination."
  }
]);

registerResources("43-async-local-storage", [
  { title: "Node.js Docs: AsyncLocalStorage", url: "https://nodejs.org/api/async_context.html#class-asynclocalstorage" },
  { title: "Node.js Docs: AsyncResource.bind()", url: "https://nodejs.org/api/async_context.html#static-method-asyncresourcebindfn-type-thisarg" },
  { title: "TC39 Async Context Proposal (AsyncContextFrame basis)", url: "https://github.com/tc39/proposal-async-context" },
  { title: "Node.js Blog: Node 22 AsyncLocalStorage improvements", url: "https://nodejs.org/en/blog/release/v22.0.0" },
  { title: "OpenTelemetry Node.js: context propagation internals", url: "https://opentelemetry.io/docs/languages/js/propagation/" }
]);

registerQuiz("43-diagnostics-deep", [
  {
    q: "What is the performance cost of calling 'diagnostics_channel.channel(name).publish(data)' when no subscribers are registered on that channel?",
    options: [
      "Approximately 50-100 ns because the channel always serialises the message to JSON",
      "Approximately 1 ns — a single boolean check against V8-inlined 'hasSubscribers' counter; the message object is not allocated if the check is guarded with 'if (ch.hasSubscribers)'",
      "Zero cost because the publish method is replaced with a no-op when unsubscribed",
      "Approximately 1 ms because the channel still checks a global subscriber registry on every call"
    ],
    answer: 1,
    explain: "diagnostics_channel's hasSubscribers getter is backed by a reference-counted integer in C++ that V8 can inline. The check costs approximately 1 ns. If you guard the publish call with 'if (ch.hasSubscribers) ch.publish(buildCtx())', no message object is allocated and no subscriber dispatch occurs when no listeners are present. This makes it safe to instrument library code and ship the instrumentation to production."
  },
  {
    q: "The 'tracingChannel' API provides five named event channels per operation. In what order should a correctly instrumented async operation fire these events?",
    options: [
      "start -> asyncStart -> asyncEnd -> end (and error on failure at any stage)",
      "asyncStart -> start -> end -> asyncEnd (with error at the very end)",
      "start -> end -> asyncStart -> asyncEnd (error only on the synchronous path)",
      "asyncStart -> asyncEnd -> start -> end (reverse of execution order)"
    ],
    answer: 0,
    explain: "The tracingChannel five-event lifecycle is: 'start' fires at the synchronous start of the operation, 'asyncStart' fires when the async phase begins (e.g., I/O submitted), 'asyncEnd' fires when the async phase completes, and 'end' fires at the synchronous end on the success path. 'error' fires instead of end/asyncEnd on any failure. This ordering lets subscribers compute total duration, attach spans, and correlate errors across the async boundary."
  },
  {
    q: "When using 'node --cpu-prof' to capture a V8 CPU profile, what sampling interval and overhead should be expected, and what profiling tool is appropriate for always-on continuous profiling in production?",
    options: [
      "--cpu-prof samples at 1 ms intervals with under 1% overhead; for continuous production profiling use a tool like Pyroscope which calls V8's CpuProfiler at 10 Hz with approximately 0.5-1% CPU overhead",
      "--cpu-prof samples at 10 ms intervals with 5-10% overhead; for production use perf stat which has 0% overhead",
      "--cpu-prof samples at 100 microsecond intervals but adds 15-20% overhead; production profiling requires disabling JIT first",
      "--cpu-prof and production continuous profilers both use the same 1 ms interval; the only difference is output format"
    ],
    answer: 0,
    explain: "--cpu-prof uses V8's CpuProfiler at a default 1 ms sample interval, adding under 1% overhead — suitable for short production burns. Continuous profilers like Pyroscope and Parca (CNCF) call StartProfiling/StopProfiling on a 10 Hz timer, upload aggregated flame graph data to a time-series backend, and sustain roughly 0.5-1% CPU overhead, enabling always-on 'show me the flame graph for the last 30 seconds of elevated p99.'"
  }
]);

registerResources("43-diagnostics-deep", [
  { title: "Node.js Docs: diagnostics_channel", url: "https://nodejs.org/api/diagnostics_channel.html" },
  { title: "Node.js Docs: trace_events module", url: "https://nodejs.org/api/tracing.html" },
  { title: "Node.js Docs: --cpu-prof and --heap-prof flags", url: "https://nodejs.org/api/cli.html#--cpu-prof" },
  { title: "Pyroscope: Continuous Profiling for Node.js", url: "https://pyroscope.io/docs/nodejs/" },
  { title: "Node.js Diagnostics: Flame Graphs guide", url: "https://nodejs.org/en/learn/diagnostics/flame-graphs" }
]);
