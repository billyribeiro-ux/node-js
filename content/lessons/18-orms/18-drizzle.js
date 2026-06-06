registerLessonSrc("18-drizzle", function () {/*
---
id: 18-drizzle
title: "Drizzle: SQL-First & Type-Safe"
minutes: 24
level: advanced
objectives:
  - Define a Drizzle schema in TypeScript and understand how types are inferred
  - Write queries using Drizzle's SQL-first builder and read its generated SQL
  - Contrast Drizzle's philosophy with Prisma and choose the right tool for a project
---

# Drizzle: SQL-First & Type-Safe

## Why this matters

Most ORMs treat SQL as an implementation detail — something the library generates so you don't have to think about it. Drizzle takes the opposite stance: SQL is the model, and the TypeScript API is a thin, typed wrapper over it. That means you always know the SQL you're producing, you can drop to raw SQL at any point without leaving the type system, and you carry your mental model of relational databases directly into your code.

## Learning objectives

- Define tables and relations in a Drizzle schema file using TypeScript column helpers.
- Build select, insert, update, and delete queries and read the SQL they produce.
- Use `drizzle-kit` to generate and push migrations.
- Know when Drizzle's SQL-first approach is a better fit than Prisma's abstraction.

## Schema definition: TypeScript all the way down

Unlike Prisma's custom DSL, Drizzle schemas are **pure TypeScript**. You import column helpers and call them directly:

```ts
// src/schema.ts
import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id:        serial("id").primaryKey(),
  email:     text("email").notNull().unique(),
  name:      text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id:        serial("id").primaryKey(),
  title:     text("title").notNull(),
  published: boolean("published").default(false).notNull(),
  authorId:  integer("author_id").notNull().references(() => users.id),
});
```

Because it's TypeScript, the column definitions are inspectable at compile time. Drizzle infers two types per table automatically:

- **`typeof users.$inferSelect`** — the shape of a row you get back from a SELECT query.
- **`typeof users.$inferInsert`** — the shape expected when inserting (optional fields have `?`).

```ts
// src/types.ts
import { users, posts } from "./schema.js";

type User       = typeof users.$inferSelect;
// { id: number; email: string; name: string | null; createdAt: Date }

type NewUser    = typeof users.$inferInsert;
// { id?: number; email: string; name?: string | null; createdAt?: Date }
```

> [!NOTE] No separate code-generation step for types
> Prisma runs `prisma generate` to write types into `node_modules`. Drizzle's types come directly from the schema file at authorship time — your editor picks them up immediately, and there is no out-of-sync risk between the schema file and the generated code.

## Querying: SQL you can read

Connect the client once, then build queries. Drizzle's query builder maps almost 1:1 to SQL clauses:

```ts
// src/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool }    from "pg";
import * as schema from "./schema.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

```ts
// src/queries.ts
import { db }              from "./db.js";
import { users, posts }    from "./schema.js";
import { eq, and, desc }   from "drizzle-orm";

// SELECT id, title FROM posts WHERE published = true ORDER BY id DESC LIMIT 20
async function latestPosts() {
  return db
    .select({ id: posts.id, title: posts.title })
    .from(posts)
    .where(eq(posts.published, true))
    .orderBy(desc(posts.id))
    .limit(20);
}

// INSERT INTO users (email, name) VALUES (...) RETURNING *
async function createUser(email: string, name: string) {
  const [user] = await db.insert(users).values({ email, name }).returning();
  return user;
}

// UPDATE posts SET published = true WHERE id = $1
async function publishPost(id: number) {
  await db.update(posts).set({ published: true }).where(eq(posts.id, id));
}

// DELETE FROM users WHERE id = $1
async function deleteUser(id: number) {
  await db.delete(users).where(eq(users.id, id));
}
```

> [!OUTPUT]
> // latestPosts() result:
> [ { id: 7, title: 'Node 24 Internals' }, { id: 3, title: 'Drizzle Deep Dive' } ]
>
> // createUser() result:
> { id: 1, email: 'ada@example.com', name: 'Ada', createdAt: 2026-01-15T10:00:00.000Z }

### Joins — explicit, readable, typed

Drizzle joins are explicit SQL joins, not hidden eager-loading:

```ts
// SELECT users.name, posts.title FROM posts
//   JOIN users ON posts.author_id = users.id
//   WHERE posts.published = true
const results = await db
  .select({ author: users.name, title: posts.title })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(eq(posts.published, true));
// results: Array<{ author: string | null; title: string }>
```

The return type is inferred from exactly what you pass to `.select()`. If you select `users.name` and `posts.title`, those — and only those — appear in the result type. You cannot accidentally access a field you did not select.

> [!PRINCIPAL] The leaky abstraction argument
> When an ORM hides SQL, it hides the performance characteristics too. A join and two separate queries look similar in an ORM API but have very different costs at scale. Drizzle's philosophy is that a senior engineer should never be surprised by the SQL their code produces. By keeping the API close to SQL, Drizzle avoids the "what query did that generate?" debugging session. This is a deliberate tradeoff: more explicit code in exchange for total transparency.

### The Relational Query API (a Prisma-like option)

Drizzle also ships a higher-level **Relational Query API** that reads more like Prisma — useful when you want nested data without writing the join yourself:

```ts
// Requires defining relations in schema.ts first:
// import { relations } from "drizzle-orm";
// export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }));
// export const postsRelations = relations(posts, ({ one })  => ({
//   author: one(users, { fields: [posts.authorId], references: [users.id] }),
// }));

// Then query with automatic join planning:
const usersWithPosts = await db.query.users.findMany({
  with: { posts: { where: eq(posts.published, true) } },
});
// usersWithPosts: Array<User & { posts: Post[] }>
```

This generates an efficient query (often a single SQL statement with a JSON aggregate), but you can always call `.toSQL()` on any builder to inspect what Drizzle will send:

```ts
const q = db.select().from(posts).where(eq(posts.published, true));
console.log(q.toSQL());
// { sql: 'select * from "posts" where "posts"."published" = $1', params: [true] }
```

## drizzle-kit: migrations and introspection

`drizzle-kit` is the companion CLI. It compares your TypeScript schema to the actual database and generates the SQL diff:

```bash
# drizzle.config.ts controls the CLI
# export default { schema: "./src/schema.ts", out: "./drizzle", dialect: "postgresql", ... }

# Generate SQL migration files from schema changes
npx drizzle-kit generate

# Apply pending migrations
npx drizzle-kit migrate

# Inspect an existing database and generate a schema file from it
npx drizzle-kit introspect

# Push schema directly (prototype mode, no migration files)
npx drizzle-kit push
```

Migration files are plain SQL — no custom DSL, no binary format. You can read, audit, and even hand-edit them before applying.

```bash
# drizzle/0001_add_published_flag.sql
# ALTER TABLE "posts" ADD COLUMN "published" boolean DEFAULT false NOT NULL;
```

> [!NOTE] Drizzle Kit vs Prisma Migrate
> Both tools generate SQL diffs. Drizzle Kit writes raw SQL files; Prisma Migrate writes SQL wrapped in a manifest. Both commit migration files into version control. Drizzle's SQL files are slightly more portable — a DBA comfortable with SQL can review them without learning any ORM specifics.

## Try it yourself

A Drizzle query builder builds SQL strings from method chains. Let's implement a typed-ish version in pure JavaScript that mirrors Drizzle's `.select().from().where().orderBy().limit()` shape and outputs the SQL string it would produce.

```js run
// A mini SQL builder in pure JS — mirrors Drizzle's core API shape
function select(...cols) {
  const state = {
    cols:    cols.length ? cols : ["*"],
    table:   null,
    wheres:  [],
    orders:  [],
    limitN:  null,
  };

  const builder = {
    from(table) {
      state.table = table;
      return builder;
    },
    where(condition) {
      state.wheres.push(condition);
      return builder;
    },
    orderBy(...cols) {
      state.orders.push(...cols);
      return builder;
    },
    limit(n) {
      state.limitN = n;
      return builder;
    },
    toSQL() {
      let sql = `SELECT ${state.cols.join(", ")} FROM "${state.table}"`;
      if (state.wheres.length) sql += ` WHERE ${state.wheres.join(" AND ")}`;
      if (state.orders.length) sql += ` ORDER BY ${state.orders.join(", ")}`;
      if (state.limitN !== null) sql += ` LIMIT ${state.limitN}`;
      return sql;
    },
  };

  return builder;
}

// Helper that mirrors drizzle-orm's eq()
function eq(col, val) {
  return `"${col}" = ${typeof val === "string" ? `'${val}'` : val}`;
}
function desc(col) { return `"${col}" DESC`; }

const sql = select("id", "title")
  .from("posts")
  .where(eq("published", true))
  .where(eq("author_id", 42))
  .orderBy(desc("id"))
  .limit(10)
  .toSQL();

console.log(sql);
// SELECT id, title FROM "posts"
//   WHERE "published" = true AND "author_id" = 42
//   ORDER BY "id" DESC LIMIT 10
```

## Exercise

**Challenge:** extend the mini builder above with an `.innerJoin(table, condition)` method that inserts a `JOIN` clause into the generated SQL. Then use it to join `"users"` on `"posts"."author_id" = "users"."id"`.

<details>
<summary>Show solution</summary>

```js run
function select(...cols) {
  const state = {
    cols:   cols.length ? cols : ["*"],
    table:  null,
    joins:  [],
    wheres: [],
    orders: [],
    limitN: null,
  };

  const builder = {
    from(table)           { state.table = table; return builder; },
    innerJoin(table, on)  { state.joins.push({ table, on }); return builder; },
    where(cond)           { state.wheres.push(cond); return builder; },
    orderBy(...c)         { state.orders.push(...c); return builder; },
    limit(n)              { state.limitN = n; return builder; },
    toSQL() {
      let sql = `SELECT ${state.cols.join(", ")} FROM "${state.table}"`;
      for (const j of state.joins) sql += ` INNER JOIN "${j.table}" ON ${j.on}`;
      if (state.wheres.length) sql += ` WHERE ${state.wheres.join(" AND ")}`;
      if (state.orders.length) sql += ` ORDER BY ${state.orders.join(", ")}`;
      if (state.limitN !== null) sql += ` LIMIT ${state.limitN}`;
      return sql;
    },
  };
  return builder;
}

function eq(col, val) {
  return `"${col}" = ${typeof val === "string" ? `'${val}'` : val}`;
}

const sql = select("users.name", "posts.title")
  .from("posts")
  .innerJoin("users", eq("posts.author_id", '"users"."id"'))
  .where(eq("posts.published", true))
  .toSQL();

console.log(sql);
// SELECT users.name, posts.title FROM "posts"
//   INNER JOIN "users" ON "posts"."author_id" = "users"."id"
//   WHERE "posts"."published" = true
```

Real Drizzle does exactly this: each method accumulates intent, and `.toSQL()` (or the internal executor) renders the final SQL with parameterised placeholders instead of inlined values.
</details>

## Common pitfalls

> [!PITFALL] Using Drizzle without understanding SQL
> Drizzle's SQL-first design means the library will not protect you from writing an N+1 or a Cartesian-product join. If you write `.innerJoin()` without a proper ON clause, you get a cross join. The transparency cuts both ways: you get what you write, so you need to think in SQL.

Other traps:

- **Forgetting `.returning()` on inserts.** `db.insert(...).values(...)` returns a row count by default on PostgreSQL; chain `.returning()` to get the inserted rows back.
- **Mixing the SQL builder API and the Relational API carelessly.** They compose differently. The Relational API needs `relations` definitions; the SQL builder does not and ignores them.
- **Assuming `drizzle-kit push` is safe in production.** Like `prisma db push`, it bypasses the migration history. Use `drizzle-kit migrate` in production.

## What you learned

- Drizzle schemas are TypeScript files — no DSL, no code-generation step; types are inferred at author time via `$inferSelect` and `$inferInsert`.
- The query builder API mirrors SQL clause-by-clause (`.select().from().where().orderBy().limit()`), and `.toSQL()` reveals the exact statement that will run.
- `drizzle-kit generate` diffs the schema against the live database and writes plain SQL migration files.
- Drizzle offers two APIs: a low-level SQL builder (always explicit) and a Relational Query API (Prisma-like ergonomics for nested data).
- Total SQL transparency is Drizzle's core differentiator — great when you think in SQL and want no surprises.

## Next steps

You now know both leading ORMs. The last lesson in this module examines when *not* to use an ORM at all — and how the N+1 problem, leaky abstractions, and raw SQL escape hatches affect production systems.
*/});
