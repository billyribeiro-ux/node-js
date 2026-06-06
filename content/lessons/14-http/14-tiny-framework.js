registerLessonSrc("14-tiny-framework", function () {/*
---
id: 14-tiny-framework
title: "Build a Tiny Web Framework"
minutes: 28
level: advanced
objectives:
  - Implement a Router that matches method and path patterns to handler functions
  - Compose middleware using the onion model with a next() chain
  - Parse request bodies and attach them to a context object
  - Handle errors gracefully with a centralized error middleware
---

# Build a Tiny Web Framework

## Why this matters

Every Node web framework — Express, Koa, Fastify, Hono — is built on a handful of composable ideas: a router that maps requests to handlers, a middleware pipeline that transforms context, and a body parser that turns raw bytes into usable data. Reading framework code is one thing; writing one from scratch makes you fluent in *why* these abstractions exist. You will debug framework behaviour faster, evaluate new frameworks more clearly, and write better application code because you understand what the framework is doing on your behalf.

## Learning objectives

- Build a `Router` that registers routes by method and path and matches incoming requests.
- Implement the **onion model** middleware pattern: each layer calls `next()` to pass control inward, then resumes on the way out.
- Write a body parser that collects a streaming request body and attaches it to the request context.
- Centralise error handling so any thrown error flows to one place.

## The router: method + path → handler

A router has two jobs: **registering** routes (storing method, path, and handler) and **matching** incoming requests (finding the right handler and extracting URL parameters).

Path parameter patterns like `/users/:id` are the simplest dynamic routing mechanism. We convert them to a regex that captures named groups:

```js
import http from "node:http";

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    // Convert "/users/:id/posts/:postId" to a regex with named groups
    const pattern = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "(?<$1>[^/]+)");
    const regex = new RegExp(`^${pattern}$`);
    this.routes.push({ method: method.toUpperCase(), regex, handler });
  }

  get(path, handler)    { this.add("GET",    path, handler); }
  post(path, handler)   { this.add("POST",   path, handler); }
  put(path, handler)    { this.add("PUT",    path, handler); }
  delete(path, handler) { this.add("DELETE", path, handler); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const m = pathname.match(route.regex);
      if (m) return { handler: route.handler, params: m.groups ?? {} };
    }
    return null;
  }
}
```

## The middleware pattern: the onion model

Middleware is a function that receives a **context** object and a `next` function. Calling `next()` passes control to the inner layer. Code after `await next()` runs on the way *out* — giving middleware a before/after structure around every request. This is the "onion model":

```
request →  [logger] → [auth] → [bodyParser] → [handler]
response ← [logger] ← [auth] ← [bodyParser] ← [handler]
```

```js
// Compose an array of middleware into a single function
function compose(middlewares) {
  return function (ctx) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;
      const fn = middlewares[i];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
    }
    return dispatch(0);
  };
}
```

Each middleware looks like:

```js
async function logger(ctx, next) {
  const start = Date.now();
  await next();   // run everything inside
  const ms = Date.now() - start;
  console.log(`${ctx.method} ${ctx.path} ${ctx.res.statusCode} - ${ms}ms`);
}

async function auth(ctx, next) {
  const token = ctx.req.headers["authorization"];
  if (!token) {
    ctx.status = 401;
    ctx.body = { error: "Unauthorized" };
    return;   // don't call next — short-circuit the pipeline
  }
  ctx.user = { id: token.replace("Bearer ", "") };
  await next();
}
```

> [!PRINCIPAL] The onion model vs waterfall pipelines
> Express middleware is a waterfall: each `next()` passes control forward, and there is no "coming back out." Koa (and this framework) use the onion model where `await next()` returns, making before/after semantics trivial — you get response timing, CORS headers-after-handler, and response transforms almost for free. The implementation difference is a single `Promise.resolve(fn(ctx, () => dispatch(i + 1)))` versus `fn(req, res, next)`.

## Body parsing

Request bodies arrive as a stream. A body-parser middleware collects chunks and attaches the parsed result to the context:

```js
async function bodyParser(ctx, next) {
  const contentType = ctx.req.headers["content-type"] ?? "";

  if (["POST", "PUT", "PATCH"].includes(ctx.method)) {
    const chunks = [];
    for await (const chunk of ctx.req) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");

    if (contentType.includes("application/json")) {
      try {
        ctx.body = JSON.parse(raw);
      } catch {
        ctx.status = 400;
        ctx.body = { error: "Invalid JSON" };
        return;
      }
    } else {
      ctx.body = raw;
    }
  }

  await next();
}
```

## Error handling

Wrap the composed pipeline in a try/catch and let a dedicated error handler respond:

```js
function handleError(ctx, err) {
  const status = err.status ?? 500;
  ctx.res.writeHead(status, { "Content-Type": "application/json" });
  ctx.res.end(JSON.stringify({
    error: err.message ?? "Internal Server Error"
  }));
}
```

> [!PITFALL] Unhandled promise rejections in middleware
> If a middleware throws and you forget to `await next()`, the rejection is swallowed silently. Always `await` the composed pipeline in your `server.on("request")` handler, and wrap it in a top-level try/catch that calls `handleError`. Any uncaught error in the pipeline must reach that handler or the client hangs.

## Assembling the framework

```js
import http from "node:http";

class Framework {
  constructor() {
    this.router = new Router();
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
    return this;
  }

  get(path, handler)    { this.router.get(path, handler);    return this; }
  post(path, handler)   { this.router.post(path, handler);   return this; }
  put(path, handler)    { this.router.put(path, handler);    return this; }
  delete(path, handler) { this.router.delete(path, handler); return this; }

  listen(port, cb) {
    const pipeline = compose([
      ...this.middlewares,
      async (ctx) => {
        const url = new URL(ctx.req.url, `http://localhost`);
        const match = this.router.match(ctx.method, url.pathname);

        if (!match) {
          ctx.status = 404;
          ctx.responseBody = JSON.stringify({ error: "Not Found" });
          return;
        }

        ctx.params = match.params;
        ctx.query  = Object.fromEntries(url.searchParams);
        await match.handler(ctx);
      }
    ]);

    const server = http.createServer(async (req, res) => {
      const ctx = {
        req, res,
        method: req.method,
        path: new URL(req.url, "http://localhost").pathname,
        params: {},
        query: {},
        body: undefined,
        status: 200,
        responseBody: null,
      };

      try {
        await pipeline(ctx);
        if (!res.headersSent) {
          const payload = typeof ctx.responseBody === "string"
            ? ctx.responseBody
            : JSON.stringify(ctx.responseBody ?? ctx.body ?? "");
          res.writeHead(ctx.status, { "Content-Type": "application/json" });
          res.end(payload);
        }
      } catch (err) {
        handleError(ctx, err);
      }
    });

    server.listen(port, cb);
    return server;
  }
}
```

## Try it yourself

The two hardest pieces to get right are the router's regex matching and the middleware composer. Let's run both in pure JavaScript to verify they work correctly:

```js run
// ── Router ──────────────────────────────────────────────────────────────────
function buildRouter() {
  const routes = [];

  function add(method, path, handler) {
    const pattern = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "(?<$1>[^/]+)");
    routes.push({ method: method.toUpperCase(), regex: new RegExp(`^${pattern}$`), handler });
  }

  function match(method, pathname) {
    for (const r of routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = pathname.match(r.regex);
      if (m) return { handler: r.handler, params: m.groups ?? {} };
    }
    return null;
  }

  return { add, match };
}

const router = buildRouter();
router.add("GET",  "/",                 () => "home");
router.add("GET",  "/users/:id",        () => "user detail");
router.add("POST", "/users/:id/posts",  () => "create post");

console.log(router.match("GET",  "/")?.handler());               // home
console.log(router.match("GET",  "/users/42")?.params);          // { id: '42' }
console.log(router.match("POST", "/users/7/posts")?.params);     // { id: '7' }
console.log(router.match("GET",  "/not-found"));                 // null
console.log(router.match("DELETE", "/users/1"));                 // null (no DELETE)

// ── Middleware composer ──────────────────────────────────────────────────────
function compose(fns) {
  return function(ctx) {
    let i = -1;
    function dispatch(n) {
      if (n <= i) throw new Error("next() called multiple times");
      i = n;
      const fn = fns[n];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(n + 1)));
    }
    return dispatch(0);
  };
}

const log = [];

async function mw1(ctx, next) {
  log.push("mw1 before");
  await next();
  log.push("mw1 after");
}

async function mw2(ctx, next) {
  log.push("mw2 before");
  await next();
  log.push("mw2 after");
}

async function handler(ctx) {
  log.push("handler");
  ctx.result = "done";
}

const run = compose([mw1, mw2, handler]);
run({}).then(() => {
  console.log(log.join(" → "));
  // mw1 before → mw2 before → handler → mw2 after → mw1 after
});
```

## Project

**Build a minimal web framework from scratch — routing, middleware, body parsing — your own "tiny Express".**

Your implementation must meet the following acceptance criteria:

1. **Router** — A `Router` class with `get`, `post`, `put`, `delete` methods (and a generic `add(method, path, handler)`). Path parameters using `:name` syntax must be extracted into `ctx.params`. Non-matching requests must be detectable (return `null` or `undefined`).

2. **Middleware composer** — A `compose(middlewares)` function that chains async middleware functions. Each receives `(ctx, next)`. Code before `await next()` runs on the way in; code after runs on the way out. Calling `next()` twice in the same middleware must throw.

3. **Body parser** — A middleware that collects the request body stream for POST / PUT / PATCH requests and attaches parsed JSON to `ctx.body`. Return `400` with `{ error: "Invalid JSON" }` if parsing fails.

4. **Error handler** — Any error thrown inside the middleware pipeline must be caught and responded to with the error's `.status` code (defaulting to 500) and `{ error: message }` JSON body.

5. **Route not found** — Requests that don't match any registered route receive a `404` response with `{ error: "Not Found" }`.

6. **End-to-end test** — Wire the framework together (in pure JS using simulated request/response objects) and assert that: a GET to `/users/42` returns status 200 and `{ id: "42" }`, a POST to `/users` with a JSON body returns the parsed body, and a GET to `/unknown` returns 404.

Use the starter below to implement the pure-logic core (router + composer) and run the end-to-end assertions in the sandbox:

```js run
// ── Pure-logic core you must implement ──────────────────────────────────────

class Router {
  constructor() { this.routes = []; }

  add(method, path, handler) {
    const pattern = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "(?<$1>[^/]+)");
    this.routes.push({
      method: method.toUpperCase(),
      regex: new RegExp(`^${pattern}$`),
      handler
    });
  }

  get(p, h)    { this.add("GET", p, h); }
  post(p, h)   { this.add("POST", p, h); }
  put(p, h)    { this.add("PUT", p, h); }
  delete(p, h) { this.add("DELETE", p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = pathname.match(r.regex);
      if (m) return { handler: r.handler, params: m.groups ?? {} };
    }
    return null;
  }
}

function compose(fns) {
  return function run(ctx) {
    let idx = -1;
    function dispatch(i) {
      if (i <= idx) return Promise.reject(new Error("next() called multiple times"));
      idx = i;
      const fn = fns[i];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
    }
    return dispatch(0);
  };
}

// ── Simulate a minimal request/response for testing without Node APIs ────────
function mockRequest(method, path, body) {
  return { method, path, body };
}

function mockResponse() {
  const res = { status: 200, body: null, headers: {} };
  res.writeHead = (code, headers) => {
    res.status = code;
    Object.assign(res.headers, headers);
  };
  res.end = (data) => { res.body = data; };
  return res;
}

// ── Framework runner (simplified, no real http.createServer) ─────────────────
async function handleRequest(router, middlewares, method, path, requestBody) {
  const res = mockResponse();
  const ctx = {
    method, path,
    params: {},
    query: {},
    body: requestBody ?? null,
    status: 200,
    responseBody: null,
    res,
  };

  const pipeline = compose([
    ...middlewares,
    async (ctx) => {
      const match = router.match(ctx.method, ctx.path);
      if (!match) {
        ctx.status = 404;
        ctx.responseBody = { error: "Not Found" };
        return;
      }
      ctx.params = match.params;
      await match.handler(ctx);
    }
  ]);

  try {
    await pipeline(ctx);
    const payload = JSON.stringify(ctx.responseBody ?? {});
    res.writeHead(ctx.status, { "Content-Type": "application/json" });
    res.end(payload);
  } catch (err) {
    const code = err.status ?? 500;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }

  return res;
}

// ── Wire up routes ────────────────────────────────────────────────────────────
const router = new Router();

router.get("/users/:id", async (ctx) => {
  ctx.responseBody = { id: ctx.params.id };
});

router.post("/users", async (ctx) => {
  ctx.responseBody = ctx.body;
  ctx.status = 201;
});

const middlewares = [
  async (ctx, next) => {
    // Simple request logger
    await next();
    console.log(`${ctx.method} ${ctx.path} → ${ctx.res.status}`);
  }
];

// ── Acceptance assertions ─────────────────────────────────────────────────────
(async () => {
  let pass = 0;

  function assert(label, condition) {
    if (condition) { console.log(`PASS: ${label}`); pass++; }
    else           { console.log(`FAIL: ${label}`); }
  }

  // Criterion 1: GET /users/42 → 200, { id: "42" }
  const r1 = await handleRequest(router, middlewares, "GET", "/users/42");
  assert("GET /users/42 → 200",      r1.status === 200);
  assert("GET /users/42 → {id:42}",  r1.body === '{"id":"42"}');

  // Criterion 2: POST /users with body → 201, echoes body
  const r2 = await handleRequest(router, middlewares, "POST", "/users", { name: "Alice" });
  assert("POST /users → 201",               r2.status === 201);
  assert("POST /users → echoes body",       r2.body === '{"name":"Alice"}');

  // Criterion 3: unknown route → 404
  const r3 = await handleRequest(router, middlewares, "GET", "/unknown");
  assert("GET /unknown → 404",       r3.status === 404);
  assert("GET /unknown → Not Found", r3.body.includes("Not Found"));

  console.log(`\n${pass}/6 criteria passed`);
})();
```

## Common pitfalls

> [!PITFALL] Router order matters
> Routes are matched in registration order. If you register `GET /users/me` *after* `GET /users/:id`, the `:id` route will match `/users/me` first and `params.id` will be `"me"`. Always register more-specific routes before more-general ones, or add special-case guards before the wildcard parameter routes.

> [!PITFALL] Forgetting to call res.end()
> In the real Node `http` module, every request handler must eventually call `res.end()`. If your middleware pipeline exits without sending a response — because a middleware forgot to call `next()` and didn't send a response itself — the client hangs until timeout. Track `res.headersSent` and `res.writableEnded` defensively.

## What you learned

- A `Router` converts `:param` path patterns to named-group regexes and matches method + path pairs to handler functions.
- The `compose` function implements the onion model: each middleware wraps the rest of the pipeline by calling `await next()` — giving it code that runs both before and after every inner layer.
- Body parsing is a middleware that reads the request stream, buffers it, and attaches the parsed result to the context before calling `next()`.
- A top-level try/catch around the composed pipeline centralises error responses; all thrown errors flow to one place.
- Building a tiny framework from scratch is the fastest path to deep understanding of Express, Koa, Fastify, and Hono — they are all elaborations of these same four ideas.

## Next steps

You have now mastered the HTTP stack from the raw `node:http` module all the way to a bespoke framework. The next module dives into **REST API design** — resource naming, HTTP verb semantics, versioning strategies, and building production-grade APIs on top of frameworks like the one you just built.
*/});
