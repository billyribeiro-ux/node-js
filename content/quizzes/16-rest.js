registerQuiz("16-resource-design", [
  {
    q: "Which of the following URL designs correctly follows REST resource modeling conventions?",
    options: [
      "POST /getAllUsers",
      "GET /deleteArticle?id=5",
      "DELETE /articles/5",
      "GET /invoices/create"
    ],
    answer: 2,
    explain: "REST uses nouns (resources) at stable URLs with HTTP methods expressing the action. 'DELETE /articles/5' uses the DELETE method on the articles resource with the ID in the path. The other options use verbs in URLs or misuse the HTTP method."
  },
  {
    q: "What does it mean for an HTTP method to be 'idempotent', and which of the following is NOT idempotent?",
    options: [
      "It means the method is safe; POST is not idempotent",
      "It means calling the method N times has the same effect as calling it once; POST is not idempotent",
      "It means the method never changes server state; DELETE is not idempotent",
      "It means the response is always cached; GET is not idempotent"
    ],
    answer: 1,
    explain: "Idempotency means N identical calls leave the server in the same state as one call. GET, PUT, and DELETE are idempotent. POST is NOT — sending 'POST /orders' twice creates two separate orders. This matters for retry logic: retrying idempotent methods is safe."
  },
  {
    q: "What is the correct HTTP status code to return when a POST request successfully creates a new resource?",
    options: [
      "200 OK",
      "202 Accepted",
      "201 Created",
      "204 No Content"
    ],
    answer: 2,
    explain: "201 Created signals that a new resource was successfully created. It should be accompanied by a 'Location' header pointing to the new resource. 200 OK is for successful GET/PUT/PATCH; 204 No Content is for successful DELETE or mutations that return no body."
  }
]);

registerResources("16-resource-design", [
  { title: "MDN: HTTP request methods", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods" },
  { title: "MDN: HTTP response status codes", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status" },
  { title: "RFC 9110: HTTP Semantics (methods and status codes)", url: "https://www.rfc-editor.org/rfc/rfc9110" },
  { title: "Richardson Maturity Model (Martin Fowler)", url: "https://martinfowler.com/articles/richardsonMaturityModel.html" },
  { title: "REST API design best practices (Microsoft)", url: "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design" }
]);

registerQuiz("16-pagination-filtering", [
  {
    q: "What is the main advantage of cursor pagination over offset pagination for large, frequently-updated datasets?",
    options: [
      "Cursor pagination lets the client jump to any arbitrary page number",
      "Cursor pagination is simpler to implement and requires no database changes",
      "Cursor pagination uses an opaque position token so pages stay stable even when rows are inserted or deleted between requests",
      "Cursor pagination eliminates the need for an ORDER BY clause"
    ],
    answer: 2,
    explain: "Offset pagination shifts the window when rows are inserted or deleted between page fetches, causing items to be duplicated or skipped. Cursor pagination encodes the last seen record's sort key, so each page is fetched relative to a stable position regardless of concurrent changes."
  },
  {
    q: "Why should a server always enforce a maximum 'limit' value on paginated list endpoints, regardless of what the client requests?",
    options: [
      "Because HTTP has a maximum response size of 64 KB",
      "Because databases do not support 'LIMIT' values above 1000",
      "To prevent a client from requesting an enormous result set that could OOM the server or exhaust database resources",
      "Because cursor pagination only works with page sizes of 100 or fewer"
    ],
    answer: 2,
    explain: "A client requesting 'limit=999999' on a large table could force the database to return millions of rows, exhausting server memory or timing out. The server must enforce a maximum page size (typically 100-200) server-side regardless of the requested value."
  },
  {
    q: "Which API versioning strategy keeps the URL clean while using an HTTP header to select the version?",
    options: [
      "URL path versioning: 'GET /v2/users/42'",
      "Header versioning: 'Accept: application/vnd.myapi.v2+json'",
      "Query parameter versioning: 'GET /users/42?version=2'",
      "Sunset-based deprecation with a 'Sunset' response header"
    ],
    answer: 1,
    explain: "Header versioning uses the 'Accept' header with a vendor MIME type to select the API version. The URL remains stable (identifying the resource), while the header selects the representation. This is semantically correct but harder to test in a browser compared to URL path versioning."
  }
]);

registerResources("16-pagination-filtering", [
  { title: "RFC 9110: HTTP range and pagination semantics", url: "https://www.rfc-editor.org/rfc/rfc9110" },
  { title: "Stripe API: cursor-based pagination", url: "https://stripe.com/docs/api/pagination" },
  { title: "GitHub REST API: pagination", url: "https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api" },
  { title: "RFC 8594: The Sunset HTTP Header Field", url: "https://www.rfc-editor.org/rfc/rfc8594" },
  { title: "MDN: HTTP 429 Too Many Requests", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429" }
]);

registerQuiz("16-validation-openapi", [
  {
    q: "What is the key difference between 'z.parse()' and 'z.safeParse()' in Zod, and which should you use at an API boundary?",
    options: [
      "'z.parse()' validates asynchronously; 'z.safeParse()' validates synchronously — use 'z.parse()' in route handlers",
      "'z.parse()' throws a ZodError on failure; 'z.safeParse()' returns a result object — use 'z.safeParse()' at API boundaries to return a proper 400 response",
      "Both methods behave identically; the choice is purely stylistic",
      "'z.parse()' only validates strings; 'z.safeParse()' validates any type"
    ],
    answer: 1,
    explain: "'z.parse()' throws a ZodError if validation fails, which without a try/catch results in an unhandled exception and a generic 500 response. 'z.safeParse()' returns '{ success, data }' or '{ success: false, error }', letting you return a well-formed 400 with structured error details."
  },
  {
    q: "Why should you use 'z.coerce.number()' rather than 'z.number()' when validating HTTP query parameters?",
    options: [
      "Because 'z.number()' is slower for large numbers",
      "Because HTTP query parameters arrive as strings, and 'z.coerce.number()' automatically converts '\"20\"' to the number 20",
      "Because 'z.coerce.number()' also validates that the value is a positive integer",
      "Because Zod does not support 'z.number()' in Node.js environments"
    ],
    answer: 1,
    explain: "All HTTP query parameters are strings by default. 'z.number()' would reject '\"20\"' as not a number. 'z.coerce.number()' converts the string '\"20\"' to the number 20 before validating, making it the correct choice for query string and path parameter validation."
  },
  {
    q: "What is the benefit of generating an OpenAPI document from your Zod schemas rather than writing OpenAPI YAML by hand?",
    options: [
      "Zod-generated OpenAPI documents are compressed and load faster",
      "Hand-written OpenAPI YAML supports more features than generated documents",
      "The generated document is always in sync with your runtime validation logic, eliminating drift between docs and implementation",
      "Generated OpenAPI documents automatically include authentication configuration"
    ],
    answer: 2,
    explain: "Hand-written OpenAPI YAML drifts from the implementation as the codebase evolves. Generating the OpenAPI document from the same Zod schemas used for runtime validation means docs and behavior are always identical — it is structurally impossible for them to diverge."
  }
]);

registerResources("16-validation-openapi", [
  { title: "Zod official documentation", url: "https://zod.dev/" },
  { title: "OpenAPI Specification 3.1.0", url: "https://spec.openapis.org/oas/v3.1.0" },
  { title: "@asteasolutions/zod-to-openapi on npm", url: "https://www.npmjs.com/package/@asteasolutions/zod-to-openapi" },
  { title: "Swagger UI on npm", url: "https://www.npmjs.com/package/swagger-ui-express" },
  { title: "openapi-typescript code generator", url: "https://openapi-ts.dev/" }
]);
