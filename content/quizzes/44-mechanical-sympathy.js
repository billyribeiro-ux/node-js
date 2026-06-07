registerQuiz("44-cpu-caches", [
  {
    q: "A 512x512 Float32Array matrix is traversed in column-major order (outer loop over columns, inner loop over rows). Compared to row-major traversal, approximately how many more cache-line fetches does column-major require, and why?",
    options: [
      "The same number — modern CPUs prefetch both directions equally well",
      "2x more — column-major accesses every other cache line",
      "Approximately 512x more — each element access jumps 512 * 4 = 2048 bytes, far exceeding the 64-byte cache line, so every element load fetches a new cache line instead of reusing a cached one",
      "4x more — the CPU's L1 cache can only hold 4 cache lines for Float32 data"
    ],
    answer: 2,
    explain: "In a 512x512 Float32 matrix stored row-major, consecutive row elements are 4 bytes apart. Row-major traversal is sequential: each cache line (64 bytes = 16 Float32 values) covers 16 consecutive elements. Column-major traversal jumps 512 * 4 = 2048 bytes between consecutive row accesses, which is 32 cache lines. Every access fetches a new cache line, producing up to 512 times more cache-line fetches than row-major traversal."
  },
  {
    q: "What is 'false sharing' in the context of multi-core CPU caches, and how is it most effectively fixed for SharedArrayBuffer counters in Node.js worker threads?",
    options: [
      "False sharing is when two variables accidentally have the same value; fix by initialising them to different values",
      "False sharing occurs when two logically independent variables (e.g., per-worker counters) reside in the same 64-byte cache line; every write by one core invalidates the line on other cores, serialising independent operations; fix by padding each counter to its own 64-byte cache line",
      "False sharing is when the same data is copied into multiple worker threads; fix by using SharedArrayBuffer to share a single copy",
      "False sharing is a V8 concept where two closures share the same hidden class; fix by using separate constructors"
    ],
    answer: 1,
    explain: "False sharing happens when two independent variables land in the same 64-byte cache line. When core A writes its variable, the MESI cache coherency protocol invalidates the entire cache line on all other cores, even if they only care about the other variable in that line. The fix is to pad each hot counter to occupy its own 64-byte line — e.g., using a SharedArrayBuffer where each counter's slot starts at a 64-byte-aligned offset."
  },
  {
    q: "Why do TypedArrays (Float64Array, Int32Array) provide a significant throughput advantage over plain JavaScript arrays for hot numeric loops in Node.js/V8?",
    options: [
      "TypedArrays are stored in a special hardware-accelerated memory region that bypasses the L1 cache",
      "TypedArrays use a faster garbage collector that runs 10x less frequently",
      "TypedArrays are backed by a contiguous unboxed ArrayBuffer with no pointer indirection per element; a plain numeric Array may store tagged pointers or transition to a tagged-pointer array under mixed types, adding pointer-chasing and boxing overhead to every element access",
      "TypedArrays allow TurboFan to skip type feedback collection entirely, reducing JIT overhead"
    ],
    answer: 2,
    explain: "A TypedArray is a flat, unboxed buffer where each element is a raw numeric value stored contiguously. V8 can access element i with a single offset calculation and load. A plain Array stores tagged pointers (Smi-tagged integers or pointers to heap-boxed doubles) and can degrade to a fully generic tagged-pointer array, requiring pointer dereferences and boxing/unboxing per element. The TypedArray layout maximises cache-line utilisation and enables TurboFan autovectorisation."
  }
]);

registerResources("44-cpu-caches", [
  { title: "What Every Programmer Should Know About Memory (Ulrich Drepper)", url: "https://people.freebsd.org/~lstewart/articles/cpumemory.pdf" },
  { title: "V8 Blog: Elements Kinds in V8 (TypedArrays vs Arrays)", url: "https://v8.dev/blog/elements-kinds" },
  { title: "V8 Blog: Fast Properties in V8", url: "https://v8.dev/blog/fast-properties" },
  { title: "Martin Thompson: Mechanical Sympathy blog", url: "https://mechanical-sympathy.blogspot.com/" },
  { title: "Node.js: SharedArrayBuffer and Atomics", url: "https://nodejs.org/api/worker_threads.html#shared-memory" }
]);

registerQuiz("44-branch-alloc", [
  {
    q: "A hot loop conditionally sums positive values from a shuffled Int32Array. After sorting the array, the same branch-heavy loop runs noticeably faster. What is the primary CPU-architectural reason?",
    options: [
      "Sorting improves cache locality because the positive values are now contiguous in memory",
      "The branch predictor's pattern history table can learn the single transition from negative to positive in a sorted array; with random data every branch is a coin-flip causing approximately 50% mispredictions, each costing 15-20 pipeline flush cycles",
      "The JIT compiler detects the sorted array and converts the conditional to a vectorised SIMD operation",
      "Sorted arrays are stored in a special V8 'fast-sorted' element kind that bypasses the branch predictor"
    ],
    answer: 1,
    explain: "The CPU's branch predictor uses Pattern History Tables to learn conditional branch outcomes. In a sorted array the predicate transitions from false to true once; the predictor achieves near-perfect accuracy after one misprediction. In a shuffled array the outcome is data-dependent and essentially random, causing approximately 50% mispredictions. Each misprediction flushes a 15-20 cycle pipeline, which at millions of iterations per second is a significant throughput penalty."
  },
  {
    q: "What V8 optimisation status indicates a 'megamorphic' inline cache, and what is the practical performance consequence for a property access hot path?",
    options: [
      "Megamorphic ICs are represented by status bit 16 and cause TurboFan to run an extra compilation pass",
      "A megamorphic IC occurs when 5 or more object shapes are seen at a call site; TurboFan cannot specialise the access and emits a global hash-table stub, turning each property read from a ~1 ns offset load into a ~25-80 ns hash-table lookup",
      "Megamorphic ICs only affect property stores, not reads; reads always use a direct offset",
      "A megamorphic IC triggers a soft deopt that moves the function back to Ignition permanently"
    ],
    answer: 1,
    explain: "When 5 or more distinct object shapes (Maps) are seen at a property access call site, the inline cache transitions to megamorphic state. TurboFan abandons specialisation and emits a call to the generic megamorphic stub, which does a hash-table lookup on every access. This turns what would be a ~1 ns direct in-object offset load into a ~25-80 ns runtime lookup — an immediate throughput hit that shows up as CPU time in the property-access function."
  },
  {
    q: "An object pool pre-allocates a fixed array of objects and recycles them via a free list. What specific V8 performance benefit does this provide over allocating a new object on every call in a hot path?",
    options: [
      "Pooled objects are automatically moved to the large-object space and never garbage collected",
      "Pooled objects are kept in the young generation indefinitely, making GC scans faster",
      "A pool eliminates allocation in the hot path, preventing the young generation from filling and triggering minor GC (scavenge) pauses of 1-5 ms; it also keeps pooled objects monomorphic since they all share the same hidden class",
      "Pools allow V8 to assign objects to specific CPU cores, reducing NUMA memory latency"
    ],
    answer: 2,
    explain: "Every object allocation contributes to filling V8's young generation (typically 8 MB). When it fills, a minor GC (scavenge) pause of 1-5 ms occurs. A hot path allocating objects at high rate can trigger multiple GCs per second. An object pool eliminates hot-path allocation entirely: objects are reused from the free list, the young generation does not fill, and GC pauses are infrequent. Additionally, all pooled objects share the same hidden class, maintaining monomorphic ICs."
  }
]);

registerResources("44-branch-alloc", [
  { title: "Agner Fog: Optimizing Software in C++ (branch prediction chapter)", url: "https://www.agner.org/optimize/optimizing_cpp.pdf" },
  { title: "V8 Blog: Optimising JavaScript for Speed (allocation patterns)", url: "https://v8.dev/blog/optimizing-v8" },
  { title: "Node.js: --trace-gc flag for GC diagnostic output", url: "https://nodejs.org/api/cli.html#--trace-gc" },
  { title: "clinic.js: heap profiling and allocation flamegraphs", url: "https://clinicjs.org/heap/" },
  { title: "V8 Blog: Orinoco: Young Generation Garbage Collection", url: "https://v8.dev/blog/orinoco-parallel-scavenger" }
]);

registerQuiz("44-simd-wasm", [
  {
    q: "WebAssembly SIMD uses a 128-bit lane model. How many float32 values does one f32x4 SIMD instruction operate on simultaneously, and what is the theoretical throughput multiplier over a scalar loop?",
    options: [
      "2 float32 values, 2x throughput",
      "4 float32 values, 4x throughput",
      "8 float32 values, 8x throughput",
      "16 float32 values, 16x throughput"
    ],
    answer: 1,
    explain: "The f32x4 SIMD type packs four 32-bit float values into a 128-bit register. A single f32x4.add instruction adds four float pairs simultaneously. On supporting hardware (x86-64 SSE or ARM64 NEON), this provides up to 4x the arithmetic throughput of a scalar loop. In practice gains are 2-4x depending on memory bandwidth and loop overhead."
  },
  {
    q: "At what approximate minimum batch size does calling a WASM function become worthwhile compared to running the same logic in optimised JavaScript, given that the JS/WASM FFI boundary costs approximately 5-20 ns per crossing?",
    options: [
      "Any batch size above 1 element, since WASM is always faster than JS",
      "Roughly 1,000 elements or more — at this size the per-element FFI overhead is amortised and WASM's vectorised compute advantage exceeds the boundary cost",
      "Exactly 64 elements — one AVX-512 register width",
      "At least 1 million elements — WASM startup JIT cost dominates for smaller batches"
    ],
    answer: 1,
    explain: "The JS/WASM FFI boundary costs approximately 5-20 ns regardless of payload size. For N=100 elements taking ~2 ns each to process in JS, the total JS time is 200 ns vs WASM total of ~10,000 ns (FFI) + 50 ns (compute) = 10,050 ns — WASM loses badly. At N~=1,000 the boundary is amortised. The rule of thumb from the lesson is: call WASM in bulk with at least 1,000-10,000 elements per call, never per-element."
  },
  {
    q: "In a 4-lane unrolled sum loop using four independent accumulators (s0, s1, s2, s3), why does the loop often outperform a single-accumulator scalar loop even in pure JavaScript?",
    options: [
      "The JavaScript engine treats 4-accumulator loops as SIMD hints and emits AVX instructions automatically",
      "Four independent accumulators create four data-independent arithmetic chains that the CPU's out-of-order execution units can schedule in parallel on separate ALU ports, modelling the instruction-level parallelism of a SIMD vector instruction",
      "The 4x unroll reduces loop body iterations, allowing the CPU to cache the entire loop in the instruction cache",
      "V8 recognises the unrolled pattern and replaces the four additions with a single VADDPS instruction"
    ],
    answer: 1,
    explain: "Modern CPUs have multiple arithmetic logic units (ALU ports). When four accumulators are data-independent (s0 does not depend on s1, etc.), the out-of-order CPU can dispatch all four addition operations to different execution ports in the same clock cycle. This is software-visible instruction-level parallelism that approximates what hardware SIMD achieves. A single-accumulator loop creates a serial dependency chain: each iteration must wait for the previous sum to complete."
  }
]);

registerResources("44-simd-wasm", [
  { title: "WebAssembly SIMD Proposal (Phase 4 spec)", url: "https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md" },
  { title: "MDN: WebAssembly.instantiate() and WASM modules in Node", url: "https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiate_static" },
  { title: "Node.js Docs: SharedArrayBuffer and Atomics", url: "https://nodejs.org/api/worker_threads.html#shared-memory" },
  { title: "V8 Blog: WebAssembly SIMD support in V8", url: "https://v8.dev/features/simd" },
  { title: "Agner Fog: Instruction Tables (latency and throughput reference)", url: "https://www.agner.org/optimize/instruction_tables.pdf" }
]);
