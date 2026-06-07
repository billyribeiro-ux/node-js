registerQuiz("15-express", [
  {
    q: "What is the correct signature for an Express error-handling middleware function?",
    options: [
      "(req, res, next) — the same as regular middleware",
      "(err, req, res, next) — four arguments, with the error as the first parameter",
      "(error, next) — only two arguments are needed",
      "(req, res, err) — error replaces the 'next' argument"
    ],
    answer: 1,
    explain: "Express distinguishes error-handling middleware by its four-argument signature '(err, req, res, next)'. Express detects the arity and routes errors passed via 'next(err)' to these handlers instead of regular middleware. They must be registered LAST in the application."
  },
  {
    q: "In Express 4, if an async route handler throws an error without catching it, what happens?",
    options: [
      "Express automatically passes the error to the error-handling middleware",
      "The error is silently swallowed and the client receives a 200 response",
      "The uncaught rejection crashes the process or is left unhandled; the error does NOT reach the error middleware automatically",
      "Express retries the route handler up to three times before giving up"
    ],
    answer: 2,
    explain: "In Express 4, async route handlers that throw are NOT automatically forwarded to error middleware. The rejection is unhandled, which in modern Node logs a warning and may crash the process. You must wrap async handlers with try/catch and call 'next(err)', or upgrade to Express 5 which fixes this."
  },
  {
    q: "What is the purpose of 'express.Router()' in a large Express application?",
    options: [
      "To replace 'app.use()' with a faster routing algorithm",
      "To create an isolated mini-application with its own middleware and route handlers that can be mounted at a path prefix",
      "To enable WebSocket routing alongside HTTP routes",
      "To automatically parse request bodies for all routes"
    ],
    answer: 1,
    explain: "An Express Router is a mini-application that has its own middleware stack and route handlers. It is mounted on the main app with 'app.use(\"/prefix\", router)', which keeps feature-specific routes and middleware organized and isolated."
  }
]);

registerResources("15-express", [
  { title: "Express.js official documentation", url: "https://expressjs.com/en/4x/api.html" },
  { title: "Express.js: Writing middleware", url: "https://expressjs.com/en/guide/writing-middleware.html" },
  { title: "Express.js: Error handling guide", url: "https://expressjs.com/en/guide/error-handling.html" },
  { title: "Express.js: Router API", url: "https://expressjs.com/en/api.html#router" },
  { title: "express-async-errors package", url: "https://www.npmjs.com/package/express-async-errors" }
]);

registerQuiz("15-fastify", [
  {
    q: "How does Fastify's JSON serialization achieve 2-5x faster throughput than 'JSON.stringify' on typical route responses?",
    options: [
      "It uses a native C++ add-on to call the V8 serializer directly",
      "It caches the serialized output and returns it for identical requests",
      "It compiles a dedicated serializer function from the route's output schema at startup using 'fast-json-stringify'",
      "It skips JSON encoding and sends MessagePack instead"
    ],
    answer: 2,
    explain: "Fastify uses 'fast-json-stringify' to compile a dedicated serializer from the route's response JSON schema at server startup. That function knows the exact output shape in advance and skips runtime type-checking, making it significantly faster than the generic 'JSON.stringify'."
  },
  {
    q: "What is the difference between registering a Fastify plugin with 'fp()' (fastify-plugin) versus without it?",
    options: [
      "Using 'fp()' makes the plugin load synchronously; without it the plugin loads asynchronously",
      "A raw plugin is encapsulated: its decorators and hooks stay in its own scope. Wrapping with 'fp()' promotes them to the parent scope",
      "Using 'fp()' enables schema validation; without it validation is disabled",
      "There is no meaningful difference between the two approaches"
    ],
    answer: 1,
    explain: "By default, Fastify plugin encapsulation keeps decorators and hooks local to the plugin scope. Wrapping with 'fp()' (fastify-plugin) breaks encapsulation intentionally, exposing the plugin's decorators and hooks to the parent instance — used for shared infrastructure like auth and database connections."
  },
  {
    q: "In Fastify's hook lifecycle, which hook should you use to extract an auth token and set 'request.user' before any other processing?",
    options: [
      "preHandler",
      "preSerialization",
      "onResponse",
      "onRequest"
    ],
    answer: 3,
    explain: "The 'onRequest' hook fires immediately after the TCP connection is accepted, before body parsing or schema validation. It is the earliest hook and the correct place for token extraction, rate-limiting checks, and other operations that must run before anything else."
  }
]);

registerResources("15-fastify", [
  { title: "Fastify official documentation", url: "https://fastify.dev/docs/latest/" },
  { title: "Fastify: Lifecycle and hooks", url: "https://fastify.dev/docs/latest/Reference/Lifecycle/" },
  { title: "Fastify: Plugin guide", url: "https://fastify.dev/docs/latest/Guides/Plugins-Guide/" },
  { title: "fast-json-stringify on GitHub", url: "https://github.com/fastify/fast-json-stringify" },
  { title: "fastify-plugin on npm", url: "https://www.npmjs.com/package/fastify-plugin" }
]);

registerQuiz("15-hono", [
  {
    q: "What makes a Hono application portable across Node.js, Cloudflare Workers, Bun, and Deno without code changes?",
    options: [
      "Hono compiles JavaScript to WebAssembly at build time",
      "Hono uses Web-standard 'Request' and 'Response' objects, which are natively available in all modern runtimes",
      "Hono auto-detects the runtime and swaps its internal implementations at startup",
      "Hono uses a polyfill that emulates Node.js APIs in non-Node runtimes"
    ],
    answer: 1,
    explain: "Hono is built on the Web-standard Fetch API: every route handler receives a 'Context' wrapping a native 'Request' and returns a 'Response'. Since all modern runtimes — Node 18+, Bun, Deno, Cloudflare Workers — implement these globals natively, the same application code runs everywhere."
  },
  {
    q: "How do you run a Hono application on Node.js?",
    options: [
      "Call 'app.listen(3000)' the same way as Express",
      "Import and use the '@hono/node-server' adapter's 'serve()' function with 'app.fetch' as the handler",
      "Use 'http.createServer(app)' since Hono implements the Node request/response interface",
      "Hono cannot run on Node.js; it only supports Cloudflare Workers and Deno"
    ],
    answer: 1,
    explain: "Hono applications export 'app.fetch' — a standard fetch handler. To run on Node, you import '@hono/node-server' and call 'serve({ fetch: app.fetch, port: 3000 })'. The application logic itself stays runtime-agnostic."
  },
  {
    q: "In the Express vs Fastify vs Hono comparison, which framework is described as the best default for greenfield APIs in 2026 and why?",
    options: [
      "Express, because of its enormous ecosystem of middleware packages",
      "Fastify, because it has the highest raw throughput on Node.js",
      "Hono, because it costs nothing extra on Node while keeping every future deployment option open",
      "All three are equivalent for greenfield projects"
    ],
    answer: 2,
    explain: "The lesson states Hono is often the best default for new projects in 2026: it runs on Node with minimal overhead, and the same code works on Cloudflare Workers, Bun, Deno, and future runtimes. It costs nothing to use Hono on Node but keeps all deployment options open."
  }
]);

registerResources("15-hono", [
  { title: "Hono official documentation", url: "https://hono.dev/docs/" },
  { title: "Hono on GitHub", url: "https://github.com/honojs/hono" },
  { title: "@hono/node-server adapter", url: "https://github.com/honojs/node-server" },
  { title: "MDN: Request interface", url: "https://developer.mozilla.org/en-US/docs/Web/API/Request" },
  { title: "MDN: Response interface", url: "https://developer.mozilla.org/en-US/docs/Web/API/Response" }
]);
