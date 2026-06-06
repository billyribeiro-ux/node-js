registerLessonSrc("22-integration-e2e", function () {/*
---
id: 22-integration-e2e
title: "Integration & End-to-End Testing"
minutes: 28
level: advanced
objectives:
  - Distinguish unit, integration, and e2e tests and choose the right layer for each scenario
  - Test HTTP APIs end-to-end with supertest and node:test
  - Design test databases, fixtures, and CI pipelines for reliable integration suites
---

# Integration & End-to-End Testing

## Why this matters

Unit tests tell you individual functions work in isolation. They do not tell you that a PUT /users/42 request actually saves to the database, sends the right response headers, and handles missing records with a 404. For that you need tests that exercise the whole stack. Getting this layer right — fast enough to run on every pull request, reliable enough not to produce false failures — is one of the most valuable engineering investments a backend team can make.

## Learning objectives

- Place tests correctly on the **testing pyramid** and explain the cost/confidence tradeoff at each level.
- Write HTTP integration tests against a running Express (or Fastify) app using **supertest**.
- Set up a **test database** with migrations and teardown so tests never interfere with each other.
- Use **fixtures** to keep test data readable and maintainable.
- Structure a **CI pipeline** that runs the full suite reliably.

## The testing pyramid

```
        /\
       /  \   E2E (few, slow, highest confidence)
      /----\
     /      \  Integration (moderate, ~seconds each)
    /--------\
   /          \ Unit (many, fast, lowest surface area)
  /____________\
```

**Unit tests** isolate a single function. Cheap to write, fast, run in milliseconds. They give you confidence in logic but zero confidence in wiring.

**Integration tests** exercise multiple real components together — your HTTP router, middleware, database driver, and real SQL. They take seconds. They catch mismatches between layers that unit tests can never see.

**End-to-end tests** drive a real browser or client against a fully deployed environment. Slow, expensive, flaky if not carefully managed. Keep these few and focus them on critical user paths (login → checkout → receipt email).

> [!PRINCIPAL] Optimise the pyramid, not coverage totals
> The classic mistake is over-investing in E2E tests because "they test everything." They're the most expensive to write, slowest to run, and most prone to environment-dependent flakiness. A well-crafted integration test suite — fast, isolated, parallelisable — gives you 80% of E2E confidence at 10% of the cost. Invest heavily in integration tests for API services, and keep E2E tests laser-focused on the handful of flows that are business-critical.

## Testing HTTP APIs with supertest

**supertest** wraps your Express/Fastify app and fires real HTTP requests against it — no `listen()` call needed:

```bash
npm install -D supertest @types/supertest
```

```js
import express from "express";
import request from "supertest";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const app = express();
app.use(express.json());

app.get("/users/:id", (req, res) => {
  if (req.params.id === "42") return res.json({ id: 42, name: "Ada" });
  res.status(404).json({ error: "not found" });
});

describe("GET /users/:id", () => {
  test("returns the user for a valid id", async () => {
    const res = await request(app).get("/users/42");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { id: 42, name: "Ada" });
  });

  test("returns 404 for unknown id", async () => {
    const res = await request(app).get("/users/999");
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, "not found");
  });
});
```

> [!OUTPUT]
> TAP version 13
> # Subtest: GET /users/:id
>     ok 1 - returns the user for a valid id
>     ok 2 - returns 404 for unknown id
>     1..2
> ok 1 - GET /users/:id
> # tests 2
> # pass  2

supertest handles opening and closing the HTTP connection for you. The app never calls `.listen()` — supertest binds it to an ephemeral port internally, which means tests never compete for a fixed port.

### Testing POST with a body and auth header

```js
test("creates a user with valid body", async () => {
  const res = await request(app)
    .post("/users")
    .set("Authorization", "Bearer test-token")
    .send({ name: "Bob", email: "bob@example.com" });

  assert.strictEqual(res.status, 201);
  assert.ok(res.body.id);
  assert.strictEqual(res.body.name, "Bob");
});
```

## Test databases

Never run integration tests against your production or staging database. Options, best to worst:

1. **An isolated test database** per CI run, seeded from migrations. Fastest, most faithful.
2. **SQLite in-memory** for lightweight tests that don't need Postgres-specific features.
3. **Testcontainers** — spin up a real Postgres/MySQL container per test run via Docker.

### Isolation pattern: transaction rollback

Wrap each test in a database transaction and roll it back at the end. The database state is always clean:

```js
import { test } from "node:test";
import { db } from "../src/db.js";  // your database client

test("inserts and retrieves a user", async () => {
  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO users (name) VALUES ('Test User')");
    const { rows } = await db.query("SELECT * FROM users WHERE name = 'Test User'");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, "Test User");
  } finally {
    await db.query("ROLLBACK");
  }
});
```

> [!NOTE] beforeEach/afterEach hooks in node:test
> In `node:test`, use `before`, `after`, `beforeEach`, and `afterEach` hooks (imported from `"node:test"`) to run setup and teardown. They work inside `describe` blocks too.

```js
import { describe, it, beforeEach, afterEach } from "node:test";

describe("user CRUD", () => {
  beforeEach(async () => { await db.query("BEGIN"); });
  afterEach(async () => { await db.query("ROLLBACK"); });

  it("creates a user", async () => { // test body here
  });
  it("updates a user", async () => { // test body here
  });
});
```

## Fixtures

**Fixtures** are pre-defined, readable test data. Instead of building objects inline in every test, define canonical examples once:

```js
// test/fixtures/users.js
export const fixtures = {
  ada: { id: 1, name: "Ada Lovelace", email: "ada@example.com", role: "admin" },
  bob: { id: 2, name: "Bob Turing",   email: "bob@example.com", role: "user"  }
};
```

```js
import { fixtures } from "../fixtures/users.js";

test("admin can delete users", async () => {
  const res = await request(app)
    .delete("/users/" + fixtures.bob.id)
    .set("X-User-Id", String(fixtures.ada.id));
  assert.strictEqual(res.status, 204);
});
```

Fixtures give tests a shared vocabulary and make it obvious when a test is relying on a specific data shape.

> [!PITFALL] Shared mutable fixtures
> If tests share a fixture object and one test mutates it, later tests get corrupted data. Always deep-clone fixtures before use, or define factory functions: `const user = () => ({ ...fixtures.ada })`.

## CI pipeline structure

A well-structured CI pipeline for a Node API:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpass
        options: --health-cmd pg_isready --health-interval 5s --health-timeout 5s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - run: npm ci
      - run: npm run migrate:test
      - run: node --test --experimental-test-coverage
```

Key principles:
- Run migrations before tests, not once at DB creation time.
- Use the service health check (`pg_isready`) so tests don't start before Postgres is up.
- Fail fast: put unit tests before integration tests in the pipeline.
- Cache `node_modules` with `actions/cache` keyed on `package-lock.json` hash.

## Try it yourself

The following runnable starter is a test harness in pure JavaScript. It defines a fake API handler, then runs a list of test cases against it — the same pattern you'd use with a real HTTP handler in integration tests:

```js run
// A fake HTTP handler (simulates an Express route handler).
function userHandler(method, path, body) {
  const users = [
    { id: 1, name: "Ada",  email: "ada@example.com" },
    { id: 2, name: "Bob",  email: "bob@example.com" }
  ];
  const idMatch = path.match(/\/users\/(\d+)/);

  if (method === "GET" && path === "/users") {
    return { status: 200, body: users };
  }

  if (method === "GET" && idMatch) {
    const user = users.find((u) => u.id === Number(idMatch[1]));
    return user ? { status: 200, body: user } : { status: 404, body: { error: "not found" } };
  }

  if (method === "POST" && path === "/users") {
    if (!body || !body.name) return { status: 400, body: { error: "name required" } };
    const newUser = { id: users.length + 1, ...body };
    users.push(newUser);
    return { status: 201, body: newUser };
  }

  return { status: 405, body: { error: "method not allowed" } };
}

// A tiny integration test harness.
const cases = [
  {
    name: "GET /users returns list",
    method: "GET", path: "/users",
    check: (r) => r.status === 200 && Array.isArray(r.body) && r.body.length === 2
  },
  {
    name: "GET /users/1 returns Ada",
    method: "GET", path: "/users/1",
    check: (r) => r.status === 200 && r.body.name === "Ada"
  },
  {
    name: "GET /users/99 returns 404",
    method: "GET", path: "/users/99",
    check: (r) => r.status === 404 && r.body.error === "not found"
  },
  {
    name: "POST /users creates a user",
    method: "POST", path: "/users", body: { name: "Carol", email: "carol@example.com" },
    check: (r) => r.status === 201 && r.body.name === "Carol" && typeof r.body.id === "number"
  },
  {
    name: "POST /users without name returns 400",
    method: "POST", path: "/users", body: {},
    check: (r) => r.status === 400 && r.body.error === "name required"
  }
];

let passed = 0, failed = 0;
for (const c of cases) {
  const result = userHandler(c.method, c.path, c.body || null);
  if (c.check(result)) {
    console.log("PASS  " + c.name);
    passed++;
  } else {
    console.log("FAIL  " + c.name);
    console.log("      response:", JSON.stringify(result));
    failed++;
  }
}
console.log("");
console.log("Results: " + passed + " passed, " + failed + " failed");
```

## Project

**Achieve high-coverage suites for your API with node:test and Vitest side by side, including supertest e2e.**

You will build a small Express REST API (Users + Posts) and write two parallel test suites for it — one using `node:test` + supertest, one using Vitest + supertest — so you can observe the differences first-hand.

### Acceptance criteria

1. **API implementation** — implement at minimum: `GET /users`, `GET /users/:id`, `POST /users`, `GET /posts`, `POST /posts` (with a `userId` foreign key validated against existing users).
2. **node:test suite** — covers all five endpoints with `describe`/`it`, includes at least one `beforeEach`/`afterEach` for data reset, and runs with `node --test`.
3. **Vitest suite** — covers the same endpoints, uses `vi.fn()` to mock the database layer in at least one test, and runs with `npx vitest run`.
4. **Coverage** — both suites report ≥ 80% line coverage on the route handlers; use `--experimental-test-coverage` for node:test and `--coverage` for Vitest.
5. **Fixtures** — extract test data into a `test/fixtures/` directory; no raw object literals duplicated across more than one test file.
6. **CI config** — provide a GitHub Actions workflow (`.github/workflows/test.yml`) that runs both suites and fails the build if either suite fails or coverage drops below threshold.

### Starter: pure-JS test harness core

```js run
// The core of a table-driven test harness — extend this for your real API.
// Each test case declares method, path, body, and an expected shape.

function runSuite(handler, cases) {
  let passed = 0, failed = 0;
  for (const c of cases) {
    const res = handler(c.method, c.path, c.body || null);
    const ok = c.expect.status === res.status &&
      (!c.expect.bodyContains || JSON.stringify(res.body).includes(c.expect.bodyContains));
    if (ok) { passed++; console.log("PASS  " + c.name); }
    else {
      failed++;
      console.log("FAIL  " + c.name);
      console.log("      expected status:", c.expect.status, "got:", res.status);
      if (c.expect.bodyContains)
        console.log("      expected body to contain:", c.expect.bodyContains);
    }
  }
  return { passed, failed };
}

// Minimal fake handler to drive the harness
function fakeHandler(method, path, body) {
  if (method === "GET"  && path === "/users") return { status: 200, body: [] };
  if (method === "POST" && path === "/users") {
    if (!body || !body.name) return { status: 400, body: { error: "name required" } };
    return { status: 201, body: { id: 1, ...body } };
  }
  return { status: 404, body: { error: "not found" } };
}

const { passed, failed } = runSuite(fakeHandler, [
  { name: "GET /users", method: "GET", path: "/users", expect: { status: 200 } },
  { name: "POST /users ok", method: "POST", path: "/users",
    body: { name: "Ada" }, expect: { status: 201, bodyContains: "Ada" } },
  { name: "POST /users missing name", method: "POST", path: "/users",
    body: {}, expect: { status: 400, bodyContains: "name required" } }
]);

console.log("");
console.log("Suite complete: " + passed + " passed, " + failed + " failed");
```

## Common pitfalls

> [!PITFALL] Tests that share state through a module-level variable
> A common mistake is to define your Express app or database connection at module level in a test file, then mutate it across tests (adding users, changing config). When tests run in parallel — which `node --test` does by default across files — this causes intermittent failures that are nearly impossible to debug. Keep state local to each test, or use transaction rollback to reset between tests.

## What you learned

- The testing pyramid guides investment: many fast unit tests, fewer integration tests, very few E2E tests.
- supertest lets you fire real HTTP requests against your app without a running server process.
- Wrapping each integration test in a database transaction and rolling it back keeps tests isolated.
- Fixtures give tests a shared vocabulary and eliminate repetitive inline data.
- A CI pipeline should run migrations, execute both unit and integration suites, and enforce coverage thresholds.

## Next steps

Your testing foundation is solid. The next module covers **toolchain and build pipelines** — TypeScript compilation, bundling, linting, and connecting all these test commands into a coherent developer workflow with scripts and pre-commit hooks.
*/});
