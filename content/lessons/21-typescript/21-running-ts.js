registerLessonSrc("21-running-ts", function () {/*
---
id: 21-running-ts
title: "Running TS Directly: type-stripping & tsx"
minutes: 22
level: advanced
objectives:
  - Run TypeScript files directly with Node's native type-stripping
  - Understand what "erasable syntax" means and which TS features it excludes
  - Choose between native stripping, tsx, ts-node, and compiling to JS
---

# Running TS Directly: type-stripping & tsx

## Why this matters

The compile-then-run loop (`tsc && node dist/index.js`) adds friction during development. Modern Node and third-party tools let you run `.ts` files directly — no build step. Understanding how each approach works, and where each one breaks, prevents mystifying runtime errors and wasted debugging time.

## Learning objectives

- Run `.ts` files with `node --experimental-strip-types file.ts`.
- Understand what "erasable syntax only" means and which TypeScript features are excluded.
- Use `tsx` as a fast, ergonomic alternative.
- Know when compiling with `tsc` is still the right choice.

## Node's native type-stripping (Node 22.6+, stable in Node 23+)

Starting with Node 22.6 and made unflagged in Node 23.x / Node 24 LTS, Node can run TypeScript files directly:

```bash
node --experimental-strip-types server.ts
# Node 24 LTS — flag may be default-on or renamed; check release notes
node server.ts   # if type-stripping is enabled by default in your Node version
```

Node passes the file through a fast "type stripper" (powered by the `amaro` package, which wraps SWC) that removes type annotations and produces plain JavaScript. The result is executed immediately. No `tsc`, no `dist/` folder.

> [!OUTPUT]
> $ node --experimental-strip-types src/index.ts
> API listening on port 3000

This is blazing fast because it does almost no work: it strips syntax, it does **not** type-check. For type errors you still run `tsc --noEmit`.

> [!NOTE] Type-stripping does not type-check
> `node --experimental-strip-types` is not a replacement for `tsc`. It is a *runtime loader* — it only removes type syntax so Node can execute the file. Run `tsc --noEmit` in CI or as a pre-commit hook to catch type errors.

## Erasable syntax — what is excluded

Node's stripper can only handle **erasable** TypeScript: syntax that can be deleted without changing runtime behaviour. This covers:

- Type annotations (`: string`, `: User`, `: Promise<void>`)
- Interface and type alias declarations (`interface Foo { ... }`, `type Bar = ...`)
- Generic type parameters (`<T>`, `<T extends string>`)
- Type imports (`import type { User } from "./types.js"`)
- Non-emitting decorators (proposal-stage, experimental)

It does **not** handle TypeScript features that *emit runtime code*:

```ts
// These CANNOT be stripped — they generate real JS output:

enum Direction { Up, Down, Left, Right }
// Emits: var Direction; Direction[Direction["Up"] = 0] = "Up"; ...

namespace MyNS {
  export function helper() { ... }
}
// Emits: var MyNS; (function(MyNS) { ... })(MyNS || (MyNS = {}));

// Parameter properties — shorthand that assigns in the constructor
class Server {
  constructor(private port: number) {}
  // Emits: this.port = port; inside the constructor
}
```

> [!PITFALL] Using enums or namespaces with native stripping
> If your `.ts` file uses `enum` or TypeScript `namespace`, `node --experimental-strip-types` will throw a parse error. Replace `enum` with a `const` object (`as const`) and avoid TypeScript namespaces entirely. These features were always considered legacy TS anyway.

```ts
// Prefer this over enum — works with stripping:
const Direction = { Up: 0, Down: 1, Left: 2, Right: 3 } as const;
type Direction = typeof Direction[keyof typeof Direction];
```

## tsx — the ergonomic solution

[`tsx`](https://github.com/privatenumber/tsx) is a thin CLI wrapper around esbuild that handles TypeScript (including enums, decorators, and JSX) and works seamlessly as a drop-in replacement for `node`:

```bash
npm install --save-dev tsx

# Run a file
npx tsx src/index.ts

# Watch mode — re-runs on file changes
npx tsx watch src/index.ts

# As a Node loader (for programmatic use)
node --import tsx/esm src/index.ts
```

`tsx` also handles the `.js`-extension-in-imports pitfall — it rewrites the extensions internally so your TypeScript compiles and runs without a hitch.

> [!PRINCIPAL] tsx is the production-grade dev tool; native stripping is the built-in baseline
> `tsx` uses esbuild under the hood, which transforms code significantly faster than `tsc` and handles everything TypeScript can throw at it. The native `--experimental-strip-types` is valuable because it has zero extra dependencies and works anywhere Node 22.6+ runs. Use native stripping for simple scripts and CI environments; use `tsx` for full application development.

## ts-node (legacy)

`ts-node` was the original solution — it hooks into Node's module loader to compile TypeScript on-the-fly using `tsc` itself. It is slower, has ESM friction, and requires more configuration. Prefer `tsx` for new projects. If you encounter it in an existing codebase:

```bash
npx ts-node src/index.ts               # CJS mode
npx ts-node --esm src/index.ts         # ESM mode (needs "type":"module")
```

## When to compile vs strip

| Scenario | Recommended approach |
|---|---|
| Quick scripts, one-off tools | `node --experimental-strip-types file.ts` |
| Active development, app server | `tsx watch src/index.ts` |
| Publishing a library | `tsc` — emit `.js` + `.d.ts` to `dist/` |
| CI type-checking | `tsc --noEmit` |
| Production deployments | Pre-compiled `dist/` (node dist/index.js) |

> [!NOTE] Don't ship TypeScript to production
> Running `tsx` or `--experimental-strip-types` in production adds startup overhead and a dependency. Always compile to JavaScript for production deployments. The dev-only tools are for the inner loop.

## A complete dev workflow

```json
// package.json scripts
{
  "scripts": {
    "dev":       "tsx watch src/index.ts",
    "build":     "tsc",
    "typecheck": "tsc --noEmit",
    "start":     "node dist/index.js"
  }
}
```

> [!OUTPUT]
> $ npm run dev
> [tsx] watching for changes in src/
> API listening on port 3000
> [tsx] file changed: src/router.ts — restarting
> API listening on port 3000

## Try it yourself

The following block implements a naive **type-stripper** in pure JavaScript using regular expressions. It cannot handle all TypeScript, but it illustrates the core idea — removing `: Type` annotations from a line of code — and shows why a production stripper (like SWC/esbuild) uses a proper AST parser instead:

```js run
// Naive regex-based type annotation stripper — pure JS
// Demonstrates the core idea behind native type-stripping.

function stripLineAnnotations(line) {
  // Strip return type annotations: ): Type {  or ): Type;
  // e.g.  "function add(a, b): number {"  ->  "function add(a, b) {"
  line = line.replace(/\)\s*:\s*[\w<>\[\]|& ,"'.]+(?=\s*[{;,])/g, ')');

  // Strip parameter type annotations: param: Type
  // e.g.  "(a: number, b: string)"  ->  "(a, b)"
  // Simple version: remove ": <word chars>" patterns inside parens
  line = line.replace(/:\s*[\w<>\[\]|&]+(\s*\[\s*\])?(?=[,\)])/g, '');

  // Strip variable type annotations: const x: Type =
  // e.g.  "const port: number = 3000"  ->  "const port = 3000"
  line = line.replace(/(const|let|var)(\s+\w+)\s*:\s*[\w<>\[\]|&. "',]+(?=\s*=)/g, '$1$2');

  // Strip interface declarations entirely
  if (/^\s*interface\s+\w+/.test(line)) return '// [interface removed]';

  // Strip type alias declarations
  if (/^\s*type\s+\w+\s*=/.test(line)) return '// [type alias removed]';

  // Strip import type lines
  if (/^\s*import\s+type\s+/.test(line)) return '// [import type removed]';

  return line;
}

function stripTypes(source) {
  return source
    .split('\n')
    .map(stripLineAnnotations)
    .join('\n');
}

// Test cases — what a real .ts file might contain
const tsSource = [
  "import type { User } from './types.js';",
  "interface Config { port: number; host: string; }",
  "type ID = string | number;",
  "const port: number = 3000;",
  "let ready: boolean = false;",
  "function greet(name: string, age: number): string {",
  "  return 'Hello ' + name;",
  "}",
  "const add = (a: number, b: number): number => a + b;",
].join('\n');

console.log("=== Original TypeScript ===");
console.log(tsSource);
console.log("\n=== After naive stripping ===");
console.log(stripTypes(tsSource));

console.log("\n--- Accuracy note ---");
console.log("A real stripper uses an AST parser (like SWC/esbuild).");
console.log("Regex-based stripping breaks on generics, multi-line types, and string literals.");
```

## Exercise: detect non-erasable syntax

Write a function `hasNonErasableSyntax(source)` that returns the first non-erasable TypeScript feature found in a source string (as a string description), or `null` if the source appears safe for native type-stripping.

<details>
<summary>Show solution</summary>

```js run
function hasNonErasableSyntax(source) {
  const checks = [
    { pattern: /^\s*(const\s+)?enum\s+\w+/m,       label: "enum declaration" },
    { pattern: /^\s*namespace\s+\w+/m,              label: "TypeScript namespace" },
    { pattern: /constructor\s*\(\s*(private|public|protected|readonly)\s+/m,
                                                    label: "parameter property (constructor shorthand)" },
    { pattern: /@\w+\s*\(/m,                        label: "decorator (may emit code)" },
  ];

  for (const { pattern, label } of checks) {
    if (pattern.test(source)) return label;
  }
  return null;
}

const safe = `
import type { Foo } from './foo.js';
interface Bar { x: number; }
type Baz = string | number;
function greet(name: string): string { return name; }
`;

const unsafeEnum = `
enum Color { Red, Green, Blue }
function paint(c: Color): void {}
`;

const unsafeNamespace = `
namespace Utils {
  export function helper() { return 42; }
}
`;

const unsafeParamProp = `
class Server {
  constructor(private port: number, public host: string) {}
}
`;

[
  ["safe code",             safe],
  ["enum",                  unsafeEnum],
  ["namespace",             unsafeNamespace],
  ["parameter properties",  unsafeParamProp],
].forEach(([label, src]) => {
  const issue = hasNonErasableSyntax(src);
  console.log(`[${label}]:`, issue ? `BLOCKED — ${issue}` : "OK for native stripping");
});
```

</details>

## Common pitfalls

> [!PITFALL] Confusing "runs without errors" with "type-correct"
> Native type-stripping and `tsx` will happily run TypeScript files with type errors — they ignore types entirely. Always pair your dev workflow with `tsc --noEmit` in a separate check (pre-commit hook or CI step) to catch real type mistakes.

> [!PITFALL] Using tsx in production Docker images
> `tsx` is a dev dependency and adds startup cost. A common mistake is to `COPY` the whole repo into a Docker image and run `tsx src/index.ts`. Always compile to `dist/` and run `node dist/index.js` in production images for faster startup and smaller images.

## What you learned

- `node --experimental-strip-types file.ts` runs TypeScript by erasing types — no compile step, no type-checking.
- Only **erasable** TypeScript works: `enum`, `namespace`, and parameter properties are excluded.
- `tsx` handles all TypeScript including enums and JSX, and supports `--watch` for dev.
- `ts-node` is the legacy alternative — prefer `tsx` for new projects.
- Always compile with `tsc` before shipping to production; use `tsc --noEmit` in CI for type safety.

## Next steps

Now that you can run TypeScript, the final lesson covers how to build and publish **typed libraries** — emitting clean `.d.ts` declaration files so that consumers of your package get full type safety.
*/});
