registerLessonSrc("18-prisma", function () {/*
---
id: 18-prisma
title: "Prisma: Schema, Client & Migrations"
minutes: 24
level: intermediate
objectives:
  - Understand the Prisma schema language and how it drives code generation
  - Use the generated Prisma Client with full type safety for CRUD and relations
  - Run and manage database migrations with Prisma Migrate
---

# Prisma: Schema, Client & Migrations

## Why this matters

ORMs let you work with a database using the same language and types as the rest of your app. Prisma goes further: it generates a type-safe client *directly from your schema*, so your editor catches typos, wrong field names, and missing required fields before a query ever hits the database. For teams shipping fast, that feedback loop is worth a lot.

## Learning objectives

- Read and write a Prisma schema file including models, field types, and relations.
- Use the generated Prisma Client for CRUD operations with full TypeScript inference.
- Run `prisma migrate dev` and understand what it does and why it matters.

## The Prisma schema

Everything in Prisma starts with `schema.prisma`. Three parts live in this one file: the **datasource** (which database and its URL), the **generator** (what to generate — almost always `prisma-client-js`), and your **models** (the tables).

```js
// prisma/schema.prisma
// datasource + generator

// datasource db {
//   provider = "postgresql"   // "mysql" | "sqlite" | "sqlserver" | "mongodb"
//   url      = env("DATABASE_URL")
// }

// generator client {
//   provider = "prisma-client-js"
// }

// model User {
//   id        Int      @id @default(autoincrement())
//   email     String   @unique
//   name      String?
//   createdAt DateTime @default(now())
//   posts     Post[]   // relation field (not a DB column)
// }

// model Post {
//   id        Int      @id @default(autoincrement())
//   title     String
//   published Boolean  @default(false)
//   authorId  Int
//   author    User     @relation(fields: [authorId], references: [id])
// }
```

> [!NOTE] The schema is the single source of truth
> The schema drives three things at once: the database structure (via migrations), the generated TypeScript types, and the runtime client. Change the schema, re-run generation, and every layer updates together.

Key schema concepts:

- **`@id`** — marks the primary key.
- **`@unique`** — adds a unique constraint.
- **`@default(...)`** — sets a column default (`autoincrement()`, `now()`, `uuid()`, `cuid()`).
- **`?`** — makes a field optional (nullable in the DB).
- **`[]`** — one-to-many relation side (no column in the DB; pure Prisma navigation).
- **`@relation`** — defines the FK columns explicitly.

## The generated Prisma Client

After running `npx prisma generate`, Prisma writes a fully-typed client into `node_modules/@prisma/client`. You import and instantiate it once, then use it everywhere:

```js
// src/db.js  (or db.ts)
import { PrismaClient } from "@prisma/client";

// One global instance — creating it per-request leaks connections.
const prisma = new PrismaClient({
  log: ["query", "warn", "error"],  // optional query logging
});

export default prisma;
```

### CRUD operations

The API is model-centric. Every model you define in the schema becomes a property on the client (`prisma.user`, `prisma.post`, etc.) with a consistent set of methods.

```js
// src/users.js
import prisma from "./db.js";

// CREATE
async function createUser(email, name) {
  const user = await prisma.user.create({
    data: { email, name },
  });
  return user;  // type: { id: number; email: string; name: string | null; createdAt: Date }
}

// READ — find unique (throws if not found; use findUnique for null)
async function getUserById(id) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

// READ — find many with filtering, sorting, pagination
async function listPublishedPosts(page = 1, perPage = 20) {
  return prisma.post.findMany({
    where:   { published: true },
    orderBy: { createdAt: "desc" },
    skip:    (page - 1) * perPage,
    take:    perPage,
    select:  { id: true, title: true, author: { select: { name: true } } },
  });
}

// UPDATE
async function publishPost(id) {
  return prisma.post.update({
    where: { id },
    data:  { published: true },
  });
}

// DELETE
async function removeUser(id) {
  return prisma.user.delete({ where: { id } });
}
```

> [!OUTPUT]
> // createUser output (TypeScript type shown in IDE):
> { id: 1, email: 'ada@example.com', name: 'Ada', createdAt: 2026-01-15T10:00:00.000Z }
>
> // listPublishedPosts output (select projection):
> [ { id: 3, title: 'Node 24 Internals', author: { name: 'Ada' } } ]

### Loading relations

Prisma does not join automatically. You opt in with **`include`** or **`select`**:

```js
// include: eager-load the relation as a nested object
const userWithPosts = await prisma.user.findUniqueOrThrow({
  where:   { id: 1 },
  include: { posts: { where: { published: true } } },
});
// userWithPosts.posts is Post[]

// select: fine-grained projection — you choose exactly which fields come back
const slim = await prisma.user.findMany({
  select: { email: true, _count: { select: { posts: true } } },
});
// slim[0]._count.posts == number of posts for that user
```

> [!PITFALL] Forgetting `include` and then accessing the relation
> If you don't include `posts`, `user.posts` is `undefined` at runtime and TypeScript *also* won't show the property — the type literally omits it. This is by design, but it surprises beginners who expect Rails-style lazy loading.

## Migrations with Prisma Migrate

The migration workflow is straightforward:

```bash
# 1. Edit schema.prisma
# 2. Create and apply the migration (dev only)
npx prisma migrate dev --name add-published-flag

# 3. In CI / production — apply pending migrations without prompting
npx prisma migrate deploy
```

`migrate dev` does three things: generates the SQL diff, writes it to `prisma/migrations/<timestamp>_<name>/migration.sql`, and applies it to your dev database. You commit the `migrations/` folder — it's your DB audit trail.

```bash
# Other useful commands
npx prisma studio          # local GUI to browse + edit data
npx prisma db seed         # run prisma/seed.ts (configure in package.json)
npx prisma db push         # apply schema without creating migration files (prototyping)
npx prisma format          # auto-format schema.prisma
```

> [!PRINCIPAL] Schema-first vs code-first
> Prisma is firmly schema-first: the `.prisma` file is the canonical truth. Some ORMs (TypeORM, MikroORM in `EntitySchema` mode) go code-first — decorators on classes define the schema. Schema-first is easier to read in PRs, plays better with database-side tooling (EXPLAIN, GUI clients), and avoids the implicit-magic that decorators introduce. The tradeoff is one extra file to maintain; for teams larger than one that's almost always worth it.

## Try it yourself

The generated Prisma Client uses a fluent, chainable-ish builder pattern under the hood. Let's build a miniature version of that pattern in pure JavaScript — a query-builder that accumulates `.where()`, `.select()`, and `.orderBy()` calls and produces a structured query object you can inspect.

```js run
function createQueryBuilder(model) {
  const q = { model, conditions: [], fields: null, order: null, limitN: null };

  const builder = {
    where(conditions) {
      Object.entries(conditions).forEach(([k, v]) => q.conditions.push({ k, v }));
      return builder;
    },
    select(fields) {
      q.fields = Object.keys(fields).filter(k => fields[k]);
      return builder;
    },
    orderBy(field, dir = "asc") {
      q.order = { field, dir };
      return builder;
    },
    take(n) {
      q.limitN = n;
      return builder;
    },
    build() {
      return {
        FROM:    q.model,
        WHERE:   q.conditions.map(c => `${c.k} = ${JSON.stringify(c.v)}`).join(" AND ") || "1=1",
        SELECT:  q.fields ? q.fields.join(", ") : "*",
        ORDER:   q.order ? `${q.order.field} ${q.order.dir.toUpperCase()}` : null,
        LIMIT:   q.limitN,
      };
    },
  };

  return builder;
}

const query = createQueryBuilder("Post")
  .where({ published: true })
  .where({ authorId: 42 })
  .select({ id: true, title: true })
  .orderBy("createdAt", "desc")
  .take(10)
  .build();

console.log(JSON.stringify(query, null, 2));
```

## Exercise

**Challenge:** extend the query builder above so that `.include(model)` records a relation to join, and `.build()` includes an `INCLUDE` key in the output. Then chain `.include("author")` onto a builder for `"Post"`.

<details>
<summary>Show solution</summary>

```js run
function createQueryBuilder(model) {
  const q = { model, conditions: [], fields: null, order: null, limitN: null, includes: [] };

  const builder = {
    where(conditions) {
      Object.entries(conditions).forEach(([k, v]) => q.conditions.push({ k, v }));
      return builder;
    },
    select(fields) {
      q.fields = Object.keys(fields).filter(k => fields[k]);
      return builder;
    },
    orderBy(field, dir = "asc") {
      q.order = { field, dir };
      return builder;
    },
    take(n) {
      q.limitN = n;
      return builder;
    },
    include(relation) {
      q.includes.push(relation);
      return builder;
    },
    build() {
      return {
        FROM:    q.model,
        WHERE:   q.conditions.map(c => `${c.k} = ${JSON.stringify(c.v)}`).join(" AND ") || "1=1",
        SELECT:  q.fields ? q.fields.join(", ") : "*",
        ORDER:   q.order ? `${q.order.field} ${q.order.dir.toUpperCase()}` : null,
        LIMIT:   q.limitN,
        INCLUDE: q.includes.length ? q.includes : null,
      };
    },
  };

  return builder;
}

const result = createQueryBuilder("Post")
  .where({ published: true })
  .select({ id: true, title: true })
  .include("author")
  .orderBy("createdAt", "desc")
  .build();

console.log(JSON.stringify(result, null, 2));
// INCLUDE: ["author"] — Prisma would JOIN users and nest the object
```

The real Prisma Client does something structurally similar: it collects your intent and compiles it to a query engine protocol at call time.
</details>

## Common pitfalls

> [!PITFALL] Instantiating PrismaClient in hot paths
> In serverless functions it is tempting to write `const prisma = new PrismaClient()` inside the handler. Each cold start creates a new connection pool and the old one is never cleaned up. Use a module-level singleton (or the official `@prisma/client` singleton pattern for Next.js) and re-use it across invocations.

Other frequent mistakes:

- **Using `db push` in production.** `prisma db push` skips the migration history — fine for prototyping, but it means you have no audit trail and no rollback. Always use `migrate deploy` in production.
- **Forgetting `onDelete` rules on relations.** Without `onDelete: Cascade` on a FK, deleting a parent record throws a foreign-key violation at runtime. Prisma's default is `Restrict`.
- **Over-fetching with `include`.** Nested includes multiply DB round-trips in some query shapes. Use `select` with only the fields you need, or reach for raw SQL for complex aggregation.

## What you learned

- The `schema.prisma` file is the single source of truth — it drives the database schema, migrations, and the generated TypeScript types simultaneously.
- The Prisma Client API is model-centric: `prisma.user.findMany(...)`, `prisma.post.create(...)`, with `where`, `select`, `include`, `orderBy`, and `take`/`skip` for pagination.
- `prisma migrate dev` writes SQL migration files you commit; `prisma migrate deploy` applies them in CI/production without prompting.
- Relations are opt-in at query time via `include` or `select` — there is no lazy loading.
- `prisma studio` gives you an instant GUI to browse and edit data during development.

## Next steps

Next we'll look at **Drizzle**, an ORM that takes a different philosophy — writing SQL is a first-class activity, not something to be hidden — and compare how its type safety and query model differ from Prisma's.
*/});
