registerLessonSrc("15-hono", function () {/*
---
id: 15-hono
title: "Hono: Edge-First & Web-Standard"
minutes: 28
level: advanced
objectives:
  - Understand why Web-standard Request/Response matters in 2026 and what "edge-first" means
  - Build Hono routes and middleware that run unchanged on Node, Bun, Deno, and Cloudflare Workers
  - Implement a radix-style route matcher with named parameters as Hono's core uses
---

# Hono: Edge-First & Web-Standard

## Why this matters

In 2026 your API might run on a long-lived Node server, a Bun process, a Deno Deploy region, or
Cloudflare Workers — sometimes all at once, at different stages of the same rollout. If your
framework hard-codes Node's `http.IncomingMessage` and `http.ServerResponse`, you rewrite everything
when you move runtimes. Hono side-steps this entirely: it is built on **Web-standard
`Request`/`Response`** — the same interfaces the browser uses, now available natively in every
modern JavaScript runtime. Write once, run anywhere. That is the value proposition, and in 2026
it is increasingly the default choice for greenfield APIs, serverless functions, and edge workers.

## Learning objectives

- Explain what "Web-standard" means in the context of server frameworks and why it enables portability.
- Write Hono routes, middleware, and context helpers (`c.json()`, `c.req.param()`, `c.req.query()`).
- Understand how Hono's runtime adapters work and how to swap them without touching application code.
- Map the key differences between Express, Fastify, and Hono so you can choose the right one.

## Web-standard Request and Response

The Fetch API introduced `Request` and `Response` as first-class JavaScript objects in browsers.
In 2022-2024, every major server runtime adopted them as well:

| Runtime | `Request`/`Response` available? |
|---|---|
| Cloudflare Workers | Yes (native since day one) |
| Deno | Yes (native) |
| Bun | Yes (native) |
| Node 18+ | Yes (`globalThis.Request`) |
| Browser | Yes (the original) |

An `async function(Request): Promise<Response>` is now a universal server signature.
Hono uses exactly this shape — every route handler receives a Hono `Context` that wraps a standard
`Request` and produces a standard `Response`. No proprietary objects, no adapter gymnastics.

```js
// hono-style handler — this function works in every runtime listed above
app.get("/hello", (c) => {
  return c.json({ message: "Hello from anywhere!" });
});
```

`c` (the Context) is a thin, ergonomic wrapper around the native `Request` and `Response` so you
do not have to type `new Response(JSON.stringify(...), { headers: ... })` manually.

## Building a Hono application

```js
import { Hono } from "hono";

const app = new Hono();

// Middleware — same next() pattern as Express
app.use("*", async (c, next) => {
  console.log(`${c.req.method} ${c.req.path}`);
  await next();
  console.log(`→ ${c.res.status}`);
});

// GET with a named param
app.get("/users/:id", (c) => {
  const id = c.req.param("id");     // strongly typed in TypeScript!
  return c.json({ id, name: "Ada" });
});

// POST with a JSON body
app.post("/users", async (c) => {
  const body = await c.req.json();  // parses the native Request body
  return c.json({ created: body }, 201);
});

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app; // ← the export IS the fetch handler for Workers / Deno
```

> [!OUTPUT]
> GET /users/42
> → 200

For **Node.js**, Hono provides an adapter:

```js
import { serve } from "@hono/node-server";
import app from "./app.js";

serve({ fetch: app.fetch, port: 3000 }, () =>
  console.log("Hono running on Node :3000")
);
```

> [!NOTE] One export, any runtime
> The `export default app` pattern works on Cloudflare Workers and Deno Deploy with zero change.
> On Bun, `Bun.serve({ fetch: app.fetch })`. On Node, the adapter above. The application logic is
> completely runtime-agnostic.

## Middleware in Hono

Hono middleware is almost identical to Express: a function that receives context and `next`, calls
`await next()` to continue, and can act before and after the downstream handler:

```js
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

// Hono ships built-in middleware for common needs
app.use("*", logger());
app.use("/api/*", cors({ origin: "https://myapp.com" }));
app.use("/api/*", bearerAuth({ token: process.env.API_TOKEN }));

// Route-scoped middleware with manual async flow
app.use("/admin/*", async (c, next) => {
  if (!c.req.header("x-admin-key")) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});

app.get("/api/data", (c) => c.json({ secret: true }));
```

> [!OUTPUT]
> GET /api/data  (with valid Bearer token and CORS)
> → 200 {"secret":true}

## Why Hono is fast

Hono uses a **trie/radix router** (TrieRouter) by default — the same algorithmic idea as
Fastify's find-my-way. Route lookup is sub-linear in the number of registered routes.

Additionally, because Hono never converts to Node's `http.IncomingMessage`, there are zero
unnecessary object allocations on runtimes that natively support the Fetch API (Workers, Bun, Deno).
Every layer of adaptation costs allocation; Hono layers are paper-thin.

> [!PRINCIPAL] The real advantage of Web-standard frameworks in 2026
> The speed argument is real but secondary. The deeper win is **cognitive and operational**: your
> team learns `Request`, `Response`, `Headers`, and `URL` — standard JavaScript APIs documented at
> MDN — not a framework-specific object model. That knowledge transfers across every project, every
> runtime, and every tool that uses the Fetch API (including `fetch()` itself). When Cloudflare,
> Deno, and Bun all converge on the same interfaces, frameworks that bet on those interfaces age
> very well.

## Express vs Fastify vs Hono — the honest comparison

| | Express | Fastify | Hono |
|---|---|---|---|
| API model | `req`/`res` (Node-only) | `request`/`reply` (Node-only) | `Request`/`Response` (Web-standard) |
| Validation | manual / third-party | built-in JSON-schema (ajv) | built-in validator middleware |
| Serialization | `JSON.stringify` | fast-json-stringify (compiled) | native Response |
| Portability | Node only | Node only | Node, Bun, Deno, Workers, Edge |
| Ecosystem | enormous (15+ years) | growing | young but fast-growing |
| TypeScript | via `@types/express` | first-class | first-class (route types inferred) |
| Best for | existing codebases, rich middleware | high-throughput Node APIs | new projects, edge, portability |

## Try it yourself

Hono's performance starts with its router. Here is a working trie/radix-inspired route matcher
with named parameters (`:id`), the core primitive Hono is built on:

```js run
// Radix-ish route matcher with named params — the heart of Hono's router

function buildMatcher(routes) {
  // Each route: { method, pattern, handler }
  // We store segments and detect param segments (start with ":")
  const compiled = routes.map(({ method, pattern, handler }) => ({
    method,
    segments: pattern.split("/").filter(Boolean),
    handler
  }));

  return function match(method, path) {
    const parts = path.split("/").filter(Boolean);

    for (const route of compiled) {
      if (route.method !== method && route.method !== "*") continue;
      if (route.segments.length !== parts.length) continue;

      const params = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = parts[i]; // capture named param
        } else if (seg !== parts[i]) {
          matched = false;
          break;
        }
      }

      if (matched) return { handler: route.handler, params };
    }

    return null;
  };
}

// Register routes
const match = buildMatcher([
  { method: "GET",    pattern: "/users",          handler: () => "list users" },
  { method: "GET",    pattern: "/users/:id",       handler: (p) => `get user ${p.id}` },
  { method: "POST",   pattern: "/users",           handler: () => "create user" },
  { method: "GET",    pattern: "/posts/:id/comments/:cid", handler: (p) => `comment ${p.cid} on post ${p.id}` },
  { method: "*",      pattern: "/health",          handler: () => "ok" }
]);

// Test the matcher
const requests = [
  ["GET",    "/users"],
  ["GET",    "/users/42"],
  ["POST",   "/users"],
  ["GET",    "/posts/7/comments/99"],
  ["DELETE", "/health"],
  ["GET",    "/missing"]
];

for (const [method, path] of requests) {
  const result = match(method, path);
  if (result) {
    console.log(`${method} ${path} → ${result.handler(result.params)}`);
  } else {
    console.log(`${method} ${path} → 404 Not Found`);
  }
}
```

## Exercise: add wildcard support

Extend the matcher above so a route pattern ending in `/*` matches any path with that prefix, e.g.
`/files/*` should match `/files/a`, `/files/a/b/c`, etc. The wildcard segment should not capture
params — just return `{ wildcard: "a/b/c" }` for the trailing portion.

<details>
<summary>Show solution</summary>

```js run
function buildMatcher(routes) {
  const compiled = routes.map(({ method, pattern, handler }) => {
    const segs = pattern.split("/").filter(Boolean);
    const isWildcard = segs[segs.length - 1] === "*";
    return { method, segments: isWildcard ? segs.slice(0, -1) : segs, isWildcard, handler };
  });

  return function match(method, path) {
    const parts = path.split("/").filter(Boolean);

    for (const route of compiled) {
      if (route.method !== method && route.method !== "*") continue;

      if (route.isWildcard) {
        if (parts.length < route.segments.length) continue;
      } else {
        if (route.segments.length !== parts.length) continue;
      }

      const params = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = parts[i];
        } else if (seg !== parts[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        if (route.isWildcard) {
          params.wildcard = parts.slice(route.segments.length).join("/");
        }
        return { handler: route.handler, params };
      }
    }
    return null;
  };
}

const match = buildMatcher([
  { method: "GET", pattern: "/files/*", handler: (p) => `serve file: ${p.wildcard}` },
  { method: "GET", pattern: "/users/:id", handler: (p) => `user ${p.id}` }
]);

const tests = [
  ["GET", "/files/readme.txt"],
  ["GET", "/files/deep/nested/path.js"],
  ["GET", "/users/7"],
  ["GET", "/missing"]
];

for (const [method, path] of tests) {
  const result = match(method, path);
  console.log(`${method} ${path} → ${result ? result.handler(result.params) : "404"}`);
}
```

</details>

## Project

**Build the same REST API in Express, Fastify, and Hono, then benchmark all three with autocannon.**

### What to build

A minimal CRUD API for a `todos` resource with in-memory storage:

- `GET /todos` — return all todos
- `POST /todos` — create a todo `{ title: string }`, return 201 with the new todo
- `GET /todos/:id` — return one todo or 404
- `DELETE /todos/:id` — delete and return 204

Implement the identical logic in three separate files: `todos-express.js`, `todos-fastify.js`,
`todos-hono.js`. Run each on a different port (3001, 3002, 3003).

### Acceptance criteria

1. **Identical behavior**: all three servers return the same JSON shapes for the same requests.
   Test with `curl` or a shared test script that hits all three ports and diffs the output.
2. **Fastify schema**: the Fastify version uses a `schema.body` and `schema.response` declaration
   on every route that accepts or returns a body — no manual `JSON.stringify`.
3. **Hono portability**: the Hono application logic lives in a file that exports `app` (no
   `serve()` call). A separate `server.js` imports it and wires `@hono/node-server`. This proves
   the app is runtime-agnostic.
4. **Error handling**: all three return `{ error: "Not found" }` with status 404 for unknown IDs,
   and `{ error: "title is required" }` with status 400 for invalid POST bodies.
5. **Benchmark**: run `npx autocannon -c 100 -d 10 http://localhost:300X/todos` for each server
   and record req/sec. Document the numbers in a comment at the top of each file.
6. **Analysis comment**: add a 3-sentence comment to a `RESULTS.md` explaining *why* the numbers
   differ, referencing specific architectural choices (serialization, allocation, schema compilation).

### Pure-logic starter: route matcher you can run now

The trie route matcher from "Try it yourself" above is the algorithmic core of all three routers.
Extend it to understand the difference between static and parameterized segments:

```js run
// Simulate how all three frameworks dispatch requests
// Focus: static routes are O(1) hash-lookups; parameterized need tree traversal

class Router {
  constructor() {
    this.static = new Map();  // "GET:/todos" → handler
    this.dynamic = [];        // [{ method, segments, handler }]
  }

  add(method, pattern, handler) {
    if (!pattern.includes(":")) {
      this.static.set(`${method}:${pattern}`, handler);
    } else {
      this.dynamic.push({
        method,
        segments: pattern.split("/").filter(Boolean),
        handler
      });
    }
  }

  dispatch(method, path) {
    // Fast path: static match (O(1))
    const staticKey = `${method}:${path}`;
    if (this.static.has(staticKey)) {
      return { handler: this.static.get(staticKey), params: {} };
    }

    // Slow path: dynamic match (O(routes))
    const parts = path.split("/").filter(Boolean);
    for (const route of this.dynamic) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;

      const params = {};
      let ok = true;

      for (let i = 0; i < route.segments.length; i++) {
        const s = route.segments[i];
        if (s.startsWith(":")) params[s.slice(1)] = parts[i];
        else if (s !== parts[i]) { ok = false; break; }
      }

      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

// In-memory store
let nextId = 1;
const todos = new Map();

const router = new Router();
router.add("GET",    "/todos",     ()  => ({ status: 200, body: [...todos.values()] }));
router.add("POST",   "/todos",     (_, body) => {
  if (!body?.title) return { status: 400, body: { error: "title is required" } };
  const todo = { id: nextId++, title: body.title, done: false };
  todos.set(todo.id, todo);
  return { status: 201, body: todo };
});
router.add("GET",    "/todos/:id", (p) => {
  const t = todos.get(Number(p.id));
  return t ? { status: 200, body: t } : { status: 404, body: { error: "Not found" } };
});
router.add("DELETE", "/todos/:id", (p) => {
  const existed = todos.delete(Number(p.id));
  return existed ? { status: 204, body: null } : { status: 404, body: { error: "Not found" } };
});

function request(method, path, body) {
  const match = router.dispatch(method, path);
  if (!match) return console.log(`${method} ${path} → 404 Not Found`);
  const { status, body: res } = match.handler(match.params, body);
  console.log(`${method} ${path} → ${status}`, res ?? "");
}

request("POST",   "/todos",   { title: "Learn Hono" });
request("POST",   "/todos",   { title: "Benchmark it" });
request("POST",   "/todos",   {});
request("GET",    "/todos",   null);
request("GET",    "/todos/1", null);
request("DELETE", "/todos/1", null);
request("GET",    "/todos/1", null);  // 404 after delete
```

## Common pitfalls

> [!PITFALL] The most common Hono mistakes
> 1. **Forgetting `await next()`** in async middleware — unlike Express where omitting `next()` just
>    hangs the request, in Hono's async model the downstream handler simply never runs and the
>    middleware's implicit response (undefined) causes a runtime error.
> 2. **Using `c.req.raw` when you should use `c.req`** — `c.req` is Hono's typed wrapper;
>    `c.req.raw` is the native `Request`. Most helpers (`param()`, `query()`, `json()`) live on
>    the wrapper. Reaching for `.raw` too early loses type safety.
> 3. **Deploying to Workers without testing there** — Hono runs on Workers, but your *dependencies*
>    might not. `node:crypto`, `node:fs`, and other Node built-ins are unavailable on Workers.
>    Keep platform-specific code in the adapter layer, not in route handlers.
> 4. **Assuming `c.json()` is synchronous** — it constructs a `Response`, which is fine, but if you
>    `return` after `c.json()` inside a conditional without returning the result, the route handler
>    returns `undefined` and Hono sends an empty 200.
> 5. **Mutating `c.res` directly** — use `c.header()`, `c.status()`, and `c.json()` instead of
>    building `new Response(...)` by hand; Hono may overwrite manual assignments in hooks.

## What you learned

- **Web-standard `Request`/`Response`** is the common interface that makes Hono run on Node, Bun,
  Deno, Cloudflare Workers, and the browser without code changes.
- Hono's middleware is the same `(c, next) => { await next() }` pattern as Express, but built on
  standard fetch semantics instead of Node-specific objects.
- A **radix/trie router** separates O(1) static matches from O(routes) parameterized matches —
  the core performance trick shared by Hono, Fastify, and all modern routers.
- The framework triad — Express (ecosystem), Fastify (schema + throughput), Hono (portability +
  Web-standard) — covers different problem shapes; knowing all three means picking the right tool.
- For greenfield APIs in 2026, **Hono is often the best default**: it costs nothing extra on Node,
  and keeps every future deployment option open.

## Next steps

You now have all three major Node frameworks in your toolkit. The next module moves from building
APIs to persisting the data they serve — starting with REST API design patterns, versioning, and
how to structure resource URLs that scale.
*/});
