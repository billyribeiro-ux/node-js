registerLessonSrc("16-validation-openapi", function () {/*
---
id: 16-validation-openapi
title: "Validation (Zod) & OpenAPI Docs"
minutes: 28
level: advanced
objectives:
  - Validate and parse API inputs with Zod, distinguishing parse from safeParse
  - Understand how Zod schemas map to JSON Schema and OpenAPI definitions
  - Generate self-updating OpenAPI docs from your runtime schemas
---

# Validation (Zod) & OpenAPI Docs

## Why this matters

Unvalidated input is the root cause of a huge class of bugs: wrong types sneak into your database, `undefined` propagates silently until it surfaces as a cryptic 500, and attackers craft payloads that confuse your business logic. A runtime schema library like Zod turns every boundary of your application into a type-safe, self-documenting wall. Better yet, those schemas are also the source of truth for your OpenAPI documentation — one definition, zero drift.

## Learning objectives

- Validate and parse request bodies, query params, and path params with **Zod**.
- Distinguish `z.parse` (throws) from `z.safeParse` (returns a result object) and choose correctly.
- Map Zod schemas to **JSON Schema** / **OpenAPI 3.1** definitions.
- Plug a schema registry into an Express app to serve auto-generated Swagger UI docs.

## Input validation with Zod

**Zod** is a TypeScript-first schema declaration and validation library with zero runtime dependencies. In Node you install it with `npm install zod`.

### Defining a schema

```js
import { z } from "zod";

// Describe the shape of a new-note request body
const CreateNoteSchema = z.object({
  title:   z.string().min(1).max(120),
  content: z.string().max(10_000).optional(),
  tags:    z.array(z.string().max(30)).max(10).default([]),
  pinned:  z.boolean().default(false)
});
```

`CreateNoteSchema` is both a runtime validator *and* (in TypeScript) a type: `type CreateNote = z.infer<typeof CreateNoteSchema>`. That's the superpower — one source of truth for types and validation.

### parse vs safeParse

```js
import { z } from "zod";

const NoteSchema = z.object({
  title:   z.string().min(1),
  content: z.string().optional()
});

// parse: throws ZodError on failure — use when a bad value is truly unexpected
const note = NoteSchema.parse({ title: "Hello", content: "World" });
console.log(note); // { title: 'Hello', content: 'World' }

// safeParse: returns { success, data } or { success: false, error } — use at API boundaries
const result = NoteSchema.safeParse({ title: "" });
if (!result.success) {
  console.log(result.error.issues);
  // [{ code: 'too_small', message: 'String must contain at least 1 character(s)', path: ['title'] }]
}
```

> [!OUTPUT]
> { title: 'Hello', content: 'World' }
> [
>   {
>     code: 'too_small',
>     minimum: 1,
>     type: 'string',
>     inclusive: true,
>     exact: false,
>     message: 'String must contain at least 1 character(s)',
>     path: [ 'title' ]
>   }
> ]

> [!PITFALL] Using parse inside a request handler
> `z.parse()` throws on invalid input. If you call it directly in an Express handler without a try/catch, an invalid request causes an unhandled exception that crashes the process (or bubbles to a generic 500 handler). Always use `safeParse` at API boundaries so you can return a well-formed 400 response.

### A validation middleware

```js
import { z } from "zod";

// Generic middleware factory — validates req.body against any schema
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map(i => ({
          path:    i.path.join("."),
          message: i.message
        }))
      });
    }
    req.body = result.data; // replace raw body with parsed, coerced, defaulted data
    next();
  };
}

// Usage
app.post("/notes", validateBody(CreateNoteSchema), createNoteHandler);
```

> [!OUTPUT]
> POST /notes  body: { "title": "" }
> HTTP 400
> { "error": "Validation failed", "issues": [{ "path": "title", "message": "String must contain at least 1 character(s)" }] }

Notice `req.body = result.data` — Zod fills in `.default()` values and strips unknown fields by default. Your handler always receives clean, typed data.

### Common Zod validators cheatsheet

```js
import { z } from "zod";

z.string().min(1).max(255).trim()
z.string().email()
z.string().url()
z.string().uuid()
z.string().regex(/^[a-z-]+$/)

z.number().int().positive()
z.number().min(0).max(100)

z.boolean()
z.literal("active")
z.enum(["draft", "published", "archived"])

z.array(z.string()).nonempty()
z.record(z.string(), z.number())          // { [key: string]: number }

z.object({ id: z.string().uuid() })
  .strict()                               // reject unknown keys

z.union([z.string(), z.number()])
z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), title: z.string() }),
  z.object({ type: z.literal("task"), done: z.boolean() })
])

z.date()
z.coerce.date()                           // parses "2025-01-01" strings to Date
z.coerce.number()                         // parses "42" strings to numbers
```

> [!NOTE] z.coerce for query parameters
> HTTP query parameters arrive as strings. `z.coerce.number()` and `z.coerce.boolean()` silently convert them to the right type, so `?limit=20` becomes the number `20` and `?active=true` becomes `true`.

## From Zod to OpenAPI

**OpenAPI 3.1** (formerly Swagger) is the standard for describing REST APIs as a YAML or JSON document. It powers client code generation, Postman imports, API gateways, and Swagger UI — an interactive playground served alongside your API.

Zod schemas and JSON Schema share the same logical model, so libraries like `zod-to-json-schema` and `@asteasolutions/zod-to-openapi` can generate OpenAPI definitions directly from your Zod objects.

### Manual JSON Schema mapping (to understand the structure)

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Notes API", "version": "1.0.0" },
  "paths": {
    "/notes": {
      "post": {
        "summary": "Create a note",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["title"],
                "properties": {
                  "title":   { "type": "string", "minLength": 1, "maxLength": 120 },
                  "content": { "type": "string", "maxLength": 10000 },
                  "tags":    { "type": "array", "items": { "type": "string" }, "maxItems": 10 },
                  "pinned":  { "type": "boolean", "default": false }
                }
              }
            }
          }
        },
        "responses": {
          "201": { "description": "Note created" },
          "400": { "description": "Validation error" }
        }
      }
    }
  }
}
```

### Generating it from Zod automatically

```js
import { z } from "zod";
import { extendZodWithOpenApi, OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import swaggerUi from "swagger-ui-express";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const CreateNoteSchema = registry.register(
  "CreateNote",
  z.object({
    title:   z.string().min(1).max(120).openapi({ example: "My First Note" }),
    content: z.string().max(10_000).optional(),
    tags:    z.array(z.string().max(30)).max(10).default([]),
    pinned:  z.boolean().default(false)
  })
);

registry.registerPath({
  method:  "post",
  path:    "/notes",
  summary: "Create a note",
  request: { body: { content: { "application/json": { schema: CreateNoteSchema } } } },
  responses: {
    201: { description: "Note created" },
    400: { description: "Validation error" }
  }
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const document  = generator.generateDocument({ openapi: "3.1.0", info: { title: "Notes API", version: "1.0.0" } });

// Serve Swagger UI
app.use("/docs", swaggerUi.serve, swaggerUi.setup(document));
app.get("/openapi.json", (req, res) => res.json(document));
```

> [!OUTPUT]
> Server running — Swagger UI at http://localhost:3000/docs
> OpenAPI JSON    at http://localhost:3000/openapi.json

> [!PRINCIPAL] Schema-first is the only defensible approach at team scale
> "API-first" development means the OpenAPI document is the contract that both the server and client implement against. When the schema is generated from your Zod validators, the docs and the runtime behaviour are always identical — there is no way to update one without the other. Compare this to hand-written OpenAPI YAML: it drifts from the implementation within weeks. Generated typed clients (via `openapi-typescript`, `orval`, or `openapi-fetch`) give frontend teams end-to-end type safety from a single source of truth.

## Try it yourself

Here is a pure-JavaScript schema validator that demonstrates the same concepts Zod implements internally — type checking, required fields, min/max constraints — returning structured error objects:

```js run
// Tiny schema validator — pure JS, no libraries
function validate(schema, data) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const missing = value === undefined || value === null || value === "";

    if (rules.required && missing) {
      errors.push({ path: field, message: `${field} is required` });
      continue; // skip further checks for this field if absent
    }
    if (missing) continue; // optional field absent — nothing to check

    if (rules.type === "string" && typeof value !== "string") {
      errors.push({ path: field, message: `${field} must be a string` });
      continue;
    }
    if (rules.type === "number" && typeof value !== "number") {
      errors.push({ path: field, message: `${field} must be a number` });
      continue;
    }
    if (rules.type === "boolean" && typeof value !== "boolean") {
      errors.push({ path: field, message: `${field} must be a boolean` });
      continue;
    }

    if (rules.type === "string") {
      if (rules.min !== undefined && value.length < rules.min)
        errors.push({ path: field, message: `${field} must be at least ${rules.min} characters` });
      if (rules.max !== undefined && value.length > rules.max)
        errors.push({ path: field, message: `${field} must be at most ${rules.max} characters` });
    }
    if (rules.type === "number") {
      if (rules.min !== undefined && value < rules.min)
        errors.push({ path: field, message: `${field} must be >= ${rules.min}` });
      if (rules.max !== undefined && value > rules.max)
        errors.push({ path: field, message: `${field} must be <= ${rules.max}` });
    }
    if (rules.enum && !rules.enum.includes(value))
      errors.push({ path: field, message: `${field} must be one of: ${rules.enum.join(", ")}` });
  }

  return errors.length === 0
    ? { ok: true,  data }
    : { ok: false, errors };
}

// ---- schema definition ----
const noteSchema = {
  title:   { type: "string",  required: true,  min: 1, max: 120 },
  content: { type: "string",  required: false, max: 10000 },
  status:  { type: "string",  required: false, enum: ["draft", "published"] },
  rating:  { type: "number",  required: false, min: 1, max: 5 },
  pinned:  { type: "boolean", required: false }
};

// ---- test cases ----
const cases = [
  { title: "Hello World", content: "Some text", status: "draft", rating: 4, pinned: false },
  { title: "",    content: "no title" },
  { title: "OK",  status: "archived" },
  { title: "OK",  rating: 10 },
  { content: "missing title" }
];

for (const input of cases) {
  const result = validate(noteSchema, input);
  if (result.ok) {
    console.log("VALID:", JSON.stringify(input));
  } else {
    console.log("INVALID:", JSON.stringify(input));
    for (const e of result.errors) console.log("  ->", e.message);
  }
  console.log("---");
}
```

## Exercise: add an `array` type with item validation

Extend the `validate` function above to support `type: "array"` with `minItems`, `maxItems`, and `items.type` (type-check each element). Test it with a `tags` field that must be an array of strings with 0–10 elements.

<details>
<summary>Show solution</summary>

```js run
function validate(schema, data) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const missing = value === undefined || value === null;

    if (rules.required && missing) {
      errors.push({ path: field, message: `${field} is required` });
      continue;
    }
    if (missing) continue;

    if (rules.type === "array") {
      if (!Array.isArray(value)) {
        errors.push({ path: field, message: `${field} must be an array` });
        continue;
      }
      if (rules.minItems !== undefined && value.length < rules.minItems)
        errors.push({ path: field, message: `${field} must have at least ${rules.minItems} items` });
      if (rules.maxItems !== undefined && value.length > rules.maxItems)
        errors.push({ path: field, message: `${field} must have at most ${rules.maxItems} items` });
      if (rules.items && rules.items.type) {
        value.forEach((item, idx) => {
          if (typeof item !== rules.items.type)
            errors.push({ path: `${field}[${idx}]`, message: `each item in ${field} must be a ${rules.items.type}` });
        });
      }
      continue;
    }

    if (rules.type === "string" && typeof value !== "string") {
      errors.push({ path: field, message: `${field} must be a string` });
      continue;
    }
    if (rules.type === "string") {
      if (rules.min !== undefined && value.length < rules.min)
        errors.push({ path: field, message: `${field} must be at least ${rules.min} characters` });
      if (rules.max !== undefined && value.length > rules.max)
        errors.push({ path: field, message: `${field} must be at most ${rules.max} characters` });
    }
  }

  return errors.length === 0 ? { ok: true, data } : { ok: false, errors };
}

const schema = {
  title: { type: "string", required: true, min: 1 },
  tags:  { type: "array",  required: false, minItems: 0, maxItems: 10, items: { type: "string" } }
};

const cases = [
  { title: "Good note", tags: ["node", "rest"] },
  { title: "Too many", tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) },
  { title: "Bad items", tags: ["ok", 42, true] },
  { title: "No tags" }
];

for (const input of cases) {
  const r = validate(schema, input);
  if (r.ok) {
    console.log("VALID:", JSON.stringify(input));
  } else {
    console.log("INVALID:", JSON.stringify(input));
    r.errors.forEach(e => console.log("  ->", e.message));
  }
  console.log("---");
}
```

</details>

## Project

**Build a production-style Notes/Tasks REST API with Zod validation, cursor pagination, and generated OpenAPI docs.**

You have built the conceptual pieces across all three Module 16 lessons. Now assemble them into a working service.

### Acceptance criteria

1. **Resources** — implement at minimum `/notes` (create, list, get, update, delete) following correct HTTP method semantics and status codes from lesson 16-resource-design.
2. **Validation** — every request body and every query parameter is validated with a Zod schema; invalid input returns `400` with structured `issues` — never a 500.
3. **Cursor pagination** — `GET /notes` supports `?limit=` and `?cursor=` using opaque base64 cursors; the response includes `{ data, nextCursor, hasMore }`.
4. **Filtering & sorting** — `GET /notes` supports at least `?status=draft|published` filtering and `?sort=createdAt|title&order=asc|desc` sorting; sort columns are allowlisted to prevent injection.
5. **OpenAPI docs** — serving `GET /openapi.json` returns a valid OpenAPI 3.1 document generated from the Zod schemas (via `@asteasolutions/zod-to-openapi` or `zod-openapi`); `GET /docs` serves Swagger UI.
6. **Error shape** — all error responses conform to `{ error: string, issues?: Array<{path, message}> }`; 5xx errors do not leak stack traces.

### Starter: the pure-logic core

This runnable block implements the full in-memory notes store with Zod-style validation (using the hand-rolled validator from the lesson), cursor pagination, and filtering — the same logic you will replace with real Zod and a real database:

```js run
// ---- tiny validator (from the lesson) ----
function validate(schema, data) {
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const missing = value === undefined || value === null || value === "";
    if (rules.required && missing) { errors.push({ path: field, message: `${field} is required` }); continue; }
    if (missing) continue;
    if (rules.type === "string" && typeof value !== "string") { errors.push({ path: field, message: `${field} must be a string` }); continue; }
    if (rules.type === "string") {
      if (rules.min !== undefined && value.length < rules.min) errors.push({ path: field, message: `${field} min length ${rules.min}` });
      if (rules.max !== undefined && value.length > rules.max) errors.push({ path: field, message: `${field} max length ${rules.max}` });
    }
    if (rules.enum && !rules.enum.includes(value)) errors.push({ path: field, message: `${field} must be one of ${rules.enum.join(", ")}` });
  }
  return errors.length === 0 ? { ok: true, data } : { ok: false, errors };
}

// ---- cursor helpers ----
function encodeCursor(id) { return btoa(JSON.stringify({ id })); }
function decodeCursor(token) { try { return JSON.parse(atob(token)).id; } catch { return null; } }

// ---- in-memory store ----
let nextId = 1;
const notes = [];

function createNote(input) {
  const schema = { title: { type: "string", required: true, min: 1, max: 120 }, status: { type: "string", required: false, enum: ["draft", "published"] } };
  const v = validate(schema, input);
  if (!v.ok) return { status: 400, body: { error: "Validation failed", issues: v.errors } };
  const note = { id: nextId++, title: input.title, status: input.status ?? "draft", createdAt: Date.now() };
  notes.push(note);
  return { status: 201, body: note };
}

function listNotes({ cursor, limit = 5, statusFilter }) {
  let items = statusFilter ? notes.filter(n => n.status === statusFilter) : [...notes];
  let startIndex = 0;
  if (cursor) {
    const lastId = decodeCursor(cursor);
    const pos = items.findIndex(n => n.id === lastId);
    startIndex = pos === -1 ? 0 : pos + 1;
  }
  const slice   = items.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const page    = hasMore ? slice.slice(0, limit) : slice;
  return {
    status: 200,
    body: {
      data: page,
      hasMore,
      nextCursor: hasMore ? encodeCursor(page[page.length - 1].id) : null
    }
  };
}

// ---- demo ----
["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"].forEach((t, i) =>
  createNote({ title: t, status: i % 2 === 0 ? "draft" : "published" })
);

// Invalid create
const bad = createNote({ title: "" });
console.log("Create invalid:", JSON.stringify(bad));

// Page 1
const p1 = listNotes({ limit: 3 });
console.log("\nPage 1:", p1.body.data.map(n => n.title), "hasMore:", p1.body.hasMore);

// Page 2 via cursor
const p2 = listNotes({ cursor: p1.body.nextCursor, limit: 3 });
console.log("Page 2:", p2.body.data.map(n => n.title), "hasMore:", p2.body.hasMore);

// Filtered: published only
const pub = listNotes({ statusFilter: "published", limit: 10 });
console.log("\nPublished:", pub.body.data.map(n => n.title));
```

## Common pitfalls

> [!PITFALL] Validating only the body and forgetting path params and query strings
> A common incomplete implementation validates `req.body` with Zod but reads `req.params.id` and `req.query.limit` raw. An attacker sends `?limit=DROP TABLE notes--` or an invalid UUID as `:id` and your database layer crashes. Validate *every* source of external input: `params`, `query`, `body`, and `headers` where relevant.

Never log the raw Zod error object directly into an HTTP response in production — it can expose internal field names, database column names, or business logic. Map it to a safe public shape first (as shown in the middleware example).

## What you learned

- **Zod** provides runtime validation and static TypeScript types from a single schema definition.
- `safeParse` is the right tool at API boundaries — it returns a result object instead of throwing, letting you return a proper 400 response.
- Zod's `.default()` and `z.coerce.*` handle missing optional fields and query-string type coercion automatically.
- OpenAPI documents can be **generated** from Zod schemas, eliminating drift between docs and implementation.
- A schema-first workflow — define Zod schema, generate OpenAPI, generate typed client — gives you end-to-end type safety from database to frontend.

## Next steps

With a fully validated, paginated, self-documenting REST API under your belt, the next module covers relational databases with SQL — connecting your API to persistent storage and writing queries that are as carefully designed as the routes they serve.
*/});
