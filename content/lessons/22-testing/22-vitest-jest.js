registerLessonSrc("22-vitest-jest", function () {/*
---
id: 22-vitest-jest
title: "Vitest & Jest Compared"
minutes: 22
level: advanced
objectives:
  - Explain when to choose Vitest, Jest, or node:test for a project
  - Write tests using the shared expect() API fluently
  - Configure Vitest and Jest and understand their key tradeoffs
---

# Vitest & Jest Compared

## Why this matters

`node:test` is great for server-side Node code with no dependencies. But the moment you need a React component, complex DOM testing, extensive snapshot support, or a rich plugin ecosystem, you reach for a framework. **Jest** has been the industry standard for years. **Vitest** is the newer, faster challenger built around Vite. Knowing both — their similarities, their differences, and when each wins — lets you make confident toolchain decisions instead of cargo-culting the choice from a create-app template.

## Learning objectives

- Understand Vitest's ESM-native, Vite-powered architecture and why it's faster in many setups.
- Use the `expect()` API — `toBe`, `toEqual`, `toThrow`, `resolves`, `rejects`, and matchers — in both frameworks.
- Know Jest's strengths: maturity, rich ecosystem, jsdom, and zero-config for many React stacks.
- Pick the right framework for a project and configure it correctly.

## The shared DNA: expect()

Both Jest and Vitest share the same `expect()` assertion API — intentionally, since Vitest was designed as a drop-in replacement. That means tests often migrate with no changes beyond imports:

```js
import { expect, test, describe } from "vitest"; // or: import { expect, test } from "@jest/globals";

describe("expect() basics", () => {
  test("primitive equality", () => {
    expect(1 + 1).toBe(2);            // strict ===
    expect("hello").not.toBe("world");
  });

  test("deep equality", () => {
    expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] }); // structural
  });

  test("truthiness", () => {
    expect("non-empty").toBeTruthy();
    expect(0).toBeFalsy();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
  });

  test("throws", () => {
    expect(() => JSON.parse("{bad")).toThrow(SyntaxError);
    expect(() => JSON.parse("{bad")).toThrow(/JSON/);
  });

  test("async resolves / rejects", async () => {
    await expect(Promise.resolve(42)).resolves.toBe(42);
    await expect(Promise.reject(new Error("oops"))).rejects.toThrow("oops");
  });
});
```

> [!OUTPUT]
> PASS  src/math.test.ts
>  expect() basics
>   ✓ primitive equality (1 ms)
>   ✓ deep equality
>   ✓ truthiness
>   ✓ throws
>   ✓ async resolves / rejects
>
> Test Files  1 passed (1)
> Tests       5 passed (5)
> Duration    312 ms

### Common matchers reference

| Matcher | Checks |
|---|---|
| `.toBe(v)` | `===` |
| `.toEqual(v)` | deep structural equality |
| `.toStrictEqual(v)` | deep equality, same class/undefined-keys |
| `.toBeCloseTo(n, d)` | floating-point within d decimal places |
| `.toContain(item)` | array contains item, string contains substring |
| `.toHaveLength(n)` | `.length === n` |
| `.toMatchObject(partial)` | object contains these keys/values |
| `.toMatchSnapshot()` | matches stored snapshot |
| `.toHaveBeenCalledWith(...)` | spy/mock assertion |
| `.toThrow(msg?)` | function throws |

## Vitest: fast, ESM-native, Vite-powered

Vitest sits on top of **Vite**, so it reuses Vite's module graph and transform pipeline. This has a huge practical consequence: if your project already uses Vite (React, Vue, Svelte), Vitest starts almost instantly — there's no separate compile step. It also handles TypeScript, JSX, and CSS modules out of the box with the same config as your build.

```bash
npm install -D vitest
```

`vitest.config.ts` (or extend your `vite.config.ts`):

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",       // or "jsdom" for browser-like APIs
    globals: true,             // adds expect/test/describe globally (like Jest)
    coverage: {
      provider: "v8",          // or "istanbul"
      reporter: ["text", "html"]
    }
  }
});
```

Run tests:

```bash
npx vitest             # watch mode by default in development
npx vitest run         # single-pass for CI
npx vitest run --coverage
```

> [!OUTPUT]
> ✓ src/math.test.ts (3 tests) 12ms
> ✓ src/api.test.ts (7 tests) 45ms
> Test Files  2 passed (2)
> Tests       10 passed (10)
> Duration    1.23 s (transform 60ms, setup 0ms, collect 180ms, tests 57ms, environment 0ms, prepare 12ms)

### Vitest-specific strengths

- **In-source testing** — embed tests directly in source files using `import.meta.vitest`.
- **Browser mode** — run tests in a real browser via Playwright with `--browser`.
- **Snapshot serializers** — plug in custom serialisers for domain objects.
- **Type testing** — `expectTypeOf()` asserts TypeScript types at the type level.

## Jest: the mature giant

Jest was created at Facebook and open-sourced in 2014. It powers most React Native projects, large Next.js monorepos, and CI pipelines at thousands of companies. Its strengths are its stability, ecosystem depth, and the fact that `create-react-app` and many meta-frameworks default to it.

```bash
npm install -D jest @jest/globals
```

For TypeScript, add a transformer:

```bash
npm install -D ts-jest   # or babel-jest if you use Babel
```

`jest.config.ts`:

```js
export default {
  preset: "ts-jest",
  testEnvironment: "node",   // or "jsdom"
  collectCoverage: true,
  coverageReporters: ["text", "lcov"]
};
```

Run tests:

```bash
npx jest
npx jest --watch
npx jest --coverage
```

> [!OUTPUT]
> PASS  src/math.test.ts
>  Math
>   ✓ adds (2 ms)
>   ✓ divides by non-zero (1 ms)
> Test Suites: 1 passed, 1 total
> Tests:       2 passed, 2 total

### Jest-specific strengths

- **jsdom built-in** — richest browser simulation for React component tests.
- **Manual mocks** — drop a file in `__mocks__/` and Jest auto-intercepts imports.
- **Module name mapper** — rewrite import paths for aliasing or mocking entire modules.
- **Snapshot matchers** for inline snapshots (`toMatchInlineSnapshot`).

## Framework comparison

| Feature | node:test | Vitest | Jest |
|---|---|---|---|
| Dependencies | zero | ~few | ~many |
| ESM support | native | native | requires config |
| TypeScript | manual | via Vite/esbuild | via ts-jest/babel |
| Watch mode | `--watch` | built-in, fast | `--watch`, slower |
| Mocking | built-in | `vi.fn()`, `vi.mock()` | `jest.fn()`, `jest.mock()` |
| Browser env | no | yes (Browser Mode) | jsdom |
| Snapshot testing | basic | full | full |
| Parallel test files | yes | yes | yes |
| Best for | Node services, CLIs | Vite projects, modern ESM | React, RN, CRA ecosystems |

> [!PRINCIPAL] The framework is a project-level decision, not a developer preference
> Switching test frameworks mid-project is expensive — it means rewriting mocks, updating CI scripts, and retraining the team. Evaluate at project start based on your build tool (Vite → Vitest, Webpack/Babel → Jest), your runtime target (pure Node → node:test or Vitest, React/browser → Jest or Vitest), and your team's familiarity. In a monorepo you may legitimately run different frameworks per package. The shared `expect()` API means moving between them is mostly mechanical.

## Try it yourself

Here is a tiny `expect()` with a handful of matchers — pure JavaScript, fully runnable. This is the conceptual core of both Jest and Vitest:

```js run
// A minimal expect() implementation with chained matchers.
function expect(actual) {
  function fail(msg) { throw new Error(msg); }

  const matchers = {
    toBe(expected) {
      if (actual !== expected)
        fail("toBe: expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual));
    },
    toEqual(expected) {
      const a = JSON.stringify(actual), e = JSON.stringify(expected);
      if (a !== e) fail("toEqual: expected " + e + " got " + a);
    },
    toBeTruthy() {
      if (!actual) fail("toBeTruthy: got " + actual);
    },
    toBeFalsy() {
      if (actual) fail("toBeFalsy: got " + actual);
    },
    toBeNull() {
      if (actual !== null) fail("toBeNull: got " + actual);
    },
    toThrow(pattern) {
      if (typeof actual !== "function") fail("toThrow: expected a function");
      try { actual(); }
      catch (e) {
        if (pattern && !String(e.message).includes(pattern))
          fail("toThrow: message '" + e.message + "' does not include '" + pattern + "'");
        return;
      }
      fail("toThrow: function did not throw");
    },
    toContain(item) {
      if (Array.isArray(actual)) {
        if (!actual.includes(item)) fail("toContain: array does not contain " + item);
      } else if (typeof actual === "string") {
        if (!actual.includes(item)) fail("toContain: string does not contain '" + item + "'");
      } else {
        fail("toContain: not an array or string");
      }
    }
  };

  // Support .not.matcher
  const notMatchers = {};
  for (const [name, fn] of Object.entries(matchers)) {
    notMatchers[name] = (...args) => {
      let threw = false;
      try { fn(...args); } catch (_) { threw = true; }
      if (!threw) fail("not." + name + ": assertion unexpectedly passed");
    };
  }
  matchers.not = notMatchers;
  return matchers;
}

// --- run a few tests ---
const results = [];
function test(name, fn) {
  try { fn(); results.push("PASS  " + name); }
  catch (e) { results.push("FAIL  " + name + " — " + e.message); }
}

test("toBe", () => expect(1 + 1).toBe(2));
test("toEqual", () => expect({ x: 1 }).toEqual({ x: 1 }));
test("not.toBe", () => expect("a").not.toBe("b"));
test("toThrow", () => expect(() => { throw new Error("boom"); }).toThrow("boom"));
test("toContain array", () => expect([1, 2, 3]).toContain(2));
test("toContain string", () => expect("hello world").toContain("world"));
test("failure example", () => expect(1).toBe(2));

results.forEach((r) => console.log(r));
```

## Exercises

### Exercise 1: add toHaveLength

Extend the `expect()` above with a `toHaveLength(n)` matcher. Test it on an array and a string.

<details>
<summary>Show solution</summary>

```js run
function expect(actual) {
  function fail(msg) { throw new Error(msg); }
  return {
    toBe(e) { if (actual !== e) fail("toBe failed: " + actual + " !== " + e); },
    toHaveLength(n) {
      if (actual == null || actual.length === undefined)
        fail("toHaveLength: no .length property");
      if (actual.length !== n)
        fail("toHaveLength: expected " + n + " got " + actual.length);
    }
  };
}

function test(name, fn) {
  try { fn(); console.log("PASS  " + name); }
  catch (e) { console.log("FAIL  " + name + " — " + e.message); }
}

test("array length", () => expect([1, 2, 3]).toHaveLength(3));
test("string length", () => expect("hello").toHaveLength(5));
test("wrong length fails", () => expect([1]).toHaveLength(5));
```

</details>

### Exercise 2: async resolves matcher

Add a `resolves` property to `expect()` that returns an object with `toBe` — so you can write `await expect(promise).resolves.toBe(42)`.

<details>
<summary>Show solution</summary>

```js run
function expect(actual) {
  function fail(msg) { throw new Error(msg); }
  return {
    toBe(e) { if (actual !== e) fail("toBe: " + actual + " !== " + e); },
    get resolves() {
      return {
        async toBe(e) {
          const v = await actual;
          if (v !== e) fail("resolves.toBe: " + v + " !== " + e);
        }
      };
    }
  };
}

async function runTests() {
  async function test(name, fn) {
    try { await fn(); console.log("PASS  " + name); }
    catch (e) { console.log("FAIL  " + name + " — " + e.message); }
  }

  await test("resolves to 42", async () => {
    await expect(Promise.resolve(42)).resolves.toBe(42);
  });

  await test("resolves to wrong value — fails", async () => {
    await expect(Promise.resolve(99)).resolves.toBe(42);
  });
}

runTests();
```

</details>

## Common pitfalls

> [!PITFALL] Mixing Jest globals with Vitest (or vice versa)
> Both frameworks optionally inject `test`, `expect`, `describe` as globals. If you set `globals: true` in Vitest's config but your TypeScript types only reference `@types/jest`, you'll get type errors — or worse, silently wrong behaviour if the shapes differ. Be explicit: either import from `"vitest"` / `"@jest/globals"`, or configure globals carefully and include only one framework's types.

## What you learned

- Vitest and Jest share the `expect()` assertion API, making migration mostly mechanical.
- Vitest is ESM-native and Vite-powered — the natural choice for Vite projects.
- Jest's strengths are ecosystem maturity, rich jsdom support, and React/RN toolchains.
- `node:test` wins for zero-dependency Node services and CLIs.
- Choose your framework at project inception; switching later is expensive.

## Next steps

With a solid understanding of unit testing tools, we step up the testing pyramid to **integration and end-to-end tests**: testing HTTP APIs as a whole, using test databases, and structuring CI pipelines that give you real confidence in deployment.
*/});
