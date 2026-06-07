registerQuiz("09-eventemitter", [
  {
    q: "What happens when an `EventEmitter` emits an `'error'` event and there is no listener registered for it?",
    options: [
      "The error is silently swallowed and execution continues normally",
      "Node throws the error and crashes the process, because `'error'` is a special event",
      "The error is queued and replayed when a listener is eventually attached",
      "Node emits a warning to stderr but does not crash"
    ],
    answer: 1,
    explain: "EventEmitter treats `'error'` specially: if it fires with no listener, Node throws the error as an uncaught exception and terminates the process. Always attach `emitter.on('error', handler)` on any emitter that can fail."
  },
  {
    q: "Why can you NOT remove an anonymous function listener with `emitter.off('event', () => {})`?",
    options: [
      "Arrow functions are not supported as EventEmitter listeners",
      "Each arrow function expression creates a new function object, so the reference passed to `off` is not the same object that was registered with `on`",
      "`off` only works for listeners registered with `once`, not `on`",
      "You must use `removeAllListeners` to remove arrow function listeners"
    ],
    answer: 1,
    explain: "`emitter.off(event, fn)` removes the listener by reference equality. `() => {}` creates a brand-new function object each time it is evaluated, so passing a different arrow function expression to `off` will not match the original registration."
  },
  {
    q: "What does `emitter.prependListener('tick', fn)` do compared to `emitter.on('tick', fn)`?",
    options: [
      "It registers the listener to fire only before the first tick, then removes itself",
      "It inserts the listener at the front of the queue so it fires before any other listeners already registered for that event",
      "It registers the listener with a higher priority that lets it cancel the event for other listeners",
      "It is identical to `on`; the name is just an alias"
    ],
    answer: 1,
    explain: "Listeners normally fire in registration order. `prependListener` inserts the new listener at the beginning of the array, ensuring it fires before any listeners that were registered earlier."
  }
]);

registerResources("09-eventemitter", [
  { title: "Node.js EventEmitter API", url: "https://nodejs.org/api/events.html#class-eventemitter" },
  { title: "EventEmitter error event", url: "https://nodejs.org/api/events.html#error-events" },
  { title: "EventEmitter memory leak warning", url: "https://nodejs.org/api/events.html#eventemittersetmaxlistenersn" },
  { title: "Observer pattern (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/API/EventTarget" }
]);

registerQuiz("09-eventtarget", [
  {
    q: "What is the correct way to carry payload data when dispatching a `CustomEvent`?",
    options: [
      "Pass extra arguments after the event name: `dispatchEvent(new CustomEvent('x', payload))`",
      "Set a `payload` property: `new CustomEvent('x', { payload: data })`",
      "Use the `detail` property: `new CustomEvent('x', { detail: data })`",
      "Attach properties directly to the Event object before dispatching"
    ],
    answer: 2,
    explain: "The WHATWG CustomEvent spec defines `{ detail }` as the field for custom payload. Listeners access it via `event.detail`. Any other approach is non-standard and not portable across runtimes."
  },
  {
    q: "How does the `signal` option in `addEventListener` help prevent listener memory leaks?",
    options: [
      "It sets a maximum lifetime for the listener in milliseconds",
      "It automatically removes the listener when the provided AbortSignal is aborted",
      "It limits the number of times the listener can fire before it self-removes",
      "It registers the listener as a WeakRef so garbage collection can clean it up"
    ],
    answer: 1,
    explain: "Passing `{ signal: abortSignal }` to `addEventListener` ties the listener's lifetime to the AbortSignal. When `controller.abort()` is called, the listener is automatically removed without any manual `removeEventListener` call."
  },
  {
    q: "Which statement best describes when to choose `EventTarget` over `EventEmitter`?",
    options: [
      "Always prefer EventEmitter because it is faster and has more features",
      "Use EventTarget for portable library code that must run in browsers, Deno, or edge runtimes; use EventEmitter for Node-internal plumbing that needs introspection like `listenerCount`",
      "Use EventTarget only when you need the `capture` phase, which EventEmitter does not support",
      "Use EventTarget for async events and EventEmitter for synchronous events"
    ],
    answer: 1,
    explain: "EventTarget is the web standard supported by all modern runtimes, making it ideal for portable libraries. EventEmitter is Node-specific but offers richer introspection (listenerCount, setMaxListeners, the special error-event convention) making it the natural choice for Node-internal components."
  }
]);

registerResources("09-eventtarget", [
  { title: "Node.js EventTarget API", url: "https://nodejs.org/api/events.html#class-eventtarget" },
  { title: "MDN EventTarget", url: "https://developer.mozilla.org/en-US/docs/Web/API/EventTarget" },
  { title: "MDN CustomEvent", url: "https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent" },
  { title: "MDN AbortController / AbortSignal", url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController" },
  { title: "WHATWG DOM Events specification", url: "https://dom.spec.whatwg.org/#events" }
]);

registerQuiz("09-events-async", [
  {
    q: "What does `events.once(emitter, 'ready')` return, and what happens if the emitter fires `'error'` first?",
    options: [
      "It returns an EventEmitter and errors are ignored unless you listen for them separately",
      "It returns a Promise that resolves with the event args when `'ready'` fires, and rejects if `'error'` fires first",
      "It returns a Promise that resolves with the event args, but errors must be handled with a separate `on('error')` call",
      "It returns an async iterator that yields every occurrence of the named event"
    ],
    answer: 1,
    explain: "`events.once()` wraps `emitter.once` in a Promise. It also listens for `'error'` and rejects the promise if an error fires before the expected event, giving proper promise rejection semantics instead of an unhandled error crash."
  },
  {
    q: "What is a key risk when using `events.on(emitter, 'message')` with a slow `for await...of` loop body?",
    options: [
      "Events can be lost if the loop body throws an error",
      "The internal event queue is unbounded; if events arrive faster than the body processes them, memory grows without limit",
      "The loop can only handle a maximum of 16 events before it stops automatically",
      "Calling `break` inside the loop leaves the emitter in a broken state"
    ],
    answer: 1,
    explain: "`events.on()` buffers every emitted event in an internal queue until the `for await` body consumes it. If the body is slow and events arrive quickly, the queue grows indefinitely. Always ensure the event rate is bounded or add explicit backpressure."
  },
  {
    q: "How do you cleanly stop a `for await...of` loop driven by `events.on()` without using a `break` statement?",
    options: [
      "Call `emitter.removeAllListeners()` from outside the loop",
      "Pass an AbortSignal via `{ signal }` option; aborting the signal causes the loop to throw an AbortError and exit",
      "Set a flag variable inside the loop body and check it at the top of each iteration",
      "Call `emitter.destroy()` which automatically terminates all async iterators"
    ],
    answer: 1,
    explain: "Passing `{ signal }` to `events.on()` ties the async iterator's lifetime to an AbortSignal. When `controller.abort()` is called, the iterator throws an AbortError into the `for await` loop, cleanly stopping iteration."
  }
]);

registerResources("09-events-async", [
  { title: "events.once documentation", url: "https://nodejs.org/api/events.html#eventsonceemitter-name-options" },
  { title: "events.on async iterator", url: "https://nodejs.org/api/events.html#eventsonemitter-eventname-options" },
  { title: "Node.js events module", url: "https://nodejs.org/api/events.html" },
  { title: "MDN for-await-of", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of" },
  { title: "MDN AbortSignal.timeout", url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static" }
]);
