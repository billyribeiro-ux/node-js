registerQuiz("37-lambda", [
  {
    q: "Which phase of a Lambda cold start adds latency that users directly experience?",
    options: [
      "Downloading the ZIP from S3 only",
      "The init phase: VM boot, Node.js process start, and module-level code execution",
      "The XRAY trace collection phase",
      "The IAM role assumption phase"
    ],
    answer: 1,
    explain: "The init phase — downloading the package, starting the Firecracker microVM, starting the Node.js process, and running module-level code — all happen before your handler executes and users wait for the entire thing on a cold start."
  },
  {
    q: "Where should expensive setup work (DB clients, parsed config, SDK initialisation) be placed in a Lambda function to avoid repeating the cost on every invocation?",
    options: [
      "Inside the handler function, so it runs fresh each invocation",
      "In a separate Lambda layer",
      "At module level, outside the handler, so it runs once per cold start and is reused on warm calls",
      "In a postinstall script"
    ],
    answer: 2,
    explain: "Module-level code runs once during the init phase and is reused on every subsequent warm invocation of the same execution environment. Placing expensive setup there means warm calls skip it entirely, dramatically reducing latency."
  },
  {
    q: "Why should you mark the AWS SDK v3 as external when bundling a Lambda function with esbuild?",
    options: [
      "esbuild cannot parse the AWS SDK source",
      "The SDK must be installed at runtime, not compile time",
      "Lambda Node.js 22.x ships with @aws-sdk v3 pre-installed, so bundling it unnecessarily bloats your ZIP by 6-20 MB",
      "The AWS SDK uses CommonJS which esbuild does not support"
    ],
    answer: 2,
    explain: "Lambda Node.js 22.x runtimes include @aws-sdk v3 pre-installed. Bundling it again adds 6-20 MB to the ZIP, slowing cold starts. Pass --external:@aws-sdk/* to esbuild to exclude it and keep the bundle small."
  }
]);

registerResources("37-lambda", [
  { title: "AWS Lambda: Node.js developer guide", url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html" },
  { title: "AWS Lambda: Configuring Provisioned Concurrency", url: "https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html" },
  { title: "AWS Lambda: Understanding cold starts", url: "https://docs.aws.amazon.com/lambda/latest/operatorguide/execution-environments.html" },
  { title: "esbuild: bundling for Node.js", url: "https://esbuild.github.io/getting-started/#bundling-for-node" },
  { title: "AWS Lambda: Lambda quotas and limits", url: "https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html" }
]);

registerQuiz("37-edge-workers", [
  {
    q: "What is the key technical reason Cloudflare Workers can start in under 1 millisecond, while Lambda cold starts take 100 ms or more?",
    options: [
      "Workers use a smaller Node.js version",
      "Workers use V8 isolates rather than full VMs or containers, so no OS boot or process fork is needed",
      "Workers are pre-warmed by Cloudflare automatically",
      "Workers execute on faster CPUs than Lambda"
    ],
    answer: 1,
    explain: "A V8 isolate is a lightweight sandbox inside the V8 engine — no OS boot, no process fork. Starting an isolate takes under 1 ms. Lambda uses Firecracker microVMs which require booting a full Linux environment, taking at least 100 ms."
  },
  {
    q: "Which storage primitive in Cloudflare Workers provides strongly consistent, single-instance state routable by a unique ID across all edge locations?",
    options: [
      "Workers KV",
      "R2 object storage",
      "Durable Objects",
      "Cache API"
    ],
    answer: 2,
    explain: "Durable Objects are single-instance classes that Cloudflare routes globally by object ID. All requests for the same ID go to the same instance, providing strong consistency. Workers KV is eventually consistent and replicated globally, making it unsuitable for state that requires strong consistency."
  },
  {
    q: "Which statement best describes what WinterCG is and why it matters?",
    options: [
      "A Cloudflare-proprietary API for global routing",
      "A W3C community group standardising Web APIs (fetch, Request, Response, crypto) across server-side runtimes so code is runtime-agnostic",
      "A Node.js working group that manages LTS releases",
      "A benchmarking suite comparing edge runtime performance"
    ],
    answer: 1,
    explain: "WinterCG (Web-interoperable Runtimes Community Group) standardises Web platform APIs — fetch, Request, Response, URL, crypto, streams — across Workers, Deno, Bun, and Node.js. Code written against these APIs runs unmodified on any WinterCG-compliant runtime."
  }
]);

registerResources("37-edge-workers", [
  { title: "Cloudflare Workers: Getting started", url: "https://developers.cloudflare.com/workers/get-started/guide/" },
  { title: "Cloudflare Workers: Durable Objects", url: "https://developers.cloudflare.com/durable-objects/" },
  { title: "Cloudflare Workers: Workers KV", url: "https://developers.cloudflare.com/kv/" },
  { title: "WinterCG: Web-interoperable Runtimes Community Group", url: "https://wintercg.org/" },
  { title: "Cloudflare Workers: Runtime APIs", url: "https://developers.cloudflare.com/workers/runtime-apis/" }
]);

registerQuiz("37-bun-deno", [
  {
    q: "What does Deno's permission model do by default when a script tries to read a file without an explicit flag?",
    options: [
      "It logs a warning but allows the read",
      "It prompts the user interactively",
      "It denies the operation and throws a permission error",
      "It reads the file but redacts sensitive content"
    ],
    answer: 2,
    explain: "Deno denies all I/O by default. A script must be run with explicit flags like --allow-read or --allow-net to access the filesystem or network. This is the secure-by-default model that makes Deno safer for running untrusted or third-party code."
  },
  {
    q: "Which JavaScript engine does Bun use, and why does this contribute to its performance advantage?",
    options: [
      "V8, the same engine as Node.js and Chrome",
      "SpiderMonkey, the Firefox engine",
      "JavaScriptCore, the WebKit/Safari engine, which has different optimisation characteristics and faster startup",
      "Hermes, the React Native engine"
    ],
    answer: 2,
    explain: "Bun is built on JavaScriptCore (the engine powering WebKit/Safari). Its different JIT and startup characteristics contribute to Bun's faster cold start times and higher raw HTTP throughput compared to Node.js and Deno."
  },
  {
    q: "When is Node.js still the best runtime choice over Deno or Bun in 2026?",
    options: [
      "When you need the fastest HTTP throughput",
      "When you want native TypeScript support without a build step",
      "When you depend on native addons (.node binaries) or need maximum npm ecosystem compatibility with zero edge-case risk",
      "When you need the built-in permission model"
    ],
    answer: 2,
    explain: "Node.js remains the safest choice when you depend on native addons compiled for Node, or when you need guaranteed compatibility across the entire npm ecosystem. Bun and Deno are excellent but neither has 100% Node API or native addon compatibility."
  }
]);

registerResources("37-bun-deno", [
  { title: "Deno: Getting started and permissions", url: "https://docs.deno.com/runtime/fundamentals/permissions/" },
  { title: "Bun: Runtime documentation", url: "https://bun.sh/docs" },
  { title: "Deno: Node.js compatibility", url: "https://docs.deno.com/runtime/fundamentals/node/" },
  { title: "Bun: Node.js API compatibility", url: "https://bun.sh/docs/runtime/nodejs-apis" }
]);
