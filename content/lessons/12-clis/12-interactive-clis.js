registerLessonSrc("12-interactive-clis", function () {/*
---
id: 12-interactive-clis
title: Colours, Prompts, Spinners & Config
minutes: 24
level: intermediate
objectives:
  - Add colour to terminal output using util.styleText without any third-party library
  - Read interactive prompts from stdin using Node's readline/promises API
  - Build a progress-bar renderer and understand spinner patterns
  - Load config from files and environment variables with a clear precedence order
---

# Colours, Prompts, Spinners & Config

## Why this matters

A CLI tool that dumps plain text and hangs silently is frustrating to use. The difference between a tool people love and one they tolerate is often just three things: legible colour-coded output, a progress indicator so the user knows something is happening, and sane config loading that "just works". Since Node 20 you can tick all three boxes with **zero dependencies** using built-in APIs.

## Learning objectives

- Colour terminal output with `util.styleText` (no chalk required).
- Read a single-line or password prompt from stdin with `readline/promises`.
- Build an in-place spinner and a progress-bar string renderer.
- Load config from env vars, config files, and CLI flags with a clear precedence rule.

## Colours with util.styleText

Node 20 added `util.styleText(format, text)` — a first-class, dependency-free way to apply ANSI colour codes. It automatically detects whether the terminal supports colour and produces plain text when it does not (for example, when stdout is piped to a file).

```js
import { styleText } from "node:util";

console.log(styleText("green",   "Build succeeded"));
console.log(styleText("red",     "Error: file not found"));
console.log(styleText("yellow",  "Warning: deprecated flag"));
console.log(styleText("bold",    "Step 1: installing dependencies"));
console.log(styleText(["bold", "cyan"], "=== REPORT ==="));
```

> [!OUTPUT]
> Build succeeded
> Error: file not found
> Warning: deprecated flag
> Step 1: installing dependencies
> === REPORT ===

The second argument to `styleText` can be a **single string** or an **array of format names** to combine effects. Available formats include all ANSI colours (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`) and modifiers (`bold`, `italic`, `underline`, `dim`, `strikethrough`), plus their bright and background variants (`bgRed`, `brightGreen`, etc.).

> [!NOTE] Automatic colour detection
> `styleText` checks `process.stdout.hasColors()` and respects the `NO_COLOR` environment variable (the cross-tool standard). When colour is not supported it returns the text unchanged — you never need an `if (supportsColor)` guard.

### Why not chalk?

Chalk is excellent but it is a dependency. For new Node 20+ projects `util.styleText` covers the common 90 % of cases. Use chalk if you need: hyperlinks, 256-colour or true-colour support, or you are targeting older Node versions.

> [!PRINCIPAL] Prefer stdlib when the functionality is equivalent
> Every dependency you add is a supply-chain risk and a maintenance burden. `util.styleText` is audited, always available, and has no install cost. The engineering principle is: prefer a slightly less featureful built-in over a fully-featured dependency when the difference does not affect your users.

## Reading stdin: prompts

For interactive prompts — "What is your name?", "Password:", "Continue? (y/n)" — use `readline/promises`:

```js
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const name = await rl.question("What is your name? ");
const age  = await rl.question("Your age: ");

console.log(`Hello, ${name}! You are ${age} years old.`);
rl.close();
```

> [!OUTPUT]
> What is your name? Ada
> Your age: 30
> Hello, Ada! You are 30 years old.

For a **password prompt** (hidden input) use the lower-level `readline.createInterface` with a custom `_writeToOutput` shim — or better, write a tiny helper that temporarily mutes stdout echo:

```js
import readline from "node:readline";
import { stdin, stdout } from "node:process";

function askSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl._writeToOutput = () => {};   // suppress echo
  });
}

const pw = await askSecret("Password: ");
console.log(`Got ${pw.length} characters.`);
```

> [!OUTPUT]
> Password:
> Got 12 characters.

> [!PITFALL] Forgetting rl.close()
> If you do not call `rl.close()`, the readline interface keeps the event loop alive and your process never exits. Always close the interface as soon as you have the answer.

## Spinners

A spinner is a single line that rewrites itself using the carriage-return character `\r`. You cycle through an array of frames on a timer:

```js
import { styleText } from "node:util";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label) {
  let frame = 0;
  const id  = setInterval(() => {
    const icon = styleText("cyan", FRAMES[frame % FRAMES.length]);
    process.stdout.write(`\r${icon} ${label}`);
    frame++;
  }, 80);

  return {
    stop(successMsg) {
      clearInterval(id);
      const icon = styleText("green", "✔");
      process.stdout.write(`\r${icon} ${successMsg}\n`);
    },
  };
}

const spinner = startSpinner("Installing dependencies…");
// Simulate async work:
setTimeout(() => spinner.stop("Dependencies installed"), 2000);
```

> [!OUTPUT]
> ✔ Dependencies installed

> [!NOTE] Spinner libraries
> Libraries like `ora` and `listr2` offer richer spinners (nested tasks, persistent output). They are worth pulling in for complex task pipelines, but a 15-line DIY spinner as above is plenty for most scripts.

## Progress bars

A progress bar renders a filled vs unfilled ratio on a single line — the same `\r` trick:

```js
function renderBar(done, total, width = 30) {
  const ratio   = Math.min(done / total, 1);
  const filled  = Math.round(ratio * width);
  const empty   = width - filled;
  const bar     = "█".repeat(filled) + "░".repeat(empty);
  const percent = (ratio * 100).toFixed(0).padStart(3);
  return `[${bar}] ${percent}% (${done}/${total})`;
}

// Stream 200 "files" and update the bar
for (let i = 0; i <= 200; i++) {
  process.stdout.write("\r" + renderBar(i, 200));
}
process.stdout.write("\n");
```

> [!OUTPUT]
> [██████████████████████████████] 100% (200/200)

## Exit codes

The operating system (and CI pipelines) read your process exit code to determine success or failure. Use them:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | general error (bad usage, runtime failure) |
| `2` | misuse of shell builtins (POSIX) — avoid |
| `>= 3` | tool-specific codes you document |

```js
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { output: { type: "string", short: "o" } },
});

if (!values.output) {
  console.error("Error: --output is required");
  process.exit(1);   // non-zero = failure
}

// Do the work…
process.exit(0);     // explicit success (optional — process exits 0 by default)
```

> [!PITFALL] process.exit() kills pending async work
> `process.exit()` is immediate: it does not flush buffered writes, run `.finally()` blocks, or close database connections. For graceful shutdown, emit a signal or set a flag and let the event loop drain naturally — only call `process.exit()` as a last resort or in error paths where you want an immediate abort.

## Config files and precedence

Real CLIs read config from multiple sources. The standard precedence order (highest wins):

```
CLI flags  >  environment variables  >  project config file  >  user config file  >  built-in defaults
```

A simple loader that respects this order:

```js
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";

// 1. Built-in defaults
const defaults = { output: "dist", minify: false, verbose: false };

// 2. User config file (e.g. ~/.toolrc.json)
const userCfgPath = new URL(".toolrc.json", import.meta.url);
const userCfg = existsSync(userCfgPath)
  ? JSON.parse(readFileSync(userCfgPath, "utf8"))
  : {};

// 3. Project config (e.g. tool.config.json in cwd)
const projCfgPath = new URL("tool.config.json", import.meta.url);
const projCfg = existsSync(projCfgPath)
  ? JSON.parse(readFileSync(projCfgPath, "utf8"))
  : {};

// 4. Environment variables
const envCfg = {
  ...(process.env.TOOL_OUTPUT  && { output:  process.env.TOOL_OUTPUT }),
  ...(process.env.TOOL_MINIFY  && { minify:  process.env.TOOL_MINIFY === "1" }),
  ...(process.env.TOOL_VERBOSE && { verbose: process.env.TOOL_VERBOSE === "1" }),
};

// 5. CLI flags (highest priority)
const { values: flags } = parseArgs({
  options: {
    output:  { type: "string",  short: "o" },
    minify:  { type: "boolean", short: "m" },
    verbose: { type: "boolean", short: "v" },
  },
});
const cliCfg = Object.fromEntries(
  Object.entries(flags).filter(([, v]) => v !== undefined)
);

// Merge: later spreads win
const config = { ...defaults, ...userCfg, ...projCfg, ...envCfg, ...cliCfg };
console.log(config);
```

> [!OUTPUT]
> { output: 'dist', minify: false, verbose: false }

> [!PRINCIPAL] Config precedence is a UX contract
> The order matters as a user-experience promise: CLI flags always win (good for one-off overrides), env vars let CI systems control behaviour without modifying files, and config files capture project-level preferences that belong in version control. Documenting your tool's precedence chain in its help text earns trust with power users.

## Try it yourself

Here are two pure-JS building blocks you can run right now in the browser: an ANSI-colour wrapper function and a progress-bar string renderer. Study how they work, then try the exercises below.

```js run
// --- ANSI colour wrapper (browser-safe simulation) ---
// In Node you would use util.styleText; here we map format names to escape codes.
const CODES = {
  reset:     "\x1b[0m",
  bold:      "\x1b[1m",
  dim:       "\x1b[2m",
  red:       "\x1b[31m",
  green:     "\x1b[32m",
  yellow:    "\x1b[33m",
  blue:      "\x1b[34m",
  cyan:      "\x1b[36m",
  white:     "\x1b[37m",
};

function style(formats, text) {
  const codes = [formats].flat().map((f) => CODES[f] ?? "").join("");
  return `${codes}${text}${CODES.reset}`;
}

// --- Progress-bar string renderer ---
function renderBar(done, total, width = 20) {
  const ratio  = Math.min(done / total, 1);
  const filled = Math.round(ratio * width);
  const bar    = "█".repeat(filled) + "░".repeat(width - filled);
  const pct    = (ratio * 100).toFixed(0).padStart(3);
  return `[${bar}] ${pct}%`;
}

// Demo
console.log(style("green",  "✔ Build succeeded"));
console.log(style("red",    "✖ Error: file not found"));
console.log(style(["bold", "cyan"], "=== REPORT ==="));

for (let i = 0; i <= 5; i++) {
  console.log(renderBar(i, 5));
}
```

## Exercises

**Exercise 1:** Extend the `style()` function above to support background colours (`bgRed`, `bgGreen`, `bgBlue`). The ANSI codes for background colours start at `\x1b[41m` (red), `\x1b[42m` (green), `\x1b[44m` (blue).

<details>
<summary>Show solution</summary>

```js run
const CODES = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue:  "\x1b[44m",
  white:   "\x1b[37m",
};

function style(formats, text) {
  const codes = [formats].flat().map((f) => CODES[f] ?? "").join("");
  return `${codes}${text}${CODES.reset}`;
}

console.log(style(["bgRed",   "white", "bold"], "  ERROR  "));
console.log(style(["bgGreen", "white", "bold"], "  PASS   "));
console.log(style(["bgBlue",  "white"],          "  INFO   "));
```

</details>

**Exercise 2:** Write a `mergeConfig(sources)` function that accepts an array of config objects in ascending priority order and returns the merged result. Keys whose values are `undefined` should not override earlier values.

<details>
<summary>Show solution</summary>

```js run
function mergeConfig(sources) {
  const result = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

const defaults   = { output: "dist", minify: false, verbose: false, port: 3000 };
const projectCfg = { output: "build", port: undefined };     // undefined should NOT override
const envCfg     = { verbose: true };
const cliFlags   = { minify: true };

const config = mergeConfig([defaults, projectCfg, envCfg, cliFlags]);
console.log(JSON.stringify(config, null, 2));
// output: "build" (from projectCfg), port: 3000 (undefined did not override)
// verbose: true (from envCfg), minify: true (from cliFlags)
```

</details>

## Common pitfalls

> [!PITFALL] Writing ANSI codes to non-TTY streams
> If you write ANSI escape codes to a pipe or file (e.g. `node tool.js > output.txt`) the consumer sees raw escape sequences like `\x1b[32m`. `util.styleText` avoids this automatically; if you roll your own codes, check `process.stdout.isTTY` before emitting them.

> [!PITFALL] Blocking the event loop with synchronous prompts
> There is no synchronous `readline.questionSync`. Reading prompts with `await rl.question()` is non-blocking. Never try to simulate synchronous input by spinning on `fs.readSync(0, ...)` on stdin — it blocks the process and prevents signals from being delivered.

## What you learned

- `util.styleText(format, text)` from `node:util` adds ANSI colours with zero dependencies and auto-detects colour support.
- `readline/promises` provides `await rl.question()` for clean, non-blocking interactive prompts.
- A spinner is `setInterval` + `process.stdout.write("\r" + frame)` and a progress bar is the same idea with a ratio-based fill string.
- Use exit code `0` for success and `1` (or a documented higher code) for errors; avoid `process.exit()` in async hot paths.
- Config precedence: CLI flags > env vars > project config > user config > built-in defaults.

## Next steps

You can now build a polished, interactive CLI. The final step in this module is the most ambitious: bundling your CLI into a **Single Executable Application** — a self-contained binary that users can run without installing Node at all.
*/});
