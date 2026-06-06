registerLessonSrc("05-package-json", function () {/*
---
id: 05-package-json
title: "package.json, exports & imports Maps"
minutes: 24
level: intermediate
objectives:
  - Understand the key package.json fields that govern how a package is loaded
  - Use the "exports" field to create conditional and subpath exports
  - Use the "imports" field for internal path aliases
---

# package.json, exports & imports Maps

## Why this matters

`package.json` is the control panel for every Node package. It decides which entry point is used, what files ship to npm, what conditions (`import` vs `require`, `browser` vs `node`) toggle different builds, and how internal paths resolve. Getting it right is the difference between a package that just works everywhere and one that silently loads the wrong build and puzzles users for hours.

## Learning objectives

- Read and write the most important `package.json` fields (`type`, `main`, `module`, `exports`, `imports`, `files`, `engines`).
- Build a conditional exports map that serves different files for ESM vs CJS consumers.
- Set up `"imports"` for `#internal` path aliases that work without a bundler.

## The core fields

### type

```json
{ "type": "module" }
```

`"type": "module"` tells Node that every `.js` file in the package is ESM. Without it (or with `"type": "commonjs"`) `.js` is treated as CJS. `.mjs` and `.cjs` extensions override this per-file and always mean ESM and CJS respectively.

> [!NOTE] Pick a side for new packages
> Choose `"type": "module"` for ESM-first packages. Use explicit `.cjs` extension for any compatibility shim you must keep in CommonJS. Mixing without intention is the root cause of most module system headaches.

### main and module

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs"
}
```

`"main"` is the CJS entry point — used by `require()` and by old bundlers. `"module"` is a *non-standard* field introduced by bundlers (Rollup, Webpack) to point at the ESM build. Node itself never reads `"module"`. This approach is legacy — the modern replacement is `"exports"`.

### exports — the modern way

`"exports"` replaced `"main"` as the authoritative entry point map. It can be a single path or a nested object with **conditions**:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs"
    }
  }
}
```

When a consumer writes `import pkg from "my-pkg"` Node reads the `"import"` condition; `require("my-pkg")` reads `"require"`. The `"default"` condition is a fallback when no other condition matches — always put it last.

> [!WARNING] "exports" is strict
> Once `"exports"` is present, it is the *only* way into your package — Node will block any import path not listed, even if the file physically exists. This is a feature (clean API surface) but surprises people who relied on deep imports like `require("lodash/chunk")`.

### Subpath exports

You can expose multiple named entry points:

```json
{
  "exports": {
    ".": "./dist/index.mjs",
    "./utils": "./dist/utils.mjs",
    "./package.json": "./package.json"
  }
}
```

A consumer can now do `import { helper } from "my-pkg/utils"`. Notice `"./package.json"` is explicitly listed — that's a common pattern because tools need to read it.

Subpaths also accept conditions:

```json
{
  "exports": {
    "./utils": {
      "import": "./dist/utils.mjs",
      "require": "./dist/utils.cjs"
    }
  }
}
```

> [!PRINCIPAL] Conditions are evaluated in order, first match wins
> The order of keys inside a condition object matters. Node evaluates them top-to-bottom and takes the first matching condition. Always order from most specific to least specific: `"types"` before `"import"` before `"default"`. Getting the order wrong means the wrong file is silently loaded — no error, wrong build.

### Custom conditions

Beyond `"import"` and `"require"`, you can define custom conditions like `"browser"`, `"worker"`, or `"deno"`. Activate them with `--conditions` on the CLI, or they are used by bundlers that declare them:

```json
{
  "exports": {
    ".": {
      "browser": "./dist/browser.mjs",
      "import": "./dist/node.mjs",
      "require": "./dist/node.cjs"
    }
  }
}
```

### imports — internal path aliases

`"imports"` lets you define package-private aliases that start with `#`. They are *only* usable from inside the same package and invisible to consumers:

```json
{
  "imports": {
    "#config": "./src/config.js",
    "#utils": {
      "import": "./src/utils.mjs",
      "require": "./src/utils.cjs"
    }
  }
}
```

Then anywhere inside your package:

```js
import { loadConfig } from "#config";
```

No more `../../..` path climbing. No bundler needed — Node resolves `#` imports natively.

> [!PITFALL] # aliases only work inside the same package
> A consumer importing `"my-pkg/#config"` will get `ERR_PACKAGE_IMPORT_NOT_DEFINED`. The `#` prefix is intentionally reserved for private, intra-package paths. Use `"exports"` for public surfaces.

### files and engines

```json
{
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20.0.0" }
}
```

`"files"` is an allowlist of what gets published to npm. Everything *not* listed (tests, source TypeScript, config files) stays off the registry. `"engines"` documents — but does not enforce by default — which Node versions your package supports.

## How the resolver picks a condition

Node walks the condition object keys in insertion order and picks the first condition that is active for the current context. The active conditions for a `require()` call are `["require", "default"]`; for `import` they are `["import", "default"]` (plus `"node"` and any custom conditions). Here is a pure-JS simulation of that logic:

## Try it yourself

The resolver algorithm is simple but easy to get wrong. Let's build it:

```js run
// Resolve an "exports" map for a given subpath and set of active conditions.
// Returns the file path that Node would use, or null if not found.

function resolveExports(exportsMap, subpath, conditions) {
  const entry = exportsMap[subpath];
  if (!entry) return null;

  // If the entry is a plain string, it matches unconditionally.
  if (typeof entry === "string") return entry;

  // Walk conditions in the ORDER they appear in the object (insertion order).
  for (const key of Object.keys(entry)) {
    if (conditions.includes(key)) {
      const target = entry[key];
      // Recurse — a condition can point to another condition object.
      if (typeof target === "string") return target;
      if (typeof target === "object" && target !== null) {
        const nested = resolveFromObject(target, conditions);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function resolveFromObject(obj, conditions) {
  for (const key of Object.keys(obj)) {
    if (conditions.includes(key)) {
      const v = obj[key];
      if (typeof v === "string") return v;
      if (typeof v === "object" && v !== null) {
        const r = resolveFromObject(v, conditions);
        if (r) return r;
      }
    }
  }
  return null;
}

// ---- demo ----
const exportsMap = {
  ".": {
    "import":  "./dist/index.mjs",
    "require": "./dist/index.cjs",
    "default": "./dist/index.cjs"
  },
  "./utils": {
    "import":  "./dist/utils.mjs",
    "require": "./dist/utils.cjs"
  },
  "./package.json": "./package.json"
};

const esmConditions = ["import", "node", "default"];
const cjsConditions = ["require", "node", "default"];

console.log(resolveExports(exportsMap, ".",             esmConditions)); // ./dist/index.mjs
console.log(resolveExports(exportsMap, ".",             cjsConditions)); // ./dist/index.cjs
console.log(resolveExports(exportsMap, "./utils",       esmConditions)); // ./dist/utils.mjs
console.log(resolveExports(exportsMap, "./package.json",esmConditions)); // ./package.json
console.log(resolveExports(exportsMap, "./secret",      esmConditions)); // null — blocked
```

## Exercise: add a browser condition

The exports map below only handles `import`/`require`. Extend `resolveExports` to also resolve a `"browser"` condition when it is present.

<details>
<summary>Show solution</summary>

```js run
function resolveFromObject(obj, conditions) {
  for (const key of Object.keys(obj)) {
    if (conditions.includes(key)) {
      const v = obj[key];
      if (typeof v === "string") return v;
      if (typeof v === "object" && v !== null) {
        const r = resolveFromObject(v, conditions);
        if (r) return r;
      }
    }
  }
  return null;
}

function resolveExports(exportsMap, subpath, conditions) {
  const entry = exportsMap[subpath];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return resolveFromObject(entry, conditions);
}

const exportsMap = {
  ".": {
    "browser": "./dist/browser.mjs",
    "import":  "./dist/index.mjs",
    "require": "./dist/index.cjs",
    "default": "./dist/index.cjs"
  }
};

// Browser bundler activates "browser" + "import"
const browserConditions = ["browser", "import", "default"];
// Regular Node ESM
const nodeConditions    = ["import", "node", "default"];

console.log(resolveExports(exportsMap, ".", browserConditions)); // ./dist/browser.mjs
console.log(resolveExports(exportsMap, ".", nodeConditions));    // ./dist/index.mjs
```

Because `"browser"` is listed before `"import"` in the map, a bundler that injects the browser condition gets the right file automatically.

</details>

## Common pitfalls

> [!PITFALL] Forgetting to list subpaths in "exports" breaks consumers
> If you add `"exports"` to an existing package but don't list every subpath that consumers already use (e.g. `"./helpers"`, `"./package.json"`), those imports suddenly throw `ERR_PACKAGE_PATH_NOT_EXPORTED` — a breaking change even on a patch release. Audit deep imports before adding `"exports"`.

Another frequent mistake: putting `"default"` *before* `"import"` or `"require"` in the conditions object. Since Node takes the first match, `"default"` would always win and the specific conditions would be unreachable.

## What you learned

- `"type": "module"` makes `.js` files ESM; `"main"` is the legacy entry point; `"exports"` is the modern authoritative map.
- Conditional exports serve different files for `import` vs `require` (and `browser`, `worker`, etc.) — condition key order determines priority.
- Subpath exports expose named entry points; paths not in `"exports"` are blocked.
- `"imports"` provides `#alias` shortcuts for internal cross-file references without bundlers.
- `"files"` controls what is published; `"engines"` documents version requirements.

## Next steps

Now that you understand the exports map, the next lesson explores what happens when you ship *both* ESM and CJS builds together — the **dual package** pattern — along with the hazards that come with it and how `import.meta` gives ESM its own equivalent of `__dirname`.
*/});
