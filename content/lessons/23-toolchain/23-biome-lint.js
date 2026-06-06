registerLessonSrc("23-biome-lint", function () {/*
---
id: 23-biome-lint
title: "Biome vs ESLint + Prettier"
minutes: 22
level: advanced
objectives:
  - Distinguish linting from formatting and explain why both matter
  - Configure ESLint and Prettier and understand their limitations
  - Replace both tools with Biome for a faster, simpler setup
---

# Biome vs ESLint + Prettier

## Why this matters

Every professional codebase enforces two classes of automated rules: **formatting** (where the braces go, how many spaces, trailing commas) and **linting** (catching real bugs, enforcing patterns, banning dangerous idioms). Getting these wrong means either noisy diffs, sneaky bugs, or hours of config wrestling. Understanding the classic ESLint + Prettier stack — and why a growing number of teams are replacing it with Biome — makes you a better collaborator and a faster engineer.

## Learning objectives

- Explain the difference between **linting** and **formatting** and why both are needed.
- Set up **ESLint** and **Prettier** together and understand the friction points.
- Adopt **Biome** as a single, faster replacement for both, with CI integration.
- Write a tiny rule-checking function to internalise how a linter processes source code.

## Linting vs formatting

These two words are often conflated. They solve different problems:

**Formatting** is purely cosmetic. It answers: "How should this code *look*?" — indentation, line length, quote style, trailing commas. Two semantically identical programs can be formatted differently. Formatting decisions have no impact on runtime behaviour.

**Linting** catches *problems*. It answers: "Is this code *correct* or *safe*?" — using `==` instead of `===`, declaring a `var` that leaks scope, calling an async function without `await`, unused variables. A lint rule can fire on code that runs fine but hides a bug.

```
             Formatting          |  Linting
---------------------------------|-----------------------------------------
Tools        Prettier, dprint    |  ESLint, typescript-eslint, oxlint
Scope        Style only          |  Bugs, patterns, anti-patterns
Auto-fix     Always safe         |  Sometimes safe, sometimes manual
```

> [!NOTE] Why you need both
> A formatter won't tell you that you forgot to `await` a promise. A linter won't unify your team's indentation style. Both are necessary; they just operate on different planes.

## The ESLint + Prettier stack

For years the standard setup has been ESLint for lint rules plus Prettier for formatting. Here is a minimal configuration:

```bash
npm install -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier
```

```js
// eslint.config.mjs  (flat-config format, Node 24 default)
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,           // turns off ESLint rules that conflict with Prettier
  {
    rules: {
      "no-var": "error",
      eqeqeq: ["error", "always"],
    },
  }
);
```

```json
// .prettierrc
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

```json
// package.json scripts
{
  "scripts": {
    "lint":   "eslint src",
    "format": "prettier --write src",
    "check":  "prettier --check src && eslint src"
  }
}
```

> [!OUTPUT]
> $ npm run check
> Checking formatting... (prettier)
> All matched files use Prettier code style!
> $ eslint src
> (no output — no violations)

### Why the stack has friction

The `eslint-config-prettier` package exists because ESLint has its own formatting rules that conflict with Prettier's output. You have to install a config that turns those off. That's a leaky abstraction: two tools that were never designed to coexist, held together by a compatibility shim.

Beyond that: both tools are JavaScript programs, which means startup overhead for every lint run. On a large codebase, a full `eslint .` can take 10–30 seconds.

> [!PITFALL] Running Prettier as an ESLint plugin
> `eslint-plugin-prettier` makes ESLint run Prettier and report formatting violations as lint errors. This sounds convenient but it is measurably slower — Prettier runs on every file twice — and the ESLint team itself recommends against it. Use the two tools separately via npm scripts instead.

## Biome: one fast Rust tool for both

**Biome** (formerly Rome) is written in Rust and ships as a single binary with a formatter *and* linter built in. It processes files in parallel using Rayon (Rust's data-parallelism library) and avoids the JS runtime startup cost entirely.

```bash
npm install -D @biomejs/biome
npx biome init          # creates biome.json
```

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noDoubleEquals": "error"
      },
      "style": {
        "noVar": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all"
    }
  }
}
```

```bash
npx biome check --write src/    # format + lint + auto-fix in one pass
npx biome ci src/               # CI mode: exits non-zero on any violation, no writes
```

> [!OUTPUT]
> $ npx biome check --write src/
> Checked 42 file(s) in 38ms
> Fixed 3 file(s)
> Found 0 error(s)

### Speed comparison

| Tool | 500-file project |
|---|---|
| `eslint .` | ~18 s |
| `prettier --check .` | ~4 s |
| ESLint + Prettier (sequential) | ~22 s |
| `biome check .` | ~0.2 s |

The gap comes from three sources: Rust vs JS startup time, parallel file processing, and sharing a single AST parse between the formatter and linter (no double-parsing).

### CI integration

```yaml
# .github/workflows/ci.yml  (excerpt)
- name: Lint and format check
  run: npx biome ci src/
```

`biome ci` never writes files — it only reports violations and exits with a non-zero code. That's what you want in CI: fast feedback, clear failure, no accidental mutations.

> [!PRINCIPAL] When to keep ESLint
> Biome's rule set is growing fast but is not yet exhaustive. If your project depends on a specific ESLint plugin (e.g., `eslint-plugin-react-hooks`, `eslint-plugin-security`, `eslint-plugin-import`) that has no Biome equivalent, keep ESLint for those rules and use Biome for formatting. You can run them side-by-side — just disable the Biome linter if ESLint already covers the same ground to avoid conflicts.

## Try it yourself

Linters work by parsing source code into tokens or an AST, then walking the structure looking for patterns. Here is a tiny rule-checker that scans a raw code string with regular expressions — a simplified but illustrative model of what a real linter does:

```js run
// A tiny linter that flags: == (loose equality) and var declarations.
// Real linters parse to an AST; this uses regex for simplicity and teachability.

function lint(source) {
  const violations = [];

  const lines = source.split('\n');
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const stripped = line.replace(/\/\/.*$/, ''); // ignore // comments

    // Rule 1: no-double-equals  (== or != but NOT === or !==)
    const eqMatch = stripped.match(/[^=!<>]={2}[^=]|[^!]!=[^=]/);
    if (eqMatch) {
      violations.push({ line: lineNum, rule: 'no-double-equals',
        message: 'Use === instead of ==' });
    }

    // Rule 2: no-var
    if (/\bvar\s+/.test(stripped)) {
      violations.push({ line: lineNum, rule: 'no-var',
        message: 'Use let or const instead of var' });
    }

    // Rule 3: no-console (warn only)
    if (/\bconsole\.(log|warn|error)\b/.test(stripped)) {
      violations.push({ line: lineNum, rule: 'no-console',
        severity: 'warn', message: 'Avoid console statements in production code' });
    }
  });

  return violations;
}

const code = `
function greet(user) {
  var name = user.name;           // should use let/const
  if (name == null) {             // should use ===
    console.log('no name given'); // console in production
  }
  return 'Hello, ' + name;
}
`.trim();

const results = lint(code);
if (results.length === 0) {
  console.log('No violations found.');
} else {
  results.forEach(v => {
    const sev = v.severity === 'warn' ? 'WARN ' : 'ERROR';
    console.log(`[${sev}] Line ${v.line} (${v.rule}): ${v.message}`);
  });
}
```

## Exercises

### Exercise 1 — add a no-unused-variable rule

Extend the linter above to detect variables declared with `const` or `let` that appear only once in the source (i.e., declared but never read).

<details>
<summary>Show solution</summary>

```js run
function lintUnused(source) {
  const violations = [];
  const declarations = [];

  const lines = source.split('\n');
  lines.forEach((line, idx) => {
    const m = line.match(/\b(?:const|let)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/);
    if (m) declarations.push({ name: m[1], line: idx + 1 });
  });

  for (const decl of declarations) {
    // Count occurrences of the identifier in the whole source
    const re = new RegExp(`\\b${decl.name}\\b`, 'g');
    const count = (source.match(re) || []).length;
    // count === 1 means only the declaration itself — never read
    if (count === 1) {
      violations.push({ line: decl.line, rule: 'no-unused-vars',
        message: `'${decl.name}' is declared but never used` });
    }
  }
  return violations;
}

const code = `
const used = 42;
const unused = 'oops';
console.log(used);
`.trim();

const results = lintUnused(code);
results.forEach(v =>
  console.log(`Line ${v.line} (${v.rule}): ${v.message}`)
);
// Expected: Line 2 (no-unused-vars): 'unused' is declared but never used
```

</details>

### Exercise 2 — severity levels and exit code

Real CI linters exit with code 1 on errors but 0 on warnings-only. Modify `lint()` from the Try It Yourself section so it returns `{ violations, exitCode }` where `exitCode` is 1 if any violation has severity `"error"` (default) and 0 if only warnings exist.

<details>
<summary>Show solution</summary>

```js run
function lint(source) {
  const violations = [];
  const lines = source.split('\n');

  lines.forEach((line, idx) => {
    const stripped = line.replace(/\/\/.*$/, '');
    if (/[^=!<>]={2}[^=]|[^!]!=[^=]/.test(stripped))
      violations.push({ line: idx+1, rule: 'no-double-equals', severity: 'error' });
    if (/\bvar\s+/.test(stripped))
      violations.push({ line: idx+1, rule: 'no-var', severity: 'error' });
    if (/\bconsole\.(log|warn|error)\b/.test(stripped))
      violations.push({ line: idx+1, rule: 'no-console', severity: 'warn' });
  });

  const hasError = violations.some(v => v.severity === 'error' || !v.severity);
  return { violations, exitCode: hasError ? 1 : 0 };
}

// Warnings only (console.log):
const r1 = lint('console.log("hi")');
console.log('warn-only exit code:', r1.exitCode); // 0

// Error present (var):
const r2 = lint('var x = 1;');
console.log('error exit code:', r2.exitCode);      // 1
```

</details>

## Common pitfalls

> [!PITFALL] Mixing Biome formatter with ESLint formatting rules
> If you adopt Biome's formatter but keep ESLint with formatting rules enabled, they will fight. Biome reformats, ESLint re-flags, and developers get caught in the middle. Either disable ESLint's formatting rules (use `eslint-config-prettier` style disabling) or switch to Biome's linter entirely. Half-migrations cause more pain than the original setup.

Also: Biome's `check --write` and `ci` commands are distinct for a reason. Never run `--write` in CI — a CI job that mutates files without committing them gives you a green build with dirty code.

## What you learned

- **Linting** catches bugs and anti-patterns; **formatting** enforces style — they are separate concerns.
- **ESLint + Prettier** is the classic stack: powerful but requires a compatibility shim and has JS startup overhead.
- **Biome** is a Rust-based single binary that handles both formatting and linting in one fast pass, ideal for CI.
- In CI use `biome ci` (read-only, exits non-zero on violations); in dev use `biome check --write`.
- A linter at its core is a pattern-matcher over source structure — understanding that makes rules less magical.

## Next steps

You can now keep your code fast and clean. The final piece is packaging it for production: bundling server code, enabling source maps for debugging, and wiring everything together in a polished project setup.
*/});
