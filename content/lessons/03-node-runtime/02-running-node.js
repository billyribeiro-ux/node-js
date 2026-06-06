registerLesson("03-running-node", `
---
id: 03-running-node
title: Running Node — Scripts, Flags, REPL & --watch
minutes: 20
level: beginner
objectives:
  - Use the most useful node CLI flags
  - Set up a fast edit-run loop with --watch
  - Build a system-info dashboard project
project: true
---

# Running Node: Scripts, Flags, REPL & --watch

## Why this matters

Knowing the language is half the job; knowing how to *run* it productively is the other half. Node's command-line flags unlock a fast development loop, debugging, and modern features — no extra tools required. This lesson rounds out Module 3 and ends with you building a real system-info dashboard that ties Tier 1 together.

## Learning objectives

- Use the most valuable **\`node\` flags**.
- Build a fast **\`--watch\`** dev loop and debug with **\`--inspect\`**.
- Build a **system-info dashboard** project.

## The flags worth knowing

~~~bash
node app.js                 # run a file
node --watch app.js         # re-run automatically when files change
node --env-file=.env app.js # load environment variables from .env (native!)
node --inspect app.js       # enable the Chrome DevTools debugger
node --test                 # run the built-in test runner (Module 22)
node -e "console.log(1+1)"  # evaluate a one-liner
node -p "process.version"   # evaluate AND print
node --version              # print Node's version
~~~

> [!PRINCIPAL] Modern Node replaced a whole toolbox
> Flags that used to require third-party packages are now built in:
> - \`--watch\` replaces **nodemon**
> - \`--env-file\` replaces **dotenv**
> - \`--test\` replaces (for many projects) **Jest/Mocha**
> - \`node file.ts\` (with type-stripping) reduces the need for **ts-node** for simple cases
>
> Fewer dependencies means less to install, less to break, and less supply-chain risk. A principal engineer reaches for built-ins first.

## A fast dev loop with --watch

Create \`app.js\`:

~~~js
const time = new Date().toLocaleTimeString();
console.log("Hello! It is " + time);
~~~

Run it in watch mode:

~~~bash
node --watch app.js
~~~

> [!OUTPUT]
> Hello! It is 3:14:07 PM
> Completed running 'app.js'. Waiting for file changes before restarting...

Now edit and save the file — Node re-runs it instantly. This tight loop (edit → save → see result) is how you'll work throughout the course. No nodemon, no config.

## Debugging with --inspect

~~~bash
node --inspect app.js
# or pause on the very first line:
node --inspect-brk app.js
~~~

Then open \`chrome://inspect\` in Chrome (or use your editor's debugger) to set breakpoints, step through code, and inspect variables — the same DevTools you may know from the browser, now driving your server code. We'll use this seriously in the performance and memory-leak modules.

## A first look at config files

Real projects keep their run commands in \`package.json\` under \`"scripts"\`, so you type \`npm run dev\` instead of remembering flags:

~~~json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "node app.js",
    "dev": "node --watch --env-file=.env app.js",
    "test": "node --test"
  }
}
~~~

~~~bash
npm run dev   # runs: node --watch --env-file=.env app.js
~~~

> [!NOTE] "type": "module"
> That \`"type": "module"\` line tells Node to treat your \`.js\` files as modern **ES Modules** (so you can use \`import\`/\`export\`). We'll dig into the module system in Module 5; for now, include it so \`import\` works.

## Project: a system-info dashboard

Time to build something real that combines Module 1 (objects, arrays, template literals, modern syntax) with Module 3 (\`process\` and the \`os\` module). This dashboard prints a clean, formatted report about the machine it runs on.

~~~js
// dashboard.js — run with: node dashboard.js
import os from "node:os";

function bar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "] " + percent + "%";
}

function bytesToGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

const totalMem = os.totalmem();
const freeMem = os.freemem();
const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
const load = os.loadavg()[0]; // 1-minute load average (0 on Windows)

const report = {
  host: os.hostname(),
  user: os.userInfo().username,
  platform: \`\${os.platform()} (\${os.arch()})\`,
  cpus: os.cpus().length + " cores",
  node: process.version,
  uptimeHours: (os.uptime() / 3600).toFixed(1) + "h"
};

console.log("\\n╔══════════════════════════════════════════╗");
console.log("║          SYSTEM DASHBOARD                ║");
console.log("╚══════════════════════════════════════════╝");
for (const [key, value] of Object.entries(report)) {
  console.log("  " + key.padEnd(12) + ": " + value);
}
console.log("  memory      : " + bar(usedPercent));
console.log("  used/total  : " + bytesToGB(totalMem - freeMem) + " / " + bytesToGB(totalMem) + " GB");
console.log("");
~~~

When you run it on your machine you'll see something like:

> [!OUTPUT]
> ╔══════════════════════════════════════════╗
> ║          SYSTEM DASHBOARD                ║
> ╚══════════════════════════════════════════╝
>   host        : ada-laptop
>   user        : ada
>   platform    : linux (arm64)
>   cpus        : 8 cores
>   node        : v24.2.0
>   uptimeHours : 36.4h
>   memory      : [██████████████░░░░░░] 71%
>   used/total  : 11.5 / 16.0 GB

### Practice the formatting logic here

The \`bar\` and \`bytesToGB\` helpers are pure JavaScript — test and tweak them in the browser:

~~~js run
function bar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  return "[" + "#".repeat(filled) + ".".repeat(width - filled) + "] " + percent + "%";
}

for (const pct of [0, 25, 50, 75, 100]) {
  console.log(bar(pct));
}
~~~

### Acceptance criteria (extend the project)

1. Add a **CPU model** line (\`os.cpus()[0].model\`).
2. Run it with \`node --watch dashboard.js\` and watch it refresh as you edit.
3. Add a \`--json\` flag (read \`process.argv\`) that prints the report as JSON instead of the pretty banner.
4. Colourise the memory bar using \`util.styleText\` (preview of Module 12): green under 70%, red over 90%.

<details>
<summary>Hint for the --json flag</summary>

~~~js run
// Simulate: node dashboard.js --json
const argv = ["node", "dashboard.js", "--json"];
const wantsJson = argv.slice(2).includes("--json");

const report = { host: "ada-laptop", cpus: 8, node: "v24.2.0" };

if (wantsJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Pretty banner would print here");
}
~~~
</details>

## What you learned

- Key flags: \`--watch\` (auto-rerun), \`--env-file\` (native .env), \`--inspect\` (debug), \`--test\`, \`-e\`/\`-p\`.
- Modern Node replaced nodemon, dotenv, and others with **built-ins**.
- \`package.json\` \`"scripts"\` store your run commands; \`"type": "module"\` enables \`import\`.
- You built a real **system dashboard** combining \`process\`, \`os\`, and your Module 1 skills.

## Next steps

Module 3 complete! You understand the runtime and can drive it. Module 4 reveals the engine room — **the event loop** — the single concept that, once it clicks, makes all of Node's async behaviour obvious.
`);
