registerLesson("03-globals-and-process", `
---
id: 03-globals-and-process
title: Globals, globalThis & the process Object
minutes: 24
level: beginner
objectives:
  - Know the globals Node provides and how they differ from the browser
  - Use the process object to read arguments, env, and platform info
  - Read input and write output via stdin/stdout/stderr
---

# Globals, globalThis & the process Object

## Why this matters

Every Node program runs inside an environment with a set of always-available **globals** — chief among them \`process\`, your program's control panel and window into the outside world. Command-line arguments, environment variables, the platform, standard input/output, exit codes — all flow through \`process\`. Master it and you can build real command-line tools and configurable services.

## Learning objectives

- Identify Node's key **globals** and how they differ from the browser's.
- Use **\`process\`** for arguments, environment, and platform details.
- Read and write **stdin / stdout / stderr**.

## Globals: what's always available

In the browser, the global object is \`window\`. In Node, there's no \`window\` (there's no web page!). The standard cross-environment name is **\`globalThis\`**. Node provides its own set of globals:

| Global | Purpose |
|--------|---------|
| \`globalThis\` | The global object (works everywhere) |
| \`process\` | The current Node process — arguments, env, I/O, lifecycle |
| \`console\` | Logging (\`log\`, \`error\`, \`warn\`, \`table\`, \`time\`...) |
| \`Buffer\` | Raw binary data (Module 8) |
| \`__dirname\` / \`__filename\` | Current directory/file path (CommonJS only) |
| \`setTimeout\` / \`setInterval\` / \`setImmediate\` | Timers |
| \`fetch\` | Built-in HTTP client (no import needed!) |
| \`structuredClone\` | Deep-clone data |
| \`URL\`, \`TextEncoder\`, \`crypto\` | Web-standard APIs Node adopted |

> [!NOTE] Node speaks "web standard" now
> Modern Node deliberately implements browser APIs — \`fetch\`, \`URL\`, \`AbortController\`, \`structuredClone\`, Web Streams, \`crypto.subtle\`. Code you learn here increasingly works in browsers, Deno, Bun, and edge runtimes too. That's a big theme of 2026 Node.

~~~js run
// These globals exist in the browser-like sandbox too — try them:
console.log(typeof globalThis);       // "object"
console.log(typeof setTimeout);       // "function"
console.log(typeof structuredClone);  // "function"

console.table([
  { name: "Ada", role: "engineer" },
  { name: "Sam", role: "designer" }
]); // console.table prints a neat grid
~~~

## The process object

\`process\` is a global representing the running Node program. (It's a Node-only object, so the examples below are read-only here with expected output — copy them into a file to run for real.)

### process.argv — command-line arguments

~~~js
// args.js — run with: node args.js hello world --verbose
console.log(process.argv);
~~~

> [!OUTPUT]
> [
>   '/usr/local/bin/node',      // [0] the node binary
>   '/home/you/args.js',        // [1] your script
>   'hello',                    // [2+] your actual arguments
>   'world',
>   '--verbose'
> ]

The first two entries are always the Node path and the script path; **your** arguments start at index 2:

~~~js
const args = process.argv.slice(2); // ["hello", "world", "--verbose"]
console.log("You passed:", args);
~~~

> [!PRINCIPAL] Don't hand-roll arg parsing for real CLIs
> \`process.argv.slice(2)\` is fine for a quick script, but for real tools Node now ships **\`util.parseArgs\`** (Module 12) which handles flags, values, and defaults properly. Knowing the raw \`argv\` underneath makes the higher-level tools make sense.

### process.env — environment variables

Environment variables configure your program from the outside — the standard way to pass secrets and settings without hard-coding them:

~~~js
// Run with: DATABASE_URL=postgres://... NODE_ENV=production node app.js
const dbUrl = process.env.DATABASE_URL;
const isProd = process.env.NODE_ENV === "production";
const port = process.env.PORT ?? 3000; // default if unset

console.log({ dbUrl, isProd, port });
~~~

> [!NOTE] Native .env support
> Modern Node reads \`.env\` files natively: \`node --env-file=.env app.js\`. No \`dotenv\` package required. We cover this fully in Module 11.

### process platform & version info

~~~js
console.log(process.platform);  // 'linux' | 'darwin' | 'win32'
console.log(process.arch);      // 'x64' | 'arm64'
console.log(process.version);   // 'v24.2.0'
console.log(process.pid);       // the OS process id
console.log(process.uptime());  // seconds since the program started
console.log(process.cwd());     // current working directory
~~~

> [!OUTPUT]
> linux
> arm64
> v24.2.0
> 48213
> 0.041
> /home/you/project

### Exit codes

How a program signals success or failure to the shell (and to CI):

~~~js
if (!process.env.API_KEY) {
  console.error("API_KEY is required");
  process.exit(1); // non-zero = failure
}
// Reaching the end normally exits with code 0 = success.
~~~

> [!PITFALL] Avoid process.exit() in the middle of work
> Calling \`process.exit()\` kills the process *immediately*, potentially cutting off pending writes (logs, file saves, network responses). Prefer setting \`process.exitCode = 1\` and letting the program finish naturally. Reserve hard \`exit()\` for true "abort now" situations. (More in Module 11's graceful-shutdown lesson.)

## Standard streams: stdin, stdout, stderr

Every process has three standard streams:
- **stdout** — normal output (\`console.log\` writes here).
- **stderr** — errors and diagnostics (\`console.error\` writes here).
- **stdin** — input piped or typed into the program.

~~~js
process.stdout.write("no newline added\\n"); // console.log adds the newline for you
process.stderr.write("this goes to the error stream\\n");
~~~

Separating stdout from stderr matters: it lets users pipe your real output somewhere while still seeing errors. Reading stdin lets you build filter-style tools:

~~~js
// uppercase.js — pipe text in: echo "hello" | node uppercase.js
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  process.stdout.write(chunk.toUpperCase());
});
~~~

> [!OUTPUT]
> $ echo "hello world" | node uppercase.js
> HELLO WORLD

### Exercise: simulate argument handling

You can't read real \`process.argv\` in the browser, but you can practise the *logic*. Parse a fake argv into a simple options object.

~~~js run
const fakeArgv = ["node", "script.js", "build", "--watch", "--out=dist"];
const args = fakeArgv.slice(2);

const command = args[0];                          // "build"
const flags = {};
for (const arg of args.slice(1)) {
  if (arg.startsWith("--")) {
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value ?? true;                   // --watch -> true, --out=dist -> "dist"
  }
}

console.log("command:", command);
console.log("flags:", flags); // { watch: true, out: "dist" }
~~~

You just wrote a tiny argument parser — the same idea \`util.parseArgs\` formalises.

## What you learned

- Node's global is **\`globalThis\`** (no \`window\`); it provides \`process\`, \`console\`, \`Buffer\`, timers, and web-standard APIs like \`fetch\`.
- **\`process.argv\`** holds command-line args (yours start at index 2); **\`process.env\`** holds configuration.
- \`process\` exposes platform, version, pid, cwd, and **exit codes** (prefer \`exitCode\` over \`exit()\`).
- **stdout/stderr/stdin** are the standard streams; separating output from errors is good practice.

## Next steps

You know what \`process\` offers. Next we'll put it to work: the different ways to run Node programs, the flags that matter, and built-in \`--watch\` for a fast dev loop.
`);
