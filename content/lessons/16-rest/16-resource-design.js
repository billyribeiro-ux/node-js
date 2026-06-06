registerLessonSrc("16-resource-design", function () {/*
---
id: 16-resource-design
title: "Resource Modeling & Status Codes"
minutes: 22
level: intermediate
objectives:
  - Model a domain as REST resources and pick correct URL shapes
  - Map HTTP methods to CRUD semantics and understand idempotency
  - Return the right status code for every outcome
---

# Resource Modeling & Status Codes

## Why this matters

REST is the lingua franca of the web. Every team you join will have an HTTP API, and every team will argue about whether a route should be `POST /send-email` or `POST /emails`. Getting resource design right reduces client-side bugs, makes your API intuitive enough to require less documentation, and keeps caches and HTTP infrastructure working the way they were designed to. Status codes are the API's signal path — returning `200 OK` from a failed operation silently corrupts consumer logic.

## Learning objectives

- Explain the five REST constraints that make an API "RESTful".
- Model a domain as nouns (resources) and choose the right HTTP method for each action.
- Return the correct 2xx / 3xx / 4xx / 5xx status code for every outcome.
- Explain idempotency and why it matters for retries and network failures.
- Describe Richardson Maturity levels and know where your API sits.

## REST principles in plain English

**REST** (Representational State Transfer) is an architectural style described by Roy Fielding in 2000. It has six constraints, but the ones you apply every day are:

1. **Client–server** — the UI and the data store evolve independently.
2. **Stateless** — every request carries all context the server needs; no session stored server-side between requests.
3. **Uniform interface** — resources have stable URLs; representations (JSON, HTML, etc.) are separate from the resource itself.
4. **Layered system** — clients don't know whether they're talking to the origin server or a cache/proxy.
5. **Cacheable** — responses state whether they may be cached; caching eliminates needless work.

The most important day-to-day constraint is **uniform interface**: your API talks about *things* (resources), not *actions* (procedures).

## Nouns, not verbs: modeling resources

The most common beginner mistake is RPC-flavoured URLs:

```
POST /getUser          ← action (bad)
POST /createInvoice    ← action (bad)
POST /sendEmail        ← action (bad)
```

REST replaces actions with **nouns** (resources) and uses the HTTP method to express the action:

```
GET    /users/:id         ← fetch one user
POST   /users             ← create a user
PUT    /users/:id         ← replace a user
PATCH  /users/:id         ← partially update
DELETE /users/:id         ← remove a user

GET    /users/:id/invoices        ← nested resource (invoices owned by a user)
POST   /emails                    ← "create" triggers a send
```

**Resource naming rules:**
- Use **plural nouns**: `/users`, `/orders`, `/products`.
- Use **lowercase kebab-case** for multi-word resources: `/shipping-addresses`.
- IDs belong in the path: `/articles/42`, not `/articles?id=42`.
- Query string is for filtering/sorting/pagination: `/articles?status=published&sort=date`.

> [!NOTE] What about actions with no obvious noun?
> Some actions are hard to noun-ify: sending an email, running a report, archiving a batch. Acceptable patterns: `POST /emails` (creation triggers the side effect), `POST /reports` (creates the report resource), or `POST /batch-archive` (a named sub-resource for the action). Pick the one that reads most naturally to consumers.

## HTTP method semantics

| Method | Semantics | Body? | Safe? | Idempotent? |
|--------|-----------|-------|-------|-------------|
| GET | Retrieve | no | yes | yes |
| POST | Create / submit | yes | no | no |
| PUT | Replace entirely | yes | no | yes |
| PATCH | Partial update | yes | no | no* |
| DELETE | Remove | optional | no | yes |
| HEAD | Like GET, headers only | no | yes | yes |
| OPTIONS | Describe allowed methods | no | yes | yes |

*PATCH can be designed idempotently, but HTTP does not guarantee it.

**Safe** means the method must not change server state (GET, HEAD, OPTIONS). Browsers and caches rely on this to pre-fetch and replay.

**Idempotent** means calling the method *N* times has the same effect as calling it once. Network stacks and mobile clients retry failed requests; if your endpoint is not idempotent you'll create duplicate orders. `PUT /users/42` with a full body is idempotent — sending it twice leaves the same record. `POST /orders` is not — two sends create two orders.

> [!PRINCIPAL] Design retries around idempotency
> At scale, every network call will eventually be retried — by load balancers, mobile SDKs, job runners, and scared developers pressing Refresh. Build POST endpoints that accept an **idempotency key** (`Idempotency-Key: <uuid>`) header and deduplicate on it. Stripe pioneered this pattern; it is now standard practice for payment APIs and any mutation where duplicates cause real harm.

## Status codes: the signal path

HTTP status codes are grouped by their first digit. Return the correct one and your consumers — including reverse proxies, monitoring tools, and retry logic — can react appropriately without parsing the body.

### 2xx — Success

| Code | Meaning | Use when |
|------|---------|----------|
| 200 OK | Generic success | GET, PUT, PATCH succeeded and response body has data |
| 201 Created | Resource created | POST created a new resource; include `Location` header |
| 204 No Content | Success, no body | DELETE succeeded; PATCH with no body needed |
| 202 Accepted | Async processing | Request accepted, work not done yet (background job) |

### 3xx — Redirection

| Code | Meaning | Use when |
|------|---------|----------|
| 301 Moved Permanently | Permanent redirect | Resource moved; clients should update bookmarks |
| 302 Found | Temporary redirect | Resource temporarily at different URL |
| 304 Not Modified | Use cached copy | With `ETag`/`Last-Modified`; tells client cache is fresh |

### 4xx — Client Error

| Code | Meaning | Use when |
|------|---------|----------|
| 400 Bad Request | Malformed input | Missing field, invalid JSON, failed validation |
| 401 Unauthorized | Not authenticated | No or invalid token; name is historical (means "authenticate") |
| 403 Forbidden | Not authorized | Authenticated but lacking permission |
| 404 Not Found | Resource absent | ID does not exist |
| 405 Method Not Allowed | Wrong verb | POST on a read-only route |
| 409 Conflict | State conflict | Duplicate unique field; version mismatch (optimistic lock) |
| 410 Gone | Permanently deleted | Resource existed, was removed, won't come back |
| 422 Unprocessable | Semantic error | JSON is valid but business rules reject it |
| 429 Too Many Requests | Rate limited | Include `Retry-After` header |

### 5xx — Server Error

| Code | Meaning | Use when |
|------|---------|----------|
| 500 Internal Server Error | Unhandled crash | Something broke that shouldn't have |
| 502 Bad Gateway | Upstream failed | Your proxy got a bad response from the origin |
| 503 Service Unavailable | Overloaded / maintenance | Include `Retry-After` if you know when |
| 504 Gateway Timeout | Upstream too slow | Proxy timed out waiting for origin |

> [!PITFALL] Returning 200 for errors
> Never `return res.status(200).json({ error: "not found" })`. Monitoring tools count 2xx as success. Retry middleware won't retry. Client code must inspect the body instead of the status — a contract violation that bites you at 3 AM during an incident.

> [!WARNING] 401 vs 403
> **401** means "you need to prove who you are" (no valid credentials). **403** means "I know who you are, but you can't do this." A logged-in user trying to access another user's private data should get **403**, not **404**. (Though returning 404 is acceptable when you want to hide the existence of the resource.)

## Richardson Maturity Model

Leonard Richardson described four levels of REST maturity:

- **Level 0** — one URL, one method. SOAP / XML-RPC style: `POST /api?action=getUser`.
- **Level 1** — multiple URLs, but still mostly POST. Resources exist, verbs don't.
- **Level 2** — HTTP methods used correctly + proper status codes. *This is where most production APIs live and what the industry means by "REST".*
- **Level 3** — Hypermedia (HATEOAS): responses include links to next valid actions. Rarely implemented; worth knowing exists.

Aim for Level 2. Level 3 adds complexity that most teams cannot sustain.

## Try it yourself

Here is a pure-JavaScript function that maps `(method, outcome)` pairs to the correct HTTP status code. Run it and extend it:

```js run
// statusFor(method, outcome) -> HTTP status code
function statusFor(method, outcome) {
  const m = method.toUpperCase();

  if (outcome === "invalid_input")    return 400;
  if (outcome === "unauthenticated")  return 401;
  if (outcome === "forbidden")        return 403;
  if (outcome === "not_found")        return 404;
  if (outcome === "conflict")         return 409;
  if (outcome === "rate_limited")     return 429;
  if (outcome === "server_error")     return 500;

  // Success path differs by method
  if (outcome === "ok") {
    if (m === "POST")   return 201;
    if (m === "DELETE") return 204;
    return 200; // GET, PUT, PATCH
  }

  if (outcome === "accepted") return 202;
  if (outcome === "no_change") return 304;

  throw new Error(`Unknown outcome: ${outcome}`);
}

// ---- tests ----
const cases = [
  ["GET",    "ok",           200],
  ["POST",   "ok",           201],
  ["DELETE", "ok",           204],
  ["PUT",    "ok",           200],
  ["PATCH",  "ok",           200],
  ["GET",    "not_found",    404],
  ["POST",   "invalid_input",400],
  ["GET",    "unauthenticated", 401],
  ["GET",    "forbidden",    403],
  ["POST",   "conflict",     409],
  ["GET",    "rate_limited", 429],
  ["GET",    "server_error", 500],
];

let passed = 0;
for (const [method, outcome, expected] of cases) {
  const got = statusFor(method, outcome);
  const ok = got === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${method} + ${outcome} -> ${got} (expected ${expected})`);
  if (ok) passed++;
}
console.log(`\n${passed}/${cases.length} tests passed`);
```

## Exercise: URL design review

Below is a list of poorly designed API endpoints. Redesign each one using proper REST conventions.

```
1. POST /getAllUsers
2. GET  /deleteArticle?id=5
3. POST /users/updateEmail
4. GET  /invoices/create
5. POST /search-user-by-name
```

<details>
<summary>Show solution</summary>

```js run
// Map of bad -> good with explanation
const redesigns = [
  {
    bad:  "POST /getAllUsers",
    good: "GET /users",
    why:  "Fetching is GET; 'getAll' is an action verb — use the noun + method"
  },
  {
    bad:  "GET /deleteArticle?id=5",
    good: "DELETE /articles/5",
    why:  "GET must be safe (no side-effects); ID goes in the path"
  },
  {
    bad:  "POST /users/updateEmail",
    good: "PATCH /users/:id",
    why:  "Partial updates are PATCH; the field being updated is in the body, not the URL"
  },
  {
    bad:  "GET /invoices/create",
    good: "POST /invoices",
    why:  "Creation uses POST; 'create' is a verb, not a resource segment"
  },
  {
    bad:  "POST /search-user-by-name",
    good: "GET /users?name=Alice",
    why:  "Search is a read — use GET with query params for filtering"
  }
];

for (const { bad, good, why } of redesigns) {
  console.log(`BAD:  ${bad}`);
  console.log(`GOOD: ${good}`);
  console.log(`WHY:  ${why}`);
  console.log("---");
}
```

</details>

## Common pitfalls

> [!PITFALL] Leaking internal structure in URLs
> URLs like `/api/v1/db/users_table/row/42` expose your database schema. URLs are a public contract — once published they are near-impossible to change without breaking clients. Design URLs around *domain concepts*, not storage details. `/users/42` can stay stable even if you move from Postgres to MongoDB.

Using verbs in URLs (`/getUser`, `/createOrder`) is the most common beginner error. It signals that you are building an RPC API over HTTP, not a REST API. Once bad URLs ship, they are very hard to retire.

## What you learned

- REST APIs expose **resources** (nouns) at stable URLs; HTTP **methods** express the action.
- GET/HEAD/OPTIONS are **safe**; GET/PUT/DELETE are **idempotent** — design POST endpoints with idempotency keys for mutations that must not duplicate.
- Return the precise status code: **201** for creation, **204** for empty success, **400/422** for validation, **401/403** for auth, **404** for missing resources, **5xx** for server faults.
- Never return `200` with an error body — it breaks monitoring, retries, and client contracts.
- Richardson Level 2 (correct methods + status codes) is the practical target for production APIs.

## Next steps

Now that you can design clean resource URLs and return the right status codes, the next challenge is handling large collections gracefully: pagination, filtering, sorting, and keeping your API stable across versions.
*/});
