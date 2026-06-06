registerLessonSrc("22-mocking-coverage", function () {/*
---
id: 22-mocking-coverage
title: "Mocking, Coverage & Snapshots"
minutes: 24
level: advanced
objectives:
  - Create mock functions and spy on method calls with node:test's mock API
  - Fake timers to test time-dependent code deterministically
  - Measure test coverage with --experimental-test-coverage
  - Lock in complex output with snapshot testing
---

# Mocking, Coverage & Snapshots

## Why this matters

Unit tests are most valuable when they're *fast* and *isolated*. That means replacing real databases, HTTP clients, timers, and file-system calls with controlled fakes — **mocks**. Then you measure how much of your code those tests actually touch with **coverage**, and you lock in complex serialised output with **snapshots**. Together, these three tools turn a suite of green checks into genuine confidence that production won't surprise you.

## Learning objectives

- Create spy/mock functions with `mock.fn()` and inspect their call records.
- Swap out object methods with `mock.method()` and restore them afterward.
- Fake `setTimeout`/`setInterval` with `mock.timers` for deterministic timing tests.
- Run `node --test --experimental-test-coverage` and interpret the output.
- Write snapshot assertions that catch regressions in complex output.

## Mock functions with mock.fn()

`node:test` exposes a `mock` object on the test context. The most fundamental tool is `mock.fn()` — it wraps a real (or empty) function and records every call:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("mock.fn records calls", (t) => {
  const add = t.mock.fn((a, b) => a + b);

  const result = add(2, 3);

  assert.strictEqual(result, 5);
  assert.strictEqual(add.mock.calls.length, 1);
  assert.deepStrictEqual(add.mock.calls[0].arguments, [2, 3]);
});
```

> [!OUTPUT]
> ok 1 - mock.fn records calls

Each entry in `.mock.calls` is an object with:
- `.arguments` — the array of arguments passed
- `.result` — the return value
- `.error` — any thrown error (or `undefined`)
- `.target` — the `new.target` if called as a constructor

You can also provide canned return values with `mock.fn()`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("mock returns canned values", (t) => {
  const fetchUser = t.mock.fn()
    .mock.mockImplementationOnce(() => ({ id: 1, name: "Ada" }))
    .mock.mockImplementationOnce(() => { throw new Error("not found"); });

  assert.deepStrictEqual(fetchUser(), { id: 1, name: "Ada" });
  assert.throws(() => fetchUser(), /not found/);
  assert.strictEqual(fetchUser.mock.calls.length, 2);
});
```

## Spying on object methods with mock.method()

`mock.method(object, "methodName", [replacement])` replaces a method on an object in-place and automatically restores it at the end of the test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

const db = {
  query: (sql) => ({ rows: [{ id: 1 }] })
};

test("spies on db.query", (t) => {
  const spy = t.mock.method(db, "query");

  const result = db.query("SELECT 1");

  assert.strictEqual(spy.mock.calls.length, 1);
  assert.deepStrictEqual(spy.mock.calls[0].arguments, ["SELECT 1"]);
  assert.deepStrictEqual(result, { rows: [{ id: 1 }] });
  // db.query is restored to the original after the test
});
```

> [!NOTE] Automatic restoration
> When you use `t.mock.method()`, Node automatically calls `mock.reset()` when the test ends. You never have to remember to clean up — no more leaked mocks that corrupt later tests.

To replace the implementation entirely, pass a third argument:

```js
t.mock.method(db, "query", () => ({ rows: [] }));
```

## Faking timers

Testing code that uses `setTimeout` or `setInterval` is painful if you have to wait for real time. `mock.timers` gives you a clock you control:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("fake timer fires callback", (t) => {
  t.mock.timers.enable(["setTimeout"]);

  let fired = false;
  setTimeout(() => { fired = true; }, 1000);

  assert.strictEqual(fired, false);  // hasn't fired yet
  t.mock.timers.tick(1000);           // advance the clock
  assert.strictEqual(fired, true);   // now it has
});
```

> [!OUTPUT]
> ok 1 - fake timer fires callback

You can also tick in multiple steps to test debounce logic or interval scheduling precisely:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("interval fires three times in 300 ms", (t) => {
  t.mock.timers.enable(["setInterval"]);
  let count = 0;
  setInterval(() => count++, 100);

  t.mock.timers.tick(100); assert.strictEqual(count, 1);
  t.mock.timers.tick(100); assert.strictEqual(count, 2);
  t.mock.timers.tick(100); assert.strictEqual(count, 3);
});
```

> [!PITFALL] Forgetting to enable the timer
> Calling `t.mock.timers.tick()` without first calling `t.mock.timers.enable(["setTimeout"])` silently does nothing — real timers run and your test times out waiting. Always pass the explicit list of timer APIs you want to fake.

## Measuring coverage

Run your suite with `--experimental-test-coverage` to get a per-file coverage report:

```bash
node --test --experimental-test-coverage
```

> [!OUTPUT]
> ----------------------------------------------------------------
> file            | line % | branch % | function %
> ----------------------------------------------------------------
> src/math.js     |  100.0 |     87.5 |      100.0
> src/validator.js|   92.3 |     75.0 |       85.7
> ----------------------------------------------------------------

- **Line coverage** — percentage of executable lines touched.
- **Branch coverage** — percentage of `if`/`else`, ternary, and logical branches taken.
- **Function coverage** — percentage of defined functions called.

Branch coverage is the most revealing metric. A function can be 100% line-covered yet miss half its branches if you only test the happy path.

> [!PRINCIPAL] Coverage is a floor, not a ceiling
> 100% line coverage does not mean your code is correct — it means every line ran, not that you asserted the right things. Treat low coverage as a clear signal something is untested, but treat high coverage as a *starting point* for confidence, not an ending one. The best tests exercise behaviour from the outside (what does a caller observe?) and drive coverage up as a side-effect, not as a goal.

## Snapshot testing

Snapshot tests capture the serialised output of a function and store it. Future runs compare against the stored snapshot — any change fails the test until you deliberately update the snapshot.

```js
import { test } from "node:test";
import assert from "node:assert/strict";

function formatUser(user) {
  return JSON.stringify(user, null, 2);
}

test("formatUser snapshot", (t) => {
  const output = formatUser({ id: 1, name: "Ada", roles: ["admin"] });
  t.assert.snapshot(output);
});
```

First run: the snapshot is written to a `.snap` file. Subsequent runs compare against it.

Update snapshots when the output change is intentional:

```bash
node --test --test-update-snapshots
```

> [!NOTE] When to reach for snapshots
> Snapshots shine for complex formatted output (HTML, JSON reports, error messages) where writing explicit equality assertions would be tedious. They're poor fits for data that legitimately changes every run (timestamps, random IDs) — filter those out before snapshotting.

## Try it yourself

Here is a pure-JavaScript spy/mock implementation. It records calls, supports canned return values, and can be reset — the same design as `mock.fn()` internally:

```js run
// A minimal spy/mock factory — no Node APIs needed.
function createMock(implementation) {
  const calls = [];
  let _impl = implementation || (() => undefined);
  const onceFns = [];

  function spy(...args) {
    let result, error;
    const fn = onceFns.length ? onceFns.shift() : _impl;
    try {
      result = fn(...args);
    } catch (e) {
      error = e;
      calls.push({ arguments: args, result: undefined, error });
      throw e;
    }
    calls.push({ arguments: args, result, error: undefined });
    return result;
  }

  spy.mock = {
    calls,
    mockImplementation(fn) { _impl = fn; return spy; },
    mockImplementationOnce(fn) { onceFns.push(fn); return spy; },
    reset() { calls.length = 0; onceFns.length = 0; },
    get callCount() { return calls.length; }
  };

  return spy;
}

// --- demo ---
const greet = createMock((name) => "Hello, " + name + "!");

console.log(greet("Ada"));              // Hello, Ada!
console.log(greet("Bob"));              // Hello, Bob!
console.log("calls:", greet.mock.calls.length); // 2
console.log("first arg:", greet.mock.calls[0].arguments[0]); // Ada

// canned one-off value
greet.mock.mockImplementationOnce(() => "Hi there!");
console.log(greet("Carol")); // Hi there!
console.log(greet("Dave"));  // Hello, Dave! (back to original)

// error recording
const risky = createMock(() => { throw new Error("boom"); });
try { risky(); } catch (_) {}
console.log("error recorded:", risky.mock.calls[0].error.message); // boom
```

## Exercises

### Exercise 1: call count assertion helper

Add a `calledTimes(spy, n)` helper that throws if the spy was not called exactly `n` times. Test it with a mock that should be called twice.

<details>
<summary>Show solution</summary>

```js run
function createMock(impl) {
  const calls = [];
  function spy(...args) {
    const result = impl ? impl(...args) : undefined;
    calls.push({ arguments: args, result });
    return result;
  }
  spy.mock = { calls, get callCount() { return calls.length; } };
  return spy;
}

function calledTimes(spy, n) {
  if (spy.mock.callCount !== n) {
    throw new Error(
      "Expected " + n + " call(s), got " + spy.mock.callCount
    );
  }
}

const notify = createMock(() => "sent");
notify("user:1");
notify("user:2");

try {
  calledTimes(notify, 2);
  console.log("PASS calledTimes(2)");
} catch (e) {
  console.log("FAIL", e.message);
}

try {
  calledTimes(notify, 5);
  console.log("FAIL should have thrown");
} catch (e) {
  console.log("PASS caught:", e.message);
}
```

</details>

### Exercise 2: fake timer in pure JS

Implement a `FakeClock` with `tick(ms)` that fires `setTimeout` callbacks registered through it. Test that a callback fires at the right time.

<details>
<summary>Show solution</summary>

```js run
class FakeClock {
  constructor() {
    this.now = 0;
    this.pending = [];
  }
  setTimeout(fn, delay) {
    this.pending.push({ fn, fireAt: this.now + delay });
    this.pending.sort((a, b) => a.fireAt - b.fireAt);
  }
  tick(ms) {
    this.now += ms;
    while (this.pending.length && this.pending[0].fireAt <= this.now) {
      const { fn } = this.pending.shift();
      fn();
    }
  }
}

const clock = new FakeClock();
const log = [];

clock.setTimeout(() => log.push("100ms"), 100);
clock.setTimeout(() => log.push("200ms"), 200);
clock.setTimeout(() => log.push("150ms"), 150);

clock.tick(100);
console.log(log); // ["100ms"]

clock.tick(60);   // total 160ms
console.log(log); // ["100ms", "150ms"]

clock.tick(40);   // total 200ms
console.log(log); // ["100ms", "150ms", "200ms"]
```

</details>

## Common pitfalls

> [!PITFALL] Mocking at the wrong level
> Mocking `Math.random` or `Date.now` globally is fine. Mocking an entire HTTP library when you really just need to test business logic is a red flag — it means your design couples business logic too tightly to infrastructure. Refactor so your core logic takes a `fetchUser(id)` function as a parameter; then your test passes in a mock without touching any globals.

## What you learned

- `t.mock.fn()` records every call's arguments, return values, and errors.
- `t.mock.method()` replaces a method on any object and restores it automatically.
- `t.mock.timers.enable()` + `tick()` lets you control setTimeout/setInterval without waiting for real time.
- `--experimental-test-coverage` surfaces line, branch, and function coverage in a table.
- Snapshot tests catch regressions in complex serialised output; update with `--test-update-snapshots`.

## Next steps

You now know the built-in runner and its mocking toolbox. Next we compare it against the two dominant third-party frameworks — **Vitest** and **Jest** — so you can make an informed choice for each project.
*/});
