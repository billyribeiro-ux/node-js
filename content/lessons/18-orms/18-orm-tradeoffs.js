registerLessonSrc("18-orm-tradeoffs", function () {/*
---
id: 18-orm-tradeoffs
title: "ORM vs Raw SQL & Performance"
minutes: 28
level: advanced
objectives:
  - Identify when an ORM helps and when it becomes an obstacle
  - Explain the N+1 problem and implement DataLoader-style batching to fix it
  - Use raw SQL escape hatches in Prisma and Drizzle when abstraction leaks
---

# ORM vs Raw SQL & Performance

## Why this matters

Adopting an ORM is a significant architectural decision. It changes how your team reasons about data, how your code evolves, and — critically — how your database performs under load. Senior engineers can tell stories of ORMs speeding up development dramatically in the early days and quietly destroying throughput at scale. Understanding the tradeoffs up front lets you make the choice intentionally and reach for the right escape hatch before the database catches fire.

## Learning objectives

- Articulate when an ORM accelerates development and when it becomes a liability.
- Diagnose the **N+1 problem** and fix it with DataLoader-style query batching.
- Call raw SQL from Prisma (`$queryRaw`) and Drizzle (`sql` tagged template) when needed.
- Recognise leaky abstraction symptoms and know which layer to debug.

## When ORMs help

An ORM earns its keep in several situations:

**1. CRUD-heavy, schema-driven domains.** When your data model is relational and your queries are mostly create-read-update-delete with simple filters, the ORM's type-safe API eliminates a large class of bugs (wrong column name, wrong type, missing field on insert).

**2. Team onboarding.** A Prisma model or a Drizzle table definition is self-documenting. A new engineer can read the schema file and know the database shape without a separate ER diagram.

**3. Multi-database portability.** If your product supports PostgreSQL and SQLite (e.g., self-hosted vs cloud), the ORM abstracts the dialect differences. Switching drivers is a one-line config change.

**4. Migrations as code.** Both Prisma Migrate and drizzle-kit track schema evolution in version control. That's far safer than hand-crafting `ALTER TABLE` statements in a shared staging environment.

## When ORMs hurt

> [!PITFALL] Treating the ORM as a magic performance layer
> ORMs do not optimise queries for you. They faithfully translate your API calls into SQL — including inefficient SQL. The query you write is (approximately) the query that runs. Always check generated SQL in staging before going to production.

**1. Complex analytical queries.** Multi-level aggregations, window functions, CTEs, lateral joins — most ORMs handle these poorly or not at all. Raw SQL wins here, both in readability and maintainability.

**2. Bulk operations.** `prisma.user.updateMany()` and `drizzle.update()` each generate one SQL statement, but if you call them in a loop you get N statements. Proper bulk upserts, `COPY`, and `INSERT ... ON CONFLICT DO UPDATE` require raw SQL.

**3. The N+1 problem.** This is the ORM's most famous failure mode. It is subtle enough to deserve its own section.

## The N+1 problem

Imagine you want to display a list of posts with their author's name. A naive ORM implementation:

```js
// src/naive.js — BROKEN performance pattern
import prisma from "./db.js";

async function getPostsWithAuthors() {
  const posts = await prisma.post.findMany();   // Query 1: SELECT * FROM posts  (returns N rows)

  // This loop runs N more queries — one per post!
  const results = await Promise.all(
    posts.map(p =>
      prisma.user.findUnique({ where: { id: p.authorId } }) // Queries 2..N+1
    )
  );

  return posts.map((p, i) => ({ ...p, author: results[i] }));
}
// Total queries: 1 + N   <- grows linearly with the number of posts
```

> [!OUTPUT]
> Fetching 100 posts: 101 database queries
> Fetching 1 000 posts: 1 001 database queries

In Prisma you fix this by using `include` or a single join. But the pattern recurs in GraphQL resolvers, REST endpoints that fan out to microservices, and any place where loading a list triggers per-item lookups.

**DataLoader-style batching** is the general solution. Instead of fetching immediately, you collect IDs, wait a tick, then fetch all of them in one query:

```js
// src/batcher.js — conceptual DataLoader
import prisma from "./db.js";

function createUserBatcher() {
  let pending = new Map();   // id -> { resolve, reject }
  let scheduled = false;

  async function flush() {
    const ids = [...pending.keys()];
    const users = await prisma.user.findMany({ where: { id: { in: ids } } });
    const byId = new Map(users.map(u => [u.id, u]));
    for (const [id, { resolve }] of pending) {
      resolve(byId.get(id) ?? null);
    }
    pending.clear();
    scheduled = false;
  }

  return function load(id) {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (!scheduled) {
        scheduled = true;
        Promise.resolve().then(flush); // microtask: batches everything in this tick
      }
    });
  };
}

// Usage in a request handler:
const loadUser = createUserBatcher();

async function getPostsWithAuthors() {
  const posts = await prisma.post.findMany();
  // All loadUser(id) calls in this tick are batched into ONE query:
  return Promise.all(posts.map(async p => ({ ...p, author: await loadUser(p.authorId) })));
}
// Total queries: 1 (posts) + 1 (batched users) = 2, regardless of N
```

> [!OUTPUT]
> Fetching 100 posts: 2 database queries
> Fetching 1 000 posts: 2 database queries

> [!PRINCIPAL] DataLoader is a pattern, not just a library
> Facebook's `dataloader` package implements this batching-on-a-microtask pattern for GraphQL. The core idea — collect IDs for a tick, then batch-fetch — applies to any async lookup: HTTP calls, Redis gets, or ORM queries. Internalise the pattern and you can implement it anywhere in minutes.

## Leaky abstractions and raw SQL escape hatches

Every ORM abstracts SQL — and every abstraction eventually leaks. You will encounter a query the ORM cannot express efficiently. Both Prisma and Drizzle have first-class escape hatches.

**Prisma — `$queryRaw` and `$executeRaw`:**

```js
// src/raw-prisma.js
import prisma from "./db.js";
import { Prisma } from "@prisma/client";

// Tagged template — Prisma parameterises automatically (no SQL injection risk)
async function topAuthors(limit) {
  return prisma.$queryRaw`
    SELECT u.id, u.name, COUNT(p.id)::int AS post_count
    FROM users u
    JOIN posts p ON p.author_id = u.id
    WHERE p.published = true
    GROUP BY u.id, u.name
    ORDER BY post_count DESC
    LIMIT ${limit}
  `;
}
// Returns: Array<{ id: number; name: string; post_count: number }>
// NOTE: $queryRaw return type is unknown[] — you supply a type assertion or Zod parse.
```

> [!OUTPUT]
> [ { id: 1, name: 'Ada', post_count: 14 }, { id: 3, name: 'Grace', post_count: 9 } ]

**Drizzle — `sql` tagged template:**

```ts
// src/raw-drizzle.ts
import { db }  from "./db.js";
import { sql } from "drizzle-orm";

async function topAuthors(limit: number) {
  return db.execute(sql`
    SELECT u.id, u.name, COUNT(p.id)::int AS post_count
    FROM users u
    JOIN posts p ON p.author_id = u.id
    WHERE p.published = true
    GROUP BY u.id, u.name
    ORDER BY post_count DESC
    LIMIT ${limit}
  `);
}
// Drizzle still parameterises ${limit} safely.
```

Both approaches keep parameterisation — the ORM handles escaping — so you get raw SQL expressiveness without SQL-injection risk.

## Try it yourself

Let's prove the N+1 problem concretely with counters instead of a live database. We simulate fetching posts and their authors with two strategies and compare query counts.

```js run
// Simulate a tiny in-memory "database"
const DB_POSTS = [
  { id: 1, title: "Streams", authorId: 10 },
  { id: 2, title: "Events",  authorId: 11 },
  { id: 3, title: "Buffers", authorId: 10 },
  { id: 4, title: "Modules", authorId: 12 },
  { id: 5, title: "Cluster", authorId: 11 },
];
const DB_USERS = {
  10: { id: 10, name: "Ada"   },
  11: { id: 11, name: "Grace" },
  12: { id: 12, name: "Alan"  },
};

let queryCount = 0;

// Simulated "ORM" fetchers
function findAllPosts() {
  queryCount++;
  return Promise.resolve([...DB_POSTS]);
}
function findUserById(id) {
  queryCount++;
  return Promise.resolve(DB_USERS[id] ?? null);
}
function findUsersByIds(ids) {
  queryCount++;
  return Promise.resolve(ids.map(id => DB_USERS[id]).filter(Boolean));
}

// --- Strategy 1: N+1 ---
async function naiveFetch() {
  queryCount = 0;
  const posts = await findAllPosts();
  const results = await Promise.all(posts.map(p => findUserById(p.authorId)));
  const data = posts.map((p, i) => ({ title: p.title, author: results[i].name }));
  console.log("N+1 strategy — queries:", queryCount);
  return data;
}

// --- Strategy 2: Batched ---
async function batchedFetch() {
  queryCount = 0;
  const posts   = await findAllPosts();
  const ids     = [...new Set(posts.map(p => p.authorId))]; // deduplicate
  const authors = await findUsersByIds(ids);
  const byId    = new Map(authors.map(u => [u.id, u]));
  const data    = posts.map(p => ({ title: p.title, author: byId.get(p.authorId).name }));
  console.log("Batched strategy — queries:", queryCount);
  return data;
}

(async () => {
  await naiveFetch();
  await batchedFetch();
})();
```

## Exercise

**Challenge:** The batched fetch above still issues one user query per *unique* author. Extend the `batchedFetch` to use the DataLoader microtask pattern (collect IDs for one tick, then flush) so that even if the posts are loaded one at a time, the user lookups still collapse into a single query. Log the query count.

<details>
<summary>Show solution</summary>

```js run
const DB_POSTS = [
  { id: 1, title: "Streams", authorId: 10 },
  { id: 2, title: "Events",  authorId: 11 },
  { id: 3, title: "Buffers", authorId: 10 },
  { id: 4, title: "Modules", authorId: 12 },
];
const DB_USERS = {
  10: { id: 10, name: "Ada"   },
  11: { id: 11, name: "Grace" },
  12: { id: 12, name: "Alan"  },
};

let queryCount = 0;

function findUsersByIds(ids) {
  queryCount++;
  console.log("  [DB] SELECT WHERE id IN (" + ids.join(", ") + ")");
  return Promise.resolve(ids.map(id => DB_USERS[id]).filter(Boolean));
}

function createLoader() {
  let pending = new Map();
  let scheduled = false;

  async function flush() {
    const ids = [...pending.keys()];
    const users = await findUsersByIds(ids);
    const byId = new Map(users.map(u => [u.id, u]));
    for (const [id, resolve] of pending) resolve(byId.get(id) ?? null);
    pending.clear();
    scheduled = false;
  }

  return function load(id) {
    return new Promise(resolve => {
      pending.set(id, resolve);
      if (!scheduled) {
        scheduled = true;
        Promise.resolve().then(flush);
      }
    });
  };
}

(async () => {
  queryCount = 0;
  const loadUser = createLoader();

  // Each post loaded "individually" — as if by a GraphQL resolver
  const posts = [
    { id: 1, title: "Streams", authorId: 10 },
    { id: 2, title: "Events",  authorId: 11 },
    { id: 3, title: "Buffers", authorId: 10 },
    { id: 4, title: "Modules", authorId: 12 },
  ];

  const results = await Promise.all(
    posts.map(async p => {
      const author = await loadUser(p.authorId); // queued, not fired yet
      return { title: p.title, author: author.name };
    })
  );

  console.log("Total DB queries:", queryCount); // 1 — all IDs batched in one flush
  results.forEach(r => console.log(" ", r.title, "by", r.author));
})();
```

All four `loadUser(id)` calls schedule on the microtask queue before any of them fires. The single `flush()` collects all IDs and makes exactly one database call.
</details>

## Project

**Re-implement Module 17's data layer with Prisma, then Drizzle, and compare developer experience and generated SQL.**

Module 17 built a data layer around raw `better-sqlite3` or `pg` queries for a small blogging domain (users and posts). Your task is to re-implement that same data layer twice — once with Prisma, once with Drizzle — and draw concrete comparisons.

**Acceptance criteria:**

1. **Prisma implementation:** Define `User` and `Post` models in `schema.prisma`. Implement `createUser`, `listPublishedPosts`, `publishPost`, and `deleteUser` using the Prisma Client. Run `prisma migrate dev` and commit the generated migration file.

2. **Drizzle implementation:** Define the same tables in a `schema.ts` using Drizzle column helpers. Implement the same four functions using Drizzle's SQL builder API. Run `drizzle-kit generate` and commit the plain-SQL migration file.

3. **SQL comparison:** For each of the four operations, run `.toSQL()` (Drizzle) or `$queryRawUnsafe` logging (Prisma) to capture the generated SQL. Record the SQL for all eight variants in a side-by-side comment block in your implementation file.

4. **N+1 audit:** Add a `getPostsWithAuthors()` function to each implementation. First write the naive version (per-post user lookup) and measure query count with a counter wrapper. Then fix it with `include`/join and measure again. Document the before/after counts.

5. **Raw SQL escape hatch:** In both implementations, write a `topAuthorsByPostCount(limit)` function using raw SQL (`$queryRaw` / `sql` tag). Verify the result shape is correct.

6. **DX reflection:** Write a short comment block (10–20 lines) comparing: schema authoring experience, type-inference quality, migration workflow, and the effort to write the join query. Note which you would choose for a new project and why.

**Starter — the batching engine that anchors the N+1 portion:**

```js run
// Proof-of-concept: query counter wrapper + batched loader
// This is the pure-logic core of criteria 4.

function makeCountedStore(data) {
  let queries = 0;
  return {
    findAll()       { queries++; return Promise.resolve([...data]); },
    findByIds(ids)  {
      queries++;
      const set = new Set(ids);
      return Promise.resolve(data.filter(r => set.has(r.id)));
    },
    resetCount()    { queries = 0; },
    getCount()      { return queries; },
  };
}

const userStore = makeCountedStore([
  { id: 1, name: "Ada" }, { id: 2, name: "Grace" }, { id: 3, name: "Alan" },
]);
const postStore = makeCountedStore([
  { id: 10, title: "Streams", authorId: 1 },
  { id: 11, title: "Events",  authorId: 2 },
  { id: 12, title: "Buffers", authorId: 1 },
  { id: 13, title: "Modules", authorId: 3 },
  { id: 14, title: "Cluster", authorId: 2 },
]);

// Strategy A — N+1
async function naivePostsWithAuthors() {
  userStore.resetCount(); postStore.resetCount();
  const posts   = await postStore.findAll();
  const authors = await Promise.all(posts.map(p => userStore.findByIds([p.authorId])));
  console.log("N+1 queries — users:", userStore.getCount(), "posts:", postStore.getCount());
  return posts.map((p, i) => ({ ...p, author: authors[i][0].name }));
}

// Strategy B — batched
async function batchedPostsWithAuthors() {
  userStore.resetCount(); postStore.resetCount();
  const posts      = await postStore.findAll();
  const uniqueIds  = [...new Set(posts.map(p => p.authorId))];
  const users      = await userStore.findByIds(uniqueIds);
  const byId       = new Map(users.map(u => [u.id, u]));
  console.log("Batched queries — users:", userStore.getCount(), "posts:", postStore.getCount());
  return posts.map(p => ({ ...p, author: byId.get(p.authorId).name }));
}

(async () => {
  await naivePostsWithAuthors();
  await batchedPostsWithAuthors();
})();
```

## Common pitfalls

> [!PITFALL] Reaching for raw SQL too early
> Raw SQL bypasses the ORM's type safety and its migration tracking. If you write raw SQL for a query the ORM handles fine, you get no benefit and pay the maintenance cost of a string that your IDE cannot refactor. Reach for raw SQL only when you have a concrete reason: the ORM cannot express the query, or the generated SQL is measurably slow.

Other pitfalls:

- **Forgetting to deduplicate IDs before batching.** If ten posts share the same `authorId`, pass that ID once to the batch query, not ten times. A `Set` is the cheapest deduplication.
- **Not logging ORM queries in development.** Both Prisma (`log: ["query"]`) and Drizzle (query logging middleware) can print every SQL statement. Enable this in development and you will catch N+1 bugs before they reach staging.
- **Assuming `include` solves all join problems.** Prisma's `include` generates efficient SQL for simple relations. For three-level deep includes on large tables, the generated query may be slower than a hand-crafted join with a CTE. Always measure.

## What you learned

- ORMs accelerate CRUD-heavy development but are not performance silver bullets — you still need to think in SQL.
- The **N+1 problem** occurs when loading N rows triggers N additional lookups; fix it with eager-loading (`include`/join) or DataLoader-style batching.
- Both Prisma (`$queryRaw`) and Drizzle (`sql` tag) provide raw SQL escape hatches that retain parameterisation safety.
- Leaky abstractions are inevitable — your job is to know where the abstraction ends and be ready to drop a level.
- Batching with a microtask queue (the DataLoader pattern) collapses any number of same-tick lookups into a single query, regardless of ORM.

## Next steps

The next module explores **NoSQL with MongoDB** — a completely different data model that sidesteps the relational tradeoffs entirely and introduces its own set of performance considerations.
*/});
