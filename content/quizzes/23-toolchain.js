registerQuiz("23-tsx-esbuild", [
  {
    q: "Why is esbuild dramatically faster than JavaScript-based bundlers like webpack or Rollup?",
    options: [
      "esbuild caches the entire node_modules folder between runs",
      "esbuild is written in Go, starts as a native binary, and parses modules in parallel using goroutines",
      "esbuild skips TypeScript type-checking, saving significant time",
      "esbuild uses the Node.js worker_threads API to run transforms in parallel"
    ],
    answer: 1,
    explain: "esbuild is compiled Go code: it starts in microseconds (no JS VM startup), processes all modules in parallel via goroutines, and uses compact memory layouts with no GC pauses. JS-based bundlers are single-threaded JS processes with significant startup and GC overhead."
  },
  {
    q: "What is the key difference between esbuild's 'transform' mode and 'bundle' mode?",
    options: [
      "Transform mode is faster; bundle mode applies minification",
      "Transform mode strips types from a single file; bundle mode resolves the full import graph across files",
      "Transform mode targets Node.js; bundle mode targets browsers",
      "Transform mode outputs CommonJS; bundle mode outputs ESM"
    ],
    answer: 1,
    explain: "Transform mode operates on one file in isolation — stripping types or transpiling syntax — with no dependency resolution. Bundle mode takes an entry point, follows every import, and emits a consolidated output file. Bundle mode can also tree-shake and minify."
  },
  {
    q: "When bundling a server-side Node.js application with esbuild, why should you typically pass '--packages=external'?",
    options: [
      "It makes esbuild skip type-checking for packages in node_modules",
      "It prevents esbuild from inlining node_modules, which can break native addons and bloat the bundle unnecessarily",
      "It tells esbuild to download packages from the npm registry during the build",
      "It enables tree-shaking for all external packages"
    ],
    answer: 1,
    explain: "Server bundles should leave node_modules as external require/import calls so Node resolves them from the installed packages at runtime. Inlining everything can break native addons (.node files), include duplicate copies of packages, and produce unnecessarily large output files."
  }
]);

registerResources("23-tsx-esbuild", [
  { title: "esbuild Documentation", url: "https://esbuild.github.io/" },
  { title: "esbuild API Reference (transform and build)", url: "https://esbuild.github.io/api/" },
  { title: "tsx — TypeScript Execute (GitHub)", url: "https://github.com/privatenumber/tsx" },
  { title: "esbuild Bundling for Node.js", url: "https://esbuild.github.io/getting-started/#bundling-for-node" },
  { title: "TypeScript tsc --noEmit (type-check only)", url: "https://www.typescriptlang.org/tsconfig#noEmit" }
]);

registerQuiz("23-biome-lint", [
  {
    q: "What is the fundamental difference between a formatter and a linter?",
    options: [
      "A formatter runs in CI; a linter runs only in the editor",
      "A formatter enforces code style (cosmetic); a linter catches bugs and anti-patterns (correctness)",
      "A formatter works on TypeScript; a linter works only on JavaScript",
      "A formatter modifies files in place; a linter always exits with a non-zero code"
    ],
    answer: 1,
    explain: "Formatting is purely cosmetic — indentation, quotes, trailing commas — and never affects runtime behaviour. Linting catches real problems: using '==' instead of '===', unused variables, missing 'await', etc. Both are needed; they operate on different planes."
  },
  {
    q: "Why does using 'eslint-plugin-prettier' (making ESLint run Prettier as a lint rule) cause performance problems?",
    options: [
      "ESLint cannot parse the output of Prettier correctly",
      "Prettier runs on every file twice — once by ESLint and once by the Prettier CLI — doubling parse cost",
      "The plugin disables ESLint's caching mechanism",
      "ESLint's rule engine is not designed to handle formatting violations"
    ],
    answer: 1,
    explain: "When Prettier is run as an ESLint rule, every file is formatted by Prettier inside ESLint's run and then checked again if you also run Prettier separately. The ESLint team itself recommends against this approach. Use the tools separately via npm scripts instead."
  },
  {
    q: "In CI, which Biome command should you use, and why is 'biome check --write' wrong for that environment?",
    options: [
      "'biome check --write' is correct for CI because it fixes issues automatically",
      "'biome ci' — it reports violations and exits non-zero without writing files, preventing silent mutations",
      "'biome lint' — it only checks lint rules, skipping the slower formatter",
      "'biome format --check' — it is the only command that exits with a non-zero code on violations"
    ],
    answer: 1,
    explain: "'biome ci' is read-only: it checks formatting and lint violations and exits non-zero on any finding, but never modifies files. 'biome check --write' auto-fixes files, which is inappropriate in CI — a job that silently mutates code without committing produces a misleadingly green build."
  }
]);

registerResources("23-biome-lint", [
  { title: "Biome Documentation", url: "https://biomejs.dev/docs/" },
  { title: "Biome Linter Rules Reference", url: "https://biomejs.dev/linter/rules/" },
  { title: "ESLint Documentation", url: "https://eslint.org/docs/latest/" },
  { title: "Prettier Documentation", url: "https://prettier.io/docs/en/" },
  { title: "eslint-config-prettier (disabling conflicting rules)", url: "https://github.com/prettier/eslint-config-prettier" }
]);

registerQuiz("23-bundling", [
  {
    q: "Why does tree-shaking require ES Modules ('import'/'export') and not work with CommonJS ('require')?",
    options: [
      "Tree-shaking is a feature of the Node.js runtime, not bundlers, and Node only supports ESM",
      "CommonJS 'require' is dynamic — the bundler cannot statically determine at build time which exports are used",
      "Tree-shaking only removes files, not individual exports, so CommonJS modules are always kept",
      "ESM is faster at runtime, so bundlers prefer it regardless of tree-shaking"
    ],
    answer: 1,
    explain: "CommonJS 'require()' is dynamic: you can call it with a runtime-computed path ('require(somePath)') or conditionally. The bundler cannot know at build time which exports are used. Static 'import' declarations are analysed at parse time, letting the bundler see exactly what is consumed and safely delete the rest."
  },
  {
    q: "When running a Node.js server in production with a minified bundle, what flag should you add to 'node' to make stack traces point to the original TypeScript source lines?",
    options: [
      "--source-maps=inline",
      "--enable-source-maps",
      "--inspect-source",
      "--trace-origin=source"
    ],
    answer: 1,
    explain: "'node --enable-source-maps dist/server.js' tells Node to read the '.js.map' file alongside the bundle and translate generated positions back to original source file, line, and column numbers. Without this flag, stack traces show minified position references that are nearly impossible to debug."
  },
  {
    q: "In which deployment scenario is bundling server-side Node.js code most clearly worth the added build complexity?",
    options: [
      "A long-running monolith on a dedicated VM where the server starts once per deploy",
      "AWS Lambda or Cloudflare Workers, where cold-start time scales with the number of files to load",
      "Any Express app, because bundles are always smaller than raw source",
      "Development environments, to speed up hot-reload cycles"
    ],
    answer: 1,
    explain: "Serverless runtimes (Lambda, Workers) pay a cold-start penalty for every file they load. A single-file bundle means one file to load instead of hundreds, directly reducing cold-start latency. For traditional long-running servers the benefit is much smaller and may not justify the complexity."
  }
]);

registerResources("23-bundling", [
  { title: "esbuild Bundling Documentation", url: "https://esbuild.github.io/api/#bundle" },
  { title: "esbuild Minification Options", url: "https://esbuild.github.io/api/#minify" },
  { title: "Source Map Specification v3", url: "https://sourcemaps.info/spec.html" },
  { title: "Node.js --enable-source-maps Flag", url: "https://nodejs.org/api/cli.html#--enable-source-maps" },
  { title: "esbuild Tree Shaking", url: "https://esbuild.github.io/api/#tree-shaking" }
]);
