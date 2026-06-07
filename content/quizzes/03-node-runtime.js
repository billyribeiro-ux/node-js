registerQuiz("03-what-is-node", [
  {
    q: "What are the three main components that Node.js bundles together?",
    options: [
      "Chrome, Blink, and V8",
      "V8, libuv, and core modules",
      "npm, nvm, and the REPL",
      "Express, Fastify, and Hono"
    ],
    answer: 1,
    explain: "Node bundles V8 (Google's JavaScript engine that compiles JS to machine code), libuv (a C library providing the event loop and async I/O), and core modules (built-in JS + C++ APIs like fs, http, and crypto). Bindings glue JavaScript to the C/C++ layer."
  },
  {
    q: "Why is a long synchronous for-loop dangerous in a Node.js web server?",
    options: [
      "It causes the process to spawn extra threads",
      "It triggers an unhandledRejection warning",
      "It blocks the single main thread, so no requests, timers, or callbacks can run until it finishes",
      "It causes memory to grow without bounds"
    ],
    answer: 2,
    explain: "Node's JavaScript runs on a single main thread. A long synchronous loop occupies that thread entirely — no other request is handled, no timer fires, and no callback runs until the loop completes. This can freeze the entire server for every connected user."
  },
  {
    q: "What kind of workload is Node.js POORLY suited for on its main thread by default?",
    options: [
      "Handling thousands of concurrent HTTP connections",
      "Streaming large files to many clients simultaneously",
      "CPU-bound computation such as video transcoding or heavy number-crunching",
      "Proxying requests between services"
    ],
    answer: 2,
    explain: "Node excels at I/O-bound work (APIs, real-time apps, proxies) where it spends time waiting rather than computing. CPU-bound work like video encoding or large image processing blocks the main thread. The escape hatches are worker threads, native addons, or WebAssembly."
  }
]);

registerResources("03-what-is-node", [
  { title: "Node.js: Introduction to Node.js", url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs" },
  { title: "libuv Official Documentation", url: "https://libuv.org" },
  { title: "V8 JavaScript Engine", url: "https://v8.dev" },
  { title: "Node.js: Don't Block the Event Loop", url: "https://nodejs.org/en/guides/dont-block-the-event-loop" }
]);

registerQuiz("03-globals-and-process", [
  {
    q: "In a Node.js program, which object is the cross-environment standard name for the global object (works in both Node and browsers)?",
    options: [
      "window",
      "global",
      "globalThis",
      "self"
    ],
    answer: 2,
    explain: "'globalThis' is the standardised cross-environment global object. Browsers use 'window' and Node historically used 'global', but 'globalThis' works in both. Modern Node deliberately aligns with web standards, making code more portable."
  },
  {
    q: "At which index of 'process.argv' do your own command-line arguments start?",
    options: [
      "Index 0",
      "Index 1",
      "Index 2",
      "Index 3"
    ],
    answer: 2,
    explain: "process.argv[0] is the path to the Node binary, process.argv[1] is the path to your script, and your actual arguments begin at index 2. You typically get them with 'process.argv.slice(2)'."
  },
  {
    q: "Why should you prefer setting 'process.exitCode = 1' over calling 'process.exit(1)' in most situations?",
    options: [
      "process.exitCode works cross-platform while exit() is Unix-only",
      "process.exit() kills the process immediately, potentially cutting off pending writes or graceful cleanup; process.exitCode lets the program finish naturally",
      "process.exitCode is faster because it skips cleanup handlers",
      "process.exit() throws an exception that must be caught"
    ],
    answer: 1,
    explain: "process.exit() terminates the process immediately, which can truncate log output, abort in-flight writes, or skip teardown logic. Setting process.exitCode marks the intent to exit with a non-zero code while allowing the program to finish all pending work gracefully."
  }
]);

registerResources("03-globals-and-process", [
  { title: "Node.js: process Object Reference", url: "https://nodejs.org/api/process.html" },
  { title: "Node.js: Global Objects", url: "https://nodejs.org/api/globals.html" },
  { title: "MDN: globalThis", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis" },
  { title: "Node.js: --env-file flag", url: "https://nodejs.org/api/cli.html#--env-fileconfig" }
]);

registerQuiz("03-running-node", [
  {
    q: "Which Node.js built-in flag, introduced in modern Node, replaces the need for the 'dotenv' npm package?",
    options: [
      "--require dotenv",
      "--env-file=.env",
      "--load-env",
      "--dotenv"
    ],
    answer: 1,
    explain: "'node --env-file=.env app.js' reads the specified .env file and populates process.env natively, without installing the 'dotenv' package. This is one of several third-party tools that modern Node has absorbed as built-ins."
  },
  {
    q: "What does 'node --inspect app.js' enable?",
    options: [
      "It runs the file and prints a syntax check report",
      "It enables the Chrome DevTools debugger so you can set breakpoints and step through code",
      "It runs the built-in test runner",
      "It generates a performance profile automatically"
    ],
    answer: 1,
    explain: "'--inspect' starts Node with the V8 inspector protocol active. You can then open chrome://inspect in Chrome (or connect your editor's debugger) to set breakpoints, inspect variables, and step through server-side code using the same DevTools interface as the browser."
  },
  {
    q: "What does adding '\"type\": \"module\"' to package.json accomplish?",
    options: [
      "It marks the package as public on npm",
      "It tells Node to treat all .js files in the package as ES Modules, enabling import/export",
      "It enables TypeScript support in the project",
      "It sets the package version to the latest module specification"
    ],
    answer: 1,
    explain: "Without 'type', Node treats .js files as CommonJS. Setting '\"type\": \"module\"' makes Node interpret all .js files as ES Modules so you can use import/export syntax. Individual files can still override this with .cjs or .mjs extensions."
  }
]);

registerResources("03-running-node", [
  { title: "Node.js: CLI Options Reference", url: "https://nodejs.org/api/cli.html" },
  { title: "Node.js: --watch mode", url: "https://nodejs.org/api/cli.html#--watch" },
  { title: "Node.js: Debugging Guide", url: "https://nodejs.org/en/learn/getting-started/debugging" },
  { title: "Node.js: os Module", url: "https://nodejs.org/api/os.html" }
]);
