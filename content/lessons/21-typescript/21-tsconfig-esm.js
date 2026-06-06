registerLessonSrc("21-tsconfig-esm", function () {/*
---
id: 21-tsconfig-esm
title: "tsconfig, ESM & Project Setup"
minutes: 24
level: advanced
objectives:
  - Understand the most important tsconfig.json options and why they matter
  - Configure TypeScript for ESM output with NodeNext module resolution
  - Avoid common pitfalls when combining TypeScript with ES Modules
---

# tsconfig, ESM & Project Setup

## Why this matters

Every TypeScript project begins with a `tsconfig.json`. Get it wrong and you'll spend hours chasing phantom import errors, broken declaration files, or code that works in your editor but fails at runtime. Configuring TypeScript for modern Node — ESM output, `NodeNext` module resolution, strict mode — is a rite of passage that unlocks the full benefits of the type system.

## Learning objectives

- Read and write the key tsconfig options with confidence.
- Configure TypeScript to emit ESM-compatible JavaScript for Node 24.
- Understand `.js` extensions in imports, project references, and path mapping.
- Validate a tsconfig-like configuration object in pure JavaScript.

## The tsconfig.json anatomy

Running `tsc --init` generates a `tsconfig.json`. The real ones that matter in production are far smaller than the commented megafile `--init` produces. Here is a clean, production-ready starting point for a Node ESM project:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Let's unpack every meaningful option.

## Key compiler options explained

### `target`

`target` controls which JavaScript version `tsc` emits. For Node 24 LTS, `"ES2022"` is the right choice — it enables native `async`/`await`, optional chaining, nullish coalescing, top-level `await`, class fields, and `Error.cause`. There is no need to down-compile for Node 24.

```json
"target": "ES2022"
```

### `module` and `moduleResolution`

These two work as a pair and must be consistent. `"module": "NodeNext"` tells the compiler that the output format matches Node's native ESM behaviour. `"moduleResolution": "NodeNext"` tells the compiler how to *resolve* imports — it mirrors what Node itself does at runtime, including the `exports` map in `package.json`.

```json
"module": "NodeNext",
"moduleResolution": "NodeNext"
```

> [!WARNING] Never mix `module: ESNext` with `moduleResolution: NodeNext`
> `"module": "ESNext"` with `"moduleResolution": "Bundler"` is the right pair for build-tool projects (Vite, webpack). For Node without a bundler, always use `"NodeNext"` for both. Mixing them causes confusing resolution errors at runtime.

### `strict`

`strict: true` enables a whole family of checks as a single flag: `strictNullChecks`, `strictFunctionTypes`, `strictPropertyInitialization`, `noImplicitAny`, and more. Always enable it. Disabling individual sub-checks is a code smell.

```json
"strict": true
```

> [!PRINCIPAL] Ship with strict: true from day one
> Retrofitting `strict` onto an existing codebase is painful — hundreds of `any` casts, missing null checks, and implicit property accesses surface at once. Starting strict means the compiler is your collaborator, not your adversary. Teams that add it late often enable checks one by one over months. Save future-you the pain.

### `outDir` and `rootDir`

These define where source lives and where compiled output goes. Always separate them. The mirror structure in `dist/` makes it predictable to map back to sources.

```json
"outDir": "./dist",
"rootDir": "./src"
```

### `declaration` and `declarationMap`

`declaration: true` emits `.d.ts` type declaration files alongside the JavaScript — essential if your project is a library (covered in depth in the next lesson). `declarationMap: true` emits `.d.ts.map` files so editors can jump-to-source through the declarations.

### `sourceMap`

Emits `.js.map` files so debuggers and stack traces point to your original TypeScript source instead of the compiled JavaScript in `dist/`.

### `esModuleInterop`

Allows `import something from "some-cjs-package"` without requiring the verbose `import * as something from "..."` syntax for CommonJS default exports. Enabled by default in most modern templates.

### `skipLibCheck`

Skips type-checking `.d.ts` files from `node_modules`. This dramatically speeds up compilation and avoids noise from badly-typed third-party packages. Safe to enable.

## The `.js` extension rule — TypeScript's biggest gotcha

When you use `"module": "NodeNext"`, TypeScript enforces that your import paths look exactly like they will at runtime after compilation. Node resolves `.js` files, not `.ts` files. So you write `.js` extensions in your TypeScript source files, even though the files you are importing *are* `.ts`:

```ts
// src/server.ts
import { createRouter } from "./router.js"; // <- .js, NOT .ts

export function start() { ... }
```

At compile time, `tsc` understands that `./router.js` means `./router.ts` in the source. At runtime, `dist/server.js` imports `dist/router.js`. The extension survives and everything is correct.

> [!PITFALL] Writing .ts extensions in imports
> `import { x } from "./utils.ts"` will fail at runtime because Node looks for `.ts` and cannot execute TypeScript directly (without a loader). Write `.js`. Editors and `tsc` handle the source-to-file mapping for you. This surprises every developer exactly once.

## Project references

For monorepos or large projects split into multiple packages, TypeScript offers **project references** — a way to declare that one TS project depends on another and to build them incrementally.

```json
// packages/api/tsconfig.json
{
  "compilerOptions": { ... },
  "references": [
    { "path": "../shared" }
  ]
}
```

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,  // required for references
    ...
  }
}
```

Build with `tsc --build` (or `tsc -b`) instead of plain `tsc`. TypeScript only recompiles packages whose sources have changed — a massive speed win in large repos.

> [!NOTE] Project references are overkill for small projects
> A single `tsconfig.json` at the repo root is fine for an application. Use project references when you have multiple publishable packages that depend on each other, or when build times become a real problem.

## A complete project layout

```
my-api/
  src/
    index.ts
    router.ts
    db/
      client.ts
  dist/           <- tsc output (git-ignored)
  tsconfig.json
  package.json
```

```json
// package.json
{
  "name": "my-api",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  }
}
```

> [!OUTPUT]
> $ tsc
> $ node dist/index.js
> API listening on port 3000

## Try it yourself

The following runnable block implements a pure-JavaScript `validateTsConfig` function that checks a configuration object for common misconfigurations — the same logic a real tsconfig linter might apply:

```js run
// Pure-JS tsconfig validator — demonstrates object validation patterns

function validateTsConfig(cfg) {
  const errors = [];
  const opts = cfg.compilerOptions || {};

  // module + moduleResolution must match for Node-native ESM
  const nodeModules   = ["NodeNext", "Node16"];
  const bundlerMods   = ["ESNext", "ES2022", "ES2020"];

  if (nodeModules.includes(opts.module)) {
    if (!nodeModules.includes(opts.moduleResolution)) {
      errors.push(
        `module "${opts.module}" requires moduleResolution "NodeNext" or "Node16", ` +
        `got "${opts.moduleResolution}"`
      );
    }
  }

  if (bundlerMods.includes(opts.module) && opts.moduleResolution === "NodeNext") {
    errors.push(
      `module "${opts.module}" + moduleResolution "NodeNext" is inconsistent — ` +
      `use "Bundler" for build-tool projects`
    );
  }

  // strict should be on
  if (opts.strict === false) {
    errors.push("strict: false disables critical safety checks — enable it");
  }

  // outDir should differ from rootDir
  if (opts.outDir && opts.rootDir && opts.outDir === opts.rootDir) {
    errors.push(`outDir and rootDir are the same ("${opts.outDir}") — they must differ`);
  }

  // composite projects need declaration
  if (opts.composite && !opts.declaration) {
    errors.push("composite: true requires declaration: true");
  }

  // target sanity
  const knownTargets = ["ES2019","ES2020","ES2021","ES2022","ES2023","ESNext"];
  if (opts.target && !knownTargets.includes(opts.target)) {
    errors.push(`Unusual target "${opts.target}" — for Node 24 use "ES2022" or later`);
  }

  return errors;
}

// --- Test cases ---

const valid = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    outDir: "./dist",
    rootDir: "./src",
    strict: true,
  }
};

const bad1 = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "Bundler", // mismatch
    strict: false,               // disabled
    outDir: "./src",
    rootDir: "./src",            // same as outDir
  }
};

const bad2 = {
  compilerOptions: {
    target: "ES5",               // unusual for Node 24
    module: "ESNext",
    moduleResolution: "NodeNext", // inconsistent pair
    composite: true,
    declaration: false,           // missing for composite
  }
};

function report(label, cfg) {
  const errs = validateTsConfig(cfg);
  console.log(`\n[${label}]`);
  if (errs.length === 0) {
    console.log("  OK — no issues found");
  } else {
    errs.forEach((e) => console.log("  ERROR:", e));
  }
}

report("valid config", valid);
report("bad config 1", bad1);
report("bad config 2", bad2);
```

## Exercise: add path alias validation

Extend `validateTsConfig` to check that if `paths` is defined, `baseUrl` is also defined (TypeScript requires `baseUrl` when using `paths` before TypeScript 5.0, and it's still common practice).

<details>
<summary>Show solution</summary>

```js run
function validateTsConfig(cfg) {
  const errors = [];
  const opts = cfg.compilerOptions || {};

  if (opts.paths && !opts.baseUrl) {
    errors.push(
      '"paths" is defined but "baseUrl" is missing — ' +
      'TypeScript requires baseUrl when using path aliases in most configs'
    );
  }

  // Check at least one path alias resolves to an array
  if (opts.paths) {
    for (const [alias, targets] of Object.entries(opts.paths)) {
      if (!Array.isArray(targets) || targets.length === 0) {
        errors.push(`paths["${alias}"] must be a non-empty array of strings`);
      }
    }
  }

  return errors;
}

const withPaths = {
  compilerOptions: {
    paths: {
      "@shared/*": ["./packages/shared/src/*"],
      "@utils":    [] // empty — bad
    }
    // baseUrl missing — bad
  }
};

const withPathsOk = {
  compilerOptions: {
    baseUrl: ".",
    paths: {
      "@shared/*": ["./packages/shared/src/*"]
    }
  }
};

function report(label, cfg) {
  const errs = validateTsConfig(cfg);
  console.log(`[${label}]`);
  if (errs.length === 0) {
    console.log("  OK");
  } else {
    errs.forEach((e) => console.log("  ERROR:", e));
  }
}

report("missing baseUrl", withPaths);
report("correct paths",   withPathsOk);
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting "type": "module" in package.json
> Setting `"module": "NodeNext"` in tsconfig tells TypeScript to emit ESM-style code. But Node decides how to *interpret* `.js` files based on the nearest `package.json`. Without `"type": "module"`, Node treats `.js` as CommonJS and chokes on `export` statements. Both settings are required.

> [!PITFALL] Editing files in dist/ by hand
> `dist/` is compiler output — it will be overwritten every time you run `tsc`. Put all edits in `src/`. Add `dist/` to `.gitignore`.

## What you learned

- `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` is the correct pair for Node ESM without a bundler.
- `strict: true` must be on from day one; retrofitting it is painful.
- Write `.js` extensions in TypeScript import paths — they survive compilation and Node resolves them correctly.
- `declaration: true` emits `.d.ts` files; `declarationMap` links them back to source.
- Project references enable incremental, fast builds in monorepos.

## Next steps

Your tsconfig is dialled in. The next lesson covers running TypeScript *directly* — without a compile step — using Node's native type-stripping and the `tsx` tool.
*/});
