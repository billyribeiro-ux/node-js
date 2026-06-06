registerLessonSrc("22-node-test", function () {/*
---
id: 22-node-test
title: "The Built-in node:test Runner"
minutes: 22
level: intermediate
objectives:
  - Use node:test and node:assert to write and run tests without any dependencies
  - Organise tests with describe/it, skip/todo, and .only
  - Write async tests and run your suite with node --test and watch mode
---

# The Built-in node:test Runner

## Why this matters

Before Node 18, every project that wanted to run tests had to install at least one third-party package — Jest, Mocha, tap, and so on. Node 18 changed that by shipping a full test runner in the standard library. Today you can write, organise, and run tests with zero `npm install`. For many backend services and CLI tools this is all you need, and it removes an entire category of toolchain complexity.

## Learning objectives

- Write tests with `test()`, `describe()`, and `it()` from `node:test`.
- Make assertions with `node:assert`.
- Run a suite with `node --test` and interpret its TAP output.
- Skip, mark todo, and focus tests with `.skip`, `.todo`, and `.only`.
- Write async tests correctly.
- Use watch mode for continuous feedback during development.

## The basics: test() and assert

Import from the two built-in modules:

```js
import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
```

`node:assert/strict` makes every comparison use strict equality (`===`) by default — prefer it over the plain `node:assert` which uses loose equality.

A minimal test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("adds two numbers", () => {
  assert.strictEqual(1 + 1, 2);
});
```

> [!OUTPUT]
> TAP version 13
> ok 1 - adds two numbers
> 1..1
> # tests 1
> # pass  1
> # fail  0
> # duration_ms 30.4

The output is **TAP** (Test Anything Protocol) — a text format understood by most CI systems. Node also emits human-friendly summaries at the end.

### Key assert methods

| Method | Checks |
|---|---|
| `assert.strictEqual(a, b)` | `a === b` |
| `assert.deepStrictEqual(a, b)` | deep structural equality |
| `assert.ok(value)` | value is truthy |
| `assert.throws(fn, /pattern/)` | fn throws, optional message match |
| `assert.rejects(promise, /pattern/)` | async: promise rejects |
| `assert.doesNotThrow(fn)` | fn does not throw |

## describe and it: grouping tests

`describe` creates a named suite. `it` is an alias for `test` and reads naturally inside describe blocks:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Array utilities", () => {
  it("returns the last element", () => {
    const last = (arr) => arr[arr.length - 1];
    assert.strictEqual(last([1, 2, 3]), 3);
  });

  it("returns undefined for an empty array", () => {
    const last = (arr) => arr[arr.length - 1];
    assert.strictEqual(last([]), undefined);
  });
});
```

> [!OUTPUT]
> TAP version 13
> # Subtest: Array utilities
>     ok 1 - returns the last element
>     ok 2 - returns undefined for an empty array
>     1..2
> ok 1 - Array utilities
> 1..1
> # tests 2
> # pass  2

Nesting describe blocks works fine — use it to group by feature or class.

## Skipping, todo, and .only

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("this runs normally", () => {
  assert.ok(true);
});

test.skip("not ready yet", () => {
  // never runs
});

test.todo("need to implement parseDate");

test.only("isolated focus", () => {
  // run node --test --test-only to limit to these
  assert.strictEqual(2 * 2, 4);
});
```

> [!NOTE] --test-only flag
> `test.only` does nothing unless you also pass `--test-only` to Node. This prevents accidentally committing an `.only` that silently skips your whole suite on CI.

> [!PITFALL] Forgetting --test-only on CI
> If you commit a `test.only` without `--test-only` in your CI command, **all other tests still run** — the `.only` is silently ignored. Most teams add a lint rule (or a grep in their CI script) to detect `.only` in source code.

## Async tests

Return a promise (or use `async`/`await`) and `node:test` waits for it to settle:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("fetches a record", async () => {
  // simulating an async DB call
  const getUser = (id) => Promise.resolve({ id, name: "Ada" });

  const user = await getUser(42);
  assert.deepStrictEqual(user, { id: 42, name: "Ada" });
});
```

> [!OUTPUT]
> ok 1 - fetches a record

For rejections, use `assert.rejects`:

```js
test("rejects on bad input", async () => {
  const parse = (x) => Promise.reject(new Error("bad input: " + x));
  await assert.rejects(parse("???"), /bad input/);
});
```

## Running tests

Run every `*.test.js` (or `*.spec.js`, or files in a `test/` folder) automatically:

```bash
node --test
```

Run a specific file:

```bash
node --test src/math.test.js
```

Filter by test name with a glob pattern:

```bash
node --test --test-name-pattern="adds*"
```

Watch mode (re-runs on file changes):

```bash
node --test --watch
```

> [!PRINCIPAL] Zero-dependency testing is a serious option
> For microservices, CLIs, and libraries that already ship with Node, `node:test` eliminates a dependency entirely. Dependencies have upgrade churn, security CVEs, and breaking changes. When your test needs are modest — unit tests, a few integrations — the built-in runner is the engineering-sound choice. Reserve Jest or Vitest for richer ecosystems (React, complex mocking, snapshot testing) where those features pay for the extra dependency.

## Try it yourself

Here is a miniature test runner built from scratch. It uses the same ideas as `node:test` — a `test()` function that catches thrown errors, and an `assert()` that throws on failure — and prints a pass/fail report. This is pure JavaScript you can run right now:

```js run
// A micro test runner — exactly what node:test does internally.
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}

// --- our "tests" ---
test("1 + 1 equals 2", () => {
  assert(1 + 1 === 2, "expected 2");
});

test("string includes substring", () => {
  assert("hello world".includes("world"), "expected 'world' in string");
});

test("array has correct length", () => {
  const arr = [10, 20, 30];
  assert(arr.length === 3, "expected length 3");
});

test("this one fails intentionally", () => {
  assert(1 === 2, "1 should equal 2");
});

// --- report ---
let passed = 0, failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log("PASS  " + r.name);
    passed++;
  } else {
    console.log("FAIL  " + r.name + " — " + r.error);
    failed++;
  }
}
console.log("");
console.log("Results: " + passed + " passed, " + failed + " failed");
```

## Exercises

### Exercise 1: deepEqual assertion

Add a `deepEqual(a, b, msg)` helper to the micro-runner above that compares plain objects by iterating their keys. Write two tests: one that passes and one that fails.

<details>
<summary>Show solution</summary>

```js run
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function deepEqual(a, b) {
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null) return a === b;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}

test("objects are deeply equal", () => {
  assert(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }), "should be equal");
});

test("objects differ — should fail", () => {
  assert(deepEqual({ a: 1 }, { a: 2 }), "should not be equal");
});

for (const r of results) {
  console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + (r.error ? " — " + r.error : ""));
}
```

</details>

### Exercise 2: async micro-runner

Extend the micro-runner to handle `async` test functions by making `test()` return a promise. Use `Promise.allSettled` to wait for all tests before printing results.

<details>
<summary>Show solution</summary>

```js run
async function runTests() {
  const results = [];

  function assert(condition, message) {
    if (!condition) throw new Error("Assertion failed: " + message);
  }

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  await test("sync test passes", () => {
    assert(2 + 2 === 4, "math broken");
  });

  await test("async test passes", async () => {
    await delay(1);
    assert("async".length === 5, "length wrong");
  });

  await test("async test fails", async () => {
    await delay(1);
    assert(false, "intentional async failure");
  });

  for (const r of results) {
    console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + (r.error ? " — " + r.error : ""));
  }
}

runTests();
```

</details>

## Common pitfalls

> [!PITFALL] Not returning the promise from async tests
> If you write `test("x", async () => { ... })` and the runner does not `await` or chain `.then` on the return value, failures inside the async function will be swallowed — the test appears to pass even when the assertion throws. In `node:test` this is handled correctly as long as you use `async`/`await` or return a Promise. In your own runners always await each test.

## What you learned

- `node:test` gives you `test`, `describe`, and `it` with zero npm installs.
- `node:assert/strict` is the companion assertion library; prefer it over loose `assert`.
- `.skip`, `.todo`, and `.only` (combined with `--test-only`) control which tests run.
- Async tests work naturally — just `return` or `await` your promises.
- `node --test --watch` gives you fast feedback during development.
- Under the hood, a test runner is just a function that catches thrown errors and records results.

## Next steps

The runner itself is only half the story — next we look at **mocking, coverage, and snapshots**: replacing real dependencies with fakes, measuring how much code your tests actually exercise, and locking in complex output with snapshot files.
*/});
