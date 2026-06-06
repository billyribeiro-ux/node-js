registerLesson("04-timers-and-microtasks", `
---
id: 04-timers-and-microtasks
title: Timers, setImmediate, nextTick & Microtasks
minutes: 28
level: intermediate
objectives:
  - Distinguish macrotasks from microtasks
  - Understand process.nextTick and its priority
  - Avoid starving the event loop
---

# Timers, setImmediate, nextTick & Microtasks

## Why this matters

There are two distinct queues of deferred work in Node: **macrotasks** (timers, I/O, setImmediate) and **microtasks** (promises, \`queueMicrotask\`, \`process.nextTick\`). Misunderstanding their priority causes ordering bugs and — worse — **event loop starvation**, where greedy microtasks freeze your server. This lesson makes the rules exact so you never guess again.

## Learning objectives

- Define **macrotask** vs **microtask** and their priority.
- Understand **\`process.nextTick\`** and why it outranks everything.
- Recognise and prevent **starvation**.

## Two queues, one rule

Think of deferred callbacks as living in two kinds of queues:

- **Macrotask queues** — one per event-loop phase: \`setTimeout\`/\`setInterval\` (timers), I/O callbacks (poll), \`setImmediate\` (check).
- **Microtask queue** — promise callbacks (\`.then\`/\`await\`), \`queueMicrotask\`, and the special \`process.nextTick\`.

**The rule:** after every single macrotask (and after the initial synchronous run), Node **drains the entire microtask queue** before moving on. Microtasks always run before the next macrotask.

~~~js run
console.log("1 sync");

setTimeout(() => console.log("5 macrotask (timeout)"), 0);

Promise.resolve()
  .then(() => console.log("3 microtask"))
  .then(() => console.log("4 microtask (chained)"));

console.log("2 sync");

// Order: 1, 2 (sync), then 3, 4 (all microtasks drained), then 5 (macrotask)
~~~

Notice the chained \`.then\` (4) runs **before** the timer (5). Even microtasks *added while draining* are processed before the loop continues to the next macrotask. That's the "drain completely" part.

## process.nextTick: the VIP queue

Node has an extra queue that outranks even ordinary microtasks: **\`process.nextTick\`**. Its callbacks run *immediately* after the current operation, before promise microtasks and before the loop continues.

~~~js run
// (process.nextTick is Node-only; here's the precedence it has)
Promise.resolve().then(() => console.log("2 promise microtask"));
queueMicrotask(() => console.log("3 queueMicrotask"));
// process.nextTick(() => console.log("1 nextTick")); // would run FIRST in Node
console.log("0 sync");

// In real Node the order is: 0 (sync), 1 (nextTick), 2 (promise), 3 (queueMicrotask)
~~~

The precedence, highest to lowest:

| Priority | Queue | Examples |
|----------|-------|----------|
| 1 (highest) | nextTick queue | \`process.nextTick()\` |
| 2 | microtask queue | promises, \`await\`, \`queueMicrotask()\` |
| 3 | macrotask phases | \`setTimeout\`, I/O, \`setImmediate\` |

> [!PRINCIPAL] When to actually use nextTick
> Rarely. Its main legitimate use is letting an API "look" asynchronous and giving callers a chance to attach listeners before an event fires — e.g. deferring an \`emit\` so a \`.on(...)\` registered on the next line still catches it. For almost all deferral, prefer \`queueMicrotask\` (standard) or \`setImmediate\` (lets I/O breathe). Overusing \`nextTick\` is a classic source of starvation — which is exactly our next topic.

## Starvation: the dangerous trap

Because Node drains microtasks (and nextTicks) *completely* before continuing the loop, a microtask that keeps scheduling more microtasks **never lets the loop reach I/O or timers**. The server appears frozen — it's busy spinning on microtasks.

~~~js run
// DANGER (don't do this in real code): a self-scheduling microtask.
let count = 0;
function greedy() {
  count++;
  if (count < 5) {
    // In real Node, recursive process.nextTick here would starve I/O forever.
    queueMicrotask(greedy);
  } else {
    console.log("finally stopped after", count, "microtasks");
  }
}

setTimeout(() => console.log("the timer FINALLY gets to run"), 0);
greedy();
console.log("sync done — but the timer waits until microtasks drain");
~~~

In this toy version we stop at 5. But imagine a recursive \`process.nextTick\` with no stop condition: the timer callback would *never* run, and a real server would stop responding entirely while pegging a CPU core.

> [!PITFALL] Recursive nextTick / microtasks = frozen server
> If you must do work repeatedly, yield to the loop between iterations with **\`setImmediate\`** (which runs in the check phase, *after* I/O gets a turn) rather than \`nextTick\`/\`queueMicrotask\` (which run before the loop continues). This single distinction prevents a whole class of "my server randomly hangs" incidents.

## Breaking up heavy work correctly

Say you must process a huge array but don't want to block. Splitting it across event-loop ticks with \`setImmediate\` keeps the server responsive between chunks:

~~~js run
function processInChunks(items, chunkSize, onItem, done) {
  let i = 0;
  function next() {
    const end = Math.min(i + chunkSize, items.length);
    for (; i < end; i++) onItem(items[i]);
    if (i < items.length) {
      setImmediate(next); // yield: let I/O and timers run between chunks
    } else {
      done();
    }
  }
  next();
}

const big = Array.from({ length: 20 }, (_, n) => n);
let sum = 0;
processInChunks(big, 5, n => { sum += n; }, () => console.log("total:", sum));
console.log("scheduled — not blocking");
~~~

With \`setImmediate\` between chunks, incoming requests and timers get serviced *between* batches. With a plain \`for\` loop over millions of items, they wouldn't — the loop would block until done.

### Exercise: order it

Predict the exact output order, then run.

~~~js run
console.log("start");
setTimeout(() => console.log("timeout"), 0);
Promise.resolve().then(() => console.log("promise 1")).then(() => console.log("promise 2"));
queueMicrotask(() => console.log("queueMicrotask"));
console.log("end");
~~~

<details>
<summary>Answer</summary>

**start, end, promise 1, queueMicrotask, promise 2, timeout.**

- \`start\`, \`end\` — synchronous.
- Microtasks drain next: \`promise 1\` and \`queueMicrotask\` are queued during sync execution, so they run in order. \`promise 2\` was queued *by* \`promise 1\` while draining, so it runs after \`queueMicrotask\`.
- \`timeout\` — the macrotask, last.
</details>

## What you learned

- **Microtasks** (promises, \`queueMicrotask\`, \`nextTick\`) drain completely after every macrotask and before the loop continues.
- Priority: **\`process.nextTick\`** > promise microtasks > macrotasks (timers/I/O/immediate).
- Recursive microtasks/nextTicks cause **starvation** — a frozen, CPU-pegged server.
- To chunk heavy work safely, yield with **\`setImmediate\`**, not \`nextTick\`.

## Next steps

The last piece of the puzzle: the **libuv thread pool** that makes "non-blocking" file and crypto operations possible, and the golden rule of never blocking the loop.
`);
