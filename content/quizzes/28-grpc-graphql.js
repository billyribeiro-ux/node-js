registerQuiz("28-grpc", [
  {
    q: "In a Protocol Buffer schema, why are field numbers more important to preserve than field names?",
    options: [
      "Field names are stored in the binary payload, but field numbers are not",
      "Field numbers identify fields in the binary encoding; renaming a field is safe, but changing a field number silently corrupts messages from old clients",
      "Field numbers determine the order in which fields are encoded, affecting compression",
      "Field numbers are required to generate gRPC client stubs; names are optional"
    ],
    answer: 1,
    explain: "Protobuf encodes fields by their number, not their name. Changing a field number means old clients that send the old number will have their data parsed as an unknown or different field. Field names can be safely renamed because they are not present in the binary wire format."
  },
  {
    q: "Which gRPC call type should you use when a client needs to upload a batch of log entries and receive a single summary response?",
    options: [
      "Unary RPC",
      "Server-streaming RPC",
      "Client-streaming RPC",
      "Bidirectional streaming RPC"
    ],
    answer: 2,
    explain: "Client-streaming RPC lets the client send a stream of messages to the server and receive a single response when the stream ends. This is ideal for bulk uploads, log ingestion, and telemetry batching where the client produces many records and the server replies once with an aggregated result."
  },
  {
    q: "Why are deadlines considered mandatory on every gRPC call?",
    options: [
      "gRPC connections are automatically closed after 30 seconds without a deadline",
      "Without a deadline a slow or hanging downstream can hold the event loop indefinitely, cascading latency through the entire call chain",
      "Deadlines are required by the gRPC protocol spec and cause a compile error if omitted",
      "Deadlines enable the client-side load balancer to route requests to faster servers"
    ],
    answer: 1,
    explain: "A gRPC call without a deadline can block forever if the server hangs, draining connection pool slots and causing latency to cascade to the caller's own clients. Every call should carry a deadline so that the system fails fast and recovers gracefully rather than accumulating unbounded wait time."
  }
]);

registerResources("28-grpc", [
  { title: "gRPC documentation", url: "https://grpc.io/docs/" },
  { title: "Protocol Buffers language guide (proto3)", url: "https://protobuf.dev/programming-guides/proto3/" },
  { title: "@grpc/grpc-js Node.js package", url: "https://github.com/grpc/grpc-node/tree/master/packages/grpc-js" },
  { title: "gRPC core concepts", url: "https://grpc.io/docs/what-is-grpc/core-concepts/" },
  { title: "Protobuf encoding reference", url: "https://protobuf.dev/programming-guides/encoding/" }
]);

registerQuiz("28-graphql", [
  {
    q: "What is the N+1 query problem in GraphQL?",
    options: [
      "A schema with N types requiring N+1 resolver functions to compile",
      "Fetching a list of N parent objects triggers N separate DB queries for their related child data, resulting in N+1 total queries instead of 2",
      "A query that exceeds N+1 nesting levels causes a stack overflow in the resolver engine",
      "N+1 refers to the overhead of one extra HTTP round-trip for schema introspection"
    ],
    answer: 1,
    explain: "When a list resolver returns N parent objects and each parent's child resolver runs a separate DB query, you get 1 query for the list plus N queries for the children. With 100 parents that is 101 queries where 2 (one list, one IN query) would suffice. DataLoader solves this by batching all N child lookups into a single query."
  },
  {
    q: "Why must DataLoader instances be created inside the per-request context factory rather than at server startup?",
    options: [
      "DataLoader requires access to the HTTP request headers to function correctly",
      "A singleton DataLoader caches values across requests, causing data from one user's request to appear in another user's response",
      "GraphQL servers do not support module-level singletons",
      "DataLoader's batch function can only be called once per instance"
    ],
    answer: 1,
    explain: "DataLoader caches results by key for the lifetime of the object. A server-level singleton DataLoader would serve cached results from previous requests to new requests, leaking data across users and returning stale values. Creating a fresh DataLoader per request ensures the cache is scoped to that request's lifecycle only."
  },
  {
    q: "In the GraphQL resolver function signature '(parent, args, context, info)', what does 'parent' represent?",
    options: [
      "The root Query type schema definition",
      "The resolved value of the parent object in the query tree, passed down from the parent resolver",
      "The HTTP request object from the underlying server",
      "The parent namespace of the current schema type"
    ],
    answer: 1,
    explain: "The 'parent' argument (also called 'root' or 'source') is the value returned by the resolver of the field's parent type. For example, in a User.posts resolver, parent is the user object returned by Query.user. Root-level Query resolvers receive undefined as parent."
  }
]);

registerResources("28-graphql", [
  { title: "GraphQL specification", url: "https://spec.graphql.org/" },
  { title: "GraphQL.js documentation", url: "https://graphql.org/graphql-js/" },
  { title: "DataLoader library", url: "https://github.com/graphql/dataloader" },
  { title: "Apollo Server documentation", url: "https://www.apollographql.com/docs/apollo-server/" },
  { title: "GraphQL Schema Definition Language (SDL)", url: "https://graphql.org/learn/schema/" }
]);

registerQuiz("28-api-tradeoffs", [
  {
    q: "Why is REST the superior choice for a public API that must be cached by a CDN?",
    options: [
      "REST uses smaller payloads than gRPC, reducing CDN storage costs",
      "REST GET requests with stable URLs map directly to HTTP cache semantics that CDNs understand natively",
      "REST does not require a schema, which CDNs cannot parse",
      "gRPC and GraphQL are blocked by most CDN providers"
    ],
    answer: 1,
    explain: "CDNs cache HTTP responses by URL and cache-control headers. REST GET /products/42 can be cached transparently. gRPC uses POST-like HTTP/2 with binary bodies that CDNs cannot cache meaningfully, and GraphQL typically uses POST to a single endpoint with varying request bodies, bypassing CDN caching by default."
  },
  {
    q: "In a dual-exposure architecture, why is gRPC preferred for internal service-to-service calls while GraphQL serves external clients?",
    options: [
      "gRPC is only available inside private networks; GraphQL works over the public internet",
      "gRPC offers binary encoding and HTTP/2 multiplexing for high-throughput low-latency internal calls, while GraphQL gives external clients flexible field selection without over-fetching",
      "gRPC does not support authentication, so it is only safe internally",
      "GraphQL requires a browser client, which is only available to external users"
    ],
    answer: 1,
    explain: "Internal service calls benefit from gRPC's protobuf binary encoding (3-10x smaller than JSON), HTTP/2 multiplexing, and strict typed contracts. External clients benefit from GraphQL's ability to request exactly the fields they need, eliminating over-fetching and reducing payload sizes without requiring protocol knowledge."
  },
  {
    q: "Which API style provides first-class support for four types of streaming (unary, server, client, bidirectional)?",
    options: [
      "REST with Server-Sent Events",
      "GraphQL with subscriptions",
      "gRPC over HTTP/2",
      "REST with chunked transfer encoding"
    ],
    answer: 2,
    explain: "gRPC natively defines four call types in the .proto schema: unary (one request, one response), server-streaming, client-streaming, and bidirectional streaming. These are first-class protocol features, not workarounds. REST and GraphQL support some push patterns (SSE, subscriptions) but lack the symmetry and protocol-level efficiency of gRPC streaming."
  }
]);

registerResources("28-api-tradeoffs", [
  { title: "gRPC vs REST (gRPC docs)", url: "https://grpc.io/docs/what-is-grpc/faq/" },
  { title: "GraphQL vs REST (GraphQL.org)", url: "https://graphql.org/faq/graphql-vs-rest/" },
  { title: "Apollo Router (GraphQL gateway)", url: "https://www.apollographql.com/docs/router/" },
  { title: "Automatic Persisted Queries (Apollo)", url: "https://www.apollographql.com/docs/apollo-server/performance/apq/" },
  { title: "gRPC-Web for browser clients", url: "https://grpc.io/docs/platforms/web/" }
]);
