registerQuiz("06-package-management", [
  {
    q: "Which dependency field should you use for a package that is only needed to run your linter and test suite, not in production?",
    options: [
      "dependencies",
      "peerDependencies",
      "devDependencies",
      "optionalDependencies"
    ],
    answer: 2,
    explain: "devDependencies are installed only in your own project and not when others install your package, making them the correct choice for build, lint, and test tools."
  },
  {
    q: "What version range does `^0.4.2` match in npm semver?",
    options: [
      ">=0.4.2 <1.0.0",
      ">=0.4.2 <0.5.0",
      ">=0.4.2 <0.4.3",
      ">=0.4.0 <1.0.0"
    ],
    answer: 1,
    explain: "When the major version is 0, the caret operator treats each minor version as potentially breaking. So ^0.4.2 only allows >=0.4.2 <0.5.0."
  },
  {
    q: "Which npm lifecycle script runs automatically ONLY before `npm publish`, and NOT after a git install?",
    options: [
      "prepare",
      "prepublish",
      "prepublishOnly",
      "prepack"
    ],
    answer: 2,
    explain: "prepublishOnly runs exclusively on `npm publish`. The `prepare` hook also runs after installing from a git URL, whereas prepublishOnly does not."
  }
]);

registerResources("06-package-management", [
  { title: "package.json fields reference (npm docs)", url: "https://docs.npmjs.com/cli/v10/configuring-npm/package-json" },
  { title: "Semantic Versioning specification", url: "https://semver.org/" },
  { title: "npm semver calculator and range syntax", url: "https://docs.npmjs.com/about-semantic-versioning" },
  { title: "npm scripts and lifecycle hooks", url: "https://docs.npmjs.com/cli/v10/using-npm/scripts" },
  { title: "npx documentation", url: "https://docs.npmjs.com/cli/v10/commands/npx" }
]);

registerQuiz("06-lockfiles-and-installs", [
  {
    q: "What does `npm ci` do differently from `npm install` that makes it suitable for CI/CD pipelines?",
    options: [
      "It skips installing devDependencies to speed up the build",
      "It deletes node_modules first and installs exactly from the lockfile, failing if they are out of sync",
      "It automatically updates packages to the latest semver-compatible versions",
      "It verifies package signatures but does not install anything"
    ],
    answer: 1,
    explain: "`npm ci` does a clean install using only the lockfile and fails with an error if package.json and the lockfile disagree, guaranteeing a reproducible build."
  },
  {
    q: "What is a 'phantom dependency' in a Node project that uses npm?",
    options: [
      "A dependency that is declared in package.json but never imported in code",
      "A package you use directly in code but never declared in package.json, accessible only because it was hoisted from another package",
      "A devDependency that accidentally ships to production",
      "A transitive dependency with a known security vulnerability"
    ],
    answer: 1,
    explain: "npm hoists compatible transitive dependencies to the top-level node_modules, making them importable even though you never declared them. This is a phantom dependency and breaks silently when the parent package stops needing it."
  },
  {
    q: "The `integrity` field in package-lock.json contains a SHA-512 hash. What is its primary security purpose?",
    options: [
      "It prevents npm from downloading the same package twice",
      "It verifies that the tarball downloaded from the registry has not been tampered with since your last install",
      "It signs the package with your npm account credentials",
      "It marks the package as approved by the npm security audit team"
    ],
    answer: 1,
    explain: "npm verifies the integrity hash on every install. If the package tarball has been altered on the registry since the lockfile was written, npm refuses to install it, providing a first line of supply-chain defense."
  }
]);

registerResources("06-lockfiles-and-installs", [
  { title: "package-lock.json explained (npm docs)", url: "https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json" },
  { title: "npm ci command reference", url: "https://docs.npmjs.com/cli/v10/commands/npm-ci" },
  { title: "npm install command reference", url: "https://docs.npmjs.com/cli/v10/commands/npm-install" },
  { title: "npm dedupe command", url: "https://docs.npmjs.com/cli/v10/commands/npm-dedupe" }
]);

registerQuiz("06-npm-pnpm-yarn", [
  {
    q: "How does pnpm avoid duplicating package files on disk when multiple projects use the same dependency version?",
    options: [
      "It compresses packages into zip archives and shares them across projects",
      "It stores each unique file once in a global content-addressable store and uses hard links into each project",
      "It uses symbolic links from a global node_modules directly into each project",
      "It deduplicates by copying files only when a package version changes"
    ],
    answer: 1,
    explain: "pnpm maintains a global content-addressable store where each file is stored once by its content hash. Projects get hard links to those store files, so ten projects using express@4.18.3 share a single copy on disk."
  },
  {
    q: "What is Yarn Plug'n'Play (PnP) and what does it replace?",
    options: [
      "A plugin system for extending Yarn commands; it replaces npm scripts",
      "A resolution strategy that generates a single map file instead of a node_modules folder, patching the Node resolver at startup",
      "A zero-configuration build tool that replaces webpack in Yarn workspaces",
      "A security layer that scans packages before installation, replacing npm audit"
    ],
    answer: 1,
    explain: "Yarn PnP generates a .pnp.cjs map file instead of a physical node_modules directory. Node's module resolver is patched to consult this map, achieving near-instant installs and strict isolation."
  },
  {
    q: "What is Corepack's role, and how do you activate it for a project?",
    options: [
      "It is a bundler for monorepos; activate it with `corepack bundle`",
      "It enforces a specific package manager and version via the `packageManager` field in package.json; activate shims with `corepack enable`",
      "It is a security scanner for transitive dependencies; activate it with `corepack scan`",
      "It is npm's caching layer; activate it with `corepack cache enable`"
    ],
    answer: 1,
    explain: "Corepack ships with Node and enforces the package manager declared in the `packageManager` field (e.g., `pnpm@9.4.0`). Running `corepack enable` installs the shims that intercept package manager commands."
  }
]);

registerResources("06-npm-pnpm-yarn", [
  { title: "pnpm documentation — how it works", url: "https://pnpm.io/motivation" },
  { title: "Yarn Plug'n'Play documentation", url: "https://yarnpkg.com/features/pnp" },
  { title: "Corepack documentation (Node.js)", url: "https://nodejs.org/api/corepack.html" },
  { title: "pnpm workspaces", url: "https://pnpm.io/workspaces" },
  { title: "Yarn workspaces", url: "https://yarnpkg.com/features/workspaces" }
]);

registerQuiz("06-publishing", [
  {
    q: "What is the purpose of running `npm pack --dry-run` before publishing a package?",
    options: [
      "It runs your test suite to check that tests pass before uploading",
      "It shows exactly which files would be included in the tarball without actually uploading to the registry",
      "It bumps the version number and creates a git tag without publishing",
      "It validates your package.json syntax and exports map"
    ],
    answer: 1,
    explain: "`npm pack --dry-run` simulates tarball creation and lists all files that would be included, letting you catch accidental inclusions like .env files or test fixtures before they ship."
  },
  {
    q: "What does npm provenance provide, and how is it attached during publishing?",
    options: [
      "It encrypts the tarball so only authorised users can install it; attached via `npm publish --encrypt`",
      "It signs the tarball with your GPG key; attached by running `npm sign` before publishing",
      "It attaches a signed OIDC attestation linking the published tarball to a specific CI workflow run; attached via `npm publish --provenance`",
      "It adds a checksum of your source code to the registry; attached automatically on every publish"
    ],
    answer: 2,
    explain: "npm provenance (available since npm 9.5) records a signed attestation from the CI OIDC provider, proving the tarball was built by a specific GitHub Actions workflow run. It is attached by passing `--provenance` to `npm publish`."
  },
  {
    q: "In a pnpm workspace, what does the `workspace:*` version range in a package's dependencies mean?",
    options: [
      "Install any version of the package from the npm registry",
      "Always use the local workspace version of the package; pnpm replaces it with the real semver range on publish",
      "Pin the dependency to the exact version currently in the workspace lockfile",
      "Exclude the dependency from the published tarball"
    ],
    answer: 1,
    explain: "The `workspace:*` protocol tells pnpm to resolve the dependency from the local monorepo workspace. When publishing, pnpm automatically replaces `workspace:*` with the real version number so the published package has a proper semver range."
  }
]);

registerResources("06-publishing", [
  { title: "npm publish command reference", url: "https://docs.npmjs.com/cli/v10/commands/npm-publish" },
  { title: "npm provenance documentation", url: "https://docs.npmjs.com/generating-provenance-statements" },
  { title: "package.json exports field", url: "https://nodejs.org/api/packages.html#exports" },
  { title: "npm audit command reference", url: "https://docs.npmjs.com/cli/v10/commands/npm-audit" },
  { title: "Verdaccio — local npm registry", url: "https://verdaccio.org/docs/what-is-verdaccio" }
]);
