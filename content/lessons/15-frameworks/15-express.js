registerLessonSrc("15-express", function () {/*
---
id: 15-express
title: "Express: Routing, Middleware & Errors"
minutes: 22
level: intermediate
objectives:
  - Understand how Express middleware works as an ordered chain and why order matters
  - Build routes, routers, and proper error-handling middleware
  - Know why Express is still the default choice for millions of projects
---

# Express: Routing, Middleware & Errors

## Why this matters

Express has been downloaded billions of times and powers a huge slice of the Node.js ecosystem.
Even if you eventually choose Fastify or Hono, you will encounter Express in existing codebases,
stack overflow answers, tutorials, and third-party integrations. Understanding its mental model —
the **middleware chain** — also gives you the vocabulary to understand every other Node framework,
because they all borrowed from it.

## Learning objectives

- Explain how `next()` chains middleware together and what happens when you forget to call it.
- Write GET/POST/PUT/DELETE routes and group them with `express.Router`.
- Handle validation errors, not-found (404), and unexpected errors with the correct Express patterns.
- Know the key `req` and `res` properties you'll reach for every day.

## The middleware mental model

Express is, at its core, a **pipeline**. When a request arrives, Express walks through a list of
functions one at a time, passing control with `next()`. Each function is called **middleware**:

```
Request → [logger] → [auth] → [body-parser] → [route handler] → Response
```

Every middleware has this signature:

```js
// (req, res, next) => void
app.use(function (req, res, next) {
  // do something, then EITHER:
  next();          // pass to the next middleware
  // OR:
  res.send("done"); // end the response (do NOT call next after this)
});
```

Order is **everything**. Express matches middleware top-to-bottom, left-to-right. Middleware
registered *after* a route never runs for that route.

## Setting up an Express app

```js
import express from "express";

const app = express();

// Built-in middleware — parse JSON request bodies
app.use(express.json());

// Custom logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next(); // <-- must call this or the request hangs forever
});

// Route handler
app.get("/hello", (req, res) => {
  res.json({ message: "Hello, world!" });
});

app.listen(3000, () => console.log("listening on :3000"));
```

> [!OUTPUT]
> listening on :3000
> GET /hello

Key `req` properties you'll use constantly: `req.params`, `req.query`, `req.body`, `req.headers`,
`req.method`, `req.url`.

Key `res` methods: `res.json()`, `res.send()`, `res.status()`, `res.redirect()`, `res.set()`.

## Routes and route parameters

```js
// GET /users                → list all users
app.get("/users", (req, res) => {
  res.json([{ id: 1, name: "Ada" }]);
});

// GET /users/42             → get one user (req.params.id === "42")
app.get("/users/:id", (req, res) => {
  const { id } = req.params;
  res.json({ id: Number(id), name: "Ada" });
});

// GET /search?q=node        → req.query.q === "node"
app.get("/search", (req, res) => {
  const { q = "" } = req.query;
  res.json({ results: [], query: q });
});

// POST /users with body { "name": "Grace" }
app.post("/users", (req, res) => {
  const { name } = req.body; // requires express.json() above
  res.status(201).json({ id: 2, name });
});
```

> [!OUTPUT]
> {"id":1,"name":"Ada"}
> {"id":42,"name":"Ada"}

> [!NOTE] Params are always strings
> `req.params.id` is always a string, even if the URL has `"42"`. Always parse with `Number()` or
> validate before using as a numeric database key.

## Routers — splitting a big app

As apps grow, you split routes into **Router** instances. Each router is its own mini-application:

```js
// routes/users.js
import { Router } from "express";
const router = Router();

router.get("/", (req, res) => res.json({ users: [] }));
router.get("/:id", (req, res) => res.json({ id: req.params.id }));
router.post("/", (req, res) => res.status(201).json({ created: true }));

export default router;
```

```js
// app.js
import usersRouter from "./routes/users.js";
app.use("/users", usersRouter);  // all router paths are relative to /users
```

> [!OUTPUT]
> GET /users      → { users: [] }
> GET /users/99   → { id: "99" }

This is the standard Express project structure you'll see in virtually every Express tutorial and
open-source project.

## Error-handling middleware

Express error handlers are distinguished by having **four parameters** — `(err, req, res, next)`.
They must be registered **last**, after all routes:

```js
// 404 — no route matched
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.url });
});

// 500 — catch errors thrown or passed to next(err)
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? "Internal server error" });
});
```

Inside any route, pass errors to Express with `next(err)`:

```js
app.get("/boom", (req, res, next) => {
  try {
    throw Object.assign(new Error("Database offline"), { status: 503 });
  } catch (err) {
    next(err); // handed to the 4-arg error handler
  }
});
```

> [!OUTPUT]
> {"error":"Database offline"}

> [!PITFALL] Async errors don't auto-propagate in older Express
> In Express 4, if an `async` route handler throws, the error is *not* automatically passed to your
> error handler — it crashes the process. You must wrap async handlers: `next(err)` in a catch, or
> use a helper like `express-async-errors`. Express 5 (now stable) fixes this — `async` handlers
> that throw automatically call `next(err)`.

> [!PRINCIPAL] Why Express is still everywhere
> Express is ~15 years old, tiny (~200 kB), and has zero opinions about your project structure.
> Its middleware model was so successful that Koa, Fastify, and Hono all borrowed the idea.
> The npm ecosystem has thousands of Express-compatible middleware packages — passport, helmet,
> cors, morgan, multer. Switching frameworks often means rebuilding that ecosystem. For teams that
> need battle-tested stability and an ocean of third-party packages, Express is hard to dislodge.
> Its "slowness" relative to Fastify rarely matters: database and network latency dominate 99% of
> real APIs.

## Try it yourself

The next()-chain model is pure JavaScript logic. Here is the entire middleware engine simulated
without Express — run it in the sandbox and trace what happens:

```js run
// Simulate the Express middleware engine
function createApp() {
  const stack = [];

  return {
    use(fn) { stack.push({ path: null, fn }); },
    get(path, fn) { stack.push({ path, method: "GET", fn }); },
    post(path, fn) { stack.push({ path, method: "POST", fn }); },

    handle(method, url, body) {
      const req = { method, url, body, params: {} };
      const res = {
        _status: 200,
        status(code) { this._status = code; return this; },
        json(data) {
          console.log(`HTTP ${this._status} → ${JSON.stringify(data)}`);
        }
      };

      let index = 0;

      function next(err) {
        if (err) {
          console.log(`Error caught: ${err.message}`);
          return;
        }
        const layer = stack[index++];
        if (!layer) { console.log("HTTP 404 → Not Found"); return; }

        const methodMatch = !layer.method || layer.method === method;
        const pathMatch = !layer.path || layer.path === url;
        if (!methodMatch || !pathMatch) return next();

        try {
          layer.fn(req, res, next);
        } catch (e) {
          next(e);
        }
      }

      next();
    }
  };
}

const app = createApp();

// Middleware 1: logger
app.use((req, res, next) => {
  console.log(`[LOG] ${req.method} ${req.url}`);
  next();
});

// Middleware 2: fake auth
app.use((req, res, next) => {
  req.user = { id: 1, name: "Ada" };
  next();
});

// Route
app.get("/profile", (req, res) => {
  res.json({ user: req.user });
});

app.post("/data", (req, res) => {
  res.status(201).json({ received: req.body });
});

// Run it
app.handle("GET", "/profile", null);
app.handle("POST", "/data", { x: 1 });
app.handle("GET", "/missing", null);
```

## Exercise: add input validation middleware

Extend the simulation above so that `POST /data` requires `body.name` to be a non-empty string.
If it's missing, respond with HTTP 400 `{ error: "name is required" }` without reaching the route.

<details>
<summary>Show solution</summary>

```js run
function createApp() {
  const stack = [];
  return {
    use(fn) { stack.push({ path: null, fn }); },
    post(path, fn) { stack.push({ path, method: "POST", fn }); },
    handle(method, url, body) {
      const req = { method, url, body, params: {} };
      const res = {
        _status: 200,
        status(code) { this._status = code; return this; },
        json(data) { console.log(`HTTP ${this._status} → ${JSON.stringify(data)}`); }
      };
      let i = 0;
      function next(err) {
        if (err) { console.log(`Error: ${err.message}`); return; }
        const layer = stack[i++];
        if (!layer) { console.log("HTTP 404"); return; }
        const mOk = !layer.method || layer.method === method;
        const pOk = !layer.path || layer.path === url;
        if (!mOk || !pOk) return next();
        try { layer.fn(req, res, next); } catch (e) { next(e); }
      }
      next();
    }
  };
}

const app = createApp();

// Validation middleware — only runs for POST /data
app.post("/data", (req, res, next) => {
  if (!req.body || typeof req.body.name !== "string" || !req.body.name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  next();
});

// Route handler
app.post("/data", (req, res) => {
  res.status(201).json({ created: req.body.name });
});

app.handle("POST", "/data", {});               // missing name
app.handle("POST", "/data", { name: "" });     // empty name
app.handle("POST", "/data", { name: "Grace" }); // valid
```

</details>

## Common pitfalls

> [!PITFALL] The most common Express mistakes
> 1. **Forgetting `next()`** in middleware — the request hangs and the client times out with no error.
> 2. **Calling `res.send()` twice** — Express throws "Cannot set headers after they are sent." Always
>    `return res.json(...)` or ensure only one code path sends a response.
> 3. **Registering error middleware before routes** — Express won't treat it as an error handler because
>    route errors haven't been "thrown" yet. Error middleware must be *last*.
> 4. **Forgetting `express.json()`** — `req.body` is `undefined` until you add the body-parsing middleware.
> 5. **Async routes in Express 4** — unhandled promise rejections silently crash the server. Always wrap
>    async handlers or upgrade to Express 5.

## What you learned

- Express is a **middleware pipeline**: `app.use()` adds a function, `next()` passes control forward.
- Route handlers are specialized middleware that match a method + path pattern.
- Group related routes into **Router** instances for clean project structure.
- **Error-handling middleware** has four arguments `(err, req, res, next)` and must be registered last.
- Express 5 finally handles async throws automatically; in v4, always catch and call `next(err)`.
- Express remains dominant because of its massive middleware ecosystem, not its raw performance.

## Next steps

Now that you understand the middleware pattern deeply, let's see how Fastify takes the same idea
and turbocharges it with JSON-schema validation and a plugin encapsulation system designed for speed.
*/});
