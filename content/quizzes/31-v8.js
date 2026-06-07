registerQuiz("31-v8-pipeline", [
  {
    q: "Which V8 compiler tier sits BETWEEN Sparkplug and TurboFan in Node 24, performing mid-level data-flow optimisation?",
    options: [
      "Ignition",
      "Crankshaft",
      "Maglev",
      "Lithium"
    ],
    answer: 2,
    explain: "Maglev was introduced in Chrome 117 and is on by default in Node 24. It sits between Sparkplug (fast baseline JIT) and TurboFan (full optimising JIT), performing proper data-flow analysis and removing obvious inefficiencies without spending the time TurboFan does on full inlining and escape analysis."
  },
  {
    q: "What happens when V8 TurboFan's speculative optimisation assumptions are violated at runtime?",
    options: [
      "The process throws an unhandled exception",
      "V8 silently continues with incorrect results to avoid overhead",
      "V8 performs a deoptimisation: it discards the compiled code and falls back to Ignition bytecode",
      "TurboFan recompiles immediately with updated type feedback"
    ],
    answer: 2,
    explain: "When a type or shape assumption breaks (e.g., a string is passed where only integers were seen), V8 deopts: it throws away the optimised machine code, resets the call site to Ignition bytecode, and eventually recompiles once new type feedback stabilises. This is not a crash but does cause a latency spike."
  },
  {
    q: "V8 uses 'lazy parsing' for function bodies. What does this mean?",
    options: [
      "Functions are only compiled to bytecode when the heap is under memory pressure",
      "Function bodies are only fully parsed when the function is first called, not at module load time",
      "V8 delays parsing until the event loop is idle",
      "Lazy parsing means functions are compiled asynchronously in a background thread"
    ],
    answer: 1,
    explain: "V8 pre-parses function bodies at load time (just scanning them without building an AST) to avoid wasted work for functions that are never called. Full AST construction and bytecode compilation happen on the first call. This is why startup is faster than it would be if every function were eagerly compiled."
  }
]);

registerResources("31-v8-pipeline", [
  { title: "V8 blog — Maglev JIT compiler", url: "https://v8.dev/blog/maglev" },
  { title: "V8 blog — TurboFan JIT", url: "https://v8.dev/docs/turbofan" },
  { title: "V8 blog — Ignition interpreter", url: "https://v8.dev/blog/ignition-interpreter" },
  { title: "Node.js internals guide — V8 engine", url: "https://nodejs.org/en/learn/getting-started/the-v8-javascript-engine" },
  { title: "V8 blog — Sparkplug baseline compiler", url: "https://v8.dev/blog/sparkplug" }
]);

registerQuiz("31-hidden-classes", [
  {
    q: "Two objects are created: 'const a = { x: 1, y: 2 }' and 'const b = { y: 2, x: 1 }'. Do they share the same V8 hidden class?",
    options: [
      "Yes, because they have the same set of property keys",
      "Yes, because V8 normalises property order alphabetically",
      "No, because property addition order determines the hidden class and they differ",
      "No, because object literals never share hidden classes"
    ],
    answer: 2,
    explain: "V8 assigns a hidden class based on the ORDER in which properties are added. {x, y} and {y, x} follow different transition paths and end up with different hidden classes even though they contain the same keys. Always add properties in the same order to keep objects shape-compatible."
  },
  {
    q: "What is the performance consequence of a call site becoming 'megamorphic'?",
    options: [
      "The function is deoptimised and falls back to the AST interpreter",
      "V8 switches from a direct-offset load to a slow global hash-table lookup for property access",
      "The call site is permanently removed from the inline cache",
      "TurboFan recompiles the function with aggressive inlining"
    ],
    answer: 1,
    explain: "When an inline cache (IC) sees 5 or more different hidden classes, it becomes megamorphic and V8 falls back to a global hash table for property resolution — the slowest possible path. Unlike polymorphic ICs (2-4 shapes), megamorphic sites do not recover and impose a permanent overhead on every subsequent call."
  },
  {
    q: "Why should you use 'obj.key = null' instead of 'delete obj.key' in performance-critical code?",
    options: [
      "'delete' is a deprecated keyword in strict mode",
      "Using 'delete' transitions the object to slow dictionary mode, removing the hidden-class fast path for all subsequent property accesses on that object",
      "'delete' triggers a full garbage collection cycle",
      "Setting to null is faster because it avoids a property lookup"
    ],
    answer: 1,
    explain: "Using 'delete' on a property that V8 has already assigned a hidden class forces V8 to demote that object to 'dictionary mode' — a slow hash-map representation. All subsequent property reads and writes on that object pay hash-map costs. Setting the property to null or undefined keeps the shape intact."
  }
]);

registerResources("31-hidden-classes", [
  { title: "V8 blog — Fast property access and hidden classes", url: "https://v8.dev/blog/fast-properties" },
  { title: "V8 blog — Elements kinds in V8", url: "https://v8.dev/blog/elements-kinds" },
  { title: "MDN: delete operator", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/delete" },
  { title: "V8 blog — Inline caches", url: "https://mathiasbynens.be/notes/shapes-ics" }
]);

registerQuiz("31-garbage-collection", [
  {
    q: "What is the name of the GC algorithm V8 uses for the young generation (new space)?",
    options: [
      "Mark-Sweep-Compact",
      "Reference counting",
      "Scavenge (Cheney's semi-space algorithm)",
      "Tri-colour marking"
    ],
    answer: 2,
    explain: "V8 uses Scavenge (a semi-space copying collector) for the young generation. It copies live objects from the 'from' semi-space to the 'to' semi-space, then flips them. Because most young objects die quickly, very little data needs to be copied, making Scavenge very fast (typically under 1 ms)."
  },
  {
    q: "Under what condition does V8 promote a young-generation object to old-generation (old space)?",
    options: [
      "When the object's shallow size exceeds 512 bytes",
      "After the object survives two Scavenge cycles",
      "When the object is referenced by more than one other object",
      "When the young-generation heap is completely full"
    ],
    answer: 1,
    explain: "Objects that survive two Scavenge cycles are promoted to old space (old generation). V8 applies the generational hypothesis — most objects die young — so only the minority that live through two collections are assumed to be long-lived and moved to old space where Mark-Sweep-Compact operates."
  },
  {
    q: "What is the PRIMARY benefit of an object pool in a high-throughput Node service?",
    options: [
      "It eliminates the need for TypeScript type annotations on reused objects",
      "It allows objects to escape V8's heap and live in native memory",
      "It reduces allocation pressure by reusing pre-allocated objects instead of creating new ones, reducing GC frequency",
      "It enables SharedArrayBuffer sharing between worker threads without serialisation"
    ],
    answer: 2,
    explain: "An object pool pre-allocates objects and hands them out on acquire, returning them to the pool on release. This dramatically reduces the rate of fresh allocations in hot paths, which in turn reduces how often the young-generation fills up and triggers Scavenge cycles — and eventually Mark-Sweep-Compact in old space."
  }
]);

registerResources("31-garbage-collection", [
  { title: "V8 blog — Trash talk: the Orinoco garbage collector", url: "https://v8.dev/blog/trash-talk" },
  { title: "Node.js — process.memoryUsage()", url: "https://nodejs.org/api/process.html#processmemoryusage" },
  { title: "V8 blog — Memory management", url: "https://v8.dev/blog/free-garbage-collection" },
  { title: "Node.js CLI — --max-old-space-size flag", url: "https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes" },
  { title: "MDN: WeakRef and FinalizationRegistry", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef" }
]);
