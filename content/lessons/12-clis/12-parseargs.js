registerLessonSrc("12-parseargs", function () {/*
---
id: 12-parseargs
title: Parsing Arguments with util.parseArgs
minutes: 22
level: intermediate
objectives:
  - Use Node's built-in util.parseArgs to handle flags, options, and positionals
  - Configure types, short flags, defaults, and allowPositionals correctly
  - Build readable help text and understand when to reach for commander or yargs
---

# Parsing Arguments with util.parseArgs

## Why this matters

Every production CLI tool needs to parse arguments — `--verbose`, `--output dist/`, `-n 5`. For years the only good choices were third-party libraries (commander, yargs, minimist). Since Node 18 there is a **built-in answer**: `util.parseArgs`. It covers the common 80 % of cases with zero dependencies, and understanding it also teaches you the vocabulary (tokens, options, positionals) used across every argument-parsing library.

## Learning objectives

- Parse flags, key-value options, short aliases, and positionals with `util.parseArgs`.
- Set sensible defaults and validate the resulting values object.
- Write a concise, correct help text string.
- Know when `util.parseArgs` is enough and when to reach for commander or yargs.

## The shape of command-line arguments

When a user types:

```bash
node tool.js build --output dist --minify -v report.html
```

Node puts everything after the script path into `process.argv.slice(2)`. That gives you an array of raw strings:

```js
["build", "--output", "dist", "--minify", "-v", "report.html"]
```

You need to sort these into three buckets:

| Bucket | Example | Meaning |
|---|---|---|
| **positionals** | `build`, `report.html` | bare values — typically the main subject |
| **boolean flags** | `--minify`, `-v` | present = true, absent = false |
| **string options** | `--output dist` | key + following value |

`util.parseArgs` does all of this for you.

## util.parseArgs basics

```js
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),   // what to parse (defaults to this anyway)
  allowPositionals: true,        // opt-in for bare values
  options: {
    output: {
      type: "string",            // "string" | "boolean"
      short: "o",                // -o is an alias for --output
      default: "dist",           // used when the flag is absent
    },
    minify: {
      type: "boolean",
      short: "m",
      default: false,
    },
    verbose: {
      type: "boolean",
      short: "v",
      default: false,
    },
  },
});

console.log(values.output);      // "dist" or whatever the user passed
console.log(values.minify);      // true | false
console.log(positionals);        // ["build", "report.html"] etc.
```

> [!OUTPUT]
> dist
> false
> []

> [!NOTE] args defaults to process.argv.slice(2)
> You rarely need to pass `args` explicitly — `parseArgs` reads `process.argv` automatically. The explicit form is useful for testing your CLI logic without spawning a process.

### The `--` end-of-options marker

`parseArgs` respects the POSIX convention: anything after a bare `--` is treated as a positional even if it looks like a flag.

```bash
node tool.js --minify -- --not-a-flag file.txt
# positionals → ["--not-a-flag", "file.txt"]
```

### Combining short flags

Single-character short aliases can be clustered. `-vmj` expands to `-v -m -j` — but only for boolean flags. A string option must be the last flag in a cluster and immediately followed by its value (`-o dist` or `-odist`).

## Building a useful help text

`parseArgs` does not generate help text — that is intentional. You own the output, so you write it:

```js
import { parseArgs } from "node:util";

const HELP = `
Usage: build [options] [files...]

Options:
  -o, --output <dir>   Output directory  (default: "dist")
  -m, --minify         Enable minification
  -v, --verbose        Print extra detail
  -h, --help           Show this help
`.trim();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output:  { type: "string",  short: "o", default: "dist" },
    minify:  { type: "boolean", short: "m", default: false  },
    verbose: { type: "boolean", short: "v", default: false  },
    help:    { type: "boolean", short: "h", default: false  },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

console.log("Building to:", values.output);
console.log("Files:", positionals);
```

> [!OUTPUT]
> Building to: dist
> Files: []

## Tokens: under the hood

`parseArgs` has a lower-level mode: `{ tokens: true }`. This adds a `tokens` array showing exactly how each argument was classified before being resolved into `values`.

```js
import { parseArgs } from "node:util";

const { tokens } = parseArgs({
  args: ["--output=dist", "-mv", "file.txt"],
  allowPositionals: true,
  tokens: true,
  options: {
    output:  { type: "string",  short: "o" },
    minify:  { type: "boolean", short: "m" },
    verbose: { type: "boolean", short: "v" },
  },
});

console.log(tokens);
```

> [!OUTPUT]
> [
>   { kind: 'option', name: 'output', rawName: '--output', value: 'dist', inlineValue: true, index: 0 },
>   { kind: 'option-terminator', index: 1 },
>   { kind: 'option', name: 'minify',  rawName: '-m', value: undefined, index: 1 },
>   { kind: 'option', name: 'verbose', rawName: '-v', value: undefined, index: 1 },
>   { kind: 'positional', value: 'file.txt', index: 2 }
> ]

This is the foundation for building your own argument parser — which is what you will do in the exercise.

## util.parseArgs vs commander vs yargs

| Feature | util.parseArgs | commander | yargs |
|---|---|---|---|
| Zero dependencies | yes | no | no |
| Sub-commands | no | yes | yes |
| Auto help & version | no | yes | yes |
| Validation / coercion | no | partial | yes |
| Best for | scripts, internal tools | feature-rich CLIs | complex CLIs |

> [!PRINCIPAL] Pick the right abstraction for the job
> `util.parseArgs` is excellent for internal tooling, build scripts, and any CLI where you control the input surface. Pull in commander or yargs when you need sub-commands (e.g. `git commit`, `git push`), rich validation, or auto-generated help pages you do not want to maintain by hand. Avoid over-engineering: a 40-line script does not need a full framework.

## Try it yourself

Here is a pure-JavaScript mini argument tokeniser. It walks an array of argument strings and classifies each token — the same logic at the heart of every real parser. Run it and study the output, then try changing the `rawArgs` array.

```js run
// Mini argument tokeniser — pure JS, no Node APIs needed.
// Understands: --flag, --key=val, --key val, -abc (clustered booleans), positionals.

function tokenise(args) {
  const tokens = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      // Everything after "--" is a positional
      i++;
      while (i < args.length) {
        tokens.push({ kind: "positional", value: args[i] });
        i++;
      }
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --key=value
        tokens.push({ kind: "option", name: arg.slice(2, eqIdx), value: arg.slice(eqIdx + 1) });
      } else {
        // --key [value?]
        const name = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          tokens.push({ kind: "option", name, value: next });
          i++;
        } else {
          tokens.push({ kind: "flag", name });
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // -abc  =>  flag "a", flag "b", flag "c"
      const chars = arg.slice(1).split("");
      chars.forEach((ch) => tokens.push({ kind: "flag", name: ch }));
    } else {
      tokens.push({ kind: "positional", value: arg });
    }

    i++;
  }

  return tokens;
}

// --- try it ---
const rawArgs = ["build", "--output=dist", "--minify", "-vn", "file.txt", "--", "--not-a-flag"];
const tokens  = tokenise(rawArgs);
tokens.forEach((t) => console.log(JSON.stringify(t)));
```

## Exercise

**Challenge:** extend `tokenise` above into a full `parseArgs`-alike. The function signature should be:

```js
parse(args, options)
// options: { [name]: { type: "string"|"boolean", short?: string, default?: any } }
// returns: { values, positionals }
```

Requirements:
1. Resolve short-flag aliases to their long names.
2. Apply defaults for any option not found in `args`.
3. Return `{ values, positionals }` — the same shape as `util.parseArgs`.

<details>
<summary>Show solution</summary>

```js run
function parse(args, optionDefs) {
  // Build a short-flag lookup: { "o": "output", "v": "verbose", ... }
  const shortMap = {};
  for (const [name, def] of Object.entries(optionDefs)) {
    if (def.short) shortMap[def.short] = name;
  }

  const values     = {};
  const positionals = [];

  // Seed defaults
  for (const [name, def] of Object.entries(optionDefs)) {
    if (def.default !== undefined) values[name] = def.default;
  }

  let i = 0;
  let pastSeparator = false;

  while (i < args.length) {
    const arg = args[i];

    if (pastSeparator) {
      positionals.push(arg); i++; continue;
    }
    if (arg === "--") { pastSeparator = true; i++; continue; }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const name = arg.slice(2, eqIdx);
        values[name] = arg.slice(eqIdx + 1);
      } else {
        const name = arg.slice(2);
        const def  = optionDefs[name];
        if (def && def.type === "string") {
          values[name] = args[++i];
        } else {
          values[name] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      for (const ch of arg.slice(1)) {
        const name = shortMap[ch] || ch;
        const def  = optionDefs[name];
        values[name] = def && def.type === "boolean" ? true : true;
      }
    } else {
      positionals.push(arg);
    }

    i++;
  }

  return { values, positionals };
}

// --- test ---
const result = parse(
  ["build", "--output=dist", "-v", "report.html"],
  {
    output:  { type: "string",  short: "o", default: "out" },
    minify:  { type: "boolean", short: "m", default: false  },
    verbose: { type: "boolean", short: "v", default: false  },
  }
);

console.log("values:", JSON.stringify(result.values));
console.log("positionals:", JSON.stringify(result.positionals));
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting allowPositionals
> By default `util.parseArgs` throws if it encounters a bare positional. You must set `allowPositionals: true` explicitly. This is a deliberate API choice — it prevents silently swallowing typos — but it surprises most first-time users.

> [!PITFALL] String options consuming the next argument
> If you declare `--output` as `type: "string"` and the user writes `--output --minify` without a value, `parseArgs` will set `output` to `"--minify"` — it cannot know that was a mistake. Always validate: if `values.output.startsWith("-")` treat it as an error.

## What you learned

- `util.parseArgs` from `node:util` handles flags, string options, short aliases, defaults, and positionals with zero dependencies.
- Declare each option's `type` (`"boolean"` or `"string"`), optional `short`, and `default` in the `options` map.
- Always set `allowPositionals: true` if your command accepts bare arguments.
- Write help text manually — you own the format.
- Reach for commander or yargs only when you need sub-commands, rich validation, or generated help you can't maintain yourself.

## Next steps

A parser that can read flags is just the beginning. Next you will make your CLI visually polished and interactive: colours with `util.styleText`, stdin prompts, spinners, exit codes, and reading config files.
*/});
