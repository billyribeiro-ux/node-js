registerLesson("04-non-blocking-io", `
---
id: 04-non-blocking-io
title: The Thread Pool & Never Blocking the Loop
minutes: 26
level: intermediate
objectives:
  - Understand how libuv's thread pool enables async file/crypto work
  - Recognise what blocks the event loop and how to measure it
  - Build an event-loop-lag monitor
project: true
---

# The Thread Pool & Never Blocking the Loop

## Why this matters

"Non-blocking I/O" sounds like magic — how does a single-threaded runtime read files without blocking? The answer is libuv's **thread pool**. Understanding it tells you *which* operations can quietly consume hidden threads, *what* genuinely blocks the loop, and *how* to detect a blocked loop in production. This is where event-loop theory becomes operational skill — and you'll finish Module 4 by building a real monitoring tool.

## Learning objectives

- Explain the **libuv thread pool** and what uses it.
- Identify what **blocks** the event loop and measure **event-loop lag**.
- Build an **event-loop-delay monitor** project.

## How "non-blocking" file I/O actually works

Your JavaScript is single-threaded, but the operating system and libuv are not. When you call an async file operation, here's the dance:

1. Your code calls \`fs.readFile(...)\` and passes a callback. This returns *immediately*.
2. libuv hands the actual disk work to a **worker thread** from its internal pool.
3. Your main thread keeps running other code — serving requests, etc.
4. When the worker finishes, libuv queues your callback.
5. The event loop runs your callback on the main thread (in the poll phase).

So the *waiting* happens off your main thread. You get the result via a callback/promise without ever blocking your JavaScript.

> [!NOTE] The default pool is small
> libuv's thread pool defaults to **4 threads**. It's used for: \`fs\` operations, DNS lookups (\`dns.lookup\`), \`crypto\` (e.g. \`pbkdf2\`, \`scrypt\`), and \`zlib\` compression. Pure network I/O (TCP/HTTP) mostly uses the OS's own async mechanisms and does *not* consume pool threads.

You can resize the pool with an environment variable when you have many concurrent pool-bound operations:

~~~bash
# Give libuv 16 worker threads instead of 4
UV_THREADPOOL_SIZE=16 node app.js
~~~

> [!PRINCIPAL] A real-world pool-exhaustion bug
> Symptom: an app does lots of \`scrypt\` password hashing *and* file reads; under load, everything mysteriously slows down even though CPU and network look fine. Cause: all 4 pool threads are busy hashing, so file reads queue behind them. Fix: raise \`UV_THREADPOOL_SIZE\`, or move CPU-heavy hashing to dedicated worker threads. Diagnosing this requires knowing the pool exists and what shares it — knowledge most developers lack.

## What blocks the loop

The thread pool saves you from blocking on *I/O*. But **CPU-bound JavaScript on the main thread blocks everything** — there's no pool for your own synchronous code. The usual culprits:

- Long \`for\`/\`while\` loops over big data.
- Giant \`JSON.parse\` / \`JSON.stringify\`.
- Synchronous \`fs\` calls (\`readFileSync\`) in a request handler.
- Complex regular expressions on large strings (**ReDoS** — Module 39).
- Heavy synchronous crypto on the main thread.

~~~js run
// This blocks the single thread completely for its duration.
function blockFor(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin — nothing else can run */ }
}

console.log("before");
const start = Date.now();
blockFor(200);                       // nothing else runs for 200ms
console.log("blocked for", Date.now() - start, "ms — server was frozen this whole time");
~~~

During those 200ms, a real server would accept no connections, fire no timers, and run no callbacks. Every connected user waits.

> [!PITFALL] The sync API trap
> Many Node modules offer a tempting synchronous variant: \`fs.readFileSync\`, \`crypto.pbkdf2Sync\`, \`child_process.execSync\`. They're fine in CLI scripts and startup code — but using them inside a request handler **blocks the loop for every user**. In server code, prefer the async/promise versions.

## Measuring event-loop lag

How do you *know* if your loop is blocked in production? You measure **event-loop lag** (also "event-loop delay"): schedule a timer for, say, 100ms and measure how *late* it actually fires. If a 100ms timer fires at 350ms, the loop was blocked for ~250ms.

Modern Node has a precise built-in for this: \`perf_hooks.monitorEventLoopDelay\`.

~~~js
// lag-monitor.js — run with: node lag-monitor.js  (Node-only, read-only here)
import { monitorEventLoopDelay } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

// Simulate some blocking work after 1 second:
setTimeout(() => {
  const end = Date.now() + 300;
  while (Date.now() < end) {} // block for 300ms
}, 1000);

// Report every 2 seconds:
setInterval(() => {
  console.log("event loop delay (ms):", {
    min: (histogram.min / 1e6).toFixed(1),
    mean: (histogram.mean / 1e6).toFixed(1),
    p99: (histogram.percentile(99) / 1e6).toFixed(1),
    max: (histogram.max / 1e6).toFixed(1)
  });
  histogram.reset();
}, 2000);
~~~

> [!OUTPUT]
> event loop delay (ms): { min: '0.0', mean: '0.3', p99: '1.1', max: '301.4' }

That \`max: 301.4\` exposes the 300ms block — exactly the kind of spike that shows up as mysterious latency for users. Monitoring this is standard practice in well-run Node services (libraries like \`@nodejs/clinic\` and APM tools build on it).

## Project: a poor-man's lag monitor (runs anywhere)

\`monitorEventLoopDelay\` needs real Node, but you can build a simpler timer-drift monitor with pure JavaScript that runs right here. The principle is identical: schedule a repeating timer and measure how late each tick is.

~~~js run
function startLagMonitor(intervalMs = 100) {
  let expected = Date.now() + intervalMs;
  let maxLag = 0;
  let ticks = 0;

  const id = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;            // how late are we?
    maxLag = Math.max(maxLag, lag);
    expected = now + intervalMs;
    ticks++;
    console.log(\`tick \${ticks}: lag \${lag}ms (max so far \${maxLag}ms)\`);
    if (ticks >= 6) { clearInterval(id); console.log("done. peak lag:", maxLag + "ms"); }
  }, intervalMs);

  return id;
}

startLagMonitor(100);

// Cause a 250ms block on the 3rd-ish tick to see lag spike:
setTimeout(() => {
  const end = Date.now() + 250;
  while (Date.now() < end) {} // block!
}, 300);
~~~

Run it: most ticks show ~0ms lag, but right after the block, one tick reports ~250ms. **You just built the core of a production health metric.**

### Acceptance criteria (extend the project)

Turn this into a reusable monitor:
1. Expose \`stop()\` and a \`getStats()\` returning \`{ mean, max, samples }\`.
2. Add a threshold callback: warn when lag exceeds, say, 50ms.
3. On real Node, rebuild it with \`monitorEventLoopDelay\` and compare accuracy.
4. Combine it with Module 3's dashboard so your system report includes live loop health.

<details>
<summary>Why timer drift measures loop health</summary>

A timer can only fire when the event loop reaches the timers phase. If the loop is busy (blocked by CPU work, or buried in microtasks), it physically cannot get to the timer on schedule — so the timer fires late. The amount of lateness *is* the amount the loop was blocked. Simple, and remarkably effective.
</details>

## What you learned

- libuv's **thread pool** (default 4) does async \`fs\`, DNS, \`crypto\`, and \`zlib\` work off your main thread; tune it with \`UV_THREADPOOL_SIZE\`.
- Pure network I/O mostly bypasses the pool; **your own CPU-bound JS** is what blocks the loop.
- Measure trouble with **event-loop lag** — late timers reveal a blocked loop; \`monitorEventLoopDelay\` is the precise tool.
- You built a **lag monitor**, the foundation of real production health checks.

## Next steps

🎉 You've completed the **Foundations** tier! You understand JavaScript, async, the runtime, and the event loop — the mental model everything else builds on. Tier 2 begins the **Core Node APIs**, starting with the module system: \`import\` vs \`require\`, \`package.json\`, and the \`node:\` protocol. The rest of the curriculum is mapped out and ready in the sidebar — keep climbing.
`);
