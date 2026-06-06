registerLesson("04-event-loop-phases", `
---
id: 04-event-loop-phases
title: Event Loop Phases, Step by Step
minutes: 30
level: intermediate
objectives:
  - Describe what the event loop is and why it exists
  - Name the event loop phases and what each handles
  - Predict execution order involving timers and I/O
---

# Event Loop Phases, Step by Step

## Why this matters

The **event loop** is the heart of Node. It's *why* a single thread can serve thousands of connections. Most developers have a vague sense of it; the ones who truly understand it can reason about execution order, avoid subtle bugs, and never get surprised by async behaviour again. This is the lesson that turns "Node is confusing" into "Node is obvious." Read it slowly.

## Learning objectives

- Explain the **event loop** in plain English.
- Name its **phases** and what work each does.
- Predict the order of timers and I/O callbacks.

## The core idea

Recall from Module 3: Node runs your JavaScript on one thread and never blocks it waiting for slow I/O. But *something* has to coordinate "run this code now, wait for that file, then run its callback later." That coordinator is the **event loop**.

The event loop is, conceptually, a \`while\` loop that never stops while there's work to do. On each turn ("tick"), it checks several queues of pending callbacks and runs the ones that are ready. When a file finishes reading or a timer expires, its callback gets queued, and the loop picks it up on a future tick.

~~~js run
// A mental model of the event loop (simplified pseudo-code):
// while (thereIsWork()) {
//   runExpiredTimers();        // setTimeout / setInterval callbacks
//   runPendingIOCallbacks();   // completed file/network operations
//   runSetImmediateCallbacks();// setImmediate callbacks
//   runCloseCallbacks();       // 'close' events
//   // (microtasks run between EVERY step — see next lesson)
// }
console.log("The loop keeps running as long as there's pending work.");
~~~

## The phases

libuv organises each tick into ordered **phases**. Each phase has a queue; the loop drains that queue, then moves to the next phase. Here are the ones that matter:

| Phase | Handles |
|-------|---------|
| **Timers** | Callbacks from \`setTimeout\` and \`setInterval\` whose time has come |
| **Pending callbacks** | Certain deferred system callbacks (e.g. some TCP errors) |
| **Poll** | Retrieves new I/O events; runs I/O callbacks (file reads, network) |
| **Check** | \`setImmediate\` callbacks |
| **Close** | \`'close'\` event callbacks (e.g. a socket closing) |

The loop cycles through these phases over and over. The **poll** phase is where Node spends most of its time — waiting for and processing I/O (the thing Node is built for).

> [!NOTE] You don't memorise this to use Node
> You can write good Node without reciting the phases. But understanding them lets you *explain* the otherwise-baffling ordering puzzles below — and confidently answer the senior-level interview question, "walk me through the event loop."

## Where your code starts

When you run a script, Node executes all the **synchronous** top-level code first — completely — before the event loop processes any callbacks. Only when the call stack is empty does the loop start handing out queued callbacks.

~~~js run
console.log("1: synchronous");

setTimeout(() => console.log("4: timer callback (loop, timers phase)"), 0);

Promise.resolve().then(() => console.log("3: microtask (between phases)"));

console.log("2: synchronous");

// Order: 1, 2, then 3 (microtask), then 4 (timer)
~~~

The pattern: **all synchronous code → all microtasks → the event loop phases.** (Microtasks are the focus of the next lesson; for now just notice they jump ahead of the timer.)

## setTimeout vs setImmediate

Here's a famous puzzle. \`setImmediate\` runs in the **check** phase; \`setTimeout(…, 0)\` runs in the **timers** phase. Their relative order at the *top level* is technically not guaranteed (it depends on timing details):

~~~js run
setTimeout(() => console.log("setTimeout 0"), 0);
setImmediate(() => console.log("setImmediate"));
// Order here can vary between runs — surprising but true!
~~~

But **inside an I/O callback**, the order becomes deterministic: \`setImmediate\` *always* runs before \`setTimeout\`, because after the poll (I/O) phase, the very next phase is **check** (setImmediate), while timers are only reached on the *next* loop iteration.

~~~js
// Inside an I/O callback, order is GUARANTEED (read-only — needs real fs):
import fs from "node:fs";

fs.readFile(import.meta.filename, () => {
  setTimeout(() => console.log("timeout"), 0);
  setImmediate(() => console.log("immediate"));
});
~~~

> [!OUTPUT]
> immediate
> timeout

> [!PRINCIPAL] Why interviewers love this
> The setTimeout-vs-setImmediate question isn't about trivia — it's a proxy for "do you actually understand the phases?" The deterministic answer *inside I/O* (immediate before timeout) demonstrates you know the poll phase is followed by the check phase. That's the kind of precise mental model that distinguishes senior engineers.

## A worked ordering example

Let's trace a trickier one. Predict the order before running:

~~~js run
console.log("A");

setTimeout(() => console.log("B (timeout)"), 0);

Promise.resolve().then(() => console.log("C (microtask)"));

setTimeout(() => {
  console.log("D (timeout)");
  Promise.resolve().then(() => console.log("E (microtask inside timeout)"));
}, 0);

console.log("F");
~~~

<details>
<summary>The order, explained</summary>

**A, F, C, B, D, E.**

1. \`A\` — synchronous.
2. \`F\` — synchronous (the timeouts are scheduled, not run).
3. \`C\` — microtask; runs after sync code, before any timers.
4. \`B\` — first timer callback.
5. \`D\` — second timer callback.
6. \`E\` — the microtask queued *inside* D runs immediately after D, before the loop continues.

Key insight: microtasks drain completely after each callback, so \`E\` runs right after \`D\`, not at the very end.
</details>

## Project preview: an ordering visualiser

You'll build an event-loop ordering visualiser in this module's project. The core is exactly the kind of tracing above — logging *when* each callback type fires to make the invisible loop visible:

~~~js run
function trace(label) {
  return () => console.log(label, "@ tick");
}

console.log("sync start");
setTimeout(trace("timeout"), 0);
Promise.resolve().then(trace("microtask"));
queueMicrotask(trace("queueMicrotask"));
console.log("sync end");
// Predict, then run. Sync first, then both microtasks, then the timeout.
~~~

## What you learned

- The **event loop** is the coordinator that lets one thread handle many async operations.
- It cycles through ordered **phases**: timers → pending → **poll (I/O)** → check (setImmediate) → close.
- All **synchronous code runs first**, then microtasks, then loop phases.
- \`setImmediate\` vs \`setTimeout(…,0)\` is ambiguous at top level but deterministic inside I/O (immediate first).

## Next steps

We touched on microtasks jumping the queue. Next we'll make that precise: the exact relationship between **macrotasks, microtasks, \`process.nextTick\`, and \`queueMicrotask\`** — and the starvation trap that lurks there.
`);
