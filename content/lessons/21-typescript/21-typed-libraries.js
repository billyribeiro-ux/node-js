registerLessonSrc("21-typed-libraries", function () {/*
---
id: 21-typed-libraries
title: "Building Typed Libraries (.d.ts)"
minutes: 28
level: advanced
objectives:
  - Understand what declaration files are and how TypeScript emits them
  - Configure package.json to expose types correctly to consumers
  - Implement a type-safe Result/Either pattern as a library primitive
---

# Building Typed Libraries (.d.ts)

## Why this matters

Every package you install from npm that has great type support ships a `.d.ts` file alongside its JavaScript. When you build a library — whether for internal use at your company or for the public npm registry — declaration files are what give your consumers autocomplete, parameter hints, and compile-time safety without ever seeing your source TypeScript. Getting this right is the difference between a library people love and one they paper over with `any`.

## Learning objectives

- Understand what `.d.ts` declaration files are and how `tsc` emits them.
- Configure `tsconfig.json` for clean library output.
- Wire up `"types"` and `"exports"` in `package.json` correctly.
- Know when to use `@types` packages and when to write your own declarations.
- Convert a JavaScript module into a fully-typed, declaration-emitting library.

## What is a declaration file?

A `.d.ts` file is a pure-type description of a JavaScript module. It contains no runtime code — only types, interfaces, and function signatures. TypeScript's compiler reads `.d.ts` files to understand the shape of compiled JavaScript without needing the original source.

```ts
// dist/math.d.ts  — emitted automatically by tsc when declaration: true
export declare function add(a: number, b: number): number;
export declare function subtract(a: number, b: number): number;
export declare const PI: number;
```

When a consumer does `import { add } from "my-math-lib"`, TypeScript reads `dist/math.d.ts` to know what `add` accepts and returns — all without looking at the actual `dist/math.js`.

## tsconfig for a library

A library needs slightly different tsconfig settings than an application:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

The critical additions over an application config:

- `"declaration": true` — emit `.d.ts` files for every `.ts` source file.
- `"declarationMap": true` — emit `.d.ts.map` files that link declarations back to source, so "Go to definition" in editors jumps to your `.ts` source, not the generated `.d.ts`.

> [!OUTPUT]
> $ tsc
> dist/
>   index.js
>   index.d.ts
>   index.d.ts.map
>   index.js.map
>   result.js
>   result.d.ts
>   result.d.ts.map

## Wiring up package.json

A well-formed library `package.json` for a dual-purpose (Node + bundler) package:

```json
{
  "name": "@myorg/result",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

Key fields explained:

- `"types"` — the top-level fallback for older TypeScript/tooling that does not read `exports`.
- `"exports"."."."types"` — the modern way; must appear **before** `"default"` in each condition or TypeScript will miss it.
- `"files": ["dist"]` — only publish the `dist/` folder; never ship `src/` or `node_modules/`.
- `"prepublishOnly"` — guarantees `dist/` is fresh before every `npm publish`.

> [!PITFALL] Putting "types" after "default" in exports conditions
> TypeScript resolves the first matching condition. If `"default"` appears before `"types"` in an export condition, TypeScript may use the wrong resolution and your types won't be found. Always put `"types"` first in each condition block.

> [!PRINCIPAL] Ship both ESM and CJS only if you must
> Dual-format publishing (`.js` + `.cjs`) adds build complexity. If your library targets only Node 18+ applications and modern bundlers, ESM-only is simpler and correct. Add CJS only when you know consumers run in CJS environments (e.g., Jest without `--experimental-vm-modules`, older config tooling).

## Exporting types explicitly

Type-only exports let consumers import your types without bringing in any runtime code:

```ts
// src/types.ts
export interface ResultOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ResultErr<E = Error> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = Error> = ResultOk<T> | ResultErr<E>;
```

```ts
// Consumer code
import type { Result } from "@myorg/result";

async function fetchUser(id: number): Promise<Result<User>> {
  ...
}
```

The `import type` keyword is stripped entirely at compile time — zero runtime cost, but full compile-time safety.

## The @types ecosystem

For JavaScript packages that don't ship their own types, the community publishes them under the `@types` org on npm:

```bash
npm install --save-dev @types/node      # Node.js built-ins
npm install --save-dev @types/express   # Express framework
```

These are community-maintained declaration files — nothing more. When a package ships its own `.d.ts` files (like most modern packages), you don't need a separate `@types` package.

You can write your own declaration file for an untyped package by creating a `.d.ts` file in your project:

```ts
// types/untyped-pkg.d.ts
declare module "untyped-pkg" {
  export function doThing(input: string): number;
  export const VERSION: string;
}
```

Add `"typeRoots": ["./types", "./node_modules/@types"]` to tsconfig's `compilerOptions` to pick it up.

## Declaration maps in practice

With `declarationMap: true`, when a consumer Cmd/Ctrl+clicks your exported function in their editor, they land directly in your `.ts` source file (via the source map chain) rather than the generated `.d.ts`. This is the mark of a professional library — consumers can understand what your code actually does, not just its type signature.

```
src/result.ts       <-- original source (what devs see with declarationMap)
dist/result.js      <-- emitted JavaScript (what Node runs)
dist/result.d.ts    <-- type declarations (what tsc reads)
dist/result.d.ts.map <- links .d.ts back to result.ts
dist/result.js.map  <- links .js back to result.ts (for stack traces)
```

## Try it yourself

The following pure-JavaScript starter implements a **Result / Either** type pattern — a foundational library primitive that makes error handling explicit and type-safe. This is the core logic you would convert to TypeScript for the project:

```js run
// Result / Either pattern in pure JS
// In a real TypeScript library this would be fully typed.

function ok(value) {
  return Object.freeze({ ok: true, value });
}

function err(error) {
  return Object.freeze({ ok: false, error });
}

// map: transform the value inside a Result without unwrapping
function mapResult(result, fn) {
  return result.ok ? ok(fn(result.value)) : result;
}

// flatMap / chain: sequence two operations that each return Results
function flatMap(result, fn) {
  return result.ok ? fn(result.value) : result;
}

// unwrapOr: get the value, or a default if it's an error
function unwrapOr(result, defaultValue) {
  return result.ok ? result.value : defaultValue;
}

// match: exhaustively handle both branches
function match(result, handlers) {
  return result.ok ? handlers.Ok(result.value) : handlers.Err(result.error);
}

// --- Example: a small parsing pipeline ---

function parsePort(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return err(`"${raw}" is not a number`);
  if (n < 1 || n > 65535)  return err(`Port ${n} is out of range (1-65535)`);
  return ok(n);
}

function parseHost(raw) {
  if (!raw || raw.trim() === "") return err("Host must not be empty");
  return ok(raw.trim());
}

function parseConfig(raw) {
  return flatMap(
    parseHost(raw.host),
    (host) => mapResult(parsePort(raw.port), (port) => ({ host, port }))
  );
}

const configs = [
  { host: "localhost", port: "3000" },
  { host: "",          port: "3000" },
  { host: "localhost", port: "abc"  },
  { host: "api.io",    port: "99999" },
];

configs.forEach((raw) => {
  const result = parseConfig(raw);
  const msg = match(result, {
    Ok:  (cfg) => `OK  -> ${cfg.host}:${cfg.port}`,
    Err: (e)   => `ERR -> ${e}`,
  });
  console.log(msg);
});

// Demonstrate unwrapOr
const fallback = unwrapOr(parsePort("bad"), 3000);
console.log("\nFallback port:", fallback); // 3000
```

## Exercise: add a `collect` utility

Write a `collectResults(results)` function that takes an array of `Result` objects and returns:
- `ok([v1, v2, ...])` if every result is Ok.
- `err([e1, e2, ...])` if any result is Err, collecting **all** errors.

<details>
<summary>Show solution</summary>

```js run
function ok(value)  { return { ok: true,  value }; }
function err(error) { return { ok: false, error }; }

function collectResults(results) {
  const values = [];
  const errors = [];

  for (const r of results) {
    if (r.ok) {
      values.push(r.value);
    } else {
      errors.push(r.error);
    }
  }

  return errors.length > 0 ? err(errors) : ok(values);
}

const allGood = [ok(1), ok(2), ok(3)];
const mixed   = [ok(1), err("missing name"), ok(3), err("invalid email")];

const r1 = collectResults(allGood);
const r2 = collectResults(mixed);

console.log(r1.ok ? "All good: " + r1.value : "Errors: " + r1.error);
// All good: 1,2,3

console.log(r2.ok ? "All good" : "Errors: " + r2.error.join("; "));
// Errors: missing name; invalid email
```

</details>

## Project

### Convert your REST API to fully-typed strict TypeScript

Take the REST API you built in Module 16 (or any Express/Fastify API you have) and convert it to strict TypeScript with clean declaration file output.

**Acceptance criteria:**

1. `tsc --noEmit` completes with zero errors under `strict: true`, `noImplicitAny: true`, and `strictNullChecks: true`.
2. Every route handler has explicit request/response types (use a framework's generic types or define your own `TypedRequest<TBody, TParams, TQuery>` type).
3. All database access functions return `Result<T, DbError>` — no naked `throw` statements in business logic. The `Result` type is defined in a dedicated `src/types/result.ts` module.
4. Running `tsc` emits `.js`, `.d.ts`, and `.d.ts.map` files to `dist/`. The `package.json` `"exports"` field correctly points `"types"` to the generated declarations.
5. A `src/types/index.ts` barrel re-exports all public types so a consumer can `import type { Result, User, ApiResponse } from "your-api"`.
6. `npm run build && node dist/index.js` starts the server without errors.

**Starter — the Result type in JavaScript (convert this to TypeScript first):**

```js run
// Result/Either primitive — your foundation.
// In TypeScript you'll add generic type parameters and interfaces.

function ok(value) {
  return Object.freeze({ ok: true, value });
}

function err(error) {
  return Object.freeze({ ok: false, error });
}

function match(result, handlers) {
  return result.ok ? handlers.Ok(result.value) : handlers.Err(result.error);
}

// Simulate a "database" query returning a Result
function findUser(id) {
  const users = new Map([
    [1, { id: 1, name: "Ada Lovelace",   email: "ada@example.com" }],
    [2, { id: 2, name: "Grace Hopper",   email: "grace@example.com" }],
  ]);
  const user = users.get(id);
  return user ? ok(user) : err({ code: "NOT_FOUND", message: `User ${id} not found` });
}

// Simulate a route handler
function handleGetUser(params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { status: 400, body: { error: "Invalid user ID" } };
  }

  return match(findUser(id), {
    Ok:  (user) => ({ status: 200, body: { data: user } }),
    Err: (e)    => ({ status: e.code === "NOT_FOUND" ? 404 : 500, body: { error: e.message } }),
  });
}

// Test the handler
[{ id: "1" }, { id: "2" }, { id: "99" }, { id: "abc" }].forEach((params) => {
  const response = handleGetUser(params);
  console.log(`GET /users/${params.id} ->`, response.status, JSON.stringify(response.body));
});
```

## Common pitfalls

> [!PITFALL] Shipping src/ instead of dist/ to npm
> If you forget to set `"files": ["dist"]` in `package.json`, `npm publish` includes everything — your raw TypeScript source, test files, and all. Consumers get confused, and you may accidentally expose internal implementation details. Always set `files` explicitly.

> [!PITFALL] Forgetting to rebuild before publishing
> If you edit `src/` and forget to run `tsc` before `npm publish`, consumers get the old `dist/`. Use `"prepublishOnly": "tsc"` as a script hook — npm runs it automatically before `publish`.

> [!PRINCIPAL] Declaration files are a public API contract
> Once consumers depend on your `.d.ts` types, changing them is a breaking change — just like changing a function signature. Treat your TypeScript types with the same semantic versioning discipline as your runtime API. Remove a type export in a minor version and you'll break consumers silently (they'll get a TS error, not a runtime error, but it still forces them to update their code).

## What you learned

- `.d.ts` files are type-only descriptions of compiled JavaScript — they have zero runtime cost.
- Enable `declaration: true` and `declarationMap: true` in tsconfig to emit them automatically.
- The `"types"` field in `package.json` (and the `"types"` condition in `"exports"`) tells TypeScript where to find your declarations.
- `@types/*` packages provide community-maintained declarations for untyped JavaScript packages.
- The `Result<T, E>` pattern is a library primitive that makes error handling explicit and composable.

## Next steps

With TypeScript fully integrated into your Node workflow — type-safe source, clean declarations, and a tested library primitive — you're ready for Module 22: testing strategies for Node.js applications, including how to test TypeScript code with Vitest and Jest.
*/});
