registerLessonSrc("12-sea", function () {/*
---
id: 12-sea
title: Single Executable Applications (SEA)
minutes: 28
level: advanced
objectives:
  - Understand what a Node.js Single Executable Application (SEA) is and how it is built
  - Walk through the full SEA build pipeline: config, blob, injection, and signing
  - Configure shebang and bin fields for cross-platform distribution
  - Build a project-scaffolder CLI and ship it as a self-contained binary
---

# Single Executable Applications (SEA)

## Why this matters

"Install Node first" is a deal-breaker for many users and DevOps pipelines. A **Single Executable Application (SEA)** solves this: it embeds your JavaScript and the entire Node runtime into one self-contained binary that users can run on a machine with no Node installed — just like a Go or Rust binary. Node 21 promoted SEA from experimental to stable, and Node 24 LTS makes it production-ready. It is now a real distribution strategy for internal tooling, developer-experience tools, and products you ship to non-Node audiences.

## Learning objectives

- Explain the Node.js SEA architecture (blob injection into the Node binary).
- Execute the full four-step build pipeline: generate config → generate blob → copy binary → inject with postject.
- Set `bin` and `preferLocal` in `package.json` for CLI installation.
- Build a project-scaffolder CLI and package it as a SEA binary.

## How SEA works

A SEA is not a compiler or transpiler — it is a **binary injection** approach. The process takes the official Node.js binary, appends your application code as a Fuse-gated blob, and tweaks a flag inside the binary so that when executed it runs your embedded script instead of the normal REPL.

The key piece is a special section injected by a tool called **postject** — a utility that embeds arbitrary payloads into binaries in a cross-platform way (PE on Windows, Mach-O on macOS, ELF on Linux).

```
┌────────────────────────────────────────────────────────────────┐
│  node binary (copied from: node -e "process.execPath")         │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  NODE_SEA_BLOB section (injected by postject)             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  your bundled JS  +  assets  +  sea-config metadata  │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

When the binary is launched, Node checks the Fuse flag. If set, it reads the `NODE_SEA_BLOB` section and evaluates the embedded script. Your code can detect this mode via `sea.isSea()` from the built-in `node:sea` module.

> [!NOTE] Single-file requirement
> The SEA pipeline requires your application to be a **single JS file**. If your project spans multiple files you must first bundle it — with `esbuild`, `ncc`, or `rollup` — into one file before building the SEA. This is the only real extra step compared to a normal CLI publish.

## The four-step build pipeline

### Step 1: sea-config.json

Create a `sea-config.json` at your project root:

```json
{
  "main": "dist/cli.bundle.js",
  "output": "dist/cli.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
```

| Field | Purpose |
|---|---|
| `main` | Path to your bundled single-file entry point |
| `output` | Where to write the binary blob |
| `disableExperimentalSEAWarning` | Suppresses the runtime warning in Node < 21 |
| `useSnapshot` | Pre-warms V8 heap snapshot for faster startup (advanced) |
| `useCodeCache` | Caches V8 bytecode — speeds up startup at the cost of a larger blob |

### Step 2: generate the blob

```bash
node --experimental-sea-config sea-config.json
```

Node reads `sea-config.json`, bundles the blob, and writes it to `dist/cli.blob`. The blob contains your JS, the config metadata, and optionally a V8 snapshot/cache.

### Step 3: copy the Node binary

```bash
cp $(node -e "process.stdout.write(process.execPath)") dist/my-cli
```

On Windows use `.exe` and `node -e "process.stdout.write(process.execPath)"` in PowerShell. You copy — never modify — the running Node binary to preserve its code-signing certificate chain.

### Step 4: inject the blob with postject

```bash
npx postject dist/my-cli NODE_SEA_BLOB dist/cli.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

The `--sentinel-fuse` value is a fixed magic string that Node looks for inside the binary to detect an embedded SEA payload. It is the same string every time — copy it verbatim.

On macOS you must add `--macho-segment-name NODE_SEA` to the postject command. On Windows you need to re-sign the binary or disable driver signature enforcement in dev builds.

After injection your binary is standalone:

```bash
./dist/my-cli --help
# No Node installation required on the target machine
```

> [!PRINCIPAL] One binary per platform — build in CI
> A SEA binary is platform-specific: a Linux ELF will not run on macOS. The standard pattern is to add a matrix build in your CI pipeline — one job per platform — each producing its own binary artifact and uploading to a GitHub Release. Tools like `pkg` and `nexe` handle cross-compilation; the built-in Node SEA pipeline requires a native build on each target OS, which is actually more reliable.

## Runtime API: node:sea

Inside a SEA you can inspect the runtime and retrieve embedded assets:

```js
import { isSea, getAsset, getAssetAsBlob } from "node:sea";

if (isSea()) {
  console.log("Running as a single executable");
} else {
  console.log("Running as a normal Node process");
}

// Retrieve an asset embedded via sea-config.json { "assets": { "template.txt": "..." } }
const templateText = getAsset("template.txt", "utf8");
const templateBlob = getAssetAsBlob("template.txt");  // returns a Blob
```

Use `assets` in `sea-config.json` to embed data files (templates, certs, default configs) that your CLI needs at runtime — no separate file shipping required.

## Package.json: bin and shebang

For `npm install -g` distribution, declare a `bin` entry:

```json
{
  "name": "my-cli",
  "version": "1.0.0",
  "bin": {
    "my-cli": "./bin/cli.js"
  }
}
```

Add a shebang as the very first line of `bin/cli.js`:

```js
#!/usr/bin/env node
```

For SEA distribution you skip npm entirely — you distribute the binary directly. But you may still publish the un-bundled package to npm for users who have Node:

```json
{
  "bin": { "scaffold": "./bin/scaffold.js" },
  "scripts": {
    "build:bundle": "esbuild src/cli.js --bundle --platform=node --outfile=dist/cli.bundle.js",
    "build:blob":   "node --experimental-sea-config sea-config.json",
    "build:binary": "cp $(node -e \"process.stdout.write(process.execPath)\") dist/scaffold && npx postject dist/scaffold NODE_SEA_BLOB dist/cli.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "build":        "npm run build:bundle && npm run build:blob && npm run build:binary"
  }
}
```

> [!PITFALL] ESM in SEA
> As of Node 24, SEA supports both CJS and ESM entry points. If you use ESM (`import`/`export`), make sure your bundler outputs a CJS-compatible single file (`--format=cjs` in esbuild) unless you specifically test ESM SEA support in your target Node version. CJS bundles have been supported longer and are more predictable in SEA context.

## Try it yourself

The following pure-JS function is the template-rendering core of a project scaffolder. It takes a spec object describing files to create and returns an in-memory map of `path → content`. This is the algorithm you will extend in the Project section.

```js run
// Template renderer — pure JS, no Node APIs.
// Renders a spec object into a { path: content } map.

function renderTemplate(spec, vars) {
  const output = {};

  for (const [filePath, template] of Object.entries(spec)) {
    // Replace {{VAR_NAME}} placeholders with values from vars
    const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in vars)) throw new Error(`Unknown variable: ${key}`);
      return vars[key];
    });

    // Resolve path placeholders too (e.g. {{name}}/index.js)
    const resolvedPath = filePath.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in vars)) throw new Error(`Unknown variable in path: ${key}`);
      return vars[key];
    });

    output[resolvedPath] = rendered;
  }

  return output;
}

// --- demo ---
const projectTemplate = {
  "{{name}}/package.json": JSON.stringify({
    name: "{{name}}",
    version: "0.1.0",
    description: "{{description}}",
    type: "module",
    main: "src/index.js",
  }, null, 2),

  "{{name}}/src/index.js": [
    "// {{name}} — created {{date}}",
    "",
    "export function main() {",
    "  console.log('Hello from {{name}}!');",
    "}",
    "",
    "main();",
  ].join("\n"),

  "{{name}}/.gitignore": "node_modules/\ndist/\n.env\n",
};

const vars = {
  name:        "my-awesome-app",
  description: "A brand new Node.js project",
  date:        new Date().toISOString().slice(0, 10),
};

const files = renderTemplate(projectTemplate, vars);

for (const [path, content] of Object.entries(files)) {
  console.log(`=== ${path} ===`);
  console.log(content);
  console.log();
}
```

## Project

**Build a full-featured project-scaffolder CLI and ship it as a single self-contained executable binary.**

You will implement a CLI tool called `scaffold` that:

1. Accepts a project name and optional flags from the command line (`util.parseArgs`).
2. Prompts for any missing values interactively (`readline/promises`).
3. Renders a multi-file project template using the `renderTemplate` function above.
4. Writes the rendered files to disk (`node:fs/promises`) with directory creation.
5. Prints colour-coded progress and a success summary (`util.styleText`).
6. Is bundled with esbuild and packaged as a SEA binary that runs without Node.

**Acceptance criteria:**

1. `scaffold my-app` creates a directory `./my-app/` containing at least `package.json`, `src/index.js`, `.gitignore`, and `README.md` with correct placeholder substitution.
2. Running `scaffold --help` prints usage instructions including all accepted flags and exits with code `0`.
3. If `my-app/` already exists, the CLI exits with code `1` and a red error message — no partial writes.
4. The SEA binary (`./dist/scaffold`) runs on a machine without Node installed and produces identical output.
5. All user-visible strings are colour-coded: errors in red, warnings in yellow, success in green, step labels in cyan bold.
6. A `build` npm script executes the full pipeline (bundle → blob → inject) with a single `npm run build`.

**Starter — pure-JS scaffolding core (extend this for the project):**

```js run
// Core scaffolding engine — pure JS, no Node APIs.
// Extend this with real fs writes, parseArgs, and prompts for the full project.

function renderTemplate(spec, vars) {
  const output = {};
  const RE = /\{\{(\w+)\}\}/g;
  for (const [rawPath, template] of Object.entries(spec)) {
    const path    = rawPath.replace(RE, (_, k) => vars[k] ?? (_ => { throw new Error(`Unknown var: ${k}`); })());
    const content = template.replace(RE, (_, k) => vars[k] ?? (_ => { throw new Error(`Unknown var: ${k}`); })());
    output[path] = content;
  }
  return output;
}

function scaffold(projectName, opts = {}) {
  const vars = {
    name:        projectName,
    description: opts.description ?? `${projectName} — a Node.js project`,
    author:      opts.author      ?? "unknown",
    date:        new Date().toISOString().slice(0, 10),
    nodeVersion: opts.nodeVersion ?? "24",
  };

  const TEMPLATE = {
    "{{name}}/package.json": JSON.stringify({
      name: "{{name}}",
      version: "0.1.0",
      description: "{{description}}",
      type: "module",
      author: "{{author}}",
      license: "MIT",
      scripts: { start: "node src/index.js", test: "node --test" },
    }, null, 2),

    "{{name}}/.nvmrc": "{{nodeVersion}}",

    "{{name}}/.gitignore": [
      "node_modules/",
      "dist/",
      ".env",
      "*.log",
    ].join("\n"),

    "{{name}}/src/index.js": [
      "// {{name}} — scaffolded on {{date}}",
      "",
      "export function main() {",
      "  console.log('Hello from {{name}}!');",
      "}",
      "",
      "main();",
    ].join("\n"),

    "{{name}}/README.md": [
      "# {{name}}",
      "",
      "> {{description}}",
      "",
      "## Getting started",
      "",
      "```bash",
      "npm install",
      "npm start",
      "```",
      "",
      "Created {{date}} by {{author}}.",
    ].join("\n"),
  };

  return renderTemplate(TEMPLATE, vars);
}

// --- demo ---
const files = scaffold("hello-world", {
  description: "My first scaffolded project",
  author: "Ada Lovelace",
});

for (const [path, content] of Object.entries(files)) {
  const lines = content.split("\n").length;
  console.log(`  created  ${path}  (${lines} lines)`);
}
console.log(`\nScaffolded ${Object.keys(files).length} files.`);
```

## Common pitfalls

> [!PITFALL] Modifying the live Node binary
> Never inject into the actual `node` binary on your system — always copy it first. Corrupting the running binary will break your entire Node installation. The `cp` step in the pipeline is not optional.

> [!PITFALL] postject version mismatches
> Always run `npx postject@latest` rather than a locally cached version. Node updates the Fuse string format across major versions; an old postject may inject a sentinel that the new runtime cannot find, producing a binary that silently falls back to the REPL.

> [!PITFALL] Missing codesign on macOS
> After postject, Gatekeeper will reject the binary on macOS because the signature is invalidated. During development, `codesign --remove-signature dist/my-cli` removes the broken signature so macOS will run it with a one-time user approval. For distribution you must re-sign with a valid Apple Developer certificate.

## What you learned

- A Node.js SEA embeds your JS into a copy of the Node binary using `postject` and a binary Fuse flag — no compiler required.
- The four build steps are: generate blob (`node --experimental-sea-config`) → copy binary → inject (`postject`) → (optionally) sign.
- Use `sea-config.json` `assets` to embed data files into the binary; retrieve them with `getAsset()` from `node:sea`.
- Publish the npm package with a `bin` field for users who have Node; distribute the binary artifact for users who do not.
- Build one binary per target OS — use a CI matrix strategy for multi-platform releases.

## Next steps

You have now built, polished, and packaged a production-quality CLI. The next module moves into **networking** — TCP, UDP, and the building blocks that Node's HTTP layer sits on top of.
*/});
