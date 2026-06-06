registerLessonSrc("40-capstone-framework", function () {/*
---
id: 40-capstone-framework
title: "Capstone A: Build Your Own Web Framework"
minutes: 30
level: principal
objectives:
  - Synthesize routing, middleware, dependency injection, validation, and plugins into a coherent framework design
  - Implement a runnable mini-framework core with a composable middleware chain and typed context
  - Reason about the tradeoffs framework authors make and how to publish a reusable library
---

# Capstone A: Build Your Own Web Framework

## Why this matters

Every production Node.js team eventually hits the ceiling of their framework's opinions. At
that point you either fork, wrap, or write. Understanding how a framework is built — not just
used — makes you dangerous in three ways: you debug it faster, you extend it correctly, and
you make better decisions when evaluating alternatives. This lesson synthesises routing,
middleware composition, dependency injection, validation, and plugins into a real,
publishable design.

## Learning objectives

- Compose a middleware pipeline that passes a mutable context object through ordered handlers
- Build a trie-based router that matches parameterised paths and dispatches to handlers
- Layer dependency injection, validation, and a plugin system on top of that core
- Know what it takes to publish a framework (API stability, semver, docs, benchmarks)

## The framework design space

A web framework is fundamentally three things wired together:

```
Request → [Router] → [Middleware chain] → [Handler] → Response
```

Every framework makes decisions about each seam:

- **Router** — flat list vs trie vs regex; parameter extraction; wildcard support
- **Middleware** — onion model (`next()`) vs pipeline vs hooks; error propagation
- **Context** — mutable object passed through the chain; what lives on it
- **DI** — service locator vs constructor injection vs a container
- **Validation** — schema-first (JSON Schema / Zod) vs runtime assertions
- **Plugins** — decorators on the app, lifecycle hooks, or both

> [!PRINCIPAL] The abstraction tax
> Every layer of abstraction your framework adds is a tax on the people who debug through it.
> Fastify added a schema-based serialiser that's 3× faster than JSON.stringify — but tracing
> a serialisation bug requires understanding three extra indirection layers. Before adding an
> abstraction, ask: does this pay for its debugging cost at the scale my users will operate?

## Middleware composition in depth

The **onion model** (used by Koa, Hono, Fastify hooks) is the gold standard because it gives
each middleware both a before-phase and an after-phase with a single function:

```js
// Read-only: how a Koa-style middleware chain works in Node
import Koa from "koa";

const app = new Koa();

app.use(async (ctx, next) => {
  const start = Date.now();
  await next();                          // descend into inner layers
  const ms = Date.now() - start;        // executes AFTER inner layers return
  ctx.set("X-Response-Time", `${ms}ms`);
});

app.use(async (ctx) => {
  ctx.body = "Hello";
});

app.listen(3000);
```

> [!OUTPUT]
> Listening on 3000

The magic is that `next()` is a reference to the *next composed function* in the chain —
it's just `fn(ctx, next)` all the way down. You can implement this with a simple reducer:

```js
// Read-only: the compose function that powers the onion model
function compose(middlewares) {
  return function composed(ctx) {
    let i = -1;
    function dispatch(index) {
      if (index <= i) return Promise.reject(new Error("next() called multiple times"));
      i = index;
      const fn = middlewares[index];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(index + 1)));
    }
    return dispatch(0);
  };
}
```

## The router

A **trie** (prefix tree) is how production routers achieve O(depth) matching regardless of
how many routes are registered. Each path segment is a node; parameterised segments (`:id`)
are a special wildcard child.

For our runnable demo we use a simplified flat-list router that still supports parameters:

```js
// Read-only: simplified parameter router used in production Node servers
class Router {
  constructor() { this._routes = []; }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      "^" + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$"
    );
    this._routes.push({ method, re, keys, handler });
  }

  match(method, path) {
    for (const route of this._routes) {
      if (route.method !== method) continue;
      const m = path.match(route.re);
      if (!m) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
      return { handler: route.handler, params };
    }
    return null;
  }
}
```

## Dependency injection without magic

The simplest DI pattern that works in Node is a **service container** — a plain Map that
the context carries:

```js
// Read-only: container-based DI
class Container {
  constructor() { this._factories = new Map(); this._singletons = new Map(); }

  register(name, factory, { singleton = true } = {}) {
    this._factories.set(name, { factory, singleton });
  }

  resolve(name) {
    const entry = this._factories.get(name);
    if (!entry) throw new Error(`Unknown service: ${name}`);
    if (entry.singleton) {
      if (!this._singletons.has(name))
        this._singletons.set(name, entry.factory(this));
      return this._singletons.get(name);
    }
    return entry.factory(this);
  }
}
```

The context object gets a `resolve(name)` method and handlers call `ctx.resolve("db")` —
no global singletons, fully testable by swapping the container in tests.

## Try it yourself

Here is a complete, runnable mini-framework core: router + middleware compose + context.
It does not use Node APIs — the same logic powers real frameworks.

```js run
// Mini web framework core — router + middleware compose + context
// No Node APIs; runs in the browser sandbox.

// ---- Middleware composition (the onion model) ----
function compose(middlewares) {
  return function run(ctx) {
    let i = -1;
    function dispatch(index) {
      if (index <= i) throw new Error("next() called multiple times");
      i = index;
      const fn = middlewares[index];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(index + 1)));
    }
    return dispatch(0);
  };
}

// ---- Simple parametric router ----
class Router {
  constructor() { this._routes = []; }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      "^" + pattern.replace(/:([^/]+)/g, (_, k) => {
        keys.push(k); return "([^/]+)";
      }) + "$"
    );
    this._routes.push({ method, re, keys, handler });
    return this;
  }

  match(method, path) {
    for (const r of this._routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      return {
        handler: r.handler,
        params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])),
      };
    }
    return null;
  }
}

// ---- Micro application ----
class App {
  constructor() {
    this._router = new Router();
    this._middlewares = [];
    this._plugins = [];
  }

  use(fn) { this._middlewares.push(fn); return this; }

  register(plugin) { plugin(this); return this; }

  get(path, handler) { this._router.add("GET", path, handler); return this; }
  post(path, handler) { this._router.add("POST", path, handler); return this; }

  // Simulate handling an incoming request (no real HTTP needed)
  async handle(method, path, body = null) {
    const match = this._router.match(method, path);
    const ctx = {
      method, path, body,
      params: match ? match.params : {},
      status: 200,
      response: null,
      json(data) { this.response = data; },
    };

    const routeHandler = match
      ? match.handler
      : async (c) => { c.status = 404; c.response = { error: "Not found" }; };

    const chain = compose([...this._middlewares, routeHandler]);
    await chain(ctx);
    return ctx;
  }
}

// ---- A logger plugin ----
function loggerPlugin(app) {
  app.use(async (ctx, next) => {
    const t = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.path} → ${ctx.status} (${Date.now() - t}ms)`);
  });
}

// ---- Wire it up ----
const app = new App();

app.register(loggerPlugin);

app.use(async (ctx, next) => {
  if (ctx.body && typeof ctx.body !== "object") {
    ctx.status = 400;
    ctx.response = { error: "Body must be an object" };
    return; // short-circuit, do not call next
  }
  await next();
});

app.get("/users/:id", async (ctx) => {
  ctx.json({ id: ctx.params.id, name: "Ada Lovelace" });
});

app.post("/users", async (ctx) => {
  ctx.status = 201;
  ctx.json({ created: true, data: ctx.body });
});

// ---- Test the framework ----
(async () => {
  const r1 = await app.handle("GET", "/users/42");
  console.log("Response:", JSON.stringify(r1.response));

  const r2 = await app.handle("POST", "/users", { name: "Grace Hopper" });
  console.log("Response:", JSON.stringify(r2.response), "status:", r2.status);

  const r3 = await app.handle("GET", "/nonexistent");
  console.log("Response:", JSON.stringify(r3.response), "status:", r3.status);
})();
```

## Exercise: add a validation middleware

Extend the framework above to validate that POST `/users` requires a `name` field.
Return `{ error: "name is required" }` with status 400 if it is missing.

<details>
<summary>Show solution</summary>

```js run
function compose(middlewares) {
  return function run(ctx) {
    let i = -1;
    function dispatch(index) {
      if (index <= i) throw new Error("next() called multiple times");
      i = index;
      const fn = middlewares[index];
      if (!fn) return Promise.resolve();
      return Promise.resolve(fn(ctx, () => dispatch(index + 1)));
    }
    return dispatch(0);
  };
}

class Router {
  constructor() { this._routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      "^" + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$"
    );
    this._routes.push({ method, re, keys, handler });
    return this;
  }
  match(method, path) {
    for (const r of this._routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
    }
    return null;
  }
}

class App {
  constructor() { this._router = new Router(); this._middlewares = []; }
  use(fn) { this._middlewares.push(fn); return this; }
  post(path, handler) { this._router.add("POST", path, handler); return this; }
  async handle(method, path, body = null) {
    const match = this._router.match(method, path);
    const ctx = {
      method, path, body,
      params: match ? match.params : {},
      status: 200, response: null,
      json(d) { this.response = d; },
    };
    const handler = match ? match.handler : async (c) => { c.status = 404; c.response = { error: "Not found" }; };
    await compose([...this._middlewares, handler])(ctx);
    return ctx;
  }
}

// Validation middleware factory
function validate(schema) {
  return async (ctx, next) => {
    for (const [field, required] of Object.entries(schema)) {
      if (required && (!ctx.body || ctx.body[field] === undefined)) {
        ctx.status = 400;
        ctx.json({ error: `${field} is required` });
        return; // do not call next
      }
    }
    await next();
  };
}

const app = new App();

app.post("/users", validate({ name: true }), async (ctx) => {
  // Note: App.post only accepts (path, handler); extend to variadic middlewares:
  ctx.status = 201;
  ctx.json({ created: true, name: ctx.body.name });
});

// Manually test by simulating the middleware chain manually with validate
async function testValidation() {
  const middlewares = [
    validate({ name: true }),
    async (ctx) => { ctx.status = 201; ctx.json({ created: true, name: ctx.body.name }); },
  ];
  const run = compose(middlewares);

  const goodCtx = { method: "POST", path: "/users", body: { name: "Grace" }, status: 200, response: null, json(d) { this.response = d; } };
  await run(goodCtx);
  console.log("Valid body:", JSON.stringify(goodCtx.response), "status:", goodCtx.status);

  const badCtx = { method: "POST", path: "/users", body: {}, status: 200, response: null, json(d) { this.response = d; } };
  await run(badCtx);
  console.log("Missing name:", JSON.stringify(badCtx.response), "status:", badCtx.status);
}

testValidation();
```

</details>

## Project

**Build and publish a mini Node.js web framework** that is genuinely usable by a team. It
must go beyond the demo above — it should be a real npm-publishable package with a README,
examples, and a benchmark.

**Acceptance criteria:**

1. **Router** supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE` with path parameters
   (`:id`) and optional wildcards; returns 404 with a structured body for unmatched routes.
2. **Middleware** uses the onion (Koa-style) compose model; supports async middlewares;
   short-circuiting (not calling `next()`) stops the chain cleanly.
3. **Plugin system** — `app.register(plugin, options?)` passes the app instance (and
   options) to a plugin function; plugins may add middlewares, decorate the context, or
   register routes; at least two built-in plugins: `logger` and `cors`.
4. **Validation** — a `validate(schema)` middleware factory accepts a plain-object schema
   (`{ field: { type, required, min, max } }`) and responds 400 with structured errors
   before the handler runs.
5. **Dependency injection** — a `Container` class; `app.register(name, factory)` registers
   a service; handlers receive `ctx.resolve(name)` to retrieve it; singleton and transient
   lifetimes supported.
6. **Published and documented** — the framework is published to a local npm registry or
   GitHub Packages; a `README.md` documents every API surface with code examples; a
   benchmark (`autocannon` or `wrk`) shows ≥ 20 000 req/s on a trivial route under Node 24.

## Common pitfalls

> [!PITFALL] Leaking mutable state onto the context prototype
> Putting methods directly on a shared context prototype means one middleware's mutation
> can bleed into unrelated requests in the same process. Always create a fresh context
> object per request — never reuse or pool context objects across requests unless you
> reset every field.

A second pitfall: **swallowing errors in the compose loop**. If a middleware throws and
no error-handling middleware is registered, the error should propagate to the server's
uncaught-rejection handler and result in a 500 — never silently drop it. Register a
top-of-chain error middleware: `app.use(async (ctx, next) => { try { await next(); } catch (e) { ctx.status = 500; ctx.json({ error: e.message }); } })`.

## What you learned

- The onion middleware model is a composable reducer over async functions — just 10 lines of code
- A parametric router converts path templates to regular expressions at registration time, making matching fast
- DI via a container on the context keeps handlers testable without globals
- Plugin systems pass the app instance; plugins are just functions — no class-based magic needed
- Publishing a framework requires API stability commitments, semver, documentation, and benchmarks

## Next steps

With your own framework under your belt, the next capstone scales the challenge: you will
architect a **multi-service real-time platform** — gateway, WebSocket service, pub/sub,
persistence, and observability — tying together every systems-level module from this course.
*/});
