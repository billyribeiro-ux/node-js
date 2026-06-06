registerLessonSrc("09-eventtarget", function () {/*
---
id: 09-eventtarget
title: "EventTarget & Web-Compatible Events"
minutes: 22
level: intermediate
objectives:
  - Understand the EventTarget/CustomEvent web standard and how Node exposes it
  - Use addEventListener, dispatchEvent, and removeEventListener fluently
  - Know the key differences between EventTarget and EventEmitter, and when to use each
---

# EventTarget & Web-Compatible Events

## Why this matters

Code that uses `EventEmitter` only runs in Node. Code that uses `EventTarget` runs in browsers, Deno, Bun, Cloudflare Workers, and Node — the entire modern JavaScript universe. As the platform lines blur, writing event-driven logic against the web standard means your utility libraries travel with you. Node 18+ ships a global `EventTarget` and `CustomEvent`, so you get the full API without importing anything.

## Learning objectives

- Explain what **EventTarget** and **CustomEvent** are and where they come from.
- Use `addEventListener`, `dispatchEvent`, and `removeEventListener`.
- Compare `EventTarget` vs `EventEmitter`: which API to reach for and when.
- Use **AbortSignal** as a live `EventTarget` for cancellation.

## EventTarget and CustomEvent: the web standard

`EventTarget` is the DOM interface that every browser element (`window`, `document`, `<button>`) implements. In 2022, Node added it as a global class so you can use it anywhere without importing anything.

An `Event` is a plain event. A `CustomEvent` wraps arbitrary data in its `.detail` property — it is the idiomatic way to carry payload with a dispatched event:

```js
// No import needed in Node 18+ — these are globals.
const target = new EventTarget();

target.addEventListener("greet", (event) => {
  console.log("Hello,", event.detail.name);
});

target.dispatchEvent(new CustomEvent("greet", { detail: { name: "world" } }));
```

> [!OUTPUT]
> Hello, world

### addEventListener options

`addEventListener` accepts a third argument: a boolean (capture phase, rarely needed outside browsers) or an options object:

| Option | Meaning |
|---|---|
| `once: true` | Listener fires once, then auto-removes — same as `emitter.once()` |
| `signal` | An `AbortSignal`; when aborted the listener is automatically removed |
| `capture` | Use capture phase (browser-only concept, rarely relevant in Node) |

```js
const target = new EventTarget();
const ac = new AbortController();

target.addEventListener(
  "ping",
  (e) => console.log("ping received:", e.detail),
  { signal: ac.signal }
);

target.dispatchEvent(new CustomEvent("ping", { detail: 1 }));
ac.abort();   // removes the listener automatically
target.dispatchEvent(new CustomEvent("ping", { detail: 2 }));
```

> [!OUTPUT]
> ping received: 1

### dispatchEvent is synchronous

Like `EventEmitter.emit`, `dispatchEvent` calls listeners **synchronously** before returning. The return value is `false` if any listener called `event.preventDefault()`, and `true` otherwise. (In Node `CustomEvent` contexts `preventDefault` is a no-op for your custom events, but the pattern matters for browser compatibility.)

## EventTarget vs EventEmitter: a side-by-side comparison

Both implement pub/sub, but they differ in meaningful ways:

| Feature | EventEmitter | EventTarget |
|---|---|---|
| Runtime | Node only | Universal (browsers, Node, Deno, Bun) |
| Import | `import { EventEmitter } from "node:events"` | Global (no import) |
| Subscribe | `on(name, fn)` | `addEventListener(name, fn)` |
| Unsubscribe | `off(name, fn)` | `removeEventListener(name, fn)` |
| Fire once | `once(name, fn)` | `{ once: true }` option |
| Auto-cleanup | — | `{ signal: AbortSignal }` option |
| Error event | Special: crashes if unheard | No special treatment |
| Payload | Spread args: `emit("x", a, b)` | Wrapped: `new CustomEvent("x", { detail })` |
| Listener count | `listenerCount(event)` | Not available |
| Max listeners | 10 default, tunable | No limit / no warning |
| Inheritance | Extend via `class Foo extends EventEmitter` | Extend via `class Foo extends EventTarget` |

> [!PRINCIPAL] Choose EventTarget for shared libraries, EventEmitter for Node-internal plumbing
> If you are writing a utility that could run in a browser or an edge runtime, build on `EventTarget`. The `{ signal }` option alone is worth it — callers can wire your listener into an `AbortController` that also cancels a fetch, removing it automatically and eliminating an entire class of listener leak. For Node-internal emitters (streams, process events, inter-module buses), `EventEmitter` remains idiomatic and gives you richer introspection tools like `listenerCount` and the mandatory `"error"` event convention.

## AbortSignal as an EventTarget

`AbortSignal` is itself an `EventTarget`. It fires an `"abort"` event when `.abort()` is called on its controller. This makes it a natural building block for cancellation:

```js
const ac = new AbortController();
const { signal } = ac;

signal.addEventListener("abort", () => {
  console.log("operation cancelled, reason:", signal.reason);
});

// Somewhere later...
ac.abort("timeout");   // triggers the listener above
```

> [!OUTPUT]
> operation cancelled, reason: timeout

You can also poll `signal.aborted` synchronously, or pass the signal directly to `fetch`, `addEventListener`, and other web-standard APIs.

```js
// Abort a listener after 5 seconds using AbortSignal.timeout (Node 17.3+):
const signal = AbortSignal.timeout(5000);

target.addEventListener("data", handler, { signal });
// handler is automatically removed after 5 s, no manual cleanup needed
```

> [!NOTE] AbortSignal.timeout
> `AbortSignal.timeout(ms)` creates a signal that aborts itself after the given number of milliseconds. No `AbortController` needed. It is the cleanest way to give any listener a TTL.

## Try it yourself

Build a tiny pub/sub system on top of `EventTarget` and `CustomEvent` in pure JS — no Node APIs at all. It runs identically in a browser or a Web Worker:

```js run
// Pure-JS pub/sub using web-standard EventTarget + CustomEvent.
// Both classes are available as globals in browsers, Node 18+, and this sandbox.

class PubSub {
  constructor() {
    this._target = new EventTarget();
  }

  subscribe(topic, handler, options) {
    this._target.addEventListener(topic, (e) => handler(e.detail), options);
  }

  publish(topic, payload) {
    this._target.dispatchEvent(new CustomEvent(topic, { detail: payload }));
  }
}

const bus = new PubSub();

// A one-time welcome message
bus.subscribe("user:joined", (user) => console.log("Welcome,", user.name), { once: true });

// A persistent audit logger
bus.subscribe("user:joined", (user) => console.log("AUDIT: user joined:", user.id));

bus.publish("user:joined", { id: 42, name: "Ada" });
// one-time listener fires:   Welcome, Ada
// audit listener fires:      AUDIT: user joined: 42

bus.publish("user:joined", { id: 43, name: "Grace" });
// one-time listener is gone: (no welcome)
// audit listener fires:      AUDIT: user joined: 43
```

## Exercise: cancellable subscription

Create a `PubSub` as above. Subscribe to a `"tick"` event. After 3 ticks, cancel the subscription using an `AbortController` and verify that later ticks are silently ignored.

<details>
<summary>Show solution</summary>

```js run
class PubSub {
  constructor() {
    this._target = new EventTarget();
  }
  subscribe(topic, handler, options) {
    this._target.addEventListener(topic, (e) => handler(e.detail), options);
  }
  publish(topic, payload) {
    this._target.dispatchEvent(new CustomEvent(topic, { detail: payload }));
  }
}

const bus = new PubSub();
const ac = new AbortController();
let tickCount = 0;

bus.subscribe(
  "tick",
  (n) => {
    console.log("tick", n);
    tickCount++;
    if (tickCount >= 3) {
      ac.abort("done listening");
      console.log("subscription cancelled after tick", n);
    }
  },
  { signal: ac.signal }
);

// Simulate 5 ticks
for (let i = 1; i <= 5; i++) {
  bus.publish("tick", i);
}
// Ticks 4 and 5 are silent — listener was removed when AbortController aborted.
```

</details>

## Common pitfalls

> [!PITFALL] CustomEvent detail must be one value
> `dispatchEvent(new CustomEvent("x", { detail: a, b }))` ignores `b`. The `detail` key holds exactly one value — wrap multiple values in an object: `{ detail: { a, b } }`.

Other traps:

- **Using `Event` instead of `CustomEvent` for payload** — `new Event("x")` has no `.detail`. You can set properties directly on an `Event` object in some runtimes but it is non-standard and fragile. Always use `CustomEvent`.
- **Forgetting that `EventTarget` has no `listenerCount`** — there is no programmatic way to inspect how many listeners are registered. If you need introspection, wrap `EventTarget` in your own class that counts.
- **`removeEventListener` with a different function reference** — same gotcha as `EventEmitter.off`: anonymous functions can not be removed. Store the reference.
- **Expecting the `"error"` event to protect you** — `EventTarget` does not have the special crash-on-unheard-error behaviour. If you dispatch an `"error"` CustomEvent with no listener, it is silently ignored.

## What you learned

- `EventTarget` and `CustomEvent` are web standards available globally in Node 18+, browsers, and all major JS runtimes.
- `addEventListener(name, fn, { once, signal })` and `dispatchEvent(new CustomEvent(name, { detail }))` form the complete API.
- `AbortSignal` integrates directly with `addEventListener` via the `signal` option for automatic, leak-free cleanup.
- `EventTarget` wins for portable libraries; `EventEmitter` wins for Node-internal, introspectable buses.

## Next steps

Now that you know both event APIs, the final lesson in this module explores the modern async face of events: `events.once()` as a promise, `events.on()` as an async iterator, and how to use `AbortSignal` to stop iteration — powerful patterns for consuming event streams in `async/await` code.
*/});
