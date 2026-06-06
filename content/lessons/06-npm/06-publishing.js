registerLessonSrc("06-publishing", function () {/*
---
id: 06-publishing
title: "Publishing, Provenance & Supply-Chain Safety"
minutes: 28
level: advanced
objectives:
  - Publish an npm package correctly using files, exports, and .npmignore
  - Understand npm provenance, 2FA, and audit-driven supply-chain security
  - Set up a local Verdaccio registry and a basic pnpm workspace
---

# Publishing, Provenance & Supply-Chain Safety

## Why this matters

Every `npm install` you run executes arbitrary code from strangers. The flip side is true when *you* publish — your package runs in strangers' CI pipelines, production servers, and developer machines. Publishing correctly means exactly the right files ship, only authorised humans can release new versions, and consumers can verify that the tarball came from your CI pipeline and not from a compromised laptop. These are not edge concerns; they are table stakes for anything even moderately popular.

## Learning objectives

- Configure `files`, `exports`, and `main` so only the right files ship.
- Understand scoped packages (`@scope/name`) and when to use them.
- Enable npm provenance and 2FA on publish.
- Run `npm audit`, interpret results, and apply `overrides` to unblock builds.
- Recognise typosquatting and other supply-chain attack vectors.

## Anatomy of a publishable package

Before you `npm publish`, you need three things set correctly: which files ship, how consumers load your code, and what version you are releasing.

### The `files` field and .npmignore

By default npm includes almost everything. The `files` field is an allowlist — only listed paths (plus a few always-included ones like `package.json`, `README`, `LICENSE`) go into the tarball:

```json
{
  "name": "@acme/utils",
  "version": "1.0.0",
  "files": ["dist", "src"],
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./helpers": {
      "import": "./dist/helpers.mjs",
      "require": "./dist/helpers.cjs"
    }
  },
  "types": "./dist/index.d.ts"
}
```

The `exports` field (introduced in Node 12, stable since Node 16) is the modern replacement for `main`. It is a map from subpath to resolved file, with conditions (`import`, `require`, `types`, `browser`, `node`). Critically, it also **blocks** consumers from importing internal paths you did not expose — `import "@acme/utils/internal"` throws unless `"./internal"` is listed in `exports`.

Use `.npmignore` as a complementary denylist if you cannot use `files` alone:

```
# .npmignore
src/
tests/
*.test.js
.github/
tsconfig.json
```

> [!NOTE] Dry-run before you publish
> Run `npm pack --dry-run` to see exactly which files would land in the tarball without actually uploading. Check the output carefully — shipping `tests/`, `.env`, or TypeScript source when you only intend to ship compiled output is a common mistake.

### Scoped packages

Scope your package under an npm username or org to avoid name collisions with public packages and to publish to a private registry:

```bash
npm publish --access public          # unscoped or scoped-public
npm publish --access restricted      # scoped-private (requires paid org)
```

```json
{
  "name": "@myorg/utils",
  "publishConfig": { "registry": "https://npm.pkg.github.com" }
}
```

`publishConfig.registry` lets you publish to GitHub Packages, a Verdaccio instance, or Artifactory without changing your global `.npmrc`.

## The publish workflow

```bash
npm version patch          # bumps patch, creates a git tag
npm version minor          # bumps minor
npm version major          # bumps major
npm publish                # uploads tarball to the registry
npm publish --tag beta     # publish under a dist-tag (not latest)
npm dist-tag add pkg@1.2.0 latest    # move the latest pointer
```

Lifecycle hooks let you automate build steps around publish:

```json
{
  "scripts": {
    "prepublishOnly": "npm test && npm run build",
    "prepare":        "npm run build"
  }
}
```

`prepublishOnly` runs *only* on `npm publish`. `prepare` also runs after a git install (`npm install git+https://...`), so it is safe for building compiled output.

> [!PITFALL] Publishing without building first
> If you forget `prepublishOnly` and publish manually, consumers receive uncompiled TypeScript or source-only files. Add `"prepublishOnly": "tsc"` and your build always runs before the tarball is created.

## npm provenance

**npm provenance** (available since npm 9.5 / 2023) lets the registry record a signed attestation that a specific package version was built by a specific GitHub Actions workflow run. Consumers can verify the build chain with `npm audit signatures`:

```yaml
# .github/workflows/publish.yml (key excerpt)
- name: Publish with provenance
  run: npm publish --provenance --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

When provenance is attached, `npmjs.com` shows a "provenance" badge linking to the exact workflow run and commit SHA. This makes it very hard for a compromised developer account to ship a malicious version — the attestation would be missing or signed by the wrong OIDC identity.

> [!PRINCIPAL] Provenance is the practical answer to "who published this?"
> Supply-chain attacks like the `ua-parser-js` hijack (2021) worked because a legitimate maintainer's account was compromised and a malicious version was published. Provenance ties the package to a specific CI run with an OIDC token — the attacker would need to compromise both the npm account *and* the GitHub Actions environment, with an audit trail in GitHub's logs. Enable it for every public package you publish.

## 2FA and publish tokens

Enable 2FA on your npm account and require it on publish:

```bash
npm profile enable-2fa auth-and-writes
```

For automation use **granular access tokens** (Settings → Access Tokens → Generate New Token → Granular):
- Scope to specific packages only
- Set an expiry date
- Store as a CI secret, never commit it

## npm audit

`npm audit` queries the npm advisory database and reports known vulnerabilities in your dependency tree:

```bash
npm audit                  # show all vulnerabilities
npm audit --audit-level=high   # exit non-zero only for high/critical
npm audit fix              # auto-update packages where safe
npm audit fix --force      # accept breaking semver bumps (check carefully)
```

> [!WARNING] npm audit fix --force can introduce breaking changes
> `--force` will upgrade packages past their semver major, which may break your app. Always run your test suite after `npm audit fix --force` and review the diff.

### Overrides: patching transitive vulnerabilities

When a vulnerability lives in a *transitive* dependency you cannot control, use `overrides` to force a specific version across the whole tree:

```json
{
  "overrides": {
    "semver": "^7.5.4",
    "word-wrap": "^1.2.4"
  }
}
```

pnpm uses `pnpm.overrides` and Yarn uses `resolutions` for the same purpose. Test thoroughly — forcing a version can satisfy the lockfile but break a package that expected a different API.

## Typosquatting and supply-chain hygiene

Common attack vectors:

- **Typosquatting**: `lodash` vs `1odash`, `express` vs `expres`. Always double-check package names before installing.
- **Dependency confusion**: registering a public package with the same name as your private scoped package, hoping the public registry wins the resolution.
- **Account takeover**: a maintainer's npm token leaks; attacker publishes a malicious version.

Practical hygiene:
- Pin exact versions for critical packages in production deployments.
- Use `npm audit signatures` to check provenance.
- Run Dependabot or Renovate to stay on patched versions.
- Use `socket.dev` or similar supply-chain scanners in CI.
- Prefer packages with low dependency counts where possible.

## Project: CLI package + Verdaccio + pnpm workspace

Publish a small CLI package to a local Verdaccio registry, then reorganise it into a pnpm workspace.

### Acceptance criteria

1. A `package.json` with `"bin"` field pointing to a `cli.js` entry file. Running `node cli.js --help` prints usage information without any npm install.
2. `.npmignore` (or `files` field) is configured so that `tests/` and `*.test.js` are excluded from the tarball — verified with `npm pack --dry-run`.
3. A `prepublishOnly` script runs at least one self-test (or `node --check cli.js`) before the tarball is built.
4. The package can be published to a local Verdaccio registry (`http://localhost:4873`) and then installed in a clean temporary directory using `npm install --registry http://localhost:4873 <pkg-name>`, confirming the binary runs.
5. The project is reorganised into a pnpm workspace with at least two members: `packages/cli` (the original package) and `packages/shared` (a tiny utility module imported by the CLI).
6. Running `pnpm -r run build` from the workspace root successfully builds both packages.

### Starter — pure-JS core logic

The snippet below implements the CLI's argument parser and help formatter in plain JavaScript. This is the transferable core — in a real project you would wrap it with a `cli.js` shebang file and publish it.

```js run
// Minimal CLI argument parser (no dependencies)
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = true;
      i += 1;
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { flags, positional };
}

function printHelp(name, commands) {
  const lines = [
    `Usage: ${name} <command> [options]`,
    '',
    'Commands:',
    ...commands.map(c => `  ${c.name.padEnd(12)} ${c.description}`),
    '',
    'Options:',
    '  --help, -h    Show this help message',
    '  --version     Print version number',
  ];
  return lines.join('\n');
}

// Simulate: node cli.js --help
const { flags, positional } = parseArgs(['--help']);
console.log('Parsed args:', JSON.stringify({ flags, positional }));

if (flags.help || flags.h) {
  const help = printHelp('my-cli', [
    { name: 'build',   description: 'Compile the project' },
    { name: 'serve',   description: 'Start the dev server' },
    { name: 'publish', description: 'Publish to the registry' },
  ]);
  console.log('\n' + help);
}

// Simulate: node cli.js build --output dist
const { flags: f2, positional: p2 } = parseArgs(['build', '--output', 'dist']);
console.log('\nParsed build command:', JSON.stringify({ flags: f2, positional: p2 }));
```

<details>
<summary>Show how cli.js and the workspace layout would look</summary>

```js
// packages/cli/cli.js  (real file — not runnable in browser sandbox)
// #!/usr/bin/env node
// The shebang above makes this executable after `chmod +x cli.js`

// import { parseArgs, printHelp } from '../shared/index.js';   (workspace dep)

const { parseArgs, printHelp } = require('../../shared');
const { flags, positional }    = parseArgs(process.argv.slice(2));

if (flags.help || flags.h || positional.length === 0) {
  console.log(printHelp('my-cli', [
    { name: 'build',   description: 'Compile the project' },
    { name: 'serve',   description: 'Start the dev server' },
    { name: 'publish', description: 'Publish to the registry' },
  ]));
  process.exit(0);
}

console.log('Running command:', positional[0], 'with flags:', flags);
```

Workspace layout:

```
my-monorepo/
  pnpm-workspace.yaml
  package.json           ("packageManager": "pnpm@9.x.x")
  packages/
    cli/
      package.json       ("bin": {"my-cli": "./cli.js"}, "dependencies": {"shared": "workspace:*"})
      cli.js
    shared/
      package.json
      index.js           (exports parseArgs, printHelp)
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

```bash
# Verdaccio quick start
npx verdaccio                            # starts registry at http://localhost:4873
npm adduser --registry http://localhost:4873
cd packages/cli
npm publish --registry http://localhost:4873
# In a temp dir:
npm install my-cli --registry http://localhost:4873
npx my-cli --help
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to set "private": true on the workspace root
> If you `npm publish` from the workspace root accidentally, you ship the monorepo glue — not a real package. Always add `"private": true` to the root `package.json` of any workspace or app repo that should never be published.

> [!PITFALL] Shipping secrets in a tarball
> `.env` files, AWS credentials in `config/`, or internal scripts can all end up in your tarball if you rely solely on `.gitignore` — `.npmignore` is separate. Use `npm pack --dry-run` before every first publish of a new package and after adding any new directories.

## What you learned

- The `files` field and `exports` map control exactly what ships and what is importable; `npm pack --dry-run` verifies it.
- npm provenance attaches a signed CI attestation to a publish, providing a cryptographic paper trail from source commit to tarball.
- `npm audit` surfaces known vulnerabilities; `overrides` lets you patch transitive deps you do not control directly.
- Typosquatting and dependency confusion are real attack vectors — verify package names and prefer low-dep packages.
- A pnpm workspace with `workspace:*` references is the modern monorepo foundation; Verdaccio lets you rehearse publishing locally.

## Next steps

The file system is the next foundational Node skill: reading, writing, streaming files, watching for changes, and working with paths across platforms. That is where the next module begins.
*/});
