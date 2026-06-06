registerLessonSrc("36-github-actions", function () {/*
---
id: 36-github-actions
title: "GitHub Actions: Lint, Test, Build & Release"
minutes: 24
level: advanced
objectives:
  - Understand CI/CD concepts and the GitHub Actions execution model
  - Write a multi-job workflow with matrix builds, caching, and artifacts
  - Automate releases with semantic-release and protect secrets
---

# GitHub Actions: Lint, Test, Build & Release

## Why this matters

Shipping software by hand is slow and error-prone. **Continuous Integration (CI)** means every push is automatically linted, tested, and built — catching regressions in minutes instead of discovering them in production. **Continuous Delivery (CD)** extends that by automatically publishing releases. GitHub Actions bakes this pipeline directly into your repository, with zero separate infrastructure to provision.

## Learning objectives

- Explain CI/CD and how GitHub Actions orchestrates workflows.
- Write a real lint + test + build pipeline with matrix builds and dependency caching.
- Upload artifacts, use encrypted secrets, and trigger automated releases with `semantic-release`.

## CI/CD in one mental model

Think of CI/CD as a **factory assembly line**:

```
push/PR ──► lint ──► test ──► build ──► release
              ▲         ▲        ▲
           fails?    fails?   fails?
              └─────────┴────────┘
                  report & stop
```

The line stops the moment anything breaks, giving developers fast feedback. The whole pipeline should run in a few minutes so developers don't context-switch away.

## The anatomy of a GitHub Actions workflow

Workflow files live in `.github/workflows/*.yml`. Their top-level keys are:

| Key | Purpose |
|---|---|
| `name` | Human-readable label shown in the UI |
| `on` | Event(s) that trigger the workflow |
| `env` | Workflow-level environment variables |
| `jobs` | Map of jobs; each runs on its own runner VM |

Each **job** has:

- `runs-on` — the runner image (`ubuntu-24.04`, `windows-latest`, etc.)
- `needs` — other jobs that must succeed first (creates a DAG)
- `steps` — ordered list of shell commands or `uses` actions

```js
// .github/workflows/ci.yml
// (read-only — YAML shown as a JS block comment to illustrate structure)
//
// name: CI
//
// on:
//   push:
//     branches: [main]
//   pull_request:
//
// jobs:
//   lint:
//     runs-on: ubuntu-24.04
//     steps:
//       - uses: actions/checkout@v4
//       - uses: actions/setup-node@v4
//         with:
//           node-version: 22
//           cache: npm
//       - run: npm ci
//       - run: npm run lint
//
//   test:
//     needs: lint
//     runs-on: ubuntu-24.04
//     steps:
//       - uses: actions/checkout@v4
//       - uses: actions/setup-node@v4
//         with:
//           node-version: 22
//           cache: npm
//       - run: npm ci
//       - run: npm test
```

> [!NOTE] `npm ci` vs `npm install`
> In CI you almost always want `npm ci`. It installs exactly what `package-lock.json` specifies, fails if the lock file is out of sync, and is significantly faster because it skips resolution.

## Matrix builds

Matrix builds let you test across **multiple versions or platforms** in parallel without duplicating YAML:

```js
// jobs:
//   test:
//     strategy:
//       matrix:
//         node-version: [20, 22, 24]
//         os: [ubuntu-24.04, windows-latest]
//     runs-on: ${{ matrix.os }}
//     steps:
//       - uses: actions/checkout@v4
//       - uses: actions/setup-node@v4
//         with:
//           node-version: ${{ matrix.node-version }}
//           cache: npm
//       - run: npm ci
//       - run: npm test
```

> [!OUTPUT]
> 6 jobs run in parallel (3 Node versions × 2 OSes).
> All must pass for the matrix to succeed.

> [!PRINCIPAL] Fail-fast vs exhaustive matrices
> By default, GitHub cancels remaining matrix jobs when one fails (`fail-fast: true`). For library authors this is usually wrong — you want to know *all* failing combinations at once. Set `strategy.fail-fast: false` so every cell runs to completion and you get the full picture in one workflow run.

## Caching dependencies

Without caching, every run downloads hundreds of megabytes of `node_modules`. The `actions/setup-node` action's built-in `cache: npm` key is all you need — it hashes `package-lock.json` and restores the npm cache directory automatically:

```js
// - uses: actions/setup-node@v4
//   with:
//     node-version: 22
//     cache: npm        # hashes package-lock.json; restores ~/.npm
```

For Yarn or pnpm, pass `cache: yarn` or `cache: pnpm` respectively.

> [!PITFALL] Don't cache `node_modules` directly
> Caching the `node_modules` folder itself is fragile — symlinks break across OSes and native addons must be rebuilt per platform. Cache the package manager's *download cache* (`~/.npm`) instead and let `npm ci` do the install. The `actions/setup-node` built-in does exactly this.

## Artifacts

Artifacts persist files between jobs (or for download after a run):

```js
// build:
//   needs: test
//   runs-on: ubuntu-24.04
//   steps:
//     - uses: actions/checkout@v4
//     - uses: actions/setup-node@v4
//       with: { node-version: 22, cache: npm }
//     - run: npm ci
//     - run: npm run build          # produces dist/
//     - uses: actions/upload-artifact@v4
//       with:
//         name: dist
//         path: dist/
//         retention-days: 7
```

A downstream job can then `uses: actions/download-artifact@v4` to fetch `dist/` without rebuilding.

## Secrets and environment variables

Secrets are stored encrypted in GitHub's vault (Settings → Secrets) and injected as environment variables at runtime. They are **never** logged — GitHub redacts them from output.

```js
// - name: Publish to npm
//   run: npm publish
//   env:
//     NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

```js
// - uses: actions/setup-node@v4
//   with:
//     node-version: 22
//     registry-url: https://registry.npmjs.org
```

## Automated releases with semantic-release

`semantic-release` reads commit messages following the **Conventional Commits** convention and decides the next version automatically:

| Commit prefix | Release type |
|---|---|
| `fix:` | patch (1.2.3 → 1.2.4) |
| `feat:` | minor (1.2.3 → 1.3.0) |
| `feat!:` or `BREAKING CHANGE` | major (1.2.3 → 2.0.0) |

```js
// release:
//   needs: build
//   runs-on: ubuntu-24.04
//   if: github.ref == 'refs/heads/main'
//   permissions:
//     contents: write
//     id-token: write
//   steps:
//     - uses: actions/checkout@v4
//       with:
//         fetch-depth: 0   # semantic-release needs the full git history
//     - uses: actions/setup-node@v4
//       with:
//         node-version: 22
//         cache: npm
//         registry-url: https://registry.npmjs.org
//     - run: npm ci
//     - run: npx semantic-release
//       env:
//         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
//         NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> [!OUTPUT]
> [semantic-release] - Analysis of 8 commits...
> [semantic-release] - The next release version is 2.1.0
> [semantic-release] - Publishing to npm...
> [semantic-release] - Published v2.1.0 to registry

## Try it yourself

A real pipeline can't run in the browser, but the *logic* of a CI pipeline — "run stages in order, stop on first failure" — is pure algorithm. Let's build a pipeline runner that models exactly that:

```js run
// A pipeline runner that executes stages in order,
// stops on the first failure, and reports the result.
// Models the semantics of a real CI pipeline.

function createPipeline(stages) {
  return async function run() {
    const results = [];
    for (const stage of stages) {
      console.log(`[pipeline] running stage: ${stage.name}`);
      const start = Date.now();
      try {
        await stage.fn();
        const ms = Date.now() - start;
        results.push({ name: stage.name, status: "passed", ms });
        console.log(`  [ok] ${stage.name} (${ms}ms)`);
      } catch (err) {
        const ms = Date.now() - start;
        results.push({ name: stage.name, status: "failed", ms, error: err.message });
        console.log(`  [fail] ${stage.name}: ${err.message}`);
        break; // stop on first failure, like real CI
      }
    }

    const failed = results.find(r => r.status === "failed");
    if (failed) {
      console.log(`\nPipeline FAILED at stage "${failed.name}"`);
    } else {
      console.log(`\nPipeline PASSED (${results.length} stages)`);
    }
    return results;
  };
}

// Simulated stages with artificial delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const pipeline = createPipeline([
  {
    name: "lint",
    fn: async () => {
      await delay(30);
      // Simulate: all files pass lint
    }
  },
  {
    name: "test",
    fn: async () => {
      await delay(50);
      // Simulate: one test fails
      throw new Error("AssertionError: expected 42 but got 41");
    }
  },
  {
    name: "build",
    fn: async () => {
      await delay(40);
      // This should not run because test failed
    }
  }
]);

pipeline();
```

## Exercise: add matrix support to the pipeline runner

Extend the runner to support a **matrix** dimension: run the full pipeline for each Node version in `[20, 22, 24]`, collecting results from all three.

<details>
<summary>Show solution</summary>

```js run
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runForVersion(version) {
  const stages = ["lint", "test", "build"];
  const results = [];
  for (const stage of stages) {
    await delay(10);
    // Simulate node 20 failing the test stage
    if (version === 20 && stage === "test") {
      results.push({ stage, status: "failed", error: "node 20 test incompatibility" });
      break;
    }
    results.push({ stage, status: "passed" });
  }
  return { version, results };
}

async function matrixRun(versions) {
  // run all versions in parallel (fail-fast: false)
  const runs = await Promise.all(versions.map(runForVersion));
  for (const { version, results } of runs) {
    const failed = results.find(r => r.status === "failed");
    const label = failed ? "FAIL" : "PASS";
    console.log(`node-${version}: [${label}]`, results.map(r => r.stage).join(" → "));
    if (failed) console.log(`  Error: ${failed.error}`);
  }
}

matrixRun([20, 22, 24]);
```

</details>

## Common pitfalls

> [!PITFALL] Triggering infinite loops with workflow_run
> When a workflow triggers another workflow (via `workflow_run`), it is easy to create a cycle where Release triggers Build triggers Release. Always gate release jobs with `if: github.ref == 'refs/heads/main'` and use separate workflow files with explicit `on:` triggers to keep the graph acyclic.

Another common mistake: checking in `.env` files or hardcoding tokens in YAML. Always use `secrets.*` references and add `.env` to `.gitignore`. GitHub will warn you if it detects a pushed secret, but prevention is better than remediation.

## What you learned

- GitHub Actions workflows are YAML files triggered by Git events; jobs run on isolated VMs and are wired into a DAG via `needs`.
- Matrix builds fan out across Node versions and OSes in a single workflow definition, saving duplication.
- `actions/setup-node`'s `cache: npm` restores the npm download cache keyed on `package-lock.json`.
- Artifacts persist build outputs between jobs; secrets are encrypted, injected at runtime, and automatically redacted from logs.
- `semantic-release` reads Conventional Commits to derive the next version and publish automatically.

## Next steps

A solid CI/CD pipeline gets code deployed — but deployed *where*, and *how* does it stay running at scale? Next up: Kubernetes Pods, Deployments, and Services, the foundation of container orchestration.
*/});
