registerLesson("02-async-await", `
---
id: 02-async-await
title: async / await & Error Handling
minutes: 26
level: intermediate
objectives:
  - Rewrite promise chains as clean async/await
  - Handle errors with try/catch the right way
  - Avoid the accidental-serial-await performance trap
---

# async / await & Error Handling

## Why this matters

\`async/await\` lets you write asynchronous code that *reads* like synchronous code — top to bottom, with normal \`try/catch\` for errors. It's how virtually all modern Node is written. But it has sharp edges (accidental serial awaits, swallowed errors) that separate people who "use" it from people who truly understand it. Let's get you in the second group.

## Learning objectives

- Convert promise chains to **\`async/await\`**.
- Handle async errors with **\`try/catch\`**.
- Run independent work **in parallel** instead of accidentally serial.

## The two keywords

- **\`async\`** before a function makes it always return a **promise**.
- **\`await\`** pauses inside an async function until a promise settles, then gives you its value.

~~~js run
function delay(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

async function run() {
  console.log("start");
  const result = await delay(300, "the value"); // pauses here for 300ms
  console.log("got:", result);
  return result; // run() resolves to this
}

run().then(final => console.log("run() resolved to:", final));
console.log("this prints before 'got:' — run() returned immediately");
~~~

Read the output order. \`run()\` returns a promise *immediately* at the first \`await\`; the rest of \`run\` continues later. The synchronous code after \`run()\` runs first.

> [!NOTE] await only works inside async functions...
> ...or at the **top level of an ES module**. Modern Node supports **top-level await** in \`.mjs\` files and ESM packages, so you can \`await\` directly in a module's top scope without wrapping it in a function.

## The same chain, rewritten

Remember the promise chain from last lesson? Here it is as \`async/await\` — notice how it reads like a simple recipe:

~~~js run
function step(name) {
  return new Promise(r => setTimeout(() => { console.log("finished", name); r(name); }, 150));
}

async function pipeline() {
  await step("login");
  await step("load profile");
  await step("load settings");
  await step("render page");
  console.log("all done — reads like sync code!");
}

pipeline();
~~~

No \`.then\`, no nesting — just one line after another. This is the clarity \`async/await\` buys you.

## Error handling with try/catch

With \`async/await\`, a rejected promise behaves like a thrown error — so you catch it with ordinary \`try/catch\`:

~~~js run
function fetchUser(id) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (id <= 0) reject(new Error("Invalid id: " + id));
      else resolve({ id, name: "User " + id });
    }, 150);
  });
}

async function load(id) {
  try {
    const user = await fetchUser(id);
    console.log("✅ loaded:", user);
  } catch (err) {
    console.error("❌ caught:", err.message);
  } finally {
    console.log("cleanup runs either way");
  }
}

load(42);   // success path
load(-1);   // error path
~~~

> [!PITFALL] An async function that throws rejects its promise
> If you \`await load(-1)\` and \`load\` *didn't* catch internally, the rejection would propagate to *your* \`try/catch\`. But if nothing ever catches a rejected promise, Node logs an **unhandledRejection** warning (and can crash). Every async operation needs a \`catch\` somewhere up the chain.

~~~js run
async function risky() {
  throw new Error("boom"); // same as returning a rejected promise
}

// Forgetting to catch:
// risky(); // -> would trigger an unhandledRejection

// Handling it:
risky().catch(err => console.log("handled at call site:", err.message));
~~~

## The accidental-serial-await trap

This is the most common \`async/await\` performance mistake. \`await\` pauses until the promise settles — so awaiting independent operations **one after another** runs them in **series**, wasting time:

~~~js run
function fetchThing(name, ms) {
  return new Promise(r => setTimeout(() => r(name), ms));
}

async function slowVersion() {
  const t0 = Date.now();
  const a = await fetchThing("A", 300); // wait 300ms...
  const b = await fetchThing("B", 300); // ...THEN wait another 300ms
  const c = await fetchThing("C", 300); // ...THEN another
  console.log([a, b, c], "took ~" + (Date.now() - t0) + "ms"); // ~900ms 😱
}
slowVersion();
~~~

If A, B, and C don't depend on each other, start them **all at once** and await them together with \`Promise.all\`:

~~~js run
function fetchThing(name, ms) {
  return new Promise(r => setTimeout(() => r(name), ms));
}

async function fastVersion() {
  const t0 = Date.now();
  // Start all three immediately, THEN await the combined promise
  const [a, b, c] = await Promise.all([
    fetchThing("A", 300),
    fetchThing("B", 300),
    fetchThing("C", 300)
  ]);
  console.log([a, b, c], "took ~" + (Date.now() - t0) + "ms"); // ~300ms ✅
}
fastVersion();
~~~

> [!PRINCIPAL] Serial when dependent, parallel when independent
> The rule that marks a strong engineer: **await in series only when each step needs the previous step's result.** If operations are independent, fire them together with \`Promise.all\`. Reviewing code, "a row of sequential awaits" should make you ask: do these really depend on each other?

## Looping with await

To process items **one at a time**, \`for...of\` with \`await\` is clean and correct:

~~~js run
function process(item) {
  return new Promise(r => setTimeout(() => { console.log("processed", item); r(); }, 100));
}

async function run() {
  const items = ["a", "b", "c"];
  for (const item of items) {
    await process(item); // strictly one after another
  }
  console.log("all processed in order");
}
run();
~~~

> [!WARNING] array.forEach does NOT await
> \`items.forEach(async item => await process(item))\` does **not** wait — \`forEach\` ignores the returned promises and your "all done" runs too early. Use \`for...of\` for sequential, or \`Promise.all(items.map(...))\` for parallel.

### Exercise: parallelise this

The code below is accidentally serial. Make the two independent fetches run in parallel.

~~~js run
function getProfile() { return new Promise(r => setTimeout(() => r({ name: "Ada" }), 250)); }
function getPosts()   { return new Promise(r => setTimeout(() => r(["post1", "post2"]), 250)); }

async function loadDashboard() {
  const t0 = Date.now();
  // FIX ME: these don't depend on each other.
  const [profile, posts] = await Promise.all([getProfile(), getPosts()]);
  console.log(profile, posts, "in ~" + (Date.now() - t0) + "ms"); // aim for ~250ms
}
loadDashboard();
~~~

## What you learned

- \`async\` functions return promises; \`await\` unwraps a promise's value.
- Handle async errors with ordinary **\`try/catch\`**; unhandled rejections are bugs.
- **Top-level await** works in ES modules.
- Awaiting independent work serially is slow — parallelise with \`Promise.all\`; never rely on \`forEach\` to await.

## Next steps

Now that you can run things in parallel, let's master the full toolkit: \`Promise.all\`, \`allSettled\`, \`race\`, \`any\`, and how to **limit** concurrency so you don't overwhelm a server.
`);
