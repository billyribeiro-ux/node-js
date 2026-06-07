registerQuiz("22-node-test", [
  {
    q: "What output format does 'node --test' emit by default, and why is it useful in CI?",
    options: [
      "JSON, because it is easy to parse programmatically",
      "JUnit XML, because most CI systems import it natively",
      "TAP (Test Anything Protocol), understood by most CI systems and test reporters",
      "Markdown, so results can be included in pull request descriptions"
    ],
    answer: 2,
    explain: "The built-in 'node:test' runner emits TAP (Test Anything Protocol) output. TAP is a widely-supported text format that CI systems, test reporters, and tap-parsing tools all understand without additional configuration."
  },
  {
    q: "Why does 'test.only()' in 'node:test' have no effect unless you also pass '--test-only' on the command line?",
    options: [
      "The Node team forgot to implement '.only' and it is a known bug",
      "It prevents accidentally committing a '.only' that silently skips the full suite on CI",
      "'.only' only works inside 'describe' blocks, not at the top level",
      "The '--test-only' flag is required for async tests to run correctly"
    ],
    answer: 1,
    explain: "Without '--test-only', 'test.only()' is silently ignored and all tests still run. This design prevents a committed '.only' from silently skipping the rest of the suite in CI, which would give a false green build."
  },
  {
    q: "What is the difference between 'node:assert' and 'node:assert/strict'?",
    options: [
      "'node:assert/strict' throws on any type error, while 'node:assert' ignores type mismatches entirely",
      "'node:assert/strict' makes every comparison use strict equality (===) by default; 'node:assert' uses loose equality (==)",
      "'node:assert/strict' supports async assertions; 'node:assert' does not",
      "'node:assert/strict' is only available in Node 24 and later"
    ],
    answer: 1,
    explain: "Importing from 'node:assert/strict' makes all methods (including 'equal', 'deepEqual') behave as their strict variants by default. The plain 'node:assert' module uses loose equality for methods like 'assert.equal', which can produce confusing results. Prefer 'node:assert/strict' in all new test suites."
  }
]);

registerResources("22-node-test", [
  { title: "Node.js node:test Runner Documentation", url: "https://nodejs.org/api/test.html" },
  { title: "Node.js node:assert Documentation", url: "https://nodejs.org/api/assert.html" },
  { title: "TAP (Test Anything Protocol) Specification", url: "https://testanything.org/" },
  { title: "Node.js --test CLI Flag Reference", url: "https://nodejs.org/api/cli.html#--test" },
  { title: "Node.js Test Runner watch mode", url: "https://nodejs.org/api/test.html#watch-mode" }
]);

registerQuiz("22-mocking-coverage", [
  {
    q: "When using 't.mock.method(object, \"methodName\")' in 'node:test', when is the original method restored?",
    options: [
      "You must call 'mock.restore()' manually at the end of each test",
      "It is restored automatically when the test ends, without any cleanup code",
      "It is restored only when the entire test suite finishes",
      "It must be restored inside an 'afterEach' hook using 'mock.reset()'"
    ],
    answer: 1,
    explain: "When you use 't.mock.method()' with the test context 't', Node automatically resets and restores the method when that test ends. This prevents leaked mocks from corrupting later tests without requiring manual cleanup."
  },
  {
    q: "What must you call before 't.mock.timers.tick(ms)' for the fake clock to actually intercept 'setTimeout' calls?",
    options: [
      "t.mock.timers.install()",
      "t.mock.timers.enable(['setTimeout'])",
      "t.mock.timers.replace(global, 'setTimeout')",
      "t.mock.timers.start(Date.now())"
    ],
    answer: 1,
    explain: "You must call 't.mock.timers.enable([\"setTimeout\"])' (or whichever timer APIs you want to fake) before registering any timers. Without this, real timers run normally and 'tick()' silently does nothing."
  },
  {
    q: "Which coverage metric is the most revealing for catching untested logic branches in an if/else statement?",
    options: [
      "Line coverage — percentage of executable lines touched",
      "Function coverage — percentage of defined functions called",
      "Branch coverage — percentage of if/else and ternary branches taken",
      "Statement coverage — percentage of individual statements executed"
    ],
    answer: 2,
    explain: "Branch coverage tracks whether each individual path through a conditional (both the true and false arms of every if/else, ternary, or logical operator) was exercised. A function can be 100% line-covered yet miss half its branches if only the happy path is tested."
  }
]);

registerResources("22-mocking-coverage", [
  { title: "Node.js Mock API (node:test)", url: "https://nodejs.org/api/test.html#mocking" },
  { title: "Node.js --experimental-test-coverage Flag", url: "https://nodejs.org/api/test.html#collecting-code-coverage" },
  { title: "Node.js Mock Timers Documentation", url: "https://nodejs.org/api/test.html#class-mocktimers" },
  { title: "Node.js Snapshot Testing", url: "https://nodejs.org/api/test.html#snapshot-testing" },
  { title: "V8 Coverage (used by node:test)", url: "https://v8.dev/blog/javascript-code-coverage" }
]);

registerQuiz("22-vitest-jest", [
  {
    q: "What is the main architectural reason Vitest starts significantly faster than Jest in Vite-based projects?",
    options: [
      "Vitest is written in Rust whereas Jest is written in JavaScript",
      "Vitest reuses the Vite dev server's existing module graph and transform pipeline, avoiding a separate compile step",
      "Vitest skips TypeScript type-checking entirely, while Jest always runs tsc",
      "Vitest runs tests in a Web Worker, freeing the main thread"
    ],
    answer: 1,
    explain: "Vitest is built on top of Vite. In a Vite project the module graph is already loaded and transformed. Vitest reuses that work directly, so there is no separate startup phase. For non-Vite projects the advantage is smaller."
  },
  {
    q: "Which 'expect()' method should you use when you need deep structural equality between two objects (not reference equality)?",
    options: [
      "expect(a).toBe(b)",
      "expect(a).toEqual(b)",
      "expect(a).toMatch(b)",
      "expect(a).toContain(b)"
    ],
    answer: 1,
    explain: "'toBe' uses strict reference equality (===), so two structurally identical but distinct objects fail. 'toEqual' performs a recursive structural comparison, making it the right choice for comparing plain objects and arrays by value."
  },
  {
    q: "For a pure Node.js microservice with no frontend framework, which test runner is typically the lowest-overhead choice?",
    options: [
      "Jest, because it has the largest plugin ecosystem",
      "Vitest, because it supports TypeScript natively",
      "node:test, because it has zero npm dependencies and ships with Node",
      "Mocha, because it is the oldest and most battle-tested"
    ],
    answer: 2,
    explain: "'node:test' ships in the standard library — no install, no version drift, no security advisories for the test runner itself. For backend services and CLIs with modest testing needs, this is the engineering-sound default. Reserve Jest or Vitest for richer ecosystems where their extra features pay for the dependency."
  }
]);

registerResources("22-vitest-jest", [
  { title: "Vitest Documentation", url: "https://vitest.dev/guide/" },
  { title: "Jest Documentation", url: "https://jestjs.io/docs/getting-started" },
  { title: "Vitest expect() API Reference", url: "https://vitest.dev/api/expect.html" },
  { title: "Jest expect() API Reference", url: "https://jestjs.io/docs/expect" },
  { title: "Node.js node:test Documentation", url: "https://nodejs.org/api/test.html" }
]);

registerQuiz("22-integration-e2e", [
  {
    q: "How does 'supertest' allow you to fire HTTP requests against an Express app without calling 'app.listen()'?",
    options: [
      "It patches the Express router to intercept calls before they reach the network",
      "It binds the app to an ephemeral port internally and manages the connection lifecycle",
      "It converts route handlers into pure functions that accept request objects directly",
      "It requires a running server and connects to localhost on port 3000 by default"
    ],
    answer: 1,
    explain: "supertest calls 'app.listen(0)' internally, which binds to a random available port. It then fires the HTTP request to that port and closes the server when the assertion chain resolves. Tests never compete for a fixed port."
  },
  {
    q: "What is the recommended isolation strategy for database integration tests to ensure each test starts with clean state?",
    options: [
      "Delete all tables before each test and re-run migrations",
      "Use a separate test database per developer but share one in CI",
      "Wrap each test in a database transaction and roll it back after the test",
      "Clear the ORM's in-memory cache before each test"
    ],
    answer: 2,
    explain: "Wrapping each test in a transaction that is rolled back at the end resets the database to its original state without the cost of truncating tables or re-running migrations. It is fast, reliable, and leaves no data between tests."
  },
  {
    q: "According to the testing pyramid, which layer should contain the fewest tests and why?",
    options: [
      "Unit tests, because they test too small a surface area to be useful",
      "Integration tests, because they require a running database which is slow",
      "End-to-end tests, because they are slow, expensive to maintain, and prone to environment-dependent flakiness",
      "Smoke tests, because they only run in production environments"
    ],
    answer: 2,
    explain: "E2E tests exercise the full stack including browsers, external services, and network. They are the slowest to run, costliest to write, and most likely to produce false failures due to environment issues. Keep them few and focused on critical user paths; invest heavily in integration tests instead."
  }
]);

registerResources("22-integration-e2e", [
  { title: "supertest npm package", url: "https://github.com/ladjs/supertest" },
  { title: "Node.js node:test beforeEach / afterEach Hooks", url: "https://nodejs.org/api/test.html#beforeeachfn-options" },
  { title: "Testcontainers for Node.js", url: "https://node.testcontainers.org/" },
  { title: "GitHub Actions Service Containers (Postgres)", url: "https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers" },
  { title: "The Practical Test Pyramid (Martin Fowler)", url: "https://martinfowler.com/articles/practical-test-pyramid.html" }
]);
