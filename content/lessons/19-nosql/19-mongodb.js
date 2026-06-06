registerLessonSrc("19-mongodb", function () {/*
---
id: 19-mongodb
title: "MongoDB: Documents & Aggregation"
minutes: 24
level: intermediate
objectives:
  - Understand MongoDB's document model and how it differs from relational tables
  - Perform CRUD operations using the official Node.js driver
  - Build aggregation pipelines with $match, $group, and $sort to answer analytical questions
---

# MongoDB: Documents & Aggregation

## Why this matters

Relational databases force every row into a rigid schema with foreign keys tying tables together. That works beautifully for transactional data, but when your domain shapes shift rapidly — or when a single entity naturally owns a tree of nested data — document databases like **MongoDB** let you store the data the way your application already thinks about it. Understanding *when* and *how* to use MongoDB, plus its powerful aggregation pipeline, is a skill you will call on across product development, analytics, and large-scale APIs.

## Learning objectives

- Explain MongoDB's core concepts: documents, collections, and schemas.
- Use the official `mongodb` Node.js driver to connect, query, and mutate data.
- Construct multi-stage aggregation pipelines (`$match`, `$group`, `$sort`) to compute summaries.
- Choose intelligently between a document model and a relational model.

## Documents and collections

MongoDB stores data as **BSON documents** — essentially rich JSON objects, keyed by `_id`. Related documents are grouped into **collections** (analogous to SQL tables, but schema-free by default).

```
Collection: orders
┌──────────────────────────────────────────────────────────────┐
│ { _id: ObjectId("…"), userId: "u1", product: "Widget",       │
│   qty: 3, tags: ["sale","new"], address: { city: "Austin" } }│
│ { _id: ObjectId("…"), userId: "u2", product: "Gadget",       │
│   qty: 1, tags: ["new"],        address: { city: "Denver" } }│
└──────────────────────────────────────────────────────────────┘
```

Key ideas:
- A document can **embed** related data (the `address` object, the `tags` array) instead of joining across tables. Reads are faster because the data is co-located.
- Documents in the same collection can have **different shapes** — great while a schema evolves, but discipline (JSON Schema validation or Mongoose models) matters at scale.
- `_id` is automatically indexed; add additional indexes with `collection.createIndex()`.

## Connecting and running CRUD

Install the official driver once in a real project:

```bash
npm install mongodb
```

Then connect:

```js
import { MongoClient, ObjectId } from "mongodb";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

const db = client.db("shop");
const orders = db.collection("orders");
```

**Create**

```js
// insertOne — returns insertedId
const { insertedId } = await orders.insertOne({
  userId: "u1",
  product: "Widget",
  qty: 3,
  price: 9.99,
  tags: ["sale", "new"],
  createdAt: new Date(),
});
console.log("Inserted:", insertedId);

// insertMany — bulk insert
await orders.insertMany([
  { userId: "u2", product: "Gadget", qty: 1, price: 49.99, tags: ["new"], createdAt: new Date() },
  { userId: "u1", product: "Doohickey", qty: 2, price: 4.50, tags: ["sale"], createdAt: new Date() },
]);
```

> [!OUTPUT]
> Inserted: 6641f3b4e23a0f1234567890

**Read**

```js
// find one
const order = await orders.findOne({ userId: "u1" });
console.log(order.product); // Widget

// find many — returns an async cursor
const saleDocs = await orders.find({ tags: "sale" }).toArray();
console.log(saleDocs.length); // 2

// projection — only return specified fields
const slim = await orders
  .find({}, { projection: { product: 1, qty: 1, _id: 0 } })
  .toArray();
```

> [!OUTPUT]
> Widget
> 2

**Update and Delete**

```js
// updateOne — $set merges fields, $inc increments
await orders.updateOne(
  { userId: "u1", product: "Widget" },
  { $set: { qty: 5 }, $inc: { price: 1 } }
);

// replaceOne swaps the whole document (keeps _id)
// deleteOne / deleteMany — matching filter
await orders.deleteMany({ tags: "sale" });
```

> [!NOTE] Use operators, not replacement
> Always prefer `$set`, `$push`, `$pull`, `$inc` inside `updateOne`/`updateMany`. Sending the document directly as the second argument *replaces* the whole document — a common data-loss bug.

## The aggregation pipeline

MongoDB's aggregation pipeline is its superpower for analytics. You pass an array of **stages** — each stage transforms the stream of documents — and MongoDB executes them in order, server-side, efficiently.

The three most important stages:

| Stage | What it does |
|-------|-------------|
| `$match` | Filters documents (like SQL `WHERE`). Put it first to use indexes. |
| `$group` | Groups by a key and accumulates values (`$sum`, `$avg`, `$push`, …). |
| `$sort` | Sorts the output (`1` = ascending, `-1` = descending). |

Other useful stages: `$project` (reshape), `$lookup` (join), `$unwind` (flatten arrays), `$limit`, `$skip`.

```js
// "Total revenue and order count per user, sorted by revenue desc"
const stats = await orders.aggregate([
  { $match: { tags: "sale" } },                              // stage 1 — filter
  { $group: {                                                // stage 2 — aggregate
      _id: "$userId",                                        //   group key
      totalRevenue: { $sum: { $multiply: ["$price","$qty"] } },
      orderCount:   { $sum: 1 },
  }},
  { $sort: { totalRevenue: -1 } },                          // stage 3 — rank
]).toArray();

console.log(stats);
// [ { _id: "u1", totalRevenue: 9.00, orderCount: 1 }, … ]
```

> [!OUTPUT]
> [ { _id: 'u1', totalRevenue: 9, orderCount: 1 } ]

> [!PRINCIPAL] Pipeline order matters for performance
> Put `$match` as the first stage whenever possible — MongoDB can push it down to an index scan instead of a full collection scan. A `$match` placed *after* `$group` cannot use collection indexes and scans the intermediate result set. This single ordering decision can mean the difference between milliseconds and minutes on a large collection.

## When documents beat tables

Choose a document model when:
- The entity **owns** nested data that isn't queried independently (order → line items, user → address book).
- Schema evolves rapidly across releases.
- You need horizontal sharding (MongoDB shards natively by shard key).

Stick with relational when:
- Data is deeply normalised with many-to-many relationships you query in varied ways.
- You need multi-row ACID transactions across different entity types.
- You rely on mature SQL analytics tooling (BI, reporting).

MongoDB supports multi-document transactions since v4, but they carry overhead — design your document model so that most operations touch a single document and you rarely need them.

## Schema design patterns

**Embedding** — put related data inside the document. Best when you always read them together.

```js
// Embedded: user document owns their addresses
{ _id: "u1", name: "Ada", addresses: [
  { type: "home", city: "Austin" },
  { type: "work", city: "Denver" },
]}
```

**Referencing** — store `_id` of the related document and `$lookup` when needed. Best when the related data is large, shared, or queried independently.

```js
// Referenced: order holds a userId, joined later
{ _id: ObjectId("…"), userId: "u1", product: "Widget" }
```

## Try it yourself

Run an aggregation pipeline in pure JavaScript. The following simulates exactly what MongoDB does server-side: filter, group, sort.

```js run
// Simulated MongoDB aggregation pipeline over an in-memory array

const orders = [
  { userId: "u1", product: "Widget",    qty: 3, price: 9.99,  tags: ["sale","new"] },
  { userId: "u2", product: "Gadget",    qty: 1, price: 49.99, tags: ["new"]        },
  { userId: "u1", product: "Doohickey", qty: 2, price: 4.50,  tags: ["sale"]       },
  { userId: "u3", product: "Thingamajig",qty:5, price: 2.00,  tags: ["sale"]       },
  { userId: "u2", product: "Gizmo",     qty: 1, price: 19.99, tags: ["sale","new"] },
];

// Stage helpers — each takes a docs array, returns a new array
function $match(docs, filter) {
  return docs.filter(d =>
    Object.entries(filter).every(([k, v]) =>
      Array.isArray(d[k]) ? d[k].includes(v) : d[k] === v
    )
  );
}

function $group(docs, keyField, accumulators) {
  const map = new Map();
  for (const doc of docs) {
    const key = doc[keyField.slice(1)]; // strip leading "$"
    if (!map.has(key)) map.set(key, { _id: key });
    const acc = map.get(key);
    for (const [outField, spec] of Object.entries(accumulators)) {
      if (spec.$sum !== undefined) {
        const val = typeof spec.$sum === "number"
          ? spec.$sum
          : doc[spec.$sum.slice(1)]; // e.g. "$qty"
        acc[outField] = (acc[outField] || 0) + val;
      }
      if (spec.$avg !== undefined) {
        const val = doc[spec.$avg.slice(1)];
        acc[outField + "__sum"] = (acc[outField + "__sum"] || 0) + val;
        acc[outField + "__n"]   = (acc[outField + "__n"]   || 0) + 1;
        acc[outField] = acc[outField + "__sum"] / acc[outField + "__n"];
      }
    }
  }
  return Array.from(map.values());
}

function $sort(docs, spec) {
  const [field, dir] = Object.entries(spec)[0];
  return [...docs].sort((a, b) => dir * (a[field] > b[field] ? 1 : -1));
}

// Pipeline: sale orders only → revenue per user → rank by revenue
const stage1 = $match(orders, { tags: "sale" });
const stage2 = $group(stage1, "$userId", {
  totalRevenue: { $sum: "$price" },
  orderCount:   { $sum: 1 },
});
const stage3 = $sort(stage2, { totalRevenue: -1 });

console.log("Sale revenue by user (descending):");
for (const row of stage3) {
  console.log(`  ${row._id}: $${row.totalRevenue.toFixed(2)} (${row.orderCount} orders)`);
}
```

## Exercises

**Exercise 1:** Extend the pipeline above to also compute average price per user and only include users with `totalRevenue > 10`.

<details>
<summary>Show solution</summary>

```js run
const orders = [
  { userId: "u1", product: "Widget",    qty: 3, price: 9.99,  tags: ["sale"] },
  { userId: "u2", product: "Gadget",    qty: 1, price: 49.99, tags: ["new"] },
  { userId: "u1", product: "Doohickey", qty: 2, price: 4.50,  tags: ["sale"] },
  { userId: "u3", product: "Thingamajig",qty:5, price: 2.00,  tags: ["sale"] },
  { userId: "u2", product: "Gizmo",     qty: 1, price: 19.99, tags: ["sale"] },
];

// Simplified group with avg support
function group(docs, keyField, specs) {
  const map = new Map();
  for (const doc of docs) {
    const key = doc[keyField.replace("$","")];
    if (!map.has(key)) map.set(key, { _id: key, _counts: {} });
    const acc = map.get(key);
    for (const [out, spec] of Object.entries(specs)) {
      if ("$sum" in spec) {
        const v = typeof spec.$sum === "number" ? spec.$sum : doc[spec.$sum.replace("$","")];
        acc[out] = (acc[out] || 0) + v;
      }
      if ("$avg" in spec) {
        const v = doc[spec.$avg.replace("$","")];
        acc._counts[out] = (acc._counts[out] || 0) + 1;
        acc[out] = ((acc[out] || 0) * (acc._counts[out]-1) + v) / acc._counts[out];
      }
    }
  }
  // clean up internal tracking keys
  return Array.from(map.values()).map(({ _counts, ...rest }) => rest);
}

const grouped = group(orders, "$userId", {
  totalRevenue: { $sum: "$price" },
  avgPrice:     { $avg: "$price" },
  orderCount:   { $sum: 1 },
});

// $match AFTER $group (filters on computed fields)
const filtered = grouped.filter(r => r.totalRevenue > 10);
const sorted   = filtered.sort((a,b) => b.totalRevenue - a.totalRevenue);

for (const r of sorted) {
  console.log(`${r._id}: revenue=$${r.totalRevenue.toFixed(2)}, avg=$${r.avgPrice.toFixed(2)}, n=${r.orderCount}`);
}
```

</details>

**Exercise 2:** Write a `$lookup`-style join in plain JS: given an `orders` array and a `users` array (with `id` and `name`), attach each user's name to their orders.

<details>
<summary>Show solution</summary>

```js run
const users  = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Bob" }, { id: "u3", name: "Carol" }];
const orders = [
  { orderId: 1, userId: "u1", product: "Widget" },
  { orderId: 2, userId: "u2", product: "Gadget" },
  { orderId: 3, userId: "u1", product: "Doohickey" },
];

// Build a lookup map — O(n) prep, O(1) per join
const userMap = new Map(users.map(u => [u.id, u]));

// $lookup: embed the matched user into each order
const enriched = orders.map(order => ({
  ...order,
  user: userMap.get(order.userId) ?? null,
}));

for (const o of enriched) {
  console.log(`Order ${o.orderId}: ${o.product} — buyer: ${o.user?.name}`);
}
```

</details>

## Common pitfalls

> [!PITFALL] Designing for queries you don't have yet
> New MongoDB users often over-normalize (too many references + $lookup) or over-embed (giant documents with arrays that grow unboundedly). Design your document shape around the **read patterns your application actually uses**, not around an abstract ideal. If a field is never queried in isolation, embed it. If an array can grow past a few hundred items, reference it. Revisit schema when query patterns change.

## What you learned

- MongoDB stores data as BSON documents in schema-flexible collections.
- The Node.js driver gives you `insertOne/Many`, `findOne/find`, `updateOne/Many`, and `deleteOne/Many` with a clean async API.
- The aggregation pipeline is a sequence of stages processed server-side: `$match` filters, `$group` accumulates, `$sort` ranks.
- Put `$match` first to leverage indexes; `$group` is the stage that computes summaries.
- Choose embedding for owned, co-read data; choose references for large, shared, or independently queried data.

## Next steps

A database without a caching layer often becomes the bottleneck under load. Next we will add **Redis** as an in-memory cache in front of MongoDB — covering the cache-aside pattern, TTLs, and eviction policies.
*/});
