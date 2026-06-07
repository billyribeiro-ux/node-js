/* =========================================================================
   manifest.js — the single source of truth for the whole course: every tier,
   module, and lesson, in order. The app derives navigation, the sidebar, the
   landing grid and progress entirely from this. Authored lessons have
   status:"complete" + a file; the rest are status:"stub" and render from the
   metadata here until their full content is written.

   Loaded as a classic script (no modules) so it works under file://.
   ========================================================================= */
window.COURSE = {
  title: "The Ultimate Node.js Course",
  version: "2026.06.06",
  modules: [

    /* ================= TIER 0 — ORIENTATION ================= */
    {
      id: "00-welcome", code: "M0", tier: "Tier 0", tierLabel: "Orientation",
      shortTitle: "Welcome & Setup",
      title: "Module 0 — Welcome & Setup",
      summary: "How the course works, installing Node the professional way, and running your very first program three different ways.",
      lessons: [
        { id: "00-how-this-course-works", title: "How This Course Works", file: "content/lessons/00-welcome/00-how-this-course-works.js", minutes: 10, level: "beginner", status: "complete" },
        { id: "00-installing-node", title: "Installing Node the Pro Way (nvm / fnm / Volta)", file: "content/lessons/00-welcome/01-installing-node.js", minutes: 16, level: "beginner", status: "complete" },
        { id: "00-your-first-program", title: "Your First Program: REPL, Files & --eval", file: "content/lessons/00-welcome/02-your-first-program.js", minutes: 18, level: "beginner", status: "complete",
          project: "Build a tiny 'system greeter' script that prints a personalised, colourised banner with your OS, Node version and the time — run it three ways." }
      ]
    },

    /* ================= TIER 1 — FOUNDATIONS ================= */
    {
      id: "01-js-refresher", code: "M1", tier: "Tier 1", tierLabel: "Foundations",
      shortTitle: "JavaScript Refresher",
      title: "Module 1 — JavaScript Refresher for Node",
      summary: "The exact JavaScript you must own before Node makes sense: values, functions, closures, objects, and modern ESNext.",
      lessons: [
        { id: "01-values-and-types", title: "Values, Types & Coercion", file: "content/lessons/01-js-refresher/00-values-and-types.js", minutes: 22, level: "beginner", status: "complete" },
        { id: "01-functions-and-closures", title: "Functions, Scope & Closures", file: "content/lessons/01-js-refresher/01-functions-and-closures.js", minutes: 26, level: "beginner", status: "complete" },
        { id: "01-objects-and-arrays", title: "Objects, Arrays, Destructuring & Spread", file: "content/lessons/01-js-refresher/02-objects-and-arrays.js", minutes: 24, level: "beginner", status: "complete" },
        { id: "01-modern-javascript", title: "Modern JavaScript You'll Use Every Day", file: "content/lessons/01-js-refresher/03-modern-javascript.js", minutes: 22, level: "beginner", status: "complete",
          project: "Build a pure-JS data-transformation pipeline (map/filter/reduce/group) over a dataset — no I/O, just clean JavaScript." }
      ]
    },
    {
      id: "02-async", code: "M2", tier: "Tier 1", tierLabel: "Foundations",
      shortTitle: "Async JavaScript Mastery",
      title: "Module 2 — Asynchronous JavaScript Mastery",
      summary: "The single most important skill in Node: callbacks, promises, async/await, and controlling concurrency with confidence.",
      lessons: [
        { id: "02-call-stack-and-callbacks", title: "The Call Stack & Callbacks", file: "content/lessons/02-async/00-call-stack-and-callbacks.js", minutes: 24, level: "beginner", status: "complete" },
        { id: "02-promises", title: "Promises, Properly", file: "content/lessons/02-async/01-promises.js", minutes: 28, level: "beginner", status: "complete" },
        { id: "02-async-await", title: "async / await & Error Handling", file: "content/lessons/02-async/02-async-await.js", minutes: 26, level: "intermediate", status: "complete" },
        { id: "02-concurrency", title: "Concurrency: all / allSettled / race & Limits", file: "content/lessons/02-async/03-concurrency.js", minutes: 28, level: "intermediate", status: "complete",
          project: "Build a concurrency-limited async task scheduler (your own `p-limit`) with cancellation via AbortController." }
      ]
    },
    {
      id: "03-node-runtime", code: "M3", tier: "Tier 1", tierLabel: "Foundations",
      shortTitle: "The Node Runtime",
      title: "Module 3 — Meet Node.js: Runtime & Architecture",
      summary: "What Node actually is (V8 + libuv + bindings), the single-threaded model, globals, and the process object.",
      lessons: [
        { id: "03-what-is-node", title: "What Is Node.js, Really?", file: "content/lessons/03-node-runtime/00-what-is-node.js", minutes: 22, level: "beginner", status: "complete" },
        { id: "03-globals-and-process", title: "Globals, globalThis & the process Object", file: "content/lessons/03-node-runtime/01-globals-and-process.js", minutes: 24, level: "beginner", status: "complete" },
        { id: "03-running-node", title: "Running Node: Scripts, Flags, REPL & --watch", file: "content/lessons/03-node-runtime/02-running-node.js", minutes: 20, level: "beginner", status: "complete",
          project: "Build a cross-platform 'system info' report tool using os and process that prints a formatted dashboard to the terminal." }
      ]
    },
    {
      id: "04-event-loop", code: "M4", tier: "Tier 1", tierLabel: "Foundations",
      shortTitle: "The Event Loop & libuv",
      title: "Module 4 — The Event Loop & libuv (Internals)",
      summary: "The mental model that separates juniors from seniors: event-loop phases, microtasks vs macrotasks, and never blocking.",
      lessons: [
        { id: "04-event-loop-phases", title: "Event Loop Phases, Step by Step", file: "content/lessons/04-event-loop/00-event-loop-phases.js", minutes: 30, level: "intermediate", status: "complete" },
        { id: "04-timers-and-microtasks", title: "Timers, setImmediate, nextTick & Microtasks", file: "content/lessons/04-event-loop/01-timers-and-microtasks.js", minutes: 28, level: "intermediate", status: "complete" },
        { id: "04-non-blocking-io", title: "The Thread Pool & Never Blocking the Loop", file: "content/lessons/04-event-loop/02-non-blocking-io.js", minutes: 26, level: "intermediate", status: "complete",
          project: "Build an event-loop ordering visualiser plus an event-loop-lag monitor using perf_hooks.monitorEventLoopDelay." }
      ]
    },

    /* ================= TIER 2 — CORE NODE APIs ================= */
    mod("05-modules", "M5", "Tier 2", "Core Node APIs", "Modules: ESM, CJS & node:",
      "Module 5 — Modules: ESM, CommonJS & the node: Protocol",
      "The whole module system: require vs import, package.json exports, dual packages, and the node: builtin protocol.",
      [
        L("05-cjs-vs-esm", "CommonJS vs ES Modules", "intermediate"),
        L("05-package-json", "package.json, exports & imports Maps", "intermediate"),
        L("05-dual-packages", "Dual Packages, import.meta & Resolution", "advanced"),
        L("05-loaders", "Module Loaders & module.register", "advanced")
      ],
      "Publish a production-ready dual-format (ESM + CJS) utility package with a correct exports map and type declarations."),

    mod("06-npm", "M6", "Tier 2", "Core Node APIs", "npm / pnpm / yarn",
      "Module 6 — npm and the Package Ecosystem",
      "Dependency management done right: semver, lockfiles, scripts, workspaces, and how npm, pnpm and yarn differ.",
      [
        L("06-package-management", "package.json & Semantic Versioning", "beginner"),
        L("06-lockfiles-and-installs", "Lockfiles, Installs & Reproducibility", "intermediate"),
        L("06-npm-pnpm-yarn", "npm vs pnpm vs yarn (and Corepack)", "intermediate"),
        L("06-publishing", "Publishing, Provenance & Supply-Chain Safety", "advanced")
      ],
      "Build and publish a small CLI package to a local Verdaccio registry, then convert it into a pnpm workspace."),

    mod("07-fs", "M7", "Tier 2", "Core Node APIs", "Files & the Filesystem",
      "Module 7 — Files & the Filesystem (fs, path, os)",
      "Reading, writing, watching and walking the filesystem the cross-platform way with fs, path and os.",
      [
        L("07-reading-writing", "Reading & Writing Files (sync, callback, promises)", "beginner"),
        L("07-paths-and-dirs", "Paths, Directories & fs.glob", "beginner"),
        L("07-watching", "Watching Files & --watch", "intermediate"),
        L("07-streaming-files", "Working With Large Files Safely", "intermediate")
      ],
      "Build a recursive directory tree + disk-usage analyzer CLI (a `du`-like tool) with a live watch mode."),

    mod("08-buffers", "M8", "Tier 2", "Core Node APIs", "Buffers & Binary Data",
      "Module 8 — Buffers, Binary Data & Encodings",
      "How Node handles raw bytes: Buffer vs TypedArray, encodings, and parsing real binary formats.",
      [
        L("08-buffers-basics", "Buffers, TypedArrays & ArrayBuffers", "intermediate"),
        L("08-encodings", "Encodings: utf8, hex, base64 & TextEncoder", "intermediate"),
        L("08-binary-parsing", "Parsing Binary File Formats", "advanced")
      ],
      "Build a binary file-format parser (PNG/WAV header reader) and a hex-dump tool."),

    mod("09-events", "M9", "Tier 2", "Core Node APIs", "Events & EventEmitter",
      "Module 9 — Events & the EventEmitter Pattern",
      "Node's beating heart: EventEmitter, EventTarget, error events, and async iteration over events.",
      [
        L("09-eventemitter", "EventEmitter: on, once, emit & error events", "intermediate"),
        L("09-eventtarget", "EventTarget & Web-Compatible Events", "intermediate"),
        L("09-events-async", "events.once / events.on as Async Iterators", "advanced")
      ],
      "Build an event-driven finite state machine library with typed events and listener leak detection."),

    mod("10-streams", "M10", "Tier 2", "Core Node APIs", "Streams & Backpressure",
      "Module 10 — Streams & Backpressure (Deep Dive)",
      "The superpower behind Node's scalability: Readable/Writable/Transform streams, backpressure, and Web Streams.",
      [
        L("10-stream-types", "The Four Stream Types", "advanced"),
        L("10-pipeline-backpressure", "pipe vs pipeline & Backpressure Mechanics", "advanced"),
        L("10-transform-streams", "Building Transform Streams", "advanced"),
        L("10-web-streams", "Web Streams & Interop", "advanced")
      ],
      "Build a streaming CSV→JSON transformer that processes a multi-GB file in constant memory, plus a gzip pipeline."),

    mod("11-process", "M11", "Tier 2", "Core Node APIs", "process & Lifecycle",
      "Module 11 — process, Environment & Lifecycle",
      "Owning the process: argv, env, native .env support, signals, graceful shutdown, and crash handling.",
      [
        L("11-argv-env", "argv, env & Native --env-file Support", "intermediate"),
        L("11-signals-shutdown", "Signals & Graceful Shutdown", "advanced"),
        L("11-crash-handling", "uncaughtException, unhandledRejection & Exit Codes", "advanced")
      ],
      "Build a long-running daemon with graceful shutdown, signal handling and a clean health/exit-code contract."),

    /* ================= TIER 3 — BUILDING REAL THINGS ================= */
    mod("12-clis", "M12", "Tier 3", "Building Real Things", "Command-Line Tools",
      "Module 12 — Building Command-Line Tools (CLIs)",
      "Ship real CLIs: util.parseArgs, colours with util.styleText, interactive prompts, and Single Executable Apps.",
      [
        L("12-parseargs", "Parsing Arguments with util.parseArgs", "intermediate"),
        L("12-interactive-clis", "Colours, Prompts, Spinners & Config", "intermediate"),
        L("12-sea", "Single Executable Applications (SEA)", "advanced")
      ],
      "Build a full-featured project-scaffolder CLI and ship it as a single self-contained executable binary."),

    mod("13-networking", "M13", "Tier 3", "Building Real Things", "Networking From Scratch",
      "Module 13 — Networking From Scratch (net, dgram, dns)",
      "Below HTTP: TCP with net, UDP with dgram, DNS, message framing, and building your own line protocol.",
      [
        L("13-tcp", "TCP Servers & Clients with net", "advanced"),
        L("13-udp-dns", "UDP with dgram & DNS Resolution", "advanced"),
        L("13-framing", "Message Framing & Protocols", "advanced")
      ],
      "Build a TCP chat server + client and a tiny Redis-protocol (RESP) echo server."),

    mod("14-http", "M14", "Tier 3", "Building Real Things", "HTTP In Depth",
      "Module 14 — HTTP In Depth (http, https, http2, fetch)",
      "The raw http module, the request/response lifecycle, native fetch/undici, TLS, and HTTP/2.",
      [
        L("14-http-server", "The Raw http Module: Server & Client", "intermediate"),
        L("14-fetch-undici", "Native fetch & undici", "intermediate"),
        L("14-https-http2", "HTTPS, TLS & HTTP/2", "advanced"),
        L("14-tiny-framework", "Build a Tiny Web Framework", "advanced")
      ],
      "Build a minimal web framework from scratch — routing, middleware, body parsing — your own 'tiny Express'."),

    mod("15-frameworks", "M15", "Tier 3", "Building Real Things", "Express / Fastify / Hono",
      "Module 15 — Web Frameworks: Express, Fastify & Hono",
      "The three frameworks that matter in 2026, when to choose each, and schema-validated routing.",
      [
        L("15-express", "Express: Routing, Middleware & Errors", "intermediate"),
        L("15-fastify", "Fastify: Schemas, Hooks & Performance", "advanced"),
        L("15-hono", "Hono: Edge-First & Web-Standard", "advanced")
      ],
      "Build the same REST API in Express, Fastify and Hono, then benchmark all three with autocannon."),

    mod("16-rest", "M16", "Tier 3", "Building Real Things", "REST API Design",
      "Module 16 — REST APIs & API Design",
      "Designing APIs people love: resources, status codes, pagination, idempotency, versioning and OpenAPI.",
      [
        L("16-resource-design", "Resource Modeling & Status Codes", "intermediate"),
        L("16-pagination-filtering", "Pagination, Filtering & Versioning", "advanced"),
        L("16-validation-openapi", "Validation (Zod) & OpenAPI Docs", "advanced")
      ],
      "Build a production-style notes/tasks REST API with Zod validation, pagination and generated OpenAPI docs."),

    mod("17-sql", "M17", "Tier 3", "Building Real Things", "SQL & Postgres",
      "Module 17 — Databases: SQL & Postgres",
      "Relational data done right: Postgres with pg, pooling, transactions, migrations, and built-in node:sqlite.",
      [
        L("17-sql-basics", "SQL & Relational Modeling", "intermediate"),
        L("17-postgres-pg", "Postgres with pg: Pooling & Transactions", "advanced"),
        L("17-migrations", "Migrations & Indexing", "advanced"),
        L("17-node-sqlite", "The Built-in node:sqlite Module", "intermediate")
      ],
      "Build a transactional data-access layer over Postgres with connection pooling and a migration runner."),

    mod("18-orms", "M18", "Tier 3", "Building Real Things", "Prisma & Drizzle",
      "Module 18 — ORMs & Query Builders: Prisma & Drizzle",
      "Type-safe data access: Prisma vs Drizzle vs raw SQL, and how to avoid the N+1 trap.",
      [
        L("18-prisma", "Prisma: Schema, Client & Migrations", "intermediate"),
        L("18-drizzle", "Drizzle: SQL-First & Type-Safe", "advanced"),
        L("18-orm-tradeoffs", "ORM vs Raw SQL & Performance", "advanced")
      ],
      "Re-implement Module 17's data layer with Prisma, then Drizzle, and compare developer experience and generated SQL."),

    mod("19-nosql", "M19", "Tier 3", "Building Real Things", "MongoDB & Redis",
      "Module 19 — NoSQL & Caching: MongoDB & Redis",
      "Documents and caches: MongoDB aggregation, Redis caching, pub/sub, rate limiting and distributed locks.",
      [
        L("19-mongodb", "MongoDB: Documents & Aggregation", "intermediate"),
        L("19-redis-caching", "Redis: Caching & Expiry Strategies", "advanced"),
        L("19-redis-patterns", "Pub/Sub, Rate Limits & Distributed Locks", "advanced")
      ],
      "Add a Redis cache + pub/sub layer and a MongoDB-backed analytics store to your API."),

    mod("20-auth", "M20", "Tier 3", "Building Real Things", "Auth & Security",
      "Module 20 — Authentication, Authorization & Security",
      "Keeping users safe: password hashing, JWT vs sessions, OAuth2/OIDC, RBAC, crypto and the Permission Model.",
      [
        L("20-password-hashing", "Password Hashing with scrypt & argon2", "advanced"),
        L("20-sessions-jwt", "Sessions vs JWT & Secure Cookies", "advanced"),
        L("20-oauth-rbac", "OAuth2/OIDC & Role-Based Access Control", "advanced"),
        L("20-permission-model", "The Node Permission Model (--permission)", "principal")
      ],
      "Build a complete auth system (signup/login/refresh, RBAC, secure cookies) hardened with the permission model."),

    /* ================= TIER 4 — ENGINEERING QUALITY ================= */
    mod("21-typescript", "M21", "Tier 4", "Engineering Quality", "TypeScript with Node",
      "Module 21 — TypeScript with Node",
      "Production TypeScript: tsconfig for Node, native type-stripping, tsx, typed core modules and shipping .d.ts.",
      [
        L("21-ts-fundamentals", "TypeScript Fundamentals for Node", "intermediate"),
        L("21-tsconfig-esm", "tsconfig, ESM & Project Setup", "advanced"),
        L("21-running-ts", "Running TS Directly: type-stripping & tsx", "advanced"),
        L("21-typed-libraries", "Building Typed Libraries (.d.ts)", "advanced")
      ],
      "Convert your REST API to fully-typed strict TypeScript and emit clean declaration files for consumers."),

    mod("22-testing", "M22", "Tier 4", "Engineering Quality", "Testing",
      "Module 22 — Testing: node:test, Vitest & Jest",
      "Confidence through tests: the built-in test runner, Vitest, mocking, coverage, and integration/e2e testing.",
      [
        L("22-node-test", "The Built-in node:test Runner", "intermediate"),
        L("22-mocking-coverage", "Mocking, Coverage & Snapshots", "advanced"),
        L("22-vitest-jest", "Vitest & Jest Compared", "advanced"),
        L("22-integration-e2e", "Integration & End-to-End Testing", "advanced")
      ],
      "Achieve high-coverage suites for your API with node:test and Vitest side by side, including supertest e2e."),

    mod("23-toolchain", "M23", "Tier 4", "Engineering Quality", "The Modern Toolchain",
      "Module 23 — The Modern Toolchain (2026)",
      "The tools pros reach for: tsx, esbuild, Vite, Biome vs ESLint+Prettier, bundling and source maps.",
      [
        L("23-tsx-esbuild", "tsx & esbuild: Fast Dev & Bundling", "advanced"),
        L("23-biome-lint", "Biome vs ESLint + Prettier", "advanced"),
        L("23-bundling", "Bundling Node Apps & Source Maps", "advanced")
      ],
      "Set up a polished repo: Biome formatting/linting, esbuild bundling and a tsx dev loop with CI-ready scripts."),

    mod("24-monorepos", "M24", "Tier 4", "Engineering Quality", "Monorepos & Workspaces",
      "Module 24 — Monorepos & Workspaces",
      "Scaling a codebase: workspaces, Turborepo caching, internal packages and Changesets versioning.",
      [
        L("24-workspaces", "Workspaces & Internal Packages", "advanced"),
        L("24-turborepo", "Turborepo: Caching & Affected Graphs", "advanced"),
        L("24-changesets", "Versioning & Releases with Changesets", "advanced")
      ],
      "Convert the project into a Turborepo monorepo with api, worker, shared-types and cli packages."),

    /* ================= TIER 5 — ADVANCED & PRINCIPAL ================= */
    mod("25-concurrency", "M25", "Tier 5", "Advanced & Principal Engineering", "Threads & Processes",
      "Module 25 — Concurrency & Parallelism",
      "Using every core: child_process, cluster, worker_threads, SharedArrayBuffer, Atomics and worker pools.",
      [
        L("25-child-process", "child_process: spawn, exec, fork & IPC", "advanced"),
        L("25-cluster", "cluster & the SO_REUSEPORT Model", "advanced"),
        L("25-worker-threads", "worker_threads, SharedArrayBuffer & Atomics", "principal"),
        L("25-worker-pools", "Building a Worker Pool", "principal")
      ],
      "Build a parallel data/image-processing pipeline on a worker-thread pool and benchmark it against single-threaded."),

    mod("26-realtime", "M26", "Tier 5", "Advanced & Principal Engineering", "Real-Time & WebSockets",
      "Module 26 — Real-Time & WebSockets",
      "Live apps: the WebSocket protocol, ws, Socket.IO, rooms, presence, SSE, and scaling with Redis.",
      [
        L("26-websockets", "The WebSocket Protocol & ws", "advanced"),
        L("26-socketio", "Socket.IO: Rooms, Namespaces & Presence", "advanced"),
        L("26-scaling-realtime", "Scaling Real-Time with a Redis Adapter", "principal")
      ],
      "Build a multi-room real-time chat with presence and typing indicators that scales horizontally across instances."),

    mod("27-queues", "M27", "Tier 5", "Advanced & Principal Engineering", "Queues & Background Jobs",
      "Module 27 — Message Queues & Background Jobs",
      "Doing work later: BullMQ, retries, backoff, DLQs, scheduling, and brokers (RabbitMQ, Kafka, NATS).",
      [
        L("27-bullmq", "Job Queues with BullMQ & Redis", "advanced"),
        L("27-retries-dlq", "Retries, Backoff & Dead-Letter Queues", "principal"),
        L("27-brokers", "Brokers: RabbitMQ, Kafka & NATS", "principal")
      ],
      "Build a distributed job-processing system (email/render queue) with retries, priorities and a live dashboard."),

    mod("28-grpc-graphql", "M28", "Tier 5", "Advanced & Principal Engineering", "gRPC & GraphQL",
      "Module 28 — gRPC & GraphQL",
      "Beyond REST: gRPC with protobufs and streaming, GraphQL schemas/resolvers/DataLoader, and the tradeoffs.",
      [
        L("28-grpc", "gRPC: Protobuf, Unary & Streaming", "principal"),
        L("28-graphql", "GraphQL: Schema, Resolvers & DataLoader", "advanced"),
        L("28-api-tradeoffs", "REST vs gRPC vs GraphQL", "principal")
      ],
      "Expose your domain over both gRPC and GraphQL, with a GraphQL subscription backed by Redis pub/sub."),

    mod("29-microservices", "M29", "Tier 5", "Advanced & Principal Engineering", "Microservices & Distributed Systems",
      "Module 29 — Microservices & Distributed Systems Patterns",
      "Designing systems: service boundaries, gateways, resilience (timeouts, retries, circuit breakers), and sagas.",
      [
        L("29-boundaries", "Service Boundaries & Communication", "principal"),
        L("29-resilience", "Resilience: Timeouts, Retries & Circuit Breakers", "principal"),
        L("29-sagas", "Sagas & Distributed Transactions", "principal")
      ],
      "Decompose your monolith into 3–4 services communicating via queue + gRPC behind an API gateway."),

    mod("30-performance", "M30", "Tier 5", "Advanced & Principal Engineering", "Performance & Profiling",
      "Module 30 — Performance Profiling & Optimization",
      "Making Node fast: CPU profiling, flamegraphs, perf_hooks, diagnostics_channel and disciplined benchmarking.",
      [
        L("30-cpu-profiling", "CPU Profiling & Flamegraphs (clinic, 0x)", "principal"),
        L("30-benchmarking", "Benchmarking with tinybench & mitata", "advanced"),
        L("30-tracing", "Tracing with diagnostics_channel & async_hooks", "principal")
      ],
      "Profile and optimise a deliberately slow service, producing a before/after flamegraph and a written analysis."),

    mod("31-v8", "M31", "Tier 5", "Advanced & Principal Engineering", "V8 Internals & Memory",
      "Module 31 — V8 Internals & Memory Management",
      "Inside the engine: Ignition/TurboFan/Maglev, hidden classes, inline caches, and GC-friendly code.",
      [
        L("31-v8-pipeline", "The V8 Compilation Pipeline", "principal"),
        L("31-hidden-classes", "Hidden Classes & Inline Caches", "principal"),
        L("31-garbage-collection", "Garbage Collection & GC-Friendly Code", "principal")
      ],
      "Run micro-benchmark experiments that demonstrate hidden-class deopts and inline-cache effects, then explain them."),

    mod("32-memory-leaks", "M32", "Tier 5", "Advanced & Principal Engineering", "Debugging Memory Leaks",
      "Module 32 — Debugging Memory Leaks",
      "Finding the leak: heap snapshots, retained vs shallow size, common leak sources, and production triage.",
      [
        L("32-heap-snapshots", "Heap Snapshots & Comparison", "principal"),
        L("32-leak-sources", "Common Leak Sources & Fixes", "principal"),
        L("32-production-triage", "Production Leak Triage Methodology", "principal")
      ],
      "Diagnose and fix a seeded memory leak in a running service using heap-snapshot diffs."),

    mod("33-native", "M33", "Tier 5", "Advanced & Principal Engineering", "Native Addons & WASM",
      "Module 33 — Native Addons (N-API) & WebAssembly",
      "Going native: Node-API addons, WASM and WASI in Node, and when to choose them over worker threads.",
      [
        L("33-napi", "Node-API (N-API) & node-addon-api", "principal"),
        L("33-wasm", "WebAssembly & WASI in Node", "principal"),
        L("33-native-tradeoffs", "Native vs Worker Threads vs WASM", "principal")
      ],
      "Build a small N-API addon (or WASM module) for a hot numeric routine and benchmark it against pure JS."),

    mod("34-observability", "M34", "Tier 5", "Advanced & Principal Engineering", "Observability",
      "Module 34 — Observability: Logging, Metrics & Tracing",
      "Seeing in production: structured logging with Pino, Prometheus metrics, and OpenTelemetry tracing.",
      [
        L("34-structured-logging", "Structured Logging with Pino & Correlation IDs", "advanced"),
        L("34-metrics", "Metrics with Prometheus", "advanced"),
        L("34-opentelemetry", "Distributed Tracing with OpenTelemetry", "principal")
      ],
      "Instrument the microservice system end-to-end with OpenTelemetry traces and Prometheus metrics."),

    mod("35-docker", "M35", "Tier 5", "Advanced & Principal Engineering", "Containerization & Docker",
      "Module 35 — Containerization & Docker",
      "Shipping containers: multi-stage Dockerfiles, distroless, non-root, image caching and compose stacks.",
      [
        L("35-dockerfiles", "Dockerfiles for Node (Multi-Stage, Distroless)", "advanced"),
        L("35-image-optimization", "Image Size, Caching & Healthchecks", "advanced"),
        L("35-compose", "Local Stacks with Docker Compose", "advanced")
      ],
      "Containerize the whole system with optimised multi-stage images and a docker compose dev stack (api + db + redis)."),

    mod("36-cicd-k8s", "M36", "Tier 5", "Advanced & Principal Engineering", "CI/CD & Kubernetes",
      "Module 36 — CI/CD & Kubernetes Basics",
      "From commit to cluster: GitHub Actions pipelines, semantic releases, and core Kubernetes objects.",
      [
        L("36-github-actions", "GitHub Actions: Lint, Test, Build & Release", "advanced"),
        L("36-k8s-basics", "Kubernetes Basics: Pods, Deployments & Services", "principal"),
        L("36-deploying", "Probes, ConfigMaps, Secrets & Autoscaling", "principal")
      ],
      "Build a full CI/CD pipeline plus a Kubernetes manifest set (or Helm chart) deploying the API with autoscaling."),

    mod("37-serverless-edge", "M37", "Tier 5", "Advanced & Principal Engineering", "Serverless, Edge, Bun & Deno",
      "Module 37 — Serverless, Edge & the Runtime Landscape",
      "Where Node runs next: Lambda cold starts, Cloudflare Workers, and how Deno and Bun compare.",
      [
        L("37-lambda", "AWS Lambda: Cold Starts & Packaging", "advanced"),
        L("37-edge-workers", "Cloudflare Workers & the Edge Runtime", "principal"),
        L("37-bun-deno", "Deno & Bun vs Node", "advanced")
      ],
      "Deploy the same Hono app to Node, a Lambda and a Cloudflare Worker, then compare cold start and DX."),

    mod("38-scalability", "M38", "Tier 5", "Advanced & Principal Engineering", "Scalability & Hardening",
      "Module 38 — Scalability & Production Hardening",
      "Surviving real traffic: horizontal scaling, statelessness, zero-downtime deploys, rate limiting and runbooks.",
      [
        L("38-horizontal-scaling", "Horizontal Scaling & Statelessness", "principal"),
        L("38-zero-downtime", "Zero-Downtime Deploys & Health Checks", "principal"),
        L("38-load-testing", "Load Testing & Capacity Planning", "principal")
      ],
      "Load-test the system with k6/autocannon, find the breaking point, harden it, and document a runbook."),

    mod("39-security", "M39", "Tier 5", "Advanced & Principal Engineering", "Security Hardening",
      "Module 39 — Security Hardening (Principal Level)",
      "Thinking like an attacker: threat modeling, supply-chain security, SBOMs, and the OWASP Node risks.",
      [
        L("39-threat-modeling", "Threat Modeling & Secure Defaults", "principal"),
        L("39-supply-chain", "Supply-Chain Security, SBOM & Provenance", "principal"),
        L("39-owasp-node", "Prototype Pollution, ReDoS, SSRF & More", "principal")
      ],
      "Run a full security review of the platform: SBOM, threat model, hardening checklist and fixes."),

    mod("40-capstone", "M40", "Tier 5", "Advanced & Principal Engineering", "Principal-Level Capstones",
      "Module 40 — Capstone: Principal-Level Architecture",
      "The L7+ finish line: designing for scale, writing ADRs/RFCs, leading tradeoff analysis, and capstone builds.",
      [
        L("40-designing-for-scale", "Designing for Scale & Writing ADRs", "principal"),
        L("40-capstone-framework", "Capstone A: Build Your Own Web Framework", "principal"),
        L("40-capstone-platform", "Capstone B: A Scaled Real-Time Platform", "principal"),
        L("40-capstone-engine", "Capstone C: A Job-Orchestration Engine", "principal")
      ],
      "Assemble and document a horizontally-scaled, multi-service platform (queue + gRPC + GraphQL + OTel + k8s + CI/CD) with an architecture RFC."),

    /* ================= TIER 6 — DISTINGUISHED ENGINEER (L7++) ================= */
    mod("41-v8-deep", "M41", "Tier 6", "Distinguished Engineer (L7++)", "V8 & JIT Deep Internals",
      "Module 41 — V8 & JIT Deep Internals",
      "Inside the engine: TurboFan IR & Sea of Nodes, speculative optimization, deoptimization, feedback vectors, and startup snapshots.",
      [
        L("41-jit-pipeline-deep", "Inside TurboFan: IR, Sea of Nodes & Speculation", "principal"),
        L("41-deopt-analysis", "Deoptimization: Reading --trace-deopt & %-natives", "principal"),
        L("41-inline-caches-deep", "Inline Caches, Maps & Feedback Vectors", "principal"),
        L("41-snapshots", "Startup Snapshots, Code Cache & the SEA Blob", "principal")
      ],
      "Profile a hot path with --trace-opt/--trace-deopt, eliminate the deopts, and ship a custom startup snapshot — measure each win."),

    mod("42-libuv-deep", "M42", "Tier 6", "Distinguished Engineer (L7++)", "libuv & OS I/O Internals",
      "Module 42 — libuv & OS I/O Internals",
      "Below Node: handles vs requests, the platform backends (epoll/kqueue/IOCP/io_uring), zero-copy, and file-descriptor limits at scale.",
      [
        L("42-loop-internals", "Handles, Requests & the Loop's Anatomy", "principal"),
        L("42-os-backends", "epoll, kqueue, IOCP & io_uring", "principal"),
        L("42-zerocopy-fds", "Zero-Copy, sendfile & File-Descriptor Limits", "principal")
      ],
      "Build a high-throughput TCP service, tune UV_THREADPOOL_SIZE and fd limits, and prove the gains with a load test."),

    mod("43-async-context", "M43", "Tier 6", "Distinguished Engineer (L7++)", "Async Context & Diagnostics Internals",
      "Module 43 — Async Context, Diagnostics & Tracing Internals",
      "The plumbing behind request context and tracing: async_hooks lifecycle, AsyncLocalStorage internals, diagnostics_channel and trace events.",
      [
        L("43-async-hooks", "async_hooks Lifecycle & Resource Tracking", "principal"),
        L("43-async-local-storage", "AsyncLocalStorage Internals & Context Propagation", "principal"),
        L("43-diagnostics-deep", "diagnostics_channel, Trace Events & Continuous Profiling", "principal")
      ],
      "Build a zero-overhead request-context + tracing layer with AsyncLocalStorage and diagnostics_channel, and benchmark its cost."),

    mod("44-mechanical-sympathy", "M44", "Tier 6", "Distinguished Engineer (L7++)", "Mechanical Sympathy",
      "Module 44 — Mechanical Sympathy & Low-Level Performance",
      "Make the hardware happy: CPU caches and cache lines, branch prediction, data-oriented design, allocation-free hot paths, and SIMD via WASM.",
      [
        L("44-cpu-caches", "CPU Caches, Cache Lines & Data-Oriented Design", "principal"),
        L("44-branch-alloc", "Branch Prediction, GC Pressure & Allocation-Free Code", "principal"),
        L("44-simd-wasm", "SIMD, WASM & Beating the JIT", "principal")
      ],
      "Take a numeric hot loop from naive JS to a cache-friendly, allocation-free, SIMD-accelerated version; chart each speedup."),

    mod("45-distributed-theory", "M45", "Tier 6", "Distinguished Engineer (L7++)", "Distributed Systems Theory",
      "Module 45 — Distributed Systems Theory & Data Consistency",
      "The theory that anchors real systems: consistency models, consensus (Raft), logical/vector clocks, CRDTs, and the exactly-once myth.",
      [
        L("45-consistency-models", "Consistency Models: Linearizable to Eventual", "principal"),
        L("45-consensus", "Consensus: Raft Leader Election & Log Replication", "principal"),
        L("45-clocks-crdts", "Logical Clocks, Vector Clocks & CRDTs", "principal"),
        L("45-exactly-once", "Idempotency, the Outbox & Exactly-Once Myths", "principal")
      ],
      "Implement a Raft leader-election state machine and a CRDT, then design an exactly-once-effectively pipeline with an outbox."),

    mod("46-reliability", "M46", "Tier 6", "Distinguished Engineer (L7++)", "Reliability, SLOs & Capacity",
      "Module 46 — Reliability, SLOs & Capacity Engineering",
      "Run systems that stay up: SLIs/SLOs/error budgets, queueing theory (Little's Law, M/M/c, the USL), load shedding and graceful degradation.",
      [
        L("46-slo-error-budgets", "SLIs, SLOs & Error Budgets", "principal"),
        L("46-queueing-theory", "Queueing Theory: Little's Law, M/M/c & the USL", "principal"),
        L("46-load-shedding", "Load Shedding, Backpressure & Graceful Degradation", "principal")
      ],
      "Model a service with queueing theory, set SLOs and an error budget, then add adaptive load shedding and prove it under k6."),

    mod("47-embedding-node", "M47", "Tier 6", "Distinguished Engineer (L7++)", "Building & Embedding Node",
      "Module 47 — Building, Embedding & Extending Node",
      "Own the runtime: build Node from source, custom builds and patches, the embedder API, and runtime instrumentation via custom loaders.",
      [
        L("47-build-from-source", "Building Node from Source & Custom Builds", "principal"),
        L("47-embedder-api", "Embedding Node & the Node-API Embedder Interface", "principal"),
        L("47-custom-loaders", "Custom ESM Loaders & Instrumentation at Scale", "principal")
      ],
      "Patch and build a custom Node, then ship a registrable ESM loader that instruments imports across a large codebase."),

    mod("48-security-l7", "M48", "Tier 6", "Distinguished Engineer (L7++)", "Security Engineering (L7)",
      "Module 48 — Security Engineering & Supply-Chain Assurance",
      "Adversarial engineering at scale: trust boundaries and threat modeling, SLSA/provenance/reproducible builds, fuzzing and sandboxing.",
      [
        L("48-threat-modeling-scale", "Threat Modeling & Trust Boundaries at Scale", "principal"),
        L("48-slsa-supplychain", "SLSA, Provenance & Reproducible Builds", "principal"),
        L("48-fuzzing-sandboxing", "Fuzzing, Sandboxing & Isolation", "principal")
      ],
      "Threat-model a platform end-to-end, reach a SLSA build level, add a fuzzing harness, and sandbox untrusted code."),

    mod("49-platform-eng", "M49", "Tier 6", "Distinguished Engineer (L7++)", "Platform Engineering at Scale",
      "Module 49 — Platform Engineering & API Governance at Scale",
      "Multiply other engineers: API versioning & schema evolution, consumer-driven contract testing, paved roads, golden paths and codemods.",
      [
        L("49-api-evolution", "API Versioning, Schema Evolution & Compatibility", "principal"),
        L("49-contract-testing", "Consumer-Driven Contracts & Contract Testing", "principal"),
        L("49-paved-roads", "Paved Roads, Golden Paths & Codemods at Scale", "principal")
      ],
      "Define an API-evolution policy with contract tests in CI, and ship a codemod that migrates every service to a new standard."),

    mod("50-de-craft", "M50", "Tier 6", "Distinguished Engineer (L7++)", "The Distinguished Engineer's Craft",
      "Module 50 — The Distinguished Engineer's Craft",
      "The non-code multipliers of L7++: technical strategy, leading with RFCs/ADRs, scope & influence, the staff+ archetypes, and a final defense.",
      [
        L("50-technical-strategy", "Technical Strategy, Tech Radar & Build-vs-Buy", "principal"),
        L("50-rfcs-adrs", "Leading with RFCs, ADRs & Decision Records", "principal"),
        L("50-influence", "Scope, Influence & the Staff+ Archetypes", "principal"),
        L("50-capstone-de", "Capstone: Design & Defend a Planet-Scale System", "principal")
      ],
      "Write a real RFC for a planet-scale system, run a design review, and defend your tradeoffs the way an L7++ engineer must.")
  ]
};

/* ---- tiny builders to keep stub modules compact ---- */
function mod(id, code, tier, tierLabel, shortTitle, title, summary, lessons, project) {
  if (project && lessons.length) lessons[lessons.length - 1].project = project;
  return { id: id, code: code, tier: tier, tierLabel: tierLabel, shortTitle: shortTitle,
           title: title, summary: summary, lessons: lessons };
}
function L(id, title, level) {
  return { id: id, title: title, level: level || "intermediate", status: "stub" };
}

/* Modules whose full lessons have been authored. Adding a module id here flips
   all of its lessons to "complete" and auto-derives their file paths
   (content/lessons/<moduleId>/<lessonId>.js). M0–M4 are authored explicitly
   above with their own file paths, so they don't need to be listed. */
var COMPLETED_MODULES = {
  "05-modules": 1, "06-npm": 1, "07-fs": 1, "08-buffers": 1, "09-events": 1,
  "10-streams": 1, "11-process": 1, "12-clis": 1, "13-networking": 1, "14-http": 1,
  "15-frameworks": 1, "16-rest": 1, "17-sql": 1, "18-orms": 1, "19-nosql": 1,
  "20-auth": 1, "21-typescript": 1, "22-testing": 1, "23-toolchain": 1, "24-monorepos": 1,
  "25-concurrency": 1, "26-realtime": 1, "27-queues": 1, "28-grpc-graphql": 1,
  "29-microservices": 1, "30-performance": 1, "31-v8": 1, "32-memory-leaks": 1,
  "33-native": 1, "34-observability": 1, "35-docker": 1, "36-cicd-k8s": 1,
  "37-serverless-edge": 1, "38-scalability": 1, "39-security": 1, "40-capstone": 1,
  "41-v8-deep": 1, "42-libuv-deep": 1, "43-async-context": 1, "44-mechanical-sympathy": 1,
  "45-distributed-theory": 1, "46-reliability": 1, "47-embedding-node": 1, "48-security-l7": 1,
  "49-platform-eng": 1, "50-de-craft": 1
};

/* ---- normalize: build flat order, lookup maps, and counts ---- */
(function normalize(course) {
  course.flat = [];
  course.byModule = {};
  var projects = 0;
  course.modules.forEach(function (mod) {
    course.byModule[mod.id] = mod;
    mod.lessons.forEach(function (lesson, idx) {
      lesson.moduleId = mod.id;
      lesson.indexInModule = idx;
      lesson.tier = mod.tier;
      // Promote whole modules to "complete" + derive their lesson file paths.
      if (COMPLETED_MODULES[mod.id]) {
        lesson.status = "complete";
        if (!lesson.file) lesson.file = "content/lessons/" + mod.id + "/" + lesson.id + ".js";
      }
      if (!lesson.summary && mod.summary) lesson.summary = mod.summary;
      if (lesson.project) projects++;
      course.flat.push(lesson);
    });
  });
  course.totalLessons = course.flat.length;
  course.totalProjects = projects;
})(window.COURSE);
