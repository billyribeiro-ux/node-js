registerLessonSrc("16-pagination-filtering", function () {/*
---
id: 16-pagination-filtering
title: "Pagination, Filtering & Versioning"
minutes: 26
level: advanced
objectives:
  - Implement offset and cursor pagination and choose the right one for each use case
  - Design filtering, sorting, and field-selection query parameters
  - Version an API without breaking existing consumers
---

# Pagination, Filtering & Versioning

## Why this matters

A collection endpoint that returns every row in your database is a ticking time bomb. At a few hundred rows it feels fine; at a million it takes down your server, blows up your client's memory, and costs a fortune in database I/O. Pagination, filtering, and sorting turn a data firehose into a manageable stream. Versioning lets you evolve the API without shattering every integration on the day you ship a breaking change. These are the three design decisions that separate a production API from a toy.

## Learning objectives

- Explain **offset pagination** and **cursor pagination**, and know when to use each.
- Design clean, consistent query parameters for filtering, sorting, and field selection.
- Compare four API versioning strategies and apply the right one.
- Describe content negotiation and rate limiting as first-class API concerns.

## Pagination

Every list endpoint must be paginated. The question is *how*.

### Offset pagination

The classic approach: skip `offset` rows, return the next `limit` rows.

```
GET /articles?limit=20&offset=40
```

```js
// Express handler sketch (read-only)
app.get("/articles", async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? "20"), 100);
  const offset = parseInt(req.query.offset ?? "0");

  const rows  = await db.query("SELECT * FROM articles ORDER BY id LIMIT $1 OFFSET $2", [limit, offset]);
  const total = await db.query("SELECT COUNT(*) FROM articles");

  res.json({
    data: rows,
    pagination: {
      limit,
      offset,
      total: Number(total.rows[0].count),
      hasMore: offset + rows.length < Number(total.rows[0].count)
    }
  });
});
```

> [!OUTPUT]
> {
>   "data": [...20 items...],
>   "pagination": { "limit": 20, "offset": 40, "total": 312, "hasMore": true }
> }

**Pros:** Simple to implement. Works with SQL `LIMIT`/`OFFSET`. The client can jump to any page.

**Cons:** If rows are inserted or deleted while a client is paginating, the window shifts — items are skipped or duplicated. The database must scan and discard `offset` rows on every query, which gets expensive for large offsets.

> [!PITFALL] Offset pagination breaks under concurrent writes
> Imagine you return page 1 (rows 1-20) and someone inserts a row before row 1. When the client requests page 2 (offset 20), what was row 20 is now row 21 — the client sees the old row 20 twice and misses row 21. For real-time feeds, leaderboards, or any data that changes frequently, use cursor pagination.

### Cursor pagination

Instead of an offset, you give the client an **opaque cursor** — a token encoding the position of the last seen item. On the next request, the client passes the cursor back and you fetch rows *after* that position.

```
GET /articles?limit=20                       <- first page, no cursor
GET /articles?limit=20&cursor=<token>        <- subsequent pages
```

The cursor is typically a base64-encoded JSON object containing the sort key value of the last record returned — keeping it opaque lets you change the internals later.

```js
// Cursor helpers (read-only)
function encodeCursor(lastId) {
  return Buffer.from(JSON.stringify({ id: lastId })).toString("base64url");
}

function decodeCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

app.get("/articles", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "20"), 100);
  let whereClause = "";
  const params = [limit + 1]; // fetch one extra to detect hasMore

  if (req.query.cursor) {
    const { id } = decodeCursor(req.query.cursor);
    whereClause = "WHERE id > $2";
    params.push(id);
  }

  const rows = await db.query(
    `SELECT * FROM articles ${whereClause} ORDER BY id LIMIT $1`,
    params
  );

  const hasMore = rows.length > limit;
  const page    = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

  res.json({ data: page, nextCursor });
});
```

> [!OUTPUT]
> {
>   "data": [...20 items...],
>   "nextCursor": "eyJpZCI6MjB9"
> }

**Pros:** Stable — inserts and deletes between pages don't shift the window. Efficient — the database can use an index range scan instead of a full-table scan with offset. Scales to billions of rows.

**Cons:** You can't jump to an arbitrary page (no "go to page 7"). Requires a stable sort key.

> [!PRINCIPAL] Cursor pagination is always the right choice at scale
> Offset pagination feels simpler but its O(offset) cost bites you as data grows — `OFFSET 100000` forces the database to count 100,000 rows it will discard. Cursor pagination turns every page fetch into an O(1) index seek regardless of position in the dataset. Adopt it early; retrofitting pagination is painful once clients depend on the offset shape.

## Filtering, sorting, and field selection

### Filtering

Use query parameters whose names mirror field names:

```
GET /articles?status=published&author_id=42
GET /orders?created_after=2025-01-01&min_total=100
```

For complex filters (range, OR, full-text), keep a consistent convention:

```
GET /products?price_gte=10&price_lte=50    // range
GET /events?tag=node&tag=javascript        // multi-value (repeated param)
```

Never accept raw SQL or dynamic field names directly from query params — always whitelist the allowed filter fields server-side.

### Sorting

```
GET /articles?sort=created_at&order=desc
GET /products?sort=price,name&order=asc,asc   // multi-column
```

> [!WARNING] Sanitize sort column names
> If you interpolate the `sort` query param directly into SQL (`ORDER BY ${req.query.sort}`) you have a SQL injection vector. Always validate against an explicit allow-list of sortable columns before building the query.

### Field selection (sparse fieldsets)

Let clients request only the fields they need — reduces payload size and prevents over-fetching:

```
GET /users?fields=id,name,email
```

This is especially valuable for mobile clients on slow connections.

## API versioning strategies

When you need to make a **breaking change** (rename a field, change a status code's meaning, remove a resource), you need a versioning strategy so existing clients keep working.

### 1. URL path versioning

```
GET /v1/users/42
GET /v2/users/42
```

**Most common.** Easy to test in a browser. Clear to consumers. Downside: you end up maintaining multiple codepaths, and the version is technically not a property of the resource.

### 2. Header versioning

```
GET /users/42
Accept: application/vnd.myapi.v2+json
```

Keeps URLs clean; semantically correct (the URL identifies the resource, the header selects the representation). Harder to test in a browser; requires careful documentation.

### 3. Query parameter versioning

```
GET /users/42?version=2
```

Easy to implement and test. Feels a bit hacky; URLs that differ only by query param can confuse caches.

### 4. Sunset-based deprecation (no versioning)

Keep one version; add a `Sunset` response header announcing when a feature will be removed. Give clients months of warning. Works only for non-breaking additive changes — removing fields is always breaking.

> [!NOTE] Additive changes are not breaking
> Adding a new optional field, a new endpoint, or a new status code value is backward-compatible. Removing or renaming a field, changing a field's type, or changing status code semantics is breaking. Design around additive change for as long as possible.

> [!PRINCIPAL] Version the surface, not the codebase
> Don't duplicate your entire service for each version. Instead, version only the request/response transformation layer — a thin adapter per version that translates to/from the canonical internal representation. The core business logic stays unversioned. Libraries like `express-version-route` or simple middleware support this cleanly.

## Content negotiation

HTTP lets clients tell the server what format they want via the `Accept` header:

```
Accept: application/json
Accept: text/csv
Accept: application/xml
```

The server responds with `Content-Type` matching what it sent. If it can't produce the requested type, it returns `406 Not Acceptable`.

For most APIs, JSON is the only format. But offering CSV export for analytics endpoints is often extremely valuable and surprisingly cheap to add.

## Rate limiting

Return `429 Too Many Requests` when a client exceeds their quota. Always include headers telling the client how close they are to the limit and when it resets:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1717700000
Retry-After: 60
```

Common algorithms: **token bucket** (burst-friendly), **sliding window** (smooth), **fixed window** (simple but bursty at window boundaries).

## Try it yourself

Let's implement cursor pagination over an in-memory array — the core algorithm translates directly to any data source:

```js run
// ---- cursor helpers ----
function encodeCursor(value) {
  // base64-encode a JSON payload so the cursor is opaque to callers
  const json = JSON.stringify({ v: value });
  // btoa works in browsers; in Node 24 you'd use Buffer.from(json).toString("base64url")
  return btoa(json);
}

function decodeCursor(token) {
  return JSON.parse(atob(token)).v;
}

// ---- fake dataset: 50 articles with numeric IDs ----
const ARTICLES = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  title: `Article ${i + 1}`
}));

// ---- paginate(cursor, limit) -> { page, nextCursor } ----
function paginate(cursorToken, limit) {
  let startIndex = 0;

  if (cursorToken) {
    const lastId = decodeCursor(cursorToken);
    // find the element after the cursor
    const pos = ARTICLES.findIndex(a => a.id === lastId);
    startIndex = pos === -1 ? 0 : pos + 1;
  }

  // fetch one extra to detect whether more pages exist
  const slice   = ARTICLES.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const page    = hasMore ? slice.slice(0, limit) : slice;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

  return { page, nextCursor };
}

// ---- walk through all pages ----
let cursor = null;
const PAGE_SIZE = 12;
let pageNum = 0;

do {
  const { page, nextCursor } = paginate(cursor, PAGE_SIZE);
  pageNum++;
  console.log(`Page ${pageNum}: ids ${page[0].id}..${page[page.length - 1].id} (${page.length} items)  nextCursor=${nextCursor ? nextCursor.slice(0, 12) + "..." : "null"}`);
  cursor = nextCursor;
} while (cursor);

console.log(`\nTotal pages: ${pageNum}  Total items: 50`);
```

## Exercise: add filtering to the paginator

Extend the `paginate` function above to accept a `filterFn` predicate that filters the dataset before paginating. Verify that pagination still works correctly over the filtered subset.

<details>
<summary>Show solution</summary>

```js run
function encodeCursor(value) { return btoa(JSON.stringify({ v: value })); }
function decodeCursor(token) { return JSON.parse(atob(token)).v; }

const ARTICLES = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  title: `Article ${i + 1}`,
  category: i % 2 === 0 ? "tech" : "culture"
}));

function paginate(cursorToken, limit, filterFn = () => true) {
  const filtered = ARTICLES.filter(filterFn);
  let startIndex = 0;

  if (cursorToken) {
    const lastId = decodeCursor(cursorToken);
    const pos = filtered.findIndex(a => a.id === lastId);
    startIndex = pos === -1 ? 0 : pos + 1;
  }

  const slice      = filtered.slice(startIndex, startIndex + limit + 1);
  const hasMore    = slice.length > limit;
  const page       = hasMore ? slice.slice(0, limit) : slice;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;
  return { page, nextCursor, totalFiltered: filtered.length };
}

// Only "tech" articles (even IDs: 1,3,5... wait — category is even index so id 1,3,5... are tech)
let cursor = null;
let pageNum = 0;
const isTech = a => a.category === "tech";

do {
  const { page, nextCursor, totalFiltered } = paginate(cursor, 8, isTech);
  pageNum++;
  console.log(`Page ${pageNum}: ids [${page.map(a => a.id).join(",")}]`);
  if (pageNum === 1) console.log(`  (${totalFiltered} tech articles total)`);
  cursor = nextCursor;
} while (cursor);
```

</details>

## Common pitfalls

> [!PITFALL] Returning the total count on every cursor-paginated request is expensive
> A `SELECT COUNT(*)` on a large table requires a full scan (or at least an index scan). Many cursor-paginated APIs omit the total and provide only `hasMore`. If you must show "1,234 results", run the count query asynchronously or cache it — never block the response on a heavyweight COUNT.

Not capping the `limit` parameter is another common mistake. A client requesting `limit=999999` on a large table can OOM your server. Always enforce a maximum page size (typically 100–200 items) server-side, regardless of what the client asks for.

## What you learned

- **Offset pagination** is simple but degrades at scale and produces inconsistent pages under concurrent writes; **cursor pagination** is O(1) per page and stable.
- A cursor is an opaque base64-encoded token encoding the sort-key of the last seen record.
- Use predictable query param conventions for filtering (`field=value`), sorting (`sort=field&order=asc`), and field selection (`fields=a,b`).
- **URL path versioning** (`/v1/`) is the industry default; use additive changes to avoid versioning as long as possible.
- Always rate-limit APIs and surface quota state via `X-RateLimit-*` headers.

## Next steps

Clean pagination and versioning get your API to production quality — now add the last layer: input validation with Zod to catch bad data before it reaches your database, and generated OpenAPI docs so your API is self-describing.
*/});
