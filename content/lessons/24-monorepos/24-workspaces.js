registerLessonSrc("24-workspaces", function () {/*
---
id: 24-workspaces
title: "Workspaces & Internal Packages"
minutes: 24
level: advanced
objectives:
  - Understand the benefits and tradeoffs of a monorepo structure
  - Configure npm or pnpm workspaces and link internal packages
  - Share configuration (tsconfig, eslint) across packages without duplication
---

# Workspaces & Internal Packages

## Why this matters

As a product grows, teams reach for a **monorepo**: one Git repository containing multiple packages — an API server, a CLI, a shared types library, a React app — all versioned together. Every major tech company (Google, Meta, Vercel, Nx) runs some version of this. Understanding workspace mechanics helps you reason about dependency resolution, build order, and why your internal package changes are picked up instantly without publishing to npm.

## Learning objectives

- Articulate the benefits *and* real tradeoffs of a monorepo.
- Configure `npm` or `pnpm` workspaces and use the `workspace:` protocol.
- Share `tsconfig.json` and `eslint` config across packages via internal packages.
- Resolve a package dependency graph and detect cycles — the algorithm that workspace tools run under the hood.

## Monorepo benefits and tradeoffs

A **monorepo** is not just "multiple projects in one folder". The key property is that packages can depend on *each other* using their real package names, and changes to a library are visible to all dependents immediately — no publishing step in between.

**Benefits:**
- **Atomic commits.** A single PR changes the library *and* every consumer simultaneously. No "bump dep, wait for CI, bump consumer" dance.
- **Single source of truth.** One `node_modules` hoisting point (or a well-managed isolated one), one lint config, one CI setup.
- **Shared tooling.** TypeScript project references, ESLint configs, Prettier — configure once, extend everywhere.
- **Easier refactoring.** Rename a function and update every call site in one search-replace.

**Tradeoffs:**
- **Scale.** A naive `npm install` in a repo with 300 packages and 30 000 files is slow without caching tools (covered in the next lesson).
- **Blast radius.** A bad commit can break many packages at once. You need good CI pipeline segmentation.
- **Tooling learning curve.** Workspace managers, task runners, change-set tools — there is a whole ecosystem to learn.

> [!PRINCIPAL] Monorepo vs polyrepo is an organisational tradeoff, not a technical one
> The engineering argument for monorepos hinges on **coordination cost**. When two packages are co-owned by the same team and change together frequently, a monorepo wins because it eliminates the publish/version-bump loop. When packages are owned by entirely different teams on different release cadences, a polyrepo is often less friction. Many companies do *both*: one monorepo per domain, linked by published packages at boundaries.

## npm workspaces

Since npm 7 (Node 16+), `package.json` can declare workspaces:

```json
{
  "name": "my-mono",
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
```

With this in place, running `npm install` at the root:
1. Discovers every `package.json` inside the `packages` folder.
2. Hoists compatible dependencies to `node_modules/` at the root.
3. Creates symlinks in `node_modules/` pointing to each workspace package so they can `require`/`import` each other by name.

A typical workspace tree looks like this:

```
my-mono/
  package.json          ← root (private: true, workspaces config)
  node_modules/
    @my-mono/shared → ../../packages/shared   ← symlink!
  packages/
    api/
      package.json      ← { "name": "@my-mono/api", "dependencies": { "@my-mono/shared": "*" } }
      src/index.js
    shared/
      package.json      ← { "name": "@my-mono/shared" }
      src/index.js
```

> [!NOTE] Always mark the root as private
> The root `package.json` should have `"private": true`. It is not a real package to be published — it is just the workspace container. Without `"private": true`, you might accidentally run `npm publish` at the root.

## pnpm workspaces

pnpm uses a separate `pnpm-workspace.yaml` file instead of embedding workspaces in `package.json`:

```yaml
# pnpm-workspace.yaml (in the repo root)
packages:
  - "packages/*"
  - "apps/*"
```

pnpm's isolation model is stricter than npm's: it uses a content-addressable store and *hard links* rather than hoisting, so each package can only access what it explicitly declares in its own `package.json`. This prevents the npm ghost-dependency problem where a package accidentally uses a dep it never declared just because something else hoisted it.

## The workspace protocol

Both npm and pnpm support the `workspace:` protocol in dependencies:

```json
{
  "name": "@my-mono/api",
  "dependencies": {
    "@my-mono/shared": "workspace:*"
  }
}
```

`workspace:*` tells the package manager: "link to the local workspace package — do not look on npm". When you later run a release tool (like Changesets, covered in lesson 24-changesets), it replaces `workspace:*` with the actual published version (e.g. `"^1.2.0"`) before publishing.

> [!PITFALL] Using `"*"` without the workspace protocol
> If you write `"@my-mono/shared": "*"` (without `workspace:`), npm will resolve it from the npm registry if the package exists there, or fail if it doesn't. Always use `workspace:*` for internal packages so the tooling knows the intent.

## Sharing tsconfig and eslint

One of the biggest wins of a monorepo is centralising configuration. The pattern is to make a dedicated package — say `packages/tsconfig` — that contains base configs:

```json
// packages/tsconfig/base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules"]
}
```

Individual packages extend it:

```json
// packages/api/tsconfig.json
{
  "extends": "@my-mono/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

The same pattern works for ESLint using a shared `eslint-config-*` package:

```js
// packages/eslint-config/index.js
module.exports = {
  extends: ["eslint:recommended"],
  env: { node: true, es2022: true },
  rules: {
    "no-console": "warn",
    "prefer-const": "error"
  }
};
```

```js
// packages/api/.eslintrc.cjs
module.exports = { extends: ["@my-mono/eslint-config"] };
```

## Running commands across workspaces

npm lets you run a script in a specific workspace or all at once:

```bash
# Run "build" in the api package only:
npm run build --workspace=packages/api

# Run "test" in every workspace that defines it:
npm run test --workspaces --if-present
```

pnpm has a similar recursive flag:

```bash
pnpm --filter @my-mono/api build
pnpm -r build    # recursive, all packages
```

> [!OUTPUT]
> > packages/shared: build
> > packages/shared: tsc --build
> > packages/api: build
> > packages/api: tsc --build

## Try it yourself

The core algorithm workspace tools run at startup is **topological sort** — they must build packages in dependency order. Before that, they need to detect **cycles** (package A depends on B, which depends on A — impossible to build). Try it here:

```js run
// Represent an internal package dependency graph and detect cycles.
// Each key is a package name; the value is its list of local dependencies.
function buildGraph(deps) {
  return deps; // adjacency list, already in the right shape
}

// Depth-first cycle detection using three-colour marking:
// WHITE (0) = unvisited, GRAY (1) = in current DFS stack, BLACK (2) = done
function detectCycles(graph) {
  const color = {};
  const cycles = [];
  for (const node of Object.keys(graph)) color[node] = 0;

  function dfs(node, path) {
    color[node] = 1; // mark GRAY (in stack)
    for (const neighbour of (graph[node] || [])) {
      if (color[neighbour] === 1) {
        // We hit a gray node — found a cycle. Record it.
        const cycleStart = path.indexOf(neighbour);
        cycles.push(path.slice(cycleStart).concat(neighbour).join(" → "));
      } else if (color[neighbour] === 0) {
        dfs(neighbour, [...path, neighbour]);
      }
    }
    color[node] = 2; // mark BLACK (done)
  }

  for (const node of Object.keys(graph)) {
    if (color[node] === 0) dfs(node, [node]);
  }
  return cycles;
}

// Topological sort (Kahn's algorithm — only runs if no cycles)
function topoSort(graph) {
  const inDegree = {};
  for (const node of Object.keys(graph)) inDegree[node] = 0;
  for (const deps of Object.values(graph)) {
    for (const d of deps) inDegree[d] = (inDegree[d] || 0) + 1;
  }
  const queue = Object.keys(inDegree).filter(n => inDegree[n] === 0);
  const order = [];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const dep of (graph[node] || [])) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) queue.push(dep);
    }
  }
  return order;
}

// Example: api depends on shared and logger; cli depends on shared
const graph = {
  "api":    ["shared", "logger"],
  "cli":    ["shared"],
  "shared": [],
  "logger": []
};

const cycles = detectCycles(graph);
if (cycles.length) {
  console.log("Cycles detected:", cycles);
} else {
  console.log("No cycles found.");
  console.log("Build order:", topoSort(graph).reverse().join(" → "));
}

// Now introduce a cycle: shared → api → shared
const cyclic = {
  "api":    ["shared"],
  "shared": ["api"]
};
const found = detectCycles(cyclic);
console.log("Cyclic graph cycles:", found);
```

## Exercises

### Exercise 1: Add a new package to the graph

Extend the graph from the Try-it block with a `web` package that depends on `shared` and `api`. Verify the build order still has no cycles.

<details>
<summary>Show solution</summary>

```js run
function detectCycles(graph) {
  const color = {};
  const cycles = [];
  for (const node of Object.keys(graph)) color[node] = 0;
  function dfs(node, path) {
    color[node] = 1;
    for (const nb of (graph[node] || [])) {
      if (color[nb] === 1) {
        const i = path.indexOf(nb);
        cycles.push(path.slice(i).concat(nb).join(" → "));
      } else if (color[nb] === 0) dfs(nb, [...path, nb]);
    }
    color[node] = 2;
  }
  for (const n of Object.keys(graph)) if (color[n] === 0) dfs(n, [n]);
  return cycles;
}

function topoSort(graph) {
  const inDeg = {};
  for (const n of Object.keys(graph)) inDeg[n] = 0;
  for (const deps of Object.values(graph))
    for (const d of deps) inDeg[d] = (inDeg[d] || 0) + 1;
  const q = Object.keys(inDeg).filter(n => inDeg[n] === 0);
  const out = [];
  while (q.length) {
    const n = q.shift(); out.push(n);
    for (const d of (graph[n] || [])) { inDeg[d]--; if (inDeg[d] === 0) q.push(d); }
  }
  return out;
}

const graph = {
  "api":    ["shared", "logger"],
  "cli":    ["shared"],
  "web":    ["shared", "api"],   // new package
  "shared": [],
  "logger": []
};

const cycles = detectCycles(graph);
console.log("Cycles:", cycles.length ? cycles : "none");
console.log("Build order:", topoSort(graph).reverse().join(" → "));
// shared and logger first, then api, then web/cli
```

</details>

### Exercise 2: Transitive dependency lookup

Write a function `allDeps(pkg, graph)` that returns the full set of transitive dependencies for a package (direct + indirect).

<details>
<summary>Show solution</summary>

```js run
function allDeps(pkg, graph) {
  const visited = new Set();
  function walk(node) {
    for (const dep of (graph[node] || [])) {
      if (!visited.has(dep)) {
        visited.add(dep);
        walk(dep);
      }
    }
  }
  walk(pkg);
  return [...visited];
}

const graph = {
  "api":    ["shared", "logger"],
  "web":    ["api", "shared"],
  "shared": ["logger"],
  "logger": []
};

console.log("api deps:", allDeps("api", graph));
// ["shared", "logger"]
console.log("web deps:", allDeps("web", graph));
// ["api", "shared", "logger"] — transitive closure
```

</details>

## Common pitfalls

> [!PITFALL] Phantom dependencies (npm hoisting)
> In npm workspaces, hoisting lifts all dependencies to the root `node_modules`. A package in `packages/api` can accidentally `require("express")` even if it never declared it — because some *other* workspace declared it and npm hoisted it to the root. The package works locally but breaks in isolation or on a machine with a different install order. pnpm's strict isolation prevents this. When using npm workspaces, run `depcheck` per package periodically.

> [!PITFALL] Forgetting to build before linking
> TypeScript packages need to emit `.js` and `.d.ts` files before other packages can consume them — unless you configure TypeScript project references (`"composite": true`, `references: [...]`). A common mistake is changing a shared package and then being confused why the consumer still sees the old types: the build wasn't re-run.

## What you learned

- A monorepo co-locates related packages for atomic commits, shared tooling, and easier cross-package refactoring — at the cost of build-system complexity.
- `npm workspaces` (in `package.json`) and `pnpm workspaces` (`pnpm-workspace.yaml`) both symlink local packages so they can reference each other by name.
- The `workspace:*` protocol ensures internal deps are resolved locally, never from the registry.
- Shared `tsconfig` and `eslint-config` packages eliminate per-package config drift.
- Workspace tooling uses topological sort and cycle detection to determine safe build order.

## Next steps

Symlinking packages is only half the story. Once you have many packages, rebuilding everything on every change is painfully slow. The next lesson introduces **Turborepo** — a task runner that caches build outputs by content hash and only re-runs what has changed.
*/});
