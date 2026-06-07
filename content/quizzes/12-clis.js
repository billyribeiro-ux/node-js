registerQuiz("12-parseargs", [
  {
    q: "What does 'util.parseArgs' return when called with a valid configuration?",
    options: [
      "An array of raw argument strings",
      "An object with 'values' and 'positionals' properties",
      "A Map of flag names to their values",
      "A Promise that resolves with parsed arguments"
    ],
    answer: 1,
    explain: "'util.parseArgs' always returns '{ values, positionals }'. 'values' holds the parsed flags and options, and 'positionals' holds bare arguments that are not associated with any flag."
  },
  {
    q: "By default, what happens when 'util.parseArgs' encounters a bare positional argument like 'build' in 'node tool.js build --minify'?",
    options: [
      "It silently ignores the positional",
      "It treats it as the value for the next flag",
      "It throws an error",
      "It stores it under the key 'positionals' automatically"
    ],
    answer: 2,
    explain: "Unless 'allowPositionals: true' is set in the options, 'util.parseArgs' throws an error when it encounters a bare positional. This is deliberate behavior to prevent silently swallowing typos."
  },
  {
    q: "When should you reach for 'commander' or 'yargs' instead of 'util.parseArgs'?",
    options: [
      "Whenever you need to parse '--flag' style options",
      "When you need zero-dependency argument parsing",
      "When your CLI needs sub-commands, auto-generated help, or rich validation",
      "When you want to parse short aliases like '-v'"
    ],
    answer: 2,
    explain: "'util.parseArgs' does not support sub-commands (like 'git commit'), auto-generated help pages, or rich input validation. Reach for 'commander' or 'yargs' when your CLI requires those features."
  }
]);

registerResources("12-parseargs", [
  { title: "Node.js docs: util.parseArgs", url: "https://nodejs.org/api/util.html#utilparseargsconfig" },
  { title: "Node.js docs: util module overview", url: "https://nodejs.org/api/util.html" },
  { title: "commander.js on npm", url: "https://www.npmjs.com/package/commander" },
  { title: "yargs documentation", url: "https://yargs.js.org/" },
  { title: "POSIX argument conventions", url: "https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html" }
]);

registerQuiz("12-interactive-clis", [
  {
    q: "Which Node.js built-in function adds ANSI color to terminal output and automatically disables colors when stdout is piped to a file?",
    options: [
      "process.stdout.color()",
      "console.color()",
      "util.styleText()",
      "readline.setColor()"
    ],
    answer: 2,
    explain: "'util.styleText(format, text)' was added in Node 20. It checks 'process.stdout.hasColors()' and respects the 'NO_COLOR' environment variable, so it returns plain text when color is not supported."
  },
  {
    q: "What is the correct way to read a user prompt non-blockingly from stdin in Node.js?",
    options: [
      "fs.readSync(0, buffer, 0, buffer.length)",
      "await readline.createInterface({ input, output }).question(prompt)",
      "process.stdin.read()",
      "console.input(prompt)"
    ],
    answer: 1,
    explain: "The 'readline/promises' module provides 'await rl.question(prompt)' which is non-blocking and works correctly with Node's event loop. Using 'fs.readSync' on stdin blocks the process and prevents signals from being delivered."
  },
  {
    q: "In a CLI config loading system, which source should take the highest priority?",
    options: [
      "Built-in defaults",
      "User config file (~/.toolrc.json)",
      "Project config file (tool.config.json)",
      "CLI flags passed at runtime"
    ],
    answer: 3,
    explain: "The standard precedence order is: CLI flags > environment variables > project config file > user config file > built-in defaults. CLI flags win because they represent the user's explicit one-off override for that invocation."
  }
]);

registerResources("12-interactive-clis", [
  { title: "Node.js docs: util.styleText", url: "https://nodejs.org/api/util.html#utilstyletextformat-text-options" },
  { title: "Node.js docs: readline/promises", url: "https://nodejs.org/api/readline.html#promises-api" },
  { title: "Node.js docs: process.stdout", url: "https://nodejs.org/api/process.html#processstdout" },
  { title: "NO_COLOR standard", url: "https://no-color.org/" },
  { title: "ora spinner library", url: "https://github.com/sindresorhus/ora" }
]);

registerQuiz("12-sea", [
  {
    q: "What tool is used to inject the application blob into the Node.js binary when building a Single Executable Application?",
    options: [
      "esbuild",
      "nexe",
      "postject",
      "rollup"
    ],
    answer: 2,
    explain: "'postject' embeds arbitrary payloads into platform-native binaries (PE on Windows, Mach-O on macOS, ELF on Linux). It injects the SEA blob into the copied Node binary using the 'NODE_SEA_BLOB' section and a sentinel fuse string."
  },
  {
    q: "Why must you copy the Node binary before injecting your SEA blob rather than modifying the original?",
    options: [
      "The original binary is read-only on all platforms",
      "Corrupting the running binary would break your entire Node installation",
      "postject only works on copies, not originals",
      "The copy step applies code-signing automatically"
    ],
    answer: 1,
    explain: "You must copy the Node binary first because modifying the live 'node' binary on your system risks corrupting your entire Node installation. The copy preserves a safe starting point and the original remains untouched."
  },
  {
    q: "Which API from the built-in 'node:sea' module lets you detect whether code is running inside a Single Executable Application?",
    options: [
      "process.isSea()",
      "sea.isEmbedded()",
      "sea.isSea()",
      "process.env.NODE_SEA"
    ],
    answer: 2,
    explain: "The 'node:sea' module exports 'isSea()' which returns 'true' when the current process is running as a Single Executable Application. It also exports 'getAsset()' and 'getAssetAsBlob()' for retrieving embedded data files."
  }
]);

registerResources("12-sea", [
  { title: "Node.js docs: Single Executable Applications", url: "https://nodejs.org/api/single-executable-applications.html" },
  { title: "Node.js docs: node:sea module", url: "https://nodejs.org/api/sea.html" },
  { title: "postject on npm", url: "https://www.npmjs.com/package/postject" },
  { title: "esbuild bundler documentation", url: "https://esbuild.github.io/" },
  { title: "Node.js docs: package.json bin field", url: "https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin" }
]);
