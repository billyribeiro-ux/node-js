registerLessonSrc("37-bun-deno", function () {/*
---
id: 37-bun-deno
title: "Deno & Bun vs Node"
minutes: 28
level: advanced
objectives:
  - Compare Deno, Bun, and Node across security, speed, tooling, and compatibility
  - Choose the right runtime for a given project based on concrete criteria
  - Understand the convergence on Web-standard APIs across all three runtimes
---

# Deno & Bun vs Node

## Why this matters

For its first decade, Node.js had no meaningful competition. Then Deno launched in 2018 — from Node's own creator, Ryan Dahl, with the explicit goal of fixing Node's mistakes — and Bun arrived in 2022 promising to be the fastest JavaScript runtime ever built. Neither is a toy. Both are production-ready for real workloads in 2026. As a professional, you need to evaluate runtimes objectively, not tribally, and pick the right tool for the job — or defend your choice of Node when it is still the best answer.

## Learning objectives

- Explain Deno's **secure-by-default** model and native TypeScript support.
- Explain Bun's **all-in-one toolkit** approach and JavaScriptCore performance.
- Compare all three runtimes on **Node compatibility**, speed, tooling, and ecosystem.
- Use a feature-matrix scorer to make a data-driven runtime selection.
- Understand the **WinterCG convergence** and what runtime-agnostic code looks like.

## Deno: secure by default, TypeScript native

Deno was created to fix what Ryan Dahl called his "10 regrets" about Node.js. Its headline features:

### Permission model

Deno denies all I/O by default. A script must explicitly request permissions to read files, write files, access the network, spawn processes, or read environment variables. This is a massive security improvement over Node, where any `require()`'d package can exfiltrate data or read your `~/.ssh` directory.

```bash
# Run a script with only network access to example.com
deno run --allow-net=example.com fetch-data.ts

# Full permissions (escape hatch — avoid in production)
deno run --allow-all server.ts
```

### TypeScript without a build step

Deno transpiles TypeScript natively. You write `.ts` files and run them directly — no `tsc`, no `ts-node`, no `tsx`. Type errors are caught at startup.

```bash
deno run server.ts         # just works — no tsconfig required
deno check server.ts       # type-check only, no execution
```

### Web-standard first

Deno implemented `fetch`, `Request`, `Response`, `WebSocket`, `crypto`, `ReadableStream`, and the rest of the WHATWG APIs years before Node did. Code targeting Web APIs works identically in Deno and in a browser.

```js
// server.ts — Deno's native HTTP server (Web-standard style)
Deno.serve({ port: 8000 }, (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return new Response("Hello from Deno!", { status: 200 });
  }
  return new Response("Not Found", { status: 404 });
});
```

> [!OUTPUT]
> Listening on http://localhost:8000/

### Node compatibility layer

Deno 2.x ships a Node.js compatibility layer (`node:` prefix imports, npm package support via `npm:` specifiers). Most Node.js packages now work in Deno without changes.

```ts
// Deno 2.x — consuming an npm package directly
import express from "npm:express@4";
const app = express();
app.get("/", (_req, res) => res.send("Hello from Express on Deno"));
app.listen(3000);
```

## Bun: speed and the all-in-one toolkit

Bun is built on **JavaScriptCore** (Safari's JS engine, also used in WebKit). It prioritises raw speed at every level: startup time, HTTP throughput, package install speed, and test execution.

### Performance numbers (2026 benchmarks)

| Metric | Node 22 | Deno 2 | Bun 1.x |
|---|---|---|---|
| HTTP requests/sec (simple handler) | ~75 000 | ~90 000 | ~120 000+ |
| npm install (medium project) | ~8 s | ~6 s | ~0.8 s |
| Test suite run (1 000 tests) | baseline | ~0.9x | ~2–3x |
| Cold start (CLI script) | ~50 ms | ~30 ms | ~5 ms |

Bun also ships every tool you need in a single binary:

- `bun run` — task runner + bundler
- `bun test` — Jest-compatible test runner (no config)
- `bun install` — package manager (reads `package.json`, writes `bun.lockb`)
- `bun build` — bundler with tree-shaking
- `bun compile` — compiles to a standalone executable

```bash
# No separate jest/ts-node/esbuild needed:
bun test                    # run all *.test.ts files
bun build src/index.ts --outfile dist/bundle.js
bun compile src/cli.ts --outfile ./my-cli
```

### Node compatibility

Bun aims for 100% Node.js API compatibility. `require`, `module.exports`, `process`, `Buffer`, `fs`, `http`, `crypto` — all work. Most Node.js projects run on Bun without modifications. The `bun` binary reads `package.json` scripts and resolves `node_modules`, so `bun run dev` replaces `npm run dev` as a drop-in.

> [!PITFALL] "Compatible" does not mean "identical"
> Bun's Node compatibility is excellent but not perfect. Edge cases exist in stream handling, some `child_process` behaviours, and a handful of native addons. Before migrating a production service to Bun, run your full test suite on Bun in CI before deploying. Use `bun test` to catch failures fast.

## Feature comparison

| Criterion | Node.js 22 | Deno 2 | Bun 1.x |
|---|---|---|---|
| Maturity / ecosystem | Largest (2009) | Growing | Fast-growing |
| TypeScript | Via tsc/ts-node | Native | Native |
| Security model | None by default | Permissions | None by default |
| Performance | Good | Good | Best |
| Package manager | npm/yarn/pnpm | deno.json / npm: | bun (built-in) |
| Web APIs (fetch, etc.) | Yes (v21+) | Yes (original) | Yes |
| Node API compatibility | 100% | ~95% | ~98% |
| All-in-one toolchain | No | Partial | Yes |
| Serverless adoption | Dominant | Growing | Growing |
| Best for | Legacy, ecosystem breadth | Security, TypeScript, Deno Deploy | Speed, DX, all-in-one |

## When to choose each

**Choose Node.js when:**
- You depend on native addons (`.node` binaries) with no Bun/Deno equivalents.
- Your team uses Lambda, Elastic Beanstalk, or another platform where Node is first-class.
- You need maximum npm ecosystem compatibility with zero risk of edge cases.
- You are maintaining an existing large Node.js codebase — the migration cost is not free.

**Choose Deno when:**
- Security and permissions matter (regulated industries, untrusted-code sandboxing).
- You want TypeScript-native without a build step, with strict type checking at startup.
- You are deploying to Deno Deploy (their edge platform, similar to Cloudflare Workers).
- You want the cleanest, most standards-aligned runtime for a greenfield project.

**Choose Bun when:**
- Raw throughput matters: high-RPS APIs, batch processing, CLI tools with fast startup.
- Developer experience is a priority: one binary, fast tests, fast installs, no config.
- You are starting a new TypeScript project and want zero toolchain friction.
- Your existing Node.js project can be validated on Bun in CI to capture the speed gains for free.

> [!PRINCIPAL] The convergence is the story
> Node, Deno, and Bun are converging on the same API surface: Web-standard APIs (WinterCG), ES Modules, TypeScript awareness, and native `fetch`. At principal level, the most durable technical decision is to write against Web APIs rather than runtime-specific APIs wherever possible. This gives you optionality: the same fetch handler can run on Node, Deno, Bun, Cloudflare Workers, or even a browser Service Worker. Lock-in to runtime-specific primitives only when you have no alternative.

## Try it yourself

The runtime scorer below takes a set of project requirements and recommends a runtime based on a weighted feature matrix. Run it and try tweaking the weights.

```js run
// Feature-matrix runtime scorer
// Returns a recommendation based on weighted project requirements.

const runtimes = {
  node: {
    ecosystem:      10, // largest npm ecosystem
    security:        3, // no built-in permissions
    performance:     6,
    typescript:      5, // needs build step
    toolchain:       4, // separate tools needed
    webStandards:    8,
  },
  deno: {
    ecosystem:       6,
    security:       10, // best-in-class permissions
    performance:     7,
    typescript:     10, // native, no config
    toolchain:       7,
    webStandards:   10,
  },
  bun: {
    ecosystem:       8,
    security:        4,
    performance:    10, // fastest
    typescript:      9,
    toolchain:      10, // all-in-one
    webStandards:    8,
  },
};

function recommend(requirements) {
  // requirements: { criterion: weight (0-10) }
  const scores = {};
  for (const [runtime, features] of Object.entries(runtimes)) {
    let score = 0;
    for (const [criterion, weight] of Object.entries(requirements)) {
      score += (features[criterion] ?? 0) * weight;
    }
    scores[runtime] = score;
  }

  const ranked = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([rt, score], i) => `  ${i + 1}. ${rt.padEnd(6)} score: ${score}`);

  return ranked.join("\n");
}

// Example project: high-throughput API, TypeScript, speed matters, security less so
console.log("=== High-throughput TypeScript API ===");
console.log(recommend({ performance: 9, typescript: 8, toolchain: 7, ecosystem: 5, security: 2 }));

// Example project: regulated fintech service — security first
console.log("\n=== Regulated fintech service ===");
console.log(recommend({ security: 10, ecosystem: 8, typescript: 7, performance: 4, toolchain: 3 }));

// Example project: quick CLI tool
console.log("\n=== CLI tool (fast startup, TypeScript) ===");
console.log(recommend({ performance: 8, toolchain: 10, typescript: 8, ecosystem: 4, security: 1 }));
```

## Project

**Deploy the same Hono app to Node, a Lambda, and a Cloudflare Worker — then compare cold start and DX.**

[Hono](https://hono.dev) is a minimal, Web-standard HTTP framework that runs identically on Node, Deno, Bun, Cloudflare Workers, and AWS Lambda. It is the canonical tool for demonstrating runtime portability.

### Acceptance criteria

1. **One shared handler file** (`src/app.ts`) that exports a Hono `app` instance with at least two routes (`GET /` and `GET /health`). No runtime-specific code in this file.
2. **Node.js adapter** (`src/node.ts`) that wraps the Hono app using `@hono/node-server` and starts an HTTP server on port 3000.
3. **Cloudflare Workers adapter** (`src/worker.ts`) that re-exports the Hono app as the default export (Hono's Workers adapter handles the rest).
4. **AWS Lambda adapter** (`src/lambda.ts`) that wraps the app using the `hono/aws-lambda` adapter and exports a `handler` function.
5. **Cold-start comparison**: instrument each adapter with a module-level timestamp and a handler-level timestamp; log the gap in milliseconds so you can compare init overhead across runtimes.
6. **DX comparison**: document in a comment block the `wrangler dev`, `sam local invoke`, and `bun run dev` commands needed to test each adapter locally, noting the number of config files and setup steps each requires.

### Starter: the runtime-agnostic Web-standard handler

The code below runs in this sandbox and shows the pure-logic core that all three adapters would share.

```js run
// Simulate a Hono-style Web-standard app (Request → Response)
// This same logic runs unmodified on Node, Deno, Bun, and Cloudflare Workers.

const routes = new Map([
  ["GET /", () => new Response(JSON.stringify({ message: "Hello from Hono!" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })],
  ["GET /health", () => new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })],
]);

async function app(request) {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const handler = routes.get(key);
  if (handler) return handler();
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
}

// Simulate the three adapter entry points
const initTime = performance.now(); // would be module-level in real adapters

async function nodeAdapter(req) {
  const handlerTime = performance.now();
  const res = await app(req);
  console.log(`[Node] init→handler gap: ${(handlerTime - initTime).toFixed(2)} ms`);
  return res;
}

async function workerAdapter(req) {
  const handlerTime = performance.now();
  const res = await app(req);
  console.log(`[Worker] init→handler gap: ${(handlerTime - initTime).toFixed(2)} ms`);
  return res;
}

// Run simulated requests through each adapter
(async () => {
  const requests = [
    new Request("https://myapp.dev/"),
    new Request("https://myapp.dev/health"),
    new Request("https://myapp.dev/missing"),
  ];

  console.log("=== Node adapter ===");
  for (const req of requests) {
    const res = await nodeAdapter(req);
    const body = await res.json();
    console.log(`  ${req.method} ${new URL(req.url).pathname} → ${res.status}:`, JSON.stringify(body));
  }

  console.log("\n=== Worker adapter ===");
  for (const req of requests) {
    const res = await workerAdapter(new Request(req.url));
    const body = await res.json().catch(() => ({ text: "non-JSON" }));
    console.log(`  GET ${new URL(req.url).pathname} → ${res.status}:`, JSON.stringify(body));
  }
})();
```

## Common pitfalls

> [!PITFALL] Benchmarking in isolation and drawing universal conclusions
> "Bun is 10x faster than Node" headlines come from microbenchmarks measuring server startup or simple JSON serialisation. In a real application dominated by PostgreSQL queries or S3 calls, the runtime overhead is dwarfed by I/O latency and the benchmarks are irrelevant. Profile your actual workload before switching runtimes for performance reasons.

> [!PITFALL] Assuming Deno/Bun Node compatibility is 100%
> Both runtimes are excellent but neither is perfectly compatible with every Node.js package. Native addons (`.node` files) built for Node won't load in Bun or Deno. Some packages test for `process.versions.node` and take different code paths. Always run your test suite on the target runtime before committing to a migration.

## What you learned

- **Deno** offers a permission-based security model, native TypeScript, and the closest alignment to Web standards — ideal for security-sensitive or greenfield TypeScript projects.
- **Bun** is the fastest runtime with a zero-config all-in-one toolkit — ideal for high-throughput APIs, CLI tools, and developer productivity.
- **Node.js** retains the largest ecosystem and best platform support — the safe default when compatibility and ecosystem breadth matter most.
- All three are converging on **Web-standard APIs** (WinterCG): code that uses only `fetch`, `Request`, `Response`, `URL`, and `crypto` is runtime-agnostic.
- A **feature-matrix scorer** helps make runtime decisions explicit and defensible rather than tribal.
- **Hono** is the canonical framework for proving runtime portability — one app, three deployment targets.

## Next steps

You have now seen the full runtime landscape: Node.js in Lambda VMs, V8 isolates at the edge, and Deno/Bun as capable alternatives. The next module zooms out to **scalability architecture** — how to design systems that scale horizontally across all these compute primitives.
*/});
