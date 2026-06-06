registerLessonSrc("15-fastify", function () {/*
---
id: 15-fastify
title: "Fastify: Schemas, Hooks & Performance"
minutes: 24
level: advanced
objectives:
  - Understand why JSON-schema validation and serialization make Fastify fast
  - Use plugins and encapsulation to structure a Fastify application
  - Map the full hook lifecycle and know which hook to use for each cross-cutting concern
---

# Fastify: Schemas, Hooks & Performance

## Why this matters

When raw throughput matters — thousands of requests per second on a single core — Fastify is the
framework the Node.js community reaches for first. It is not merely "Express but faster": it ships
with a fundamentally different architecture built around **schema-first development**, a compiler-
driven JSON serializer, and a plugin system that enforces clean encapsulation. Understanding these
ideas makes you a better API architect regardless of which framework you ultimately ship.

## Learning objectives

- Explain how JSON-schema validation and `fast-json-stringify` give Fastify its performance edge.
- Register routes with schemas, plugins, and decorators.
- Name each phase of the Fastify hook lifecycle and choose the right one.
- Know when to reach for Fastify over Express and when Express is the safer pick.

## Why Fastify is fast

Three mechanisms combine to produce Fastify's benchmark numbers:

**1. Compiled JSON serialization.** In Express, `res.json(obj)` calls `JSON.stringify(obj)` every
time — a generic, slow operation. Fastify uses `fast-json-stringify`, which *compiles* a dedicated
serializer from your route's output schema at startup. That generated function is 2-5× faster than
`JSON.stringify` for typical objects because it knows the exact shape of the output in advance and
skips type-checking at runtime.

**2. Schema-based validation at the boundary.** Instead of writing manual validation code, you
declare an `ajv` JSON-schema for `body`, `params`, `querystring`, and `headers`. Fastify compiles
that schema into a validator once and runs it on every request. Invalid requests are rejected with
a 400 before a single line of your route code executes.

**3. Radix-tree router.** Fastify's router (find-my-way) uses a radix tree so route lookups are
O(log n) rather than O(n), which matters when you have hundreds of routes.

> [!PRINCIPAL] Schema-first is an architectural discipline, not just a performance trick
> When you define schemas for inputs and outputs, you gain three things at once: validation,
> serialization speed, and *documentation*. Fastify can auto-generate OpenAPI specs from the same
> schemas you use for validation. This means your docs are always in sync with your code —
> something that hand-written middleware validation can never guarantee.

## Setting up a Fastify server

```js
import Fastify from "fastify";

const fastify = Fastify({ logger: true }); // built-in pino logger, zero config

// Route with full schema — body validated, response serialized
fastify.post("/users", {
  schema: {
    body: {
      type: "object",
      required: ["name", "email"],
      properties: {
        name:  { type: "string", minLength: 1 },
        email: { type: "string", format: "email" }
      },
      additionalProperties: false
    },
    response: {
      201: {
        type: "object",
        properties: {
          id:    { type: "integer" },
          name:  { type: "string" },
          email: { type: "string" }
        }
      }
    }
  }
}, async (request, reply) => {
  const { name, email } = request.body; // already validated
  const user = await db.createUser({ name, email });
  return reply.code(201).send(user);   // serialized by generated code
});

await fastify.listen({ port: 3000 });
```

> [!OUTPUT]
> {"level":30,"time":...,"msg":"Server listening at http://127.0.0.1:3000"}

Notice two Fastify idioms: route handlers are `async` by default (return value = response body),
and schemas are declared inline on the route object rather than as separate middleware.

## Plugins and encapsulation

Fastify's killer feature for large apps is **plugin encapsulation**. Every plugin runs inside its
own scope. Decorators, hooks, and dependencies registered inside a plugin are invisible outside it
unless you explicitly export them. This prevents accidental cross-contamination between feature areas.

```js
// plugins/auth.js
import fp from "fastify-plugin";

async function authPlugin(fastify, opts) {
  // Decorator adds a method to every request object
  fastify.decorateRequest("user", null);

  fastify.addHook("onRequest", async (request, reply) => {
    const token = request.headers.authorization?.split(" ")[1];
    if (!token) throw fastify.httpErrors.unauthorized("Token required");
    request.user = await verifyToken(token); // sets decorated property
  });
}

// fp() "breaks" encapsulation intentionally — exports the decorator globally
export default fp(authPlugin, { name: "auth" });
```

```js
// app.js
import Fastify from "fastify";
import authPlugin from "./plugins/auth.js";
import usersRoutes from "./routes/users.js";

const fastify = Fastify({ logger: true });

await fastify.register(authPlugin);         // global auth hook
await fastify.register(usersRoutes, { prefix: "/users" }); // scoped to /users

await fastify.listen({ port: 3000 });
```

> [!NOTE] fastify-plugin vs raw plugin
> A raw `async function plugin(fastify, opts)` is *encapsulated* — its decorators and hooks stay
> inside. Wrapping with `fp()` (fastify-plugin) promotes them to the parent scope. Use `fp()` for
> infrastructure (auth, db connections, logging); use raw plugins for feature routes.

## The hook lifecycle

Fastify's lifecycle is more granular than Express's single middleware queue. Each hook fires at a
specific phase of request processing:

```
onRequest  →  preParsing  →  preValidation  →  preHandler  →  handler  →  preSerialization  →  onSend  →  onResponse
```

In plain English:

| Hook | When it fires | Typical use |
|---|---|---|
| `onRequest` | Immediately after TCP accept | Rate limiting, auth token extraction |
| `preParsing` | Before body is parsed | Decrypt body, custom content-type |
| `preValidation` | After parsing, before schema validation | Transform body (e.g., camelCase) |
| `preHandler` | After validation, before route handler | ACL checks, request enrichment |
| `preSerialization` | After handler returns, before serialize | Add `meta` fields to every response |
| `onSend` | After serialization, before network write | Compress, set final headers |
| `onResponse` | After response is sent | Metrics, audit logging |
| `onError` | When any hook or handler throws | Custom error formatting |

```js
// Example: measure latency with two hooks
fastify.addHook("onRequest", async (request) => {
  request.startTime = Date.now();
});

fastify.addHook("onResponse", async (request, reply) => {
  const ms = Date.now() - request.startTime;
  console.log(`${request.method} ${request.url} — ${ms}ms`);
});
```

> [!OUTPUT]
> GET /users — 4ms
> POST /users — 12ms

> [!PITFALL] Returning from async hooks
> In an `async` hook, Fastify treats any *returned value* as an error signal. Only `throw` or
> `reply.send()` should end the request early. Never `return someObject` inside a hook expecting it
> to become the response — that's the route handler's job.

## Decorators — extending req/rep/fastify

Fastify's `decorate*` API lets you safely add properties to the `fastify` instance, every `request`,
or every `reply` — without monkey-patching prototypes:

```js
// Add a DB connection to the fastify instance
fastify.decorate("db", myDatabasePool);

// Now accessible in every route as:
fastify.get("/items", async (request, reply) => {
  return fastify.db.query("SELECT * FROM items");
});
```

Using `decorateRequest` pre-allocates the property on the prototype so V8 can keep objects in the
same "hidden class" — another micro-optimization that adds up at scale.

## Try it yourself

Fastify's core superpower is the JSON-schema validator. Here's a minimal implementation of the
same idea — validate an object against a `{type, required, properties}` schema — the same logic
Fastify delegates to `ajv`:

```js run
// Tiny JSON-schema validator (type + required + properties, like Fastify uses)
function validate(schema, data) {
  const errors = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push("Expected an object");
      return errors;
    }

    for (const key of (schema.required || [])) {
      if (!(key in data)) errors.push(`Missing required field: "${key}"`);
    }

    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (!(key in data)) continue;
      const val = data[key];

      if (propSchema.type === "string" && typeof val !== "string") {
        errors.push(`"${key}" must be a string`);
      } else if (propSchema.type === "integer" && !Number.isInteger(val)) {
        errors.push(`"${key}" must be an integer`);
      } else if (propSchema.type === "string" && propSchema.minLength && val.length < propSchema.minLength) {
        errors.push(`"${key}" must be at least ${propSchema.minLength} chars`);
      }
    }
  }

  return errors;
}

const userSchema = {
  type: "object",
  required: ["name", "age"],
  properties: {
    name: { type: "string", minLength: 1 },
    age:  { type: "integer" },
    bio:  { type: "string" }
  }
};

const tests = [
  { name: "Ada",   age: 36 },
  { name: "",      age: 36 },
  { name: "Grace", age: 29.5 },
  { age: 99 },
  "not an object"
];

for (const t of tests) {
  const errs = validate(userSchema, t);
  console.log(
    JSON.stringify(t) + " → " +
    (errs.length ? errs.join(", ") : "VALID")
  );
}
```

## Exercise: add a `maxLength` constraint

Extend the `validate()` function above so `properties` can also declare `maxLength` for strings.
Then add `bio: { type: "string", maxLength: 140 }` to the schema and test it with a bio that is
200 characters long.

<details>
<summary>Show solution</summary>

```js run
function validate(schema, data) {
  const errors = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push("Expected an object");
      return errors;
    }

    for (const key of (schema.required || [])) {
      if (!(key in data)) errors.push(`Missing required field: "${key}"`);
    }

    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (!(key in data)) continue;
      const val = data[key];

      if (propSchema.type === "string" && typeof val !== "string") {
        errors.push(`"${key}" must be a string`);
      } else if (propSchema.type === "integer" && !Number.isInteger(val)) {
        errors.push(`"${key}" must be an integer`);
      } else if (propSchema.type === "string") {
        if (propSchema.minLength && val.length < propSchema.minLength) {
          errors.push(`"${key}" must be at least ${propSchema.minLength} chars`);
        }
        if (propSchema.maxLength && val.length > propSchema.maxLength) {
          errors.push(`"${key}" must be at most ${propSchema.maxLength} chars`);
        }
      }
    }
  }

  return errors;
}

const userSchema = {
  type: "object",
  required: ["name", "age"],
  properties: {
    name: { type: "string", minLength: 1 },
    age:  { type: "integer" },
    bio:  { type: "string", maxLength: 140 }
  }
};

const longBio = "x".repeat(200);

const tests = [
  { name: "Ada",   age: 36, bio: "Short bio." },
  { name: "Grace", age: 29, bio: longBio }
];

for (const t of tests) {
  const errs = validate(userSchema, t);
  const label = t.bio && t.bio.length > 20 ? `{name:${t.name}, bio: <${t.bio.length} chars>}` : JSON.stringify(t);
  console.log(label + " → " + (errs.length ? errs.join(", ") : "VALID"));
}
```

</details>

## Common pitfalls

> [!PITFALL] The most common Fastify mistakes
> 1. **Missing `await fastify.ready()`** before testing — plugins load asynchronously; accessing a
>    decorator before it's registered throws a cryptic "not decorated" error.
> 2. **Returning a value from a hook** — in async hooks, only `throw` or `reply.send()` interrupts
>    the lifecycle. A stray `return myObj` is silently ignored, not sent as the response.
> 3. **Forgetting `additionalProperties: false`** — without it, Fastify's serializer only emits
>    fields in `response.properties`, but the *validator* allows any extra input fields, which can
>    expose mass-assignment vulnerabilities.
> 4. **Registering a plugin after `fastify.listen()`** — the encapsulation graph is frozen once the
>    server starts. Always `await fastify.register(...)` before listening.
> 5. **Mixing callback-style and async handlers** — pick one per route. Using both causes the
>    response to be sent twice (or never).

## What you learned

- Fastify's speed comes from **compiled JSON serialization** (fast-json-stringify), **schema-based
  validation** (ajv), and a **radix-tree router** — all driven from the same JSON-schema declarations.
- **Plugin encapsulation** creates scoped, composable feature areas; `fp()` promotes shared
  infrastructure to the parent scope.
- The **hook lifecycle** has eight named phases; each hook is the right tool for a specific concern
  (auth in `onRequest`, body transforms in `preValidation`, metrics in `onResponse`).
- **Decorators** safely extend the request/reply/instance objects without prototype mutation, keeping
  V8 object shapes stable.
- Fastify is the right call when throughput, schema discipline, or OpenAPI generation matter;
  Express wins when ecosystem breadth or team familiarity dominate.

## Next steps

We've seen Express's simplicity and Fastify's schema-driven power. Next up is Hono — a framework
that abandons Node-specific APIs entirely, running on Web-standard `Request`/`Response` objects
and deploying to Cloudflare Workers, Deno, Bun, and Node.js all from the same codebase.
*/});
