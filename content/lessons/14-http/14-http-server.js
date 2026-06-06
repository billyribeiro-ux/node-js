registerLessonSrc("14-http-server", function () {/*
---
id: 14-http-server
title: "The Raw http Module: Server & Client"
minutes: 24
level: intermediate
objectives:
  - Create an HTTP server with node:http and handle requests and responses correctly
  - Understand req and res objects, methods, headers, and status codes
  - Stream request and response bodies and make outbound HTTP requests with http.request
---

# The Raw http Module: Server & Client

## Why this matters

Every Node HTTP framework — Express, Fastify, Koa — sits on top of the built-in `node:http` module. Understanding the raw layer means you can debug framework behaviour, optimise performance-critical paths, write lightweight services with no dependencies, and confidently read framework source code. It also reveals *why* concepts like streaming matter: HTTP bodies are streams, not strings.

## Learning objectives

- Create an HTTP server with `createServer`, understanding `IncomingMessage` and `ServerResponse`.
- Read request method, URL, headers, and stream the body.
- Set response status codes, headers, and stream or write a body.
- Make outbound HTTP requests using `http.request`.

## The server model

`http.createServer` returns a `net.Server` that emits a `request` event for every incoming HTTP connection. The callback receives two objects:

- **`req`** — `http.IncomingMessage`: a readable stream carrying the request.
- **`res`** — `http.ServerResponse`: a writable stream you send back through.

```js
import http from "node:http";

const server = http.createServer((req, res) => {
  const { method, url, headers } = req;
  console.log(`${method} ${url}`);
  console.log("Host:", headers.host);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("Hello, Node!\n");
});

server.listen(3000, () => console.log("Listening on http://localhost:3000"));
```

> [!OUTPUT]
> Listening on http://localhost:3000
> GET / (on first browser request)
> Host: localhost:3000

> [!NOTE] Always call res.end()
> `res.end()` signals the end of the response. Forgetting it leaves clients hanging — the TCP connection stays open waiting for more data that never arrives.

## Status codes and headers

HTTP status codes tell the client what happened. The most important groups:

| Range | Meaning | Examples |
|-------|---------|---------|
| 2xx | Success | 200 OK, 201 Created, 204 No Content |
| 3xx | Redirect | 301 Moved Permanently, 302 Found |
| 4xx | Client error | 400 Bad Request, 401 Unauthorized, 404 Not Found |
| 5xx | Server error | 500 Internal Server Error, 503 Service Unavailable |

```js
// Sending headers explicitly
res.writeHead(404, {
  "Content-Type": "application/json",
  "X-Request-Id": "abc123",
  "Cache-Control": "no-store"
});
res.end(JSON.stringify({ error: "Not found" }));
```

> [!PITFALL] Headers must be sent before the body
> Calling `res.setHeader` or `res.writeHead` after `res.write` or `res.end` throws an error — headers are part of the HTTP preamble that is sent first. Check `res.headersSent` if you're unsure.

## Reading request bodies

Request bodies (POST, PUT, PATCH) arrive as a stream. You must collect the chunks:

```js
import http from "node:http";

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/echo") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: body }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3000);
```

> [!OUTPUT]
> (POST /echo with body "hello") → {"received":"hello"}

For JSON APIs, parse after collecting:

```js
req.on("end", () => {
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    // use data...
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
  }
});
```

## Streaming response bodies

You can send a response in chunks with `res.write()`, which is useful for large payloads:

```js
import http from "node:http";
import fs from "node:fs";

http.createServer((req, res) => {
  if (req.url === "/big-file") {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const fileStream = fs.createReadStream("/path/to/large-file.bin");
    fileStream.pipe(res); // pipe the file stream directly into the response
  }
}).listen(3000);
```

> [!PRINCIPAL] Pipe, don't buffer
> Buffering an entire large file into memory before sending risks OOM errors and high latency for the first byte. Piping a readable stream directly to `res` keeps memory usage flat regardless of file size — this is the same principle Nginx and static servers use internally.

## Making outbound HTTP requests with http.request

Node's built-in HTTP client is lower-level than `fetch` but powerful. It returns a `ClientRequest` (a writable stream) and calls back with `IncomingMessage`:

```js
import http from "node:http";

const options = {
  hostname: "example.com",
  port: 80,
  path: "/api/data",
  method: "GET",
  headers: { Accept: "application/json" }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    console.log(body);
  });
});

req.on("error", (err) => console.error("Request failed:", err.message));
req.end(); // must call end() to send the request
```

> [!OUTPUT]
> Status: 200
> {"data": ...}

For POST requests, write the body before calling `req.end()`:

```js
const payload = JSON.stringify({ name: "Alice" });
const req = http.request({
  hostname: "example.com",
  path: "/users",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  }
}, (res) => { // handle response
});

req.write(payload);
req.end();
```

## Try it yourself

Let's practice the *algorithm* at the heart of HTTP: parsing a raw HTTP request string into structured parts. In a real Node server the runtime does this for you, but understanding the format deepens your mental model.

```js run
function parseHttpRequest(raw) {
  // Separate headers from body on the blank line
  const headerBodySplit = raw.indexOf("\r\n\r\n");
  const headerSection = raw.slice(0, headerBodySplit);
  const body = raw.slice(headerBodySplit + 4) || null;

  const lines = headerSection.split("\r\n");
  const requestLine = lines[0];
  const [method, path, httpVersion] = requestLine.split(" ");

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx === -1) continue;
    const key = lines[i].slice(0, colonIdx).trim().toLowerCase();
    const value = lines[i].slice(colonIdx + 1).trim();
    headers[key] = value;
  }

  return { method, path, httpVersion, headers, body: body || null };
}

const rawRequest =
  "POST /api/users HTTP/1.1\r\n" +
  "Host: example.com\r\n" +
  "Content-Type: application/json\r\n" +
  "Content-Length: 18\r\n" +
  "\r\n" +
  '{"name":"Alice"}';

const parsed = parseHttpRequest(rawRequest);
console.log("Method:", parsed.method);
console.log("Path:", parsed.path);
console.log("Version:", parsed.httpVersion);
console.log("Host:", parsed.headers["host"]);
console.log("Content-Type:", parsed.headers["content-type"]);
console.log("Body:", parsed.body);
```

## Exercise

**Challenge:** Extend `parseHttpRequest` to also return a `contentLength` number (from the `content-length` header) and validate that it matches the actual body byte length. Log `"valid"` or `"invalid"` accordingly.

<details>
<summary>Show solution</summary>

```js run
function parseHttpRequest(raw) {
  const headerBodySplit = raw.indexOf("\r\n\r\n");
  const headerSection = raw.slice(0, headerBodySplit);
  const body = raw.slice(headerBodySplit + 4) || null;

  const lines = headerSection.split("\r\n");
  const [method, path, httpVersion] = lines[0].split(" ");

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx === -1) continue;
    const key = lines[i].slice(0, colonIdx).trim().toLowerCase();
    headers[key] = lines[i].slice(colonIdx + 1).trim();
  }

  const contentLength = headers["content-length"]
    ? parseInt(headers["content-length"], 10)
    : null;

  // Byte length (ASCII-safe for this exercise)
  const bodyLength = body ? body.length : 0;
  const valid = contentLength === null || contentLength === bodyLength;

  return { method, path, httpVersion, headers, body, contentLength, valid };
}

const rawGood =
  "POST /api/items HTTP/1.1\r\n" +
  "Content-Type: application/json\r\n" +
  "Content-Length: 15\r\n" +
  "\r\n" +
  '{"id":42,"x":1}';

const rawBad =
  "POST /api/items HTTP/1.1\r\n" +
  "Content-Length: 99\r\n" +
  "\r\n" +
  "short body";

const r1 = parseHttpRequest(rawGood);
const r2 = parseHttpRequest(rawBad);

console.log("Good request valid?", r1.valid);   // true
console.log("Bad request valid?", r2.valid);    // false
console.log("Declared:", r2.contentLength, "Actual:", r2.body.length);
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to drain or handle request body errors
> If you don't attach a `data` listener (or pipe the request somewhere), the stream stays paused and the client's upload stalls. Always either consume the body or explicitly destroy the request with `req.destroy()` if you don't need it (for example on a 405 Method Not Allowed).

> [!PITFALL] Calling res.end() multiple times
> Calling `res.end()` or `res.write()` after `res.end()` throws "write after end". Guard with `if (!res.writableEnded)` where needed, or structure your code so each code path calls `end` exactly once.

## What you learned

- `http.createServer` hands you `req` (readable stream) and `res` (writable stream) for every request.
- Set status codes with `res.statusCode` or `res.writeHead`; headers must be sent before the body.
- Collect streaming request bodies with `data`/`end` events, then parse.
- Pipe readable streams directly into `res` for memory-efficient large responses.
- Use `http.request` for outbound calls; write body data then call `req.end()`.

## Next steps

Using the raw `http` module for every project is repetitive. Next we cover **native `fetch` and undici** — the modern, ergonomic HTTP client API built into Node, and the high-performance engine powering it.
*/});
