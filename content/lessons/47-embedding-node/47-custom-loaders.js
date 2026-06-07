registerLessonSrc("47-custom-loaders", function () {/*
---
id: 47-custom-loaders
title: "Custom ESM Loaders & Instrumentation at Scale"
minutes: 30
level: advanced
objectives:
  - Understand the resolve/load/transform hook pipeline and how off-thread loader workers operate
  - Chain multiple loaders correctly using nextResolve/nextLoad and reason about ordering guarantees
  - Design a registrable ESM loader for large-codebase instrumentation with minimal overhead
---

# Custom ESM Loaders & Instrumentation at Scale

## Why this matters

At scale, you cannot instrument a 500-module codebase by hand-editing every file. ESM loaders let you intercept every `import` — before a byte of module source is read, while it is being loaded, and after it is parsed — and transparently rewrite, audit, or mock it. This is how production TypeScript-on-the-fly runtimes work, how test frameworks inject mocks without touching source, how supply-chain policy tools block `import 'malicious-pkg'` before it executes, and how coverage tools inject counters without a separate build step.

## Learning objectives

- Map the full loader hook pipeline: `resolve` → `load` → (implicit transform) in both the main thread and the off-thread loader worker.
- Chain loaders via `module.register()` and reason about hook ordering and the `nextResolve`/`nextLoad` short-circuit.
- Implement a production-grade loader that instruments module imports across thousands of modules with controlled overhead.

## The loader hook pipeline

Node's ESM loader exposes four hooks, all living in a separate **loader worker thread** (since Node 20.6 / `--experimental-loader` was deprecated in favour of `module.register`):

```
import 'foo'
   │
   ▼
┌──────────────┐      off-thread loader worker
│   resolve    │  Receives: specifier, context (parentURL, importAttributes)
│              │  Returns:  { url, shortCircuit?, format? }
└──────┬───────┘
       │ resolved URL
       ▼
┌──────────────┐
│     load     │  Receives: resolved URL, context (format, importAttributes)
│              │  Returns:  { source, format, shortCircuit? }
└──────┬───────┘
       │ source string / buffer
       ▼
   (Node parses + evaluates the module)
```

The `initialize` hook runs once when the loader worker starts, before any imports. It receives the data passed to `module.register()` and can establish shared state (e.g., a channel back to the main thread via `MessageChannel`).

```js
// hooks.mjs — a minimal instrumentation loader
// read-only; runs in the loader worker thread

export async function initialize({ port }) {
  // port is a MessagePort — use it to send events back to main thread
  globalThis.__loaderPort = port;
}

export async function resolve(specifier, context, nextResolve) {
  // Intercept before path resolution; can redirect or block here
  const result = await nextResolve(specifier, context);
  return result;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (context.format !== "module" && result.format !== "module") return result;

  // Inject an import-time side effect (e.g., count imports, record timing)
  const instrumented =
    `import { __record } from 'node:internal/perf/record';\n` +
    `__record(${JSON.stringify(url)});\n` +
    result.source;

  // NOTE: in practice use a proper AST transform (e.g. acorn/recast), not string prepend
  return { ...result, source: instrumented };
}
```

> [!OUTPUT]
> (loader hooks run silently; the side effect is a timing record per import)

> [!NOTE]
> Since Node 20.6, `--experimental-loader` is soft-deprecated. The canonical API is `module.register(specifier, parentURL, { data, transferList })` called from the main thread (or early in the entrypoint). The loader module runs in a dedicated Worker, not the main thread — this is important: **synchronous communication with the main thread is impossible**; use `MessageChannel` passed via the `data` option.

## Chaining multiple loaders

`module.register()` can be called multiple times. Hooks chain in **reverse registration order** for `resolve` and `load` — last registered runs outermost (first called), and each hook calls `nextResolve`/`nextLoad` to delegate down:

```js
// main entrypoint — read-only
import { register } from 'node:module';

// Registration order: policy → typescript → sourcemap
// Execution order for resolve:  policy.resolve → ts.resolve → sourcemap.resolve → Node default
register('./loaders/policy.mjs',   import.meta.url, { data: { blocklist: ['evil-pkg'] } });
register('./loaders/typescript.mjs', import.meta.url);
register('./loaders/sourcemap.mjs',  import.meta.url);
```

```js
// loaders/policy.mjs — read-only
export async function resolve(specifier, context, nextResolve) {
  if (context.data?.blocklist?.includes(specifier)) {
    throw new Error(`[policy] Import of '${specifier}' is blocked by supply-chain policy`);
  }
  return nextResolve(specifier, context);
}
```

> [!OUTPUT]
> Error: [policy] Import of 'evil-pkg' is blocked by supply-chain policy

> [!PRINCIPAL]
> The loader chain is a **trampoline**: each hook is responsible for calling `nextResolve`/`nextLoad`, or short-circuiting with `{ shortCircuit: true }`. If a hook forgets to call next, every downstream loader (and Node's default resolver) is silently skipped. This is a common source of "my TypeScript loader works alone but breaks when I add a second loader" — the hook that short-circuits must pass `shortCircuit: true` in the returned object so Node knows the chain is intentionally terminated, not accidentally dropped.

## Real use cases and their loader shapes

### TypeScript on the fly

```js
// loaders/typescript.mjs — read-only (simplified)
import { transformSync } from 'esbuild';

export function load(url, context, nextLoad) {
  if (!url.endsWith('.ts') && !url.endsWith('.tsx')) return nextLoad(url, context);
  // fetch source (Node gives us raw file content via nextLoad with format:'module')
  return nextLoad(url, { ...context, format: 'module' }).then(result => {
    const { code } = transformSync(result.source.toString(), {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      sourcemap: 'inline',
    });
    return { format: 'module', source: code, shortCircuit: true };
  });
}

export function resolve(specifier, context, nextResolve) {
  // Allow .ts extensions in import paths
  if (specifier.endsWith('.ts') || specifier.endsWith('.tsx')) {
    return nextResolve(specifier, context);
  }
  // Try .ts fallback for bare .js imports (TypeScript's "import from './x.js'" pattern)
  return nextResolve(specifier, context).catch(() =>
    nextResolve(specifier.replace(/\.js$/, '.ts'), context)
  );
}
```

> [!OUTPUT]
> (TypeScript files are transpiled on import; no tsc step needed for development)

### Import maps and mocking

```js
// loaders/importmap.mjs — read-only
const map = {
  "lodash": new URL("./vendor/lodash-esm.mjs", import.meta.url).href,
  "react":  new URL("./mocks/react.mjs", import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  if (map[specifier]) return { url: map[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
```

### Coverage instrumentation

Coverage tools like `c8` hook into V8's built-in `NODE_V8_COVERAGE` environment variable (which writes per-script coverage JSON to a directory), but custom loaders can do finer-grained instrumentation — e.g., branch-level counters inserted at the AST level before V8 sees the source. This is how Istanbul/nyc's source-transform approach works adapted for ESM.

### Supply-chain policy enforcement

```bash
# Run with a loader that enforces an allowlist of packages
NODE_OPTIONS='--import ./loaders/policy-register.mjs' node app.mjs
```

> [!OUTPUT]
> [policy] Resolved 47 imports. Blocked: 0. Allowed: 47.

## Performance considerations

Every import goes through your loader hooks synchronously from the loader worker's perspective. The main thread blocks waiting for resolution/loading of each module in the static import graph at startup. This means:

- **Hook latency multiplies with module count.** A hook that adds 1 ms per import costs 500 ms across 500 modules at startup. Aim for < 0.5 ms per hook in the hot path.
- **Cache aggressively.** If your `resolve` hook does any work beyond a Map lookup, memoize the result keyed by `(specifier, parentURL)`.
- **Avoid async I/O in `resolve`.** The loader worker has an event loop but resolve is called in a hot serialised path. If you must do I/O, do it in `initialize` and cache the result.
- **Use `shortCircuit: true` early.** If your loader doesn't handle a URL (e.g., it only handles `.ts` files), return `nextLoad` directly — don't build an intermediate object.

```js
// Fast path — exit early for URLs your loader doesn't own — read-only
export function load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) return nextLoad(url, context); // fast path
  // ... slow TS transform path
}
```

> [!PRINCIPAL]
> At 1000+ modules, startup time dominated by loader hooks becomes a first-class reliability concern. Netflix, Shopify, and other large Node shops have measured 2-5 second startup regressions from naive instrumentation loaders. The production pattern is: do a one-time ahead-of-time (AOT) scan in CI to build a `{ specifier → transformed-hash }` cache written to disk, then have the loader check the cache first and only re-transform on cache miss (keyed by file mtime + content hash). Combined with `--build-snapshot` to bake the import graph into a startup snapshot, you can recover to sub-100 ms startup even with a large loader chain.

## Try it yourself

The runnable block below simulates the full loader chain pipeline in pure JavaScript — resolve → load → transform — with multiple hooks chaining via `nextResolve`/`nextLoad`. This is the algorithmic core of what Node executes in the loader worker.

```js run
// ESM loader-chain simulator
// Models: multiple hooks chaining via next(), with short-circuit support

function makeChain(hooks) {
  // hooks = [outermost, ..., innermost]
  // The "default" resolver/loader at position hooks.length
  function buildNext(index, type) {
    if (index >= hooks.length) {
      // Default Node behaviour
      if (type === "resolve") return async (spec, ctx) => ({ url: "file://" + spec, format: "module" });
      if (type === "load") return async (url, ctx) => ({ format: "module", source: `// source of ${url}` });
    }
    const hook = hooks[index];
    const next = buildNext(index + 1, type);
    return async (arg, ctx) => {
      const fn = type === "resolve" ? hook.resolve : hook.load;
      if (!fn) return next(arg, ctx); // hook doesn't implement this type
      return fn(arg, ctx, next);
    };
  }
  return { resolve: buildNext(0, "resolve"), load: buildNext(0, "load") };
}

// Define three loaders
const policyLoader = {
  resolve: async (spec, ctx, next) => {
    if (spec === "evil-pkg") throw new Error("policy: blocked " + spec);
    const result = await next(spec, ctx);
    console.log("[policy] resolved:", spec, "->", result.url);
    return result;
  }
};

const importMapLoader = {
  resolve: async (spec, ctx, next) => {
    const map = { "lodash": "file:///vendor/lodash.mjs" };
    if (map[spec]) {
      console.log("[importmap] remapped:", spec, "->", map[spec]);
      return { url: map[spec], format: "module", shortCircuit: true };
    }
    return next(spec, ctx);
  }
};

const instrumentLoader = {
  load: async (url, ctx, next) => {
    const result = await next(url, ctx);
    const patched = `// [instrumented]\n${result.source}`;
    console.log("[instrument] patched:", url, "(+" + (patched.length - result.source.length) + " chars)");
    return { ...result, source: patched };
  }
};

// Chain: policy (outermost) -> importmap -> instrument (innermost) -> default
const chain = makeChain([policyLoader, importMapLoader, instrumentLoader]);

async function runPipeline(specifiers) {
  for (const spec of specifiers) {
    console.log("\n--- import '" + spec + "' ---");
    try {
      const resolved = await chain.resolve(spec, {});
      if (resolved.shortCircuit) {
        console.log("[chain] short-circuited at resolve; skipping load");
      } else {
        const loaded = await chain.load(resolved.url, { format: resolved.format });
        console.log("[result] format:", loaded.format, "| source len:", loaded.source.length);
      }
    } catch (e) {
      console.log("[BLOCKED]", e.message);
    }
  }
}

runPipeline(["./utils.mjs", "lodash", "evil-pkg", "./app.mjs"]);
```

## Project

**Patch and build a custom Node, then ship a registrable ESM loader that instruments imports across a large codebase.**

This is a portfolio-grade systems project that demonstrates end-to-end ownership: from the Node binary through to production instrumentation infrastructure.

### Brief

Your team maintains a large internal Node.js monorepo (500+ modules). The security and observability requirements are:

1. **Supply-chain policy**: block any `import` of packages not in an approved allowlist, enforced at the loader layer before any code executes.
2. **Import timing**: record the wall-clock time each module takes to load and expose it via a `process._loaderMetrics` API.
3. **TypeScript support**: transparently transpile `.ts` files using esbuild at import time, with inline source maps.
4. **Performance budget**: total loader overhead must not exceed 2 ms per module on the hot path after the first load (cached path must be < 0.1 ms).
5. **Registrable via `--import`**: the loader must be activatable with a single `NODE_OPTIONS='--import ./instrumentation/register.mjs'` flag — no changes to application source.
6. **Custom Node patch**: apply a minimal patch to `deps/v8/src/` or `lib/` that adds a `process.loaderHookCallCount` integer that increments each time any loader hook is called, and verify it via `node --check` and a test.

### Acceptance criteria

1. `node --import ./instrumentation/register.mjs app.mjs` runs without errors; `process._loaderMetrics` is a Map of `url → loadTimeMs`.
2. Importing a package not in `allowlist.json` throws `PolicyError: import of '<pkg>' is blocked` before any module code executes.
3. Importing `./src/feature.ts` succeeds and the transpiled source is valid ESM with an inline source map.
4. A benchmark importing 100 modules shows cached-path median < 0.1 ms, uncached median < 2 ms.
5. `process.loaderHookCallCount` (from the custom Node patch) equals the total number of resolve+load calls made during a test run.
6. The full test suite (`make test-only`) passes against the patched Node binary.

### Starter: loader-chain core (pure logic)

```js run
// Loader-chain core with timing and caching
// Pure JS model of the production loader's hot path

class LoaderPipeline {
  constructor() {
    this.cache = new Map();        // url -> { source, loadTimeMs }
    this.metrics = new Map();      // url -> loadTimeMs
    this.hookCallCount = 0;
    this.allowlist = new Set(["lodash", "express", "zod", "node:fs", "node:path"]);
  }

  _checkPolicy(specifier) {
    // Bare specifiers (no ./ or ../) are package names
    const isPkg = !specifier.startsWith(".") && !specifier.startsWith("/");
    if (isPkg && !this.allowlist.has(specifier)) {
      throw new Error(`PolicyError: import of '${specifier}' is blocked`);
    }
  }

  async resolve(specifier, parentURL, next) {
    this.hookCallCount++;
    this._checkPolicy(specifier);
    const url = specifier.startsWith(".")
      ? new URL(specifier, parentURL).href
      : "node_modules://" + specifier;
    return { url, format: specifier.endsWith(".ts") ? "ts" : "module" };
  }

  async load(url, context, next) {
    this.hookCallCount++;
    if (this.cache.has(url)) {
      const cached = this.cache.get(url);
      console.log(`[cache HIT] ${url} (${cached.loadTimeMs.toFixed(3)} ms original)`);
      return { format: cached.format, source: cached.source };
    }
    const t0 = performance.now();
    // Simulate fetch + optional TS transform
    const isTS = url.endsWith(".ts") || context.format === "ts";
    const rawSource = `// module: ${url}\nexport const loaded = true;`;
    const source = isTS
      ? `// [transpiled from TS]\n${rawSource}`
      : rawSource;
    // Simulate transform latency
    const transformMs = isTS ? 0.8 + Math.random() * 0.4 : 0.05 + Math.random() * 0.05;
    await new Promise(r => setTimeout(r, transformMs));
    const loadTimeMs = performance.now() - t0;
    this.cache.set(url, { format: "module", source, loadTimeMs });
    this.metrics.set(url, loadTimeMs);
    return { format: "module", source };
  }

  async importModule(specifier, parentURL = "file:///app/") {
    const resolved = await this.resolve(specifier, parentURL, null);
    const loaded = await this.load(resolved.url, { format: resolved.format }, null);
    return { url: resolved.url, source: loaded.source };
  }
}

async function runDemo() {
  const pipeline = new LoaderPipeline();
  const modules = [
    "./utils.mjs", "./utils.mjs",   // second is cache hit
    "lodash", "express",
    "./feature.ts", "./feature.ts", // TS + cache hit
    "react",                         // not in allowlist
  ];

  for (const spec of modules) {
    try {
      const result = await pipeline.importModule(spec);
      const ms = pipeline.metrics.get(result.url);
      console.log(`OK  ${spec.padEnd(20)} ${ms ? ms.toFixed(3) + " ms" : "(cached)"}`);
    } catch (e) {
      console.log(`ERR ${spec.padEnd(20)} ${e.message}`);
    }
  }

  console.log("\n--- Metrics ---");
  for (const [url, ms] of pipeline.metrics) {
    console.log(`  ${url.slice(0, 45).padEnd(45)} ${ms.toFixed(3)} ms`);
  }
  console.log(`Total hook calls: ${pipeline.hookCallCount}`);
}

runDemo();
```

## Common pitfalls

> [!PITFALL]
> **Using `--experimental-loader` in Node 20+.** The `--experimental-loader` flag still works but is deprecated and will be removed. It runs hooks in the *main* thread (or a separate thread depending on version), has different hook ordering semantics, and does not support `initialize`. Always use `module.register()` in a `--import` preload file. The two APIs look similar but are not equivalent — particularly around the `data` channel and thread model.

A second production trap: **mutating `source` with string concatenation instead of an AST transform**. Prepending `import` statements to source strings works for simple cases but breaks when the module uses `"use strict"` directives (which must appear before any other statements) or when the injected import creates a circular dependency. Use a proper parser (acorn, meriyah, or esbuild's transform API) that understands the module graph.

> [!PITFALL]
> **Forgetting that the loader runs in a Worker.** Globals set in the loader worker (e.g., `globalThis.myCache`) are not visible in the main thread. Use the `MessageChannel` passed via `module.register`'s `data` option to communicate. Attempting to read `process._loaderMetrics` in the main thread while setting it in the loader worker will silently give `undefined`.

## What you learned

- The ESM loader pipeline is resolve → load, running in a dedicated off-thread Worker since Node 20.6; `module.register()` is the stable API, `--experimental-loader` is deprecated.
- Loaders chain in reverse registration order; each hook must call `nextResolve`/`nextLoad` or return `{ shortCircuit: true }` to terminate the chain intentionally.
- Real uses: TypeScript on the fly (esbuild in load hook), import maps (redirect in resolve), supply-chain policy (block in resolve), coverage/instrumentation (inject in load), test mocking (redirect in resolve).
- Performance: memoize resolve results, exit early in load for non-owned URLs, and consider an AOT cache + `--build-snapshot` for large codebases to keep startup under 100 ms.
- `MessageChannel` via the `data` option is the only safe way to communicate between the loader worker and the main thread.

## Next steps

You've now seen how to build, embed, and instrument Node at the deepest levels. The next module turns to the other extreme of the security boundary: hardening Node applications against adversarial inputs and supply-chain attacks — a discipline that builds directly on the loader policy enforcement patterns you wrote here.
*/});
