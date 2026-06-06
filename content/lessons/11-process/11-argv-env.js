registerLessonSrc("11-argv-env", function () {/*
---
id: 11-argv-env
title: "argv, env & Native --env-file Support"
minutes: 22
level: intermediate
objectives:
  - Read command-line arguments from process.argv and parse them safely
  - Access and validate environment variables through process.env
  - Use Node's native --env-file flag to load .env files without dotenv
---

# argv, env & Native --env-file Support

## Why this matters

Every production service needs two things before it can run: the arguments that tell it *what* to do, and the environment variables that tell it *how* to connect to the outside world (databases, API keys, feature flags). Getting config wrong — hardcoded secrets, environment leaking between test and prod, missing variable crashes — is one of the most common sources of real incidents. Node exposes both vectors through a tiny surface area: `process.argv` and `process.env`.

## Learning objectives

- Parse `process.argv` correctly and distinguish the node-binary slice from user-supplied arguments.
- Read, validate, and provide defaults for `process.env` variables.
- Load `.env` files using Node's **native** `--env-file` flag (Node 20.6+, no `dotenv` needed).
- Apply a sane config-precedence model (flags → env → file → default).

## process.argv — the command-line array

When Node runs a script, it populates `process.argv` with an array:

```
argv[0]  → path to the node binary
argv[1]  → path to the script being run
argv[2+] → everything the user typed after the script name
```

```js
// server.js
// node server.js --port 3000 --host 0.0.0.0

console.log(process.argv);
// [
//   '/usr/local/bin/node',
//   '/home/app/server.js',
//   '--port',
//   '3000',
//   '--host',
//   '0.0.0.0'
// ]

// The user's arguments start at index 2.
const args = process.argv.slice(2);
```

> [!OUTPUT]
> ['/usr/local/bin/node', '/home/app/server.js', '--port', '3000', '--host', '0.0.0.0']

For sophisticated argument parsing, use `util.parseArgs` (Node 18+), which handles `--flag`, `--flag value`, `-f`, boolean vs string types, and unknown-argument errors:

```js
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port:  { type: "string",  short: "p", default: "8080" },
    host:  { type: "string",  short: "h", default: "127.0.0.1" },
    debug: { type: "boolean", short: "d", default: false },
  },
  allowPositionals: true,
});

console.log(values.port);   // "3000" (always a string, coerce yourself)
console.log(values.debug);  // true
```

> [!OUTPUT]
> 3000
> true

> [!NOTE] util.parseArgs vs third-party parsers
> For most CLIs, `util.parseArgs` is everything you need — it's zero-dependency and ships with Node. Reach for `yargs`, `commander`, or `meow` only when you need auto-generated help text or sub-commands.

## process.env — the environment dictionary

`process.env` is a plain object whose keys and values are **always strings**. It reflects the shell environment the process was started in, plus anything set with `VAR=value node script.js`.

```js
// Access with a fallback:
const port    = Number(process.env.PORT ?? "8080");
const logLevel = process.env.LOG_LEVEL ?? "info";
const isProd  = process.env.NODE_ENV === "production";
```

> [!PITFALL] process.env values are always strings — even numbers and booleans
> `process.env.WORKERS` is `"4"`, not `4`. Always coerce: `Number(process.env.WORKERS)`, or `process.env.FEATURE_X === "true"`. Forgetting this leads to subtle bugs like `"4" + 1 === "41"`.

**Validating required variables early** — fail fast at startup, not mid-request:

```js
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const dbUrl     = requireEnv("DATABASE_URL");
const jwtSecret = requireEnv("JWT_SECRET");
```

> [!OUTPUT]
> [config] Missing required env var: DATABASE_URL

## NODE_ENV — the de facto environment signal

`NODE_ENV` is the convention (not a Node built-in) for telling code which environment it's running in. Values like `"production"`, `"development"`, and `"test"` are standard.

```js
const env = process.env.NODE_ENV ?? "development";

const config = {
  debug:       env !== "production",
  logLevel:    env === "production" ? "warn" : "debug",
  dbPoolSize:  env === "production" ? 10 : 2,
};

console.log(`Running in ${env} mode`);
```

> [!PRINCIPAL] NODE_ENV is a coordination contract, not magic
> NODE_ENV works only because the whole ecosystem (Express, Next.js, webpack, testing tools) agrees to read it. Node itself ignores it — it has no built-in meaning. That said, Node 24 will start warning or optimising based on it in some paths, so treat it as a first-class production signal. Consider also `--conditions` for more structured build variant selection.

## Native --env-file support (Node 20.6+)

Before Node 20.6, you needed `dotenv` to load a `.env` file. Today Node handles it natively:

```bash
# .env file
DATABASE_URL=postgres://localhost:5432/mydb
JWT_SECRET=supersecret
PORT=3000
LOG_LEVEL=debug
```

```bash
# Load .env into the process before running your script:
node --env-file=.env server.js

# Multiple files — later files override earlier ones:
node --env-file=.env --env-file=.env.local server.js

# Or set it as a default in package.json scripts:
```

```json
{
  "scripts": {
    "dev":   "node --env-file=.env --env-file=.env.local src/index.js",
    "start": "node src/index.js"
  }
}
```

Inside your code, variables from `--env-file` appear in `process.env` exactly as if they'd been exported in the shell — **no import needed**.

> [!NOTE] .env.local for personal overrides
> The convention is to commit `.env` (with safe defaults or empty values) and gitignore `.env.local` (real credentials). The second `--env-file` argument overrides the first, so local values win. This mirrors how frameworks like Next.js and Vite handle it.

## Config precedence — a layered model

Real apps layer configuration from multiple sources. The standard precedence (highest wins):

```
1. Explicit CLI flag:   --port 9000
2. Environment var:     PORT=9000
3. .env.local file:     PORT=9000  (personal override, gitignored)
4. .env file:           PORT=8080  (committed defaults)
5. Hardcoded default:   8080
```

A simple merger that respects this order:

```js
// config.js — pure-JS config builder (no Node APIs, works as a concept)
function mergeConfig(defaults, fileEnv, envVars, flags) {
  // Later sources in Object.assign win — so order matters
  return Object.assign({}, defaults, fileEnv, envVars, flags);
}

const defaults  = { port: 8080, host: "127.0.0.1", logLevel: "info" };
const fileEnv   = { port: 3000 };                    // from .env
const envVars   = { port: 4000, logLevel: "debug" }; // from process.env
const flags     = {};                                // no CLI overrides

const config = mergeConfig(defaults, fileEnv, envVars, flags);
console.log(config);
// { port: 4000, host: "127.0.0.1", logLevel: "debug" }
```

> [!OUTPUT]
> { port: 4000, host: '127.0.0.1', logLevel: 'debug' }

## Try it yourself

Build a tiny `.env` file parser and a config merger with precedence. This is roughly what `dotenv` does under the hood — and now Node does it for you, but understanding the mechanism makes you a better debugger.

```js run
// Pure-JS .env parser: parses KEY=VALUE lines, ignores comments and blanks.
function parseEnvFile(text) {
  const result = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;    // blank or comment
    const eq = line.indexOf("=");
    if (eq === -1) continue;                        // no equals sign
    const key   = line.slice(0, eq).trim();
    let   value = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Config merger — later sources win (highest precedence last)
function buildConfig(layers) {
  return Object.assign({}, ...layers);
}

// --- simulate a real startup ---

const dotEnvFile = `
# Database config
DATABASE_URL=postgres://localhost:5432/dev
PORT=3000
LOG_LEVEL=info
DEBUG=false
`;

const dotEnvLocal = `
LOG_LEVEL=debug
DEBUG=true
`;

// Simulate process.env having PORT set in the shell
const simulatedProcessEnv = { PORT: "4000" };

// Simulate a --port CLI flag
const cliFlags = {};

const fileLayer  = parseEnvFile(dotEnvFile);
const localLayer = parseEnvFile(dotEnvLocal);

const config = buildConfig([
  { port: "8080", logLevel: "warn", debug: "false" }, // hardcoded defaults
  fileLayer,                                           // .env
  localLayer,                                          // .env.local (wins over .env)
  simulatedProcessEnv,                                 // shell env (wins over files)
  cliFlags,                                            // CLI flags (highest)
]);

console.log("port      :", config.PORT);
console.log("log level :", config.LOG_LEVEL);
console.log("debug     :", config.DEBUG);
console.log("db url    :", config.DATABASE_URL);
```

## Exercise

**Challenge:** Extend the parser to handle multi-word values and validate that required keys are present, throwing a descriptive error for any that are missing.

<details>
<summary>Show solution</summary>

```js run
function parseEnvFile(text) {
  const result = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key   = line.slice(0, eq).trim();
    let   value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function validateConfig(config, required) {
  const missing = required.filter(k => !config[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required config keys: ${missing.join(", ")}`);
  }
  return config;
}

const env = parseEnvFile(`
APP_NAME="My Awesome Server"
PORT=3000
`);

try {
  validateConfig(env, ["APP_NAME", "PORT", "DATABASE_URL"]);
} catch (err) {
  console.error("Config error:", err.message);
}

const ok = validateConfig(
  parseEnvFile(`APP_NAME=Test\nPORT=8080\nDATABASE_URL=postgres://localhost/db`),
  ["APP_NAME", "PORT", "DATABASE_URL"]
);
console.log("Valid config:", ok);
```

</details>

## Common pitfalls

> [!PITFALL] Leaking secrets into argv
> Never pass secrets as `--api-key=mysecret` CLI arguments — they appear in `ps aux`, shell history, and log aggregators. Use environment variables or `--env-file` instead. argv is for *behavioural* flags (ports, log levels, feature toggles), not credentials.

> [!PITFALL] Modifying process.env in tests
> Tests that mutate `process.env` and don't restore it afterwards cause brittle, order-dependent test suites. Always save and restore: `const orig = process.env.FOO; process.env.FOO = "test"; ... process.env.FOO = orig;` — or use a test helper that does it for you.

## What you learned

- `process.argv` is `[node, script, ...userArgs]`; slice from index 2 and use `util.parseArgs` for robust flag parsing.
- `process.env` keys and values are always strings — coerce and validate them at startup.
- Node 20.6+ loads `.env` natively via `--env-file=.env`, eliminating the need for `dotenv`.
- Config precedence flows: hardcoded default → .env file → .env.local → shell env → CLI flag.
- `NODE_ENV` is a community convention; validate it explicitly rather than trusting it blindly.

## Next steps

Now that your process can read its configuration, let's look at how it responds to the operating system: signals like `SIGTERM` and `SIGINT` are how the outside world asks your process to shut down gracefully.
*/});
