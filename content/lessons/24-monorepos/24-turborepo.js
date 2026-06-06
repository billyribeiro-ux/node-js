registerLessonSrc("24-turborepo", function () {/*
---
id: 24-turborepo
title: "Turborepo: Caching & Affected Graphs"
minutes: 26
level: advanced
objectives:
  - Configure Turborepo task pipelines in turbo.json and understand topological execution
  - Explain content-hash caching and how remote cache enables team-wide sharing
  - Compute which packages are affected by a changed file using reverse-reachability
---

# Turborepo: Caching & Affected Graphs

## Why this matters

Running `npm run build` across 30 packages takes minutes — even if only one package changed. **Turborepo** solves this with two ideas: a task-dependency graph that runs work in the right order and in parallel, and a content-hash cache that replays prior results the instant inputs are unchanged. Teams at Vercel, Shopify, and others have cut CI times from 15 minutes to under 90 seconds with these techniques. Understanding the model lets you tune pipelines, debug cache misses, and reason about "affected" builds before you ever open a turbo.json.

## Learning objectives

- Define a Turborepo **pipeline** in `turbo.json` and explain `dependsOn` semantics.
- Understand how content-hash caching works and what counts as a cache miss.
- Configure **remote cache** so the cache is shared across machines and CI runs.
- Implement reverse-reachability to find every package affected by a changed file.

## Task pipelines: turbo.json

Turborepo is configured through a single `turbo.json` at the repo root. A **pipeline** maps task names to metadata about how they depend on each other:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

The `"^build"` syntax is the key piece of notation:

- `"^build"` — run `build` in all *upstream dependencies* first (topological order).
- `"build"` (no caret) — run `build` in the *same package* first.
- No `dependsOn` — the task has no prerequisites and runs in any order.

With this config, `turbo run build` will:
1. Analyse the workspace dependency graph.
2. Schedule `build` scripts in each package only after its dependencies have finished building.
3. Run independent packages in parallel (up to the CPU count by default).

> [!OUTPUT]
> Tasks:    9 successful, 9 total
> Cached:   7 cached, 9 total
> Time:     1.042s >>> FULL TURBO

That `>>> FULL TURBO` means every task result was served from cache.

## Content-hash caching

For each task, Turborepo computes a **cache key** that is a hash of:

- All source files matched by the task's `inputs` (default: every tracked file in the package).
- The task's environment variables listed in `env`.
- The resolved versions of all dependencies.
- The `turbo.json` pipeline configuration itself.

If the cache key matches a prior run, Turborepo replays the captured `outputs` and `stdout` without re-executing the task. This is called a **cache hit**.

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json"],
      "outputs": ["dist/**"],
      "env": ["NODE_ENV", "API_URL"]
    }
  }
}
```

> [!PITFALL] Forgetting environment variables in the cache key
> If your build reads `process.env.API_URL` but you don't list `"API_URL"` in `env`, Turborepo cannot detect when it changes. A production build with a different `API_URL` will be served from the development cache and silently use the wrong URL. Always enumerate every env var that affects build output.

### Cache storage locations

By default Turborepo caches on disk at `.turbo/cache/`. You can inspect a cache entry:

```bash
# See which tasks are cached
turbo run build --dry=json

# Force a full re-run, ignoring cache
turbo run build --force
```

## Remote cache

Disk cache only helps the developer who ran the task locally. **Remote cache** uploads cache entries to a shared store so that *any* machine — your teammate's laptop, CI, a preview deployment — can benefit from prior work.

Vercel provides a hosted remote cache, and there are open-source alternatives (Turborepo Remote Cache server, Ducktape, etc.). Configuration:

```bash
# Login to Vercel and link the repo:
npx turbo login
npx turbo link

# Or point at a self-hosted remote cache:
# TURBO_API, TURBO_TOKEN, TURBO_TEAM env vars
```

```json
{
  "remoteCache": {
    "signature": true
  }
}
```

With `"signature": true`, cache entries are signed so that tampered artifacts are rejected — important for security-sensitive pipelines.

> [!PRINCIPAL] Remote cache is a build artefact store, not a secret store
> Remote cache entries are keyed by content hash and may be read by any team member with the token. Never include secrets in build outputs. The `env` array in the pipeline controls which env vars are *hashed into* the cache key — they are hashed, not stored. But if your task writes secrets to `dist/`, those secrets enter the cache. Design builds to keep secrets out of outputs.

## Affected package detection

The "affected" concept answers: given that file `packages/shared/src/types.ts` changed, which packages need to be rebuilt? The answer is the **reverse reachability** set — shared itself, plus every package that transitively depends on shared.

Turborepo computes this automatically when you use `--filter`:

```bash
# Only rebuild packages affected since the main branch diverged:
turbo run build --filter=...[origin/main]
```

The `[origin/main]` part tells Turborepo to diff the current working tree against the merge base, find which packages have changed files, and then walk the *reverse* dependency graph to collect all transitive dependents.

> [!NOTE] Affected detection requires a clean dependency graph
> Turborepo determines "which package owns this file" by mapping file paths to workspace packages. Files outside any package directory (e.g., root-level config files) are treated as affecting all packages. Keep shared config in dedicated packages rather than root-level loose files to get precise affected detection.

## Try it yourself

Implementing the reverse-reachability algorithm from scratch cements the concept. Given a forward dependency graph (A depends on B), build the reverse (B is depended on by A), then find every package transitively affected by a set of changed packages:

```js run
// Forward dep graph: pkg -> list of packages it depends on
const depGraph = {
  "api":          ["shared", "logger"],
  "cli":          ["shared"],
  "worker":       ["shared", "queue"],
  "web":          ["api", "shared"],
  "shared":       [],
  "logger":       [],
  "queue":        ["logger"]
};

// Build the REVERSE graph: for each package, who depends on it?
function buildReverseGraph(graph) {
  const rev = {};
  for (const pkg of Object.keys(graph)) rev[pkg] = [];
  for (const [pkg, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      rev[dep].push(pkg);
    }
  }
  return rev;
}

// Walk the reverse graph from each changed package (BFS)
function affected(changedPkgs, reverseGraph) {
  const visited = new Set(changedPkgs);
  const queue = [...changedPkgs];
  while (queue.length) {
    const pkg = queue.shift();
    for (const dependent of (reverseGraph[pkg] || [])) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...visited].sort();
}

const reverseGraph = buildReverseGraph(depGraph);

// Scenario 1: only "logger" changed
const changed1 = ["logger"];
console.log("Changed:", changed1.join(", "));
console.log("Affected:", affected(changed1, reverseGraph).join(", "));
// logger itself, plus queue (depends on logger), plus worker (depends on queue),
// plus api (depends on logger directly)

// Scenario 2: "shared" changed
const changed2 = ["shared"];
console.log("\nChanged:", changed2.join(", "));
console.log("Affected:", affected(changed2, reverseGraph).join(", "));
// shared, api, cli, worker, web — almost everything

// Scenario 3: a leaf package changed
const changed3 = ["web"];
console.log("\nChanged:", changed3.join(", "));
console.log("Affected:", affected(changed3, reverseGraph).join(", "));
// only web — nothing else depends on it
```

## Exercises

### Exercise 1: Filter to only directly-affected packages

Modify the `affected` function to accept a `depth` parameter: `depth=1` returns only the packages that *directly* depend on the changed set (not transitive dependents).

<details>
<summary>Show solution</summary>

```js run
const depGraph = {
  "api":    ["shared", "logger"],
  "cli":    ["shared"],
  "worker": ["shared", "queue"],
  "web":    ["api", "shared"],
  "shared": [],
  "logger": [],
  "queue":  ["logger"]
};

function buildReverseGraph(graph) {
  const rev = {};
  for (const pkg of Object.keys(graph)) rev[pkg] = [];
  for (const [pkg, deps] of Object.entries(graph)) {
    for (const dep of deps) rev[dep].push(pkg);
  }
  return rev;
}

function affectedDepth(changedPkgs, reverseGraph, depth = Infinity) {
  const visited = new Set(changedPkgs);
  let frontier = [...changedPkgs];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const pkg of frontier) {
      for (const dep of (reverseGraph[pkg] || [])) {
        if (!visited.has(dep)) {
          visited.add(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
  }
  return [...visited].sort();
}

const rev = buildReverseGraph(depGraph);

console.log("logger depth=1:", affectedDepth(["logger"], rev, 1).join(", "));
// logger, api, queue  (direct dependents only)

console.log("logger depth=2:", affectedDepth(["logger"], rev, 2).join(", "));
// logger, api, queue, worker  (one more hop)

console.log("logger depth=Inf:", affectedDepth(["logger"], rev).join(", "));
// all transitive
```

</details>

### Exercise 2: Parallel execution waves

Given a dep graph with no cycles, compute the sequence of "waves" (batches of packages that can run in parallel because all their deps are already done). This is how Turborepo schedules parallel tasks.

<details>
<summary>Show solution</summary>

```js run
// Kahn's algorithm, but instead of a flat order, group by wave
function parallelWaves(graph) {
  const inDegree = {};
  for (const pkg of Object.keys(graph)) inDegree[pkg] = 0;
  for (const deps of Object.values(graph)) {
    for (const d of deps) inDegree[d] = (inDegree[d] || 0) + 1;
  }
  const waves = [];
  let wave = Object.keys(inDegree).filter(n => inDegree[n] === 0);
  while (wave.length) {
    waves.push(wave.slice().sort());
    const next = [];
    for (const pkg of wave) {
      for (const dep of (graph[pkg] || [])) {
        inDegree[dep]--;
        if (inDegree[dep] === 0) next.push(dep);
      }
    }
    wave = next;
  }
  return waves;
}

const graph = {
  "api":    ["shared", "logger"],
  "cli":    ["shared"],
  "worker": ["queue"],
  "web":    ["api"],
  "shared": [],
  "logger": [],
  "queue":  []
};

const waves = parallelWaves(graph);
waves.forEach((w, i) => console.log(`Wave ${i + 1}:`, w.join(", ")));
// Wave 1: logger, queue, shared  (no deps)
// Wave 2: api, cli, worker       (deps satisfied)
// Wave 3: web                    (depends on api)
```

</details>

## Common pitfalls

> [!PITFALL] Marking long-running tasks as cacheable
> Setting `"cache": true` (the default) on a `dev` server task means Turborepo will try to cache it — but a dev server runs forever and never produces a stable output. Mark persistent tasks with `"cache": false` and `"persistent": true` so Turborepo knows to run them as daemons and exclude them from caching.

> [!PITFALL] outputs globs that are too broad
> If you set `"outputs": ["**"]`, Turborepo includes every file in the package in the cached output — including `node_modules` symlinks or test fixtures — making cache entries enormous. Be precise: `["dist/**", "*.tsbuildinfo"]`.

## What you learned

- `turbo.json` pipelines declare tasks with `dependsOn` (using `^` for upstream deps), `inputs`, `outputs`, and `env` to form a deterministic cache key.
- Content-hash caching replays task results when inputs are unchanged; `>>> FULL TURBO` means a complete cache hit.
- Remote cache shares entries across machines and CI so no two runs repeat the same work.
- Affected-package detection uses **reverse-reachability** (BFS on the inverted dependency graph) to find everything that transitively depends on changed packages.
- Parallel execution waves (Kahn's algorithm on the dependency graph) determine which packages can build simultaneously.

## Next steps

Fast builds are only part of the release story. When it's time to publish your packages to npm, you need a coordinated versioning strategy — especially across packages that depend on each other. The next lesson covers **Changesets**, the standard tool for semver bumps, changelogs, and coordinated monorepo releases.
*/});
