registerLesson("02-call-stack-and-callbacks", `
---
id: 02-call-stack-and-callbacks
title: The Call Stack & Callbacks
minutes: 24
level: beginner
objectives:
  - Understand synchronous execution and the call stack
  - Understand what "asynchronous" really means
  - Use callbacks and recognise callback hell
---

# The Call Stack & Callbacks

## Why this matters

Node's entire personality — fast, scalable, non-blocking — comes from how it handles things that take time (reading files, network requests, timers). To understand that, you first need a crisp mental model of **synchronous** code and the **call stack**. Then you'll meet **callbacks**, the original way Node handled async work, and feel the pain ("callback hell") that motivated promises. This is the on-ramp to everything async.

## Learning objectives

- Explain the **call stack** and synchronous, top-to-bottom execution.
- Define **asynchronous** and why Node needs it.
- Write callback-based code and recognise its limits.

## Synchronous code and the call stack

By default, JavaScript runs **one line at a time, top to bottom**, and only moves on when the current line finishes. It tracks "where am I?" using a **call stack** — a stack of function calls.

~~~js run
function greet(name) {
  return "Hello, " + name;
}
function welcome(name) {
  const message = greet(name); // pushes greet onto the stack, waits for it
  console.log(message);
}

console.log("Start");
welcome("Ada");   // pushes welcome, which pushes greet
console.log("End");
~~~

The stack here grows and shrinks: \`welcome\` is called, which calls \`greet\`; \`greet\` returns, then \`welcome\` returns. Everything happens in strict order. **Synchronous = blocking**: while \`greet\` runs, nothing else can.

> [!PITFALL] Blocking is dangerous in Node
> Because Node handles many users on essentially one thread, a slow synchronous operation **freezes the entire server** for everyone. A loop that runs for 5 seconds means no other request is served for 5 seconds. This is *the* reason async matters so much in Node.

~~~js run
// This blocks for real — every other line waits for the loop to finish.
console.log("before");
let total = 0;
for (let i = 0; i < 50_000_000; i++) total += i;
console.log("after the heavy loop:", total);
~~~

## What "asynchronous" means

Some operations take time but don't need the CPU while they wait — reading a file from disk, fetching a URL, or a timer. Node hands these off to the operating system and **keeps running other code**. When the operation finishes later, Node runs a function you provided. That function is a **callback**.

The simplest example is \`setTimeout\`, which schedules a callback to run after a delay:

~~~js run
console.log("1. First");

setTimeout(() => {
  console.log("3. This runs LAST, after the delay");
}, 0); // even with 0ms!

console.log("2. Second");

// Output order: 1, 2, 3 — not 1, 3, 2!
~~~

Read that output carefully. Even with a \`0\`ms delay, the callback runs **after** the synchronous code. That's the key insight: async callbacks are deferred until the current synchronous work is completely done. (Exactly *why* is the event loop — Module 4.)

## Callbacks: the original async pattern

A callback is just a function you pass to another function, to be called "when you're ready." Node's traditional file API uses them, with an **error-first** convention — the first argument is an error (or \`null\`):

~~~js
// Node's classic error-first callback style (read-only — needs real Node + a file)
import fs from "node:fs";

fs.readFile("data.txt", "utf8", (err, contents) => {
  if (err) {
    console.error("Failed to read file:", err.message);
    return;
  }
  console.log("File contents:", contents);
});

console.log("This logs BEFORE the file is read");
~~~

> [!OUTPUT]
> This logs BEFORE the file is read
> File contents: (whatever was in data.txt)

> [!NOTE] Error-first is a convention, not a rule
> \`(err, result) => { ... }\` — check \`err\` first, every time. This pattern is everywhere in older Node code and many libraries. Modern code uses promises (next lesson), but you'll still meet callbacks, so you must read them fluently.

You can simulate a callback-style async function in the browser using \`setTimeout\`:

~~~js run
// Pretend this fetches a user from a database after some delay.
function getUser(id, callback) {
  setTimeout(() => {
    if (id <= 0) {
      callback(new Error("Invalid id"), null);
    } else {
      callback(null, { id, name: "User " + id });
    }
  }, 200);
}

getUser(42, (err, user) => {
  if (err) return console.error("Error:", err.message);
  console.log("Got:", user);
});
console.log("Request sent, waiting...");
~~~

## Callback hell

Callbacks work, but when one async step depends on the previous, they nest — and nest — into a rightward-drifting pyramid that's hard to read and harder to handle errors in:

~~~js run
function step(name, next) {
  setTimeout(() => { console.log("finished", name); next(); }, 150);
}

// The dreaded pyramid:
step("login", () => {
  step("load profile", () => {
    step("load settings", () => {
      step("render page", () => {
        console.log("all done — but look how deep we are!");
      });
    });
  });
});
~~~

Every new step adds indentation. Error handling must be repeated in each callback. Sharing data between steps is awkward. This pain — real and widespread — is exactly what **promises** were invented to fix.

### Exercise: spot the order

Without running it, predict the output order. Then run to check.

~~~js run
console.log("A");
setTimeout(() => console.log("B"), 0);
console.log("C");
setTimeout(() => console.log("D"), 0);
console.log("E");
~~~

<details>
<summary>Answer</summary>

Order: **A, C, E, B, D**. All synchronous \`console.log\`s run first (A, C, E). The two \`setTimeout\` callbacks are deferred and run afterward, in the order they were scheduled (B then D).
</details>

## What you learned

- JavaScript runs synchronously via a **call stack**; synchronous = blocking.
- Blocking is dangerous in Node because it freezes the whole server.
- **Async** operations hand off work and run a **callback** later — deferred after synchronous code.
- Node's classic style is **error-first callbacks**; deeply nested callbacks become **callback hell**.

## Next steps

Promises solve callback hell elegantly. They're the foundation of \`async/await\` and modern Node — let's master them next.
`);
