registerLessonSrc("17-sql-basics", function () {/*
---
id: 17-sql-basics
title: SQL & Relational Modeling
minutes: 24
level: intermediate
objectives:
  - Model data as tables with primary and foreign keys
  - Write SELECT, INSERT, UPDATE, and DELETE statements with JOINs
  - Apply normalization principles and understand when indexes help
---

# SQL & Relational Modeling

## Why this matters

Every serious application eventually stores data that outlives a single process. **SQL** — Structured Query Language — has been the dominant language for that job for 50 years, and it is not going anywhere. Understanding relational modeling shapes *how* you think about data: naming things precisely, eliminating duplication, and expressing relationships in a way databases can enforce and optimise. Whether you use Postgres, SQLite, MySQL, or an ORM, you are always writing SQL underneath.

## Learning objectives

- Model real-world data as **tables**, **rows**, and **columns** linked by **primary** and **foreign keys**.
- Read and write fluent `SELECT`, `INSERT`, `UPDATE`, and `DELETE` SQL, including `JOIN`s.
- Know the basics of **normalization** and **indexes** and when to use them.

## Tables, rows, and columns

A **relational database** organises data into **tables** — think of a spreadsheet tab. Each table has:

- **Columns** — named, typed fields (like `name TEXT`, `age INTEGER`).
- **Rows** — individual records, one per entity.
- A **primary key** (`PK`) — one or more columns that uniquely identify each row. Often an auto-incrementing integer or a UUID.

```sql
-- Create a users table
CREATE TABLE users (
  id       SERIAL PRIMARY KEY,   -- auto-increment integer PK
  email    TEXT   NOT NULL UNIQUE,
  name     TEXT   NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

> [!NOTE] SERIAL vs GENERATED ALWAYS AS IDENTITY
> `SERIAL` is Postgres shorthand for an integer with a sequence. Modern SQL prefers `id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` — same idea, ISO standard.

## Primary and foreign keys

A **foreign key** (FK) points from one table's column to another table's primary key, expressing a *relationship*. The database *enforces* that the referenced row exists.

```sql
-- A table of orders, each belonging to one user
CREATE TABLE orders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_cents INTEGER NOT NULL,
  placed_at  TIMESTAMPTZ DEFAULT NOW()
);
```

`ON DELETE CASCADE` means: when a user is deleted, delete their orders automatically. Alternatives are `RESTRICT` (block the delete), `SET NULL`, or `NO ACTION` (the default: raise an error at commit time).

> [!PRINCIPAL] Let the database enforce relationships
> Application code can have bugs, get bypassed by migrations, or have race conditions. A foreign key constraint is a guarantee at the storage layer — it can't be skipped. Prefer declaring constraints over "we'll handle it in app code."

## The four core statements: CRUD

**INSERT** — add a row:

```sql
INSERT INTO users (email, name) VALUES ('ada@example.com', 'Ada Lovelace');
INSERT INTO users (email, name) VALUES ('grace@example.com', 'Grace Hopper');

INSERT INTO orders (user_id, total_cents) VALUES (1, 4999);
INSERT INTO orders (user_id, total_cents) VALUES (1, 1200);
INSERT INTO orders (user_id, total_cents) VALUES (2, 800);
```

**SELECT** — read rows:

```sql
-- All columns
SELECT * FROM users;

-- Specific columns, with a filter
SELECT id, name FROM users WHERE email LIKE '%@example.com';

-- Aggregate: how much has each user spent?
SELECT user_id, SUM(total_cents) AS total
FROM orders
GROUP BY user_id
HAVING SUM(total_cents) > 1000
ORDER BY total DESC;
```

**UPDATE** — change existing rows:

```sql
-- Always use WHERE, or you update every row!
UPDATE users SET name = 'Admiral Grace Hopper' WHERE email = 'grace@example.com';
```

**DELETE** — remove rows:

```sql
DELETE FROM orders WHERE id = 3;
-- Or remove all old orders:
DELETE FROM orders WHERE placed_at < NOW() - INTERVAL '1 year';
```

> [!PITFALL] UPDATE and DELETE without WHERE
> Forgetting the `WHERE` clause in an `UPDATE` or `DELETE` modifies *every* row in the table. Most production databases use role-based permissions and ORM-generated queries to reduce this risk, but always double-check before running a raw SQL statement.

## JOINs

A `JOIN` combines rows from two tables wherever a condition matches — almost always a foreign-key relationship.

```sql
-- INNER JOIN: only rows with a match on both sides
SELECT u.name, o.total_cents, o.placed_at
FROM users u
INNER JOIN orders o ON o.user_id = u.id
ORDER BY o.placed_at DESC;
```

```sql
-- LEFT JOIN: all users, even those with no orders (NULL for missing order columns)
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY order_count DESC;
```

The four join types you need to know:

| Join | What you get |
|---|---|
| `INNER JOIN` | Rows with a match on both sides |
| `LEFT JOIN` | All left-table rows + matching right rows (NULL where none) |
| `RIGHT JOIN` | All right-table rows + matching left rows |
| `FULL OUTER JOIN` | All rows from both sides (NULL where unmatched) |

> [!NOTE] 90% of JOINs in application code are INNER or LEFT
> `RIGHT JOIN` can always be rewritten as a `LEFT JOIN` with tables swapped. `FULL OUTER JOIN` is rare and usually signals a reporting query.

## Normalization: eliminate duplication

**Normalization** is the practice of structuring tables so that each fact is stored in exactly one place. The most important rules (called *normal forms*):

**1NF** — each column holds one atomic value. No lists, no comma-separated IDs stuffed in a text field.

**2NF** — every non-key column depends on the *whole* primary key (matters for composite PKs).

**3NF** — no column depends on another non-key column. Classic example: storing both `city` and `zip_code` when the city can be derived from the zip.

In practice: if you find yourself copying the same value into many rows (e.g. writing `"Electronics"` in every product row), extract it to its own table (`categories`) and store a foreign key.

```sql
-- Denormalised (bad): category name repeated everywhere
-- products: id, name, category_name

-- Normalised: category in its own table
CREATE TABLE categories (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE products   (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id)
);
```

> [!PRINCIPAL] Normalise first, denormalise deliberately
> Start with 3NF. Denormalise — intentionally duplicating data for read performance — only when you have measured a problem. Premature denormalisation creates inconsistency bugs that are hard to find and expensive to fix.

## Indexes: speed up reads

A full-table **sequential scan** reads every row to answer a query. An **index** is a separate data structure (usually a **B-tree**) that lets the database jump directly to matching rows.

```sql
-- Without this index, "WHERE email = ?" scans the whole table
CREATE INDEX idx_users_email ON users(email);

-- Composite index for a common filter pattern
CREATE INDEX idx_orders_user_placed ON orders(user_id, placed_at DESC);
```

> [!WARNING] Indexes cost write performance and storage
> Every `INSERT`, `UPDATE`, or `DELETE` must also update every index on the table. Add indexes on columns you *filter or join on*, not on every column. Use `EXPLAIN ANALYZE` in Postgres to see whether a query is using an index.

## Try it yourself

This pure-JS simulation shows *relational thinking*: filter, join, and project arrays the same way SQL works under the hood.

```js run
// In-memory "database" — same shape as real SQL tables
const users = [
  { id: 1, name: "Ada Lovelace",     email: "ada@example.com" },
  { id: 2, name: "Grace Hopper",     email: "grace@example.com" },
  { id: 3, name: "Alan Turing",      email: "alan@example.com" },
];

const orders = [
  { id: 1, user_id: 1, total_cents: 4999, status: "shipped" },
  { id: 2, user_id: 1, total_cents: 1200, status: "pending" },
  { id: 3, user_id: 2, total_cents:  800, status: "shipped" },
  { id: 4, user_id: 1, total_cents: 2500, status: "shipped" },
];

// --- SELECT with WHERE ---
function select(table, predicate, columns) {
  return table
    .filter(predicate)
    .map(row => {
      if (!columns) return { ...row };
      const out = {};
      columns.forEach(c => { out[c] = row[c]; });
      return out;
    });
}

// --- INNER JOIN ---
function innerJoin(left, right, on) {
  const result = [];
  for (const l of left) {
    for (const r of right) {
      if (on(l, r)) result.push({ ...l, ...r });
    }
  }
  return result;
}

// --- GROUP BY + SUM (aggregate) ---
function groupSum(rows, groupKey, sumKey, aliasKey) {
  const map = new Map();
  for (const row of rows) {
    const k = row[groupKey];
    map.set(k, (map.get(k) || 0) + row[sumKey]);
  }
  return [...map.entries()].map(([k, v]) => ({ [groupKey]: k, [aliasKey]: v }));
}

// Query 1: all shipped orders
console.log("=== Shipped orders ===");
const shipped = select(orders, r => r.status === "shipped", ["id", "user_id", "total_cents"]);
console.log(shipped);

// Query 2: JOIN users → orders (like LEFT JOIN including users with no orders)
console.log("\n=== User name + order totals (INNER JOIN) ===");
const joined = innerJoin(users, orders, (u, o) => u.id === o.user_id);
const display = joined.map(r => ({ name: r.name, total_cents: r.total_cents, status: r.status }));
console.log(display);

// Query 3: SUM per user
console.log("\n=== Total spend per user ===");
const totals = groupSum(orders, "user_id", "total_cents", "total_spend");
totals.sort((a, b) => b.total_spend - a.total_spend);
totals.forEach(t => {
  const user = users.find(u => u.id === t.user_id);
  console.log(`${user.name}: $${(t.total_spend / 100).toFixed(2)}`);
});
```

## Exercises

### Exercise 1: Add a products table

Extend the in-memory model above to include a `products` table and `order_items` table (each order can contain multiple products). Write a join that shows order ID, product name, and quantity.

<details>
<summary>Show solution</summary>

```js run
const products = [
  { id: 1, name: "Keyboard", price_cents: 7999 },
  { id: 2, name: "Mouse",    price_cents: 2999 },
  { id: 3, name: "Monitor",  price_cents: 34999 },
];

const order_items = [
  { id: 1, order_id: 1, product_id: 1, qty: 1 },
  { id: 2, order_id: 1, product_id: 2, qty: 2 },
  { id: 3, order_id: 3, product_id: 3, qty: 1 },
];

// Join order_items → products
for (const item of order_items) {
  const product = products.find(p => p.id === item.product_id);
  console.log(`Order ${item.order_id} | ${product.name} x${item.qty} | $${(product.price_cents * item.qty / 100).toFixed(2)}`);
}
```
</details>

### Exercise 2: Simulate an index

Implement a simple index (a `Map` keyed by a column value) and show how it makes lookups O(1) vs O(n) for a sequential scan.

<details>
<summary>Show solution</summary>

```js run
// Build a large "table"
const rows = Array.from({ length: 10_000 }, (_, i) => ({
  id: i + 1,
  email: `user${i + 1}@example.com`,
}));

// Sequential scan — O(n)
function seqScan(table, email) {
  return table.find(r => r.email === email) || null;
}

// Build an index once — O(n) upfront, then O(1) lookups
function buildIndex(table, column) {
  const idx = new Map();
  for (const row of table) idx.set(row[column], row);
  return idx;
}

const emailIndex = buildIndex(rows, "email");

const target = "user8888@example.com";

// Measure both
const t0 = performance.now();
for (let i = 0; i < 1000; i++) seqScan(rows, target);
const seqMs = (performance.now() - t0).toFixed(2);

const t1 = performance.now();
for (let i = 0; i < 1000; i++) emailIndex.get(target);
const idxMs = (performance.now() - t1).toFixed(2);

console.log(`Sequential scan x1000: ${seqMs}ms`);
console.log(`Index lookup    x1000: ${idxMs}ms`);
console.log(`Found (seq): ${seqScan(rows, target).id}`);
console.log(`Found (idx): ${emailIndex.get(target).id}`);
```
</details>

## Common pitfalls

> [!PITFALL] Selecting N+1 rows instead of joining
> A classic bug: fetch a list of users, then run a separate `SELECT` inside a loop to get each user's orders. This is the "N+1 query problem." Always prefer a single `JOIN` or use `WHERE id = ANY($1)` with an array of IDs. N+1 is the #1 database performance mistake in web apps.

> [!PITFALL] Forgetting NOT NULL and UNIQUE constraints
> Constraints are free documentation *and* enforcement. A `NOT NULL` on `email` costs nothing and prevents a whole class of bugs. Add constraints at design time; retrofitting them to a table with millions of rows requires careful migrations.

## What you learned

- A relational database stores data in **tables** linked by **primary** and **foreign keys** that the database itself enforces.
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` are the four fundamental operations; `JOIN` combines tables on a matching condition.
- **Normalization** eliminates duplication; start normalized and denormalize only when you have measured a bottleneck.
- **Indexes** (B-tree by default in Postgres) make filtered queries fast at the cost of slower writes — add them on columns you filter or join on.
- In JavaScript, arrays of objects mirror table rows; `filter`, `map`, and `find` mirror `WHERE`, `SELECT`, and lookups — relational thinking transfers.

## Next steps

Now that you can model data and write SQL, let's connect a real Node.js application to Postgres using the `pg` library — covering connection pooling, parameterized queries to prevent SQL injection, and transactions.
*/});
