registerLessonSrc("23-tsx-esbuild", function () {/*
---
id: 23-tsx-esbuild
title: "tsx & esbuild: Fast Dev & Bundling"
minutes: 24
level: advanced
objectives:
  - Use tsx to run TypeScript directly without a separate compile step
  - Explain why esbuild is dramatically faster than JavaScript-based tools
  - Know when to use esbuild in transform mode vs bundle mode
---

# tsx & esbuild: Fast Dev & Bundling

## Why this matters

The TypeScript compile step used to be a painful tax on developer experience: write a file, wait for `tsc`, refresh, repeat. Modern tooling has collapsed that loop to near-zero. **tsx** lets you run `.ts` files with `node` as if they were plain JS, and **esbuild** bundles an entire app in milliseconds. Understanding both — and when each one is the right tool — is table stakes for any serious TypeScript project in 2026.

## Learning objectives

- Run TypeScript files instantly with **tsx** and understand what it does under the hood.
- Explain the architectural reason esbuild is 10–100× faster than TypeScript or webpack-based tools.
- Use esbuild in **transform mode** (single-file transpile) and **bundle mode** (multi-file, with tree-shaking).
- Set up a **watch** loop for a tight dev-server-style feedback cycle.

## tsx: instant TypeScript execution

`tsx` is a thin wrapper around Node's `--import` / `--loader` hooks that registers esbuild as the TypeScript transformer. When you write:

```bash
npx tsx src/server.ts
```

Node streams the file through esbuild's transformer before executing it. There is **no `dist/` folder**, no `tsc --build`, no source-map gymnastics required in your terminal workflow. The TypeScript type information is stripped (not checked — use `tsc --noEmit` in CI for that), and the resulting JS runs immediately.

```bash
npm install -D tsx esbuild typescript
```

```json
{
  "scripts": {
    "dev":   "tsx watch src/server.ts",
    "check": "tsc --noEmit",
    "build": "esbuild src/server.ts --bundle --platform=node --outfile=dist/server.js"
  }
}
```

> [!NOTE] tsx vs ts-node
> `ts-node` is an older alternative that invokes the TypeScript compiler itself. It is slower and has more edge cases around ESM. `tsx` uses esbuild under the hood and starts in milliseconds regardless of project size.

### Watch mode

```bash
npx tsx watch src/server.ts
```

tsx monitors the file and all its imports for changes, restarting the process automatically — similar to `nodemon`, but with built-in TS transpilation. No extra config file required.

> [!PRINCIPAL] Type-checking is separate from running
> tsx deliberately skips type checking. This is the right split: your editor and `tsc --noEmit` give you types continuously; tsx and esbuild give you execution speed. Coupling type-checking to every hot-reload would impose a 1–10 second penalty per save. Separate the "does it type-check?" question (answered by tsc/the editor) from the "does it run?" question (answered by tsx/esbuild).

## esbuild: the Go-powered bundler

**esbuild** is written in Go, compiled to a single native binary. That is the core reason for its speed advantage.

### Why Go makes such a difference

A typical JavaScript bundler (webpack, rollup, parcel) is itself a Node.js program. When it bundles your 200-module app it:

1. Starts the Node.js VM and loads its own hundreds of modules.
2. Parses your source files **one at a time** in a single-threaded JS event loop.
3. Does string transformations on AST nodes using JavaScript objects (lots of GC pressure).

esbuild, by contrast:

1. Starts as a native binary — microseconds, not hundreds of milliseconds.
2. Parses all modules **in parallel** using Go goroutines.
3. Operates on compact memory layouts with no garbage-collection pauses.

The result: what webpack takes 30 s to bundle, esbuild does in under 300 ms.

```
Bundler        | 10-module app | 500-module app
---------------|--------------|----------------
webpack 5      |  ~1.8 s      |  ~28 s
rollup + babel |  ~2.1 s      |  ~35 s
esbuild        |  ~0.05 s     |  ~0.3 s
```

### Transform mode vs bundle mode

esbuild has two distinct modes:

**Transform mode** — single file in, single file out. No dependency resolution. Use it when you just need to strip TypeScript types or transpile modern JS down for a target environment.

```bash
esbuild src/util.ts --target=node20 --outfile=dist/util.js
```

```js
// programmatic API — transform mode
import esbuild from "esbuild";

const result = await esbuild.transform(
  `const greet = (name: string) => \`Hello, \${name}!\`;`,
  { loader: "ts", target: "node20" }
);
console.log(result.code);
// const greet = (name) => `Hello, ${name}!`;
```

> [!OUTPUT]
> const greet = (name) => `Hello, ${name}!`;

**Bundle mode** — entry point(s) in, fully-resolved bundle out. esbuild follows every `import`, inlines dependencies (or marks them external), and emits one (or more) output files.

```bash
esbuild src/server.ts \
  --bundle \
  --platform=node \
  --packages=external \
  --sourcemap \
  --outfile=dist/server.js
```

`--packages=external` tells esbuild to leave `node_modules` imports as-is — essential for server bundles where you don't want to inline every npm package.

```js
// programmatic bundle — useful in build scripts
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  sourcemap: true,
  outfile: "dist/server.js",
});
console.log("build complete");
```

> [!OUTPUT]
> build complete

### When to use which

| Situation | Tool |
|---|---|
| Run a TS script in dev | `tsx src/script.ts` |
| Hot-reload a TS server | `tsx watch src/server.ts` |
| CI type safety gate | `tsc --noEmit` |
| Strip types from one file | `esbuild --transform` |
| Bundle a server app for deployment | `esbuild --bundle --platform=node` |
| Bundle a browser app | `esbuild --bundle --platform=browser` |

> [!PITFALL] esbuild does NOT type-check
> esbuild strips TypeScript syntax but never validates types. A file full of type errors will bundle without complaint. Always run `tsc --noEmit` in CI — never rely on esbuild to catch mistakes.

## Try it yourself

Bundlers need to know the **order** in which to process modules. If module A depends on B, B must be processed first. This is a classic **topological sort** — the same algorithm every real bundler runs internally. Here it is in pure JavaScript:

```js run
// Topological sort — the core of what a bundler's module-ordering phase does.
// Given a dependency graph (adjacency list), produce a valid load order.

function topoSort(graph) {
  const visited = new Set();
  const result = [];

  function visit(node) {
    if (visited.has(node)) return;
    visited.add(node);
    const deps = graph[node] || [];
    for (const dep of deps) visit(dep);
    result.push(node);
  }

  for (const node of Object.keys(graph)) visit(node);
  return result;
}

// Simulate: app.ts imports server.ts and db.ts; server.ts imports logger.ts
const depGraph = {
  "app.ts":    ["server.ts", "db.ts"],
  "server.ts": ["logger.ts"],
  "db.ts":     ["logger.ts"],
  "logger.ts": [],
};

const loadOrder = topoSort(depGraph);
console.log("Module load order:");
loadOrder.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
```

## Exercises

### Exercise 1 — cycle detection

Real bundlers error on circular imports. Extend `topoSort` to detect a cycle and throw a descriptive error.

<details>
<summary>Show solution</summary>

```js run
function topoSortSafe(graph) {
  const visited = new Set();
  const inStack = new Set();
  const result = [];

  function visit(node) {
    if (inStack.has(node)) throw new Error(`Cycle detected at: ${node}`);
    if (visited.has(node)) return;
    inStack.add(node);
    for (const dep of (graph[node] || [])) visit(dep);
    inStack.delete(node);
    visited.add(node);
    result.push(node);
  }

  for (const node of Object.keys(graph)) visit(node);
  return result;
}

// No cycle — should succeed
const ok = { A: ["B"], B: ["C"], C: [] };
console.log("OK order:", topoSortSafe(ok).join(" -> "));

// Cycle: A -> B -> A
try {
  topoSortSafe({ A: ["B"], B: ["A"] });
} catch (e) {
  console.log("Caught:", e.message);
}
```

</details>

### Exercise 2 — transform timing

Write a function that simulates an esbuild-style parallel transform: given an array of "files" (strings), process them all concurrently with `Promise.all` and measure total time versus sequential processing.

<details>
<summary>Show solution</summary>

```js run
// Simulate async transform latency (e.g. parsing)
function transformFile(name, ms) {
  return new Promise(resolve =>
    setTimeout(() => resolve(`transformed:${name}`), ms)
  );
}

const files = [
  ["app.ts", 30],
  ["server.ts", 20],
  ["db.ts", 25],
  ["logger.ts", 10],
];

async function main() {
  // Sequential
  const t0 = Date.now();
  for (const [name, ms] of files) await transformFile(name, ms);
  console.log(`Sequential: ${Date.now() - t0}ms`);

  // Parallel (esbuild's approach)
  const t1 = Date.now();
  await Promise.all(files.map(([name, ms]) => transformFile(name, ms)));
  console.log(`Parallel:   ${Date.now() - t1}ms`);
}
main();
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting --packages=external for server bundles
> Without this flag esbuild inlines your entire `node_modules` — including native addons that can't be bundled. Server bundles almost always want `--packages=external`. Browser bundles are the opposite: you usually want everything inlined.

Also watch out for path aliases (`@/utils` style imports set up in `tsconfig.json`). esbuild does not read `tsconfig.paths` by default — use the `esbuild-plugin-tsconfig-paths` plugin or switch to Node's built-in `--import-resolve` approach.

## What you learned

- **tsx** runs TypeScript files instantly by registering esbuild as a Node loader — no `dist/` folder, no waiting.
- **esbuild** is written in Go and processes modules in parallel, making it 10–100× faster than JS-based bundlers.
- **Transform mode** strips types from a single file; **bundle mode** resolves the whole import graph into one output.
- Use `--packages=external` for server bundles to avoid inlining `node_modules`.
- Type checking and execution are deliberately decoupled: `tsc --noEmit` in CI, tsx/esbuild for speed.

## Next steps

Fast code is only half the story — it also needs to be *correct* and *consistent*. Next we'll look at Biome, the single Rust tool that replaces both ESLint and Prettier.
*/});
