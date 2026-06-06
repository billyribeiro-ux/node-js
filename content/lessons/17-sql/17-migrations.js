registerLessonSrc("17-migrations", function () {/*
---
id: 17-migrations
title: Migrations & Indexing
minutes: 26
level: advanced
objectives:
  - Write up/down migrations and track applied versions in a migrations table
  - Understand B-tree indexes, when they help, and when they hurt
  - Read and interpret EXPLAIN ANALYZE output from Postgres
---

# Migrations & Indexing

## Why this matters

Your database schema is code. It needs version control, reproducible deploys, and the ability to roll back bad changes — just like your application code. Without a migration system, teams manually run `ALTER TABLE` statements in production and pray. Meanwhile, a missing index on a busy table silently makes queries 1000× slower than they need to be. This lesson gives you both: a disciplined way to evolve schemas and the mental model to know *why* and *where* indexes matter.

## Learning objectives

- Write **up** and **down** migration files, track them in a `schema_migrations` table, and run them in order.
- Understand how **B-tree indexes** work internally and when adding one helps vs hurts.
- Use **EXPLAIN ANALYZE** in Postgres to read a query plan and confirm index usage.

## What is a migration?

A **migration** is a versioned script that changes the database schema (or data). Migrations come in pairs:

- **up** — apply the change (add a column, create a table, build an index).
- **down** — reverse the change (drop the column, drop the table, drop the index).

A `schema_migrations` table records which migrations have been applied, so the runner can always determine what's pending.

```sql
-- The bookkeeping table (create it once, manually or as migration 000)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT      PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);
```

## Migration files in practice

Teams typically store migrations as numbered files:

```
migrations/
  001_create_users.sql
  002_add_users_phone.sql
  003_create_orders.sql
  004_add_orders_index.sql
```

Each file has an `-- up` section and a `-- down` section, separated by a marker comment. Here's `002_add_users_phone.sql`:

```sql
-- up
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE INDEX idx_users_phone ON users(phone);

-- down
DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
```

Some teams use separate `up.sql` / `down.sql` files per version; others use JS/TS files for programmatic migrations. Popular tools: **node-pg-migrate**, **Flyway**, **Liquibase**, **Drizzle Kit**, **Prisma Migrate**.

## Running migrations with pg

A migration runner needs to:
1. Read all migration files in order.
2. Check which versions are already in `schema_migrations`.
3. Run the `up` block of each pending migration inside a transaction.
4. Record the version in `schema_migrations`.

```js
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getApplied(client) {
  const { rows } = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  return new Set(rows.map(r => r.version));
}

async function runMigrations(migrationsDir) {
  const files = (await fs.readdir(migrationsDir))
    .filter(f => f.endsWith(".sql"))
    .sort(); // lexicographic order keeps 001, 002, 003 correct

  const client = await pool.connect();
  try {
    // Ensure bookkeeping table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const applied = await getApplied(client);

    for (const file of files) {
      const version = path.basename(file, ".sql");
      if (applied.has(version)) {
        console.log(`  skip  ${version}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const upSql = sql.split("-- down")[0].replace("-- up", "").trim();

      await client.query("BEGIN");
      try {
        await client.query(upSql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [version]
        );
        await client.query("COMMIT");
        console.log(`  apply ${version}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw Object.assign(err, { migration: version });
      }
    }
    console.log("Migrations complete.");
  } finally {
    client.release();
  }
}

runMigrations("./migrations").catch(err => {
  console.error("Migration failed at", err.migration, err.message);
  process.exit(1);
});
```

> [!OUTPUT]
>   skip  001_create_users
>   apply 002_add_users_phone
>   apply 003_create_orders
>   apply 004_add_orders_index
> Migrations complete.

> [!PITFALL] Never edit an applied migration
> Once a migration file has run in production, treat it as immutable. Editing it won't re-run it — the version is already in `schema_migrations`. Write a new migration that adjusts what you need to change.

## How B-tree indexes work

A **B-tree** (balanced tree) is the default index type in Postgres. Visualise it as a sorted tree:

- Leaf nodes hold **(value, row pointer)** pairs in sorted order.
- Interior nodes hold separators that guide searches down the right branch.
- Finding a value takes **O(log n)** comparisons regardless of table size.

This is why an index on `email` makes `WHERE email = 'ada@example.com'` fast even on a 100 million-row table — the tree is typically only 3–4 levels deep.

```sql
-- B-tree index (default): great for =, <, >, BETWEEN, ORDER BY, LIKE 'prefix%'
CREATE INDEX idx_users_email ON users(email);

-- Composite index: useful when you always filter by both columns
-- The leftmost column must appear in the query for the index to engage
CREATE INDEX idx_orders_user_placed ON orders(user_id, placed_at DESC);

-- Partial index: indexes only rows matching a condition (smaller, faster)
CREATE INDEX idx_orders_pending ON orders(placed_at)
  WHERE status = 'pending';

-- Unique index: enforces uniqueness and enables fast =  lookups
CREATE UNIQUE INDEX uidx_users_email ON users(email);
```

> [!NOTE] Other index types
> Postgres also has **GIN** (arrays, full-text search, JSONB containment), **GiST** (geographic, range types), **BRIN** (huge append-only tables with correlated physical order), and **Hash** (equality only, rarely preferred). B-tree covers 95% of cases.

### When indexes help

- **High-cardinality columns** used in `WHERE`, `JOIN ON`, or `ORDER BY`: `email`, `user_id`, `created_at`.
- **Large tables** where a sequential scan would touch millions of rows to return tens.
- **Sorting and range queries**: B-tree stores values in order, so `ORDER BY created_at DESC LIMIT 20` can use an index-only scan.

### When indexes hurt

- **Small tables**: the planner may prefer a sequential scan anyway — reading the whole table is often faster than two lookups (index → heap).
- **Write-heavy workloads**: every `INSERT`, `UPDATE`, and `DELETE` must update every index. A table with 10 indexes pays 10× the write overhead.
- **Low-cardinality columns**: an index on a boolean `active` column in a table where 95% of rows are `active = true` won't help — the planner will still scan most of the table.
- **Bloat from frequent updates**: B-trees accumulate dead pages; `REINDEX` or autovacuum keeps them healthy.

> [!PRINCIPAL] Index strategy: measure first, index second
> Do not add indexes speculatively. Use `EXPLAIN ANALYZE` on your slow queries to confirm a sequential scan is the bottleneck, then add the narrowest index that fixes it. Indexes are not free — they are a write-time tax paid for read-time speed. A table with too many indexes can be *slower* on writes than one with none.

## Reading EXPLAIN ANALYZE

`EXPLAIN ANALYZE` executes the query and shows the real query plan with timings.

```sql
EXPLAIN ANALYZE
SELECT id, name FROM users WHERE email = 'ada@example.com';
```

> [!OUTPUT]
> Index Scan using idx_users_email on users  (cost=0.43..8.45 rows=1 width=40) (actual time=0.023..0.025 rows=1 loops=1)
>   Index Cond: (email = 'ada@example.com')
> Planning Time: 0.082 ms
> Execution Time: 0.041 ms

Key things to look for:
- **Seq Scan** — full table scan. Fine for small tables; investigate for large ones.
- **Index Scan** — using the index to find rows, then fetching from heap.
- **Index Only Scan** — all needed columns are in the index itself (fastest).
- **cost=X..Y** — X is start-up cost, Y is total estimated cost (arbitrary units).
- **actual time=start..end** — real milliseconds; compare to estimate to detect stale statistics.
- **Bitmap Heap Scan** — used for range queries that match many rows; less random I/O than Index Scan.

When you see a `Seq Scan` on a large table taking hundreds of milliseconds, that's your signal to consider an index.

## Try it yourself

Here is a pure-JS migration runner that applies pending migrations in order and tracks applied versions — the same logic as a real migration tool, in a self-contained simulation.

```js run
// In-memory migration runner — same logic as node-pg-migrate
// Migrations are objects with { version, up() }

const migrations = [
  {
    version: "001_create_users",
    up(db) {
      db.tables.set("users", []);
      db.indexes.set("users_pk", { table: "users", column: "id" });
      console.log("  [001] created users table + PK index");
    },
  },
  {
    version: "002_add_email_index",
    up(db) {
      if (!db.tables.has("users")) throw new Error("users table not found");
      db.indexes.set("users_email_idx", { table: "users", column: "email" });
      console.log("  [002] added email index on users");
    },
  },
  {
    version: "003_create_orders",
    up(db) {
      db.tables.set("orders", []);
      db.indexes.set("orders_pk", { table: "orders", column: "id" });
      db.indexes.set("orders_user_idx", { table: "orders", column: "user_id" });
      console.log("  [003] created orders table + indexes");
    },
  },
];

function createDb() {
  return {
    tables: new Map(),
    indexes: new Map(),
    applied: new Set(), // schema_migrations
  };
}

function runMigrations(db, allMigrations) {
  console.log("Running migrations...");
  for (const m of allMigrations) {
    if (db.applied.has(m.version)) {
      console.log(`  skip  ${m.version} (already applied)`);
      continue;
    }
    try {
      m.up(db);
      db.applied.add(m.version);
      console.log(`  apply ${m.version} ✓`);
    } catch (err) {
      console.error(`  FAILED ${m.version}:`, err.message);
      throw err;
    }
  }
  console.log(`\nDone. Applied: ${db.applied.size}/${allMigrations.length}`);
  return db;
}

// First run — all 3 pending
const db = createDb();
runMigrations(db, migrations);

console.log("\n--- Second run (simulating re-deploy) ---");
// Second run — all already applied
runMigrations(db, migrations);

console.log("\nFinal schema:");
console.log("Tables:", [...db.tables.keys()]);
console.log("Indexes:", [...db.indexes.keys()]);
```

## Exercises

### Exercise 1: Add rollback support

Extend the migration runner above to support rolling back the last applied migration using a `down()` function.

<details>
<summary>Show solution</summary>

```js run
const migrations = [
  {
    version: "001_create_users",
    up(db)   { db.tables.set("users", []); console.log("  [001 up] created users"); },
    down(db) { db.tables.delete("users");  console.log("  [001 down] dropped users"); },
  },
  {
    version: "002_create_orders",
    up(db)   { db.tables.set("orders", []); console.log("  [002 up] created orders"); },
    down(db) { db.tables.delete("orders");  console.log("  [002 down] dropped orders"); },
  },
];

function createDb() { return { tables: new Map(), applied: [] }; }

function applyAll(db, migs) {
  for (const m of migs) {
    m.up(db);
    db.applied.push(m.version);
  }
}

function rollbackOne(db, migs) {
  if (db.applied.length === 0) { console.log("Nothing to roll back."); return; }
  const version = db.applied[db.applied.length - 1];
  const m = migs.find(x => x.version === version);
  if (!m) throw new Error(`Migration ${version} not found`);
  m.down(db);
  db.applied.pop();
  console.log(`  rolled back ${version}`);
}

const db = createDb();
console.log("=== Apply all ===");
applyAll(db, migrations);
console.log("Applied:", db.applied);
console.log("Tables:", [...db.tables.keys()]);

console.log("\n=== Rollback last ===");
rollbackOne(db, migrations);
console.log("Applied:", db.applied);
console.log("Tables:", [...db.tables.keys()]);
```

</details>

### Exercise 2: Simulate index cardinality

Build a simple benchmark that shows how a Map-based index (high cardinality) is faster than a sequential scan, but on a low-cardinality column (boolean), the "index" offers little benefit.

<details>
<summary>Show solution</summary>

```js run
const N = 50_000;
const rows = Array.from({ length: N }, (_, i) => ({
  id: i,
  email: `user${i}@x.com`,
  active: i % 20 !== 0, // 95% are active = true (low cardinality)
}));

// Build indexes
const emailIndex = new Map(rows.map(r => [r.email, r]));
const activeIndex = new Map(); // low-cardinality: true → [many rows], false → [few rows]
for (const r of rows) {
  if (!activeIndex.has(r.active)) activeIndex.set(r.active, []);
  activeIndex.get(r.active).push(r);
}

// High-cardinality lookup (email = unique value)
const t0 = performance.now();
for (let i = 0; i < 10_000; i++) emailIndex.get(`user${i}@x.com`);
const emailIdx = performance.now() - t0;

const t1 = performance.now();
for (let i = 0; i < 10_000; i++) rows.find(r => r.email === `user${i}@x.com`);
const emailSeq = performance.now() - t1;

// Low-cardinality lookup (active = true returns 95% of rows)
const t2 = performance.now();
for (let i = 0; i < 100; i++) activeIndex.get(true).length;
const activeIdxTime = performance.now() - t2;

const t3 = performance.now();
for (let i = 0; i < 100; i++) rows.filter(r => r.active === true).length;
const activeSeqTime = performance.now() - t3;

console.log("=== High-cardinality column (email) ===");
console.log(`Index lookup x10k:  ${emailIdx.toFixed(1)}ms`);
console.log(`Seq scan    x10k:  ${emailSeq.toFixed(1)}ms`);
console.log(`Speedup: ${(emailSeq / emailIdx).toFixed(0)}×`);

console.log("\n=== Low-cardinality column (active boolean, 95% true) ===");
console.log(`"Index" x100:  ${activeIdxTime.toFixed(2)}ms  (returns ${activeIndex.get(true).length} rows)`);
console.log(`Seq scan x100: ${activeSeqTime.toFixed(2)}ms  (returns ${rows.filter(r=>r.active).length} rows)`);
console.log("Index offers little benefit — must still materialise most rows");
```

</details>

## Common pitfalls

> [!PITFALL] Running migrations outside a transaction
> If an `ALTER TABLE` succeeds but the `INSERT INTO schema_migrations` fails, you end up with a half-applied migration that the runner thinks is still pending. Always run both inside a single transaction. Note: some DDL (like `CREATE INDEX CONCURRENTLY`) cannot run inside a transaction — handle those as special cases.

> [!PITFALL] Indexes on columns used only in SELECT lists
> An index only helps if the column appears in `WHERE`, `JOIN ON`, or `ORDER BY`. Adding an index because "we display this column" wastes write performance with zero read benefit.

## What you learned

- **Migrations** are versioned up/down scripts tracked in a `schema_migrations` table; always run them inside a transaction and treat applied migrations as immutable.
- **B-tree indexes** give O(log n) lookup via a sorted tree; they speed up equality, range, and sort queries on high-cardinality columns in large tables.
- Indexes cost write performance — each mutation must update every index on the table. Add them intentionally, not speculatively.
- **Partial indexes** and **composite indexes** let you optimize very specific query patterns at lower overhead than full-column indexes.
- **EXPLAIN ANALYZE** reveals the real query plan: look for Seq Scans on large tables and compare `cost` estimates to `actual time` to spot stale planner statistics.

## Next steps

You now have the full Postgres toolkit: schema modeling, safe queries, transactions, migrations, and indexes. The final lesson in this module introduces **node:sqlite** — the built-in, zero-dependency database engine that ships with Node 24, perfect for local development, tests, and edge deployments.
*/});
