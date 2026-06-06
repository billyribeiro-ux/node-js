registerLessonSrc("05-loaders", function () {/*
---
id: 05-loaders
title: "Module Loaders & module.register"
minutes: 28
level: advanced
objectives:
  - Understand how Node's module loading pipeline works and where hooks plug in
  - Write resolve and load hooks using module.register
  - Apply loaders for real use cases such as TypeScript transpilation and test mocking
---

# Module Loaders & module.register

## Why this matters

Every `import` statement passes through Node's module loading pipeline before any code runs. That pipeline is a series of hooks — and Node exposes them so you can intercept, transform, or redirect any module. This is how tools like `tsx`, `@swc-node/register`, and Vitest's mocking layer work. Understanding loaders means you can build your own TypeScript runner, write deterministic test doubles without a framework, or enforce policies across your whole import graph.

## Learning objectives

- Explain Node's customization hook pipeline and the role of `module.register`.
- Write a **resolve hook** that rewrites specifiers before Node touches the filesystem.
- Write a **load hook** that transforms source code (e.g. strips TypeScript syntax) before execution.
- Reason about the sequencing rules and the off-thread hook model.

## How module loading works

When Node encounters `import "specifier"` it runs through three stages:

```
1. resolve(specifier, context)  → { url }        find the file URL
2. load(url, context)           → { source }      read & transform the source
3. evaluate(source)                               execute the module
```

Each stage is a function you can override with a **customization hook**. Hooks run in a separate worker thread — Node's **hooks thread** — so they don't block the main thread and can themselves `import` dependencies without causing circular deadlocks.

> [!NOTE] Hooks thread isolation
> Because hooks run in their own thread, they cannot share in-memory state with your application directly. They communicate with the main thread via structured-clone-safe messages. This is intentional: a buggy hook cannot corrupt your app's heap.

## module.register — the modern API

Before Node 20.6, hooks were injected via `--experimental-loader=./my-hook.mjs`. That API still works but is deprecated for the newer, stable `module.register` API:

```js
// app.mjs — entry point
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register hooks from a file running in the hooks thread
register("./my-hooks.mjs", {
  parentURL: import.meta.url,
  // Optional data passed to the hook's initialize() export
  data: { rootDir: process.cwd() }
});

// Hooks are active for ALL subsequent imports in this process
import { greet } from "./app-code.mjs";
```

```js
// my-hooks.mjs — runs in the hooks thread
export function initialize(data) {
  // data = { rootDir: "..." } — whatever you passed above
  console.log("Hooks initialised, rootDir:", data.rootDir);
}

export async function resolve(specifier, context, nextResolve) {
  // Transform the specifier before asking Node to resolve it
  if (specifier.startsWith("#mock:")) {
    return { url: `file:///mocks/${specifier.slice(6)}.mjs`, shortCircuit: true };
  }
  // Delegate to the next hook (or Node's default resolver)
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // Transform the source after Node reads the file
  if (url.endsWith(".ts")) {
    const { source } = await nextLoad(url, { ...context, format: "module" });
    const tsSource = typeof source === "string" ? source : Buffer.from(source).toString();
    // Strip type annotations (toy example — real tools use a proper AST)
    const jsSource = tsSource
      .replace(/:\s*\w+(\[\])?(\s*[,)=;{])/g, "$2")
      .replace(/^export type .+$/gm, "");
    return { format: "module", source: jsSource, shortCircuit: true };
  }
  return nextLoad(url, context);
}
```

> [!OUTPUT]
> Hooks initialised, rootDir: /home/user/project

## The resolve hook

The resolve hook receives three arguments and must return `{ url, shortCircuit? }`:

| Argument | Type | Purpose |
|---|---|---|
| `specifier` | string | What was written in the import statement |
| `context.parentURL` | string | The importing file's URL |
| `context.conditions` | string[] | Active conditions (`"import"`, `"node"`, …) |
| `nextResolve` | function | Call to pass control to the next hook or Node's resolver |

**Use cases:** rewriting `~` path aliases, redirecting bare specifiers to CDN URLs in non-Node environments, enforcing import policy (blocking `fs` in certain modules).

```js
// A resolve hook that rewrites "~/..." to the project root
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("~/")) {
    const rootURL = new URL("file:///project/src/");
    const rewritten = new URL(specifier.slice(2), rootURL).href;
    return nextResolve(rewritten, context);
  }
  return nextResolve(specifier, context);
}
```

## The load hook

The load hook receives `(url, context, nextLoad)` and must return `{ format, source, shortCircuit? }`:

| `format` value | Meaning |
|---|---|
| `"module"` | ESM source text |
| `"commonjs"` | CJS source — Node will wrap it |
| `"json"` | JSON (Node parses it) |
| `"builtin"` | Node built-in — cannot supply source |

**Use cases:** transpile TypeScript or JSX, inject code coverage instrumentation, return in-memory stubs for mocking, decrypt encrypted source files.

```js
// A load hook that adds a debug banner to every module
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.format === "module" && typeof result.source === "string") {
    const banner = `console.log("[load] ${url}");\n`;
    return { ...result, source: banner + result.source };
  }
  return result;
}
```

> [!WARNING] Avoid transforming node: builtins
> `nextLoad` on a `node:` URL returns `format: "builtin"` with no source. Attempting to overwrite it throws. Always guard with `if (url.startsWith("node:")) return nextLoad(url, context)` before touching the source.

## Chaining multiple hooks

`module.register` can be called multiple times. Hooks chain in registration order: the first registered hook's `nextResolve` calls the second registered hook's `resolve`, and so on. The last hook in the chain calls Node's built-in resolver.

```js
import { register } from "node:module";
register("./hooks-aliases.mjs",    { parentURL: import.meta.url });
register("./hooks-typescript.mjs", { parentURL: import.meta.url });
// resolve order: aliases → typescript → Node built-in
```

> [!PRINCIPAL] Loaders enable a zero-config developer experience without runtime cost
> Tools like `tsx` and `@swc-node/register` use exactly this pipeline to let you run TypeScript directly with `node --import tsx/esm server.ts`. The transpilation happens once per file (cached by the tool), so hot-path performance is identical to pre-compiled JS. Understanding this means you can build the same DX for your own DSLs, configuration languages, or encrypted source distributions — without touching the Node binary.

## Try it yourself

The resolve hook is pure logic: map a specifier to a URL. Let's build a path-alias resolver in the browser sandbox to understand the mechanics:

```js run
// Simulate a resolve hook that handles "~/" aliases and "#internal" maps.

function makeResolver(aliases) {
  // aliases: { "~/": "/project/src/", "#utils": "/project/src/utils.js" }
  return function resolve(specifier) {
    // 1. Check exact matches first (e.g. "#utils")
    if (aliases[specifier]) return aliases[specifier];

    // 2. Check prefix matches (e.g. "~/")
    for (const [prefix, target] of Object.entries(aliases)) {
      if (prefix.endsWith("/") && specifier.startsWith(prefix)) {
        return target + specifier.slice(prefix.length);
      }
    }

    // 3. No alias — return as-is (Node would continue with its resolver)
    return specifier;
  };
}

const resolve = makeResolver({
  "~/":      "/project/src/",
  "#utils":  "/project/src/utils.js",
  "#config": "/project/config/index.js"
});

console.log(resolve("~/components/Button.js")); // /project/src/components/Button.js
console.log(resolve("~/hooks/useAuth.js"));     // /project/src/hooks/useAuth.js
console.log(resolve("#utils"));                 // /project/src/utils.js
console.log(resolve("#config"));                // /project/config/index.js
console.log(resolve("lodash"));                 // lodash  (unchanged — Node handles it)
console.log(resolve("./local.js"));             // ./local.js  (unchanged)
```

## Exercise: a source-transform hook simulator

A load hook receives source text and must return transformed source text. Build a function that mimics a load hook stripping `export type` declarations (a subset of TypeScript erasing):

<details>
<summary>Show solution</summary>

```js run
// Simulate the "load" hook transform step for TypeScript type erasure.
// This is the pure logic; in a real hook it would be called with actual file contents.

function tsEraseTypes(source) {
  return source
    // Remove: export type Foo = ...
    .replace(/^export type \w+.*?;$/gm, "")
    // Remove: export interface Foo { ... } (single-line)
    .replace(/^export interface \w+\s*\{[^}]*\}$/gm, "")
    // Remove inline type annotations like ": string", ": number[]"
    .replace(/:\s*(string|number|boolean|void|any|unknown|never)(\[\])?\b/g, "")
    // Collapse multiple blank lines left by removed declarations
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const tsSource = `
export type UserId = string;
export interface Config { debug: boolean }

export function greet(name: string): string {
  return "Hello, " + name;
}

export function add(a: number, b: number): number {
  return a + b;
}
`.trim();

const jsSource = tsEraseTypes(tsSource);
console.log("--- Transformed source ---");
console.log(jsSource);
```

In a real load hook you would use a proper parser (`acorn`, `@typescript-eslint/parser`, or SWC's WASM build) instead of regex. The hook shape stays the same; only the transformation logic changes.

</details>

## Project

**Publish a production-ready dual-format (ESM + CJS) utility package with a correct exports map and type declarations.**

You will author a small string utility library (`str-kit`) that ships:
- An ESM build (`dist/index.mjs`)
- A CJS build (`dist/index.cjs`)
- TypeScript declaration files (`dist/index.d.ts`)
- A `package.json` with a correct `"exports"` map, `"imports"` aliases, and `"files"` allowlist

### Acceptance criteria

1. `import { slugify } from "str-kit"` resolves to the ESM build and `require("str-kit").slugify` resolves to the CJS build, using conditional `"exports"`.
2. The `"exports"` map includes a `"types"` condition pointing to `.d.ts` so TypeScript consumers get autocompletion without extra config.
3. An `"imports"` map provides a `#utils` alias used internally — no relative `../` climbing in source files.
4. `"files"` lists only `dist` so source files are never published to npm.
5. `"engines"` declares `"node": ">=20.0.0"`.
6. Running `node --check dist/index.mjs` and `node --check dist/index.cjs` both pass (no syntax errors).

### Starter — pure-logic core

The runnable block below implements the utility functions. Use it as the logic you would compile into `dist/`:

```js run
// Core utility functions for str-kit.
// In a real package: source in src/index.ts, compiled to dist/index.mjs + dist/index.cjs.

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncate(str, maxLen, suffix) {
  const end = suffix !== undefined ? suffix : "...";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - end.length) + end;
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function camelCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toLowerCase());
}

// --- Self-test (acceptance-criteria style) ---
const cases = [
  ["slugify",   slugify("Hello World! 2024"),       "hello-world-2024"],
  ["slugify",   slugify("  Spaced   Out  "),        "spaced-out"],
  ["truncate",  truncate("Long text here", 9),      "Long t..."],
  ["truncate",  truncate("Short", 10),              "Short"],
  ["capitalize",capitalize("hELLO"),                "Hello"],
  ["camelCase", camelCase("my-variable-name"),      "myVariableName"],
  ["camelCase", camelCase("snake_case_string"),     "snakeCaseString"],
];

let passed = 0;
for (const [fn, actual, expected] of cases) {
  const ok = actual === expected;
  console.log((ok ? "PASS" : "FAIL") + " " + fn + ":", JSON.stringify(actual));
  if (ok) passed++;
}
console.log(passed + "/" + cases.length + " tests passed");
```

### What the package.json should look like

```json
{
  "name": "str-kit",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types":   "./dist/index.d.ts",
      "import":  "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs"
    }
  },
  "imports": {
    "#utils": "./src/utils.js"
  },
  "files": ["dist"],
  "engines": { "node": ">=20.0.0" }
}
```

> [!PRINCIPAL] Why "types" must come before "import" and "require"
> TypeScript's module resolver honours the same condition ordering as Node. If `"types"` appears after `"import"`, TypeScript matches `"import"` first and looks for type declarations alongside the `.mjs` file — it won't find them. Put `"types"` first so every consumer gets the declaration file regardless of which runtime condition matched.

## Common pitfalls

> [!PITFALL] Calling nextResolve/nextLoad with the wrong context
> If you modify `context.conditions` in a hook and forget to pass the updated context to `nextResolve`, the next hook in the chain receives stale conditions. Always spread: `nextResolve(specifier, { ...context, conditions: myConditions })`. Similarly, always pass `shortCircuit: true` when you return your own result — omitting it causes Node to also run the next hook and merge results unpredictably.

A second pitfall: registering hooks *after* importing the modules they should affect. `module.register` only applies to imports that happen *after* the call. Always call `register` at the very top of your entry-point file before any application imports.

## What you learned

- Node's module pipeline has three hook points: `resolve`, `load`, and `initialize`; hooks run in an isolated worker thread via `module.register`.
- A **resolve hook** rewrites specifiers before the filesystem is consulted; a **load hook** transforms source before execution.
- Multiple `module.register` calls chain hooks in registration order, each calling `next*` to delegate down the chain.
- Real tools (`tsx`, Vitest) use this pipeline to provide TypeScript support and test mocking with zero compilation step.
- The dual-package project requires correct condition ordering in `"exports"` (`"types"` before `"import"`) and an `"imports"` map for internal aliases.

## Next steps

You have now mastered the entire Node module system — from `require` vs `import` to conditional exports, dual packages, and loader hooks. The next module dives into **Node's event loop and async primitives**, the engine that makes all of this non-blocking I/O possible.
*/});
