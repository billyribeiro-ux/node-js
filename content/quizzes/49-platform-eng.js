// Module 49 — Platform Engineering & API Governance at Scale

registerQuiz("49-api-evolution", [
  {
    q: "Adding a new field with a non-null required constraint to an existing REST/JSON API response is classified as which type of schema change, and why?",
    options: [
      "Backward-compatible, because new optional fields can always be added.",
      "Breaking, because old producers that do not emit the new field will cause validation failures for new consumers that treat it as required.",
      "Forward-compatible only, because it does not affect existing consumers reading old data.",
      "Compatible if the field has a default value defined in the JSON Schema.",
    ],
    answer: 1,
    explain: "Adding a required field is a breaking change because existing producers running the old code do not emit it. New consumers or new validation layers will fail when they encounter responses from old producers that are missing the field. Only adding optional (nullable/defaulted) fields is backward-compatible.",
  },
  {
    q: "You need to rename the 'username' field to 'displayName' in a REST API without any downtime. Which migration pattern achieves this safely across independently-deployed producers and consumers?",
    options: [
      "Deploy all consumers first, then deploy producers that emit only 'displayName'.",
      "Use the expand/contract pattern: first emit both fields simultaneously (expand phase), migrate all consumers to read 'displayName', then remove 'username' once all consumers are confirmed updated (contract phase).",
      "Issue a versioned endpoint /v2/users that returns 'displayName'; run /v1 and /v2 forever.",
      "Use a feature flag that switches between 'username' and 'displayName' at runtime based on request headers.",
    ],
    answer: 1,
    explain: "The expand/contract (parallel-change) pattern is the zero-downtime playbook: Phase 1 emits both old and new fields so all consumer versions can coexist. Phase 2 migrates consumers at their own pace. Phase 3 removes the old field once evidence confirms no consumer reads it. This avoids the 'deploy all consumers first' coordination problem.",
  },
  {
    q: "Hyrum's Law states that with enough users, all observable behaviors become dependencies. Which combination of practices best mitigates the risk it describes?",
    options: [
      "Write comprehensive API documentation and enforce semantic versioning on every release.",
      "Strict schema validation on both requests AND responses, consumer-driven contract tests that pin observed behavior, and structured changelogs that document every change including internal ones.",
      "Use URI versioning (/v1/, /v2/) so each version is independently stable and observable behaviors cannot bleed across versions.",
      "Enforce rate limits and authentication to reduce the surface of observable behavior.",
    ],
    answer: 1,
    explain: "Hyrum's Law means the documented API surface is smaller than the actual surface users depend on. The mitigation stack is: response validation (catch undocumented changes before release), consumer-driven contract tests (make implicit dependencies explicit and automated), and complete changelogs (force awareness of every change regardless of whether it was intended to be public).",
  },
]);

registerResources("49-api-evolution", [
  { title: "Martin Fowler — Parallel Change (Expand/Contract) pattern", url: "https://martinfowler.com/bliki/ParallelChange.html" },
  { title: "RFC 8594 — The Sunset HTTP Header Field", url: "https://datatracker.ietf.org/doc/html/rfc8594" },
  { title: "Hyrum's Law (hyrumslaw.com)", url: "https://www.hyrumslaw.com/" },
  { title: "Confluent Schema Registry compatibility types", url: "https://docs.confluent.io/platform/current/schema-registry/avro.html#schema-evolution-and-compatibility" },
  { title: "Google Protobuf — Language Guide (field numbers and reserved)", url: "https://protobuf.dev/programming-guides/proto3/#updating" },
]);

registerQuiz("49-contract-testing", [
  {
    q: "Integration test suites for N microservices scale as O(N^2) in complexity. What is the fundamental insight of consumer-driven contract testing that reduces this to O(N)?",
    options: [
      "Contract tests run against mocks, which are 10x faster than real services.",
      "Each service only needs to test its own outgoing contracts and its own incoming ones against a recorded snapshot of the interaction shape; the real provider does not need to be running.",
      "Contract tests share a single test database across all services, reducing environment count.",
      "Pact automatically generates integration test cases from OpenAPI specs, eliminating manual test writing.",
    ],
    answer: 1,
    explain: "The key insight is that the only thing that matters at a service boundary is the shape of the data exchanged. A recorded consumer snapshot IS the contract. Testing against it is O(N) because each service tests its own pacts independently — not O(N^2) because there is no need for a shared environment where every service pair runs simultaneously.",
  },
  {
    q: "In the Pact CDC workflow, what is the purpose of 'can-i-deploy' and why is skipping it after running pact-provider-verifier a critical mistake?",
    options: [
      "can-i-deploy checks for CVEs in the service's dependencies before deployment.",
      "can-i-deploy queries the Pact Broker's verification matrix to confirm that the specific version being deployed has been verified against ALL versions of its dependencies already in the target environment; skipping it means you may deploy a version that was verified against a different provider version than what is actually running.",
      "can-i-deploy validates that the Docker image passes security scanning before the deployment gate.",
      "can-i-deploy runs the consumer test suite one final time against the live provider to confirm nothing changed.",
    ],
    answer: 1,
    explain: "pact-provider-verifier confirms the provider can satisfy consumer pacts in isolation. can-i-deploy checks the multi-dimensional compatibility matrix: has the version I want to deploy been verified against every version of every dependency that is currently deployed to the target environment? These are different questions. Skipping can-i-deploy means you may deploy a version whose compatibility with the actual running dependencies has never been verified.",
  },
  {
    q: "A consumer Pact test uses an exact-value matcher asserting 'role: \"admin\"', but the consumer's code never reads the 'role' field. What is the practical consequence of this over-specified contract?",
    options: [
      "The Pact Broker will reject the pact file for containing unnecessary fields.",
      "The test is stronger because it constrains the provider more tightly.",
      "The contract will fail provider verification any time the provider changes the 'role' field for unrelated reasons, creating false alarms that erode trust in the test suite even though no real consumer dependency was broken.",
      "It prevents Hyrum's Law effects by locking down all observed fields explicitly.",
    ],
    answer: 2,
    explain: "A contract should express minimum viable consumer needs. Asserting exact values for fields the consumer never reads means any unrelated provider change to that field (different enum value, renaming, normalization) triggers a verification failure, creating noise and eroding confidence in the CDC system. Use like() matchers for type-checking only, not exact-value matchers, unless the exact value is genuinely load-bearing for the consumer.",
  },
]);

registerResources("49-contract-testing", [
  { title: "Pact documentation — getting started", url: "https://docs.pact.io/" },
  { title: "Pact — can-i-deploy tool documentation", url: "https://docs.pact.io/pact_broker/can_i_deploy" },
  { title: "Martin Fowler — Contract Testing", url: "https://martinfowler.com/bliki/ContractTest.html" },
  { title: "Pact Foundation — Consumer-Driven Contracts pattern", url: "https://docs.pact.io/consumer" },
  { title: "Pact — Provider state handlers", url: "https://docs.pact.io/provider/handling_pact_failures" },
]);

registerQuiz("49-paved-roads", [
  {
    q: "In the platform-as-product model, what is the primary metric that determines whether a platform team has succeeded?",
    options: [
      "Uptime and SLO compliance of platform infrastructure components.",
      "Number of features shipped by the platform team per quarter.",
      "Adoption by internal application engineering teams — whether engineers actually use the platform rather than building their own solutions.",
      "Reduction in total cost of cloud infrastructure across the organization.",
    ],
    answer: 2,
    explain: "A platform team's output is developer experience, and its customer is internal application engineers. If engineers don't adopt the platform it has failed regardless of how well it was built. Adoption — measured by the fraction of services on current platform standards — is the north-star metric that reveals whether the platform delivers real value.",
  },
  {
    q: "You need to migrate 300 Node.js services from logger.log(msg, level) to logger.write({ message: msg, level }). A regex find-and-replace fails on multiline arguments and template literals. What is the correct tool and why?",
    options: [
      "A custom Babel plugin that transforms the AST at transpile time for all services simultaneously.",
      "jscodeshift with an AST-based transform (recast): it correctly handles all syntactic variations including multiline arguments, nested calls, and comments, and rewrites only changed nodes while preserving all other formatting.",
      "A sed script with a sufficiently complex regex that handles the known edge cases.",
      "OpenRewrite, which is designed for Java but can be adapted to JavaScript with custom recipes.",
    ],
    answer: 1,
    explain: "jscodeshift uses recast, which operates on the AST and reprints only the nodes you changed, preserving all other whitespace and comments. It correctly handles multiline arguments, template literals, optional chaining, and all other syntax that regex-based approaches break on. Regex-based codemods fail at scale; AST-based codemods are the professional-grade solution.",
  },
  {
    q: "After applying a codemod across 847 files and confirming the scorecard shows 90% compliance, what additional automated safeguard is necessary to prevent regression back to the old API pattern over time?",
    options: [
      "A weekly reminder email to all teams to use the new API.",
      "A custom ESLint rule that flags usage of the deprecated API in CI, causing the build to fail if any new code re-introduces the old pattern.",
      "A git pre-receive hook that scans all pushed files for the deprecated pattern.",
      "Removing the old API from the codebase by deleting its source file immediately after the codemod.",
    ],
    answer: 1,
    explain: "A codemod performs a one-time migration; without enforcement, new code will re-introduce the old pattern. A custom ESLint rule shipped as part of the org-wide @company/eslint-config runs in every service's CI and catches regressions at PR time before they merge, permanently preventing the pattern from reappearing.",
  },
]);

registerResources("49-platform-eng", [
  { title: "Martin Fowler — Paved Road", url: "https://martinfowler.com/bliki/PavedPath.html" },
  { title: "jscodeshift AST transform tool", url: "https://github.com/facebook/jscodeshift" },
  { title: "Backstage — Internal Developer Portal (IDP)", url: "https://backstage.io/docs/overview/what-is-backstage" },
  { title: "CNCF Platforms White Paper", url: "https://tag-app-delivery.cncf.io/whitepapers/platforms/" },
  { title: "Google — Large-Scale Changes (Rosie)", url: "https://abseil.io/resources/swe-book/html/ch22.html" },
]);
