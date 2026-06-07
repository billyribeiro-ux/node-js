registerQuiz("41-jit-pipeline-deep", [
  {
    q: "In the V8 tiering pipeline for Node 24, what is the correct order of compiler tiers from first to last?",
    options: [
      "Ignition -> TurboFan -> Sparkplug -> Maglev",
      "Ignition -> Sparkplug -> Maglev -> TurboFan",
      "Sparkplug -> Ignition -> Maglev -> TurboFan",
      "Ignition -> Maglev -> Sparkplug -> TurboFan"
    ],
    answer: 1,
    explain: "V8 progresses Ignition (bytecode interpreter) -> Sparkplug (baseline non-optimising JIT added in V8 9.1) -> Maglev (mid-tier SSA JIT added in V8 11.3) -> TurboFan (Sea-of-Nodes full optimising JIT). Each tier trades compilation latency for higher peak throughput."
  },
  {
    q: "What makes V8 TurboFan's 'Sea of Nodes' IR fundamentally different from a traditional basic-block CFG IR?",
    options: [
      "Sea of Nodes represents operations as bytecodes rather than machine instructions",
      "Operations are represented as free-floating nodes; control edges are added only where strictly necessary, and scheduling into blocks happens at the very end",
      "Sea of Nodes compiles each function into a separate isolate for parallelism",
      "TurboFan uses Sea of Nodes only for async functions; synchronous code uses a CFG"
    ],
    answer: 1,
    explain: "In Sea of Nodes there is no explicit notion of 'block' during optimisation. Value edges express data dependencies; control edges appear only for branches, stores, and calls. Nodes float freely and are scheduled into concrete blocks at the final stage. This enables global value numbering, loop-invariant code motion, and aggressive inlining without explicit CFG manipulation."
  },
  {
    q: "On-Stack Replacement (OSR) in V8 is triggered by what condition, and what does it accomplish?",
    options: [
      "A function's call count crosses the TurboFan threshold; OSR restarts the function from the beginning in the new tier",
      "A hot backward branch in the interpreter crosses a threshold; OSR promotes the loop to a higher tier mid-execution without restarting the stack frame",
      "A garbage collection event; OSR recompiles all live functions to reclaim code-space memory",
      "A deoptimisation event; OSR downgrades the function back to Ignition in place"
    ],
    answer: 1,
    explain: "OSR fires when a loop's backward-branch counter overflows while the function is still in the interpreter. V8 compiles an OSR entry for the loop's exact live state and resumes execution inside the higher-tier compiled code without discarding the existing stack frame or restarting the loop."
  }
]);

registerResources("41-jit-pipeline-deep", [
  { title: "V8 blog: Maglev mid-tier JIT compiler", url: "https://v8.dev/blog/maglev" },
  { title: "V8 blog: TurboFan design and Sea of Nodes", url: "https://v8.dev/docs/turbofan" },
  { title: "V8 blog: Sparkplug baseline JIT compiler", url: "https://v8.dev/blog/sparkplug" },
  { title: "V8 blog: Ignition bytecode interpreter", url: "https://v8.dev/blog/ignition-interpreter" },
  { title: "Cliff Click & Paleczny: Sea of Nodes (1995 paper)", url: "https://grothoff.org/christian/teaching/2007/3655/papers/click95simple.pdf" }
]);

registerQuiz("41-deopt-analysis", [
  {
    q: "Which type of V8 deoptimisation fires immediately at a specific failed guard instruction, pauses execution, and transfers control back to Ignition at that exact bytecode offset?",
    options: [
      "Soft deopt",
      "Lazy deopt",
      "Eager deopt",
      "OSR deopt"
    ],
    answer: 2,
    explain: "An eager deopt fires at the specific instruction where a guard check fails (e.g., CheckMap, CheckSmi). Execution stops immediately and is transferred back to the Ignition interpreter at the failing bytecode offset. This is the most common and most diagnosable deopt kind."
  },
  {
    q: "What does the V8 'wrong map' bailout reason in --trace-deopt output indicate, and what is the canonical fix?",
    options: [
      "The function tried to access a property that does not exist; add the property before calling",
      "TurboFan compiled the function assuming objects at a property-load site had a specific hidden class (Map), but a different-shaped object was passed; fix by normalising all callers to produce the same object shape",
      "The function uses a Map data structure that grew too large; switch to a plain object",
      "The source map for the function is missing; regenerate the build"
    ],
    answer: 1,
    explain: "'wrong map' means TurboFan specialised a property load for a specific hidden class (V8 Map) and a CheckMap guard failed because an object with a different shape was passed. The fix is shape normalisation: ensure all callers produce objects with the same properties in the same order so all objects share the same hidden class."
  },
  {
    q: "Which %GetOptimizationStatus bit mask value confirms that a function is currently compiled by TurboFan?",
    options: [
      "Bit 4 (value 16)",
      "Bit 5 (value 32)",
      "Bit 6 (value 64)",
      "Bit 7 (value 128)"
    ],
    answer: 1,
    explain: "In V8's optimization status bitmask (readable with --allow-natives-syntax), bit 5 (decimal 32) indicates the function is TurboFan-optimised. Bit 6 (64) indicates Maglev, bit 7 (128) indicates Sparkplug, and bit 4 (16) indicates the function may be deoptimised."
  }
]);

registerResources("41-deopt-analysis", [
  { title: "V8 blog: Deoptimisation in V8", url: "https://v8.dev/blog/turbofan-jit" },
  { title: "V8 blog: Optimising V8 for speed", url: "https://v8.dev/blog/optimizing-v8" },
  { title: "Node.js: diagnostics and flame graphs", url: "https://nodejs.org/en/learn/diagnostics/flame-graphs" },
  { title: "V8 runtime test natives syntax (source reference)", url: "https://github.com/v8/v8/blob/main/src/runtime/runtime-test.cc" }
]);

registerQuiz("41-inline-caches-deep", [
  {
    q: "In V8's hidden class (Map) transition tree, why do the objects '{ x: 1, y: 2 }' and '{ y: 2, x: 1 }' end up at different leaf Maps even though they have the same keys and values?",
    options: [
      "V8 uses alphabetical property ordering to create Maps, so y before x always makes a different Map than x before y",
      "Each unique combination of property values creates a new Map",
      "Property addition order determines which transition edges are followed in the tree; different insertion orders create different transition paths and land at different leaf Maps",
      "Object literals always create unique Maps regardless of property order"
    ],
    answer: 2,
    explain: "Maps form a transition tree rooted at the empty Map. Each edge is labeled with the property name and representation added at that step. Adding 'x' then 'y' follows a different path than adding 'y' then 'x', so the two objects end up at different leaf Maps. A call site that receives both will immediately go polymorphic."
  },
  {
    q: "What is the maximum number of distinct object shapes (Maps) an inline cache can track before transitioning to megamorphic state, at which point TurboFan gives up on specialisation?",
    options: [
      "1 (any second shape triggers megamorphic)",
      "4 (2-4 shapes produce a polymorphic IC with an inline dispatch table; 5+ is megamorphic)",
      "10 (V8 maintains up to 10 inline-dispatch slots)",
      "There is no limit; V8 tracks all shapes indefinitely"
    ],
    answer: 1,
    explain: "V8 tracks 1 Map (monomorphic), then 2-4 Maps (polymorphic, with a small inline dispatch table), and at 5 or more Maps the IC becomes megamorphic and uses a global stub that performs a hash-table lookup. TurboFan cannot inline or specialise megamorphic ICs, so each property access costs ~25-80 ns instead of ~1 ns."
  },
  {
    q: "Using 'delete obj.y' on an object that previously had fast properties can cause what specific V8 performance degradation?",
    options: [
      "The object is moved to the old generation heap immediately",
      "The object's hidden class is revoked and it switches to dictionary mode (slow properties backed by a NameDictionary hash table), making every property access a hash-table lookup",
      "V8 marks the object as immutable and subsequent stores throw a TypeError in strict mode",
      "The object's inline cache entry is cleared, requiring one cold miss on the next access"
    ],
    answer: 1,
    explain: "'delete' on a property that is not the last one added breaks the Map transition tree invariant and forces V8 to switch the object to dictionary mode. In dictionary mode properties are stored in a hash table (NameDictionary) instead of at fixed field offsets, making each access 10-50x slower than a direct in-object load."
  }
]);

registerResources("41-inline-caches-deep", [
  { title: "V8 blog: What's in that .prototype?", url: "https://v8.dev/blog/prototype" },
  { title: "V8 blog: Fast properties in V8", url: "https://v8.dev/blog/fast-properties" },
  { title: "V8 blog: Elements kinds in V8", url: "https://v8.dev/blog/elements-kinds" },
  { title: "Benedikt Meurer: V8 hidden classes and inline caches", url: "https://benediktmeurer.de/2018/03/23/impact-of-polymorphism-on-component-based-frameworks-like-react/" },
  { title: "V8 blog: Optimising ES2015 proxies in V8", url: "https://v8.dev/blog/es2015-proxy" }
]);

registerQuiz("41-snapshots", [
  {
    q: "When Node.js restores from a V8 startup snapshot at process launch, what is the dominant mechanism that makes restoration so fast (typically under 1 ms)?",
    options: [
      "V8 replays the bytecode of the bootstrap scripts at 10x speed using a cached AST",
      "The snapshot blob is mmap'd into memory and a single linear pointer-fixup pass adjusts embedded addresses; no code is re-executed",
      "V8 uses a background thread to deserialise the snapshot while main-thread JS starts running immediately",
      "The snapshot stores only function signatures; function bodies are lazily compiled on first call"
    ],
    answer: 1,
    explain: "Snapshot restoration is essentially: mmap the snapshot blob, allocate V8 heap spaces, and perform a single linear scan that adjusts all embedded pointers from snapshot-relative to runtime-virtual addresses. No code is re-parsed or re-executed. This is why even a multi-megabyte snapshot restores in under 5 ms."
  },
  {
    q: "Which types of data CANNOT be serialised into a V8 startup snapshot and must instead be re-created via a deserialise callback?",
    options: [
      "String literals, ArrayBuffer contents, and object shapes (Maps)",
      "File descriptors, sockets, libuv handles, and closures over native values",
      "Compiled bytecode (Ignition) and function prototypes",
      "Class hierarchies and pre-initialised JS objects"
    ],
    answer: 1,
    explain: "File descriptors, sockets, libuv handles, native C++ references, and closures over native values are platform-specific runtime resources that cannot be meaningfully serialised. The snapshot stores Ignition bytecode, heap objects, Maps, strings, and ArrayBuffer contents. Resources like TCP sockets must be re-created in a v8.startupSnapshot.addDeserializeCallback."
  },
  {
    q: "When using 'vm.Script' with 'cachedData' for in-process code caching, under what circumstances will V8 automatically reject the cached bytecode?",
    options: [
      "When the script has run more than 1000 times in the same process",
      "When the source code changes OR when the Node.js binary version changes (V8 bytecode format is version-specific)",
      "When the script is loaded in a different vm.Context than the one that produced the cache",
      "When the heap usage exceeds 80% of the max-old-space-size limit"
    ],
    answer: 1,
    explain: "V8 includes both a source hash and a bytecode-format version tag in the cached data. If the source text changes the hash mismatch triggers rejection; if the Node binary is upgraded the bytecode format version changes and the cache is also rejected. Always store the Node version alongside the cache key and invalidate on mismatch."
  }
]);

registerResources("41-snapshots", [
  { title: "Node.js docs: v8.startupSnapshot API", url: "https://nodejs.org/api/v8.html#startup-snapshot-api" },
  { title: "Node.js docs: vm.Script cachedData", url: "https://nodejs.org/api/vm.html#new-vmscriptcode-options" },
  { title: "Node.js docs: Single Executable Applications", url: "https://nodejs.org/api/single-executable-applications.html" },
  { title: "V8 blog: Custom startup snapshots", url: "https://v8.dev/blog/custom-startup-snapshots" },
  { title: "Node.js: --build-snapshot and --snapshot-blob flags", url: "https://nodejs.org/api/cli.html#--build-snapshot" }
]);
