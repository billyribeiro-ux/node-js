registerLessonSrc("49-paved-roads", function () {/*
---
id: 49-paved-roads
title: "Paved Roads, Golden Paths & Codemods at Scale"
minutes: 30
level: advanced
objectives:
  - Articulate the platform-as-product model and why golden paths reduce cognitive load at scale
  - Design a codemod using AST transforms to migrate deprecated API usage across a large codebase
  - Measure and drive adoption of platform standards using policy-as-code and telemetry
---

# Paved Roads, Golden Paths & Codemods at Scale

## Why this matters

The defining challenge of platform engineering at hundreds-of-services scale is not building the
right tool — it is ensuring that the right tool gets used consistently across every service,
maintained by dozens of teams, for years. Golden paths and codemods are the engineering answer:
you make the correct choice the *easy* choice, and you automate the migration from old patterns
to new ones so that "upgrade 300 services" becomes a single CI job rather than a year of manual
PRs. A distinguished engineer who can do this at scale multiplies the productivity of the entire
organisation.

## Learning objectives

- Define the platform-as-product mental model and explain why adoption is the primary metric.
- Describe golden paths, paved roads, and internal developer platforms (IDPs) and their concrete
  components.
- Build a codemod using jscodeshift/AST transforms that rewrites deprecated API calls across
  many files simultaneously.
- Enforce platform standards with org-wide lint rules and policy as code.
- Design an adoption measurement strategy using telemetry, scorecards, and automated PRs.

## Platform as product

A platform team's output is not infrastructure — it is *developer experience*. The customer is
internal: the application engineers who deploy services. If they don't adopt your platform, it
has failed regardless of how well it was built. This reframing has concrete consequences:

- **Adoption is the north-star metric**, not uptime or feature count.
- The team needs a product manager (or someone filling that role) to prioritise based on developer
  pain, not on what's technically interesting to build.
- Platform changes need release notes, changelogs, migration guides, and sometimes a support
  channel — the same care you'd give an external API.

> [!PRINCIPAL]
> Paved roads are opt-in; guard rails are opt-out. The distinction matters politically and
> technically. A paved road is a high-quality, well-maintained path that makes the right thing
> easy. A guard rail is a policy that prevents the wrong thing. Starting with guard rails on a
> platform that hasn't yet earned trust generates resistance and workarounds. Start with paved
> roads that deliver genuine value; add guard rails once adoption is high enough that you have
> the political capital to enforce them.

## Golden paths and internal developer platforms

A **golden path** is the opinionated, fully-supported route for a common task: "how to create a
new service," "how to add an endpoint," "how to instrument for observability." It bundles:

- **Scaffolding / templates**: `npx create-myco-service my-service` that generates a repository
  with the correct structure, default dependencies, CI pipeline, Dockerfile, and initial tests.
- **Documentation**: A single page that explains *what* to do and *why* each choice was made.
- **Automated upgrades**: When the platform evolves, the upgrade path is automated (a codemod, a
  `dependabot`-style PR, a version bump script).
- **Observability hooks**: Metrics, logging, and tracing configured by default — not as an
  afterthought.

An **Internal Developer Platform (IDP)** is the product surface of all of this: a portal, API,
and CLI that lets engineers self-serve creation, configuration, and deployment without filing
tickets or waiting for a platform engineer to intervene.

```js
// Scaffolding CLI — read-only (real Node APIs)
// Typical implementation uses a template engine over a file tree
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

async function scaffold(serviceName, targetDir) {
  await cp("./templates/service", targetDir, { recursive: true });

  // Interpolate service name into package.json
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.name = serviceName;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

  execSync("git init && git add -A && git commit -m 'chore: scaffold'", { cwd: targetDir });
  console.log(`Service '${serviceName}' scaffolded at ${targetDir}`);
}
```

> [!OUTPUT]
> Service 'payment-gateway' scaffolded at /workspace/payment-gateway

## Large-scale automated migrations with codemods

When you need to migrate 300 services from `oldApi()` to `newApi()`, you have three choices:

1. Document the change and ask teams to update — takes months, rarely completes.
2. Run a find-and-replace script — breaks on non-trivial cases (renamed arguments, swapped
   parameter order, default value changes).
3. **Write a codemod that operates on the AST** — handles all syntactic variations correctly,
   can be reviewed, tested, and applied atomically.

**jscodeshift** is the standard tool: it wraps the `recast` AST library, applies your transform
function to each file's AST, and writes back only the changed files while preserving formatting.

```bash
# Apply a codemod to every JS file in the monorepo
npx jscodeshift \
  --transform=./codemods/migrate-logger-v2.js \
  --extensions=js,ts \
  --parser=babel \
  services/
```

> [!OUTPUT]
> Processing 847 files...
> ok  213
> unmodified 634
> error 0
> Results: 213 files changed, 634 unmodified.

A typical jscodeshift transform:

```js
// codemods/migrate-logger-v2.js — read-only (jscodeshift transform)
// Rewrites: logger.log(msg, level) → logger.write({ message: msg, level })

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object: { name: "logger" },
        property: { name: "log" },
      },
    })
    .forEach((path) => {
      const [msgArg, levelArg] = path.node.arguments;
      // Replace with logger.write({ message: msg, level: level })
      path.node.callee.property.name = "write";
      path.node.arguments = [
        j.objectExpression([
          j.property("init", j.identifier("message"), msgArg),
          j.property("init", j.identifier("level"), levelArg ?? j.stringLiteral("info")),
        ]),
      ];
    });

  return root.toSource();
}
```

> [!PRINCIPAL]
> The real cost of a codemod is not writing it — it's testing it. A codemod applied to 847 files
> with a subtle bug corrupts 847 files simultaneously. The discipline: (1) build a fixture-based
> test suite (input file → expected output file) covering every edge case before running on the
> monorepo; (2) run with `--dry` first and spot-check the diff; (3) apply in a single commit
> named `chore: codemod migrate-logger-v2` so it can be reverted atomically; (4) run linters and
> tests after applying to catch any semantic breakage the AST transform didn't anticipate. Treat
> codemods as production-grade code, not one-off scripts.

## Org-wide lint and policy as code

Lint rules codify platform decisions as enforceable constraints rather than documentation that
gets ignored. Custom ESLint rules can catch:

- Import from a banned internal package that has a deprecated API.
- Missing required metadata in service manifests.
- Use of `process.exit()` in library code (should throw instead).
- Disallowed HTTP methods in endpoint definitions.

A minimal custom ESLint rule in the flat-config format (Node 24 / ESLint 9):

```js
// eslint-rules/no-legacy-logger.js — read-only
// Enforces logger.write() over logger.log()
export default {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      useWrite: "Use logger.write({ message, level }) instead of logger.log(). Run the migration codemod.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "logger" &&
          node.callee.property.name === "log"
        ) {
          context.report({ node, messageId: "useWrite" });
        }
      },
    };
  },
};
```

> [!OUTPUT]
> /services/auth/src/index.js
>   47:3  error  Use logger.write({ message, level }) instead of logger.log().  no-legacy-logger

Ship custom rules as an internal npm package (`@myco/eslint-config`) and extend it in every
service's ESLint config. Enforcement in CI means the codemod produces the correct code the
first time, and the rule prevents regression.

## Measuring adoption

The adoption funnel for a platform change:

```
Aware → Can use → Do use → Correctly use
```

Instrumentation for each stage:

- **Telemetry from the platform itself**: track which service version of your SDK is deployed to
  production. A version map gives you instant adoption visibility.
- **Scorecards / paved-road compliance reports**: compute a score per service (e.g., "uses
  approved logger: yes/no", "on current scaffold version: yes/no") and publish dashboards.
- **Automated PRs**: when a new scaffold version is released, open a PR in every lagging service
  with the diff already applied. The team just reviews and merges. This dramatically compresses
  the upgrade cycle from months to days.

```js
// Adoption scorecard computation — read-only
async function computeScorecard(services) {
  return services.map(svc => ({
    name: svc.name,
    score: [
      svc.loggerVersion >= 2          ? 1 : 0,   // Using logger v2+
      svc.hasContractTests            ? 1 : 0,   // Contract tests present
      svc.scaffoldVersion === "latest" ? 1 : 0,  // On current template
      svc.hasSunsetHeader             ? 1 : 0,   // Deprecation headers in place
    ].reduce((a, b) => a + b, 0),
  }));
}
```

## Try it yourself

Build a mini codemod engine: given a list of "files" represented as strings of pseudo-source
code, walk a simplified AST-like representation and rewrite every call to a deprecated function
to its replacement. This models the exact logic used by jscodeshift transforms.

```js run
// Mini codemod: rewrite deprecated API calls across many "files"
// The "AST" is a simple token tree: { type, name?, args?, children? }

function parseCallExpr(src) {
  // Tokenise a simple "funcName(arg1, arg2)" pattern
  const match = src.trim().match(/^(\w+)\((.*)\)$/);
  if (!match) return null;
  return {
    type: "CallExpression",
    name: match[1],
    args: match[2].split(",").map(a => a.trim()).filter(Boolean),
  };
}

function applyTransform(node, rules) {
  if (node.type !== "CallExpression") return node;
  const rule = rules[node.name];
  if (!rule) return node;
  return rule(node);
}

function serializeCall(node) {
  return `${node.name}(${node.args.join(", ")})`;
}

function codemod(source, rules) {
  // Process each line that looks like a call expression
  return source.split("\n").map(line => {
    const node = parseCallExpr(line);
    if (!node) return line;
    const transformed = applyTransform(node, rules);
    const result = serializeCall(transformed);
    if (result !== line.trim()) {
      return `  ${result}  // [MIGRATED from: ${line.trim()}]`;
    }
    return line;
  }).join("\n");
}

// Migration rules: old API → new API transform functions
const migrationRules = {
  // logger.log(msg, level) → logger.write(msg, level) already handled as name change
  "logError": (node) => ({
    type: "CallExpression",
    name: "logger.error",
    args: node.args,
  }),
  "makeRequest": (node) => ({
    type: "CallExpression",
    // makeRequest(url, opts) → fetchJson(url, opts) with added timeout
    name: "fetchJson",
    args: [...node.args, "{ timeout: 5000 }"],
  }),
  "getConfig": (node) => ({
    type: "CallExpression",
    // getConfig(key) → config.get(key) — namespace change
    name: "config.get",
    args: node.args,
  }),
};

// Simulate 3 service files
const files = [
  {
    name: "services/auth/index.js",
    src: [
      "logError(err.message, err.stack)",
      "const data = makeRequest(endpoint, options)",
      "const val = getConfig('DB_HOST')",
      "console.log('starting auth service')",  // no rule — unchanged
    ].join("\n"),
  },
  {
    name: "services/payments/handler.js",
    src: [
      "logError('payment failed', context)",
      "makeRequest(paymentUrl, payload)",
    ].join("\n"),
  },
  {
    name: "services/users/service.js",
    src: [
      "getConfig('REDIS_URL')",
      "getConfig('MAX_POOL')",
      "makeRequest(apiUrl, body)",
    ].join("\n"),
  },
];

let totalMigrated = 0;

for (const file of files) {
  const output = codemod(file.src, migrationRules);
  const migratedLines = output.split("\n").filter(l => l.includes("[MIGRATED")).length;
  totalMigrated += migratedLines;
  console.log(`\n=== ${file.name} (${migratedLines} changes) ===`);
  console.log(output);
}

console.log(`\nTotal: ${totalMigrated} API calls migrated across ${files.length} files.`);
```

## Exercise: add a rename-and-reorder rule

Extend the migration rules above to handle `oldFetch(opts, url)` → `newFetch(url, opts)` — a
parameter swap, not just a rename. Parameter reordering is the trickiest case in real codemods.

<details>
<summary>Show solution</summary>

```js run
function parseCallExpr(src) {
  const match = src.trim().match(/^(\w+)\((.*)\)$/);
  if (!match) return null;
  return {
    type: "CallExpression",
    name: match[1],
    args: match[2].split(",").map(a => a.trim()).filter(Boolean),
  };
}

function applyTransform(node, rules) {
  if (node.type !== "CallExpression") return node;
  const rule = rules[node.name];
  if (!rule) return node;
  return rule(node);
}

function serializeCall(node) {
  return `${node.name}(${node.args.join(", ")})`;
}

function codemod(source, rules) {
  return source.split("\n").map(line => {
    const node = parseCallExpr(line);
    if (!node) return line;
    const transformed = applyTransform(node, rules);
    const result = serializeCall(transformed);
    if (result !== line.trim()) return `${result}  // migrated`;
    return line;
  }).join("\n");
}

const rules = {
  // Swap args: oldFetch(opts, url) → newFetch(url, opts)
  "oldFetch": (node) => {
    const [opts, url] = node.args; // old order
    return { type: "CallExpression", name: "newFetch", args: [url, opts] };
  },
};

const src = [
  "oldFetch({ timeout: 3000 }, 'https://api.example.com/users')",
  "oldFetch(requestOpts, baseUrl + '/items')",
  "console.log('done')",
].join("\n");

console.log(codemod(src, rules));
// newFetch('https://api.example.com/users', { timeout: 3000 })  // migrated
// newFetch(baseUrl + '/items', requestOpts)  // migrated
// console.log('done')
```

In jscodeshift you access `path.node.arguments[0]` and `[1]` directly on the AST node and swap
the references — the printer handles all serialisation correctly, including multi-line arguments
and comments.
</details>

## Project

**Define an API-evolution policy with contract tests in CI, and ship a codemod that migrates every service to a new standard.**

You are the platform engineer for a company with 20 Node.js microservices. The team has decided
to migrate from a legacy `request(url, callback)` HTTP client to a modern `apiFetch(url, opts)`
promise-based client. Three services also need their logger calls updated from
`log(msg, { level })` to `logger.emit(level, msg)` (argument order swap + name change). You must:

1. **Policy document (in code comments):** define a formal API evolution policy: what constitutes
   a breaking vs compatible change, how many days' notice before a sunset, and how `can-i-deploy`
   is used as the deployment gate.

2. **Contract file format:** define a JSON contract schema (a plain JS object) that a consumer
   service publishes, listing the provider, required fields, and their types. At minimum: provider
   name, endpoint path, HTTP method, required response fields with types.

3. **Contract verifier:** implement `verifyContract(contract, actualResponse)` that returns an
   array of violations. Zero violations means the deployment gate passes.

4. **Codemod — HTTP client migration:** implement a `codemigrate(source, rules)` function that
   accepts source code as a string and a rules map, and rewrites every `request(url, cb)` call to
   `apiFetch(url).then(cb)` across arbitrary "files."

5. **Codemod — logger migration:** the logger migration swaps argument order: `log(msg, { level })`
   → `logger.emit(level, msg)`. Implement this as a second rule in the same codemod engine.

6. **Adoption scorecard:** implement `scoreServices(services)` that takes an array of service
   descriptors and returns each service's compliance score (0–4) across: using apiFetch, using new
   logger, having a published contract, being on the current scaffold version.

Acceptance criteria:
- The codemod produces exactly the expected output for every fixture (test input → output pair).
- The contract verifier correctly identifies all violation types: missing field, type mismatch,
  unexpected null.
- `scoreServices` returns correct scores for a mixed set of compliant and non-compliant services.
- The policy constants (sunset notice days, required fields in a contract) are defined in a single
  config object so they can be updated in one place.
- All six services in the starter have their codemod applied and score at least 3/4.
- The entire solution runs as a single `js run` block with no imports.

```js run
// PROJECT STARTER — API Evolution Policy + Contract Tests + Codemod
// Pure browser JS: no imports, no Node APIs.

// ─── 1. Policy constants ──────────────────────────────────────────────────────
const POLICY = {
  sunsetNoticeDays: 180,          // Minimum notice before an endpoint sunset
  breakingChangeGate: "can-i-deploy",  // CI tool that gates deployments
  compatibleChanges: ["add-optional-field", "widen-type", "required-to-optional"],
  breakingChanges:   ["remove-field", "rename-field", "add-required-field",
                      "narrow-type", "change-field-type"],
};

// ─── 2. Contract format & verifier ───────────────────────────────────────────
function verifyContract(contract, response) {
  const violations = [];
  for (const [field, spec] of Object.entries(contract.requiredFields)) {
    const val = response[field];
    if (val === undefined || val === null) {
      violations.push(`MISSING or NULL: '${field}' (expected ${spec.type})`);
      continue;
    }
    const actualType = Array.isArray(val) ? "array" : typeof val;
    if (actualType !== spec.type) {
      violations.push(`TYPE MISMATCH: '${field}' expected ${spec.type}, got ${actualType}`);
    }
  }
  return violations;
}

// ─── 3. Codemod engine ────────────────────────────────────────────────────────
function parseCall(line) {
  const m = line.trim().match(/^(\w+)\(([\s\S]*)\)$/);
  if (!m) return null;
  // Naive arg split on top-level commas (good enough for this model)
  let depth = 0, current = "", args = [];
  for (const ch of m[2]) {
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    if (ch === "," && depth === 0) { args.push(current.trim()); current = ""; }
    else current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return { name: m[1], args };
}

function codemigrate(source, rules) {
  return source.split("\n").map(line => {
    const call = parseCall(line);
    if (!call || !rules[call.name]) return line;
    const result = rules[call.name](call);
    return `${result}  // [migrated from: ${line.trim()}]`;
  }).join("\n");
}

const migrationRules = {
  // request(url, cb) → apiFetch(url).then(cb)
  "request": ({ args: [url, cb] }) =>
    cb ? `apiFetch(${url}).then(${cb})` : `apiFetch(${url})`,

  // log(msg, { level }) → logger.emit(level, msg)  — arg swap + rename
  "log": ({ args: [msg, levelObj] }) => {
    // Extract level value from "{ level }" or "{ level: 'info' }"
    const levelMatch = levelObj && levelObj.match(/level:\s*['"]?(\w+)['"]?/);
    const level = levelMatch ? `'${levelMatch[1]}'` : (levelObj || "'info'");
    return `logger.emit(${level}, ${msg})`;
  },
};

// ─── 4. Adoption scorecard ────────────────────────────────────────────────────
function scoreServices(services) {
  return services.map(svc => {
    const checks = [
      svc.usesApiFetch,
      svc.usesNewLogger,
      svc.hasContract,
      svc.scaffoldVersion === "3.0",
    ];
    return {
      name: svc.name,
      score: checks.filter(Boolean).length,
      max: checks.length,
      details: ["apiFetch", "new-logger", "contract", "scaffold-v3"].map((label, i) =>
        `${label}: ${checks[i] ? "ok" : "MISSING"}`),
    };
  });
}

// ─── 5. Demo fixtures ─────────────────────────────────────────────────────────

// Contract verification
const contract = {
  provider: "UserService",
  endpoint: "/users/:id",
  method: "GET",
  requiredFields: {
    id:    { type: "number" },
    name:  { type: "string" },
    email: { type: "string" },
  },
};

console.log("=== Contract Verification ===");
const good = { id: 1, name: "Ada", email: "ada@example.com" };
const bad1 = { id: 1, name: "Ada" };                  // missing email
const bad2 = { id: "1", name: "Ada", email: null };   // type + null

console.log("Good response:", verifyContract(contract, good).length === 0 ? "PASS" : "FAIL");
console.log("Missing email:", verifyContract(contract, bad1));
console.log("Type/null errors:", verifyContract(contract, bad2));

// Codemod migration
console.log("\n=== Codemod ===");
const services = [
  { name: "auth",     src: "request('https://idp/verify', handleResp)\nlog('login', { level: 'info' })" },
  { name: "payments", src: "request(payUrl, onResult)\nlog('charge', { level: 'warn' })" },
  { name: "users",    src: "log('lookup', { level: 'debug' })\nconsole.log('health')" },
];

for (const svc of services) {
  const migrated = codemigrate(svc.src, migrationRules);
  const changes = migrated.split("\n").filter(l => l.includes("[migrated")).length;
  console.log(`\n${svc.name} (${changes} changes):\n${migrated}`);
}

// Scorecard
console.log("\n=== Adoption Scorecard ===");
const registry = [
  { name: "auth",     usesApiFetch: true,  usesNewLogger: true,  hasContract: true,  scaffoldVersion: "3.0" },
  { name: "payments", usesApiFetch: true,  usesNewLogger: false, hasContract: true,  scaffoldVersion: "2.1" },
  { name: "users",    usesApiFetch: false, usesNewLogger: true,  hasContract: false, scaffoldVersion: "3.0" },
  { name: "orders",   usesApiFetch: false, usesNewLogger: false, hasContract: false, scaffoldVersion: "1.9" },
];

const scores = scoreServices(registry);
for (const svc of scores) {
  console.log(`\n${svc.name}: ${svc.score}/${svc.max}`);
  svc.details.forEach(d => console.log("  " + d));
}
const compliant = scores.filter(s => s.score >= 3).length;
console.log(`\nCompliance rate: ${compliant}/${scores.length} services at 3+/4`);
```

## Common pitfalls

> [!PITFALL]
> **Codemods that parse with regex instead of an AST.** Regex-based rewrites work on simple cases
> but break on multiline arguments, nested calls, template literals, and comment placement. A
> single edge case in production code will corrupt the file silently. Use jscodeshift with its
> `recast`-based printer, which preserves original formatting for all untouched AST nodes and only
> re-prints what you changed. Invest in the AST; the regex shortcut always fails at scale.

A second trap: **measuring output instead of outcome.** The scorecard says 90% of services are on
the new logger. But if the codemod introduced a subtle argument-order bug in 10% of those, the
metric is green while real observability is broken. Codemods need automated tests against fixture
inputs, not just "the files changed."

> [!PRINCIPAL]
> The hardest part of large-scale migrations is the last 10–15%. Early adopters self-migrate;
> the long tail is teams that are busy, understaffed, or actively avoiding the change. The highest-
> leverage tool for the long tail is the **automated PR**: a bot opens a PR in every non-compliant
> repo with the codemod already applied, tests passing, and a link to the migration guide. The
> team's job reduces to reviewing and merging. At Google (Rosie) and Meta (MLS), automated large-
> scale changes (LSCs) are how thousands of services move in concert without a central team
> manually touching each one. Build the bot, not the ticketing backlog.

## What you learned

- Platform-as-product means adoption is your metric; paved roads (opt-in) build trust before
  guard rails (opt-out) can be enforced.
- Golden paths bundle scaffolding, docs, observability defaults, and automated upgrade paths into
  a coherent developer experience.
- Codemods use AST transforms (jscodeshift + recast) to rewrite code across hundreds of files
  correctly, handling all syntactic variations that regex cannot.
- Custom ESLint rules enforce platform standards in CI, preventing regression after codemods run.
- Adoption scorecards + automated PRs are the engineering mechanism for driving the long tail of
  non-compliant services to completion.

## Next steps

You now have the full platform engineering toolkit: API evolution, contract testing, and automated
migration at scale. The final module explores the craft of distinguished engineering itself —
technical judgment, influence, and building systems that outlast any individual.
*/});
