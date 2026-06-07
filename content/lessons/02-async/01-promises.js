registerLesson("02-promises", `
---
id: 02-promises
title: Promises, Properly
minutes: 28
level: beginner
objectives:
  - Understand the three states of a promise
  - Create promises and consume them with then/catch/finally
  - Chain promises to flatten callback hell
---

# Promises, Properly

## Why this matters

A **promise** is JavaScript's object for "a value that will exist later." It's the foundation of all modern async code — \`async/await\` is just nicer syntax over promises. Understand promises deeply and async stops being scary. Stay fuzzy on them and you'll write subtle bugs forever. We're going to make them crystal clear.

@diagram:promise-states

## Learning objectives

- Explain a promise's three **states**.
- **Create** a promise and **consume** it with \`.then\`, \`.catch\`, \`.finally\`.
- **Chain** promises to replace nested callbacks.

## What a promise is

A promise is an object representing the eventual result of an async operation. It's always in one of three states:

- **pending** — the work is still happening.
- **fulfilled** — the work succeeded, and the promise has a value.
- **rejected** — the work failed, and the promise has an error.

Once it leaves pending (it "settles"), it never changes again. Let's see one:

~~~js run
// A promise that fulfils after 300ms
const promise = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve("the result!"); // call resolve() to fulfil
    // reject(new Error("oops")) // ...or reject() to fail
  }, 300);
});

console.log("promise created, currently pending");

promise.then(value => {
  console.log("fulfilled with:", value);
});
~~~

The function you pass to \`new Promise\` is the **executor**. It receives two functions: call \`resolve(value)\` on success, \`reject(error)\` on failure.

## Consuming a promise

Three methods handle the outcome:

~~~js run
function fetchUser(id) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (id <= 0) reject(new Error("Invalid id: " + id));
      else resolve({ id, name: "User " + id });
    }, 200);
  });
}

fetchUser(42)
  .then(user => console.log("✅ got user:", user))   // runs on fulfil
  .catch(err => console.error("❌ error:", err.message)) // runs on reject
  .finally(() => console.log("done (runs either way)")); // always runs
~~~

Now trigger the error path:

~~~js run
function fetchUser(id) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (id <= 0) reject(new Error("Invalid id: " + id));
      else resolve({ id, name: "User " + id });
    }, 200);
  });
}

fetchUser(-5)
  .then(user => console.log("✅ got user:", user))
  .catch(err => console.error("❌ error:", err.message))
  .finally(() => console.log("done"));
~~~

> [!NOTE] then has an optional second argument
> \`.then(onFulfilled, onRejected)\` exists, but the idiomatic style is \`.then(...).catch(...)\` — it reads better and catches errors from the \`then\` callback too.

## Chaining: the cure for callback hell

Here's the magic. **Returning a value from \`.then\` passes it to the next \`.then\`. Returning a *promise* makes the chain wait for it.** This flattens the pyramid into a clean vertical sequence:

~~~js run
function step(name) {
  return new Promise(resolve => {
    setTimeout(() => { console.log("finished", name); resolve(name); }, 150);
  });
}

// Compare this to the callback pyramid from the last lesson:
step("login")
  .then(() => step("load profile"))
  .then(() => step("load settings"))
  .then(() => step("render page"))
  .then(() => console.log("all done — flat and readable!"))
  .catch(err => console.error("any step failed:", err.message));
~~~

One \`.catch\` at the end handles a failure in **any** step. That's a massive improvement over repeating error checks in every nested callback.

Values flow through the chain:

~~~js run
Promise.resolve(5)                    // a pre-fulfilled promise
  .then(n => n * 2)                   // 10
  .then(n => n + 1)                   // 11
  .then(n => {
    if (n > 10) throw new Error("too big!"); // throwing rejects the chain
    return n;
  })
  .then(n => console.log("never reached:", n))
  .catch(err => console.log("caught:", err.message)); // "too big!"
~~~

> [!PITFALL] Forgetting to return inside then
> If you call an async function inside \`.then\` but forget to **return** it, the chain doesn't wait for it — leading to out-of-order bugs. Always \`return\` the promise you want the chain to await.

~~~js run
function step(name) {
  return new Promise(r => setTimeout(() => { console.log("did", name); r(); }, 100));
}

// BUG: no return — "B" is not awaited, so "all done" may print before "did B"
step("A")
  .then(() => { step("B"); })          // missing return!
  .then(() => console.log("all done (too early!)"));
~~~

Fix it by adding \`return step("B");\`.

## Useful promise helpers (preview)

~~~js run
const p1 = Promise.resolve("a");
const p2 = new Promise(r => setTimeout(() => r("b"), 200));

// Wait for ALL to fulfil; get an array of results
Promise.all([p1, p2]).then(results => console.log("all:", results)); // ["a","b"]

// Get whichever settles first
Promise.race([p1, p2]).then(winner => console.log("race winner:", winner)); // "a"
~~~

We'll go deep on these in the concurrency lesson.

### Exercise: promisify a delay

Write a \`delay(ms)\` function that returns a promise fulfilling after \`ms\` milliseconds, then use it.

~~~js run
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log("start");
delay(300)
  .then(() => { console.log("after 300ms"); return delay(300); })
  .then(() => console.log("after another 300ms"));
~~~

<details>
<summary>Bonus: a delay that resolves with a value</summary>

~~~js run
function delay(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}
delay(200, "hello").then(v => console.log(v)); // "hello" after 200ms
~~~

This pattern — wrapping \`setTimeout\` in a promise — is so common it's built into Node as \`import { setTimeout } from "node:timers/promises"\`.
</details>

## What you learned

- A promise is **pending**, then settles to **fulfilled** or **rejected** — permanently.
- Consume with \`.then\` / \`.catch\` / \`.finally\`.
- **Chaining** (returning values or promises from \`.then\`) flattens callback hell, with one \`.catch\` for the whole chain.
- Always **return** inside \`.then\` when you want the chain to wait.

## Next steps

Promises are great, but \`async/await\` makes them read like ordinary synchronous code. That's next — and it's how you'll write async Node from now on.
`);
