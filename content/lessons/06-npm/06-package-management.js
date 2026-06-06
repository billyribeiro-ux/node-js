registerLessonSrc("06-package-management", function () {/*
---
id: 06-package-management
title: "package.json & Semantic Versioning"
minutes: 22
level: beginner
objectives:
  - Understand what package.json contains and how to author it confidently
  - Know the difference between dependency kinds and pick the right one
  - Read and write semver ranges correctly
---

# package.json & Semantic Versioning

## Why this matters

`package.json` is the root of every Node project. It defines what your project is, what it needs, how to run it, and what it publishes. Getting its details wrong — reaching for the wrong dependency kind, misreading a version range, forgetting a lifecycle hook — causes builds to break in CI, extra megabytes to ship to production, and subtle runtime mismatch bugs that are hard to diagnose.

## Learning objectives

- Scaffold and read a `package.json` confidently.
- Know when to use `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
- Parse and write semver version ranges using `^`, `~`, and other operators.
- Add and run `scripts`, understand lifecycle hooks, and use `npx`.

## Scaffolding a project with npm init

Running `npm init` drops you into an interactive prompt that writes your `package.json`. For automation, skip the questionnaire:

```bash
npm init -y          # accept all defaults instantly
npm init @scope/app  # use an initializer (e.g. create-react-app family)
```

A minimal but real `package.json`:

```json
{
  "name": "my-api",
  "version": "1.0.0",
  "description": "A small REST API",
  "main": "src/index.js",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.18.3"
  },
  "devDependencies": {
    "eslint": "^9.0.0"
  }
}
```

> [!NOTE] "name" and "version" are required only for published packages
> For private apps (`"private": true`) you can technically omit them, but keeping them in is a good habit for humans and tooling alike.

## The four dependency kinds

| Field | Installed when | Typical contents |
|---|---|---|
| `dependencies` | Always (your app + dependents) | express, fastify, zod |
| `devDependencies` | Only in your own project (not installed for dependents) | eslint, vitest, typescript |
| `peerDependencies` | Expected to be provided by the consumer | react (in a UI library), webpack (in a plugin) |
| `optionalDependencies` | Best-effort; install failure is not fatal | fsevents (macOS-only file watcher) |

The rule of thumb: if the package is needed at **runtime in production**, it goes in `dependencies`. If it is only needed to build, lint, or test, it goes in `devDependencies`. If you are authoring a library or plugin that *requires* the host project to already have a package installed, declare it as a `peerDependency`.

> [!PITFALL] Putting everything in `dependencies`
> It is tempting to always use `dependencies` to be "safe." The cost is that anyone who installs your library also downloads your linters and test frameworks — hundreds of megabytes of unnecessary code. Keep `devDependencies` strict.

> [!PRINCIPAL] peerDependencies are a contract, not a convenience
> When you declare `"peerDependencies": { "react": ">=18" }`, you are telling npm: "I do not bundle React — you must have React >=18 in your own project." This avoids shipping two copies of React (which breaks hooks). Always document the peer requirement in your README and test across the full peer range you claim to support.

## Semantic Versioning (semver)

Every npm package version follows **semver**: `MAJOR.MINOR.PATCH`.

- `MAJOR` — breaking change (incompatible API change)
- `MINOR` — new feature, backwards compatible
- `PATCH` — bug fix, backwards compatible

Examples: `1.0.0` → `1.1.0` (new feature) → `1.1.1` (bug fix) → `2.0.0` (breaking change).

Pre-release versions suffix with a tag: `2.0.0-alpha.1`, `2.0.0-rc.3`. These are *lower* than `2.0.0`.

### Version ranges

When you run `npm install express`, npm writes `"express": "^4.18.3"` automatically. What do the prefixes mean?

| Range | Meaning | Matches |
|---|---|---|
| `4.18.3` | Exact version | only `4.18.3` |
| `^4.18.3` | Compatible with (same MAJOR) | `>=4.18.3 <5.0.0` |
| `~4.18.3` | Approximately (same MINOR) | `>=4.18.3 <4.19.0` |
| `>=4.0.0` | Greater-than-or-equal | any `4.x` and above |
| `4.x` or `4.*` | Wildcard minor/patch | `>=4.0.0 <5.0.0` |
| `*` or `""` | Any version | anything |
| `4.1 - 4.9` | Hyphen range (inclusive both ends) | `>=4.1.0 <=4.9.x` |

> [!WARNING] `^` on `0.x` versions behaves differently
> When the major version is `0`, a breaking change may ship in a minor version by convention. So `^0.4.2` only allows `>=0.4.2 <0.5.0` — npm treats each minor as potentially breaking.

## scripts and lifecycle hooks

The `scripts` field lets you define short names for long commands. Run them with `npm run <name>` (or just `npm <name>` for the built-ins `start`, `test`, `stop`, `restart`):

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "node --test src",
    "pretest": "npm run lint",
    "postbuild": "node scripts/copy-assets.js"
  }
}
```

npm automatically runs **pre** and **post** hooks. `pretest` runs before `test`; `postbuild` runs after `build`. This lets you chain steps without a separate task runner.

```bash
npm run build     # runs: prebuild? → build → postbuild?
npm test          # runs: pretest? → test → posttest?
```

Common lifecycle hooks for published packages: `prepare` (runs before publish and after install from git), `prepublishOnly` (runs only before publish, ideal for `tsc` or `npm test`).

## npx — run without installing

`npx` lets you run a package binary without installing it globally:

```bash
npx create-next-app@latest my-app   # fetches + runs, then discards
npx prettier --write .              # use a project-local version preferentially
npx tsx script.ts                   # run TypeScript directly
```

Since npm v7, `npx` also works for local binaries defined in `node_modules/.bin`, so `npx jest` and `./node_modules/.bin/jest` are equivalent.

> [!NOTE] npx vs npm exec
> `npx` is the user-friendly alias. Under the hood it is `npm exec`. For scripting, `npm exec -- vitest run` is equally valid and slightly more explicit.

## Try it yourself

The following semver checker is pure JavaScript — no external library needed for the core logic. It tests whether a version string satisfies a simple range expressed as a `^` or `~` constraint, which is exactly what npm's own `semver` package does internally (the real library is more complete, but this captures the key idea).

```js run
// Minimal semver range checker: supports exact, ^, and ~ operators
function parseVersion(v) {
  // Strip leading non-digit characters (e.g. "^", "~", ">=")
  const clean = v.replace(/^\D+/, '');
  const [major, minor, patch] = clean.split('.').map(Number);
  return { major, minor, patch };
}

function satisfies(version, range) {
  const v = parseVersion(version);

  // Exact match
  if (/^\d/.test(range)) {
    const r = parseVersion(range);
    return v.major === r.major && v.minor === r.minor && v.patch === r.patch;
  }

  const operator = range[0] === '^' ? '^' : range[0] === '~' ? '~' : null;
  if (!operator) return false;
  const r = parseVersion(range.slice(1));

  if (operator === '^') {
    // Same MAJOR, v >= r
    if (r.major === 0) {
      // ^0.y.z: same MAJOR+MINOR, patch may advance
      return v.major === 0 && v.minor === r.minor && v.patch >= r.patch;
    }
    return v.major === r.major &&
      (v.minor > r.minor || (v.minor === r.minor && v.patch >= r.patch));
  }

  if (operator === '~') {
    // Same MAJOR+MINOR, patch may advance
    return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
  }

  return false;
}

const cases = [
  ["1.2.5",  "^1.2.3",  true],
  ["2.0.0",  "^1.2.3",  false],
  ["1.3.0",  "^1.2.3",  true],
  ["1.2.9",  "~1.2.3",  true],
  ["1.3.0",  "~1.2.3",  false],
  ["1.2.3",  "1.2.3",   true],
  ["1.2.4",  "1.2.3",   false],
  ["0.4.5",  "^0.4.2",  true],
  ["0.5.0",  "^0.4.2",  false],
];

cases.forEach(([version, range, expected]) => {
  const result = satisfies(version, range);
  const ok = result === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${version} satisfies ${range} => ${result} (expected ${expected})`);
});
```

## Exercise

**Challenge:** extend `satisfies` above to handle the `>=X.Y.Z` operator so that `satisfies("2.1.0", ">=1.0.0")` returns `true` and `satisfies("0.9.0", ">=1.0.0")` returns `false`.

<details>
<summary>Show solution</summary>

```js run
function parseVersion(v) {
  const clean = v.replace(/^\D+/, '');
  const [major, minor, patch] = clean.split('.').map(Number);
  return { major, minor, patch };
}

function compareVersions(a, b) {
  // Returns positive if a > b, 0 if equal, negative if a < b
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfies(version, range) {
  const v = parseVersion(version);

  if (range.startsWith('>=')) {
    const r = parseVersion(range.slice(2));
    return compareVersions(v, r) >= 0;
  }
  if (range.startsWith('>')) {
    const r = parseVersion(range.slice(1));
    return compareVersions(v, r) > 0;
  }
  if (range.startsWith('^')) {
    const r = parseVersion(range.slice(1));
    if (r.major === 0) {
      return v.major === 0 && v.minor === r.minor && v.patch >= r.patch;
    }
    return v.major === r.major && compareVersions(v, r) >= 0;
  }
  if (range.startsWith('~')) {
    const r = parseVersion(range.slice(1));
    return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
  }
  // Exact
  const r = parseVersion(range);
  return compareVersions(v, r) === 0;
}

console.log(satisfies("2.1.0", ">=1.0.0")); // true
console.log(satisfies("0.9.0", ">=1.0.0")); // false
console.log(satisfies("1.0.0", ">=1.0.0")); // true
console.log(satisfies("3.5.0", "^2.0.0"));  // false
console.log(satisfies("2.9.0", "^2.0.0"));  // true
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting `"type": "module"` and getting CJS by default
> If your source uses `import`/`export` but `package.json` lacks `"type": "module"`, Node treats `.js` files as CommonJS and throws a SyntaxError. Add `"type": "module"` or rename files to `.mjs`. The inverse applies: set `"type": "module"` and any remaining CJS files must be named `.cjs`.

> [!PITFALL] Pinning exact versions in `dependencies`
> Pinning (`"express": "4.18.3"` with no `^`) looks safe but means you stop getting patch-level security fixes unless you manually update. Let npm manage patch updates via `^` and let the **lockfile** guarantee reproducibility — that is what it is for.

## What you learned

- `npm init -y` scaffolds `package.json`; the four dependency kinds have distinct installation semantics.
- `dependencies` is for runtime; `devDependencies` is for build/lint/test; `peerDependencies` declares host requirements; `optionalDependencies` degrades gracefully.
- Semver `MAJOR.MINOR.PATCH` encodes compatibility guarantees; `^` pins MAJOR, `~` pins MINOR, and exact strings pin everything.
- `scripts` with `pre`/`post` hooks build lightweight pipelines; `npx` runs binaries on demand.

## Next steps

Knowing what versions to ask for is half the story. The other half is how npm locks them in place so every developer and every CI run gets exactly the same tree — that is what `package-lock.json` and `npm ci` are about, coming up next.
*/});
