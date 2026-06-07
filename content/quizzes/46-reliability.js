// Module 46 — Reliability, SLOs & Capacity Engineering

registerQuiz("46-slo-error-budgets", [
  {
    q: "A service has a 99.9% availability SLO over a 30-day window receiving 10 million requests. Roughly how many bad requests are allowed before the error budget is exhausted?",
    options: [
      "100 requests",
      "1,000 requests",
      "10,000 requests",
      "100,000 requests",
    ],
    answer: 2,
    explain: "Error budget = (1 - 0.999) * 10,000,000 = 0.001 * 10,000,000 = 10,000 allowed bad requests.",
  },
  {
    q: "Which statement best describes the relationship between an SLO and an SLA?",
    options: [
      "An SLO is the external contract with financial penalties; an SLA is the internal target.",
      "An SLO and SLA are interchangeable terms for the same commitment.",
      "An SLO is the internal engineering target, set tighter than the SLA to give a safety margin before breaching the contractual threshold.",
      "An SLI is stricter than the SLO, which is stricter than the SLA.",
    ],
    answer: 2,
    explain: "The SLO is the internal target; the SLA is the external contract typically set 10-20% below the SLO so internal alerts fire before any legal threshold is breached.",
  },
  {
    q: "A multi-window burn-rate alert fires when the burn rate reaches 14.4x for a 30-day SLO window. Approximately how long until the error budget is exhausted at that burn rate?",
    options: [
      "About 50 hours",
      "About 5 days",
      "About 2 days",
      "About 30 hours",
    ],
    answer: 0,
    explain: "A 14.4x burn rate over a 30-day window exhausts the budget in 30 / 14.4 days = ~2.08 days = ~50 hours. This is why it triggers an immediate P0 page.",
  },
]);

registerResources("46-slo-error-budgets", [
  { title: "Google SRE Book — Service Level Objectives (Chapter 4)", url: "https://sre.google/sre-book/service-level-objectives/" },
  { title: "Google SRE Workbook — Alerting on SLOs", url: "https://sre.google/workbook/alerting-on-slos/" },
  { title: "Google SRE Workbook — Implementing SLOs", url: "https://sre.google/workbook/implementing-slos/" },
  { title: "Prometheus — Recording Rules for SLO Burn Rate", url: "https://prometheus.io/docs/practices/rules/" },
]);

registerQuiz("46-queueing-theory", [
  {
    q: "Your service processes 2,000 requests per second and each request spends an average of 40 ms in the system. According to Little's Law, how many requests are in flight at any given moment?",
    options: [
      "50 concurrent requests",
      "80 concurrent requests",
      "50,000 concurrent requests",
      "500 concurrent requests",
    ],
    answer: 1,
    explain: "Little's Law: L = lambda * W = 2000 * 0.040 = 80 concurrent requests in flight.",
  },
  {
    q: "Using the M/M/1 model, a server with baseline service time S = 50 ms is at 80% utilization. What is the expected response time?",
    options: [
      "50 ms",
      "100 ms",
      "250 ms",
      "500 ms",
    ],
    answer: 2,
    explain: "M/M/1 response time W = S / (1 - rho) = 50 / (1 - 0.80) = 50 / 0.20 = 250 ms. At 80% utilization response time is already 5x baseline.",
  },
  {
    q: "A distributed cache cluster is benchmarked at 1, 2, 4, 8, and 16 nodes. Throughput grows from 1 to 8 nodes but then *decreases* at 16 nodes. Which Universal Scalability Law parameter is the primary cause?",
    options: [
      "Alpha (contention), because serialized locks cause a plateau",
      "Beta (coherency), because inter-node consistency costs grow as N*(N-1) and eventually overwhelm parallelism",
      "Lambda (arrival rate), because more nodes attract more traffic",
      "Rho (utilization), because each node is now underutilized",
    ],
    answer: 1,
    explain: "A throughput *decline* (not just a plateau) is the hallmark USL beta signature. The coherency term grows as N*(N-1), so adding nodes eventually reduces throughput when the coordination overhead outweighs the extra capacity.",
  },
]);

registerResources("46-queueing-theory", [
  { title: "Google SRE Book — Handling Overload", url: "https://sre.google/sre-book/handling-overload/" },
  { title: "Neil Gunther — Universal Scalability Law (USL) Overview", url: "http://www.perfdynamics.com/Manifesto/USLscalability.html" },
  { title: "Wikipedia — Little's Law", url: "https://en.wikipedia.org/wiki/Little%27s_law" },
  { title: "Wikipedia — M/M/1 Queue", url: "https://en.wikipedia.org/wiki/M/M/1_queue" },
]);

registerQuiz("46-load-shedding", [
  {
    q: "Why should a load shedder's 'tryAcquire()' call be placed as the very first operation in a request handler, before any I/O or parsing?",
    options: [
      "Because authentication must be skipped under load",
      "To reduce load on the database connection pool specifically",
      "To avoid wasting CPU on work that will be discarded; shed work before consuming any significant resources",
      "Because the Content-Type header must be read before the concurrency check",
    ],
    answer: 2,
    explain: "Placing the load shed after expensive operations like DB queries or JSON parsing wastes CPU on work that will ultimately be discarded. The limiter must be the first middleware to make shedding cheap.",
  },
  {
    q: "An AIMD adaptive concurrency limiter observes that the current RTT is 1.4x the recorded minimum RTT (minRtt), exceeding the gradient threshold of 1.25. What action does it take?",
    options: [
      "Increase the concurrency limit by the additive increment",
      "Multiplicatively decrease the concurrency limit by the backoff factor",
      "Reset the concurrency limit to the initial value",
      "Reject all incoming requests with HTTP 503",
    ],
    answer: 1,
    explain: "When RTT exceeds gradient * minRtt the limiter detects congestion and applies the multiplicative decrease (e.g., limit * 0.9). This is the 'MD' part of AIMD — back off fast when congested.",
  },
  {
    q: "When calculating an availability SLI for error-budget purposes, which requests should be excluded from the 'bad events' count?",
    options: [
      "All 4xx responses",
      "Requests that returned HTTP 429 due to correct load shedding",
      "Requests that timed out in the upstream proxy",
      "Requests from unauthenticated users",
    ],
    answer: 1,
    explain: "HTTP 429 responses indicate the service is working as designed — intentional load shedding. Counting 429s as errors inflates the burn rate and may falsely freeze the release pipeline. The availability SLI should be defined as non-5xx / total, not non-4xx / total.",
  },
]);

registerResources("46-load-shedding", [
  { title: "Google SRE Book — Handling Overload", url: "https://sre.google/sre-book/handling-overload/" },
  { title: "Netflix Tech Blog — Performance Under Load (concurrency-limits)", url: "https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581" },
  { title: "Node.js Streams — Backpressure Guide", url: "https://nodejs.org/en/docs/guides/backpressuring-in-streams" },
  { title: "RFC 6585 — HTTP 429 Too Many Requests", url: "https://datatracker.ietf.org/doc/html/rfc6585" },
  { title: "k6 Documentation — Thresholds and Pass/Fail", url: "https://grafana.com/docs/k6/latest/using-k6/thresholds/" },
]);
