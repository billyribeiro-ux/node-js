// Module 47 — Building, Embedding & Extending Node

registerQuiz("47-build-from-source", [
  {
    q: "Which build flag produces a Node binary with zero dynamic library dependencies, making it suitable for a musl-based Alpine scratch container?",
    options: [
      "--shared-openssl",
      "--enable-lto",
      "--fully-static",
      "--with-intl=system-icu",
    ],
    answer: 2,
    explain: "--fully-static links libc, libstdc++, and libgcc into the binary so ldd reports 'not a dynamic executable'. This removes the glibc dependency needed for Alpine/musl containers.",
  },
  {
    q: "What is NODE_MODULE_VERSION (process.versions.modules) and why does it matter for native addons?",
    options: [
      "It is the npm registry version of the node package; mismatches prevent npm install.",
      "It identifies the C++ ABI of Node and V8; a native .node addon compiled against one value cannot load against a different value without recompilation.",
      "It is the semantic version of the Node standard library API surface.",
      "It is only relevant for --experimental-vm-modules and has no effect on native addons.",
    ],
    answer: 1,
    explain: "NODE_MODULE_VERSION encodes the V8/Node C++ ABI version. Pre-built native addons (downloaded by node-pre-gyp/prebuild) are keyed on this value plus platform and arch. A custom Node build with a different ABI will crash trying to load an addon built for the official release.",
  },
  {
    q: "You need a production Node binary with maximum throughput and a smaller file size, and you are willing to spend extra build time. Which flag combination achieves this?",
    options: [
      "--debug --with-intl=full-icu",
      "--enable-lto --with-intl=small-icu",
      "--fully-static --shared-openssl",
      "--openssl-no-asm --with-intl=system-icu",
    ],
    answer: 1,
    explain: "--enable-lto (Link-Time Optimisation) gives 5-15% binary size reduction and a ~2-5% throughput gain by inlining across translation-unit boundaries. --with-intl=small-icu keeps the binary lean. --debug disables optimisations and must not be used for production.",
  },
]);

registerResources("47-build-from-source", [
  { title: "Node.js building from source — official guide", url: "https://github.com/nodejs/node/blob/main/BUILDING.md" },
  { title: "Node.js process.versions API", url: "https://nodejs.org/api/process.html#processversions" },
  { title: "Node.js ABI stability guide", url: "https://nodejs.org/en/docs/guides/abi-stability" },
  { title: "Node.js Node-API (N-API) documentation", url: "https://nodejs.org/api/n-api.html" },
]);

registerQuiz("47-embedder-api", [
  {
    q: "In the Node embedder API, what is the correct sequence of initialisation calls before calling node::LoadEnvironment?",
    options: [
      "node::SpinEventLoop -> node::MultiIsolatePlatform::Create -> node::InitializeOncePerProcess",
      "node::InitializeOncePerProcess -> node::MultiIsolatePlatform::Create -> node::CommonEnvironmentSetup::Create",
      "node::CommonEnvironmentSetup::Create -> v8::V8::Initialize -> node::InitializeOncePerProcess",
      "v8::Isolate::New -> node::InitializeOncePerProcess -> node::MultiIsolatePlatform::Create",
    ],
    answer: 1,
    explain: "The correct order is: InitializeOncePerProcess (parse args, set up OpenSSL) -> MultiIsolatePlatform::Create (V8 background thread pool) -> v8::V8::Initialize -> CommonEnvironmentSetup::Create (per-environment setup) -> LoadEnvironment. Calling them out of order causes crashes or assertion failures.",
  },
  {
    q: "When embedding Node, a v8::Isolate, a v8::Context, and a node::Environment relate to each other how?",
    options: [
      "Isolate owns the JS heap; Context owns the global object and shares the Isolate heap; Environment owns Node's module registry and event loop handles.",
      "Environment owns the heap; Isolate owns the global object; Context holds the libuv loop.",
      "All three are interchangeable names for the same concept — a single JS sandbox.",
      "Context and Environment are the same object; Isolate wraps them both.",
    ],
    answer: 0,
    explain: "The Isolate is V8's heap container (one per thread). A Context is a separate global scope sharing the Isolate heap. An Environment is Node's overlay that adds the module registry, built-in require, and libuv event loop handles on top of a Context.",
  },
  {
    q: "For running untrusted user plugins inside a host application, why is spawning a child process with --experimental-permission preferred over embedding multiple node::Environments in the same process?",
    options: [
      "Child processes are faster because they avoid the V8 JIT warm-up.",
      "Embedding multiple Environments in one process is unsupported by the Node API.",
      "A crash or memory corruption in an embedded Environment can corrupt the host process heap; a child process failure is isolated at the OS boundary and cannot affect the parent.",
      "Child processes automatically apply the same ICU locale data as the parent.",
    ],
    answer: 2,
    explain: "Isolate-level isolation still shares the same OS process. A segfault, OOM, or V8 heap corruption in the embedded Environment can bring down the entire host application. A separate process with the Node permission model provides OS-enforced isolation where a crash is fully contained.",
  },
]);

registerResources("47-embedder-api", [
  { title: "Node.js embedding API example (official)", url: "https://github.com/nodejs/node/blob/main/test/embedding/embedtest.cc" },
  { title: "Node.js Node-API embedder interface docs", url: "https://nodejs.org/api/embedding.html" },
  { title: "Node.js Permission Model documentation", url: "https://nodejs.org/api/permissions.html" },
  { title: "Node.js worker_threads documentation", url: "https://nodejs.org/api/worker_threads.html" },
  { title: "V8 Embedder's Guide", url: "https://v8.dev/docs/embed" },
]);

registerQuiz("47-custom-loaders", [
  {
    q: "In Node 20.6+, what is the canonical API for registering a custom ESM loader, replacing the deprecated --experimental-loader flag?",
    options: [
      "import { addHook } from 'node:module' called at the top of the entry file",
      "module.register(specifier, parentURL, { data, transferList }) called from the main thread or a --import preload file",
      "process.setSourceMapSupport() with a custom loader path",
      "--loader flag in NODE_OPTIONS environment variable",
    ],
    answer: 1,
    explain: "module.register() is the stable API introduced alongside the loader Worker model in Node 20.6. It runs loader hooks in a dedicated off-thread Worker. --experimental-loader is deprecated and runs hooks with different semantics.",
  },
  {
    q: "When chaining three loaders registered with module.register() in order A, B, C, in what order are their resolve hooks called for each import?",
    options: [
      "A.resolve -> B.resolve -> C.resolve -> Node default resolver",
      "C.resolve -> B.resolve -> A.resolve -> Node default resolver",
      "All three hooks run in parallel; the first to return wins.",
      "Node default resolver runs first; then C, B, A in reverse registration order.",
    ],
    answer: 1,
    explain: "Hooks chain in reverse registration order: the last registered loader is the outermost (first called). Each hook receives a nextResolve function that delegates to the next inner hook. So registering A, B, C means C.resolve is outermost and calls next to reach B, which calls next to reach A, which calls next to reach Node's default resolver.",
  },
  {
    q: "A custom load hook prepends an instrumentation import statement to the source string of every module. What is the key risk of this string-prepend approach compared to an AST transform?",
    options: [
      "String prepending is slower at runtime because V8 must re-parse the module.",
      "It breaks modules that start with a 'use strict' directive, causes issues with source maps, and may create circular import dependencies -- problems a proper AST transform (acorn, esbuild) handles correctly.",
      "Modules with default exports cannot have code prepended to them.",
      "The loader Worker thread does not have access to Buffer, so string operations are unavailable.",
    ],
    answer: 1,
    explain: "The 'use strict' directive must be the very first statement in a module; prepending an import before it violates the spec. Additionally, naively injecting imports can create circular dependencies, and inline source maps are corrupted by line offsets introduced by prepended code. An AST transform correctly handles all these cases.",
  },
]);

registerResources("47-custom-loaders", [
  { title: "Node.js module.register() documentation", url: "https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options" },
  { title: "Node.js ESM Loader Hooks documentation", url: "https://nodejs.org/api/esm.html#loaders" },
  { title: "Node.js --import flag (preload modules)", url: "https://nodejs.org/api/cli.html#--importmodule" },
  { title: "esbuild transform API for loader use", url: "https://esbuild.github.io/api/#transform" },
]);
