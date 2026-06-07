registerQuiz("32-heap-snapshots", [
  {
    q: "What does 'retained size' of an object mean in a heap snapshot?",
    options: [
      "The bytes the object itself occupies, not counting anything it points to",
      "The bytes that would be freed if this object and everything it exclusively keeps alive were collected",
      "The total size of all objects allocated since the process started",
      "The number of outgoing references from that object"
    ],
    answer: 1,
    explain: "Retained size is the amount of memory that would be reclaimed if the object were removed from the heap. It includes the object itself plus all objects that are exclusively reachable through it. This is the metric to chase when hunting leaks, not shallow size."
  },
  {
    q: "Which method allows you to capture a heap snapshot of a running production service without any code changes?",
    options: [
      "Calling v8.writeHeapSnapshot() from an HTTP endpoint",
      "Using the --expose-gc flag and calling gc() periodically",
      "Starting Node with --heapsnapshot-signal=SIGUSR2 and sending that signal",
      "Attaching Chrome DevTools via --inspect and pausing the process"
    ],
    answer: 2,
    explain: "The --heapsnapshot-signal flag tells Node to write a heap snapshot file whenever the specified signal is received. Sending SIGUSR2 to the process triggers the snapshot with zero code changes, making it the safest option for production capture."
  },
  {
    q: "When comparing two heap snapshots to find a leak, what is the correct DevTools view to switch to and what should you sort by?",
    options: [
      "Summary view, sorted by shallow size descending",
      "Comparison view, sorted by size delta descending",
      "Allocation timeline, sorted by allocation time",
      "Statistics view, sorted by constructor name alphabetically"
    ],
    answer: 1,
    explain: "In Chrome DevTools, switching from Summary to Comparison mode (with the baseline snapshot selected) shows which constructors grew between the two snapshots. Sorting by size delta descending immediately surfaces the types that accumulated the most memory, which are the prime leak suspects."
  }
]);

registerResources("32-heap-snapshots", [
  { title: "Node.js v8.writeHeapSnapshot() API", url: "https://nodejs.org/api/v8.html#v8writeheapsnapshotfilenameoptions" },
  { title: "Node.js CLI -- heapsnapshot-signal flag", url: "https://nodejs.org/api/cli.html#--heapsnapshot-signalsignal" },
  { title: "Chrome DevTools Memory panel guide", url: "https://developer.chrome.com/docs/devtools/memory-problems/" },
  { title: "Node.js diagnostics -- heap profiler guide", url: "https://nodejs.org/en/learn/diagnostics/memory/using-heap-profiler" },
  { title: "Node.js diagnostics -- heap snapshot guide", url: "https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot" }
]);

registerQuiz("32-leak-sources", [
  {
    q: "Which data structure should replace an unbounded 'Map' used as a cache to prevent memory growth?",
    options: [
      "A WeakMap, because its entries are automatically deleted",
      "A Set, because sets do not store duplicate values",
      "A bounded LRU cache that evicts the least-recently-used entry when full",
      "A plain object, because V8 optimises object property access better than Map"
    ],
    answer: 2,
    explain: "A WeakMap only allows objects as keys, so it cannot replace a string-keyed cache. The correct fix is a bounded LRU cache: it enforces a maximum entry count and evicts the least-recently-used entry when that limit is reached, preventing unbounded growth."
  },
  {
    q: "What is the correct way to prevent an event listener registered with 'emitter.on()' from causing a memory leak?",
    options: [
      "Use emitter.emit() more frequently to flush listener queues",
      "Store the listener reference and call emitter.off() in a destroy or cleanup method",
      "Wrap the listener in a WeakRef so the GC can reclaim it",
      "Set the listener function to null after adding it"
    ],
    answer: 1,
    explain: "An emitter holds a strong reference to each listener. If the emitter outlives the object that registered the listener, neither can be collected. The fix is to store the listener reference and call emitter.off(event, listener) during teardown so the emitter releases its reference."
  },
  {
    q: "What is the key difference between 'WeakMap' and 'WeakRef' for managing optional object references?",
    options: [
      "WeakMap can store primitive keys; WeakRef cannot",
      "WeakRef holds a single weakly-referenced value and requires calling deref() to access it; WeakMap maps object keys to strongly-held values",
      "WeakMap keys are weakly held so the entry disappears when the key is collected; WeakRef holds one weakly-referenced value and deref() returns undefined if collected",
      "WeakRef is only available in Node 20+; WeakMap works in all versions"
    ],
    answer: 2,
    explain: "In a WeakMap, the KEY is weakly held, so when the key object is collected the entry is removed automatically. A WeakRef wraps a single object reference weakly; calling deref() returns the object or undefined if it has been garbage-collected. Both avoid preventing collection, but they serve different use cases."
  }
]);

registerResources("32-leak-sources", [
  { title: "MDN: WeakMap", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap" },
  { title: "MDN: WeakRef", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef" },
  { title: "MDN: FinalizationRegistry", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry" },
  { title: "Node.js EventEmitter -- removeListener", url: "https://nodejs.org/api/events.html#emitterremovelistenereventname-listener" },
  { title: "Node.js diagnostics -- memory leaks guide", url: "https://nodejs.org/en/learn/diagnostics/memory/using-heap-profiler" }
]);

registerQuiz("32-production-triage", [
  {
    q: "Which field from 'process.memoryUsage()' is the clearest early signal of a JavaScript heap memory leak?",
    options: [
      "rss, because it includes all memory held by the process",
      "heapTotal, because it reflects V8's committed heap reservation",
      "heapUsed trending upward across GC cycles",
      "external, because native addons are the most common leak source"
    ],
    answer: 2,
    explain: "heapUsed reflects the bytes actually occupied by live JavaScript objects. A monotonically rising heapUsed across multiple GC cycles is the strongest signal of a heap leak. heapTotal can grow for benign reasons, and rss rising without heapUsed movement suggests a native or Buffer leak rather than a JS leak."
  },
  {
    q: "In the production triage runbook, why must you force a GC BEFORE taking each heap snapshot?",
    options: [
      "To make the snapshot file smaller so it transfers faster",
      "To ensure both snapshots only contain live objects, so the comparison shows true growth rather than GC lag",
      "To reset the heapTotal counter before measurement",
      "To prevent the snapshot process from pausing the event loop"
    ],
    answer: 1,
    explain: "Without a forced GC, snapshot B may contain objects that are actually garbage but not yet collected. The comparison would then show these non-live objects as 'new', producing false positives. Forcing GC before both snapshots ensures you compare only truly live objects."
  },
  {
    q: "What is the only valid proof that a memory leak fix is actually working on a live production service?",
    options: [
      "Restarting the process and observing that memory is low immediately after boot",
      "Heap snapshot size dropping below 100 MB",
      "The heapUsed trend slope turning flat or negative on the same running process after the fix is deployed",
      "The rss value stabilising for 60 seconds after a canary deployment"
    ],
    answer: 2,
    explain: "Restarting hides leaks rather than curing them. The only valid proof is observing a trend reversal -- the heapUsed slope going from positive to near-zero or negative -- on the same continuously running process. This demonstrates that new allocations are no longer outpacing GC reclamation."
  }
]);

registerResources("32-production-triage", [
  { title: "Node.js process.memoryUsage() API", url: "https://nodejs.org/api/process.html#processmemoryusage" },
  { title: "Node.js CLI -- expose-gc flag", url: "https://nodejs.org/api/cli.html#--expose-gc" },
  { title: "Node.js diagnostics -- memory leaks", url: "https://nodejs.org/en/learn/diagnostics/memory/using-heap-profiler" },
  { title: "clinic.js doctor for memory analysis", url: "https://clinicjs.org/documentation/doctor/" },
  { title: "Chrome DevTools Memory panel", url: "https://developer.chrome.com/docs/devtools/memory-problems/" }
]);
