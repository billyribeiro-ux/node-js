registerLessonSrc("17-node-sqlite", function () {/*
---
id: 17-node-sqlite
title: The Built-in node:sqlite Module
minutes: 28
level: intermediate
objectives:
  - Use node:sqlite's DatabaseSync to open a database, run queries, and use prepared statements
  - Understand when SQLite is the right tool versus a client-server database
  - Implement a repository pattern with transaction-like rollback in pure JS
---

# The Built-in node:sqlite Module

## Why this matters

SQLite is the most widely deployed database engine in the world — it lives inside every smartphone, browser, and embedded device. Until Node 24, using it required a native addon (`better-sqlite3`, `sqlite3`). Now **`node:sqlite`** ships directly with Node, zero dependencies, zero compilation. That changes the equation for local development databases, test fixtures, edge deployments, and CLI tools. Understanding when SQLite is *enough* — and when Postgres is necessary — is a real engineering decision you will make on every project.

## Learning objectives

- Open and query a SQLite database with **`DatabaseSync`** and prepared statements.
- Know the **key differences** between SQLite and Postgres: concurrency, types, write locking.
- Implement a **repository pattern** with atomic writes and rollback semantics.

## Opening a database

```js
import { DatabaseSync } from "node:sqlite";

// In-memory database (great for tests — gone when the process exits)
const db = new DatabaseSync(":memory:");

// File-backed database
const db2 = new DatabaseSync("./app.db");

// DatabaseSync is synchronous — no awaiting needed
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT    NOT NULL UNIQUE,
    name  TEXT    NOT NULL
  )
`);
```

> [!NOTE] DatabaseSync vs async alternatives
> `node:sqlite` provides a fully synchronous API. For most use-cases (embedded, CLI tools, tests) this is exactly what you want — no Promise chains, no async/await. For a server with many concurrent writes, the synchronous API combined with SQLite's single-writer model is fine because individual queries are microseconds. When you genuinely need async, use the `StatementSync` in a worker thread.

## Prepared statements

Prepared statements compile the SQL once and reuse it for every call — faster and injection-safe (just like `$1` parameters in `pg`).

```js
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT)`);

// Prepare once, execute many times
const insert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)");
const findByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const listAll = db.prepare("SELECT id, email, name FROM users ORDER BY id");

// run() returns { lastInsertRowid, changes }
const r1 = insert.run("ada@example.com", "Ada Lovelace");
const r2 = insert.run("grace@example.com", "Grace Hopper");
console.log("Inserted rows:", r1.lastInsertRowid, r2.lastInsertRowid);

// get() returns one row or undefined
const user = findByEmail.get("ada@example.com");
console.log("Found:", user);

// all() returns all matching rows as an array
const allUsers = listAll.all();
console.log("All users:", allUsers);
```

> [!OUTPUT]
> Inserted rows: 1 2
> Found: { id: 1, email: 'ada@example.com', name: 'Ada Lovelace' }
> All users: [
>   { id: 1, email: 'ada@example.com', name: 'Ada Lovelace' },
>   { id: 2, email: 'grace@example.com', name: 'Grace Hopper' }
> ]

## Transactions with DatabaseSync

SQLite transactions work just like Postgres — `BEGIN`, `COMMIT`, `ROLLBACK` — but with the synchronous API they are even cleaner:

```js
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, balance INTEGER);
  INSERT INTO accounts VALUES (1, 'Alice', 10000);
  INSERT INTO accounts VALUES (2, 'Bob', 5000);
`);

const debit  = db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?");
const credit = db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?");
const getBalance = db.prepare("SELECT balance FROM accounts WHERE id = ?");

function transfer(fromId, toId, amount) {
  const txn = db.prepare("BEGIN");
  const commit = db.prepare("COMMIT");
  const rollback = db.prepare("ROLLBACK");

  txn.run();
  try {
    debit.run(amount, fromId);
    const { balance } = getBalance.get(fromId);
    if (balance < 0) throw new Error("Insufficient funds");
    credit.run(amount, toId);
    commit.run();
    console.log(`Transferred ${amount} from ${fromId} to ${toId}`);
  } catch (err) {
    rollback.run();
    console.error("Transfer failed, rolled back:", err.message);
  }
}

transfer(1, 2, 3000);
console.log("Alice:", getBalance.get(1).balance); // 7000
console.log("Bob:  ", getBalance.get(2).balance); // 8000

transfer(1, 2, 99999); // should fail — insufficient funds
console.log("Alice:", getBalance.get(1).balance); // still 7000
```

> [!OUTPUT]
> Transferred 3000 from 1 to 2
> Alice: 7000
> Bob:   8000
> Transfer failed, rolled back: Insufficient funds
> Alice: 7000

## When SQLite is the right choice

| Factor | SQLite | Postgres |
|---|---|---|
| Deployment | Embedded, single binary | Separate server process |
| Concurrency | One writer at a time | Many concurrent writers (MVCC) |
| Data size | Up to ~281 TB (practical: < 1 TB) | Essentially unlimited |
| Network | None (file on disk) | TCP/IP (latency per query) |
| Best for | CLI tools, desktop apps, tests, edge, embedded, read-heavy APIs | Multi-user web apps, write-heavy workloads, complex queries |

> [!PRINCIPAL] SQLite-at-edge is a real architecture
> With platforms like Cloudflare D1, Turso, and Fly.io LiteFS, SQLite is replicated and distributed globally. Zero-latency local reads with global replication is a compelling trade-off for many read-heavy applications. `node:sqlite` means you can develop and test locally with the exact same API — no adapter layer.

## SQLite-specific quirks

**Dynamic typing** — SQLite uses "type affinity." A column declared `INTEGER` can still store text. Postgres is strict. Be aware:

```js
db.exec("CREATE TABLE loose (val INTEGER)");
const ins = db.prepare("INSERT INTO loose VALUES (?)");
ins.run("hello"); // SQLite accepts this; Postgres would reject it
```

**WAL mode** — for better concurrent read performance, enable Write-Ahead Logging:

```js
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL"); // safe with WAL, faster
```

**No ALTER TABLE DROP COLUMN before SQLite 3.35** — older SQLite versions require recreating tables to remove columns. Node 24 ships SQLite 3.46+, so this is fine, but be aware if targeting older environments.

> [!PITFALL] Opening the same file from multiple processes
> SQLite's write lock is file-level. Two Node processes writing to the same `.db` file simultaneously will serialize writes or timeout. For multi-process write workloads, use Postgres. For multi-process read-heavy workloads with WAL mode, SQLite is fine.

## Try it yourself

This pure-JS demo implements a **repository pattern** over an in-memory store with transaction-like rollback — the exact same pattern you'd use over `node:sqlite` or `pg`, just swapping the backend.

```js run
// Repository pattern with rollback semantics (pure-JS, no Node APIs)

function createUserRepository(store) {
  function beginTransaction() {
    // snapshot current state so we can roll back
    return {
      snapshot: {
        rows: [...store.rows],
        nextId: store.nextId,
      },
      committed: false,
    };
  }

  function commit(txn) {
    txn.committed = true;
  }

  function rollback(txn) {
    store.rows = txn.snapshot.rows;
    store.nextId = txn.snapshot.nextId;
  }

  function withTransaction(fn) {
    const txn = beginTransaction();
    try {
      const result = fn(txn);
      commit(txn);
      return result;
    } catch (err) {
      rollback(txn);
      throw err;
    }
  }

  return {
    findById(id) {
      return store.rows.find(r => r.id === id) || null;
    },

    findByEmail(email) {
      return store.rows.find(r => r.email === email) || null;
    },

    create(email, name) {
      return withTransaction(() => {
        if (store.rows.some(r => r.email === email)) {
          throw new Error(`Duplicate email: ${email}`);
        }
        const user = { id: store.nextId++, email, name, createdAt: Date.now() };
        store.rows.push(user);
        return user;
      });
    },

    batchCreate(users) {
      return withTransaction(() => {
        const created = [];
        for (const { email, name } of users) {
          if (store.rows.some(r => r.email === email)) {
            throw new Error(`Duplicate email in batch: ${email}`);
          }
          const user = { id: store.nextId++, email, name, createdAt: Date.now() };
          store.rows.push(user);
          created.push(user);
        }
        return created;
      });
    },

    listAll() {
      return [...store.rows].sort((a, b) => a.id - b.id);
    },
  };
}

const store = { rows: [], nextId: 1 };
const users = createUserRepository(store);

// Single create
const ada = users.create("ada@example.com", "Ada Lovelace");
console.log("Created:", ada);

// Batch succeeds
const batch1 = users.batchCreate([
  { email: "grace@example.com", name: "Grace Hopper" },
  { email: "alan@example.com",  name: "Alan Turing" },
]);
console.log("Batch created:", batch1.map(u => u.name));

// Batch with duplicate — entire batch rolls back
console.log("\nTrying batch with duplicate...");
try {
  users.batchCreate([
    { email: "new@example.com", name: "New Person" },
    { email: "ada@example.com", name: "Ada Again" }, // duplicate!
  ]);
} catch (err) {
  console.log("Caught:", err.message);
}

// Confirm rollback — 'new@example.com' should NOT exist
console.log("All users after failed batch:", users.listAll().map(u => u.email));
```

## Exercises

### Exercise 1: Add an update method with optimistic locking

Implement `update(id, changes, expectedVersion)` that only applies the update if the row's `version` field matches `expectedVersion`. Increment `version` on success. Throw if the version doesn't match (optimistic concurrency control).

<details>
<summary>Show solution</summary>

```js run
function createVersionedStore() {
  const rows = new Map(); // id → row
  let nextId = 1;

  return {
    insert(data) {
      const row = { ...data, id: nextId++, version: 1 };
      rows.set(row.id, row);
      return { ...row };
    },

    update(id, changes, expectedVersion) {
      const row = rows.get(id);
      if (!row) throw new Error(`Row ${id} not found`);
      if (row.version !== expectedVersion) {
        throw new Error(
          `Stale data: expected version ${expectedVersion}, got ${row.version}`
        );
      }
      const updated = { ...row, ...changes, version: row.version + 1 };
      rows.set(id, updated);
      return { ...updated };
    },

    get(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
  };
}

const store = createVersionedStore();
const u1 = store.insert({ name: "Ada Lovelace", email: "ada@x.com" });
console.log("Inserted:", u1);

// Successful update
const u2 = store.update(u1.id, { name: "Ada Augusta Lovelace" }, 1);
console.log("Updated:", u2); // version: 2

// Stale update (using old version 1 again)
try {
  store.update(u1.id, { name: "Stale Update" }, 1);
} catch (err) {
  console.log("Caught:", err.message);
}

// Confirm current state
console.log("Current:", store.get(u1.id));
```

</details>

### Exercise 2: Implement a simple query cache over the repository

Add a `cached(repo, ttlMs)` wrapper that memoizes `findById` results for `ttlMs` milliseconds, invalidating on updates.

<details>
<summary>Show solution</summary>

```js run
function withCache(repo, ttlMs = 5000) {
  const cache = new Map(); // id → { value, expiresAt }

  function invalidate(id) { cache.delete(id); }

  return {
    findById(id) {
      const hit = cache.get(id);
      if (hit && hit.expiresAt > Date.now()) {
        console.log(`  [cache HIT]  id=${id}`);
        return hit.value;
      }
      console.log(`  [cache MISS] id=${id}`);
      const value = repo.findById(id);
      if (value) cache.set(id, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },

    update(id, changes) {
      const result = repo.update(id, changes);
      invalidate(id); // bust the cache
      return result;
    },

    create: repo.create.bind(repo),
  };
}

// Simple in-memory "repo"
const memRepo = (() => {
  const rows = new Map([[1, { id: 1, name: "Ada" }], [2, { id: 2, name: "Grace" }]]);
  return {
    findById: id => rows.get(id) ? { ...rows.get(id) } : null,
    update(id, changes) {
      const row = rows.get(id);
      if (!row) throw new Error("Not found");
      const updated = { ...row, ...changes };
      rows.set(id, updated);
      return { ...updated };
    },
    create(data) { const r = { id: rows.size + 1, ...data }; rows.set(r.id, r); return { ...r }; },
  };
})();

const cached = withCache(memRepo, 200); // 200 ms TTL

cached.findById(1); // MISS
cached.findById(1); // HIT
cached.findById(2); // MISS

cached.update(1, { name: "Ada Lovelace" }); // busts cache for id=1
cached.findById(1); // MISS again (invalidated)
cached.findById(2); // HIT
```

</details>

## Project

### Build a transactional data-access layer over Postgres with connection pooling and a migration runner

This module project ties together everything you have learned: SQL modeling, the `pg` driver, pooling, parameterized queries, transactions, and migrations. Build a **data-access layer (DAL)** for a simple e-commerce domain (users, products, orders).

**Acceptance criteria:**

1. **Schema migrations** — write at least 3 ordered migration files (`001_create_users.sql`, `002_create_products.sql`, `003_create_orders.sql`) with `-- up` and `-- down` sections. A `runMigrations()` function reads pending migrations from a `schema_migrations` table and applies them in a transaction.

2. **Connection pool** — configure a `pg.Pool` with sensible limits (`max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 2000`) and export a `query(sql, params)` helper that uses `pool.query()`.

3. **Parameterized queries only** — all user-facing queries use `$1`, `$2`, … placeholders. A `createUser(email, name)` function must throw a descriptive error (not a raw `pg` error) when email is already taken.

4. **Transactions** — `placeOrder(userId, items)` must: insert into `orders`, insert all `order_items`, and update `products.stock_count` in a single transaction. If any step fails (e.g., insufficient stock), the entire transaction rolls back.

5. **Repository pattern** — wrap each table in a repository object (`userRepo`, `productRepo`, `orderRepo`) with `findById`, `create`, and domain-specific methods. No raw `pool.query` calls outside repository files.

6. **Graceful shutdown** — call `pool.end()` on `SIGTERM`/`SIGINT` so the process drains open connections before exiting.

**Pure-JS starter** — run this in the sandbox to see the repository pattern and transactional rollback logic before wiring up real Postgres:

```js run
// Pure-JS starter: Repository pattern with transactional placeOrder
// Replace the in-memory store with pg queries to complete the project

function createStore() {
  return {
    users:     new Map(),
    products:  new Map(),
    orders:    new Map(),
    orderItems: [],
    _uid: 1, _pid: 1, _oid: 1,
  };
}

function createUserRepo(store) {
  return {
    findById: id => store.users.get(id) || null,
    findByEmail: email => [...store.users.values()].find(u => u.email === email) || null,
    create(email, name) {
      if ([...store.users.values()].some(u => u.email === email)) {
        throw Object.assign(new Error("Email already taken"), { code: "23505" });
      }
      const user = { id: store._uid++, email, name };
      store.users.set(user.id, user);
      return { ...user };
    },
  };
}

function createProductRepo(store) {
  return {
    findById: id => store.products.get(id) || null,
    create(name, priceCents, stock) {
      const product = { id: store._pid++, name, priceCents, stock };
      store.products.set(product.id, product);
      return { ...product };
    },
    decrementStock(id, qty) {
      const p = store.products.get(id);
      if (!p) throw new Error(`Product ${id} not found`);
      if (p.stock < qty) throw new Error(`Insufficient stock for "${p.name}"`);
      p.stock -= qty;
    },
  };
}

function createOrderRepo(store, productRepo) {
  function placeOrder(userId, items) {
    // Snapshot for rollback
    const snap = {
      orders: new Map(store.orders),
      products: new Map([...store.products].map(([k, v]) => [k, { ...v }])),
      orderItems: [...store.orderItems],
      nextOid: store._oid,
    };

    try {
      // Insert order
      const total = items.reduce((s, i) => {
        const p = productRepo.findById(i.productId);
        if (!p) throw new Error(`Product ${i.productId} not found`);
        return s + p.priceCents * i.qty;
      }, 0);

      const order = { id: store._oid++, userId, totalCents: total, createdAt: Date.now() };
      store.orders.set(order.id, order);

      // Insert order items + decrement stock
      for (const item of items) {
        productRepo.decrementStock(item.productId, item.qty);
        store.orderItems.push({ orderId: order.id, productId: item.productId, qty: item.qty });
      }

      console.log(`  ORDER ${order.id} placed — total $${(total / 100).toFixed(2)}`);
      return { ...order };
    } catch (err) {
      // ROLLBACK — restore snapshot
      store.orders = snap.orders;
      for (const [k, v] of snap.products) store.products.set(k, v);
      store.orderItems.length = 0;
      store.orderItems.push(...snap.orderItems);
      store._oid = snap.nextOid;
      console.log(`  ROLLBACK: ${err.message}`);
      throw err;
    }
  }

  return {
    placeOrder,
    findById: id => store.orders.get(id) || null,
  };
}

// --- Wire it together ---
const store = createStore();
const userRepo    = createUserRepo(store);
const productRepo = createProductRepo(store);
const orderRepo   = createOrderRepo(store, productRepo);

// Seed data
const ada     = userRepo.create("ada@example.com", "Ada Lovelace");
const keyboard = productRepo.create("Keyboard", 7999, 5);
const mouse    = productRepo.create("Mouse", 2999, 2);

console.log("=== Successful order ===");
const order1 = orderRepo.placeOrder(ada.id, [
  { productId: keyboard.id, qty: 1 },
  { productId: mouse.id,    qty: 2 },
]);
console.log("Stock after:", {
  keyboard: productRepo.findById(keyboard.id).stock,
  mouse:    productRepo.findById(mouse.id).stock,
});

console.log("\n=== Order that exceeds stock (should roll back) ===");
try {
  orderRepo.placeOrder(ada.id, [
    { productId: mouse.id, qty: 99 }, // only 0 left!
  ]);
} catch (_) {}

console.log("Mouse stock after rollback:", productRepo.findById(mouse.id).stock);
console.log("Total orders:", store.orders.size); // still 1
```

## Common pitfalls

> [!PITFALL] Using node:sqlite for multi-process write workloads
> SQLite's write lock is per-file, not per-row. Two Node worker threads or OS processes writing simultaneously will serialize. For a web server that accepts concurrent write requests, either use WAL mode (which helps significantly for reads) or switch to Postgres. Do not use SQLite as the primary store for a write-heavy multi-process service.

> [!PITFALL] Forgetting to finalize prepared statements
> `StatementSync` objects hold native resources. In long-running processes with many dynamically created prepared statements, garbage collection handles them, but in tight loops, explicitly allow the GC to collect unused statements or cache and reuse them.

## What you learned

- **`node:sqlite`** ships with Node 24 — zero dependencies, synchronous API, great for tests, CLIs, embedded apps, and edge.
- `DatabaseSync` opens a database; `prepare()` compiles a `StatementSync`; `run()` / `get()` / `all()` execute it.
- SQLite shines for single-process or read-heavy workloads; Postgres handles multi-process concurrent writes, complex queries, and massive scale.
- The **repository pattern** wraps database access behind a clean interface and makes swapping backends (in-memory → SQLite → Postgres) straightforward.
- Snapshot-based rollback in pure JS mirrors what `ROLLBACK` does in a real database — understanding the pattern makes transactions intuitive.

## Next steps

With Postgres and SQLite under your belt, the next module explores **ORMs and query builders** (Drizzle, Prisma, Kysely) — higher-level abstractions that generate SQL for you while keeping type safety, and when to prefer raw SQL over them.
*/});
