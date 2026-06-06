registerLessonSrc("17-postgres-pg", function () {/*
---
id: 17-postgres-pg
title: "Postgres with pg: Pooling & Transactions"
minutes: 28
level: advanced
objectives:
  - Connect Node.js to Postgres using the pg library with Pool and Client
  - Write parameterized queries that prevent SQL injection
  - Wrap multiple statements in a transaction with BEGIN/COMMIT/ROLLBACK
---

# Postgres with pg: Pooling & Transactions

## Why this matters

Connecting to a database sounds simple — until your Node server spawns hundreds of concurrent requests and each one tries to open its own TCP connection to Postgres. Databases have connection limits. Opening and closing connections is slow. SQL injection is still the #1 web vulnerability. And "update the balance, then insert the transaction record" must succeed or fail *together*, not half-way. This lesson covers the plumbing every production Node + Postgres app needs: **connection pooling**, **parameterized queries**, and **transactions**.

## Learning objectives

- Install and configure `node-postgres` (`pg`) with a **Pool** for production and a **Client** for one-shot scripts.
- Write **parameterized queries** — the only safe way to interpolate user input into SQL.
- Wrap related writes in a **transaction** (`BEGIN` / `COMMIT` / `ROLLBACK`) so they never partially apply.

## Installing node-postgres

`pg` is the most popular Postgres driver for Node. It ships with a low-level `Client` and a `Pool` that manages multiple clients for you.

```bash
npm install pg
```

For TypeScript, add `@types/pg` as a dev dependency.

## Pool vs Client

| | `Client` | `Pool` |
|---|---|---|
| Connections | Opens one, you close it | Maintains up to `max` (default 10) |
| Lifecycle | Manual `connect()` / `end()` | Automatic acquire / release |
| When to use | Scripts, migrations, transactions | Web servers, APIs |
| Thread-safety | One query at a time | Multiple concurrent queries |

### Using Client (scripts / migrations)

```js
import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();
const res = await client.query("SELECT NOW() AS now");
console.log(res.rows[0].now);
await client.end(); // always close when done
```

> [!OUTPUT]
> 2026-06-06T14:23:01.234Z

### Using Pool (web servers)

```js
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,              // max open connections (match your Postgres max_connections)
  idleTimeoutMillis: 30_000,   // close idle connections after 30 s
  connectionTimeoutMillis: 2_000, // error if we wait > 2 s for a connection
});

// pool.query() acquires a client, runs the query, releases automatically
const res = await pool.query("SELECT id, name FROM users WHERE id = $1", [42]);
console.log(res.rows[0]);
```

> [!OUTPUT]
> { id: 42, name: 'Ada Lovelace' }

> [!NOTE] DATABASE_URL format
> `postgresql://user:password@host:5432/dbname` — most hosting platforms (Heroku, Render, Railway, Supabase) set this for you automatically.

## Parameterized queries — the only safe way

Never concatenate user input into SQL strings. This is a **SQL injection** vulnerability:

```js
// NEVER DO THIS
const email = req.body.email; // could be: "' OR '1'='1"
const sql = `SELECT * FROM users WHERE email = '${email}'`;
// An attacker passes: ' OR '1'='1
// Result: SELECT * FROM users WHERE email = '' OR '1'='1'
// → Returns every user in the database!
```

Instead, use **placeholders**: `$1`, `$2`, … The driver sends SQL and values separately, and Postgres *never* interprets the values as SQL.

```js
// CORRECT — parameterized query
const { rows } = await pool.query(
  "SELECT id, email FROM users WHERE email = $1 AND active = $2",
  [req.body.email, true]  // values are type-safe; pg handles quoting
);
```

You can also use named queries for reuse:

```js
const findUser = {
  name: "find-user-by-email",  // cached server-side after first run
  text: "SELECT id, name, email FROM users WHERE email = $1",
  values: [email],
};
const { rows } = await pool.query(findUser);
```

> [!PITFALL] Template literals look safe but aren't
> `pool.query(`SELECT * FROM users WHERE email = '${email}'`)` — this is still raw string interpolation. The backtick syntax does not make it parameterized. You must pass a separate `values` array.

## Transactions

A **transaction** groups multiple statements so they either *all succeed* (COMMIT) or *all fail* (ROLLBACK), leaving the database unchanged. Use them any time you have writes that must stay consistent with each other.

The canonical example: transferring money between accounts.

```js
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function transfer(fromId, toId, amountCents) {
  const client = await pool.connect(); // check out a dedicated client
  try {
    await client.query("BEGIN");

    // Debit sender
    await client.query(
      "UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2",
      [amountCents, fromId]
    );

    // Check sender has enough funds (could also use a CHECK constraint)
    const { rows } = await client.query(
      "SELECT balance_cents FROM accounts WHERE id = $1",
      [fromId]
    );
    if (rows[0].balance_cents < 0) {
      throw new Error("Insufficient funds");
    }

    // Credit receiver
    await client.query(
      "UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2",
      [amountCents, toId]
    );

    // Record the transfer
    await client.query(
      "INSERT INTO transfers (from_id, to_id, amount_cents) VALUES ($1, $2, $3)",
      [fromId, toId, amountCents]
    );

    await client.query("COMMIT");
    console.log("Transfer complete");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err; // re-throw so the caller handles it
  } finally {
    client.release(); // always return the client to the pool
  }
}
```

> [!OUTPUT]
> Transfer complete

> [!PITFALL] Using pool.query() for transactions
> `pool.query()` may use a *different* client for each call. Transactions require the same connection for all statements between `BEGIN` and `COMMIT`. Always use `pool.connect()` to get a dedicated `client` for the transaction, then release it in `finally`.

> [!PRINCIPAL] Design transactions to be short
> Every open transaction holds locks that block other writers. Keep transactions as short as possible — do expensive work (network calls, business logic) *outside* the transaction and only open it for the actual writes. Long transactions under load cause queue pile-ups and timeouts.

## Handling errors and query results

The `pg` result object has a consistent shape:

```js
const result = await pool.query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *", [
  "grace@example.com",
  "Grace Hopper",
]);

console.log(result.rows);     // array of row objects
console.log(result.rowCount); // number of rows affected
```

> [!OUTPUT]
> [ { id: 1, email: 'grace@example.com', name: 'Grace Hopper', created_at: 2026-06-06T14:00:00.000Z } ]
> 1

## Try it yourself

The connection pool itself is a fascinating concurrency primitive. Here is a pure-JS simulation that shows acquire/release with a maximum size and queued waiters — the exact logic `Pool` implements internally.

```js run
// Connection Pool Simulator
// Demonstrates: max connections, acquire/release, queueing waiters

function createPool(max = 3) {
  let available = max;           // idle connections
  const waiters = [];            // resolve callbacks waiting for a connection

  function acquire() {
    return new Promise((resolve) => {
      if (available > 0) {
        available--;
        const connId = max - available;
        console.log(`  acquired conn-${connId} (${available} idle remaining)`);
        resolve(connId);
      } else {
        console.log(`  no connections free — queuing waiter`);
        waiters.push(resolve);   // park the caller until one is released
      }
    });
  }

  function release(connId) {
    if (waiters.length > 0) {
      // hand the connection directly to the next waiter
      const next = waiters.shift();
      console.log(`  conn-${connId} released → handed to queued waiter`);
      next(connId);
    } else {
      available++;
      console.log(`  conn-${connId} released (${available} idle now)`);
    }
  }

  return { acquire, release, get idle() { return available; }, get waiting() { return waiters.length; } };
}

async function simulateQuery(pool, name, durationMs) {
  const conn = await pool.acquire();
  // simulate async work (would be a real DB round-trip)
  await new Promise(r => setTimeout(r, durationMs));
  console.log(`  [${name}] query done`);
  pool.release(conn);
}

// Run 6 concurrent "queries" through a pool of 3
(async () => {
  const pool = createPool(3);
  console.log("Launching 6 concurrent queries on a pool of 3...\n");

  await Promise.all([
    simulateQuery(pool, "Q1", 50),
    simulateQuery(pool, "Q2", 80),
    simulateQuery(pool, "Q3", 30),
    simulateQuery(pool, "Q4", 40),
    simulateQuery(pool, "Q5", 20),
    simulateQuery(pool, "Q6", 60),
  ]);

  console.log("\nAll queries complete. Idle connections:", pool.idle);
})();
```

## Exercises

### Exercise 1: Wrap a sequence in a transaction

Implement a `createOrderWithItems(pool, userId, items)` function that inserts one row in `orders` and one row per item in `order_items` in a single transaction. If any insert fails, nothing should be persisted.

<details>
<summary>Show solution</summary>

```js run
// Pure-JS simulation of transactional order creation
// (In real code, replace the "db" object with a pg client)

function createInMemoryDb() {
  const orders = [];
  const orderItems = [];
  let nextOrderId = 1;
  let nextItemId = 1;

  return {
    beginTransaction() { return { committed: false, rolled: false }; },

    insertOrder(tx, userId, totalCents) {
      if (tx.rolled) throw new Error("Transaction rolled back");
      const order = { id: nextOrderId++, userId, totalCents };
      orders.push(order);
      return order;
    },

    insertOrderItem(tx, orderId, productId, qty) {
      if (tx.rolled) throw new Error("Transaction rolled back");
      if (!productId) throw new Error(`Invalid product id: ${productId}`);
      orderItems.push({ id: nextItemId++, orderId, productId, qty });
    },

    commit(tx) { tx.committed = true; console.log("  COMMIT"); },
    rollback(tx, orders, orderItems, checkpoint) {
      tx.rolled = true;
      // restore state to checkpoint
      orders.length = checkpoint.ordersLen;
      orderItems.length = checkpoint.itemsLen;
      console.log("  ROLLBACK");
    },

    dump() { return { orders, orderItems }; },
  };
}

function createOrderWithItems(db, userId, items) {
  const { orders, orderItems } = db.dump();
  const checkpoint = { ordersLen: orders.length, itemsLen: orderItems.length };
  const tx = db.beginTransaction();
  try {
    const total = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
    const order = db.insertOrder(tx, userId, total);
    for (const item of items) {
      db.insertOrderItem(tx, order.id, item.productId, item.qty);
    }
    db.commit(tx);
    return order;
  } catch (err) {
    db.rollback(tx, orders, orderItems, checkpoint);
    throw err;
  }
}

const db = createInMemoryDb();

// Successful order
console.log("=== Successful order ===");
const order1 = createOrderWithItems(db, 1, [
  { productId: 10, qty: 2, priceCents: 999 },
  { productId: 11, qty: 1, priceCents: 4999 },
]);
console.log("Order:", order1);
console.log("DB state:", db.dump());

// Failing order (null productId triggers error)
console.log("\n=== Failing order ===");
try {
  createOrderWithItems(db, 2, [
    { productId: 20, qty: 1, priceCents: 500 },
    { productId: null, qty: 1, priceCents: 200 }, // bad!
  ]);
} catch (e) {
  console.log("Caught:", e.message);
}
console.log("DB state after rollback:", db.dump());
```

</details>

### Exercise 2: Retry on serialization failure

Postgres can abort transactions with error code `40001` (serialization failure) under high concurrency. Write a `withRetry(fn, maxAttempts)` wrapper that re-runs a transaction function up to `maxAttempts` times on that error.

<details>
<summary>Show solution</summary>

```js run
async function withRetry(fn, maxAttempts = 3) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (err) {
      const isSerializationError = err.code === "40001";
      if (isSerializationError && attempt < maxAttempts) {
        const delay = 50 * 2 ** (attempt - 1); // exponential backoff
        console.log(`Attempt ${attempt} failed (40001) — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// Simulate: fails twice then succeeds
let callCount = 0;
function flakyTransaction(attempt) {
  callCount++;
  if (callCount < 3) {
    const err = new Error("could not serialize access due to concurrent update");
    err.code = "40001";
    return Promise.reject(err);
  }
  return Promise.resolve(`committed on attempt ${attempt}`);
}

withRetry(flakyTransaction, 5).then(result => {
  console.log("Result:", result);
  console.log("Total calls:", callCount);
});
```

</details>

## Common pitfalls

> [!PITFALL] Not releasing clients after transactions
> If you `pool.connect()` and forget to call `client.release()` in the `finally` block, you permanently leak a connection slot. Under load, the pool exhausts its limit and new requests stall forever. Always use `try / finally` when holding a checked-out client.

> [!PITFALL] Catching errors without re-throwing inside a transaction
> If you catch an error inside a transaction block but don't re-throw, the code continues to `COMMIT` a partially-applied set of changes. Catch errors only to run `ROLLBACK`, then always re-throw.

## What you learned

- Use **Pool** for web servers (connection reuse, automatic acquire/release) and **Client** for scripts that need a single dedicated connection.
- **Parameterized queries** (`$1`, `$2`, …) are the only safe way to include user data in SQL — the driver sends SQL and values separately, so values are never interpreted as SQL.
- **Transactions** (`BEGIN` / `COMMIT` / `ROLLBACK`) ensure a set of writes either fully succeed or leave the database untouched — essential for anything involving money, inventory, or referential integrity.
- Always check out a dedicated `client` for a transaction and `release()` it in `finally`; never rely on `pool.query()` across transaction boundaries.
- Keep transactions short to minimize lock contention; do slow work outside the transaction block.

## Next steps

You now know how to talk to Postgres safely. Next: managing how the database *schema* evolves over time — writing migrations that can be applied in order and rolled back, and understanding how indexes actually work under the hood with `EXPLAIN`.
*/});
