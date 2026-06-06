registerLessonSrc("24-changesets", function () {/*
---
id: 24-changesets
title: "Versioning & Releases with Changesets"
minutes: 28
level: advanced
objectives:
  - Understand the changesets workflow for authoring, versioning, and publishing monorepo packages
  - Apply semver bump logic (major/minor/patch) to compute new versions across a dependency graph
  - Distinguish fixed vs independent versioning strategies and choose the right one
---

# Versioning & Releases with Changesets

## Why this matters

You've built a beautiful monorepo with shared packages, a task pipeline, and a remote cache. Now a PR lands that fixes a bug in `@my-mono/shared` — what version does it become? Which packages need new versions because they depend on it? Who writes the changelog entry? Without a process, these questions produce chaotic last-minute decisions and accidental breaking releases. **Changesets** is the industry-standard answer: a tool that separates the *authoring* of version intent from the *act* of bumping and publishing, and automates the rest.

## Learning objectives

- Walk through the full Changesets workflow: `add`, `version`, `publish`.
- Compute semver version bumps (major/minor/patch) in code to understand what the tool does under the hood.
- Configure fixed vs independent versioning for different package groupings.
- Build a mini version-bump calculator as the course project foundation.

## The changesets workflow

Changesets introduces a simple three-step model:

```
  Author opens PR
        │
        ▼
  npx changeset add          ← "I am changing X; bump type is patch/minor/major"
        │                        writes a .changeset/<random-slug>.md file
        ▼
  PR merged to main
        │
        ▼
  npx changeset version      ← reads all .changeset files, bumps package.json
        │                        versions, updates CHANGELOG.md files, deletes changesets
        ▼
  npx changeset publish      ← runs "npm publish" for every package whose
                                version increased; respects topological order
```

### Step 1 — changeset add

When you finish a PR that changes a package, you run:

```bash
npx changeset add
```

This launches an interactive prompt: select which packages changed, choose the bump type for each (patch / minor / major), and write a short summary. The result is a markdown file committed alongside your code change:

```
// .changeset/golden-elephants-burn.md
---
"@my-mono/shared": minor
"@my-mono/api": patch
---

Add `batchGet` method to the shared cache util; bump api for internal wiring.
```

The file lives in `.changeset/` and is committed to the branch. During code review, teammates can see exactly what version impact the PR intends.

> [!NOTE] Changesets are reviewed alongside the code
> A changeset file is a *promise* about the version impact. Reviewers can ask "should this really be a minor?" before merging — long before the publish step. This decouples version intent from the release moment.

### Step 2 — changeset version

On a release branch (or via an automated "Release PR" in CI), you run:

```bash
npx changeset version
```

The tool:
1. Reads every `.changeset/*.md` file.
2. Aggregates bump types per package (the highest bump wins: major beats minor beats patch).
3. Bumps `package.json` versions using semver rules.
4. Propagates bumps to consumers: if `shared` bumps, every package that lists `shared` as a dependency also gets at minimum a patch bump.
5. Generates or appends to `CHANGELOG.md` in each affected package.
6. Deletes the consumed changeset files.

> [!OUTPUT]
> @my-mono/shared: 1.3.0 => 1.4.0 (minor)
> @my-mono/api:   2.1.4 => 2.1.5 (patch)
> @my-mono/cli:   1.0.2 => 1.0.3 (patch — transitive from shared)

### Step 3 — changeset publish

```bash
npx changeset publish
```

Runs `npm publish` (or `pnpm publish`) for every package whose version in `package.json` is higher than what is currently on the npm registry. It also replaces `workspace:*` protocol references with the real published versions before publishing.

```bash
# packages are published in dependency order automatically
npx changeset publish --access public   # for scoped packages
```

## Semver bump logic

Understanding the semver rules lets you reason about cascades without running the tool.

| Bump type | When to use | Example |
|-----------|-------------|---------|
| **patch** | Bug fix, no API change | `1.2.3` → `1.2.4` |
| **minor** | New API, backwards compatible | `1.2.3` → `1.3.0` |
| **major** | Breaking API change | `1.2.3` → `2.0.0` |

Rules:
- When you apply a **major** bump, the minor and patch reset to `0`.
- When you apply a **minor** bump, the patch resets to `0`.
- When multiple changesets target the same package, the *highest* bump type wins.

```js
// Pure-JS semver bump — no dependencies
function semverBump(version, bumpType) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  if (bumpType === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error("unknown bump type: " + bumpType);
}
```

> [!OUTPUT]
> semverBump("1.2.3", "patch")  // "1.2.4"
> semverBump("1.2.3", "minor")  // "1.3.0"
> semverBump("1.2.3", "major")  // "2.0.0"

> [!PITFALL] 0.x versions and semver
> When a package is at version `0.x.y`, semver conventions are relaxed: a **minor** bump (`0.2.0` → `0.3.0`) can include breaking changes because the major version signals "not yet stable". Changesets respects this — it will not auto-promote `0.x` packages to `1.0.0` without an explicit major changeset. If you want stability guarantees, release a `1.0.0` deliberately.

## Fixed vs independent versioning

Changesets supports two versioning strategies for packages that are grouped together.

**Independent versioning** (the default): each package has its own version. Package A can be on `3.0.0` while Package B is on `1.2.4`. This is the right choice when packages are consumed independently by external users.

**Fixed versioning**: all packages in a group always share the same version number, bumping together even if only one changed. This mirrors how React packages (`react`, `react-dom`) always stay in sync.

```json
// .changeset/config.json
{
  "fixed": [["@my-mono/api", "@my-mono/worker"]],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

The `fixed` array lists groups of packages that must always share a version. `linked` is weaker — packages in a linked group all bump to the *highest* version among them, but only when they have a changeset of their own.

> [!PRINCIPAL] Match versioning strategy to consumption model
> Fixed versioning reduces cognitive overhead for end-users of tightly-coupled packages — they never need to wonder "which version of A works with which version of B?". But it forces unnecessary version bumps on unchanged packages, polluting changelogs and triggering consumer updates for no functional reason. Use fixed groups sparingly: only when the packages are genuinely unusable apart from each other.

## Automating with CI

A common CI pattern uses the Changesets GitHub Action to open and update a "Release PR" automatically:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - uses: changesets/action@v1
        with:
          publish: npx changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

When changesets accumulate on `main`, the action opens a "Version packages" PR with the bumped `package.json` files and changelogs. Merging that PR triggers the publish step.

## Try it yourself

The version-bump computation is the heart of the Changesets engine. Let's implement it for a whole dependency graph, including cascading bumps to consumers:

```js run
// Semver bump helper
function semverBump(version, bumpType) {
  const [maj, min, pat] = version.split(".").map(Number);
  if (bumpType === "major") return `${maj + 1}.0.0`;
  if (bumpType === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// Bump precedence: higher number = higher priority
const PRIORITY = { major: 3, minor: 2, patch: 1 };

function higherBump(a, b) {
  return (PRIORITY[a] || 0) >= (PRIORITY[b] || 0) ? a : b;
}

// Given explicit changeset bumps and the dep graph, compute the final
// bump for every package (propagating patch bumps to all consumers).
function computeBumps(changesets, depGraph, currentVersions) {
  // Start with the explicit bumps from changeset files
  const bumps = { ...changesets };

  // Build reverse graph (dependency -> dependents)
  const dependents = {};
  for (const pkg of Object.keys(depGraph)) dependents[pkg] = [];
  for (const [pkg, deps] of Object.entries(depGraph)) {
    for (const dep of deps) {
      if (dep in dependents) dependents[dep].push(pkg);
    }
  }

  // BFS: for every package that has a bump, give dependents at least a patch bump
  const queue = Object.keys(bumps);
  while (queue.length) {
    const pkg = queue.shift();
    for (const consumer of (dependents[pkg] || [])) {
      const prev = bumps[consumer];
      const next = "patch"; // cascade is always at least patch
      const chosen = prev ? higherBump(prev, next) : next;
      if (chosen !== prev) {
        bumps[consumer] = chosen;
        queue.push(consumer);
      }
    }
  }

  // Compute new versions
  const result = {};
  for (const [pkg, version] of Object.entries(currentVersions)) {
    const bump = bumps[pkg];
    result[pkg] = bump ? semverBump(version, bump) : version;
  }
  return { bumps, newVersions: result };
}

// --- Example ---
const currentVersions = {
  "shared":  "1.3.0",
  "logger":  "1.1.0",
  "api":     "2.0.4",
  "cli":     "1.0.2",
  "worker":  "1.0.0"
};

const depGraph = {
  "api":    ["shared", "logger"],
  "cli":    ["shared"],
  "worker": ["shared"],
  "shared": [],
  "logger": []
};

// Author added a minor changeset for shared and a patch for logger
const changesets = {
  "shared": "minor",
  "logger": "patch"
};

const { bumps, newVersions } = computeBumps(changesets, depGraph, currentVersions);

console.log("Bump types:");
for (const [pkg, bump] of Object.entries(bumps)) {
  console.log(`  ${pkg}: ${bump}`);
}
console.log("\nNew versions:");
for (const [pkg, ver] of Object.entries(newVersions)) {
  const old = currentVersions[pkg];
  const changed = ver !== old ? " *" : "";
  console.log(`  ${pkg}: ${old} => ${ver}${changed}`);
}
```

## Exercises

### Exercise 1: Aggregate multiple changesets for the same package

In practice, several PRs may each produce a changeset for the same package. Write a function that merges a list of changeset objects (each mapping package → bump type) into one, keeping the highest bump for each package.

<details>
<summary>Show solution</summary>

```js run
const PRIORITY = { major: 3, minor: 2, patch: 1 };

function mergeChangesets(list) {
  const merged = {};
  for (const cs of list) {
    for (const [pkg, bump] of Object.entries(cs)) {
      if (!merged[pkg] || PRIORITY[bump] > PRIORITY[merged[pkg]]) {
        merged[pkg] = bump;
      }
    }
  }
  return merged;
}

// Three PRs landed, each with a changeset
const changesets = [
  { "shared": "patch", "logger": "patch" },
  { "shared": "minor" },                       // higher: minor wins
  { "api": "major", "shared": "patch" }        // shared already minor, stays minor
];

const merged = mergeChangesets(changesets);
console.log("Merged changesets:", merged);
// { shared: "minor", logger: "patch", api: "major" }

// Verify: minor wins over two patches for shared
console.log("shared bump:", merged.shared);   // "minor"
console.log("api bump:",    merged.api);      // "major"
```

</details>

### Exercise 2: Format a CHANGELOG entry

Changesets auto-generates CHANGELOG.md entries. Implement a function that formats a single package's release entry in the Changesets markdown style.

<details>
<summary>Show solution</summary>

```js run
function formatChangelogEntry(pkg, oldVersion, newVersion, summaries) {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`## ${newVersion} — ${now}`);
  lines.push("");
  lines.push(`### Changes (${pkg} ${oldVersion} → ${newVersion})`);
  lines.push("");
  for (const summary of summaries) {
    lines.push(`- ${summary}`);
  }
  return lines.join("\n");
}

const entry = formatChangelogEntry(
  "@my-mono/shared",
  "1.3.0",
  "1.4.0",
  [
    "Add `batchGet` method for fetching multiple cache keys in one call",
    "Fix race condition when setting a key that is concurrently evicted"
  ]
);

console.log(entry);
```

</details>

## Project

**Convert the project into a Turborepo monorepo with `api`, `worker`, `shared-types`, and `cli` packages.**

Your task is to design and bootstrap the monorepo structure from scratch, applying everything from lessons 24-workspaces through 24-changesets. A real engineer would wire up actual files; here you will prove you understand the concepts by implementing the version-computation core and describing the structure precisely.

**Acceptance criteria:**

1. **Workspace layout**: Describe (or scaffold) the directory layout — root `package.json`, `pnpm-workspace.yaml`, and one `package.json` per workspace package (`api`, `worker`, `shared-types`, `cli`), with `shared-types` referenced via `workspace:*` in the others.
2. **turbo.json**: Provide a `turbo.json` with pipelines for `build`, `test`, `lint`, and `dev`. `build` must use `"dependsOn": ["^build"]`; `dev` must be non-cached and persistent.
3. **Shared tsconfig**: Create a `packages/tsconfig` package with a `base.json`, and show each app package extending it.
4. **Version-bump calculator**: Implement `computeBumps` (as in the Try-it block) and verify it handles at least one major, one minor, and one patch bump with cascading.
5. **Changeset config**: Provide a `.changeset/config.json` that uses independent versioning, sets `baseBranch` to `main`, and groups `api` + `worker` as fixed.
6. **CI release workflow**: Sketch the `.github/workflows/release.yml` using the `changesets/action` that opens a Release PR and publishes on merge.

The starter below implements criterion 4 — version-bump computation — which you should run, verify, and build the rest around:

```js run
function semverBump(version, bumpType) {
  const [maj, min, pat] = version.split(".").map(Number);
  if (bumpType === "major") return `${maj + 1}.0.0`;
  if (bumpType === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const PRIORITY = { major: 3, minor: 2, patch: 1 };

function computeBumps(changesets, depGraph, currentVersions) {
  const bumps = { ...changesets };
  const dependents = {};
  for (const pkg of Object.keys(depGraph)) dependents[pkg] = [];
  for (const [pkg, deps] of Object.entries(depGraph)) {
    for (const dep of deps) {
      if (dep in dependents) dependents[dep].push(pkg);
    }
  }
  const queue = Object.keys(bumps);
  while (queue.length) {
    const pkg = queue.shift();
    for (const consumer of (dependents[pkg] || [])) {
      const prev = bumps[consumer];
      const next = "patch";
      const chosen = prev && PRIORITY[prev] >= PRIORITY[next] ? prev : next;
      if (chosen !== prev) { bumps[consumer] = chosen; queue.push(consumer); }
    }
  }
  const newVersions = {};
  for (const [pkg, ver] of Object.entries(currentVersions)) {
    newVersions[pkg] = bumps[pkg] ? semverBump(ver, bumps[pkg]) : ver;
  }
  return { bumps, newVersions };
}

// Project packages
const current = {
  "shared-types": "1.0.0",
  "api":          "1.0.0",
  "worker":       "1.0.0",
  "cli":          "1.0.0"
};
const deps = {
  "api":          ["shared-types"],
  "worker":       ["shared-types"],
  "cli":          ["shared-types"],
  "shared-types": []
};

// Simulate: shared-types gets a MAJOR breaking change
const { bumps, newVersions } = computeBumps({ "shared-types": "major" }, deps, current);

console.log("Bumps applied:");
for (const [p, b] of Object.entries(bumps)) console.log(`  ${p}: ${b}`);
console.log("\nNew versions:");
for (const [p, v] of Object.entries(newVersions))
  console.log(`  ${p}: ${current[p]} → ${v}`);
```

## Common pitfalls

> [!PITFALL] Merging the Release PR then not tagging
> `changeset publish` relies on comparing local `package.json` versions to the registry. If you manually bump versions without publishing (or publish without the action), the registry and repo get out of sync. Future `changeset publish` runs will try to re-publish old versions or skip packages silently. Always let the Changesets action own the publish step.

> [!PITFALL] Forgetting to commit changeset files
> A changeset file in `.changeset/` that is not committed (e.g., only sitting in the working tree) will be ignored by `changeset version`. Changesets are only "real" once they are committed and merged. Add a CI lint step (`changeset status --since=origin/main`) to warn when a PR modifies package source but contains no changeset.

## What you learned

- Changesets separates version *intent* (changeset files, authored per PR) from version *action* (`version` + `publish` commands, run at release time).
- `semverBump` logic is simple — major resets minor+patch, minor resets patch — but cascading through a dep graph requires BFS over the reverse-dependency graph.
- Fixed versioning locks a group of packages to the same version (great for tightly-coupled packages); independent versioning lets each package evolve at its own pace.
- The Changesets GitHub Action automates the Release PR → publish workflow so no manual version-bumping is needed on `main`.
- Combining workspaces (lesson 24-workspaces), Turborepo caching (lesson 24-turborepo), and Changesets gives you a complete monorepo development and release loop.

## Next steps

With the monorepo fully wired, the next frontier is **concurrency** — using Node's worker threads and cluster module to saturate multi-core machines. Head to Module 25 to learn how.
*/});
