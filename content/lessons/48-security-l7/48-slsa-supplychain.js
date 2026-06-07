registerLessonSrc("48-slsa-supplychain", function () {/*
---
id: 48-slsa-supplychain
title: "SLSA, Provenance & Reproducible Builds"
minutes: 28
level: principal
objectives:
  - Understand SLSA levels L1–L4 and what each mechanically requires
  - Explain build provenance, in-toto attestations, and Sigstore/cosign signing
  - Evaluate a build pipeline and compute its achieved SLSA level
---

# SLSA, Provenance & Reproducible Builds

## Why this matters

The xz-utils backdoor (March 2024) was a two-year social-engineering campaign that inserted malicious code into a build step — *not* the source repository. The resulting binary was signed and shipped in major Linux distributions. The attack succeeded specifically because the build process was opaque: there was no way to verify that the artifact consumers downloaded matched the source they thought they were getting. SLSA (Supply-chain Levels for Software Artifacts) is the structured answer to that class of attack. At L7 you need to reason about your organization's entire software factory, not just the application code.

## Learning objectives

- Map the four **SLSA levels** to concrete build-system requirements.
- Explain **provenance attestations** (in-toto predicates), **Sigstore/cosign** keyless signing, and **npm provenance**.
- Understand **reproducible/hermetic builds** and why they are both valuable and hard.
- Generate and consume **SBOMs** (CycloneDX / SPDX) in a CI pipeline.
- Apply **dependency pinning and hash verification** as a baseline control.
- Describe the **xz-style attack pattern** and which SLSA controls would have contained it.

## The SLSA framework: four levels

SLSA (pronounced "salsa") is a Google-originated framework, now maintained by the OpenSSF. It defines four levels of increasing supply-chain integrity:

| Level | Requirement summary | What it prevents |
|-------|---------------------|------------------|
| **L1** | Provenance exists (unsigned OK) | Accidental build-log loss |
| **L2** | Provenance is signed by the build service; source version controlled | Tampering after the build; source ambiguity |
| **L3** | Build runs on a hardened, dedicated platform; builds are isolated; full parameter capture | Tampering *during* the build; cross-build poisoning |
| **L4** | Hermetic (reproducible) build; two-party review of all changes | Build-system compromise; insider threat to source |

> [!NOTE]
> SLSA L4 is genuinely hard to reach. Most production software today is L0 (no provenance) or L1. L2 is achievable in a day with GitHub Actions + the official SLSA GitHub generator. L3 requires a hardened runner. L4 requires deterministic builds — a property that most build tools (even `npm ci`) do not guarantee without extra effort.

## What provenance actually is

A **provenance attestation** is a signed statement of the form: "artifact with digest `sha256:abc…` was produced by build `#1234` running at `2026-03-10T14:00Z` from source `github.com/acme/svc@a1b2c3d` using `npm ci && npm run build`." This statement is represented using the **in-toto Attestation Framework**, a JSON envelope with a `predicateType` and a typed `predicate` body.

```json
{
  "_type": "https://in-toto.io/Statement/v0.1",
  "subject": [
    { "name": "dist/server.js",
      "digest": { "sha256": "e3b0c44298fc1c149afb..." } }
  ],
  "predicateType": "https://slsa.dev/provenance/v0.2",
  "predicate": {
    "builder": { "id": "https://github.com/slsa-framework/slsa-github-generator" },
    "buildType": "https://github.com/npm/cli/tree/v10",
    "invocation": {
      "configSource": {
        "uri": "git+https://github.com/acme/svc@refs/heads/main",
        "digest": { "sha1": "a1b2c3d4e5f6..." },
        "entryPoint": ".github/workflows/release.yml"
      }
    }
  }
}
```

The statement is wrapped in a **DSSE envelope** (Dead Simple Signing Envelope) and signed. With **Sigstore/cosign**, the signature is *keyless*: the builder authenticates via OIDC (GitHub Actions provides an identity token) and Sigstore's Fulcio CA issues a short-lived certificate. The signature and certificate are stored in Sigstore's **Rekor** transparency log — a tamper-evident, append-only ledger. Verification does not require any pre-distributed key; you verify against the Rekor log using the build identity (e.g., `https://github.com/acme/svc/.github/workflows/release.yml@refs/heads/main`).

```bash
# Sign an artifact with cosign (keyless, uses OIDC in CI)
cosign sign-blob --bundle cosign.bundle dist/server.js

# Verify later
cosign verify-blob \
  --bundle cosign.bundle \
  --certificate-identity "https://github.com/acme/svc/.github/workflows/release.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  dist/server.js
```

> [!OUTPUT]
> Verified OK

> [!PRINCIPAL]
> The keyless model is a paradigm shift. Traditional signing requires managing long-lived private keys, which themselves become high-value targets (see: SolarWinds, where the build signing key was stolen). Sigstore's Rekor-backed keyless approach means the attacker must compromise the OIDC issuer (GitHub's identity system) *and* forge a Rekor entry — two independent, publicly monitored systems. The effective attack surface is dramatically smaller.

## npm provenance (Node-specific)

Since npm 9.5 / Node 18, `npm publish --provenance` embeds a Sigstore-signed SLSA L2 provenance attestation in the registry record. Any consumer can verify it:

```bash
# Publish with provenance (must run inside GitHub Actions or another supported CI)
npm publish --provenance

# Inspect provenance for a published package
npm audit signatures

# Verify a specific package
npm install sigstore
node -e "const {verify} = require('sigstore'); ..."
```

> [!OUTPUT]
> audited 1 package
> 1 package has a verified attestation
> Package: my-lib@1.2.3  Attestation: SLSA L2 (GitHub Actions)  Signer: https://github.com/acme/my-lib

The provenance record links the exact npm tarball hash to the exact git commit SHA, the workflow file, and the run ID. If an attacker compromises the npm publish step and replaces the tarball, the attestation will not verify — the digest in the signed statement will not match.

## Reproducible and hermetic builds

A build is **reproducible** if the same source inputs produce a byte-for-byte identical artifact every time, regardless of when or where it runs. A build is **hermetic** if all inputs are declared and fetched at the start, and the build environment has no network access during the build itself (preventing mid-build dependency substitution).

Achieving reproducibility in Node requires removing every source of non-determinism:

- **Timestamps** — build tools that embed `Date.now()` in output must be patched or zeroed (set `SOURCE_DATE_EPOCH`).
- **File ordering** — filesystem readdir order varies by OS and FS; sort explicitly.
- **npm lockfiles** — use `npm ci` (not `npm install`), pin to exact versions, and verify checksums.
- **Node version** — pin the exact Node binary hash, not just the semver tag.
- **Native modules** — must be cross-compiled from identical source; prebuild with `node-gyp` against a pinned toolchain.

```bash
# In CI, after the build, verify reproducibility:
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) npm run build
sha256sum dist/server.js > first.sum

# Rebuild on a different runner
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) npm run build
sha256sum dist/server.js > second.sum

diff first.sum second.sum   # should produce no output
```

> [!OUTPUT]
> (no diff — build is reproducible)

## SBOMs in CI (CycloneDX / SPDX)

A **Software Bill of Materials** is a machine-readable inventory of every dependency in your artifact. Two dominant standards:

- **SPDX** (ISO/IEC 5962:2021) — text or JSON, widely adopted in regulated industries.
- **CycloneDX** — JSON/XML, richer vulnerability metadata, native npm tooling.

```bash
# Generate a CycloneDX SBOM for your Node project
npx @cyclonedx/cyclonedx-npm --output-format json --output-file sbom.cdx.json

# Generate an SPDX SBOM
npx spdx-sbom-generator -p . -o sbom.spdx.json
```

In CI, attach the SBOM as a build artifact and sign it with cosign. During deployment, a policy gate can reject artifacts whose SBOM contains dependencies with known CVEs (via `grype sbom.cdx.json` or `osv-scanner --sbom sbom.cdx.json`).

## Dependency pinning and verification

`package-lock.json` records the exact resolved version and `integrity` SHA-512 hash of every package. `npm ci` verifies those hashes before installing. This is your baseline L1/L2 control.

But lockfiles have limits. They only cover `node_modules` — not the npm CLI itself, not the Node binary, not the build toolchain. A fully rigorous supply-chain control pins everything:

```bash
# Pin the Node version via .nvmrc or .node-version
echo "24.2.0" > .node-version

# Verify the Node binary itself
sha256sum $(which node)
# Compare against https://nodejs.org/dist/v24.2.0/SHASUMS256.txt
```

> [!PRINCIPAL]
> The xz-utils attack succeeded at layer zero: the attacker became a *trusted contributor* and inserted malicious code in the **build system's test harness**, not in the core source. The malicious code only activated during package builds on specific platforms — it would not appear in source diffs or unit-test runs. The lesson is that SLSA L3/L4's requirement for *hermetic, isolated builds with two-party review of all inputs* — including build scripts and CI configuration — is not paranoia, it's the only structural defense. Reviewing source PRs is necessary but insufficient; you must also review changes to the build pipeline itself with the same rigor.

> [!PITFALL]
> Many teams add SBOM generation to CI but never *consume* the output. An SBOM that is generated and archived but never scanned against a vulnerability database or used in a policy gate provides only the illusion of supply-chain security. Wire your SBOM to `grype`, `osv-scanner`, or `trivy` and fail the build on HIGH/CRITICAL CVEs in direct dependencies. Then establish a triage SLA: you can't fix what you don't track.

## Try it yourself

This engine models SLSA level checking. Given a build's declared properties, it computes the highest SLSA level achieved and lists which requirements are unmet for the next level.

```js run
// SLSA Level Checker — pure logic, no Node APIs required.
// Each level's requirements must ALL be met to achieve that level.

const SLSA_REQUIREMENTS = {
  L1: [
    { id: 'provenance-exists',    label: 'Provenance document exists' },
  ],
  L2: [
    { id: 'provenance-signed',    label: 'Provenance is signed by build service' },
    { id: 'source-version-ctrl',  label: 'Source is version-controlled (git)' },
    { id: 'provenance-service',   label: 'Provenance generated by build service, not user' },
  ],
  L3: [
    { id: 'isolated-build',       label: 'Each build runs in an isolated environment' },
    { id: 'parameterized-build',  label: 'All build parameters captured in provenance' },
    { id: 'hardened-platform',    label: 'Build platform is hardened (no SSH, no root)' },
    { id: 'no-secret-exfil',      label: 'Build cannot exfiltrate secrets via env or network' },
  ],
  L4: [
    { id: 'hermetic-build',       label: 'Build is hermetic (all deps fetched before build, no mid-build network)' },
    { id: 'reproducible-build',   label: 'Build is reproducible byte-for-byte' },
    { id: 'two-party-review',     label: 'All source and build changes require two-party review' },
  ],
};

function checkSlsaLevel(buildProps) {
  const levels = ['L1', 'L2', 'L3', 'L4'];
  let achievedLevel = 'L0';
  const report = [];

  for (const level of levels) {
    const reqs = SLSA_REQUIREMENTS[level];
    const unmet = reqs.filter(r => !buildProps[r.id]);
    if (unmet.length === 0) {
      achievedLevel = level;
      report.push({ level, status: 'PASS', unmet: [] });
    } else {
      report.push({ level, status: 'FAIL', unmet: unmet.map(r => r.label) });
      break; // SLSA levels must be achieved in order
    }
  }
  return { achievedLevel, report };
}

// Example: a typical GitHub Actions build with SLSA generator
const typicalCiBuild = {
  'provenance-exists':   true,
  'provenance-signed':   true,
  'source-version-ctrl': true,
  'provenance-service':  true,
  'isolated-build':      true,   // GHA ephemeral runner
  'parameterized-build': true,   // SLSA generator captures all params
  'hardened-platform':   false,  // standard runner, not hardened
  'no-secret-exfil':     false,  // runner can reach internet during build
  'hermetic-build':      false,
  'reproducible-build':  false,
  'two-party-review':    false,
};

const result = checkSlsaLevel(typicalCiBuild);
console.log('=== SLSA Level Analysis ===\n');
console.log(`Achieved: ${result.achievedLevel}\n`);

result.report.forEach(r => {
  console.log(`${r.status === 'PASS' ? '[PASS]' : '[FAIL]'} ${r.level}`);
  if (r.unmet.length > 0) {
    r.unmet.forEach(u => console.log(`  - UNMET: ${u}`));
  }
});

// Compare with a fully hardened L4 build
console.log('\n--- Simulating L4-capable build ---\n');
const l4Build = Object.fromEntries(Object.keys(typicalCiBuild).map(k => [k, true]));
const l4Result = checkSlsaLevel(l4Build);
console.log(`Achieved: ${l4Result.achievedLevel}`);
l4Result.report.forEach(r => console.log(`  ${r.level}: ${r.status}`));
```

## Exercise

**Exercise:** A build has provenance generated by the developer's laptop (not the CI system), committed to git, but not signed. The runner shares a network namespace with other builds. Compute its SLSA level and list the two most impactful things to fix first.

<details>
<summary>Show solution</summary>

```js run
const SLSA_REQUIREMENTS = {
  L1: [{ id: 'provenance-exists', label: 'Provenance document exists' }],
  L2: [
    { id: 'provenance-signed',   label: 'Provenance is signed by build service' },
    { id: 'source-version-ctrl', label: 'Source is version-controlled' },
    { id: 'provenance-service',  label: 'Provenance generated by build service, not user' },
  ],
  L3: [
    { id: 'isolated-build',      label: 'Each build runs in an isolated environment' },
    { id: 'parameterized-build', label: 'All build parameters captured in provenance' },
    { id: 'hardened-platform',   label: 'Build platform is hardened' },
    { id: 'no-secret-exfil',     label: 'Build cannot exfiltrate secrets' },
  ],
  L4: [
    { id: 'hermetic-build',      label: 'Hermetic build' },
    { id: 'reproducible-build',  label: 'Reproducible build' },
    { id: 'two-party-review',    label: 'Two-party review' },
  ],
};

const laptopBuild = {
  'provenance-exists':   true,   // exists
  'provenance-signed':   false,  // not signed
  'source-version-ctrl': true,
  'provenance-service':  false,  // generated by developer, not CI
  'isolated-build':      false,  // shared network namespace
  'parameterized-build': false,
  'hardened-platform':   false,
  'no-secret-exfil':     false,
  'hermetic-build':      false,
  'reproducible-build':  false,
  'two-party-review':    false,
};

function checkSlsaLevel(props) {
  const levels = ['L1','L2','L3','L4'];
  let achieved = 'L0';
  const report = [];
  for (const level of levels) {
    const unmet = SLSA_REQUIREMENTS[level].filter(r => !props[r.id]);
    if (unmet.length === 0) { achieved = level; report.push({level, status:'PASS', unmet:[]}); }
    else { report.push({level, status:'FAIL', unmet: unmet.map(r=>r.label)}); break; }
  }
  return { achieved, report };
}

const { achieved, report } = checkSlsaLevel(laptopBuild);
console.log(`Achieved: ${achieved}`);  // L1 — only provenance-exists passes L1
report.forEach(r => {
  console.log(`${r.level}: ${r.status}`);
  r.unmet.forEach(u => console.log(`  UNMET: ${u}`));
});

// Two highest-impact fixes to move toward L2:
console.log('\nTop 2 fixes:');
console.log('1. Move provenance generation to CI (eliminates provenance-service gap and enables signing)');
console.log('2. Sign the provenance with cosign --keyless in CI (satisfies provenance-signed)');
console.log('   Both together lift this build from L1 to L2 in one sprint.');
```

</details>

## Common pitfalls

> [!PITFALL]
> **Signing the wrong thing.** It is common to sign a build *log* or a git *tag* rather than the actual artifact digest. A signed git tag proves the source commit is authentic but says nothing about what the build produced. Always sign the artifact's `sha256` digest as the `subject` of the attestation, and verify the artifact you actually deploy matches that digest at deploy time — not just at build time.

A second pitfall: generating an SBOM but not locking its inputs. If your SBOM is generated from `node_modules` contents after an `npm install` (rather than `npm ci`), the SBOM reflects whatever happened to resolve at that moment — which may differ from what was pinned in the lockfile due to an `npm install` that updated it silently.

## What you learned

- **SLSA L1–L4** form a staircase of supply-chain integrity controls; most real projects are at L0–L1 today.
- **Provenance attestations** (in-toto format, SLSA predicate) are signed machine-readable records linking an artifact digest to its exact source and build invocation.
- **Sigstore/cosign keyless signing** uses OIDC and the Rekor transparency log to eliminate long-lived signing keys.
- **npm provenance** (`npm publish --provenance`) embeds SLSA L2 attestations in the npm registry for any consumer to verify.
- **Reproducible/hermetic builds** remove non-determinism and prevent mid-build dependency substitution — the structural defense against xz-style attacks.
- **SBOMs** (CycloneDX/SPDX) are the inventory layer; they are only valuable when continuously scanned against vulnerability databases.

## Next steps

With your build pipeline hardened and provenance established, the next frontier is runtime isolation — how to fuzz your attack surface to find vulnerabilities before attackers do, and how to sandbox untrusted code so that even successful exploitation is contained.
*/});
