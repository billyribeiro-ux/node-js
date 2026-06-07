registerQuiz("04-event-loop-phases", [
  {
    q: "In which event loop phase does Node.js spend most of its time when handling I/O-heavy workloads?",
    options: [
      "Timers — processing setTimeout and setInterval callbacks",
      "Check — running setImmediate callbacks",
      "Poll — waiting for and processing I/O events like file reads and network responses",
      "Close — handling socket close events"
    ],
    answer: 2,
    explain: "The Poll phase retrieves new I/O events and runs their callbacks. Since Node is designed for I/O-heavy work (file reads, network requests), the event loop spends most of its idle time here waiting for I/O to complete."
  },
  {
    q: "Inside an I/O callback, if you schedule both 'setTimeout(..., 0)' and 'setImmediate(...)', which one runs first?",
    options: [
      "setTimeout always runs first because the timers phase comes before check",
      "setImmediate always runs first because after the poll phase the very next phase is check",
      "The order is non-deterministic inside I/O callbacks just like at the top level",
      "They always run at the same time"
    ],
    answer: 1,
    explain: "Inside an I/O callback the order is deterministic: setImmediate always runs before setTimeout. After the poll (I/O) phase, the next phase is 'check' (setImmediate). Timers are only reached on the next loop iteration. At the top level the order is not guaranteed."
  },
  {
    q: "Given: console.log('A'); setTimeout(() => console.log('B'), 0); Promise.resolve().then(() => console.log('C')); console.log('D'); — what is the output order?",
    options: [
      "A, D, B, C",
      "A, B, C, D",
      "A, D, C, B",
      "A, C, D, B"
    ],
    answer: 2,
    explain: "Synchronous code runs first (A, D). Then microtasks drain before any macrotask: the promise callback runs (C). Then the timer callback runs in the next event loop iteration (B). Order: A, D, C, B."
  }
]);

registerResources("04-event-loop-phases", [
  { title: "Node.js: The Event Loop, Timers, and process.nextTick", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" },
  { title: "Node.js: Don't Block the Event Loop", url: "https://nodejs.org/en/guides/dont-block-the-event-loop" },
  { title: "libuv Design Overview", url: "https://docs.libuv.org/en/v1.x/design.html" },
  { title: "MDN: The Event Loop", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop" }
]);

registerQuiz("04-timers-and-microtasks", [
  {
    q: "What is the execution priority order from highest to lowest among process.nextTick, promise microtasks, and setTimeout?",
    options: [
      "setTimeout > promise microtasks > process.nextTick",
      "process.nextTick > promise microtasks > setTimeout",
      "promise microtasks > process.nextTick > setTimeout",
      "All three have the same priority and run in scheduling order"
    ],
    answer: 1,
    explain: "process.nextTick has the highest priority and runs before all other microtasks. Promise callbacks (.then/await/queueMicrotask) run next. Only after the entire microtask queue is drained does the event loop move to macrotasks like setTimeout."
  },
  {
    q: "What is 'event loop starvation' and what causes it?",
    options: [
      "When the event loop runs out of memory and crashes",
      "When a microtask or nextTick callback keeps scheduling more of the same, preventing the loop from ever reaching I/O or timer phases",
      "When too many setTimeout callbacks are queued at once",
      "When Node cannot find available threads in the libuv pool"
    ],
    answer: 1,
    explain: "Starvation occurs when a microtask or process.nextTick callback recursively schedules another microtask without stopping. Since Node drains the microtask queue completely before moving to the next event loop phase, the loop can never reach I/O callbacks or timers, freezing the server."
  },
  {
    q: "When breaking a large array into chunks to avoid blocking the event loop, why should you use 'setImmediate' between chunks rather than 'process.nextTick'?",
    options: [
      "setImmediate is faster than process.nextTick for array processing",
      "process.nextTick callbacks run before I/O; using it between chunks would starve I/O just like a synchronous loop",
      "process.nextTick does not accept callback functions",
      "setImmediate runs in parallel on a separate thread"
    ],
    answer: 1,
    explain: "process.nextTick callbacks run before the loop moves to the next phase, so recursive nextTick calls prevent I/O from being processed. setImmediate runs in the 'check' phase, after the poll (I/O) phase, so using it between chunks gives the event loop a chance to handle incoming I/O between batches."
  }
]);

registerResources("04-timers-and-microtasks", [
  { title: "Node.js: Understanding process.nextTick", url: "https://nodejs.org/en/learn/asynchronous-work/understanding-processnexttick" },
  { title: "Node.js: Event Loop and Microtasks", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" },
  { title: "MDN: queueMicrotask", url: "https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask" },
  { title: "Node.js: setImmediate vs setTimeout", url: "https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate" }
]);

registerQuiz("04-non-blocking-io", [
  {
    q: "What is the default size of libuv's thread pool, and which types of operations use it?",
    options: [
      "1 thread; all async operations including network I/O",
      "4 threads; fs operations, DNS lookups, crypto (pbkdf2/scrypt), and zlib compression",
      "8 threads; only CPU-bound tasks explicitly submitted by the user",
      "Unlimited threads; libuv creates a new thread for every async call"
    ],
    answer: 1,
    explain: "libuv's thread pool defaults to 4 threads. It handles operations that cannot be done asynchronously by the OS directly: fs operations, dns.lookup, crypto functions like pbkdf2 and scrypt, and zlib compression. Pure network I/O (TCP/HTTP) uses OS async mechanisms and bypasses the pool."
  },
  {
    q: "How does measuring event-loop lag (timer drift) reveal that the event loop is blocked?",
    options: [
      "A blocked loop consumes more memory, which is detected by comparing heap snapshots",
      "A timer can only fire when the loop reaches the timers phase; if the loop is blocked, the timer fires late, and the lateness equals the block duration",
      "Blocked loops emit a special 'blocked' event that can be monitored",
      "The Node process CPU usage drops to 0% when blocked, which is easy to detect"
    ],
    answer: 1,
    explain: "A setTimeout callback can only execute when the event loop reaches the timers phase. If the loop is stuck doing synchronous CPU work, it cannot reach that phase on schedule. The difference between when the timer was supposed to fire and when it actually fires measures exactly how long the loop was blocked."
  },
  {
    q: "Which environment variable allows you to increase the size of libuv's thread pool?",
    options: [
      "NODE_THREAD_COUNT",
      "LIBUV_POOL_SIZE",
      "UV_THREADPOOL_SIZE",
      "NODE_WORKER_THREADS"
    ],
    answer: 2,
    explain: "Setting 'UV_THREADPOOL_SIZE=16 node app.js' tells libuv to use 16 worker threads instead of the default 4. This is useful when your app does many concurrent pool-bound operations (like hashing passwords and reading files simultaneously) and is hitting pool exhaustion."
  }
]);

registerResources("04-non-blocking-io", [
  { title: "Node.js: perf_hooks — monitorEventLoopDelay", url: "https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions" },
  { title: "Node.js: Don't Block the Event Loop (Thread Pool section)", url: "https://nodejs.org/en/guides/dont-block-the-event-loop" },
  { title: "libuv: Thread Pool", url: "https://docs.libuv.org/en/v1.x/threadpool.html" },
  { title: "Node.js: UV_THREADPOOL_SIZE", url: "https://nodejs.org/api/cli.html#uv_threadpool_sizesize" }
]);
