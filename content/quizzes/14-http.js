registerQuiz("14-http-server", [
  {
    q: "What type of objects does the 'http.createServer' callback receive for every incoming request?",
    options: [
      "A net.Socket and a Buffer containing the raw HTTP bytes",
      "An http.IncomingMessage (readable stream) and an http.ServerResponse (writable stream)",
      "A plain object with 'method', 'url', and 'body' properties",
      "An EventEmitter and a callback function"
    ],
    answer: 1,
    explain: "'http.createServer' passes two objects to its callback: 'req' (an http.IncomingMessage, a readable stream carrying request data) and 'res' (an http.ServerResponse, a writable stream you send the response through)."
  },
  {
    q: "Why is it recommended to pipe a readable file stream directly into 'res' rather than reading the whole file into memory first?",
    options: [
      "Piping is required by the HTTP spec for binary files",
      "Piping keeps memory usage flat regardless of file size, avoiding OOM errors on large payloads",
      "The 'fs.readFile' API cannot be used in HTTP servers",
      "Piping automatically sets the correct Content-Type header"
    ],
    answer: 1,
    explain: "Buffering an entire large file into memory before sending risks OOM errors and high first-byte latency. Piping a Readable directly to 'res' streams data in fixed-size chunks, keeping memory usage constant regardless of file size."
  },
  {
    q: "When making an outbound POST request with 'http.request', what must you do after writing the request body?",
    options: [
      "Call 'req.flush()' to send buffered data",
      "Set 'req.body = null' to signal completion",
      "Call 'req.end()' to finalize and send the request",
      "Call 'req.destroy()' to close the connection"
    ],
    answer: 2,
    explain: "With 'http.request', you write the body with 'req.write(payload)' and then MUST call 'req.end()' to signal that the request is complete. Without 'req.end()', the request is never sent and the server never receives it."
  }
]);

registerResources("14-http-server", [
  { title: "Node.js docs: http module", url: "https://nodejs.org/api/http.html" },
  { title: "Node.js docs: http.IncomingMessage", url: "https://nodejs.org/api/http.html#class-httpincomingmessage" },
  { title: "Node.js docs: http.ServerResponse", url: "https://nodejs.org/api/http.html#class-httpserverresponse" },
  { title: "MDN: HTTP status codes", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status" },
  { title: "Node.js docs: stream.pipe", url: "https://nodejs.org/api/stream.html#readablepipedestination-options" }
]);

registerQuiz("14-fetch-undici", [
  {
    q: "What happens when you 'await fetch(url)' and the server responds with a 404 status code?",
    options: [
      "The promise rejects with a TypeError",
      "The promise rejects with an HTTP error object containing the status code",
      "The promise resolves successfully; you must check 'response.ok' to detect the error",
      "The promise resolves only if the status is 2xx, otherwise it rejects"
    ],
    answer: 2,
    explain: "'fetch' only rejects on network-level failures (DNS, connection refused). Any HTTP response — even 4xx or 5xx — resolves the promise. You must check 'response.ok' (true for 200-299) or 'response.status' to detect HTTP errors."
  },
  {
    q: "How do you cancel a 'fetch' request after 5 seconds using the simplest available API?",
    options: [
      "Pass '{ timeout: 5000 }' in the options object",
      "Use 'Promise.race([fetch(url), new Promise(r => setTimeout(r, 5000))])'",
      "Pass '{ signal: AbortSignal.timeout(5000) }' in the options object",
      "Call 'response.cancel()' after the promise resolves"
    ],
    answer: 2,
    explain: "'AbortSignal.timeout(ms)' creates a signal that automatically aborts after the given duration. Passing it as '{ signal: AbortSignal.timeout(5000) }' causes the fetch to throw a 'TimeoutError' if the response has not arrived within 5 seconds."
  },
  {
    q: "What advantage does 'undici.Pool' provide over making individual 'fetch' calls to the same origin?",
    options: [
      "It automatically retries failed requests with exponential backoff",
      "It keeps TCP/TLS connections alive and reuses them across requests, avoiding repeated handshake overhead",
      "It compresses all request and response bodies automatically",
      "It caches responses in memory to avoid duplicate network round-trips"
    ],
    answer: 1,
    explain: "Each individual 'fetch' to an HTTPS origin opens a new TLS connection, which involves a TCP handshake plus a TLS handshake. An 'undici.Pool' maintains a pool of persistent connections, amortising that overhead across many requests."
  }
]);

registerResources("14-fetch-undici", [
  { title: "Node.js docs: Fetch API (global fetch)", url: "https://nodejs.org/api/globals.html#fetch" },
  { title: "MDN: Using the Fetch API", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch" },
  { title: "undici documentation (Node HTTP client)", url: "https://undici.nodejs.org/" },
  { title: "MDN: AbortController and AbortSignal", url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController" },
  { title: "MDN: Response interface", url: "https://developer.mozilla.org/en-US/docs/Web/API/Response" }
]);

registerQuiz("14-https-http2", [
  {
    q: "What does ALPN (Application-Layer Protocol Negotiation) allow a TLS client and server to do?",
    options: [
      "Negotiate the cipher suite to use for encryption",
      "Agree on the application protocol (such as 'h2' or 'http/1.1') inside the TLS handshake at zero extra round trips",
      "Exchange certificate chains before the handshake begins",
      "Upgrade an HTTP/1.1 connection to HTTP/2 after the handshake"
    ],
    answer: 1,
    explain: "ALPN is a TLS extension that lets the client advertise a list of supported application protocols in 'ClientHello'. The server picks one and includes it in its reply — the protocol is agreed upon within the existing handshake, costing no extra round trips."
  },
  {
    q: "How does HTTP/2 multiplexing eliminate the head-of-line blocking problem present in HTTP/1.1?",
    options: [
      "HTTP/2 opens one TCP connection per resource, just like browsers do with HTTP/1.1",
      "HTTP/2 sends all resources in a single large response body",
      "HTTP/2 uses independent binary-framed streams on one TCP connection, so one slow response does not block others",
      "HTTP/2 uses UDP instead of TCP to avoid ordering constraints"
    ],
    answer: 2,
    explain: "HTTP/2 introduces a binary framing layer with independent stream IDs. Multiple requests and responses are interleaved on one TCP connection as frames. A slow stream does not hold up faster ones, unlike HTTP/1.1 where responses must arrive in order on each connection."
  },
  {
    q: "When creating an HTTPS server with 'node:https', what property of the options object must never be shared publicly?",
    options: [
      "cert (the public certificate)",
      "ca (the certificate authority chain)",
      "key (the private key)",
      "passphrase (the key password)"
    ],
    answer: 2,
    explain: "The 'key' property holds the server's private key. If it is exposed, an attacker can impersonate the server, decrypt past TLS sessions (if forward secrecy is not used), and perform man-in-the-middle attacks. The 'cert' is public by design."
  }
]);

registerResources("14-https-http2", [
  { title: "Node.js docs: https module", url: "https://nodejs.org/api/https.html" },
  { title: "Node.js docs: http2 module", url: "https://nodejs.org/api/http2.html" },
  { title: "Node.js docs: tls module", url: "https://nodejs.org/api/tls.html" },
  { title: "MDN: TLS (Transport Layer Security)", url: "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security" },
  { title: "RFC 7301: TLS Application-Layer Protocol Negotiation (ALPN)", url: "https://www.rfc-editor.org/rfc/rfc7301" }
]);

registerQuiz("14-tiny-framework", [
  {
    q: "In the onion model middleware pattern, what happens to code written AFTER 'await next()' in a middleware function?",
    options: [
      "It runs before the route handler executes",
      "It is ignored because 'next()' terminates the pipeline",
      "It runs after all inner middleware and the route handler have completed, on the way out",
      "It runs only if the route handler throws an error"
    ],
    answer: 2,
    explain: "Calling 'await next()' passes control inward to the next layer. When that layer (and everything it calls) finishes, execution resumes at the line after 'await next()'. This gives each middleware a before phase (before the call) and an after phase (after the call returns)."
  },
  {
    q: "How does a Router convert a path pattern like '/users/:id' into something that can match real URLs?",
    options: [
      "It splits on '/' and compares each segment with strict equality",
      "It compiles the pattern into a regular expression with named capture groups for each ':param' segment",
      "It stores the pattern in a Map and does a direct string lookup",
      "It delegates matching to the 'node:path' module's 'matchesGlob' function"
    ],
    answer: 1,
    explain: "The ':param' syntax is converted to a named capture group in a regex, for example '/users/:id' becomes the regex '/users/(?<id>[^/]+)'. When a URL is tested against the regex, 'match.groups' provides the extracted parameter values."
  },
  {
    q: "Why must a top-level try/catch wrap the entire composed middleware pipeline in the HTTP request handler?",
    options: [
      "Because 'http.createServer' does not propagate async errors automatically",
      "To prevent Node from converting uncaught errors into process crashes",
      "So that any error thrown in any middleware layer reaches a single error handler and the client receives a proper error response instead of hanging",
      "Because Express requires it for compatibility"
    ],
    answer: 2,
    explain: "If a middleware or route handler throws and nothing catches it, the client's request hangs forever with no response. A top-level try/catch around the 'await pipeline(ctx)' call ensures every thrown error — from any layer — is caught and turned into a well-formed HTTP error response."
  }
]);

registerResources("14-tiny-framework", [
  { title: "Node.js docs: http module", url: "https://nodejs.org/api/http.html" },
  { title: "Koa.js source: compose middleware", url: "https://github.com/koajs/compose" },
  { title: "Express.js source code on GitHub", url: "https://github.com/expressjs/express" },
  { title: "MDN: URL.searchParams", url: "https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams" },
  { title: "Node.js docs: URL class", url: "https://nodejs.org/api/url.html#class-url" }
]);
