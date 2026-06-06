registerLessonSrc("23-bundling", function () {/*
---
id: 23-bundling
title: "Bundling Node Apps & Source Maps"
minutes: 28
level: advanced
objectives:
  - Explain when and why bundling server-side Node code is worth it
  - Configure esbuild for tree-shaking and minification in a production build
  - Read and apply source maps to translate minified stack traces back to source
---

# Bundling Node Apps & Source Maps

## Why this matters

Bundling is usually thought of as a front-end concern, but server-side bundling has become a first-class practice in 2026: it reduces cold-start times for serverless functions, makes deployments self-contained single files, and enables tree-shaking to eliminate dead code. The flip side is that bundled code is hard to debug without **source maps** — the mechanism that translates a line in your compiled output back to the exact line in your original TypeScript. Getting both right is the difference between a production system you can ship confidently and one you can never diagnose.

## Learning objectives

- Decide **when** bundling server code is worth the complexity.
- Configure **esbuild** for tree-shaking, minification, and source maps.
- Understand the **source map format** and use it to resolve minified stack traces.
- Build a complete **polished project template** with Biome, esbuild, tsx, and CI-ready scripts.

## Why (and when) to bundle server code

For a traditional long-running Node process on a dedicated VM, bundling is optional. You deploy `node_modules/` and run `node src/server.js` — startup cost is paid once.

But the calculus shifts in several scenarios:

| Scenario | Bundling benefit |
|---|---|
| AWS Lambda / Cloudflare Workers | Cold-start time is proportional to file count; one file = fastest |
| Docker image size | Bundle + minify can cut hundreds of MB of `node_modules` |
| npm library publishing | Ship a compact CJS + ESM dual build, not raw source |
| Monorepo with many internal packages | Bundle internal deps to avoid symlink complexity |

> [!NOTE] You do NOT need to bundle node_modules for a normal server
> Use `--packages=external` (esbuild) to leave third-party packages untouched. Only bundle your own source. The exception is serverless, where even npm packages should be bundled-in to minimise file count.

## Tree-shaking

**Tree-shaking** (a.k.a. dead-code elimination) is the process of statically analysing the import graph and removing exports that are never imported anywhere. It only works with ES Modules, because `import` is static and the analyser can see exactly what each module uses.

```js
// utils.ts
export function used()   { return 42; }
export function unused() { return 99; } // never imported anywhere
```

```bash
esbuild src/entry.ts --bundle --tree-shaking=true --outfile=dist/out.js
```

```js
// dist/out.js — unused() is GONE
var used = () => 42;
```

> [!OUTPUT]
> (no output — the bundler just writes dist/out.js)

esbuild tree-shakes automatically in bundle mode. The only requirement: your source must use ES `import`/`export`, not `require()`.

> [!PITFALL] Tree-shaking and side effects
> If a module runs code at the top level (a side effect) — like registering a global, mutating a prototype, or printing to the console — the bundler cannot safely remove it, even if none of its exports are used. Mark side-effect-free packages in `package.json` with `"sideEffects": false` to give bundlers permission to shake them.

## Minification

Minification renames local variables to single characters, removes whitespace, and applies small constant-folding optimisations. For server code it matters less (you're not sending it over a network), but it meaningfully reduces Lambda package size and startup parse time.

```bash
esbuild src/server.ts \
  --bundle \
  --platform=node \
  --packages=external \
  --minify \
  --sourcemap \
  --outfile=dist/server.js
```

`--minify` enables three sub-options: `--minify-syntax` (constant folding), `--minify-whitespace` (remove spaces/newlines), `--minify-identifiers` (rename variables). You can pass them individually if you want partial minification.

## Source maps: debugging minified code

When your production bundle throws an error, the stack trace points to `dist/server.js:1:28473` — meaningless without a source map.

A **source map** is a `.js.map` file (JSON) that records the mapping from every character in the generated output back to a file path, line, and column in the original source. The format is defined in the [Source Map Specification v3](https://sourcemaps.info/spec.html).

```json
// dist/server.js.map (simplified)
{
  "version": 3,
  "sources": ["../src/server.ts", "../src/db.ts"],
  "sourcesContent": ["..."],
  "mappings": "AAAA,SAAS,KAAT,..."
}
```

The `mappings` field uses **Base64 VLQ** encoding — a compact representation of integer deltas. Each segment maps (generatedColumn, sourceIndex, originalLine, originalColumn).

```js
// How Node.js reads source maps at runtime:
// Add this flag and Node resolves stack traces automatically.
// node --enable-source-maps dist/server.js
```

```bash
# With --enable-source-maps, a stack trace like:
#   Error: oops
#     at greet (dist/server.js:1:482)
# becomes:
#   Error: oops
#     at greet (src/server.ts:14:3)
```

> [!OUTPUT]
> Error: oops
>     at greet (src/server.ts:14:3)
>     at main (src/server.ts:22:1)

> [!PRINCIPAL] Source maps in production
> Shipping source maps to production servers (not browsers) is usually the right call: you get readable stack traces in logs without exposing anything sensitive (your server's filesystem is already accessible to whoever deploys to it). For browser-facing apps the tradeoff flips — source maps expose your source to anyone who opens DevTools. Use a source-map upload tool (Sentry, Datadog) to upload maps privately and strip them from the public bundle.

### How the mapping works — a mental model

Think of a source map as a lookup table:

```
Generated position  →  Original position
(line 1, col 482)   →  (src/server.ts, line 14, col 3)
(line 1, col 510)   →  (src/server.ts, line 15, col 1)
```

The VLQ encoding stores these as compact delta-encoded integers so the mapping file stays small even for large bundles. Tools like `source-map` (npm) decode this for you:

```js
// Reading a source map programmatically (real Node code)
import { SourceMapConsumer } from "source-map";
import { readFileSync } from "node:fs";

const rawMap = JSON.parse(readFileSync("dist/server.js.map", "utf8"));

await SourceMapConsumer.with(rawMap, null, consumer => {
  const pos = consumer.originalPositionFor({ line: 1, column: 482 });
  console.log(pos);
  // { source: 'src/server.ts', line: 14, column: 3, name: 'greet' }
});
```

> [!OUTPUT]
> { source: 'src/server.ts', line: 14, column: 3, name: 'greet' }

## Try it yourself

Here is a pure-JavaScript implementation of a **source-map position mapper** — a simplified model of what tools like `source-map` do. Given a table of (generatedLine, generatedCol) → (sourceLine, sourceCol) mappings, look up any generated position and return the original.

```js run
// Simplified source-map position lookup.
// In real source maps this table is Base64 VLQ encoded; here we use plain objects.

function buildSourceMap(entries) {
  // entries: [{ gl, gc, sl, sc, name }]  (generated line/col → source line/col)
  // Index by generatedLine -> sorted array of { gc, sl, sc, name }
  const index = new Map();
  for (const e of entries) {
    if (!index.has(e.gl)) index.set(e.gl, []);
    index.get(e.gl).push(e);
  }
  // sort each line's entries by generated column
  for (const segments of index.values()) {
    segments.sort((a, b) => a.gc - b.gc);
  }
  return index;
}

function originalPositionFor(map, generatedLine, generatedCol) {
  const segments = map.get(generatedLine);
  if (!segments) return null;
  // Binary-search for the largest gc <= generatedCol
  let lo = 0, hi = segments.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].gc <= generatedCol) {
      best = segments[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return null;
  return { sourceLine: best.sl, sourceCol: best.sc, name: best.name };
}

// Imagine esbuild collapsed 3 source files into 1 minified line.
// These mappings record where each identifier landed.
const mappings = [
  { gl: 1, gc: 0,   sl: 1,  sc: 0,  name: 'add' },
  { gl: 1, gc: 30,  sl: 5,  sc: 0,  name: 'multiply' },
  { gl: 1, gc: 80,  sl: 12, sc: 0,  name: 'main' },
  { gl: 1, gc: 150, sl: 18, sc: 4,  name: 'greet' },
  { gl: 2, gc: 0,   sl: 25, sc: 0,  name: 'init' },
];

const sourceMap = buildSourceMap(mappings);

// Simulate resolving a stack-trace position
const cases = [
  { gl: 1, gc: 0 },
  { gl: 1, gc: 55 },
  { gl: 1, gc: 200 },
  { gl: 2, gc: 0 },
  { gl: 3, gc: 0 },
];

for (const { gl, gc } of cases) {
  const orig = originalPositionFor(sourceMap, gl, gc);
  if (orig) {
    console.log(`Generated ${gl}:${gc} → source line ${orig.sourceLine}:${orig.sourceCol} (${orig.name})`);
  } else {
    console.log(`Generated ${gl}:${gc} → no mapping found`);
  }
}
```

## Exercises

### Exercise 1 — round-trip mapper

Extend the source map above to support the **reverse** direction: given a source line and column, find which generated position it maps to.

<details>
<summary>Show solution</summary>

```js run
function buildBidirectionalMap(entries) {
  const toGenerated = new Map(); // "sl:sc" -> { gl, gc, name }
  const toOriginal  = new Map(); // gl -> sorted [{gc, sl, sc, name}]

  for (const e of entries) {
    toGenerated.set(`${e.sl}:${e.sc}`, { gl: e.gl, gc: e.gc, name: e.name });
    if (!toOriginal.has(e.gl)) toOriginal.set(e.gl, []);
    toOriginal.get(e.gl).push(e);
  }
  for (const segs of toOriginal.values()) segs.sort((a, b) => a.gc - b.gc);

  return {
    originalFor(gl, gc) {
      const segs = toOriginal.get(gl);
      if (!segs) return null;
      let lo = 0, hi = segs.length - 1, best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].gc <= gc) { best = segs[mid]; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best ? { sl: best.sl, sc: best.sc, name: best.name } : null;
    },
    generatedFor(sl, sc) {
      return toGenerated.get(`${sl}:${sc}`) || null;
    }
  };
}

const entries = [
  { gl: 1, gc: 0,  sl: 3,  sc: 0,  name: 'greet' },
  { gl: 1, gc: 60, sl: 10, sc: 0,  name: 'main' },
];

const biMap = buildBidirectionalMap(entries);

// Forward: generated → original
const orig = biMap.originalFor(1, 60);
console.log('Original:', orig);   // { sl: 10, sc: 0, name: 'main' }

// Reverse: original → generated
const gen = biMap.generatedFor(3, 0);
console.log('Generated:', gen);   // { gl: 1, gc: 0, name: 'greet' }
```

</details>

### Exercise 2 — compute bundle stats

Write a function that takes a list of source files and their sizes, plus a bundle size, and prints a tree-shaking effectiveness report.

<details>
<summary>Show solution</summary>

```js run
function bundleReport(sources, bundleSize) {
  const totalSource = sources.reduce((s, f) => s + f.size, 0);
  const saved = totalSource - bundleSize;
  const pct = ((saved / totalSource) * 100).toFixed(1);

  console.log('=== Bundle Report ===');
  sources.forEach(f => {
    const bar = '#'.repeat(Math.round(f.size / 1000));
    console.log(`  ${f.name.padEnd(20)} ${(f.size/1024).toFixed(1)} KB  ${bar}`);
  });
  console.log('  ' + '-'.repeat(40));
  console.log(`  ${'Total source'.padEnd(20)} ${(totalSource/1024).toFixed(1)} KB`);
  console.log(`  ${'Bundle output'.padEnd(20)} ${(bundleSize/1024).toFixed(1)} KB`);
  console.log(`  Saved ${(saved/1024).toFixed(1)} KB (${pct}% reduction)`);
}

bundleReport([
  { name: 'server.ts',  size: 12_400 },
  { name: 'db.ts',      size:  8_200 },
  { name: 'auth.ts',    size:  5_600 },
  { name: 'utils.ts',   size:  3_100 },
], 18_700);
```

</details>

## Project

**"Polished Toolchain Repo"** — Set up a project template that a team can clone and immediately be productive: Biome for linting and formatting, esbuild for production bundling, tsx for the dev loop, and CI-ready npm scripts. The tiny linter from the Biome lesson is your starter application.

### Acceptance criteria

1. **Biome configured** — `biome.json` with formatter + linter enabled; `npm run check` runs `biome check src/` and exits non-zero on violations.
2. **esbuild production build** — `npm run build` bundles `src/index.ts` to `dist/index.js` with `--platform=node --packages=external --sourcemap --minify`.
3. **tsx dev loop** — `npm run dev` runs `tsx watch src/index.ts`; file saves trigger an automatic restart with no additional config.
4. **Source maps wired** — `npm run start` runs `node --enable-source-maps dist/index.js` so production stack traces resolve to TypeScript lines.
5. **CI script** — `npm run ci` runs `biome ci src/ && tsc --noEmit && npm run build` in sequence; each step must pass for the whole command to succeed.
6. **Type check separated** — `npm run check:types` runs `tsc --noEmit` independently so type errors are surfaced without blocking a hot-reload cycle.

### Starter — the tiny linter as your `src/index.ts`

```js run
// This is the core logic your project will wrap in a proper TS file.
// In the real project, add types: function lint(source: string): Violation[]

function lint(source) {
  const violations = [];
  source.split('\n').forEach((line, idx) => {
    const stripped = line.replace(/\/\/.*$/, '');
    if (/[^=!<>]={2}[^=]|[^!]!=[^=]/.test(stripped))
      violations.push({ line: idx + 1, rule: 'no-double-equals',
        severity: 'error', message: 'Use === instead of ==' });
    if (/\bvar\s+/.test(stripped))
      violations.push({ line: idx + 1, rule: 'no-var',
        severity: 'error', message: 'Use let/const instead of var' });
    if (/\bconsole\.(log|warn|error)\b/.test(stripped))
      violations.push({ line: idx + 1, rule: 'no-console',
        severity: 'warn', message: 'Remove console statement' });
  });
  return violations;
}

// sample run
const sample = [
  'var greeting = "hello";',
  'if (greeting == null) { console.log(greeting); }',
].join('\n');

const results = lint(sample);
const exitCode = results.some(v => !v.severity || v.severity === 'error') ? 1 : 0;
results.forEach(v => {
  const tag = v.severity === 'warn' ? '[WARN]' : '[ERR] ';
  console.log(`${tag} line ${v.line}: ${v.message}`);
});
console.log(`Exit code: ${exitCode}`);
```

The real `src/index.ts` wraps this function with TypeScript types, reads files from `process.argv`, and calls `process.exit(exitCode)`.

## Common pitfalls

> [!PITFALL] Sourcemap pointing to the wrong location
> If your build tool outputs source maps with `sourceRoot` or relative paths that don't match where the source actually lives on the deploy target, `--enable-source-maps` will silently fall back to the generated position. Always verify with a deliberate throw in dev: build, run, check that the stack trace shows the `.ts` file, not the `.js` file.

Also: minified identifiers in stack traces (`at a (dist/index.js:1:2)`) mean the source map isn't loading. Check that the `# sourceMappingURL=` comment at the bottom of the bundle points to the right `.map` file path.

## What you learned

- Bundling server code pays off for **serverless / Lambda** (cold-start), **Docker** (image size), and self-contained deployments.
- **Tree-shaking** requires static ES `import`/`export`; esbuild does it automatically in bundle mode.
- A **source map** is a JSON lookup table from generated positions back to original source positions; `node --enable-source-maps` resolves them at runtime.
- The source map `mappings` field uses Base64 VLQ delta encoding; tools like `source-map` (npm) decode it for you.
- A polished project wires tsx (dev), esbuild (build), Biome (lint/format), and `tsc --noEmit` (types) into clear, separated npm scripts.

## Next steps

You now have a complete, modern Node.js toolchain. The next module explores **monorepos** — how to manage multiple packages sharing this same toolchain setup in a single repository with tools like Turborepo and npm workspaces.
*/});
