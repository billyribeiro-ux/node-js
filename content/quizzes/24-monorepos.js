registerQuiz("24-workspaces", [
  {
    q: "What does the 'workspace:*' protocol in a dependency declaration tell the package manager?",
    options: [
      "Install the latest version from the npm registry",
      "Link to the local workspace package, never the registry",
      "Install any version that satisfies the semver wildcard",
      "Use the version pinned in the root lockfile"
    ],
    answer: 1,
    explain: "The 'workspace:*' protocol instructs the package manager to resolve the dependency from the local monorepo workspace rather than looking it up on npm. When publishing, tooling like Changesets replaces it with the real published version."
  },
  {
    q: "Why does pnpm's strict isolation model prevent 'phantom dependencies' that occur with npm workspaces?",
    options: [
      "pnpm deletes node_modules after each install",
      "pnpm uses hard links and a content-addressable store instead of hoisting, so each package can only access what it explicitly declares",
      "pnpm does not support workspaces at all",
      "pnpm requires every package to publish to npm before linking"
    ],
    answer: 1,
    explain: "npm hoisting lifts all dependencies to the root node_modules, allowing packages to accidentally use undeclared dependencies. pnpm's content-addressable store and hard-link model ensures each package can only access what is listed in its own package.json."
  },
  {
    q: "What algorithm do workspace tools use to determine the correct build order across packages?",
    options: [
      "Breadth-first search on the forward dependency graph",
      "Topological sort (with cycle detection) on the dependency graph",
      "Alphabetical ordering of package names",
      "Random order with retry on failure"
    ],
    answer: 1,
    explain: "Workspace tools run a topological sort on the package dependency graph, preceded by cycle detection (three-colour DFS). This ensures each package is built only after all of its dependencies have been built successfully."
  }
]);

registerResources("24-workspaces", [
  { title: "npm workspaces documentation", url: "https://docs.npmjs.com/cli/v10/using-npm/workspaces" },
  { title: "pnpm workspace configuration", url: "https://pnpm.io/workspaces" },
  { title: "pnpm workspace protocol", url: "https://pnpm.io/workspaces#workspace-protocol-workspace" },
  { title: "TypeScript project references", url: "https://www.typescriptlang.org/docs/handbook/project-references.html" }
]);

registerQuiz("24-turborepo", [
  {
    q: "In a Turborepo pipeline, what does the '^build' syntax in 'dependsOn' mean?",
    options: [
      "Run build in the current package first",
      "Skip build for all packages",
      "Run build in all upstream dependency packages first",
      "Run build only in the root package"
    ],
    answer: 2,
    explain: "The caret (^) prefix means 'in all upstream dependencies'. So 'dependsOn: [\"^build\"]' tells Turborepo to complete the build task in every package this package depends on before starting the build in the current package."
  },
  {
    q: "Which of the following causes a Turborepo cache miss?",
    options: [
      "Changing the package name in package.json",
      "Changing a source file matched by the task's 'inputs' glob",
      "Running the task with the --dry flag",
      "Adding a new workspace that has no dependencies on this package"
    ],
    answer: 1,
    explain: "Turborepo's cache key is a hash of input files, environment variables listed in 'env', resolved dependency versions, and the pipeline configuration. Any change to the source files matched by 'inputs' changes the hash and causes a cache miss."
  },
  {
    q: "What does Turborepo's --filter=...[origin/main] flag compute when detecting affected packages?",
    options: [
      "Packages that have changed commit messages since main",
      "Only packages whose package.json version was bumped",
      "Packages with changed files plus every package that transitively depends on them (reverse reachability)",
      "All packages that origin/main branch has ever built"
    ],
    answer: 2,
    explain: "Turborepo diffs the working tree against the merge base with origin/main to find changed packages, then walks the reverse dependency graph (BFS) to collect all transitive dependents. This is the reverse-reachability set."
  }
]);

registerResources("24-turborepo", [
  { title: "Turborepo documentation", url: "https://turbo.build/repo/docs" },
  { title: "Turborepo pipeline configuration", url: "https://turbo.build/repo/docs/reference/configuration" },
  { title: "Turborepo remote caching", url: "https://turbo.build/repo/docs/core-concepts/remote-caching" },
  { title: "Turborepo filtering (--filter)", url: "https://turbo.build/repo/docs/core-concepts/monorepos/filtering" }
]);

registerQuiz("24-changesets", [
  {
    q: "When multiple changesets target the same package with different bump types (patch, minor, major), what rule does 'changeset version' apply?",
    options: [
      "It applies the average bump type",
      "It applies the lowest bump type to be conservative",
      "It applies the highest bump type, so major beats minor beats patch",
      "It applies bumps in the order the changeset files were created"
    ],
    answer: 2,
    explain: "Changesets aggregates bump types per package and takes the highest: major beats minor beats patch. This ensures that if any PR introduces a breaking change, the major bump is not overridden by a later patch changeset."
  },
  {
    q: "What does 'changeset version' do to packages that depend on a package that received a version bump?",
    options: [
      "Nothing; only directly changed packages are bumped",
      "It bumps all packages in the repo by the same amount",
      "It gives transitive consumers at least a patch bump",
      "It removes the workspace:* reference from their package.json"
    ],
    answer: 2,
    explain: "When 'changeset version' bumps a package, it propagates at least a patch bump to every consumer package that lists it as a dependency. This ensures consumers reflect that their dependency changed, even if no other code in the consumer changed."
  },
  {
    q: "What is the key difference between 'fixed' and 'independent' versioning strategies in Changesets?",
    options: [
      "Fixed versioning prevents any version bumps; independent allows them freely",
      "Fixed means all packages in a group share the same version number; independent lets each package evolve at its own pace",
      "Fixed versioning only works with npm; independent works with pnpm",
      "Fixed versioning requires a separate changeset file per package; independent uses one shared file"
    ],
    answer: 1,
    explain: "With fixed versioning, all packages in a configured group are always bumped to the same version together, like how React and react-dom stay in sync. Independent versioning (the default) allows each package to have its own version trajectory."
  }
]);

registerResources("24-changesets", [
  { title: "Changesets documentation", url: "https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md" },
  { title: "Changesets configuration reference", url: "https://github.com/changesets/changesets/blob/main/docs/config-file-options.md" },
  { title: "Changesets GitHub Action", url: "https://github.com/changesets/action" },
  { title: "Semantic Versioning specification", url: "https://semver.org/" },
  { title: "Fixed vs independent versioning", url: "https://github.com/changesets/changesets/blob/main/docs/fixed-packages.md" }
]);
