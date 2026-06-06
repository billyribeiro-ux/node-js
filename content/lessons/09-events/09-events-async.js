registerLessonSrc("09-events-async", function () {/*
---
id: 09-events-async
title: "events.once / events.on as Async Iterators"
minutes: 28
level: advanced
objectives:
  - Use events.once() to await a single event as a promise
  - Use events.on() to consume a stream of events with for-await-of
  - Stop async iteration cleanly with AbortSignal
---

# events.once / events.on as Async Iterators

## Why this matters

Callback-based event listeners work, but they fight against `async/await` code. If you want to wait for the next `"data"` event before continuing, or process every `"message"` event sequentially without juggling closures, Node's `events` module has two helpers — `events.once()` and `events.on()` — that bridge the gap. They turn event streams into promises and async iterators, so you can consume events in clean, linear, cancellable `async` functions.

## Learning objectives

- Await a single event with **`events.once(emitter, name)`**.
- Iterate over an event stream with **`events.on(emitter, name)`** and `for await...of`.
- Cancel async iteration cleanly using an **`AbortSignal`**.
- Understand the backpressure and ordering guarantees of async event iteration.

## events.once — awaiting a single event

`events.once(emitter, eventName, options?)` returns a `Promise` that resolves with an array of the event's arguments the first time that event fires. It also listens for `"error"` and rejects if an error event fires first.

```js
import { once } from "node:events";
import { EventEmitter } from "node:events";

const server = new EventEmitter();

async function startup() {
  console.log("waiting for ready...");
  const [port] = await once(server, "ready");
  console.log("server is ready on port", port);
}

startup();
server.emit("ready", 3000);
```

> [!OUTPUT]
> waiting for ready...
> server is ready on port 3000

This is dramatically cleaner than wrapping `emitter.once` in `new Promise(...)` by hand.

### Cancelling once() with AbortSignal

Pass `{ signal }` to abort the wait. The returned promise will reject with an `AbortError` if the signal fires before the event does:

```js
import { once } from "node:events";
import { EventEmitter } from "node:events";

async function waitForConnection(emitter) {
  const signal = AbortSignal.timeout(2000);   // give up after 2 s
  try {
    const [socket] = await once(emitter, "connection", { signal });
    return socket;
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("timed out waiting for connection");
    }
    throw err;
  }
}
```

> [!NOTE] events.once rejects on "error"
> If the emitter fires `"error"` before the expected event, `once()` rejects with that error. This means you get proper promise rejection instead of an unhandled `"error"` event crash — a significant safety improvement over `new Promise` + manual `once`.

## events.on — async iteration over an event stream

`events.on(emitter, eventName, options?)` returns an **async iterable**. Each `yield` from the iterable is an array of the event's arguments. You consume it with `for await...of`:

```js
import { on } from "node:events";
import { EventEmitter } from "node:events";

const messages = new EventEmitter();

async function processMessages() {
  for await (const [msg] of on(messages, "message")) {
    console.log("processing:", msg);
    if (msg === "stop") break;   // break exits the loop cleanly
  }
  console.log("done");
}

processMessages();

messages.emit("message", "hello");
messages.emit("message", "world");
messages.emit("message", "stop");
```

> [!OUTPUT]
> processing: hello
> processing: world
> processing: stop
> done

The `for await` loop is sequential — it waits for each iteration body to complete before consuming the next event. Events that arrive while the body is running are buffered internally, so nothing is dropped.

### Cancelling events.on with AbortSignal

Without cancellation, the `for await` loop runs until a `break` statement or the emitter is garbage-collected. For long-running servers you need explicit cancellation:

```js
import { on } from "node:events";
import { EventEmitter } from "node:events";

async function handleRequests(emitter, signal) {
  try {
    for await (const [req] of on(emitter, "request", { signal })) {
      console.log("handling:", req.url);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("request handler stopped cleanly");
    } else {
      throw err;
    }
  }
}

const ac = new AbortController();
const emitter = new EventEmitter();

handleRequests(emitter, ac.signal);

emitter.emit("request", { url: "/api/users" });
emitter.emit("request", { url: "/api/orders" });
ac.abort();   // stops the iterator after current iteration finishes
```

> [!OUTPUT]
> handling: /api/users
> handling: /api/orders
> request handler stopped cleanly

> [!PRINCIPAL] events.on with AbortSignal is the Node equivalent of RxJS takeUntil
> Reactive libraries solve "stop this stream when X happens" with operators like `takeUntil`. Node's `events.on({ signal })` gives you the same power with zero dependencies. Wire the same `AbortController` to a `fetch`, a timer (`AbortSignal.timeout`), or a parent teardown routine, and all of them stop together — one signal, many resources.

## How the async iterator works internally

Understanding the internals helps you reason about edge cases:

```
events.on(emitter, "data")
        │
        ├── registers emitter.on("data", push)
        ├── registers emitter.on("error", reject)
        └── returns an AsyncIterator with an internal queue

for await (const args of iterator) {
  // each next() call:
  //   - if queue has items → dequeue and yield
  //   - if queue is empty  → suspend until next push()
  //   - if AbortSignal fires → throw AbortError
}
```

Events that arrive faster than the loop body processes them pile up in the queue. This queue is unbounded — if your handler is slow and events are fast you will accumulate memory. Design accordingly, or add a high-water-mark check.

> [!WARNING] Unbounded queue backpressure
> `events.on` buffers every emitted event until the `for await` loop consumes it. A slow async body processing high-frequency events will grow memory without limit. Either ensure the event rate is bounded or add explicit backpressure (track queue depth, pause the emitter, or use streams).

## Try it yourself

Simulate async event processing in pure JS. This runnable implements the queue-based async iterator mechanic from scratch, so you can see exactly how `events.on` works under the hood:

```js run
// Pure-JS async iterator backed by an event queue.
// Teaches the same buffering mechanic that events.on uses internally.

function makeAsyncQueue() {
  const queue = [];
  const resolvers = [];
  let done = false;

  function push(value) {
    if (resolvers.length > 0) {
      // A consumer is already waiting — satisfy it immediately.
      resolvers.shift()({ value, done: false });
    } else {
      queue.push(value);
    }
  }

  function finish() {
    done = true;
    for (const resolve of resolvers) resolve({ value: undefined, done: true });
    resolvers.length = 0;
  }

  const iterator = {
    next() {
      if (queue.length > 0) {
        return Promise.resolve({ value: queue.shift(), done: false });
      }
      if (done) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => resolvers.push(resolve));
    },
    [Symbol.asyncIterator]() { return this; }
  };

  return { push, finish, iterator };
}

async function runDemo() {
  const { push, finish, iterator } = makeAsyncQueue();

  // Simulate events arriving asynchronously
  const events = ["connect", "data:hello", "data:world", "disconnect"];
  let i = 0;
  const timer = setInterval(() => {
    if (i < events.length) {
      push(events[i++]);
    } else {
      clearInterval(timer);
      finish();
    }
  }, 50);

  for await (const event of iterator) {
    console.log("event:", event);
  }
  console.log("stream ended");
}

runDemo();
```

## Exercise: once() as a Promise

Write an async function `waitForEvent(emitter, eventName)` that wraps `emitter.once` in a Promise (the way `events.once` works internally), then use it to await two sequential events from the same emitter.

<details>
<summary>Show solution</summary>

```js run
// Pure-JS implementation of events.once using a MiniEmitter

class MiniEmitter {
  constructor() { this._events = Object.create(null); }
  on(event, fn) {
    (this._events[event] = this._events[event] || []).push(fn);
    return this;
  }
  once(event, fn) {
    const w = (...args) => { fn(...args); this.off(event, w); };
    return this.on(event, w);
  }
  off(event, fn) {
    if (this._events[event])
      this._events[event] = this._events[event].filter((l) => l !== fn);
    return this;
  }
  emit(event, ...args) {
    [...(this._events[event] || [])].forEach((fn) => fn(...args));
  }
}

function waitForEvent(emitter, eventName) {
  return new Promise((resolve, reject) => {
    emitter.once(eventName, resolve);
    emitter.once("error", reject);
  });
}

async function main() {
  const emitter = new MiniEmitter();

  // Schedule events asynchronously so we can await them
  setTimeout(() => emitter.emit("phase1", "database connected"), 10);
  setTimeout(() => emitter.emit("phase2", "cache warmed"), 30);

  const p1 = await waitForEvent(emitter, "phase1");
  console.log("phase 1 done:", p1);

  const p2 = await waitForEvent(emitter, "phase2");
  console.log("phase 2 done:", p2);

  console.log("all phases complete");
}

main();
```

</details>

## Project

**Build an event-driven finite state machine library with typed events and listener leak detection.**

A finite state machine (FSM) manages the lifecycle of a component by allowing only defined transitions between named states. Every transition is an event — making an FSM an ideal testbed for the async event patterns you have just learned.

### Acceptance criteria

1. **State registry**: The FSM constructor accepts an initial state and a transitions map: `{ fromState: { eventName: toState } }`.
2. **Transition events**: When a valid transition fires, the machine emits a `"transition"` event carrying `{ from, event, to }`.
3. **Invalid transition guard**: Attempting an undefined transition emits an `"error"` event (do not throw synchronously) so callers can handle it gracefully.
4. **Async iteration**: Expose a `transitions()` async iterable — backed by a queue — so callers can `for await` over every state change, with the iterable ending cleanly when an `AbortSignal` fires.
5. **Listener leak detection**: After each `addListener` call, if a single event has more than `maxListeners` (default 10) listeners, emit a `"warn"` event with the listener count.
6. **Promise API**: Expose a `waitFor(stateName, signal?)` method that returns a promise resolving the next time the machine enters the given state (using the same internal `"transition"` event), or rejects with an `AbortError` if the signal fires first.

### Starter — pure-JS FSM core

This runnable implements criteria 1–3 (state tracking, transition events, error guard) using the pure-JS `MiniEmitter` from the first lesson. Extend it to satisfy criteria 4–6.

```js run
// FSM starter: state tracking, transition events, error guard.
// Uses a pure-JS MiniEmitter — no Node imports needed.

class MiniEmitter {
  constructor() {
    this._events = Object.create(null);
    this._maxListeners = 10;
  }
  on(event, fn) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(fn);
    const count = this._events[event].length;
    if (count > this._maxListeners) {
      this.emit("warn", { event, count });
    }
    return this;
  }
  once(event, fn) {
    const w = (...args) => { fn(...args); this.off(event, w); };
    w._original = fn;
    return this.on(event, w);
  }
  off(event, fn) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(
      (l) => l !== fn && l._original !== fn
    );
    return this;
  }
  emit(event, ...args) {
    [...(this._events[event] || [])].forEach((fn) => fn(...args));
    return this;
  }
  setMaxListeners(n) { this._maxListeners = n; return this; }
}

class StateMachine extends MiniEmitter {
  constructor(initial, transitions) {
    super();
    this.state = initial;
    this._transitions = transitions;
  }

  send(event) {
    const map = this._transitions[this.state];
    const next = map && map[event];
    if (!next) {
      this.emit("error", new Error(
        `No transition from "${this.state}" on event "${event}"`
      ));
      return this;
    }
    const prev = this.state;
    this.state = next;
    this.emit("transition", { from: prev, event, to: next });
    return this;
  }
}

// --- demonstration ---
const door = new StateMachine("closed", {
  closed:  { open: "open"   },
  open:    { close: "closed", lock: "locked" },
  locked:  { unlock: "open" }
});

door.on("transition", ({ from, event, to }) => {
  console.log(`[transition] ${from} --${event}--> ${to}  (current: ${door.state})`);
});

door.on("error", (err) => {
  console.error("[error]", err.message);
});

door.send("open");           // closed --> open
door.send("lock");           // open   --> locked
door.send("close");          // error: no transition from locked on close
door.send("unlock");         // locked --> open
door.send("close");          // open   --> closed
```

## Common pitfalls

> [!PITFALL] for-await without AbortSignal hangs forever
> `for await (const args of events.on(emitter, "x"))` never terminates unless you `break` out or pass a `{ signal }`. In a long-running server this holds a reference to the emitter forever, preventing garbage collection. Always pair `events.on` with an `AbortSignal` or an explicit `break` condition.

Other traps:

- **Emitting after the iterator is done** — events emitted after `AbortSignal` fires or after a `break` go into the internal queue but are never consumed. Those values are lost. Make sure to stop the emitter-side before stopping the consumer.
- **Mixing `events.on` with synchronous `emit`** — the async iterator only yields on the *next microtask tick*. If you call `emit` synchronously in a loop before your `for await` body has started, all those events are buffered. This is usually fine but can surprise you during testing.
- **Forgetting to handle AbortError** — when a signal fires, `events.on` throws an `AbortError` into the `for await` loop. Without a `try/catch` around the loop, it becomes an unhandled promise rejection.

## What you learned

- **`events.once(emitter, name)`** returns a Promise that resolves with the event args, rejecting on `"error"` or on `AbortSignal`.
- **`events.on(emitter, name)`** returns an async iterable; `for await` consumes each event sequentially, buffering any events that arrive between iterations.
- Passing `{ signal }` to both helpers is the standard way to cancel the wait or stop the loop — matching the broader web-standard `AbortSignal` convention.
- The async iterator pattern is powerful but carries an unbounded internal queue; be aware of backpressure when event rates are high.

## Next steps

You have now covered the full events story: the observer pattern, web-standard `EventTarget`, and async event consumption. The next module dives into **Streams** — Node's higher-level, backpressure-aware abstraction built directly on top of `EventEmitter` that handles exactly the flow-control problems you just saw.
*/});
