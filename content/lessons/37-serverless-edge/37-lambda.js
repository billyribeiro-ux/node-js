registerLessonSrc("37-lambda", function () {/*
---
id: 37-lambda
title: "AWS Lambda: Cold Starts & Packaging"
minutes: 22
level: advanced
objectives:
  - Understand the FaaS model and how Lambda executes your code
  - Explain cold vs warm starts and their performance impact
  - Apply concrete strategies to shrink cold-start latency and package size
---

# AWS Lambda: Cold Starts & Packaging

## Why this matters

Serverless functions can cut operational overhead to near-zero — no servers to provision, auto-scaling is automatic, and you pay only for invocations. But Lambda has a hidden cost: the **cold start**. A function that wakes from sleep may add hundreds of milliseconds to a user request, and at scale those milliseconds become your SLA ceiling. Understanding how Lambda initialises your code is the difference between "serverless is slow" and "serverless is fast and cheap".

## Learning objectives

- Describe the **FaaS model** and Lambda's execution lifecycle.
- Read and write a correct Lambda **handler signature**.
- Distinguish **cold** from **warm** starts and measure the gap.
- Apply at least four techniques to reduce cold-start latency.
- Know Lambda's key limits (memory, timeout, package size).

## The FaaS model

**Function-as-a-Service (FaaS)** is the serverless extreme: you deploy a single *function* rather than a long-running server. AWS Lambda is the archetype. You upload code; AWS handles machines, OS, runtime, networking, and scaling. The unit of billing is the millisecond of compute × megabytes of memory allocated.

```
┌────────────────────────────────────────────────────┐
│  Your code                                         │
│    └── handler(event, context) → result            │
├────────────────────────────────────────────────────┤
│  Lambda runtime (Node.js 22.x)                     │
├────────────────────────────────────────────────────┤
│  MicroVM (Firecracker) — spun up on demand         │
└────────────────────────────────────────────────────┘
```

Lambda runs each invocation inside a **Firecracker microVM** — a lightweight virtual machine that boots in milliseconds. AWS keeps VMs alive after a function finishes so the next call may reuse one (a warm start). When traffic surges or a VM has been idle too long, AWS creates a fresh one (a cold start).

## The handler signature

A Lambda handler is a Node.js function that receives three arguments:

```js
// handler.mjs (Lambda Node.js 22.x uses ESM natively)
export const handler = async (event, context) => {
  // event: the trigger payload (API Gateway request, S3 event, SQS message, …)
  // context: Lambda metadata — functionName, awsRequestId, getRemainingTimeInMillis()

  const name = event.queryStringParameters?.name ?? "world";
  return {
    statusCode: 200,
    body: JSON.stringify({ message: `Hello, ${name}!` }),
  };
};
```

> [!OUTPUT]
> // Invoked locally with AWS SAM: sam local invoke -e event.json
> { statusCode: 200, body: '{"message":"Hello, world!"}' }

The handler must return (or resolve to) a value that the runtime can serialise. For API Gateway integrations that value must include `statusCode` and `body`.

## Cold vs warm starts — the lifecycle

The first time a function is called (or when Lambda spins up a new concurrent instance) it goes through the **init phase**:

```
COLD START TIMELINE
───────────────────────────────────────────────────────
[1] Download your ZIP / container image
[2] Start the Firecracker microVM
[3] Start the Node.js process
[4] Execute module-level code (imports, top-level await)
[5] Execute your handler ← user waits from here
───────────────────────────────────────────────────────
Total extra latency: ~100 ms (tiny ZIP) to >1 s (large ZIP, lots of init code)
```

Steps 1–4 are the **init phase**. Lambda charges for them but, critically, your user *also* waits for them on the first request. Steps 1–4 only happen once per VM instance; subsequent calls on the same instance skip straight to step 5 — that is a **warm start**.

```js
// You can observe the init phase by placing code at module level:
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// This runs ONCE during init, not on every invocation:
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  // dynamo is already connected — warm-path latency is minimal
  const result = await dynamo.send(getItemCommand);
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

> [!NOTE] The module-level trick
> Any work you do at module level (outside the handler) is paid once per cold start and free on every warm call. Database connections, SDK clients, parsed config, and pre-compiled regex all belong here.

## Reducing cold starts — five concrete levers

### 1. Minimise bundle size

Lambda unzips your package before executing it. Smaller ZIP = faster download + faster Node.js parse time. Target: under 5 MB zipped.

```bash
# Bundle with esbuild — tree-shakes unused AWS SDK commands automatically
esbuild src/handler.mjs \
  --bundle --platform=node --target=node22 \
  --external:@aws-sdk/* \      # AWS SDK v3 is pre-installed in the runtime
  --minify --outfile=dist/handler.mjs
```

> [!PITFALL] Bundling the AWS SDK v3
> AWS Lambda Node.js 22.x ships with `@aws-sdk` v3 pre-installed. Bundling it anyway bloats your ZIP by 6–20 MB. Mark it `--external:@aws-sdk/*` in esbuild (or similar) to exclude it.

### 2. Move initialisation outside the handler

Already shown above: clients, configs, parsed secrets — all at module level.

### 3. Provisioned Concurrency

Lambda's **Provisioned Concurrency** pre-warms N instances permanently. Those instances have already completed the init phase, so all calls they handle are effectively warm. Cost: you pay per GB-second of provisioned capacity, even when idle.

```bash
aws lambda put-provisioned-concurrency-config \
  --function-name my-api \
  --qualifier production \
  --provisioned-concurrent-executions 10
```

### 4. Keep functions warm with scheduled pings (budget alternative)

A CloudWatch Events rule that pings the function every few minutes prevents it going fully cold. Hacky but effectively free at low scale.

### 5. Prefer arm64 (Graviton)

Graviton2 Lambda instances boot ~10% faster and cost 20% less per GB-second. Opt in at deploy time; the Node.js runtime is identical.

```bash
aws lambda update-function-configuration \
  --function-name my-api \
  --architectures arm64
```

> [!PRINCIPAL] Cold starts are a design decision, not a fact of life
> At principal level you weigh cold-start remedies against their cost. Provisioned Concurrency is pay-for-always, suitable for latency-sensitive APIs. Tiny bundles are free — pursue them first. For background jobs (S3 events, SQS consumers) cold starts rarely matter at all; invest optimisation effort where users feel it.

## Lambda limits (Node.js 22.x, 2026)

| Limit | Value |
|---|---|
| Max memory | 10 240 MB |
| Max timeout | 15 minutes |
| Deployment package (ZIP) | 50 MB zipped, 250 MB unzipped |
| Ephemeral `/tmp` storage | 512 MB – 10 GB |
| Concurrent executions (default) | 1 000 per region (soft limit) |
| Max payload (sync invoke) | 6 MB request / 6 MB response |

## Try it yourself

The pure-JS simulation below models the cold-vs-warm timing difference. A cached `initialized` flag stands in for the real Lambda execution context surviving between invocations on the same VM.

```js run
// Simulate Lambda cold vs warm invocation timing
const STATE = { initialized: false, dbClient: null };

function heavyInit() {
  // Simulate slow module-level setup (e.g. DB connect, config parse)
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum += i;
  return { connected: true, checksum: sum };
}

async function lambdaHandler(event, _context) {
  const invocationStart = performance.now();

  // Module-level init — only runs on cold start
  let initTime = 0;
  if (!STATE.initialized) {
    const t0 = performance.now();
    STATE.dbClient = heavyInit();
    initTime = performance.now() - t0;
    STATE.initialized = true;
    console.log(`[COLD START] init took ${initTime.toFixed(1)} ms`);
  }

  // Handler work — runs every invocation
  const handlerStart = performance.now();
  const response = `Hello, ${event.name ?? "world"} (db connected: ${STATE.dbClient.connected})`;
  const handlerTime = performance.now() - handlerStart;

  console.log(`[INVOKE] handler: ${handlerTime.toFixed(2)} ms | total: ${(performance.now() - invocationStart).toFixed(1)} ms`);
  return { statusCode: 200, body: response };
}

// Simulate three consecutive invocations on the same VM
(async () => {
  await lambdaHandler({ name: "Alice" }, {});   // cold
  await lambdaHandler({ name: "Bob" }, {});     // warm
  await lambdaHandler({ name: "Carol" }, {});   // warm
})();
```

## Exercise

**Challenge:** Modify the simulation so `heavyInit` is called *inside* the handler instead of at module level. Measure what happens to warm invocation times. Then move it back outside and observe the difference.

<details>
<summary>Show solution</summary>

```js run
// Init INSIDE handler — every call pays the init cost
const STATE2 = { dbClient: null };

function heavyInit() {
  let sum = 0;
  for (let i = 0; i < 2_000_000; i++) sum += i;
  return { connected: true };
}

async function naiveHandler(event) {
  const t0 = performance.now();
  // BAD: init runs every single invocation
  STATE2.dbClient = heavyInit();
  const work = `Hello ${event.name}`;
  console.log(`naiveHandler total: ${(performance.now() - t0).toFixed(1)} ms`);
  return work;
}

// Init OUTSIDE handler (correct pattern)
const GOOD_CLIENT = heavyInit(); // runs once

async function goodHandler(event) {
  const t0 = performance.now();
  const work = `Hello ${event.name} (db: ${GOOD_CLIENT.connected})`;
  console.log(`goodHandler total: ${(performance.now() - t0).toFixed(2)} ms`);
  return work;
}

(async () => {
  console.log("--- naive (init inside) ---");
  await naiveHandler({ name: "A" });
  await naiveHandler({ name: "B" });

  console.log("--- optimised (init outside) ---");
  await goodHandler({ name: "A" });
  await goodHandler({ name: "B" });
})();
```

The naive approach re-runs `heavyInit` on every call; the optimised approach runs it once and reuses the result.
</details>

## Common pitfalls

> [!PITFALL] Assuming warm starts are guaranteed
> Lambda *may* reuse an execution environment, but it never *must*. Your handler must be correct on a cold start every time. Never rely on module-level state being present from a previous invocation — if Lambda scaled to zero or rotated the VM, that state is gone. Cache, but validate.

> [!PITFALL] Secrets in environment variables vs. AWS Secrets Manager
> Environment variables are read at cold-start time. If you rotate a secret, running warm instances keep the old value until they recycle. For high-rotation secrets, fetch from Secrets Manager inside the handler (with a short-lived in-memory cache) to pick up changes quickly.

## What you learned

- Lambda wraps your handler in a **Firecracker microVM**; AWS may reuse it (warm) or start fresh (cold).
- Cold starts add init phase time: VM boot + Node.js start + module-level code.
- Move expensive setup **outside the handler** so warm calls skip it entirely.
- Shrink bundle size (tree-shaking, esbuild, exclude pre-installed SDK), use **Provisioned Concurrency** for latency-sensitive paths, and prefer **arm64** for cheaper, faster VMs.
- Lambda has hard limits on timeout (15 min), package size (250 MB unzipped), and payload (6 MB).

## Next steps

Lambda runs your code on full Node.js inside a VM. The next lesson explores Cloudflare Workers — a radically different model where your code runs in lightweight V8 isolates at the network edge, with only Web-standard APIs available.
*/});
