registerLessonSrc("09-eventemitter", function () {/*
---
id: 09-eventemitter
title: "EventEmitter: on, once, emit & error events"
minutes: 24
level: intermediate
objectives:
  - Explain the observer pattern and why Node uses it everywhere
  - Use EventEmitter's full API: on, once, emit, off, removeListener, and error events
  - Avoid memory leaks from uncleaned listeners and understand the this-binding rules
---

# EventEmitter: on, once, emit & error events

## Why this matters

Almost every Node.js API you have ever used — HTTP servers, streams, child processes, file watchers — is built on `EventEmitter`. It is Node's answer to the **observer pattern**: objects that broadcast named events and let arbitrary code subscribe without coupling the publisher to its subscribers. Understanding `EventEmitter` at the API level means you can debug mysterious "double-fired" handlers, prevent listener-leak warnings in production, and design your own clean, decoupled APIs.

## Learning objectives

- Explain the **observer pattern** and when it beats callbacks or promises.
- Use the complete `EventEmitter` API: `on`, `once`, `emit`, `off`, `removeListener`, `removeAllListeners`, `listeners`, `getMaxListeners`, and the special `error` event.
- Control **listener order**, **`this` binding**, and **argument passing**.
- Prevent and diagnose listener memory leaks.

## The observer pattern

In the observer (or pub/sub) pattern, an object — the **emitter** — maintains a list of **listeners** keyed by event name. When something interesting happens the emitter calls `emit(name, ...args)` and every registered listener fires with those arguments. The emitter does not know who is listening; the listeners do not know when they will be called. That loose coupling is the whole point.

```
Emitter                   Listeners
  │  emit("data", chunk)    │
  ├─────────────────────────▶  listener A (registered with on)
  ├─────────────────────────▶  listener B (registered with on)
  └─────────────────────────▶  listener C (registered with once, removed after call)
```

Node's `events` module ships a built-in `EventEmitter` class:

```js
import { EventEmitter } from "node:events";

const ee = new EventEmitter();

ee.on("greet", (name) => console.log(`Hello, ${name}!`));
ee.emit("greet", "world");   // Hello, world!
```

> [!OUTPUT]
> Hello, world!

## The full API

### on / addListener

`ee.on(event, listener)` registers a listener that fires **every time** the event is emitted. `addListener` is an exact alias.

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

function onData(chunk) {
  console.log("received:", chunk);
}

ee.on("data", onData);
ee.emit("data", "hello");   // received: hello
ee.emit("data", "world");   // received: world
```

> [!OUTPUT]
> received: hello
> received: world

### once

`ee.once(event, listener)` registers a listener that fires **at most one time**, then removes itself automatically.

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

ee.once("connect", () => console.log("connected!"));
ee.emit("connect");   // connected!
ee.emit("connect");   // (nothing — listener already removed)
```

> [!OUTPUT]
> connected!

### emit

`ee.emit(event, ...args)` fires all listeners for `event` **synchronously**, in registration order, passing the extra arguments. It returns `true` if there was at least one listener, `false` otherwise.

### off / removeListener

`ee.off(event, listener)` (alias `removeListener`) removes exactly one matching listener reference:

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

function handler() { console.log("ping"); }
ee.on("ping", handler);
ee.emit("ping");         // ping
ee.off("ping", handler);
ee.emit("ping");         // (silent — listener removed)
```

> [!OUTPUT]
> ping

> [!PITFALL] Anonymous functions cannot be removed
> `ee.off("ping", () => {})` will do nothing because the arrow function reference is not the same object that was passed to `on`. Store the function in a variable when you need to remove it later.

`ee.removeAllListeners(event)` removes every listener for a given event (or all events if called with no argument). Use it carefully — you may remove listeners added by other parts of the code.

### Listener order and prependListener

Listeners fire in the order they were added. `ee.prependListener(event, fn)` and `ee.prependOnceListener(event, fn)` insert at the front of the queue instead:

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

ee.on("tick", () => console.log("second"));
ee.prependListener("tick", () => console.log("first"));
ee.emit("tick");
```

> [!OUTPUT]
> first
> second

### The special 'error' event

`EventEmitter` treats `"error"` differently from all other events. If you emit `"error"` and there is **no listener**, Node throws the error and crashes the process. Always attach an error listener on any emitter that might fail:

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

// Without this, the emit below would throw and crash:
ee.on("error", (err) => console.error("caught:", err.message));
ee.emit("error", new Error("something went wrong"));
```

> [!OUTPUT]
> caught: something went wrong

> [!PRINCIPAL] Error events as a design contract
> The `"error"` convention exists because exceptions can not propagate across asynchronous boundaries in classic callbacks. Making `"error"` a special event gives every async component a uniform safety valve. When you design your own emitters, always document and emit `Error` objects (not strings) on `"error"` — it gives consumers a proper stack trace. For modern code you can also consider exposing a `.promise()` method alongside the emitter so callers can opt into promise rejection semantics.

### this binding inside listeners

When a listener is a regular function, `this` inside it refers to the emitter that called it:

```js
import { EventEmitter } from "node:events";
class Counter extends EventEmitter {
  constructor() {
    super();
    this.count = 0;
  }
}

const c = new Counter();
c.on("increment", function () {
  this.count++;
  console.log("count:", this.count);
});
c.emit("increment");   // count: 1
c.emit("increment");   // count: 2
```

> [!OUTPUT]
> count: 1
> count: 2

Arrow functions capture `this` from the surrounding scope, so they do **not** get the emitter as `this`. Choose whichever fits your design, but be consistent.

### Listener count and leak warnings

By default, attaching more than **10** listeners to a single event prints a `MaxListenersExceededWarning`. This is a helpful signal that you might be registering listeners in a loop without cleaning them up.

```js
import { EventEmitter } from "node:events";
const ee = new EventEmitter();

ee.setMaxListeners(20);          // raise the limit for this instance
EventEmitter.defaultMaxListeners = 15; // global default (affects all future instances)

console.log(ee.getMaxListeners()); // 20
console.log(ee.listenerCount("data")); // 0
ee.on("data", () => {});
console.log(ee.listenerCount("data")); // 1
```

> [!OUTPUT]
> 20
> 0
> 1

Set the limit to `0` to disable the warning entirely — but do so with care; it hides real leaks.

## Try it yourself

Build a minimal `EventEmitter` from scratch in pure JS so you can see the exact mechanics. This version supports `on`, `once`, `emit`, and `off`:

```js run
// Minimal EventEmitter — pure JS, no Node APIs required.
class MiniEmitter {
  constructor() {
    this._events = Object.create(null);
  }

  on(event, fn) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(fn);
    return this;
  }

  once(event, fn) {
    const wrapper = (...args) => {
      fn(...args);
      this.off(event, wrapper);
    };
    wrapper._original = fn;
    return this.on(event, wrapper);
  }

  off(event, fn) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(
      (l) => l !== fn && l._original !== fn
    );
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events[event];
    if (!listeners || listeners.length === 0) return false;
    // Copy so that once-wrappers that mutate the array mid-loop are safe
    [...listeners].forEach((fn) => fn(...args));
    return true;
  }
}

// --- demonstration ---
const emitter = new MiniEmitter();

emitter.on("log", (msg) => console.log("LOG:", msg));
emitter.once("boot", () => console.log("booted!"));

emitter.emit("log", "starting");   // LOG: starting
emitter.emit("boot");              // booted!
emitter.emit("boot");              // (silent)
emitter.emit("log", "running");    // LOG: running

// Remove a listener
function countFn(n) { console.log("count:", n); }
emitter.on("tick", countFn);
emitter.emit("tick", 1);           // count: 1
emitter.off("tick", countFn);
emitter.emit("tick", 2);           // (silent)
```

## Exercise: typed event bus

Build an event bus where each event name maps to a specific payload shape (simulated with plain objects). Register two listeners on `"order:placed"`, emit the event, then remove one and emit again.

<details>
<summary>Show solution</summary>

```js run
class MiniEmitter {
  constructor() { this._events = Object.create(null); }
  on(event, fn) {
    (this._events[event] = this._events[event] || []).push(fn);
    return this;
  }
  off(event, fn) {
    if (this._events[event])
      this._events[event] = this._events[event].filter((l) => l !== fn);
    return this;
  }
  emit(event, ...args) {
    ([...(this._events[event] || [])]).forEach((fn) => fn(...args));
  }
}

const bus = new MiniEmitter();

function auditLog(order) {
  console.log("AUDIT: order placed for", order.item);
}
function fulfillment(order) {
  console.log("FULFIL: preparing", order.item);
}

bus.on("order:placed", auditLog);
bus.on("order:placed", fulfillment);

console.log("--- emit 1 ---");
bus.emit("order:placed", { id: 1, item: "book" });

bus.off("order:placed", fulfillment);

console.log("--- emit 2 ---");
bus.emit("order:placed", { id: 2, item: "pen" });
```

</details>

## Common pitfalls

> [!PITFALL] Registering listeners inside a loop
> The most common source of MaxListenersExceededWarning is calling `ee.on()` every time a request comes in — creating a fresh listener that is never removed. Move `on()` calls to startup time, or always pair them with a corresponding `off()` / cleanup path.

Extra traps to watch for:

- **Calling emit("error") with a string** — Node will throw the string, not an `Error`, giving you no stack trace. Always pass an `Error` object.
- **Calling `ee.off` without the exact function reference** — it silently does nothing. Use named functions or keep the reference in a closure.
- **Extending EventEmitter but forgetting `super()`** — the internal `_events` map is not initialised and the first `emit` will throw.

## What you learned

- The **observer pattern** decouples publishers from subscribers using named events.
- `on` fires every time; `once` fires once and self-removes; `off` removes a specific listener by reference.
- The `"error"` event is special — no listener means an uncaught throw. Always handle it.
- `this` inside a regular-function listener is the emitter; arrow functions capture outer `this`.
- More than 10 listeners on one event triggers a leak warning; tune with `setMaxListeners`.

## Next steps

`EventEmitter` is a Node-specific class. The next lesson covers `EventTarget` — the **web-standard** equivalent available in browsers, Deno, and modern Node — so you can write event-driven code that runs anywhere.
*/});
