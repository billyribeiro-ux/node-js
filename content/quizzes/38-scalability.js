registerQuiz("38-horizontal-scaling", [
  {
    q: "Why does storing sessions in a Node process's in-process Map break horizontal scaling?",
    options: [
      "Maps are too slow for session data",
      "The Map lives only in that process's heap, so requests routed to a different instance cannot find the session",
      "Maps do not support TTL expiry",
      "Node.js Maps are not thread-safe"
    ],
    answer: 1,
    explain: "Each process has its own isolated heap. A session stored in an in-process Map on instance A is invisible to instance B. When the load balancer routes the next request to B, the lookup fails and the user sees a random authentication error."
  },
  {
    q: "What is the key advantage of consistent hashing over naive modulo-based sharding when adding a new cache node?",
    options: [
      "Consistent hashing is faster to compute",
      "Consistent hashing requires no configuration changes",
      "Consistent hashing remaps only approximately K/N keys rather than almost all keys, minimising cache churn",
      "Consistent hashing guarantees strong consistency across nodes"
    ],
    answer: 2,
    explain: "With modulo sharding, changing N (the denominator) remaps most keys to different nodes. Consistent hashing places nodes on a virtual ring, so adding a node only takes over a fraction of one neighbour's range — expected churn is K/N (keys divided by nodes)."
  },
  {
    q: "Which Twelve-Factor App principle most directly governs the requirement that all configuration be stored in environment variables?",
    options: [
      "Factor VI: Processes",
      "Factor IX: Disposability",
      "Factor III: Config",
      "Factor VIII: Concurrency"
    ],
    answer: 2,
    explain: "Factor III (Config) states that anything that varies between deploys — database URLs, credentials, feature flags — must be stored in environment variables, never hardcoded or baked into the image. This is a prerequisite for safely running multiple stateless instances."
  }
]);

registerResources("38-horizontal-scaling", [
  { title: "The Twelve-Factor App", url: "https://12factor.net/" },
  { title: "Redis: SET command with NX and EX options (session storage pattern)", url: "https://redis.io/docs/latest/commands/set/" },
  { title: "Redis: SETEX for session TTL", url: "https://redis.io/docs/latest/commands/setex/" },
  { title: "NGINX: load balancing documentation", url: "https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/" }
]);

registerQuiz("38-zero-downtime", [
  {
    q: "Which deploy strategy provides the fastest rollback to the previous version by simply flipping a router switch?",
    options: [
      "Rolling deploy",
      "Canary deploy",
      "Blue-green deploy",
      "In-place deploy"
    ],
    answer: 2,
    explain: "Blue-green keeps two identical environments. All traffic goes to one (green) while the other (blue) is idle. Rollback is a single DNS or routing change back to blue, taking effect immediately with no re-deployment needed."
  },
  {
    q: "In the expand/contract database migration pattern, when is it safe to drop the old column?",
    options: [
      "Immediately after the migration script runs",
      "After the new code is deployed but before the old code is retired",
      "Only after all old-code instances are fully retired and the new code reads exclusively from the new column",
      "At the same time as deploying the new application version"
    ],
    answer: 2,
    explain: "Old and new code can coexist during a rolling deploy, and old code still reads the old column. You can only drop the old column (the 'contract' step) after every old-code instance is gone, ensuring no running code still references it."
  },
  {
    q: "Why must you call .unref() on the hard-kill timeout in a graceful shutdown handler?",
    options: [
      "To prevent the timeout from being garbage-collected prematurely",
      "To ensure the timeout fires immediately on SIGTERM",
      "So the timeout does not keep the event loop alive if all other work finishes first, allowing a clean early exit",
      "To prevent the timeout from firing more than once"
    ],
    answer: 2,
    explain: "Calling .unref() on a timer tells Node.js not to count it as a reason to keep the process running. If all in-flight requests finish and resources close before the 30-second timeout, the event loop drains and the process exits cleanly without waiting."
  }
]);

registerResources("38-zero-downtime", [
  { title: "Kubernetes: Rolling update strategy", url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-update-deployment" },
  { title: "Node.js: process signal events (SIGTERM)", url: "https://nodejs.org/api/process.html#signal-events" },
  { title: "Node.js: server.close() for graceful shutdown", url: "https://nodejs.org/api/http.html#serverclosecallback" },
  { title: "Expand/contract migration pattern (Martin Fowler)", url: "https://martinfowler.com/bliki/ParallelChange.html" }
]);

registerQuiz("38-load-testing", [
  {
    q: "Why do open load models (fixed arrival rate) reveal different failure modes than closed load models (N virtual users looping)?",
    options: [
      "Open models measure latency more accurately because they use real HTTP clients",
      "In a closed model, slow server responses automatically reduce arrival rate, masking overload; in an open model arrivals keep coming regardless, exposing queue growth and timeout behaviour",
      "Open models support more concurrent users",
      "Closed models do not support percentile reporting"
    ],
    answer: 1,
    explain: "With a closed model (VUs looping), if the server slows down, VUs pile up waiting for responses and arrival rate drops automatically. This hides the overload. An open model sends arrivals at a fixed rate regardless of response time, faithfully simulating real web traffic where users don't wait for your server."
  },
  {
    q: "Using Little's Law (L = lambda x W), if your SLA requires p99 latency under 200 ms and you expect 500 requests per second, how many concurrent requests must your system handle?",
    options: [
      "500",
      "2500",
      "100",
      "50"
    ],
    answer: 2,
    explain: "Little's Law: L = lambda x W = 500 req/s x 0.2 s = 100 concurrent requests. This tells you the minimum concurrency your connection pools, worker threads, and database pools must be sized to handle."
  },
  {
    q: "What does the 'knee' of a throughput-latency curve represent, and what is the recommended safe operating capacity relative to it?",
    options: [
      "The maximum achievable throughput; operate at 100% of it",
      "The point where latency begins rising non-linearly with added load; operate at 70-80% of it to maintain headroom",
      "The median throughput under normal load; operate above it",
      "The point where error rate exceeds 1%; operate just below it"
    ],
    answer: 1,
    explain: "The knee is where the throughput-latency curve bends steeply upward — adding more load beyond this point causes non-linear latency growth and queue buildup. Operating at 70-80% of the knee gives headroom to absorb traffic spikes without tipping into overload."
  }
]);

registerResources("38-load-testing", [
  { title: "k6: open source load testing documentation", url: "https://grafana.com/docs/k6/latest/" },
  { title: "autocannon: Node.js HTTP benchmarking tool", url: "https://github.com/mcollina/autocannon" },
  { title: "k6: arrival-rate executor (open model)", url: "https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/" },
  { title: "Little's Law explained (Wikipedia)", url: "https://en.wikipedia.org/wiki/Little%27s_law" },
  { title: "k6: thresholds and CI integration", url: "https://grafana.com/docs/k6/latest/using-k6/thresholds/" }
]);
