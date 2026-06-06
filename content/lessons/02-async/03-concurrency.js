registerLesson("02-concurrency", `
---
id: 02-concurrency
title: Concurrency — all / allSettled / race & Limits
minutes: 28
level: intermediate
objectives:
  - Choose the right Promise combinator for the job
  - Cancel async work with AbortController
  - Build a concurrency limiter from scratch
project: true
---

# Concurrency: all / allSettled / race & Limits

## Why this matters

Real Node programs juggle many async operations at once: hundreds of HTTP requests, file reads, database queries. Doing this *well* — getting results in parallel, handling partial failures gracefully, cancelling stale work, and not overwhelming downstream services — is a core professional skill. This lesson gives you the full toolkit and ends with you building a real concurrency limiter.

## Learning objectives

- Use \`Promise.all\`, \`allSettled\`, \`race\`, and \`any\` correctly.
- **Cancel** async operations with \`AbortController\`.
- Build a **concurrency-limited** task runner (your own \`p-limit\`).

## The four combinators

Each takes an array of promises and returns a single promise, but they differ in *when* they settle and *how* they treat failures.

### Promise.all — all must succeed

~~~js run
function ok(v, ms) { return new Promise(r => setTimeout(() => r(v), ms)); }

Promise.all([ok("a", 100), ok("b", 200), ok("c", 50)])
  .then(results => console.log("all:", results)); // ["a","b","c"] after ~200ms
~~~

> [!PITFALL] Promise.all rejects as soon as ONE rejects
> If any promise rejects, \`Promise.all\` immediately rejects with that error — the other results are lost (though those operations keep running). Use it only when you need *every* result and a single failure should abort the whole batch.

~~~js run
function ok(v, ms) { return new Promise(r => setTimeout(() => r(v), ms)); }
function fail(msg, ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)); }

Promise.all([ok("a", 100), fail("b broke", 150), ok("c", 200)])
  .then(r => console.log("never:", r))
  .catch(err => console.log("all rejected with:", err.message)); // "b broke"
~~~

### Promise.allSettled — tell me everything

When you want *all* outcomes, successes and failures alike:

~~~js run
function ok(v, ms) { return new Promise(r => setTimeout(() => r(v), ms)); }
function fail(msg, ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)); }

Promise.allSettled([ok("a", 100), fail("b broke", 150), ok("c", 200)])
  .then(results => {
    for (const r of results) {
      if (r.status === "fulfilled") console.log("✅", r.value);
      else console.log("❌", r.reason.message);
    }
  });
~~~

> [!PRINCIPAL] allSettled is the professional default for batch jobs
> When processing many independent items (sending 1,000 emails, syncing 500 records), one failure shouldn't kill the other 999. \`allSettled\` lets you collect every outcome, then report "947 succeeded, 53 failed" — far more useful than crashing on the first error.

### Promise.race — first to settle wins (success OR failure)

~~~js run
function ok(v, ms) { return new Promise(r => setTimeout(() => r(v), ms)); }

Promise.race([ok("slow", 500), ok("fast", 100)])
  .then(winner => console.log("race:", winner)); // "fast"
~~~

\`race\` is perfect for **timeouts** — race your real work against a timer:

~~~js run
function work(ms) { return new Promise(r => setTimeout(() => r("done"), ms)); }
function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms)); }

Promise.race([work(800), timeout(300)])
  .then(r => console.log(r))
  .catch(err => console.log("⏱", err.message)); // times out at 300ms
~~~

### Promise.any — first SUCCESS wins

\`any\` ignores rejections and resolves with the first *fulfilled* promise (great for "try several mirrors, take whichever responds first"):

~~~js run
function ok(v, ms) { return new Promise(r => setTimeout(() => r(v), ms)); }
function fail(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("down")), ms)); }

Promise.any([fail(100), ok("mirror-2", 200), ok("mirror-3", 150)])
  .then(first => console.log("first success:", first)); // "mirror-3"
~~~

| Combinator | Settles when | On failure |
|------------|--------------|------------|
| \`all\` | all fulfil | rejects on first rejection |
| \`allSettled\` | all settle | never rejects; reports each |
| \`race\` | first settles | first settle wins (even a rejection) |
| \`any\` | first fulfils | ignores rejections; rejects only if all fail |

## Cancelling with AbortController

Sometimes you need to *stop* async work — a user navigated away, a timeout fired. \`AbortController\` is the standard way. It gives you a \`signal\` you pass to async operations (\`fetch\`, timers, streams all accept one):

~~~js run
const controller = new AbortController();
const signal = controller.signal;

function cancellableWork(signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => resolve("work finished"), 1000);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new Error("aborted: " + signal.reason));
    });
  });
}

cancellableWork(signal)
  .then(r => console.log(r))
  .catch(err => console.log("🛑", err.message));

// Change our mind after 300ms:
setTimeout(() => controller.abort("user cancelled"), 300);
~~~

> [!NOTE] AbortSignal is a web standard Node adopted
> The same \`AbortController\` works in browsers and Node. Node's \`fetch\`, \`fs\` promises, and \`timers/promises\` all accept \`{ signal }\`. Designing your own async functions to accept a signal makes them composable and cancellable — a hallmark of well-built APIs.

## Project: build a concurrency limiter

Here's the problem: you have 100 URLs to fetch, but firing 100 requests at once would overwhelm the server (and your machine). You want at most, say, **5 running at a time**. This is exactly what the popular \`p-limit\` library does — and you're going to build it.

~~~js run
function pLimit(maxConcurrent) {
  let activeCount = 0;
  const queue = [];

  function next() {
    if (activeCount >= maxConcurrent || queue.length === 0) return;
    activeCount++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        activeCount--;
        next(); // a slot freed up — start the next queued task
      });
  }

  // Returns a function: pass it a task (an async fn) and get back a promise.
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

// --- Use it ---
const limit = pLimit(2); // at most 2 at a time
let running = 0, maxSeen = 0;

function task(id) {
  return () => new Promise(resolve => {
    running++; maxSeen = Math.max(maxSeen, running);
    console.log("start", id, "(running:", running + ")");
    setTimeout(() => { running--; console.log("done ", id); resolve(id); }, 200);
  });
}

const jobs = [1, 2, 3, 4, 5, 6].map(id => limit(task(id)));

Promise.all(jobs).then(results => {
  console.log("all results:", results);
  console.log("max concurrent ever:", maxSeen, "(should be 2)");
});
~~~

Run it and watch: even though all 6 jobs are queued instantly, only 2 ever run at once. **This is a genuinely useful, production-grade utility you just wrote from scratch.**

### Extend it (acceptance criteria for the full project)

Turn this into a complete mini-library:
1. Add a \`limit.activeCount\` and \`limit.pendingCount\` so callers can introspect.
2. Accept an \`AbortSignal\` so the whole batch can be cancelled.
3. Add a helper \`mapLimit(items, concurrency, asyncFn)\` that maps over an array with limited concurrency.

<details>
<summary>mapLimit, solved</summary>

~~~js run
function pLimit(max) {
  let active = 0; const q = [];
  const next = () => {
    if (active >= max || !q.length) return;
    active++; const { fn, resolve, reject } = q.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); next(); });
}

function mapLimit(items, concurrency, asyncFn) {
  const limit = pLimit(concurrency);
  return Promise.all(items.map(item => limit(() => asyncFn(item))));
}

mapLimit([1, 2, 3, 4, 5], 2, n =>
  new Promise(r => setTimeout(() => r(n * n), 100))
).then(squares => console.log("squares:", squares)); // [1,4,9,16,25]
~~~
</details>

## What you learned

- \`all\` (all-or-nothing), \`allSettled\` (every outcome), \`race\` (first to settle), \`any\` (first success).
- \`allSettled\` is the professional default for independent batch work.
- \`AbortController\`/\`AbortSignal\` is the standard way to **cancel** async work.
- You built a real **concurrency limiter** — the core of \`p-limit\` and countless job systems.

## Next steps

Module 2 is done — you've mastered the hardest part of Node. Module 3 zooms out to the runtime itself: what Node actually *is*, how it's built from V8 and libuv, and the \`process\` object that controls it.
`);
