registerQuiz("02-call-stack-and-callbacks", [
  {
    q: "Given this code: console.log('A'); setTimeout(() => console.log('B'), 0); console.log('C'); — what is the output order?",
    options: [
      "A, B, C",
      "A, C, B",
      "B, A, C",
      "C, A, B"
    ],
    answer: 1,
    explain: "Synchronous code runs first: A then C. Even a 0ms setTimeout is deferred to after the current synchronous code finishes. The callback runs when the call stack is empty, so B appears last: A, C, B."
  },
  {
    q: "What is the 'error-first callback' convention in Node.js?",
    options: [
      "Callbacks that handle only errors and ignore successful results",
      "A style where the first argument of the callback is the error (or null on success) and subsequent arguments are results",
      "A convention where errors are thrown instead of passed to callbacks",
      "Callbacks that run only when an error occurs, not on success"
    ],
    answer: 1,
    explain: "Node's error-first callback convention passes an error object (or null if no error) as the first argument, followed by the result. This means you check 'if (err)' before using the result, and it is found throughout older Node APIs like fs.readFile."
  },
  {
    q: "Why is 'callback hell' considered a problem?",
    options: [
      "Callbacks are slow compared to promises",
      "Nested callbacks create deep indentation, duplicate error handling, and make code hard to read and maintain",
      "Callbacks prevent the use of async/await",
      "The JavaScript engine limits nesting depth to three levels"
    ],
    answer: 1,
    explain: "When async steps depend on each other, callbacks must be nested, creating a rightward-drifting pyramid of code. Error handling must be repeated in each callback, and sharing data between steps is awkward. This pain motivated the creation of promises."
  }
]);

registerResources("02-call-stack-and-callbacks", [
  { title: "MDN: Concurrency Model and the Event Loop", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop" },
  { title: "MDN: Callback Function", url: "https://developer.mozilla.org/en-US/docs/Glossary/Callback_function" },
  { title: "Node.js: Error-First Callbacks", url: "https://nodejs.org/en/learn/asynchronous-work/javascript-asynchronous-programming-and-callbacks" },
  { title: "Node.js: Understanding the Event Loop", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" }
]);

registerQuiz("02-promises", [
  {
    q: "Once a promise has settled (moved from pending), what happens if you call resolve() on it again?",
    options: [
      "It throws a TypeError",
      "It transitions back to pending",
      "Nothing — a settled promise's state never changes",
      "It creates a new promise with the new value"
    ],
    answer: 2,
    explain: "A promise moves from pending to either fulfilled or rejected exactly once and permanently. Calling resolve() or reject() again on an already-settled promise has no effect. This immutability is a core property of promises."
  },
  {
    q: "What is the correct way to handle an error in a promise chain?",
    options: [
      "Wrap the entire chain in a try/catch block",
      "Provide an onRejected callback to every .then() call",
      "Attach a single .catch() at the end of the chain",
      "Use process.on('uncaughtException')"
    ],
    answer: 2,
    explain: "A single .catch() at the end of a promise chain catches rejections from any preceding .then() — including errors thrown inside .then() callbacks. This is far cleaner than repeating error handling in every callback."
  },
  {
    q: "Inside a .then() callback, what must you do to make the chain wait for another async operation?",
    options: [
      "Use setTimeout to delay the next step",
      "Return the promise of the async operation",
      "Call .then() on the result inside the callback",
      "Nothing — the chain waits automatically for any async work"
    ],
    answer: 1,
    explain: "If you call an async function inside .then() but forget to return its promise, the chain does not wait for it and moves on immediately. You must return the promise so the next .then() in the chain receives the resolved value."
  }
]);

registerResources("02-promises", [
  { title: "MDN: Using Promises", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises" },
  { title: "MDN: Promise Reference", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise" },
  { title: "Node.js: Overview of Blocking vs Non-Blocking", url: "https://nodejs.org/en/learn/asynchronous-work/overview-of-blocking-vs-non-blocking" },
  { title: "MDN: Promise.all", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all" }
]);

registerQuiz("02-async-await", [
  {
    q: "What does declaring a function with the 'async' keyword guarantee about its return value?",
    options: [
      "The function runs in a separate thread",
      "The function always returns a Promise, even if you return a plain value",
      "The function can use 'await' at the top level without wrapping",
      "The function is automatically retried on failure"
    ],
    answer: 1,
    explain: "An 'async' function always returns a Promise. If you return a plain value like 42, it is automatically wrapped in Promise.resolve(42). This is why you can call .then() on any async function's return value."
  },
  {
    q: "Two independent async operations 'getProfile()' and 'getPosts()' are awaited one after the other. What is the problem and how should you fix it?",
    options: [
      "They run in parallel but results may arrive out of order; use Promise.race to pick the faster one",
      "They run serially, wasting time; start both with Promise.all and await the combined promise",
      "They share the same thread and may deadlock; use worker threads instead",
      "There is no problem — sequential await is always the safest approach"
    ],
    answer: 1,
    explain: "Awaiting independent operations one after another runs them serially, so total time is the sum of both. Since they do not depend on each other, you should fire both immediately and await them together with Promise.all, reducing total time to the duration of the slower one."
  },
  {
    q: "Why does 'array.forEach(async item => await process(item))' not actually await each item?",
    options: [
      "forEach does not support arrow functions with async",
      "forEach ignores the promise returned by each async callback and completes synchronously",
      "await inside forEach causes an unhandled rejection",
      "forEach processes items in reverse order when combined with async"
    ],
    answer: 1,
    explain: "forEach calls each callback but does not await the returned promise — it simply discards them. The result is that all iterations are started but not waited on, and any 'all done' code after forEach runs too early. Use 'for...of' with await for sequential processing, or Promise.all(items.map(...)) for parallel."
  }
]);

registerResources("02-async-await", [
  { title: "MDN: async function", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function" },
  { title: "MDN: await", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await" },
  { title: "MDN: Error Handling with async/await", url: "https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Promises" },
  { title: "Node.js: Asynchronous Programming", url: "https://nodejs.org/en/learn/asynchronous-work/modern-asynchronous-javascript-with-async-and-await" }
]);

registerQuiz("02-concurrency", [
  {
    q: "Which Promise combinator is best for a batch job where some items may fail but you still want to know the outcome of every single item?",
    options: [
      "Promise.all — it waits for every item",
      "Promise.race — it picks whichever finishes first",
      "Promise.allSettled — it reports each outcome (fulfilled or rejected) without aborting",
      "Promise.any — it ignores failures and returns the first success"
    ],
    answer: 2,
    explain: "Promise.allSettled waits for all promises to settle and returns an array of result objects, each with a 'status' of 'fulfilled' or 'rejected'. It never rejects, making it ideal for batch jobs where one failure should not cancel the rest."
  },
  {
    q: "What is the primary use of 'AbortController' in asynchronous Node.js code?",
    options: [
      "To abort a running Node process",
      "To cancel pending async operations by signalling them via an AbortSignal",
      "To restart a failed promise chain from the beginning",
      "To limit the number of concurrent promises"
    ],
    answer: 1,
    explain: "AbortController provides a 'signal' object that can be passed to fetch, timers, streams, and custom async functions. Calling 'controller.abort()' fires an 'abort' event on the signal, allowing operations to stop cleanly. It is a web standard that Node has adopted."
  },
  {
    q: "In the concurrency limiter project, why is 'setImmediate' used inside 'finally' to call the 'next()' function rather than calling it directly?",
    options: [
      "setImmediate is required for proper error handling",
      "Calling next() directly would cause a stack overflow for large queues",
      "The implementation shown calls next() directly in finally; no setImmediate is needed",
      "setImmediate ensures the freed slot is processed after pending microtasks drain"
    ],
    answer: 2,
    explain: "In the lesson's pLimit implementation, next() is called directly inside the .finally() callback — not via setImmediate. The queue drains by calling next() synchronously after each task completes, which is safe because .finally() runs asynchronously as a microtask."
  }
]);

registerResources("02-concurrency", [
  { title: "MDN: Promise.allSettled", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled" },
  { title: "MDN: Promise.race", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race" },
  { title: "MDN: AbortController", url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController" },
  { title: "MDN: Promise.any", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/any" },
  { title: "Node.js Timers Promises API", url: "https://nodejs.org/api/timers.html#timers-promises-api" }
]);
