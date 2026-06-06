registerLessonSrc("37-edge-workers", function () {/*
---
id: 37-edge-workers
title: "Cloudflare Workers & the Edge Runtime"
minutes: 24
level: principal
objectives:
  - Explain edge compute and why proximity to users matters
  - Understand V8 isolates vs containers and the Workers runtime model
  - Write a Web-standard fetch handler deployable to Cloudflare Workers
---

# Cloudflare Workers & the Edge Runtime

## Why this matters

Every millisecond of network latency is a millisecond a user waits. When your API runs in a single AWS region, users in Tokyo or São Paulo pay a round-trip to Virginia for every request. **Edge compute** inverts this: your code runs in 300+ locations worldwide, just milliseconds from any user. Cloudflare Workers pioneered this model, and understanding how it works — V8 isolates, Web-standard-only APIs, a completely different runtime contract — is essential context as more of the stack moves to the edge.

## Learning objectives

- Define **edge compute** and explain its latency advantage.
- Contrast **V8 isolates** with containers and explain why isolates start in under 1 ms.
- Write a correct Cloudflare Workers **fetch handler** using only Web-standard APIs.
- Describe KV, Durable Objects, and where Workers fit in the **WinterCG** landscape.

## Edge compute: why location matters

A traditional server deployment looks like this:

```
User (Tokyo) ──── 180 ms ────► Origin server (us-east-1)
                                     │
                               Handler executes
                                     │
User (Tokyo) ◄──── 180 ms ──── Response
Total: ~360 ms just in network RTT
```

Edge compute flips the model. Cloudflare operates data centres in 300+ cities:

```
User (Tokyo) ── 2 ms ──► Cloudflare edge (Tokyo, TYO01)
                                 │
                         Worker executes (<1 ms start)
                                 │
User (Tokyo) ◄── 2 ms ── Response
Total: ~5 ms
```

The entire request-response cycle can complete inside a single city. For read-heavy workloads, personalisation, A/B routing, authentication, and content transformation, this is transformative.

## V8 isolates: not containers, not VMs

Lambda runs your code inside a **Firecracker microVM** — a full Linux OS, Node.js process, and your code. Startup takes at least 100 ms. Workers use a different primitive:

A **V8 isolate** is a lightweight sandbox inside the V8 JavaScript engine (the same engine in Chrome and Node.js). Each isolate has its own heap, is memory-isolated from other isolates, but shares the underlying V8 process. Starting an isolate takes **under 1 millisecond** — no OS boot, no process fork.

| | Lambda (Node.js) | Cloudflare Workers |
|---|---|---|
| Isolation unit | Firecracker MicroVM | V8 isolate |
| Cold start | 100 ms – 1 s | < 1 ms |
| Runtime | Full Node.js | V8 + Web APIs only |
| Node APIs (fs, net, …) | Yes | No |
| Deployment target | One AWS region | 300+ edge locations |
| Max CPU time per request | 15 minutes | 30 s (paid) / 10 ms (free) |
| Memory per worker | Up to 10 GB | 128 MB |

The tradeoff: Workers cannot use Node.js APIs. No `fs`, no `net`, no `Buffer`, no `process`. You get Web-standard APIs: `fetch`, `Request`, `Response`, `URL`, `crypto`, `ReadableStream`, `TextEncoder`. This is a deliberate constraint — it keeps isolates tiny and portable.

## The fetch handler

A Cloudflare Worker exports a `fetch` function. It receives a Web-standard `Request` and must return a Web-standard `Response`.

```js
// worker.js — deployable to Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    // request: Web-standard Request object
    // env: bindings (KV namespaces, Durable Objects, secrets, etc.)
    // ctx: execution context — ctx.waitUntil() for async tasks after response

    const url = new URL(request.url);

    if (url.pathname === "/api/greet") {
      const name = url.searchParams.get("name") ?? "world";
      return new Response(
        JSON.stringify({ message: `Hello, ${name}!`, region: request.cf?.colo }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
```

> [!OUTPUT]
> // wrangler dev → curl http://localhost:8787/api/greet?name=Ada
> {"message":"Hello, Ada!","region":"LHR"}

Notice the pure Web-standard construction: `new URL(request.url)`, `url.searchParams`, `new Response(...)`. The same code runs identically in a browser Service Worker, in Node 22 with `node --experimental-fetch`, or in Deno — because they all implement the same WHATWG specifications.

> [!NOTE] No `require`, no `import fs` — and that is the point
> The constraint is a feature. Workers code that only uses Web APIs is inherently portable across runtimes. It also forces a stateless, functional style that is easy to test: a function from Request to Response, no side-effects needed.

## Routing and middleware patterns

Workers are often used as a programmable proxy. Here is a pattern that handles authentication before delegating to an origin:

```js
// auth-proxy worker
export default {
  async fetch(request, env) {
    const token = request.headers.get("Authorization");
    if (!token || !isValidToken(token, env.JWT_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    // Forward to origin — Workers can fetch() any URL
    return fetch(request);
  },
};

function isValidToken(token, secret) {
  // In production: verify JWT signature with crypto.subtle
  return token.startsWith("Bearer ");
}
```

## KV and Durable Objects

Workers are stateless (no persistent memory between requests), but Cloudflare provides storage primitives:

**Workers KV** — globally replicated key-value store. Eventually consistent; great for config, feature flags, cached API responses.

```js
export default {
  async fetch(request, env) {
    const cached = await env.MY_KV.get("home-page-html");
    if (cached) return new Response(cached, { headers: { "Content-Type": "text/html" } });

    const fresh = await renderHomePage();
    await env.MY_KV.put("home-page-html", fresh, { expirationTtl: 60 });
    return new Response(fresh, { headers: { "Content-Type": "text/html" } });
  },
};
```

**Durable Objects** — strongly consistent, single-instance objects that coexist with edge distribution. Each object is a class with a `fetch` method. Cloudflare routes all requests for the same object ID to the same instance, globally. Perfect for real-time collaboration, rate limiting, game state.

```js
// Durable Object class (defined in the same bundle)
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
  }
  async fetch(request) {
    const count = (await this.state.storage.get("count")) ?? 0;
    if (count >= 100) return new Response("Rate limited", { status: 429 });
    await this.state.storage.put("count", count + 1);
    return new Response("OK");
  }
}
```

## WinterCG: the convergence of runtimes

**WinterCG** (Web-interoperable Runtimes Community Group) is a W3C community that standardises the Web APIs that server-side runtimes — Workers, Deno, Bun, Node.js — should implement. The goal: write once, run anywhere.

WinterCG-covered APIs include `fetch`, `Request`, `Response`, `URL`, `URLSearchParams`, `TextEncoder/Decoder`, `crypto`, `ReadableStream`, `WritableStream`, and more. Node.js 22 implements virtually all of them. This is why a Workers-style handler can be unit-tested in Node without a Cloudflare-specific test runner.

> [!PRINCIPAL] The runtime is becoming the API surface
> A generation ago, "Node.js code" meant code that ran only on Node.js. The WinterCG convergence means the boundary is dissolving. Code written against Web-standard APIs is runtime-agnostic. At principal engineer level, this should inform your library choices: prefer Web-standard APIs (fetch over axios, crypto.subtle over a Node-only library, ReadableStream over node:stream) so your code retains optionality — it can run at the edge, in a browser Service Worker, or in any WinterCG-compliant runtime without modification.

## Try it yourself

The `Request` and `Response` constructors are available in modern browsers and in Node 22+. Here we run a Web-standard fetch handler entirely in the browser sandbox — the same code you could deploy to Cloudflare Workers.

```js run
// A Web-standard fetch handler — identical to a Cloudflare Workers handler

function workerFetch(request) {
  const url = new URL(request.url);

  if (url.pathname === "/hello") {
    const name = url.searchParams.get("name") || "world";
    return new Response(JSON.stringify({ hello: name, runtime: "browser-sandbox" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/echo" && request.method === "POST") {
    // In a real Worker we'd await request.json() — here we return a mock
    return new Response(JSON.stringify({ echoed: true }), { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
}

// Simulate requests
const routes = [
  new Request("https://myworker.dev/hello?name=Ada"),
  new Request("https://myworker.dev/hello"),
  new Request("https://myworker.dev/unknown"),
  new Request("https://myworker.dev/echo", { method: "POST", body: "{}" }),
];

(async () => {
  for (const req of routes) {
    const res = workerFetch(req);
    const body = await res.text();
    console.log(`${req.method} ${new URL(req.url).pathname} → ${res.status}: ${body}`);
  }
})();
```

## Exercise

**Challenge:** Extend `workerFetch` with a `/status` route that returns a JSON object: `{ status: "ok", timestamp: <current ISO string>, requestId: <a random UUID> }`. Use only Web-standard APIs (`Date`, `crypto.randomUUID()`).

<details>
<summary>Show solution</summary>

```js run
function workerFetch(request) {
  const url = new URL(request.url);

  if (url.pathname === "/status") {
    return new Response(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response("Not Found", { status: 404 });
}

(async () => {
  const res = workerFetch(new Request("https://worker.dev/status"));
  const body = await res.json();
  console.log("status:", body.status);
  console.log("timestamp:", body.timestamp);
  console.log("requestId:", body.requestId);
  console.log("valid UUID:", /^[0-9a-f-]{36}$/.test(body.requestId));
})();
```

`crypto.randomUUID()` is part of the Web Crypto API — available in Workers, browsers, Deno, Bun, and Node 22+.

</details>

## Common pitfalls

> [!PITFALL] Trying to use Node APIs in a Worker
> The single most common mistake when porting Node.js code to Workers is reaching for `require("fs")`, `path.join()`, or `Buffer`. These do not exist. Workers run in a V8 isolate, not a Node process. Audit your dependencies for Node-only APIs before deploying. Tools like `wrangler dev` and the Workers compatibility flags can polyfill some Node APIs (like `Buffer` via the `nodejs_compat` flag), but the idiomatic approach is to write to Web APIs from the start.

> [!PITFALL] Assuming long-running compute is fine
> V8 isolates on the free tier have a 10 ms CPU-time limit per request. The paid tier allows 30 seconds. But Workers are designed for fast, I/O-bound work: routing, auth, transformation. Running a 2-second ML inference inside a Worker will hit limits and frustrate users. Offload heavy compute to a Lambda or Durable Object with proper resource allocation.

## What you learned

- **Edge compute** places your code in 300+ locations, reducing user-facing latency from hundreds of milliseconds to single digits.
- Cloudflare Workers use **V8 isolates** — not containers or VMs — enabling sub-millisecond cold starts with 128 MB memory.
- Workers expose only **Web-standard APIs** (`fetch`, `Request`, `Response`, `URL`, `crypto`). No Node.js APIs.
- The canonical handler is a `fetch(request, env, ctx)` function returning a `Response`.
- **KV** gives eventually-consistent global storage; **Durable Objects** give strongly-consistent single-instance state.
- **WinterCG** is standardising these APIs across runtimes — code written to Web APIs works in Workers, Deno, Bun, and Node 22.

## Next steps

Lambda and Workers represent two points on the spectrum: full Node.js in a VM vs. minimal Web APIs in an isolate. The next lesson examines two runtimes that challenge Node.js itself — **Deno** and **Bun** — and helps you decide which runtime to reach for in a new project.
*/});
