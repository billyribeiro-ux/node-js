registerQuiz("29-boundaries", [
  {
    q: "According to Domain-Driven Design, what is a 'bounded context' and why is it useful for finding service boundaries?",
    options: [
      "A bounded context is a hard limit on the number of database tables a service can own",
      "A bounded context is a subsystem where a single coherent domain model applies; service boundaries should follow where the meaning of domain terms diverges between teams",
      "A bounded context is a deployment unit restricted to one geographic region",
      "A bounded context defines the maximum API surface area a microservice is allowed to expose"
    ],
    answer: 1,
    explain: "In DDD, a bounded context is a boundary within which a single consistent domain model is valid. The same word (like 'order') may mean something different in Inventory vs Payments vs Shipping. Placing a service boundary where these meanings diverge ensures each service owns a coherent model and minimises cross-service coordination."
  },
  {
    q: "What is the key risk introduced by long synchronous call chains across multiple services?",
    options: [
      "Synchronous calls always use more bandwidth than asynchronous events",
      "End-to-end latency is the sum of all downstream latencies, and end-to-end availability is the product of all service uptime percentages, both of which degrade rapidly with chain length",
      "Synchronous calls require all services to share the same database",
      "Long chains prevent the use of HTTP/2, forcing all traffic onto HTTP/1.1"
    ],
    answer: 1,
    explain: "In a synchronous chain A->B->C->D, latency = sum of all hops, and availability = product of all uptime rates (e.g., 0.99^4 = 96.1%). Every added synchronous dependency multiplies the failure probability and adds its latency to the critical path. Async communication breaks this coupling where results are not needed immediately."
  },
  {
    q: "What is the difference between 'client-side discovery' and 'server-side discovery' in service registry patterns?",
    options: [
      "Client-side discovery uses DNS; server-side discovery uses HTTP headers",
      "In client-side discovery the caller queries the registry and selects an instance with load-balancing logic; in server-side discovery a load balancer queries the registry and forwards the request transparently",
      "Client-side discovery only works in development; server-side discovery is for production",
      "Server-side discovery requires the service to run on the same machine as the registry"
    ],
    answer: 1,
    explain: "With client-side discovery, the calling service directly queries a service registry to get available instances and applies its own load-balancing algorithm. With server-side discovery, the caller sends requests to a smart load balancer that internally queries the registry and routes the request, hiding the complexity from the caller."
  }
]);

registerResources("29-boundaries", [
  { title: "Martin Fowler: Bounded Context", url: "https://martinfowler.com/bliki/BoundedContext.html" },
  { title: "Martin Fowler: Microservices", url: "https://martinfowler.com/articles/microservices.html" },
  { title: "Martin Fowler: Strangler Fig Application", url: "https://martinfowler.com/bliki/StranglerFigApplication.html" },
  { title: "Domain-Driven Design (DDD) reference", url: "https://www.domainlanguage.com/ddd/reference/" },
  { title: "API gateway pattern (microservices.io)", url: "https://microservices.io/patterns/apigateway.html" }
]);

registerQuiz("29-resilience", [
  {
    q: "In the circuit breaker state machine, what happens during the HALF-OPEN state?",
    options: [
      "All incoming requests are queued until the downstream recovers",
      "A single probe request is allowed through; if it succeeds the circuit closes, if it fails the circuit opens again and the reset timer restarts",
      "The circuit randomly allows 50% of requests through to test recovery",
      "All requests fail fast and the circuit logs a warning every 10 seconds"
    ],
    answer: 1,
    explain: "After the reset timeout in OPEN state, the circuit moves to HALF-OPEN to test whether the downstream has recovered. A single probe call is allowed through. Success closes the circuit and resumes normal traffic. Failure reopens the circuit and restarts the reset timer, preventing load on a still-broken downstream."
  },
  {
    q: "What is a 'bulkhead' pattern in the context of resilient service design?",
    options: [
      "A technique for encrypting traffic between services",
      "Isolating resource pools (connections, thread slots) per downstream so one slow dependency cannot exhaust shared capacity needed by other unrelated calls",
      "A queue that buffers requests when the downstream circuit is open",
      "A load-balancing strategy that routes requests away from slow instances"
    ],
    answer: 1,
    explain: "Named after watertight ship compartments, bulkheads give each downstream its own dedicated resource pool (connection pool, worker queue) with a hard cap. If payments-service becomes slow and drains its 10 connections, the inventory-service pool of 20 connections is unaffected, containing the blast radius."
  },
  {
    q: "Why should retry logic only attempt operations marked as transient, not all errors?",
    options: [
      "Transient errors are faster to retry because they require fewer network round-trips",
      "Retrying permanent errors (like a 400 Bad Request or validation failure) wastes resources, delays surfacing bugs, and can cause harmful side effects like double charges",
      "Permanent errors cause the circuit breaker to open immediately, preventing any retry attempt",
      "The HTTP spec forbids retrying 4xx responses"
    ],
    answer: 1,
    explain: "Permanent errors (invalid payload, card declined, 404 not found) will fail identically on every retry. Retrying them wastes compute, delays the caller's error response, and for non-idempotent operations can duplicate side effects. Classification via error type or HTTP status code lets the retry wrapper skip retries for permanent failures."
  }
]);

registerResources("29-resilience", [
  { title: "Circuit breaker pattern (microservices.io)", url: "https://microservices.io/patterns/reliability/circuit-breaker.html" },
  { title: "Martin Fowler: Circuit Breaker", url: "https://martinfowler.com/bliki/CircuitBreaker.html" },
  { title: "AWS: Exponential Backoff and Jitter", url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/" },
  { title: "Bulkhead pattern (Azure architecture docs)", url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead" },
  { title: "Retry pattern (Azure architecture docs)", url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/retry" }
]);

registerQuiz("29-sagas", [
  {
    q: "What is a compensating transaction in the context of the saga pattern?",
    options: [
      "A database rollback that undoes all changes in a saga atomically",
      "New business logic that produces the logical opposite of a completed step, used to undo its effect when a later step fails",
      "An automatic retry of a failed step with a longer timeout",
      "A transaction that compensates for network latency by pre-fetching data"
    ],
    answer: 1,
    explain: "A compensating transaction is not a DB rollback; it is new application code that reverses the logical effect of a completed step (e.g., releasing a reservation, issuing a refund). It must be explicitly designed for each step because some operations (like sending an email) cannot be fully reversed."
  },
  {
    q: "What is the key difference between saga choreography and saga orchestration?",
    options: [
      "Choreography uses gRPC; orchestration uses REST",
      "In choreography each service reacts to events independently with no central coordinator; in orchestration a central saga coordinator explicitly tells each service what to do and manages compensations",
      "Choreography only supports two-step sagas; orchestration supports unlimited steps",
      "Orchestration always uses two-phase commit; choreography does not"
    ],
    answer: 1,
    explain: "In choreography, services emit and react to domain events with no single service knowing the full workflow. In orchestration, a dedicated saga coordinator holds the complete step sequence, issues commands to each service, and drives compensation when a step fails. Orchestration trades decoupling for visibility and easier debugging of complex flows."
  },
  {
    q: "What problem does the outbox pattern solve in event-driven microservices?",
    options: [
      "It prevents duplicate events from being published when a service restarts",
      "It atomically pairs a database write with an outgoing event publication by writing both to the same DB transaction, so an event is never silently lost if the service crashes between the two operations",
      "It buffers events in memory to improve throughput before batch-publishing to the broker",
      "It ensures events are delivered in strict FIFO order across all services"
    ],
    answer: 1,
    explain: "Without the outbox pattern, writing to the DB and publishing an event are two separate I/O operations. A crash between them leaves the system in an inconsistent state: the DB is updated but the event never fires (or vice versa). The outbox writes both to the same DB transaction, then a relay process publishes from the outbox to the broker, guaranteeing at-least-once delivery."
  }
]);

registerResources("29-microservices", [
  { title: "Saga pattern (microservices.io)", url: "https://microservices.io/patterns/data/saga.html" },
  { title: "Transactional outbox pattern (microservices.io)", url: "https://microservices.io/patterns/data/transactional-outbox.html" },
  { title: "Martin Fowler: Saga", url: "https://martinfowler.com/articles/patterns-of-distributed-systems/saga.html" },
  { title: "Compensating transactions pattern (Azure)", url: "https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction" },
  { title: "Idempotent consumer pattern (microservices.io)", url: "https://microservices.io/patterns/communication-style/idempotent-consumer.html" }
]);
