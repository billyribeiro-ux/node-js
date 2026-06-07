registerLessonSrc("49-contract-testing", function () {/*
---
id: 49-contract-testing
title: "Consumer-Driven Contracts & Contract Testing"
minutes: 26
level: advanced
objectives:
  - Explain why integration tests fail to scale across independently-deployed services
  - Implement consumer-driven contracts with Pact and understand the broker/can-i-deploy workflow
  - Wire provider verification into CI and reason about the tradeoffs vs schema registries
---

# Consumer-Driven Contracts & Contract Testing

## Why this matters

At scale, end-to-end integration test suites become the slowest, most brittle, most expensive
artifact in your engineering system. They require a full environment, they catch failures late,
and they give no signal about *which* contract between *which* pair of services broke. Consumer-
driven contract (CDC) testing replaces that shared-environment dependency with a lightweight,
independently runnable verification step that can run in seconds against a mock, yet gives you
high confidence that real deployments will succeed. Getting this right is what separates a
platform that ships 50 times per day from one that ships once a week.

## Learning objectives

- Articulate precisely why integration tests degrade as service count grows.
- Describe the Pact consumer/provider/broker model end to end.
- Explain what `can-i-deploy` checks and why it is the deployment gate that matters.
- Distinguish consumer-driven contracts from schema registry validation, and know when each applies.
- Implement a contract verifier for required fields and type safety in pure logic.

## Why integration tests don't scale

Consider N services. A naive integration test matrix tests every pair: O(N²) test environments,
O(N²) build dependencies, and O(N²) blast radius when a single service's environment is flaky.
With 50 services that is 1,225 integration pairs. At Google scale (thousands of microservices)
this is simply not viable.

Concrete failure modes from production:

- **Temporal coupling:** Service A's tests import Service B's test container. B has a flaky DB
  migration that fails ~5% of the time. A's CI is now 5% flaky for reasons A cannot control.
- **Staging drift:** The staging environment carries data and configuration that production doesn't
  have, masking real failures and producing phantom ones.
- **Late detection:** An integration test finds the break after both services are fully deployed to
  staging, not at PR time. Rolling back two services simultaneously is painful.
- **No attribution:** A failure in a 10-service E2E test leaves you bisecting logs across 10
  services to find who broke what.

> [!PRINCIPAL]
> The fundamental insight of contract testing: the only thing that matters at a service boundary
> is the *shape of the data* exchanged. You do not need the real provider running to verify that
> shape — you need a recorded snapshot of what the consumer depends on. That snapshot IS the
> contract. Testing against it is O(N), not O(N²), because each service only tests its own
> outgoing contracts and its own incoming ones.

## Consumer-driven contracts: the Pact model

**Pact** (pact.io) is the dominant CDC framework. The flow in four steps:

**1. Consumer generates a pact file.** The consumer writes a test that defines exactly what
request it will send and what response shape it depends on. Pact runs a mock provider during
this test. On success, Pact writes a JSON pact file.

```js
// Consumer test (read-only — Pact + Node)
import { PactV3, MatchersV3 } from "@pact-foundation/pact";
const { like, string, integer } = MatchersV3;

const provider = new PactV3({ consumer: "OrderService", provider: "UserService" });

describe("OrderService → UserService contract", () => {
  it("fetches a user by id", () => {
    provider
      .given("user 42 exists")
      .uponReceiving("a GET request for user 42")
      .withRequest({ method: "GET", path: "/users/42" })
      .willRespondWith({
        status: 200,
        body: {
          id: like(42),
          name: string("Ada Lovelace"),
          email: string("ada@example.com"),
        },
      });

    return provider.executeTest(async (mockProvider) => {
      const result = await fetchUser(mockProvider.url, 42);
      expect(result.name).toBe("Ada Lovelace");
    });
  });
});
```

> [!OUTPUT]
> PASS  src/consumer.pact.test.js
> Pact file written to: pacts/OrderService-UserService.json

**2. Consumer publishes the pact to the Pact Broker.** The broker (self-hosted or Pactflow
SaaS) stores the pact, tagged with the consumer's git branch and version:

```bash
pact-broker publish ./pacts \
  --consumer-app-version=$(git rev-parse HEAD) \
  --branch=$(git branch --show-current) \
  --broker-base-url=https://broker.example.com
```

**3. Provider verifies the pact.** In the provider's CI, Pact fetches all pact files that affect
it from the broker and replays the recorded requests against the real provider. The provider
must satisfy every consumer's recorded expectations:

```bash
# Provider CI step
pact-provider-verifier \
  --provider-base-url=http://localhost:3000 \
  --pact-broker-base-url=https://broker.example.com \
  --provider=UserService \
  --publish-verification-results \
  --provider-app-version=$(git rev-parse HEAD)
```

> [!OUTPUT]
> Verifying a pact between OrderService and UserService
>   Given user 42 exists
>     a GET request for user 42
>       with GET /users/42
>         returns a response which
>           has status code 200 ✓
>           has a matching body ✓
> 1 interaction, 0 failures.

**4. `can-i-deploy` gates the deployment.** Before deploying either service, the CI pipeline runs
`can-i-deploy`, which checks the Pact Broker's verification matrix:

```bash
pact-broker can-i-deploy \
  --pacticipant OrderService \
  --version $(git rev-parse HEAD) \
  --to-environment production
```

> [!OUTPUT]
> Computer says yes \o/
> CONSUMER      | C.VERSION | PROVIDER    | P.VERSION | SUCCESS?
> OrderService  | a1b2c3d   | UserService | f4e5d6c   | true
> All required verification results are published and successful

If verification hasn't happened or failed, `can-i-deploy` returns a non-zero exit and the deploy
is blocked — regardless of whether integration tests pass.

> [!PRINCIPAL]
> `can-i-deploy` is the most underappreciated part of the Pact ecosystem. Teams adopt Pact, run
> the consumer tests, verify the pacts — and then let developers deploy anyway without running
> `can-i-deploy`. That defeats the entire purpose. The broker's verification *matrix* (which
> consumer version was verified against which provider version) is a multi-dimensional compatibility
> graph. `can-i-deploy` traverses that graph for the deployment target. The check is: "has the
> version I want to deploy been verified against *all* the versions of its dependencies already
> deployed to the target environment?" This is a precise, queryable fact — not a hopeful guess.

## Provider states and the given() clause

The `given("user 42 exists")` clause is a **provider state**. The provider must implement state
handlers — setup functions that bring the provider to the described state before the interaction
is replayed. Without them, your provider verification is always testing against whatever data
happens to be in your test database, making the tests non-deterministic.

```js
// Provider state handler (read-only)
const stateHandlers = {
  "user 42 exists": async () => {
    await db.users.upsert({ id: 42, name: "Ada Lovelace", email: "ada@example.com" });
  },
  "no users exist": async () => {
    await db.users.deleteAll();
  },
};
```

Each state handler is invoked by Pact's verification runner before the corresponding interaction.
This is why Pact tests can be run against a real (test) database, an in-memory stub, or a
complete in-memory service — the abstraction is at the HTTP boundary.

## Contract tests vs schema registries

These are complementary, not competing:

| Concern | Contract Tests (Pact) | Schema Registry (Confluent, AWS Glue) |
|---|---|---|
| Scope | HTTP / async interactions; exact fields consumed | All fields produced by the schema |
| Enforces | Consumer's actual usage (no more, no less) | Schema-level rules (required, types, defaults) |
| Direction | Consumer-driven: the consumer defines what it needs | Producer-driven: producer registers the schema |
| Feedback | At CI time per service pair | At publish time (schema registration) |
| Async / events | Pact has async message support | Primary use case |
| Blind spots | Doesn't catch fields the consumer doesn't test | Doesn't catch "compatible schema, broken semantics" |

The highest-confidence setup combines both: a schema registry prevents structural breaking
changes at the Kafka/Avro layer, while Pact contract tests verify that each consuming service's
specific field usage is still satisfied.

> [!NOTE]
> Pact's async message support (PactV4 / `MessagePact`) extends the same consumer/provider model
> to event-driven systems. The consumer defines the message body it expects to receive; the
> provider (message producer) verifies it can produce that shape. The broker and `can-i-deploy`
> work identically.

## Try it yourself

The core of a contract verifier is simple: given a recorded contract (required fields and their
types) and a real provider response, check that every required field is present and has the right
type. Build that logic from scratch:

```js run
// Tiny contract verifier — pure logic, no libraries
// A "contract" defines required fields and their expected types.
// A "response" is what the provider actually returned.

function verifyContract(contract, response, label = "") {
  const violations = [];

  for (const [field, spec] of Object.entries(contract.required)) {
    if (!(field in response)) {
      violations.push(`MISSING: '${field}' (expected ${spec.type})`);
      continue;
    }
    const actual = response[field];
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    if (actualType !== spec.type) {
      violations.push(
        `TYPE MISMATCH: '${field}' expected ${spec.type}, got ${actualType} (value: ${JSON.stringify(actual)})`
      );
    }
    if (spec.nonEmpty && (actual === "" || (Array.isArray(actual) && actual.length === 0))) {
      violations.push(`EMPTY VALUE: '${field}' must not be empty`);
    }
  }

  const passed = violations.length === 0;
  console.log(`\n--- Contract: ${label || "unnamed"} ---`);
  if (passed) {
    console.log("[PASS] All required fields present and correctly typed.");
  } else {
    console.log("[FAIL] Contract violations:");
    violations.forEach(v => console.log("  " + v));
  }
  return passed;
}

// Contract: what OrderService depends on from UserService's GET /users/:id
const userContract = {
  required: {
    id:    { type: "number" },
    name:  { type: "string", nonEmpty: true },
    email: { type: "string", nonEmpty: true },
  }
};

// Scenario 1: compliant response
const goodResponse = { id: 42, name: "Ada Lovelace", email: "ada@example.com", role: "admin" };
verifyContract(userContract, goodResponse, "Happy path");

// Scenario 2: missing email
const missingEmail = { id: 42, name: "Ada Lovelace" };
verifyContract(userContract, missingEmail, "Missing email");

// Scenario 3: type regression — id comes back as a string after a DB change
const idAsString = { id: "42", name: "Ada Lovelace", email: "ada@example.com" };
verifyContract(userContract, idAsString, "id as string (regression)");

// Scenario 4: empty name
const emptyName = { id: 42, name: "", email: "ada@example.com" };
verifyContract(userContract, emptyName, "Empty name");
```

## Exercise: add nested field support

Extend the verifier to support nested fields. For example, the contract might require
`address.city` as a string. If the provider returns `{ id: 42, address: { city: "London" } }`,
that should pass; `{ id: 42 }` should fail with "MISSING: address.city".

<details>
<summary>Show solution</summary>

```js run
function getNestedValue(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

function verifyContractDeep(contract, response) {
  const violations = [];
  for (const [path, spec] of Object.entries(contract.required)) {
    const actual = getNestedValue(response, path);
    if (actual === undefined) {
      violations.push(`MISSING: '${path}' (expected ${spec.type})`);
      continue;
    }
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    if (actualType !== spec.type) {
      violations.push(`TYPE MISMATCH: '${path}' expected ${spec.type}, got ${actualType}`);
    }
  }
  if (violations.length === 0) {
    console.log("[PASS] Contract satisfied");
  } else {
    violations.forEach(v => console.log("[FAIL] " + v));
  }
}

const contract = {
  required: {
    "id":           { type: "number" },
    "name":         { type: "string" },
    "address.city": { type: "string" },
    "address.zip":  { type: "string" },
  }
};

verifyContractDeep(contract, { id: 1, name: "Ada", address: { city: "London", zip: "EC1A" } });
verifyContractDeep(contract, { id: 1, name: "Ada" }); // missing address entirely
verifyContractDeep(contract, { id: 1, name: "Ada", address: { city: "London" } }); // missing zip
```

</details>

## Common pitfalls

> [!PITFALL]
> **Writing contracts that test the implementation, not the dependency.** A consumer test that
> asserts `role: "admin"` when the consumer's code never reads `role` is noise — it will fail
> whenever the provider changes that field for unrelated reasons, causing false alarms and eroding
> trust in the test suite. Pact contracts should express *minimum viable* consumer needs. Use
> `like()` matchers (type-match) rather than exact-value matchers unless the consumer genuinely
> depends on a specific value.

A second common mistake: running `pact-provider-verifier` against a live staging database instead
of a controlled test database with proper state handlers. This makes provider verification
non-deterministic and means "user 42 exists" may or may not be true depending on what happened in
staging recently.

## What you learned

- Integration tests scale as O(N²) in service pairs; contract tests scale as O(N) by decoupling
  consumer and provider verification.
- Pact's four-step flow: consumer generates pact → publishes to broker → provider verifies →
  `can-i-deploy` gates deployment.
- Provider states (`given(...)`) make provider verification deterministic and independent of
  shared test data.
- Contract tests and schema registries are complementary: schema registries guard structural
  integrity at the message level; contract tests guard semantic correctness at the consumer level.
- The `can-i-deploy` matrix check is the actual deployment gate — skipping it defeats CDC testing.

## Next steps

You now have the tools to evolve APIs safely and verify contracts between services. The final
piece of the platform engineering puzzle is how to enforce these patterns *at scale* across
hundreds of services — through golden paths, codemods, and policy as code.
*/});
