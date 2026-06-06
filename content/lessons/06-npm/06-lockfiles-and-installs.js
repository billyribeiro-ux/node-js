registerLessonSrc("06-lockfiles-and-installs", function () {/*
---
id: 06-lockfiles-and-installs
title: "Lockfiles, Installs & Reproducibility"
minutes: 24
level: intermediate
objectives:
  - Explain what package-lock.json records and why it exists
  - Know when to use npm install vs npm ci and why CI should always use ci
  - Understand transitive dependencies, the dependency tree, and how npm dedupes
---

# Lockfiles, Installs & Reproducibility

## Why this matters

You write `"express": "^4.18.3"` in `package.json` and your app works. Six months later a colleague clones the repo, runs `npm install`, and gets `express@4.19.2` — which introduced a subtle breaking change in a middleware. The code "worked on your machine" but fails in CI. **Lockfiles** exist to prevent exactly this class of bug. Understanding them separates engineers who debug dependency mysteries for hours from those who never encounter them.

## Learning objectives

- Explain what `package-lock.json` records and why version ranges alone are not enough.
- Know when to use `npm install` vs `npm ci`, and why CI/CD pipelines must use `npm ci`.
- Navigate the dependency tree, understand transitive dependencies, and see how deduplication works.

## What a lockfile actually is

`package-lock.json` is npm's record of the **exact resolved tree** produced during your last `npm install`. It stores every package, at every level of nesting, with its exact version, integrity hash, and the resolved registry URL.

```json
{
  "name": "my-api",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "my-api",
      "dependencies": { "express": "^4.18.3" }
    },
    "node_modules/express": {
      "version": "4.18.3",
      "resolved": "https://registry.npmjs.org/express/-/express-4.18.3.tgz",
      "integrity": "sha512-...",
      "dependencies": {
        "accepts": "~1.3.8",
        "body-parser": "1.20.1"
      }
    },
    "node_modules/accepts": {
      "version": "1.3.8",
      "resolved": "https://registry.npmjs.org/accepts/-/accepts-1.3.8.tgz",
      "integrity": "sha512-..."
    }
  }
}
```

The `integrity` field is a SHA-512 hash of the tarball. npm verifies it on every install — if someone tampers with the package on the registry between your first install and your colleague's, npm refuses to install it. This is the first line of supply-chain defense.

> [!NOTE] Commit your lockfile — always
> `package-lock.json` must live in version control. It is what makes "reproducible installs" possible. Never add it to `.gitignore`. The only exception is when you are authoring a library (not an application); libraries typically omit the lockfile so consumers resolve the full tree fresh.

## npm install vs npm ci

These two commands are not interchangeable:

| | `npm install` | `npm ci` |
|---|---|---|
| Reads | `package.json` + lockfile | lockfile **only** |
| Updates lockfile | yes (if ranges allow a newer version) | **never** |
| Deletes `node_modules` first | no | **yes** (always a clean install) |
| Speed | slower (resolves ranges) | faster (uses exact locked versions) |
| When lockfile/package.json are out of sync | installs and updates the lock | **fails with an error** |
| Intended use | local development | CI/CD, Docker builds, reproducible installs |

```bash
# In your Dockerfile and CI YAML — always:
npm ci

# When adding a new package locally:
npm install zod
npm install -D eslint
```

> [!PITFALL] Running npm install in CI
> If your CI pipeline runs `npm install` instead of `npm ci`, every pipeline run may silently pick a different patch version of some transitive dependency. Your build is no longer reproducible and your `package-lock.json` in git diverges over time. Use `npm ci` in every automated environment.

## The dependency tree and transitive deps

Your app declares *direct* dependencies. Those packages declare their own dependencies — *transitive* dependencies. A single `npm install express` can pull in 50+ packages you never asked for.

npm lays this out under `node_modules` in a mostly *flat* structure (since npm v3). Rather than deeply nesting identical packages, npm *hoists* compatible versions to the top level:

```
node_modules/
  express/          ← direct dep, hoisted
  accepts/          ← transitive dep of express, hoisted (shared version)
  body-parser/      ← transitive dep of express, hoisted
  mime-types/       ← transitive dep used by both accepts and body-parser — ONE copy
```

When two packages need **incompatible** versions of the same dep, npm nests the minority version inside that package's own `node_modules`:

```
node_modules/
  package-a/        ← needs dep@1.x
    node_modules/
      dep/          ← dep@1.9.0 nested here (cannot be hoisted)
  dep/              ← dep@2.3.0 hoisted (package-b's version wins the top slot)
  package-b/        ← needs dep@2.x — uses the hoisted copy
```

> [!PRINCIPAL] Phantom dependencies and the hoisting trap
> Flat hoisting means you can `require("accepts")` in your own code even though you never declared it as a direct dependency — it got hoisted from express. This is a **phantom dependency**. It works until express stops depending on it or pins a different version, and then your code silently breaks. Always declare every package you use directly. Tools like pnpm prevent phantom dependencies by design.

## Deduplication

npm's deduplication algorithm tries to find the highest version in the intersection of all requested ranges and hoist it. You can trigger a manual dedupe pass after adding many packages:

```bash
npm dedupe      # rewrites node_modules to minimise duplicate copies
npm ls zod      # show exactly which versions of zod are in your tree
npm why express # explain why express is installed (direct? transitive? which package needs it?)
```

```bash
npm ls accepts
```

> [!OUTPUT]
> my-api@1.0.0
> └── accepts@1.3.8
>   └── (deduped from express)

## Try it yourself

This runnable block simulates deduplication: given a nested dependency tree object (each package lists what it needs), flatten it and pick one shared version wherever ranges are compatible.

```js run
// Simulate a dependency tree: { pkgName: { version, deps: { name: requiredVersion } } }
const packages = {
  "express":     { version: "4.18.3", deps: { accepts: "^1.3.0", "mime-db": "^1.52.0" } },
  "multer":      { version: "1.4.5",  deps: { accepts: "^1.3.4", "mime-db": "^1.52.0" } },
  "accepts":     { version: "1.3.8",  deps: {} },
  "mime-db":     { version: "1.52.0", deps: {} },
};

// Collect all version requirements for each package
function collectRequirements(pkgs) {
  const required = {};
  for (const [, meta] of Object.entries(pkgs)) {
    for (const [dep, range] of Object.entries(meta.deps)) {
      if (!required[dep]) required[dep] = [];
      required[dep].push(range);
    }
  }
  return required;
}

// Naive "satisfies" check: major.minor must match the constraint's major.minor
function naive_satisfies(version, range) {
  const cleanRange = range.replace(/^[\^~>=<]/, '');
  const [rvMaj, rvMin] = version.split('.').map(Number);
  const [rMaj, rMin]   = cleanRange.split('.').map(Number);
  if (range.startsWith('^')) return rvMaj === rMaj && (rvMin > rMin || rvMin === rMin);
  if (range.startsWith('~')) return rvMaj === rMaj && rvMin === rMin;
  return version === cleanRange;
}

// Build flattened tree: pick the installed version, check it satisfies all demands
function flatten(pkgs) {
  const reqs = collectRequirements(pkgs);
  const flat = {};
  for (const [name, meta] of Object.entries(pkgs)) {
    const demands = reqs[name] || [];
    const allSatisfied = demands.every(r => naive_satisfies(meta.version, r));
    flat[name] = { version: meta.version, deduped: demands.length > 1, allSatisfied };
  }
  return flat;
}

const tree = flatten(packages);
for (const [name, info] of Object.entries(tree)) {
  const note = info.deduped ? " (shared by multiple pkgs)" : "";
  const ok   = info.allSatisfied ? "OK" : "VERSION CONFLICT";
  console.log(`${name}@${info.version}  ${ok}${note}`);
}
```

## Exercise

**Challenge:** extend the snippet above to **detect a version conflict** — that is, two packages require the same dep but at ranges that resolve to different major versions. Print `CONFLICT` for those cases.

<details>
<summary>Show solution</summary>

```js run
const packages = {
  "lib-a": { version: "1.0.0", deps: { "lodash": "^3.0.0" } },
  "lib-b": { version: "2.0.0", deps: { "lodash": "^4.0.0" } },
  "lodash": { version: "4.17.21", deps: {} },
};

function parseMajor(range) {
  // Strip leading operator characters then take the major version number
  const clean = range.replace(/^\D+/, '');
  return Number(clean.split('.')[0]);
}

function detectConflicts(pkgs) {
  const majorsByDep = {};
  for (const meta of Object.values(pkgs)) {
    for (const [dep, range] of Object.entries(meta.deps)) {
      if (!majorsByDep[dep]) majorsByDep[dep] = new Set();
      majorsByDep[dep].add(parseMajor(range));
    }
  }
  for (const [dep, majors] of Object.entries(majorsByDep)) {
    if (majors.size > 1) {
      console.log(`CONFLICT: "${dep}" required at majors [${[...majors].join(', ')}]`);
      console.log(`  => npm will nest the minority version instead of hoisting`);
    } else {
      console.log(`OK: "${dep}" — single major version requirement (${[...majors][0]}.x)`);
    }
  }
}

detectConflicts(packages);
```

</details>

## Common pitfalls

> [!PITFALL] Deleting package-lock.json to "fix" install problems
> When something goes wrong, the knee-jerk reaction is to delete the lockfile and `node_modules` and reinstall. This "works" by promoting an untested upgrade. The right move: run `npm ls <package>` and `npm why <package>` to understand what is conflicting, then update intentionally with `npm install pkg@version`.

> [!PITFALL] Committing node_modules
> `node_modules` is fully reproducible from the lockfile. Committing it bloats your repo by hundreds of megabytes, makes PRs unreadable, and causes cross-platform binary conflicts (e.g., native `.node` addons compiled for macOS vs Linux). Always add `node_modules` to `.gitignore`.

## What you learned

- `package-lock.json` records the exact resolved tree with integrity hashes, making installs reproducible and tamper-evident.
- `npm ci` is for automation: it does a clean install from the lockfile and fails if anything is inconsistent; `npm install` is for development.
- npm hoists compatible transitive deps to a flat `node_modules` structure; incompatible versions are nested, creating duplicate installs.
- Phantom dependencies arise from hoisting; declare everything you use directly to avoid silent breakage.

## Next steps

Now that you understand how npm resolves and locks packages, let us compare npm itself to the two major alternatives — pnpm and Yarn — and explore where Corepack fits in.
*/});
