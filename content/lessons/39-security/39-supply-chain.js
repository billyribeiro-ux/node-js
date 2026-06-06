registerLessonSrc("39-supply-chain", function () {/*
---
id: 39-supply-chain
title: "Supply-Chain Security, SBOM & Provenance"
minutes: 26
level: principal
objectives:
  - Identify the key attack vectors in the npm dependency supply chain
  - Evaluate a project's dependency risk using audit, lockfiles, and heuristics
  - Generate an SBOM and understand provenance attestation
---

# Supply-Chain Security, SBOM & Provenance

## Why this matters

The average Node.js application installs hundreds of packages. Each one is code you did not write, reviewed by maintainers you have never met, fetched from a registry you do not control. The 2021 `ua-parser-js` compromise, the `event-stream` backdoor, and countless typosquatting campaigns demonstrate that attackers have discovered this is the easiest path into production Node services. A principal engineer does not just write secure code — they secure the entire pipeline that brings code in.

## Learning objectives

- Describe the main supply-chain attack vectors: typosquatting, compromised packages, and malicious install scripts.
- Use `npm audit`, lockfile integrity checks, and heuristic signals to evaluate dependency risk.
- Explain what a **Software Bill of Materials (SBOM)** is and produce one in CycloneDX or SPDX format.
- Understand **provenance attestation** and how it ties a published package to its build pipeline.
- Know how the **Node.js Permission Model** reduces blast radius when a dependency misbehaves.

## The attack surface: your node_modules

When you run `npm install`, you trust:

1. The **registry** (npmjs.com) to serve the package you asked for.
2. The **maintainer** not to push malicious code intentionally or to have their account compromised.
3. Every **transitive dependency** of every package — often dozens of packages you have never heard of.
4. The **install scripts** (`preinstall`, `install`, `postinstall`) which run arbitrary code with your user's privileges during `npm install`.

This is an enormous trust surface. Let's look at each attack category.

### Typosquatting

Attackers register packages with names visually similar to popular ones — `cros-env` instead of `cross-env`, `lodahs` instead of `lodash`. A single typo in a `package.json` installs malware. High-value typosquats often mimic the exact functionality of the real package while exfiltrating environment variables or secrets.

### Compromised packages

Maintainers of legitimate, widely used packages can be compromised via phishing, credential stuffing, or social engineering. The `event-stream` incident saw an attacker add a new maintainer to a package with 2 million weekly downloads, then publish a version containing a Bitcoin-wallet thief hidden inside a dependency added two levels deep.

### Malicious install scripts

`package.json` allows `scripts.preinstall` and `scripts.postinstall`. These run as shell commands at install time, before you have reviewed any code. They can exfiltrate `~/.ssh`, dump environment variables, or install persistent backdoors.

```js
// Example of a dangerous postinstall pattern (from a real malicious package)
// "scripts": { "postinstall": "node -e \"require('child_process').exec('curl ...')" }
//
// How to detect: inspect package.json before installing any unfamiliar package.
// How to mitigate:
//   npm install --ignore-scripts     (disable all install scripts globally)
//   npm config set ignore-scripts true
```

> [!WARNING] `--ignore-scripts` breaks some legitimate packages
> Native add-ons (like `bcrypt`, `better-sqlite3`) need their `postinstall` to run `node-gyp`. Use `--ignore-scripts` as the default, then whitelist packages that legitimately need it. The Node Permission Model (below) is a better long-term solution.

## Lockfile integrity

The `package-lock.json` (or `yarn.lock` / `pnpm-lock.yaml`) pins the exact version and the **content hash** of every package. This is your primary integrity guarantee.

```js
// package-lock.json entry (simplified)
// "node_modules/some-package": {
//   "version": "1.2.3",
//   "resolved": "https://registry.npmjs.org/some-package/-/some-package-1.2.3.tgz",
//   "integrity": "sha512-<base64-sha512-hash>",
//   ...
// }
//
// npm ci verifies this hash on install — if the tarball content has changed
// since the lockfile was written, the install fails. Use `npm ci` in CI/CD,
// never `npm install`, to get this guarantee.
```

> [!PITFALL] Committing `node_modules` instead of the lockfile
> Some teams commit `node_modules` to avoid install time. This means you lose the integrity check mechanism entirely — an attacker who can modify your repository can directly alter dependency code. Always commit the lockfile; never commit `node_modules`.

```bash
# In CI/CD pipelines, always prefer:
npm ci

# Not:
npm install
```

`npm ci` also fails loudly if `package.json` and `package-lock.json` are out of sync, which catches the common mistake of manually editing one without updating the other.

## npm audit

`npm audit` queries the npm registry's advisory database and reports known vulnerabilities in your dependency tree.

```bash
npm audit
npm audit --json          # machine-readable output for CI integration
npm audit fix             # auto-upgrade to the nearest non-vulnerable version
npm audit fix --force     # also allows major-version upgrades (review carefully)
```

> [!OUTPUT]
> found 3 vulnerabilities (1 moderate, 2 high)
>
> # Run  npm audit fix  to fix 2 of them.
> 1 vulnerability requires manual review. See the full report for details.

> [!NOTE] `npm audit` reports known CVEs — it cannot detect novel or hidden malware
> `npm audit` is necessary but not sufficient. A freshly compromised package may have zero CVEs. Pair it with behavioural scanning tools.

## Behavioural and heuristic scanning (Socket-style)

Tools like [Socket.dev](https://socket.dev) analyse package behaviour beyond known CVEs:

- Does this package **read files** outside its directory?
- Does it **spawn shell processes** in its install scripts?
- Does it **make network requests** at install time?
- Is the maintainer account **newly created** or recently transferred?
- Does the package have an **unusually small number of stars/downloads** relative to its dependents?

You can apply similar heuristics manually by inspecting the `package.json` of any dependency:

```bash
# Inspect a package before installing:
npm pack <package-name> --dry-run
npx npm-package-audit <package-name>

# Check the install scripts:
cat node_modules/<package-name>/package.json | grep -A5 '"scripts"'
```

## Minimising dependencies

The most secure dependency is the one you do not have. Before adding a package, ask:

1. Is this function small enough to write myself? (left-pad, is-odd…)
2. Does this package pull in 50 transitive dependencies to solve a 10-line problem?
3. Is the package actively maintained? (last publish date, open issues, changelogs)
4. Does it have a significant user base and multiple maintainers?

> [!PRINCIPAL] Dependency budgeting as an engineering discipline
> Some principal engineers set an explicit **dependency budget** per service: a maximum number of production dependencies. Every new addition requires removing one or justifying an exception. This forces conscious trade-offs and prevents the slow accumulation of hundreds of unmaintained, single-purpose packages that characterise old projects.

## Software Bill of Materials (SBOM)

An **SBOM** is a machine-readable inventory of every component in your software, including direct and transitive dependencies, their versions, licences, and hashes. Analogous to a physical product's ingredient list, it lets you answer "are we affected by CVE-XXXX-YYYY?" in seconds rather than days.

The two dominant formats are:

- **CycloneDX** — JSON or XML, widely tooled, common in DevSecOps pipelines.
- **SPDX** — ISO standard, text or JSON, common in open-source licence compliance.

```bash
# Generate a CycloneDX SBOM with the official CLI:
npx @cyclonedx/cyclonedx-npm --output-file sbom.json

# Or use Syft for both CycloneDX and SPDX:
syft . -o cyclonedx-json > sbom.json
syft . -o spdx-json > sbom-spdx.json
```

> [!OUTPUT]
> {
>   "bomFormat": "CycloneDX",
>   "specVersion": "1.5",
>   "version": 1,
>   "components": [
>     {
>       "type": "library",
>       "name": "express",
>       "version": "4.18.2",
>       "purl": "pkg:npm/express@4.18.2",
>       "hashes": [{ "alg": "SHA-512", "content": "abc123..." }]
>     }
>   ]
> }

SBOMs are increasingly mandated: US Executive Order 14028 requires them for software sold to the US federal government, and the EU Cyber Resilience Act has similar requirements. Even if you are not legally required, publishing an SBOM signals maturity and enables downstream users to assess their own exposure.

## Provenance and attestation

**Provenance** answers: "Who built this artifact, from what source, on what infrastructure?" Without it, a malicious maintainer (or attacker with registry credentials) can publish a package that does not correspond to the audited source code.

npm supports provenance attestation since 2023. When a package is published from a GitHub Actions (or similar) CI pipeline, npm creates a cryptographically signed attestation linking:

- The published tarball (by hash)
- The source repository and commit SHA
- The CI workflow that ran the build

```bash
# Publishing with provenance from GitHub Actions:
# npm publish --provenance
#
# (Requires the workflow to have: id-token: write  permission)
# Consumers can verify:
# npm audit signatures
```

> [!OUTPUT]
> audited 1 package
>
> express@4.18.2
> Integrity: Verified
> Provenance: Verified (GitHub Actions: expressjs/express@main, run #1234)

When you run `npm audit signatures`, npm fetches the attestations and verifies the cryptographic chain from the registry tarball back to the specific CI run. A package without provenance is not necessarily malicious, but a package that *has* provenance and fails verification absolutely should not be used.

## The Node.js Permission Model

Node.js 20+ includes an experimental **Permission Model** (`--experimental-permission`) that restricts what a process can do at runtime:

```bash
# Only allow reading from ./data and writing to ./out; deny all fs ops otherwise:
node --experimental-permission \
     --allow-fs-read=./data \
     --allow-fs-write=./out \
     server.js

# Only allow child processes (spawn) if you explicitly permit it:
node --experimental-permission --allow-child-process server.js
```

If a compromised dependency tries to read `~/.ssh/id_rsa` or spawn a reverse shell, the Permission Model terminates the operation with a permission error rather than silently allowing it. This does not prevent compromise — but it dramatically reduces blast radius.

> [!NOTE] The Permission Model is not a replacement for network isolation
> It controls filesystem, child-process, and native-addon access. Network access (sockets) is not yet restricted by the Permission Model in Node 24 LTS. Pair it with network-level controls (no egress by default, allowlist specific outbound destinations).

## Try it yourself

Here is a dependency-risk scanner that evaluates a fake manifest against a set of heuristic signals and produces a risk report — the same logic that tools like Socket.dev apply, expressed in pure JS:

```js run
// Dependency risk scorer — heuristic signals over a fake manifest

const manifest = [
  {
    name: "express",
    version: "4.18.2",
    publishedDaysAgo: 180,
    weeklyDownloads: 30_000_000,
    maintainerCount: 8,
    hasInstallScript: false,
    openIssues: 42,
  },
  {
    name: "totally-legit-utils",
    version: "0.0.1",
    publishedDaysAgo: 2,
    weeklyDownloads: 150,
    maintainerCount: 1,
    hasInstallScript: true,
    openIssues: 0,
  },
  {
    name: "left-recursion",
    version: "1.0.0",
    publishedDaysAgo: 900,
    weeklyDownloads: 800,
    maintainerCount: 1,
    hasInstallScript: false,
    openIssues: 31,
  },
  {
    name: "lodahs",  // typosquat
    version: "4.17.21",
    publishedDaysAgo: 5,
    weeklyDownloads: 300,
    maintainerCount: 1,
    hasInstallScript: true,
    openIssues: 0,
  },
];

function scoreDependency(pkg) {
  let risk = 0;
  const flags = [];

  if (pkg.publishedDaysAgo < 7) {
    risk += 30;
    flags.push("very-new-release");
  } else if (pkg.publishedDaysAgo < 30) {
    risk += 10;
    flags.push("recent-release");
  }

  if (pkg.weeklyDownloads < 1_000) {
    risk += 25;
    flags.push("low-adoption");
  } else if (pkg.weeklyDownloads < 10_000) {
    risk += 10;
    flags.push("modest-adoption");
  }

  if (pkg.maintainerCount === 1) {
    risk += 20;
    flags.push("single-maintainer");
  }

  if (pkg.hasInstallScript) {
    risk += 35;
    flags.push("install-script");
  }

  if (pkg.openIssues > 50) {
    risk += 10;
    flags.push("high-open-issues");
  }

  const label =
    risk >= 60 ? "HIGH" :
    risk >= 30 ? "MEDIUM" : "LOW";

  return { name: pkg.name, risk, label, flags };
}

const results = manifest
  .map(scoreDependency)
  .sort((a, b) => b.risk - a.risk);

console.log("=== Dependency Risk Report ===\n");
results.forEach(r => {
  console.log(`[${r.label.padEnd(6)}] ${r.name} (score: ${r.risk})`);
  if (r.flags.length) console.log(`         Flags: ${r.flags.join(", ")}`);
});
```

## Exercises

**Exercise 1 — Add a typosquat signal.** The names `lodahs` and `expres` are suspicious because they closely match popular packages. Extend the scanner to flag packages whose name is within edit-distance 2 of a known popular package name.

<details>
<summary>Show solution</summary>

```js run
// Levenshtein distance (edit distance) to detect typosquatting
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}

const popular = ["lodash", "express", "react", "axios", "chalk", "commander"];

function isTyposquat(name) {
  return popular.some(p => p !== name && editDistance(name, p) <= 2);
}

const candidates = ["lodahs", "expres", "axois", "express", "lodash", "comander"];
candidates.forEach(pkg => {
  const flag = isTyposquat(pkg);
  console.log(`${pkg.padEnd(12)} → ${flag ? "TYPOSQUAT SUSPECTED" : "ok"}`);
});
```

</details>

**Exercise 2 — Allowlist install scripts.** Modify the risk scorer so that packages in an explicit allowlist (e.g. `["bcrypt", "better-sqlite3"]`) do not get penalised for having an install script.

<details>
<summary>Show solution</summary>

```js run
const INSTALL_SCRIPT_ALLOWLIST = new Set(["bcrypt", "better-sqlite3", "node-sass"]);

function scoreDep(pkg) {
  let risk = 0;
  const flags = [];

  if (pkg.publishedDaysAgo < 7)  { risk += 30; flags.push("very-new-release"); }
  if (pkg.weeklyDownloads < 1000) { risk += 25; flags.push("low-adoption"); }
  if (pkg.maintainerCount === 1)  { risk += 20; flags.push("single-maintainer"); }

  if (pkg.hasInstallScript && !INSTALL_SCRIPT_ALLOWLIST.has(pkg.name)) {
    risk += 35;
    flags.push("install-script (not allowlisted)");
  } else if (pkg.hasInstallScript) {
    flags.push("install-script (allowlisted — ok)");
  }

  return {
    name: pkg.name,
    risk,
    label: risk >= 60 ? "HIGH" : risk >= 30 ? "MEDIUM" : "LOW",
    flags,
  };
}

const pkgs = [
  { name: "bcrypt",              publishedDaysAgo: 200, weeklyDownloads: 500_000, maintainerCount: 3, hasInstallScript: true },
  { name: "suspicious-helper",   publishedDaysAgo: 3,   weeklyDownloads: 100,     maintainerCount: 1, hasInstallScript: true },
];

pkgs.map(scoreDep).forEach(r => {
  console.log(`[${r.label}] ${r.name}`);
  r.flags.forEach(f => console.log(`  - ${f}`));
});
```

</details>

## Common pitfalls

> [!PITFALL] Treating `npm audit` as a complete security solution
> `npm audit` only checks for *known* CVEs in direct and transitive dependencies. It will not catch a freshly compromised package, a novel malicious install script, or a typosquat that has never been reported. Layer `npm audit` with lockfile integrity (`npm ci`), provenance verification (`npm audit signatures`), and behavioural scanning.

Also: do not auto-merge `npm audit fix` PRs without review. A "fix" that upgrades a major version may introduce breaking changes or, in rare cases, the "fix" version itself may have a different vulnerability. Always read the diff.

## What you learned

- Supply-chain attacks target **typosquatting**, **compromised maintainer accounts**, and **malicious install scripts** — all code you did not write.
- `npm ci` with a committed lockfile enforces **content-hash integrity** on every install.
- `npm audit` finds known CVEs; **behavioural scanning** (Socket-style heuristics) catches the unknowns.
- An **SBOM** in CycloneDX or SPDX format gives you a machine-readable inventory for rapid CVE triage.
- **Provenance attestation** cryptographically links a published package to its source commit and CI run.
- The **Node.js Permission Model** limits filesystem and process access so a compromised dependency has a smaller blast radius.

## Next steps

With your dependency supply chain secured, the final lesson in this module tackles the vulnerabilities that live in your own code: prototype pollution, ReDoS, SSRF, and the rest of the OWASP Top 10 for Node — and gives you a framework for running a full security review of any platform.
*/});
