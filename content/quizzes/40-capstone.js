registerQuiz("40-designing-for-scale", [
  {
    q: "What is the primary purpose of an Architecture Decision Record (ADR)?",
    options: [
      "To replace unit tests with documented design intent",
      "To record what decision was made and, crucially, why it was made — so future engineers can evaluate whether the reasoning still applies",
      "To serve as the official project specification for all feature requirements",
      "To document the deployment runbook for a given service"
    ],
    answer: 1,
    explain: "ADRs capture the context, decision, and consequences of a significant architecture choice. Future engineers need the 'why' to know whether to keep, revisit, or supersede a decision as circumstances change. Storing ADRs in the repo keeps them versioned alongside the code they describe."
  },
  {
    q: "In the principal engineering mindset, what is a 'constraint' as distinct from a 'requirement'?",
    options: [
      "A constraint is a feature the system must implement; a requirement is a non-functional property",
      "A requirement is what the system must do; a constraint is the envelope within which it must do it (budget, latency SLA, team size, compliance)",
      "Constraints apply only to infrastructure; requirements apply only to application code",
      "They are synonymous terms for the same concept"
    ],
    answer: 1,
    explain: "A requirement states what the system must do. A constraint is the bounded envelope within which it must operate — budget, latency SLA, team size, timeline, compliance regulations. Confusing requirements with constraints is a primary source of architecture regret, as it prevents reviewers from challenging each layer independently."
  },
  {
    q: "In a weighted decision matrix, what does it mean when changing a single criterion's weight flips the ranking between two options?",
    options: [
      "The matrix is broken and needs to be recalculated",
      "One option is clearly superior and should be selected immediately",
      "That criterion is a key assumption driving the decision — the team should explicitly agree on its weight before trusting the result",
      "Both options should be rejected and new alternatives found"
    ],
    answer: 2,
    explain: "A ranking flip when one weight changes reveals which assumption is load-bearing for the decision. The matrix's value is not the final score but the conversation it forces: teams must agree on what matters most before debating which option is better. This surfaces hidden disagreements early."
  }
]);

registerResources("40-designing-for-scale", [
  { title: "ADR: Architecture Decision Records (Michael Nygard format)", url: "https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions" },
  { title: "adr-tools: command-line tool for working with ADRs", url: "https://github.com/npryce/adr-tools" },
  { title: "Martin Fowler: Architecture Decision Records", url: "https://martinfowler.com/articles/scaling-architecture-conversationally.html" },
  { title: "The Twelve-Factor App: methodology for scalable services", url: "https://12factor.net/" }
]);

registerQuiz("40-capstone-framework", [
  {
    q: "In the onion (Koa-style) middleware model, what does calling 'next()' inside a middleware do?",
    options: [
      "It skips all remaining middlewares and sends the response immediately",
      "It passes control to the next middleware in the chain; code after 'await next()' runs after all inner middlewares have completed",
      "It re-runs the current middleware from the beginning",
      "It registers a new middleware to be added to the end of the chain"
    ],
    answer: 1,
    explain: "next() is a reference to the composed remainder of the middleware chain. Awaiting it descends into inner layers; code written after 'await next()' executes during the return journey, giving each middleware both a before-phase and an after-phase around the entire inner chain."
  },
  {
    q: "Why does a parametric router convert path templates like '/users/:id' into regular expressions at registration time rather than at match time?",
    options: [
      "Because regular expressions cannot be created dynamically at runtime",
      "To ensure each route is registered exactly once and matching is O(depth) per request rather than recompiling the pattern on every request",
      "Because path parameters must be validated before the server starts",
      "To prevent route conflicts from being registered after the server is running"
    ],
    answer: 1,
    explain: "Compiling path templates to regular expressions at registration time means each request pays only the cost of running pre-compiled regexes, not recompiling patterns. This is how production routers like Express and Fastify achieve efficient matching regardless of route count."
  },
  {
    q: "What is the critical mistake to avoid when building a context object in a web framework?",
    options: [
      "Putting request-scoped data on the context",
      "Using a plain object instead of a class instance for the context",
      "Reusing or pooling context objects across requests — mutations from one request bleed into another",
      "Adding convenience methods like ctx.json() to the context"
    ],
    answer: 2,
    explain: "Each request must get a fresh context object. If you reuse or pool context instances across requests without resetting every field, one request's mutations (status codes, response bodies, auth data) can bleed into an unrelated request, causing data leaks and incorrect behaviour."
  }
]);

registerResources("40-capstone-framework", [
  { title: "Koa.js: middleware composition model", url: "https://koajs.com/" },
  { title: "Fastify: plugin and hook architecture", url: "https://fastify.dev/docs/latest/Reference/Plugins/" },
  { title: "Hono: lightweight Web-standard framework", url: "https://hono.dev/docs/" },
  { title: "Node.js: http module (raw server)", url: "https://nodejs.org/api/http.html" },
  { title: "Fastify: benchmarks and performance", url: "https://fastify.dev/benchmarks/" }
]);

registerQuiz("40-capstone-platform", [
  {
    q: "Why does a scaled WebSocket platform use Redis Pub/Sub for cross-node message delivery rather than direct node-to-node TCP connections?",
    options: [
      "Redis Pub/Sub is faster than TCP for all message types",
      "Direct TCP connections require static IP addresses which change during scaling",
      "Redis Pub/Sub decouples nodes: any node publishes to a channel and every subscribed node receives it, with no need for nodes to know about each other",
      "Redis Pub/Sub provides at-least-once delivery guarantees needed for WebSocket messages"
    ],
    answer: 2,
    explain: "With Redis Pub/Sub, each WebSocket node subscribes to room channels. When node 1 receives a message for room X, it publishes to Redis; every other node subscribed to room X instantly receives it and delivers to local clients. Nodes require no knowledge of each other's addresses, making horizontal scaling transparent."
  },
  {
    q: "When should a persistence worker send XACK to Redis Streams, relative to writing the event to PostgreSQL?",
    options: [
      "Before the database write, to release the message quickly",
      "After the database write succeeds, so a crash before the write results in redelivery rather than silent data loss",
      "In parallel with the database write to maximise throughput",
      "Only after the entire batch of messages has been written"
    ],
    answer: 1,
    explain: "Acknowledging with XACK before the DB write means a crash between ACK and write silently loses the event. ACKing after a successful write guarantees at-least-once delivery: if the worker crashes mid-write, the message is redelivered and the idempotent write (using the Stream ID as a deduplication key) handles it safely."
  },
  {
    q: "What is the correct way to manage Redis Pub/Sub subscriptions on a WebSocket node to avoid exhausting the connection's subscription limit?",
    options: [
      "Subscribe to a room channel on every incoming message for that room",
      "Subscribe once per room when the first client joins, and unsubscribe when the last client leaves the room",
      "Create a new Redis connection for each room subscription",
      "Use a single wildcard subscription for all rooms and filter client-side"
    ],
    answer: 1,
    explain: "Subscribing inside the message handler would add a new subscription on every message, quickly exhausting Redis's per-connection subscription limit. The correct pattern is to subscribe once when the first client joins a room (tracked in a Set) and unsubscribe when the room becomes empty."
  }
]);

registerResources("40-capstone-platform", [
  { title: "Redis: Pub/Sub documentation", url: "https://redis.io/docs/latest/develop/interact/pubsub/" },
  { title: "Redis: Streams and consumer groups", url: "https://redis.io/docs/latest/develop/data-types/streams/" },
  { title: "ws: Node.js WebSocket library", url: "https://github.com/websockets/ws" },
  { title: "OpenTelemetry: JavaScript SDK", url: "https://opentelemetry.io/docs/languages/js/" },
  { title: "Socket.IO: Redis adapter for horizontal scaling", url: "https://socket.io/docs/v4/redis-adapter/" }
]);

registerQuiz("40-capstone-engine", [
  {
    q: "Why does a production job engine use Redis for the queue but PostgreSQL for job history?",
    options: [
      "Redis is required for BullMQ; PostgreSQL is only needed for compliance",
      "Redis provides O(1) blocking pop for low-latency dequeuing; PostgreSQL provides durable, queryable history with rich indexes for dashboards and audit trails",
      "PostgreSQL cannot handle the write throughput of a job queue",
      "Redis supports transactions while PostgreSQL does not"
    ],
    answer: 1,
    explain: "Redis sorted sets and lists provide O(1) BRPOPLPUSH and ZRANGEBYSCORE operations ideal for fast job dequeuing. PostgreSQL's durability and rich query language (JOINs, indexes, aggregations) make it the right store for job history, audit logs, and dashboard queries. Use the right tool for each access pattern."
  },
  {
    q: "In a DAG workflow scheduler, what algorithm property determines the order in which jobs become eligible to run?",
    options: [
      "The alphabetical order of job IDs",
      "The creation timestamp of each job",
      "The in-degree count: a job becomes ready when all its dependencies complete, reducing its in-degree to zero",
      "The priority score assigned at workflow submission time"
    ],
    answer: 2,
    explain: "The scheduler tracks an in-degree count for each node — the number of unfinished dependencies. Jobs with in-degree 0 are immediately ready. When a job completes, it decrements the in-degree of each dependent; any that reach 0 are added to the ready queue. This is topological ordering."
  },
  {
    q: "What problem does exponential backoff with full jitter solve when retrying failed jobs after a system-wide outage?",
    options: [
      "It prevents jobs from being retried more than the configured maximum",
      "It ensures jobs are retried in the order they originally failed",
      "It prevents the thundering herd: without jitter all retrying jobs pile onto the queue simultaneously after the outage clears, potentially causing a second overload",
      "It reduces the number of retry attempts needed by increasing delay predictably"
    ],
    answer: 2,
    explain: "After an outage, all failed jobs would retry at roughly the same time with pure exponential backoff (e.g. all at t+4s). Full jitter randomises the delay within the exponential window, spreading retries across time and preventing the thundering herd that could cause a second failure."
  }
]);

registerResources("40-capstone-engine", [
  { title: "BullMQ: job queues for Node.js", url: "https://docs.bullmq.io/" },
  { title: "Redis: BRPOPLPUSH command for reliable queues", url: "https://redis.io/docs/latest/commands/brpoplpush/" },
  { title: "AWS Architecture Blog: Exponential Backoff And Jitter", url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/" },
  { title: "Temporal: durable workflow orchestration", url: "https://temporal.io/docs" },
  { title: "KEDA: Kubernetes Event-driven Autoscaling", url: "https://keda.sh/docs/" }
]);
