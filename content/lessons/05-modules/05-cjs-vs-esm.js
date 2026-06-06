registerLessonSrc("05-cjs-vs-esm", function () {/*
---
id: 05-cjs-vs-esm
title: CommonJS vs ES Modules
minutes: 26
level: intermediate
objectives:
  - Understand the two module systems and their history
  - Use import/export fluently and know how require differs
  - Choose the right system and interoperate between them
---

# CommonJS vs ES Modules

## Why this matters

Every non-trivial Node program is split across multiple files that share code. *How* they share it — the module system — is something you'll touch in literally every project. Node has two systems: the original **CommonJS** (`require`) and the standard **ES Modules** (`import`). Knowing both, and how they interoperate, prevents a whole genre of confusing "cannot use import statement" and "require is not defined" errors.

## Learning objectives

- Explain **CommonJS (CJS)** and **ES Modules (ESM)** and why both exist.
- Write `import`/`export` fluently and contrast it with `require`/`module.exports`.
- Pick the right system and interoperate when you must mix them.

## A tiny bit of history

JavaScript had no built-in module system for its first 15 years. Node filled the gap in 2009 with **CommonJS**: the `require()` function and `module.exports` object. It worked great on the server.

Years later, JavaScript got an *official* standard module system — **ES Modules** — with `import` and `export` keywords. It works in browsers *and* Node. Today ESM is the recommended choice for new projects, but billions of lines of CommonJS exist, so you must be fluent in both.

| | CommonJS (CJS) | ES Modules (ESM) |
|---|---|---|
| Import | `const x = require("./x")` | `import x from "./x.js"` |
| Export | `module.exports = ...` | `export ... ` / `export default ...` |
| Loading | synchronous | asynchronous |
| File hint | `.cjs`, or `"type":"commonjs"` | `.mjs`, or `"type":"module"` |
| `__dirname` | available | use `import.meta.dirname` |
| Top-level await | no | yes |

## ES Modules: the modern default

You opt into ESM by either naming files `.mjs` or — more commonly — setting `"type": "module"` in `package.json`. Then you use `import`/`export`:

```js
// math.mjs — exporting
export function add(a, b) { return a + b; }      // named export
export const PI = 3.14159;                        // named export
export default function subtract(a, b) {          // default export (one per file)
  return a - b;
}
```

```js
// app.mjs — importing
import subtract, { add, PI } from "./math.mjs";   // default + named together
import * as math from "./math.mjs";               // everything as a namespace

console.log(add(2, 3));        // 5
console.log(subtract(5, 2));   // 3
console.log(math.PI);          // 3.14159
```

> [!NOTE] ESM import paths usually need the file extension
> In ESM, relative imports typically include the extension (`"./math.mjs"`, `"./util.js"`). CommonJS let you omit it (`require("./math")`); ESM is stricter, matching browser behaviour.

The `export`/`import` mechanics are pure JavaScript and run in this browser sandbox — let's practise the *shape* of named vs default exports with objects standing in for modules:

```js run
// Simulate a module as an object with named + default "exports"
const mathModule = {
  add: (a, b) => a + b,
  PI: 3.14159,
  default: (a, b) => a - b   // the "default export"
};

// "import subtract, { add, PI }"
const subtract = mathModule.default;
const { add, PI } = mathModule;

console.log(add(2, 3));      // 5
console.log(subtract(5, 2)); // 3
console.log(PI);             // 3.14159
```

## CommonJS: the original

You'll still read and write CJS constantly (config files, older packages, scripts). The mechanics:

```js
// math.cjs — exporting
function add(a, b) { return a + b; }
const PI = 3.14159;

module.exports = { add, PI };       // export an object
// or: module.exports = add;        // export a single thing
// or: exports.add = add;           // attach to the exports object
```

```js
// app.cjs — importing
const { add, PI } = require("./math.cjs");
const math = require("./math.cjs"); // the whole object

console.log(add(2, 3), PI);
```

> [!PITFALL] exports vs module.exports
> `exports` is just a *reference* to `module.exports`. Reassigning `exports = something` **breaks** that link and exports nothing. Always assign to `module.exports = ...` when you want to replace the whole export, and use `exports.name = ...` only to add properties. When in doubt, use `module.exports`.

## The big behavioural differences

These differences cause real bugs, so internalise them:

**1. Synchronous vs asynchronous.** `require()` runs synchronously — it stops and loads the file right there. `import` is asynchronous and statically analysed *before* the module runs. That's why `import` statements must be at the top level, not inside an `if`.

**2. Static vs dynamic.** ESM imports are "static" — the engine knows all imports before executing a line. This enables tooling like tree-shaking (dead-code elimination). For *conditional* loading in ESM, use dynamic `import()`, which returns a promise:

```js run
// Dynamic import returns a promise (works in ESM and even the browser).
// Here we simulate it; in real Node it's: const mod = await import("./x.mjs");
function fakeDynamicImport(name) {
  return Promise.resolve({ default: () => "loaded " + name });
}

async function maybeLoad(condition) {
  if (condition) {
    const mod = await fakeDynamicImport("heavy-feature");
    console.log(mod.default());
  } else {
    console.log("skipped loading the heavy feature");
  }
}
maybeLoad(true);
maybeLoad(false);
```

**3. `this` and globals.** In CJS, top-level `this` is `module.exports`; `__dirname` and `__filename` are available. In ESM, top-level `this` is `undefined`; use `import.meta.dirname` and `import.meta.filename` (modern Node) instead.

```js
// ESM equivalents of __dirname / __filename:
console.log(import.meta.dirname);   // the folder this module is in
console.log(import.meta.filename);  // this module's full path
console.log(import.meta.url);       // file:// URL of this module
```

## Interoperating between the two

You can use CJS packages from ESM easily — `import` a CommonJS module and its `module.exports` becomes the default import:

```js
// from an ESM file, importing a CommonJS package:
import _ from "lodash";          // lodash is CJS; this just works
import { readFile } from "node:fs/promises"; // Node core offers named ESM exports
```

The reverse — using ESM from CJS — can't use `require()` (ESM is async). You use dynamic `import()`:

```js
// from a CommonJS file, loading an ESM-only package:
async function main() {
  const { default: chalk } = await import("chalk"); // chalk is ESM-only now
  console.log(chalk.green("works from CJS via dynamic import"));
}
main();
```

> [!PRINCIPAL] The direction of the future
> The ecosystem is steadily moving to **ESM-first**: it's the standard, it works everywhere (browsers, Deno, Bun, edge), and it enables better tooling. For new projects, set `"type": "module"` and write ESM. Understand CJS because you'll consume it for years — but author ESM. Modern Node even lets ESM `require()` synchronous ESM graphs in newer versions, steadily smoothing the last rough edges.

### Exercise: design a module's public API

Imagine a `cache` module. Decide what to export, then model it as an object (as if it were the module's exports) and use it.

```js run
// Build the "module"
function createCache() {
  const store = new Map();
  return {
    get: (k) => store.get(k),
    set: (k, v) => { store.set(k, v); return v; },
    has: (k) => store.has(k),
    get size() { return store.size; }
  };
}

// "export default createCache" then "import createCache from './cache.mjs'"
const cache = createCache();
cache.set("user:1", { name: "Ada" });
console.log(cache.get("user:1")); // { name: "Ada" }
console.log(cache.has("user:2")); // false
console.log(cache.size);          // 1
```

<details>
<summary>What would the real files look like?</summary>

```js
// cache.mjs
export default function createCache() { ...the code above... }

// app.mjs
import createCache from "./cache.mjs";
const cache = createCache();
```

A factory function exported as `default` is an extremely common, clean module shape.
</details>

## What you learned

- Node has two module systems: **CommonJS** (`require`/`module.exports`, synchronous) and **ES Modules** (`import`/`export`, standard, asynchronous, static).
- Opt into ESM with `"type": "module"` or `.mjs`; prefer it for new projects.
- ESM enables tree-shaking, top-level await, and `import.meta`; use dynamic `import()` for conditional loading.
- You can import CJS from ESM directly, and load ESM from CJS via dynamic `import()`.

## Next steps

Now that you can split code into modules, let's formalise how a project *declares* itself and its dependencies: the `package.json` file, with its powerful `exports` and `imports` maps.
*/});
