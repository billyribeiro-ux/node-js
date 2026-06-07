registerQuiz("07-reading-writing", [
  {
    q: "Which import path gives you the promise-based `readFile` function in modern Node?",
    options: [
      "\"node:fs\"",
      "\"node:fs/promises\"",
      "\"node:fs/async\"",
      "\"node:promises\""
    ],
    answer: 1,
    explain: "The promise-based fs API lives at `node:fs/promises`. Importing from `node:fs` gives you the callback-based version, while `fs.promises` is a property on the callback module — but the direct `node:fs/promises` import is cleaner."
  },
  {
    q: "What flag value should you pass to `writeFile` to make it fail if the file already exists?",
    options: [
      "\"r+\"",
      "\"a\"",
      "\"wx\"",
      "\"w!\""
    ],
    answer: 2,
    explain: "The `wx` flag opens for writing but throws EEXIST if the file already exists. This is the right choice for 'create-once' logic where overwriting is not acceptable."
  },
  {
    q: "When is using `readFileSync` acceptable in a Node.js server application?",
    options: [
      "Inside an HTTP request handler when the file is small",
      "During the server startup phase before any requests are accepted",
      "Whenever the file is under 1 MB in size",
      "It is never acceptable in server applications"
    ],
    answer: 1,
    explain: "Synchronous I/O blocks the entire event loop. Using it during startup — before the server accepts requests — is a deliberate tradeoff: the server is not yet handling traffic, so blocking is acceptable. Avoid it in request handlers."
  }
]);

registerResources("07-reading-writing", [
  { title: "Node.js fs/promises API", url: "https://nodejs.org/api/fs.html#promises-api" },
  { title: "fs.readFile documentation", url: "https://nodejs.org/api/fs.html#fsreadfilepath-options-callback" },
  { title: "fs.writeFile documentation", url: "https://nodejs.org/api/fs.html#fswritefilefile-data-options-callback" },
  { title: "Node.js Buffer encodings", url: "https://nodejs.org/api/buffer.html#buffers-and-character-encodings" },
  { title: "File system flags reference", url: "https://nodejs.org/api/fs.html#file-system-flags" }
]);

registerQuiz("07-paths-and-dirs", [
  {
    q: "What is the key difference between `path.join()` and `path.resolve()`?",
    options: [
      "`path.join` uses the OS separator while `path.resolve` always uses forward slashes",
      "`path.resolve` always returns an absolute path anchored to cwd; `path.join` does not anchor to cwd",
      "`path.join` normalises `..` segments but `path.resolve` does not",
      "`path.resolve` only works on Linux while `path.join` is cross-platform"
    ],
    answer: 1,
    explain: "`path.resolve` walks segments right-to-left and, if no absolute segment is found, anchors the result to the process current working directory, guaranteeing an absolute path. `path.join` just concatenates and normalises without anchoring."
  },
  {
    q: "Which option makes `fs.mkdir` create all intermediate directories and NOT throw if the directory already exists?",
    options: [
      "{ force: true }",
      "{ mkdirp: true }",
      "{ recursive: true }",
      "{ parents: true }"
    ],
    answer: 2,
    explain: "`{ recursive: true }` makes `fs.mkdir` behave like `mkdir -p`: it creates any missing intermediate directories and is a no-op if the target directory already exists."
  },
  {
    q: "In an ES Module file (`.mjs` or with `\"type\": \"module\"`), how do you get the current file's directory path?",
    options: [
      "__dirname",
      "process.cwd()",
      "import.meta.dirname (Node 21.2+) or new URL(\".\", import.meta.url).pathname",
      "path.dirname(process.argv[1])"
    ],
    answer: 2,
    explain: "`__dirname` is a CommonJS-only global and is undefined in ES Modules. The replacement is `import.meta.dirname` (Node 21.2+), or for older versions, `new URL(\".\", import.meta.url).pathname`."
  }
]);

registerResources("07-paths-and-dirs", [
  { title: "Node.js path module API", url: "https://nodejs.org/api/path.html" },
  { title: "fs.mkdir documentation", url: "https://nodejs.org/api/fs.html#fsmkdirpath-options-callback" },
  { title: "fs.readdir documentation", url: "https://nodejs.org/api/fs.html#fsreaddirpath-options-callback" },
  { title: "fs.glob documentation (Node 22)", url: "https://nodejs.org/api/fs.html#fsglobpattern-options-callback" },
  { title: "import.meta.dirname (Node 21.2+)", url: "https://nodejs.org/api/esm.html#importmetadirname" }
]);

registerQuiz("07-watching", [
  {
    q: "Why should you always debounce `fs.watch` events rather than reacting to each one immediately?",
    options: [
      "fs.watch fires events in the wrong order and debouncing reorders them",
      "A single editor save can produce multiple rapid events; debouncing collapses them into one action",
      "Without debouncing, fs.watch can miss events on Linux",
      "fs.watch has a built-in delay that causes events to arrive in batches"
    ],
    answer: 1,
    explain: "Editors often write a temp file and then rename it, or update metadata separately, causing 2-6 events per logical save. Without debouncing, your rebuild or reload runs multiple times for a single keypress."
  },
  {
    q: "When is `fs.watchFile` preferred over `fs.watch`?",
    options: [
      "When you need recursive directory watching on macOS",
      "When watching files on network drives or Docker volume mounts where OS notifications may not work",
      "When you need the lowest possible latency between a change and the callback",
      "When you want to watch more than 10 files simultaneously"
    ],
    answer: 1,
    explain: "`fs.watchFile` uses polling (checking `mtime`/`size` on a timer) which works on network filesystems and Docker volumes where inotify/FSEvents events are silently dropped. `fs.watch` is faster but may miss events on such mounts."
  },
  {
    q: "What does the `node --watch` flag do, and when is it most useful?",
    options: [
      "It enables fs.watch on all files in the project and logs every change to stdout",
      "It automatically restarts the Node process when any of its loaded modules change, without writing any watcher code",
      "It watches the process memory and restarts if it exceeds a threshold",
      "It replaces `nodemon` and requires a configuration file to specify which files to watch"
    ],
    answer: 1,
    explain: "`node --watch` (available since Node 18) monitors all files loaded by the process and automatically restarts it on changes. It requires no additional libraries and is the quickest way to get live reload during development."
  }
]);

registerResources("07-watching", [
  { title: "fs.watch documentation", url: "https://nodejs.org/api/fs.html#fswatchfilename-options-listener" },
  { title: "fs.watchFile documentation", url: "https://nodejs.org/api/fs.html#fswatchfilefilename-options-listener" },
  { title: "node --watch flag (Node 18)", url: "https://nodejs.org/api/cli.html#--watch" },
  { title: "node --watch-path flag", url: "https://nodejs.org/api/cli.html#--watch-path" }
]);

registerQuiz("07-streaming-files", [
  {
    q: "Why is `fs.readFile` dangerous for large files in a server handling concurrent requests?",
    options: [
      "It opens the file in exclusive mode, preventing other requests from reading it",
      "It loads the entire file into RAM before your code can access a single byte, risking out-of-memory crashes under load",
      "It is not async-safe and can corrupt the event loop when called concurrently",
      "It is deprecated and may be removed in future Node versions"
    ],
    answer: 1,
    explain: "`fs.readFile` reads the whole file into a Buffer in the heap. For a 2 GB log file that means 2 GB of RAM consumed per call. On a server with concurrent requests this quickly exhausts available memory, whereas streams keep memory near the chunk size (default 64 KB)."
  },
  {
    q: "What is the recommended way to connect `createReadStream` to `createWriteStream` so that errors are propagated and streams are cleaned up on failure?",
    options: [
      "createReadStream().pipe(createWriteStream())",
      "Using `stream.pipeline()` from `node:stream/promises`",
      "Manually listening to the `data` event and calling `writable.write()`",
      "Using `fs.copyFile()` which streams internally"
    ],
    answer: 1,
    explain: "`stream.pipeline()` from `node:stream/promises` automatically propagates errors from any stage and destroys all streams in the chain on failure, preventing file descriptor leaks. `.pipe()` does not propagate errors."
  },
  {
    q: "Why should you use `readline.createInterface` (or `for await...of` on a readline interface) rather than `createReadStream` + `data` events for line-by-line text processing?",
    options: [
      "readline is faster than raw stream events for text files",
      "Chunks from `createReadStream` do not respect line boundaries, so a single logical line may be split across two chunks",
      "readline automatically handles UTF-8 multi-byte characters that `createReadStream` cannot",
      "readline buffers the whole file before emitting lines, making parsing simpler"
    ],
    answer: 1,
    explain: "Each chunk emitted by `createReadStream` is a fixed-size block of bytes that can end in the middle of a line. `readline.createInterface` buffers partial lines internally and emits complete lines on the `line` event, solving the chunk-boundary problem."
  }
]);

registerResources("07-streaming-files", [
  { title: "fs.createReadStream documentation", url: "https://nodejs.org/api/fs.html#fscreatereadstreampath-options" },
  { title: "fs.createWriteStream documentation", url: "https://nodejs.org/api/fs.html#fscreatewritestreampath-options" },
  { title: "stream.pipeline (promises)", url: "https://nodejs.org/api/stream.html#streampipelinestreams-callback" },
  { title: "readline module documentation", url: "https://nodejs.org/api/readline.html" },
  { title: "Node.js streams overview", url: "https://nodejs.org/api/stream.html#stream" }
]);
