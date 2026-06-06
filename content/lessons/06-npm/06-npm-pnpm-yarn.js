registerLessonSrc("06-npm-pnpm-yarn", function () {/*
---
id: 06-npm-pnpm-yarn
title: "npm vs pnpm vs yarn (and Corepack)"
minutes: 25
level: intermediate
objectives:
  - Compare npm, pnpm, and Yarn across speed, disk use, and correctness guarantees
  - Understand pnpm's content-addressable store and hard links
  - Use Corepack to pin and share the right package manager across a team
---

# npm vs pnpm vs yarn (and Corepack)

## Why this matters

Your choice of package manager affects install speed, disk usage, correctness (phantom dependency prevention), and monorepo ergonomics — and it affects every developer on your team. In 2026, pnpm is the choice for most new monorepos; Yarn Berry (v4) owns a slice of the React ecosystem; npm ships with Node and is the universal default. Understanding *why* they differ helps you make the right call and switch when the trade-offs change.

## Learning objectives

- Explain how pnpm's content-addressable store and hard links work.
- Understand Yarn Plug'n'Play (PnP) and its trade-offs.
- Use Corepack to enforce a specific package manager version in a project.
- Pick the right tool for a given project type.

## The three managers at a glance

| Feature | npm (v10) | pnpm (v9) | Yarn Berry (v4) |
|---|---|---|---|
| Ships with Node | yes (bundled) | no (install separately) | no |
| Install algorithm | hoisted flat tree | symlinked store + virtual store | PnP (no node_modules) or nm mode |
| Phantom deps | possible (hoisting) | prevented by design | prevented in PnP mode |
| Disk dedup | per-project copies | **global content-addressable store** | zip archives per project |
| Monorepo workspaces | yes | yes (fast, strict) | yes (very mature) |
| Lockfile | package-lock.json | pnpm-lock.yaml | yarn.lock |
| Config file | .npmrc | .npmrc + pnpm-workspace.yaml | .yarnrc.yml |
| Speed (cold install) | baseline | ~2× faster | ~1.5× faster |

## How pnpm works: the content-addressable store

pnpm's key insight is that every version of every package only needs to exist **once** on your machine. It maintains a global content-addressable store (typically `~/.local/share/pnpm/store` on Linux) where each file is stored by its content hash. When you install a package in a project, pnpm creates **hard links** from the project's `node_modules` to the store — not copies.

```
~/.local/share/pnpm/store/v3/
  files/
    00/abc123...    ← the actual file bytes, stored once by content hash
    01/def456...
    ...

my-project/
  node_modules/
    .pnpm/
      express@4.18.3/
        node_modules/
          express/       ← hard link → store file (no copy!)
    express -> .pnpm/express@4.18.3/node_modules/express  ← symlink
```

A **hard link** means both paths point to the same inode on disk — the file bytes live once. If ten projects use `express@4.18.3`, there is still only one copy on disk. The disk savings on a machine with many projects can be gigabytes.

pnpm's virtual store (`.pnpm/`) also enforces strict isolation: a package can only access what it explicitly declares in its own `package.json`. This is what prevents phantom dependency bugs.

> [!PRINCIPAL] Hard links vs symlinks vs copies
> npm copies every file (or uses node's built-in pack/unpack). Yarn stores zip archives and extracts into a cache, then copies or links. pnpm hard-links, which means the OS block count is 1 regardless of how many projects reference the file. On CI where disk is shared across build agents, pnpm's approach can reduce install time dramatically when the store is cached as a CI artifact.

## Yarn Berry: Plug'n'Play

Yarn v2+ (Berry) introduced **Plug'n'Play (PnP)**: instead of a `node_modules` folder, Yarn generates a single `.pnp.cjs` file — a map from package name + version → path within Yarn's zip archive cache. Node's module resolver is patched at startup to consult this map.

**Benefits:**
- Zero `node_modules` bloat — installs are nearly instant after the first run because only zip archives live on disk.
- Strict isolation like pnpm — packages cannot access undeclared dependencies.
- The entire dependency tree can be committed to git (`yarn install --immutable` in CI).

**Trade-offs:**
- Tooling compatibility: some tools that expect a real `node_modules` directory need special SDKs (`yarn dlx @yarnpkg/sdks vscode`).
- Debugging is harder — stack traces point into zip archives.
- The patched Node resolver is non-standard; it can surprise native addons.

For teams willing to configure it, PnP is elegant. Many teams use Yarn in "node-modules" mode (`nodeLinker: node-modules` in `.yarnrc.yml`) to get Yarn's workspace ergonomics without PnP's friction.

## Corepack: pinning the package manager

**Corepack** ships with Node 16+ and is the official way to declare and enforce which package manager — and which exact version — a project uses. You add a `packageManager` field to `package.json`:

```json
{
  "name": "my-monorepo",
  "packageManager": "pnpm@9.4.0"
}
```

When a developer runs `pnpm install` in that project, Corepack ensures they are using exactly `pnpm@9.4.0`, downloading and caching it if needed. Running `npm install` instead prints a helpful error.

```bash
corepack enable          # enable Corepack shims (run once per machine)
corepack prepare pnpm@9.4.0 --activate   # activate a specific version
corepack use pnpm@latest # update packageManager field + activate
```

> [!NOTE] Corepack is opt-in on Node 24
> On Node 24 LTS, Corepack ships but is not active by default. Run `corepack enable` once to install the shims. On some distros it may need to be installed separately (`npm install -g corepack`).

## Workspaces basics

All three managers support **workspaces** — a monorepo feature where multiple packages live under one root and can reference each other locally.

```
my-monorepo/
  package.json          ← workspace root
  packages/
    api/
      package.json      ← workspace member
    ui/
      package.json      ← workspace member
    shared/
      package.json      ← workspace member
```

```json
// root package.json (npm / Yarn style)
{
  "workspaces": ["packages/*"]
}
```

```yaml
# pnpm-workspace.yaml (pnpm's dedicated workspace file)
packages:
  - "packages/*"
```

Within a workspace, packages can depend on each other using the `workspace:` protocol:

```json
// packages/api/package.json
{
  "dependencies": {
    "shared": "workspace:*"
  }
}
```

pnpm replaces `workspace:*` with the actual version on publish, so published packages have real semver ranges in their `dependencies`.

## When to pick which

- **npm**: default for simple apps, scripts, and when you want zero setup friction. Fine choice when disk dedup and phantom deps are not concerns.
- **pnpm**: best for monorepos, disk-sensitive environments (CI, developer machines with many projects), and teams that want strict dependency isolation out of the box.
- **Yarn Berry (PnP)**: best when you want zero-install (committed cache) and a team willing to configure editors and tooling. Strong in React/Next.js heavy shops that already use Yarn.
- **Yarn Berry (node-modules mode)**: a middle path — Yarn's CLI ergonomics and workspace maturity without PnP friction.

## Try it yourself

This runnable block computes the disk savings pnpm-style hard linking gives you versus npm-style copying, given a set of projects and their dependencies.

```js run
// Simulate disk usage: npm (copies) vs pnpm (hard-linked global store)
const globalStore = new Map(); // content hash -> size in KB

const projects = [
  { name: "api",     deps: ["express@4.18.3", "zod@3.22.0", "lodash@4.17.21"] },
  { name: "workers", deps: ["express@4.18.3", "lodash@4.17.21", "bull@4.12.0"] },
  { name: "cli",     deps: ["zod@3.22.0",     "commander@11.1.0"]              },
];

// Approximate installed sizes in KB
const packageSizes = {
  "express@4.18.3":   220,
  "zod@3.22.0":        90,
  "lodash@4.17.21":   490,
  "bull@4.12.0":      310,
  "commander@11.1.0":  80,
};

let npmTotal   = 0;   // npm: one full copy per project
let pnpmStore  = 0;   // pnpm: one copy in the global store
let pnpmLinks  = 0;   // pnpm: hard links are near-zero cost (just inode refs)

for (const project of projects) {
  for (const dep of project.deps) {
    const size = packageSizes[dep] || 0;
    npmTotal += size;                           // npm always copies
    if (!globalStore.has(dep)) {
      globalStore.set(dep, size);
      pnpmStore += size;                        // pnpm: add to store only once
    }
    pnpmLinks += 0.001;                         // hard link metadata (negligible)
  }
}

const pnpmTotal = pnpmStore + pnpmLinks;
const saved     = npmTotal - pnpmTotal;
const pct       = ((saved / npmTotal) * 100).toFixed(1);

console.log(`Projects: ${projects.map(p => p.name).join(', ')}`);
console.log(`npm disk usage (copies per project): ${npmTotal} KB`);
console.log(`pnpm disk usage (store + hard links): ${pnpmStore.toFixed(1)} KB`);
console.log(`Savings: ${saved.toFixed(1)} KB (${pct}% reduction)`);
console.log('');
console.log('Packages in global store:');
for (const [pkg, size] of globalStore) {
  console.log(`  ${pkg}: ${size} KB (shared across all projects that need it)`);
}
```

## Exercise

**Challenge:** modify the snippet above to add a fourth project `"dashboard"` that shares all packages with `"api"`. Observe how pnpm's store size does not grow while npm's does.

<details>
<summary>Show solution</summary>

```js run
const globalStore = new Map();

const projects = [
  { name: "api",       deps: ["express@4.18.3", "zod@3.22.0", "lodash@4.17.21"] },
  { name: "workers",   deps: ["express@4.18.3", "lodash@4.17.21", "bull@4.12.0"] },
  { name: "cli",       deps: ["zod@3.22.0", "commander@11.1.0"]                  },
  { name: "dashboard", deps: ["express@4.18.3", "zod@3.22.0", "lodash@4.17.21"] }, // same as api
];

const packageSizes = {
  "express@4.18.3":   220,
  "zod@3.22.0":        90,
  "lodash@4.17.21":   490,
  "bull@4.12.0":      310,
  "commander@11.1.0":  80,
};

let npmTotal  = 0;
let pnpmStore = 0;

for (const project of projects) {
  for (const dep of project.deps) {
    const size = packageSizes[dep] || 0;
    npmTotal += size;
    if (!globalStore.has(dep)) {
      globalStore.set(dep, size);
      pnpmStore += size;
    }
  }
}

const saved = npmTotal - pnpmStore;
const pct   = ((saved / npmTotal) * 100).toFixed(1);
console.log(`4 projects — npm total: ${npmTotal} KB`);
console.log(`4 projects — pnpm store: ${pnpmStore} KB`);
console.log(`Saved: ${saved} KB (${pct}%)`);
console.log('Adding "dashboard" (same deps as api) grew npm by 800 KB, pnpm store by 0 KB.');
```

</details>

## Common pitfalls

> [!PITFALL] Mixing package managers in one project
> Running `npm install` in a pnpm workspace corrupts the tree — you get both `package-lock.json` and `pnpm-lock.yaml`, the `node_modules` layout is wrong, and workspace links break. Use Corepack with a `packageManager` field to make it impossible to run the wrong tool.

> [!PITFALL] Assuming node_modules exists in pnpm projects
> Scripts that reference `./node_modules/.bin/tool` directly fail under pnpm's symlinked layout. Use `pnpm exec tool` or rely on the `scripts` field in `package.json` instead — npm, pnpm, and Yarn all place binaries on the PATH for scripts.

## What you learned

- npm, pnpm, and Yarn are three distinct package managers with different disk layouts, isolation guarantees, and performance characteristics.
- pnpm uses a global content-addressable store with hard links — packages live once on disk no matter how many projects use them.
- Yarn PnP replaces `node_modules` with a generated map and zero-install support, at the cost of tooling compatibility.
- Corepack enforces a specific package manager + version via the `packageManager` field in `package.json`.

## Next steps

With a solid grasp of how packages are installed and managed, let us look at the full lifecycle of sharing your own work: publishing a package to the npm registry, scoping it, handling provenance, and keeping the supply chain secure.
*/});
