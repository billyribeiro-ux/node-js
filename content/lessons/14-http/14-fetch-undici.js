registerLessonSrc("14-fetch-undici", function () {/*
---
id: 14-fetch-undici
title: "Native fetch & undici"
minutes: 22
level: intermediate
objectives:
  - Use the global fetch API in Node without any imports
  - Work with Request, Response, and Headers objects and AbortSignal timeouts
  - Understand undici's role and how to use connection pooling for high-throughput scenarios
---

# Native fetch & undici

## Why this matters

`fetch` is the universal HTTP client for JavaScript — it works in browsers, Node.js, Deno, Bun, and edge runtimes. Node 18+ ships it globally with no import required. Mastering `fetch` means writing code that runs anywhere. Understanding undici — the library powering Node's `fetch` — unlocks performance tuning like connection pooling and keep-alive for services making thousands of outbound calls.

## Learning objectives

- Use the global `fetch` API with no imports in Node 18+.
- Construct requests with the `Request` / `Response` / `Headers` classes.
- Cancel requests with `AbortSignal.timeout` and custom abort controllers.
- Understand what undici is, why it exists, and how to use its `Pool` for performance.
- Implement a retry-with-exponential-backoff wrapper.

## Global fetch: no import required

Since Node 18, `fetch` is available globally — just like in a browser:

```js
const response = await fetch("https://api.github.com/repos/nodejs/node");

if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

const data = await response.json();
console.log(data.full_name);     // nodejs/node
console.log(data.stargazers_count);
```

> [!OUTPUT]
> nodejs/node
> 107000

`response.ok` is `true` for status codes 200–299. **`fetch` never rejects on HTTP error status codes** — it only rejects on network failures (DNS, connection refused, etc.). Always check `response.ok`.

> [!PITFALL] fetch does not throw on 4xx/5xx
> A 404 or 500 response resolves the promise successfully. Only a network-level failure (no internet, host unreachable) causes rejection. This trips up every developer coming from `axios` or libraries that throw on error status codes.

## Request, Response, and Headers

`fetch` is built on three Web API classes you can construct directly:

```js
// Build a request object separately — useful for logging, middleware, testing
const req = new Request("https://api.example.com/users", {
  method: "POST",
  headers: new Headers({
    "Content-Type": "application/json",
    "Authorization": "Bearer my-token"
  }),
  body: JSON.stringify({ name: "Alice" })
});

const res = await fetch(req);
const user = await res.json();

// Inspect the response
console.log(res.status);                      // 201
console.log(res.headers.get("content-type")); // application/json
console.log(res.headers.has("x-request-id")); // true or false
```

**Reading the response body** — each method returns a promise and can only be called once:

```js
const res = await fetch("https://example.com/data");

// Choose one body reader per response:
const text   = await res.text();      // raw string
const json   = await res.json();      // parsed JSON
const buffer = await res.arrayBuffer(); // binary data
const blob   = await res.blob();      // Blob (browser/Node)
// Or stream it: res.body is a ReadableStream
```

> [!NOTE] Body can only be consumed once
> Once you call `res.json()` or `res.text()`, the body stream is consumed. Calling it again throws. If you need the body in multiple places, `clone()` the response first: `const clone = res.clone()`.

## AbortSignal: timeouts and cancellation

Long-running requests should always have a timeout. `AbortSignal.timeout` makes this one line:

```js
try {
  const res = await fetch("https://slow-api.example.com/data", {
    signal: AbortSignal.timeout(5000) // abort after 5 seconds
  });
  const data = await res.json();
  console.log(data);
} catch (err) {
  if (err.name === "TimeoutError") {
    console.error("Request timed out after 5 s");
  } else {
    throw err;
  }
}
```

For manual cancellation (user cancels, component unmounts, multiple competing requests):

```js
const controller = new AbortController();

// Cancel after 3 s, or on demand
const timer = setTimeout(() => controller.abort(), 3000);

const res = await fetch("https://api.example.com/stream", {
  signal: controller.signal
});

clearTimeout(timer);
// controller.abort() can also be called from outside, e.g., a "Cancel" button
```

> [!PRINCIPAL] Always set a timeout on outbound requests
> In production, a hanging request without a timeout will hold an event-loop slot, a connection, and possibly memory for as long as the remote server delays — which could be forever. `AbortSignal.timeout(5000)` costs nothing and prevents runaway resource leaks. Make it a reflex.

## undici: the engine under the hood

[undici](https://github.com/nodejs/undici) is the HTTP/1.1 and HTTP/2 client library that powers Node's global `fetch`. You can import it directly for lower-level control:

```js
import { request, Pool } from "undici";

// Single request — same as fetch but exposes more details
const { statusCode, headers, body } = await request(
  "https://api.example.com/users"
);
const data = await body.json();
console.log(statusCode, data);
```

### Connection pooling with undici.Pool

For services making many requests to the same origin, a **Pool** keeps connections alive and reuses them:

```js
import { Pool } from "undici";

const pool = new Pool("https://api.example.com", {
  connections: 10,       // max simultaneous connections
  pipelining: 1          // requests pipelined per connection (1 = keep-alive)
});

// All requests through the pool share the connection pool
const results = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    pool.request({ path: `/items/${i}`, method: "GET" })
      .then(r => r.body.json())
  )
);

console.log(`Fetched ${results.length} items`);
await pool.destroy();
```

> [!OUTPUT]
> Fetched 20 items

Without a pool, each `fetch` call performs a new TLS handshake (for HTTPS). A pool amortises that cost across dozens of requests — critical for microservices calling each other at high rates.

## Try it yourself

Here is a `fetch`-with-retry wrapper using exponential backoff. The real logic is pure JavaScript — the `fakeFetch` simulates network calls so you can run and observe it right here:

```js run
// Simulate a flaky fetch: fails the first two calls, then succeeds
let callCount = 0;
function fakeFetch(url) {
  callCount++;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (callCount < 3) {
        reject(Object.assign(new Error("Network error"), { name: "TypeError" }));
      } else {
        resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: "success", call: callCount })
        });
      }
    }, 10);
  });
}

async function fetchWithRetry(url, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 100,
    fetchFn = fakeFetch
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      // Don't retry client errors (4xx) — they won't improve with retrying
      if (err.status && err.status >= 400 && err.status < 500) throw err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

fetchWithRetry("https://api.example.com/data")
  .then(data => console.log("Success:", JSON.stringify(data)))
  .catch(err => console.error("All retries failed:", err.message));
```

## Exercise

**Challenge:** Extend `fetchWithRetry` to accept a `shouldRetry` function `(err, attempt) => boolean` so callers can customise retry logic (e.g., only retry on 429 Too Many Requests). Test it by making the fake fetch return a 503 status on the first two attempts.

<details>
<summary>Show solution</summary>

```js run
let callCount = 0;

function fakeFetch(url) {
  callCount++;
  return new Promise((resolve) => {
    setTimeout(() => {
      if (callCount < 3) {
        resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: "unavailable" })
        });
      } else {
        resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: "ok", attempt: callCount })
        });
      }
    }, 5);
  });
}

async function fetchWithRetry(url, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 50,
    fetchFn = fakeFetch,
    shouldRetry = (err) => !err.status || err.status >= 500
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries && shouldRetry(err, attempt)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Attempt ${attempt + 1} → ${err.message}. Retry in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else if (!shouldRetry(err, attempt)) {
        throw err;
      }
    }
  }
  throw lastError;
}

// Only retry 503s
fetchWithRetry("https://api.example.com/data", {
  shouldRetry: (err) => err.status === 503
})
  .then(d => console.log("Result:", JSON.stringify(d)))
  .catch(e => console.error("Failed:", e.message));
```

</details>

## Common pitfalls

> [!PITFALL] Reading the body twice
> The response body is a one-time stream. If you call `res.json()` then `res.text()`, the second call throws "body used already". Clone the response with `res.clone()` before the first read if you need two passes.

> [!PITFALL] No timeout by default
> `fetch` has no built-in timeout. Without `AbortSignal.timeout()`, a stalled server can hold your request indefinitely. Always add a signal.

## What you learned

- `fetch` is global in Node 18+ — no import needed. It never throws on HTTP error status codes; always check `response.ok`.
- `Request`, `Response`, and `Headers` are composable Web API classes for building and inspecting HTTP messages.
- `AbortSignal.timeout(ms)` is the one-liner for request timeouts; `AbortController` handles manual cancellation.
- undici powers Node's `fetch` and offers a `Pool` API for efficient connection reuse in high-throughput services.
- Exponential backoff retries improve resilience; skip retries for 4xx errors as they won't self-heal.

## Next steps

`fetch` and undici handle plaintext HTTP efficiently. Next we go deeper into **HTTPS, TLS, and HTTP/2** — how encryption works, what certificates do, and why multiplexing matters.
*/});
