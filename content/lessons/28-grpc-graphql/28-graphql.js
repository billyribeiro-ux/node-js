registerLessonSrc("28-graphql", function () {/*
---
id: 28-graphql
title: "GraphQL: Schema, Resolvers & DataLoader"
minutes: 26
level: advanced
objectives:
  - Design a GraphQL schema with types, queries, and mutations
  - Write resolvers and understand the resolver execution model
  - Fix the N+1 query problem with DataLoader batching
---

# GraphQL: Schema, Resolvers & DataLoader

## Why this matters

REST forces clients to accept whatever shape the server decides to return — often too much data (over-fetching) or too little, requiring extra round trips (under-fetching). **GraphQL** flips that contract: the client declares exactly what it needs, and the server assembles precisely that graph of data in a single request. That shift reduces payload size, cuts round trips, and lets front-end and back-end teams evolve independently. Understanding GraphQL's internals — especially the resolver execution model and the infamous **N+1 problem** — separates engineers who use GraphQL from engineers who use it well.

## Learning objectives

- Write a **GraphQL schema** using the Schema Definition Language (SDL).
- Implement **resolvers** and trace how the execution engine walks the query tree.
- Identify the **N+1 query problem** and solve it with **DataLoader** batching.
- Understand **subscriptions** for real-time data and compare GraphQL with REST.

## The schema: your API contract

A GraphQL API is built around a strongly typed **schema** written in the **Schema Definition Language (SDL)**. The schema is the source of truth — both client and server agree on every type and every field before a single byte travels on the wire.

```js
// schema.graphql (SDL — read-only, shown as JS line comments)

// type User {
//   id:    ID!         # "!" = non-nullable
//   name:  String!
//   email: String!
//   posts: [Post!]!    # list of non-nullable Posts, list itself non-nullable
// }
//
// type Post {
//   id:      ID!
//   title:   String!
//   author:  User!
// }
//
// type Query {
//   user(id: ID!): User       # returns null if not found
//   users: [User!]!           # always returns a list (may be empty)
// }
//
// type Mutation {
//   createUser(name: String!, email: String!): User!
// }
//
// type Subscription {
//   postCreated: Post!        # pushes new posts to subscribed clients
// }
```

Key SDL concepts:

- **Scalar types**: `ID`, `String`, `Int`, `Float`, `Boolean` — plus custom scalars like `DateTime`.
- **`!` (bang)**: marks a field non-nullable. Without it, the field may return `null`.
- **Object types** can reference other object types, forming the *graph* in GraphQL.
- **`Query`** is read-only; **`Mutation`** signals a write; **`Subscription`** opens a live channel.

## Resolvers: the execution engine

Every field in a GraphQL response is produced by a **resolver** — a plain function that receives `(parent, args, context, info)` and returns the field's value.

```
(parent, args, context, info) => value | Promise<value>
```

- `parent` — the resolved value of the parent object (or `undefined` for root fields).
- `args` — arguments from the query, e.g. `{ id: "42" }`.
- `context` — a shared per-request object: database handle, auth user, DataLoader instances.
- `info` — query metadata (rarely needed except for advanced optimisations).

```js
// resolvers.js — a minimal Apollo/graphql-js resolver map
const resolvers = {
  Query: {
    user: async (_parent, { id }, { db }) => db.users.findById(id),
    users: async (_parent, _args, { db }) => db.users.findAll(),
  },

  Mutation: {
    createUser: async (_parent, { name, email }, { db }) =>
      db.users.create({ name, email }),
  },

  User: {
    // "posts" is NOT in the users table — we resolve it separately
    posts: async (user, _args, { db }) => db.posts.findByAuthorId(user.id),
  },

  Post: {
    author: async (post, _args, { db }) => db.users.findById(post.authorId),
  },
};
```

The execution engine walks the query tree depth-first, calling each resolver in turn and assembling the result object. For a query like:

```js
// { users { id name posts { title } } }
//
// Execution order:
//   1. Query.users  → returns [u1, u2, u3]
//   2. For u1: User.id, User.name, User.posts → db.posts.findByAuthorId(u1.id)
//   3. For u2: User.id, User.name, User.posts → db.posts.findByAuthorId(u2.id)
//   4. For u3: User.id, User.name, User.posts → db.posts.findByAuthorId(u3.id)
```

> [!OUTPUT]
> { users: [ { id: '1', name: 'Ada', posts: [...] }, ... ] }

## The N+1 problem

Notice the execution above: fetching 3 users fires **3 separate** `findByAuthorId` queries. Fetch 100 users and you fire **100 queries** — one per user. That is the **N+1 problem** (1 query for the list + N queries for the related data), and it quietly destroys database performance at scale.

```js
// Without DataLoader — naive resolver fires one query per user
User: {
  posts: (user, _args, { db }) => db.posts.findByAuthorId(user.id),
  // If Query.users returns 100 users → 100 SQL SELECT statements
}
```

> [!PITFALL] The N+1 problem is silent in development
> With a small dataset and a fast local DB, N+1 queries feel instant. Load testing with realistic data reveals 500 ms queries where 5 ms was expected. Always check your query logs or use a tool like `explain` or DataDog APM when building resolvers.

## DataLoader: batching and caching

Facebook open-sourced **DataLoader** specifically to solve N+1 in GraphQL. The idea is elegant:

1. Within a single JavaScript **tick**, collect all keys that resolvers request.
2. At the end of the tick, fire a **single** batched query for all collected keys.
3. Return each result to the resolver that asked for it.
4. Cache results within the request so the same key is never fetched twice.

```js
// dataloader-setup.js
import DataLoader from "dataloader";

// batchFn receives an array of keys, must return an array of values in the SAME order
function createPostsByAuthorLoader(db) {
  return new DataLoader(async (authorIds) => {
    // One query for ALL authorIds at once
    const posts = await db.posts.findByAuthorIds(authorIds);

    // Group by authorId and preserve order
    const byAuthor = new Map(authorIds.map(id => [id, []]));
    for (const post of posts) {
      byAuthor.get(post.authorId)?.push(post);
    }
    return authorIds.map(id => byAuthor.get(id) ?? []);
  });
}

// In your context factory (per-request, not per-server):
function buildContext(db) {
  return {
    db,
    loaders: {
      postsByAuthor: createPostsByAuthorLoader(db),
    },
  };
}
```

```js
// Updated resolver — now uses DataLoader
User: {
  posts: (user, _args, { loaders }) =>
    loaders.postsByAuthor.load(user.id),  // load(), not loadMany()
}
// 100 users → still just 1 SQL query. DataLoader batches all .load() calls.
```

> [!OUTPUT]
> SELECT * FROM posts WHERE author_id IN (1,2,3,...,100)  -- one query

> [!PRINCIPAL] DataLoader must be created per-request, not per-server
> A DataLoader caches by key for the lifetime of the object. If you reuse a single DataLoader across requests, user A's data leaks into user B's response. Always instantiate loaders inside your context factory function so each HTTP request gets a fresh loader. This is the most common DataLoader bug in production GraphQL services.

## Subscriptions

GraphQL **subscriptions** let clients receive pushed updates over a long-lived connection (typically WebSocket or Server-Sent Events). The schema declares a `Subscription` type; the server publishes events through a **PubSub** mechanism.

```js
// subscription-server.js (read-only — requires graphql-ws and a PubSub adapter)
import { PubSub } from "graphql-subscriptions";

const pubsub = new PubSub();

const resolvers = {
  Subscription: {
    postCreated: {
      // subscribe returns an async iterator that yields events
      subscribe: () => pubsub.asyncIterator(["POST_CREATED"]),
    },
  },
  Mutation: {
    createPost: async (_parent, { title, authorId }, { db }) => {
      const post = await db.posts.create({ title, authorId });
      // Publish to all subscribed clients
      await pubsub.publish("POST_CREATED", { postCreated: post });
      return post;
    },
  },
};
```

> [!OUTPUT]
> // Client receives over WebSocket:
> { "data": { "postCreated": { "id": "99", "title": "Hello World" } } }

> [!NOTE] Production subscriptions need a scalable PubSub backend
> The in-memory `PubSub` from `graphql-subscriptions` works on a single server instance. In production with multiple replicas use Redis pub/sub (via `graphql-redis-subscriptions`) or a message broker so events published on one instance reach clients connected to others.

## Over/under-fetching vs REST

| Concern | REST | GraphQL |
|---|---|---|
| Over-fetching | Common — endpoint returns fixed shape | Eliminated — client specifies fields |
| Under-fetching | Multiple round trips for related data | Single query traverses the graph |
| Caching | HTTP-level (CDN, ETags, Cache-Control) | Harder — POST body varies; persisted queries help |
| Schema contract | Informal (OpenAPI optional) | Enforced — schema is mandatory |
| Versioning | URL (`/v2/`) or headers | Field deprecation, additive changes |
| Tooling | Mature (Swagger, curl, browsers) | GraphiQL, Apollo Studio, code-gen |
| Learning curve | Low | Moderate (schema, resolvers, DataLoader) |

## Try it yourself

A DataLoader collects keys within a tick, then fires one batch function. Let's build the batching core from scratch — no library, pure JS — using `queueMicrotask` (the same mechanism DataLoader uses under the hood).

```js run
// DataLoader-style batch loader — pure JS, runs in the browser sandbox.
// Real DataLoader uses process.nextTick; we use queueMicrotask (same idea).

function createBatchLoader(batchFn) {
  let pendingKeys = [];
  let pendingResolvers = [];
  let scheduled = false;

  function dispatch() {
    const keys = pendingKeys;
    const resolvers = pendingResolvers;
    pendingKeys = [];
    pendingResolvers = [];
    scheduled = false;

    batchFn(keys).then(values => {
      for (let i = 0; i < resolvers.length; i++) {
        resolvers[i](values[i]);
      }
    });
  }

  return {
    load(key) {
      return new Promise(resolve => {
        pendingKeys.push(key);
        pendingResolvers.push(resolve);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(dispatch); // fire once after current tick
        }
      });
    },
  };
}

// Simulate a DB call that fetches users by IDs in one shot
let batchCallCount = 0;

const userLoader = createBatchLoader(async (ids) => {
  batchCallCount++;
  console.log(`Batch call #${batchCallCount} for ids: [${ids.join(", ")}]`);
  // Simulate DB: return objects in same order as ids
  return ids.map(id => ({ id, name: `User ${id}` }));
});

// Five concurrent "resolvers" each calling load() — all batched into ONE call
async function main() {
  const results = await Promise.all([
    userLoader.load(1),
    userLoader.load(2),
    userLoader.load(3),
    userLoader.load(1), // duplicate — could be cached; here re-fetched
    userLoader.load(4),
  ]);

  results.forEach(u => console.log(u.name));
  console.log("Total batch calls:", batchCallCount); // 1, not 5
}

main();
```

## Exercises

### Exercise 1: add caching to the batch loader

Extend the loader above to cache results by key within its lifetime, so `load(1)` called twice fires only one batch entry.

<details>
<summary>Show solution</summary>

```js run
function createCachingBatchLoader(batchFn) {
  let pendingKeys = [];
  let pendingResolvers = [];
  let scheduled = false;
  const cache = new Map(); // key → Promise

  function dispatch() {
    const keys = pendingKeys;
    const resolvers = pendingResolvers;
    pendingKeys = [];
    pendingResolvers = [];
    scheduled = false;

    batchFn(keys).then(values => {
      for (let i = 0; i < resolvers.length; i++) {
        resolvers[i](values[i]);
      }
    });
  }

  return {
    load(key) {
      if (cache.has(key)) {
        console.log(`Cache HIT for key ${key}`);
        return cache.get(key);
      }
      const promise = new Promise(resolve => {
        pendingKeys.push(key);
        pendingResolvers.push(resolve);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(dispatch);
        }
      });
      cache.set(key, promise);
      return promise;
    },
  };
}

let calls = 0;
const loader = createCachingBatchLoader(async (ids) => {
  calls++;
  console.log(`DB query for: [${ids.join(", ")}]`);
  return ids.map(id => ({ id, name: `User ${id}` }));
});

async function main() {
  const [a, b, c] = await Promise.all([
    loader.load(1),
    loader.load(2),
    loader.load(1), // cache hit
  ]);
  const d = await loader.load(2); // cache hit — no new batch
  console.log(a.name, b.name, c.name, d.name);
  console.log("Batch calls:", calls); // 1
}

main();
```

</details>

### Exercise 2: write a schema-validates-itself checker

Write a pure-JS function that takes a simple schema description (an object of type → field lists) and a query (an array of field paths like `["user.name", "user.posts.title"]`) and reports which paths are invalid.

<details>
<summary>Show solution</summary>

```js run
const schema = {
  Query: { user: "User", users: "User" },
  User:  { id: "ID", name: "String", email: "String", posts: "Post" },
  Post:  { id: "ID", title: "String", author: "User" },
};

function validatePaths(schema, rootType, paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let currentType = rootType;
    let valid = true;

    for (const field of parts) {
      const typeDef = schema[currentType];
      if (!typeDef || !(field in typeDef)) {
        console.log(`INVALID: "${path}" — field "${field}" not on type ${currentType}`);
        valid = false;
        break;
      }
      currentType = typeDef[field];
    }

    if (valid) {
      console.log(`VALID:   "${path}" → resolves to type ${currentType}`);
    }
  }
}

validatePaths(schema, "Query", [
  "user.name",
  "user.posts.title",
  "user.posts.author.email",
  "user.age",         // invalid — no "age" on User
  "users.posts.body", // invalid — no "body" on Post
]);
```

</details>

## Common pitfalls

> [!PITFALL] Creating DataLoader instances outside the request context
> DataLoader caches values by key. A server-level singleton DataLoader will serve stale or wrong data across requests and creates a privacy vulnerability. Always create loaders inside your context builder so they are scoped to a single request lifecycle.

> [!PITFALL] Returning results from batchFn in the wrong order
> DataLoader contracts: `batchFn` receives an array of keys and must return an array of values **in the exact same order**. If your DB query returns rows in a different order (it will), you must re-sort them before returning. Violating this silently swaps data between resolvers.

## What you learned

- A GraphQL **schema** (SDL) defines types, queries, mutations, and subscriptions — it is the authoritative API contract.
- **Resolvers** are functions called per-field; the execution engine walks the query tree, calling each one in turn.
- The **N+1 problem** occurs when per-object resolvers each issue a separate DB query; with 100 parents you get 101 queries.
- **DataLoader** batches all `.load()` calls made within a tick into a single batch function call, reducing N+1 to 1+1.
- **Subscriptions** push real-time events over WebSocket using an async iterator and a pub/sub backend.
- GraphQL eliminates over/under-fetching but trades away simple HTTP caching; persisted queries and CDN-aware clients restore cacheability.

## Next steps

Now that you understand both gRPC and GraphQL deeply, the final lesson in this module zooms out to give you a rigorous decision framework: when to reach for REST, when gRPC is the right tool, and when GraphQL earns its complexity tax.
*/});
