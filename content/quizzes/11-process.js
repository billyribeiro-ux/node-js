registerQuiz("11-argv-env", [
  {
    q: "Given the command `node server.js --port 3000`, at which index does `'--port'` appear in `process.argv`?",
    options: [
      "Index 0",
      "Index 1",
      "Index 2",
      "Index 3"
    ],
    answer: 2,
    explain: "`process.argv[0]` is the path to the node binary, `process.argv[1]` is the script path, and user-supplied arguments start at index 2. So `'--port'` is at index 2 and `'3000'` is at index 3."
  },
  {
    q: "A team member sets `PORT=4000` in the shell before running `node --env-file=.env server.js`, where `.env` contains `PORT=3000`. Which value will `process.env.PORT` have?",
    options: [
      "3000, because --env-file values override the shell environment",
      "4000, because the shell environment variable wins over values loaded by --env-file",
      "undefined, because conflicting values cancel each other out",
      "It depends on the operating system"
    ],
    answer: 1,
    explain: "`--env-file` loads values into `process.env` only for keys that are NOT already set in the environment. Shell environment variables take precedence. This follows the standard config-precedence model: shell env > file env > defaults."
  },
  {
    q: "Why should secrets like API keys never be passed as `--api-key=secret` command-line arguments?",
    options: [
      "Node does not support long flag names with values",
      "Command-line arguments appear in `ps aux` output, shell history, and log aggregators, exposing the secret to any user on the machine",
      "Argument values are limited to 256 characters, too short for most secrets",
      "The `--` prefix is reserved for Node.js internal flags"
    ],
    answer: 1,
    explain: "CLI arguments are visible to all users on the machine via `ps aux`, recorded in shell history files, and can appear in process listings and log aggregators. Use environment variables or secret files (via `--env-file`) for credentials instead."
  }
]);

registerResources("11-argv-env", [
  { title: "process.argv documentation", url: "https://nodejs.org/api/process.html#processargv" },
  { title: "process.env documentation", url: "https://nodejs.org/api/process.html#processenv" },
  { title: "node --env-file flag (Node 20.6+)", url: "https://nodejs.org/api/cli.html#--env-fileconfig" },
  { title: "util.parseArgs documentation", url: "https://nodejs.org/api/util.html#utilparseargsconfig" },
  { title: "The Twelve-Factor App — Config", url: "https://12factor.net/config" }
]);

registerQuiz("11-signals-shutdown", [
  {
    q: "What happens when you register `process.on('SIGTERM', fn)` and the process then receives SIGTERM?",
    options: [
      "Node runs `fn` and then automatically exits with code 0",
      "Node runs `fn` but does NOT automatically exit; your handler must call `process.exit()` explicitly",
      "Node runs `fn` and then waits 30 seconds before forcibly exiting",
      "Node emits a deprecation warning and exits with the default behaviour"
    ],
    answer: 1,
    explain: "Registering a signal handler disables the default action (immediate exit). You own the process lifecycle from that point on. Forgetting to call `process.exit()` at the end of your handler means the process will appear running but do nothing."
  },
  {
    q: "In a Kubernetes environment with a 30-second termination grace period, which signal does Kubernetes send first, and which follows if the pod does not exit in time?",
    options: [
      "SIGKILL first, then SIGTERM if the process ignores it",
      "SIGTERM first; if the process is still running after the grace period, Kubernetes sends SIGKILL",
      "SIGHUP first to reload config, then SIGTERM to shut down",
      "SIGINT first (same as Ctrl-C), then SIGTERM"
    ],
    answer: 1,
    explain: "Kubernetes sends SIGTERM to begin a graceful shutdown and waits for the configured grace period (default 30 s). If the pod has not exited by then, Kubernetes sends SIGKILL, which cannot be caught. Your shutdown must complete within the grace period."
  },
  {
    q: "Why is it important to race cleanup handlers against a timeout in a graceful shutdown manager?",
    options: [
      "To prevent the garbage collector from pausing the process during cleanup",
      "A cleanup handler that hangs (e.g., a DB that never acknowledges close) would block shutdown indefinitely, forcing the orchestrator to SIGKILL the process and lose the benefit of graceful shutdown",
      "To ensure cleanup handlers do not consume more than one CPU core",
      "Because `process.exit()` ignores pending promises unless a timeout is set"
    ],
    answer: 1,
    explain: "If a cleanup handler stalls, the process never exits cleanly and the orchestrator's deadline will trigger SIGKILL anyway. A `Promise.race([cleanup, timeout])` ensures the process exits within a defined window, with a non-zero code if cleanup failed."
  }
]);

registerResources("11-signals-shutdown", [
  { title: "Node.js process signals", url: "https://nodejs.org/api/process.html#signal-events" },
  { title: "process.on('SIGTERM') example", url: "https://nodejs.org/api/process.html#processonsignal" },
  { title: "http.Server.close() documentation", url: "https://nodejs.org/api/http.html#serverclosecallback" },
  { title: "Kubernetes pod termination lifecycle", url: "https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination" },
  { title: "POSIX signals reference", url: "https://man7.org/linux/man-pages/man7/signal.7.html" }
]);

registerQuiz("11-crash-handling", [
  {
    q: "Why is it dangerous to catch `uncaughtException`, log the error, and then continue running the process as if nothing happened?",
    options: [
      "It causes performance degradation because the V8 engine disables JIT compilation after an uncaught exception",
      "After an uncaught exception the application is in an undefined state; heap objects may be corrupt and continuing risks data corruption and unpredictable behavior",
      "It prevents future exceptions from being caught because the handler can only fire once",
      "Node will automatically downgrade to single-threaded mode after an uncaught exception"
    ],
    answer: 1,
    explain: "Node's documentation explicitly states that after `uncaughtException` the application is in an undefined state. Closures, pending I/O, and in-flight transactions may reference corrupted memory. The safe response is always: log structured diagnostics, attempt brief cleanup, then exit."
  },
  {
    q: "What is the difference between `process.exit(1)` and `process.exitCode = 1`?",
    options: [
      "They are identical; `process.exitCode` is just a shorthand for `process.exit()`",
      "`process.exit(1)` halts the event loop immediately; `process.exitCode = 1` sets the code that will be used when the event loop drains naturally",
      "`process.exit(1)` is synchronous; `process.exitCode = 1` is asynchronous and waits for all I/O",
      "`process.exitCode` only works in test environments; `process.exit()` works everywhere"
    ],
    answer: 1,
    explain: "`process.exit()` stops the event loop right away — no more callbacks, timers, or I/O run. `process.exitCode = N` is a soft signal: the process continues until the event loop empties, then exits with that code. Use `process.exit()` in crash handlers and `process.exitCode` in CLIs that want to let pending work finish."
  },
  {
    q: "What exit code should a process return when it is terminated by SIGTERM (signal 15), following POSIX convention?",
    options: [
      "0 — because SIGTERM is an expected, clean shutdown",
      "1 — the generic error code for any non-zero exit",
      "143 — because the convention is 128 + signal number (128 + 15 = 143)",
      "15 — the raw signal number"
    ],
    answer: 2,
    explain: "The POSIX convention for a process terminated by a signal is exit code 128 + N where N is the signal number. SIGTERM is signal 15, so the conventional exit code is 143. SIGINT (signal 2) maps to 130. These codes let shells and orchestrators distinguish signal-terminated exits from normal failures."
  }
]);

registerResources("11-crash-handling", [
  { title: "process.on('uncaughtException')", url: "https://nodejs.org/api/process.html#event-uncaughtexception" },
  { title: "process.on('unhandledRejection')", url: "https://nodejs.org/api/process.html#event-unhandledrejection" },
  { title: "process.exit() documentation", url: "https://nodejs.org/api/process.html#processexitcode" },
  { title: "process.exitCode documentation", url: "https://nodejs.org/api/process.html#processexitcode_1" },
  { title: "POSIX exit status conventions", url: "https://man7.org/linux/man-pages/man3/exit.3.html" }
]);
