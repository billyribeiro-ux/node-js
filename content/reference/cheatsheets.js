// The Ultimate Node.js Course — Core API Cheat-Sheets
// One registerCheatsheet() call per module.

registerCheatsheet({
  id: "fs",
  title: "node:fs — Filesystem",
  lesson: "07-reading-writing",
  blurb: "Read, write, and inspect files and directories with the promise-based fs API.",
  groups: [
    { name: "Reading", items: [
      { sig: "await readFile(path, 'utf8')", desc: "Read an entire file as a UTF-8 string" },
      { sig: "await readFile(path)", desc: "Read a file as a raw Buffer" },
      { sig: "createReadStream(path, { encoding: 'utf8' })", desc: "Stream a large file in chunks" },
      { sig: "await readdir(dir, { withFileTypes: true })", desc: "List directory entries as Dirent objects" }
    ]},
    { name: "Writing", items: [
      { sig: "await writeFile(path, data, 'utf8')", desc: "Write (or replace) a file with a string or Buffer" },
      { sig: "await appendFile(path, data)", desc: "Append data to a file, creating it if needed" },
      { sig: "createWriteStream(path)", desc: "Stream large output to a file" },
      { sig: "await mkdir(dir, { recursive: true })", desc: "Create a directory and all missing parents" }
    ]},
    { name: "Metadata & other", items: [
      { sig: "await stat(path)", desc: "Get file metadata (size, mtime, isDirectory, …)" },
      { sig: "await rename(oldPath, newPath)", desc: "Move or rename a file or directory" },
      { sig: "await rm(path, { recursive: true, force: true })", desc: "Delete a file or directory tree" },
      { sig: "await copyFile(src, dest)", desc: "Copy a file, overwriting dest by default" }
    ]},
    { name: "Watching", items: [
      { sig: "watch(path, { recursive: true }, callback)", desc: "Watch a file or directory for changes (non-recursive on Linux)" },
      { sig: "const watcher = watch(filename); for await (const e of watcher)", desc: "Async-iterate FS events" }
    ]}
  ]
});

registerCheatsheet({
  id: "path",
  title: "node:path — Paths",
  lesson: "07-paths-and-dirs",
  blurb: "Compose, parse, and normalise file-system paths in a cross-platform way.",
  groups: [
    { name: "Composing", items: [
      { sig: "path.join('dir', 'sub', 'file.txt')", desc: "Join segments with the OS separator, normalising slashes" },
      { sig: "path.resolve('relative/path')", desc: "Resolve to an absolute path from cwd" },
      { sig: "new URL('./file.txt', import.meta.url).pathname", desc: "ESM-safe path relative to the current module" }
    ]},
    { name: "Parsing", items: [
      { sig: "path.dirname('/foo/bar/baz.js')", desc: "Return the directory portion of a path" },
      { sig: "path.basename('/foo/bar/baz.js', '.js')", desc: "Return the filename, optionally stripping an extension" },
      { sig: "path.extname('file.tar.gz')", desc: "Return the last extension including the dot" },
      { sig: "path.parse('/home/user/file.txt')", desc: "Return { root, dir, base, ext, name } object" }
    ]},
    { name: "Utilities", items: [
      { sig: "path.normalize('foo//bar/../baz')", desc: "Resolve . and .. segments, collapse duplicate separators" },
      { sig: "path.relative('/a/b', '/a/c/d')", desc: "Compute a relative path between two absolute paths" },
      { sig: "path.isAbsolute(p)", desc: "Return true when the path starts from the root" }
    ]}
  ]
});

registerCheatsheet({
  id: "process",
  title: "process — Process & env",
  lesson: "11-argv-env",
  blurb: "Inspect and control the running Node.js process, environment variables, and arguments.",
  groups: [
    { name: "Environment & args", items: [
      { sig: "process.env.MY_VAR", desc: "Read an environment variable (string or undefined)" },
      { sig: "process.argv", desc: "Array of [node, script, ...userArgs] passed on the command line" },
      { sig: "process.cwd()", desc: "Return the current working directory" },
      { sig: "process.chdir(dir)", desc: "Change the working directory of the process" }
    ]},
    { name: "Lifecycle", items: [
      { sig: "process.exit(code)", desc: "Terminate immediately with a numeric exit code (0 = success)" },
      { sig: "process.on('exit', cb)", desc: "Run a synchronous callback just before exit" },
      { sig: "process.on('uncaughtException', cb)", desc: "Last-resort handler for uncaught synchronous errors" },
      { sig: "process.on('unhandledRejection', cb)", desc: "Last-resort handler for unhandled promise rejections" }
    ]},
    { name: "Streams & info", items: [
      { sig: "process.stdin / process.stdout / process.stderr", desc: "Built-in readable/writable streams for stdio" },
      { sig: "process.pid", desc: "The process ID of the current Node.js process" },
      { sig: "process.version", desc: "Node.js version string, e.g. 'v24.0.0'" },
      { sig: "process.memoryUsage()", desc: "Object with rss, heapTotal, heapUsed, external byte counts" }
    ]}
  ]
});

registerCheatsheet({
  id: "os",
  title: "node:os — OS info",
  lesson: "03-globals-and-process",
  blurb: "Query operating-system information such as CPU, memory, network interfaces, and paths.",
  groups: [
    { name: "System info", items: [
      { sig: "os.platform()", desc: "Return the OS platform: 'linux', 'darwin', 'win32', …" },
      { sig: "os.arch()", desc: "Return the CPU architecture: 'x64', 'arm64', …" },
      { sig: "os.release()", desc: "Return the kernel version string" },
      { sig: "os.type()", desc: "Return 'Linux', 'Darwin', or 'Windows_NT'" }
    ]},
    { name: "Resources", items: [
      { sig: "os.cpus()", desc: "Array of CPU core objects with model, speed, and times" },
      { sig: "os.totalmem()", desc: "Total system RAM in bytes" },
      { sig: "os.freemem()", desc: "Available system RAM in bytes" },
      { sig: "os.loadavg()", desc: "1, 5, and 15-minute load averages (Unix only)" }
    ]},
    { name: "Paths & user", items: [
      { sig: "os.homedir()", desc: "Current user's home directory" },
      { sig: "os.tmpdir()", desc: "Default directory for temporary files" },
      { sig: "os.hostname()", desc: "Network hostname of the machine" },
      { sig: "os.EOL", desc: "OS-appropriate line ending ('\\n' on Unix, '\\r\\n' on Windows)" }
    ]}
  ]
});

registerCheatsheet({
  id: "events",
  title: "node:events — EventEmitter",
  lesson: "09-eventemitter",
  blurb: "Publish/subscribe event system that underpins most of Node's built-in classes.",
  groups: [
    { name: "Emitting & listening", items: [
      { sig: "emitter.on('event', listener)", desc: "Register a persistent listener for an event" },
      { sig: "emitter.once('event', listener)", desc: "Register a one-shot listener that auto-removes after firing" },
      { sig: "emitter.emit('event', ...args)", desc: "Synchronously invoke all listeners for the event" },
      { sig: "emitter.off('event', listener)", desc: "Remove a specific listener" }
    ]},
    { name: "Introspection", items: [
      { sig: "emitter.listenerCount('event')", desc: "Return the number of listeners registered for an event" },
      { sig: "emitter.eventNames()", desc: "Return an array of event names that have listeners" },
      { sig: "emitter.setMaxListeners(n)", desc: "Raise or lower the warning threshold (default 10)" }
    ]},
    { name: "Advanced", items: [
      { sig: "EventEmitter.once(emitter, 'event')", desc: "Return a promise that resolves on the next event emission" },
      { sig: "on(emitter, 'data')", desc: "Return an async-iterable of events (from events.on)" },
      { sig: "class MyEmitter extends EventEmitter {}", desc: "Extend EventEmitter to build typed event buses" }
    ]}
  ]
});

registerCheatsheet({
  id: "stream",
  title: "node:stream — Streams",
  lesson: "10-stream-types",
  blurb: "Process data incrementally without loading it all into memory at once.",
  groups: [
    { name: "Pipeline & piping", items: [
      { sig: "await pipeline(readable, transform, writable)", desc: "Pipe streams together and propagate errors automatically" },
      { sig: "readable.pipe(writable)", desc: "Forward data from a readable to a writable (no error propagation)" },
      { sig: "Readable.from(iterable)", desc: "Create a readable stream from any sync or async iterable" }
    ]},
    { name: "Reading", items: [
      { sig: "for await (const chunk of readable)", desc: "Consume a readable stream with async iteration" },
      { sig: "readable.setEncoding('utf8')", desc: "Decode chunks as strings automatically" },
      { sig: "readable.read(n)", desc: "Pull up to n bytes in paused mode" }
    ]},
    { name: "Writing", items: [
      { sig: "writable.write(chunk, cb)", desc: "Write a chunk; returns false when the buffer is full" },
      { sig: "await finished(writable)", desc: "Promise that resolves when the stream finishes or rejects on error" },
      { sig: "writable.end(data)", desc: "Signal no more data and optionally write a final chunk" }
    ]},
    { name: "Transform", items: [
      { sig: "new Transform({ transform(chunk, enc, cb) { cb(null, out) } })", desc: "Create a duplex stream that converts input to output" },
      { sig: "zlib.createGzip()", desc: "Built-in Transform that compresses data with gzip" }
    ]}
  ]
});

registerCheatsheet({
  id: "buffer",
  title: "Buffer & TypedArrays",
  lesson: "08-buffers-basics",
  blurb: "Work with raw binary data using Node's Buffer class and the Web-standard TypedArray family.",
  groups: [
    { name: "Creating Buffers", items: [
      { sig: "Buffer.from('hello', 'utf8')", desc: "Encode a string to a Buffer using the given encoding" },
      { sig: "Buffer.from(arrayBuffer)", desc: "Wrap an existing ArrayBuffer without copying" },
      { sig: "Buffer.alloc(n)", desc: "Allocate a zero-filled Buffer of n bytes (safe)" },
      { sig: "Buffer.concat([a, b])", desc: "Concatenate multiple Buffers into one" }
    ]},
    { name: "Converting", items: [
      { sig: "buf.toString('utf8')", desc: "Decode a Buffer to a string" },
      { sig: "buf.toString('base64')", desc: "Encode binary data as a base64 string" },
      { sig: "buf.toString('hex')", desc: "Encode binary data as a lowercase hex string" },
      { sig: "buf.toJSON()", desc: "Return a { type: 'Buffer', data: [...] } representation" }
    ]},
    { name: "TypedArrays", items: [
      { sig: "new Uint8Array(16)", desc: "Fixed-length unsigned-byte view over an ArrayBuffer" },
      { sig: "new DataView(buffer)", desc: "Read/write arbitrary numeric types at any byte offset" },
      { sig: "Buffer.isBuffer(val)", desc: "Return true when val is a Buffer (which is also a Uint8Array)" }
    ]}
  ]
});

registerCheatsheet({
  id: "http",
  title: "node:http — HTTP",
  lesson: "14-http-server",
  blurb: "Create HTTP servers and make low-level outgoing requests with the built-in http/https modules.",
  groups: [
    { name: "Server", items: [
      { sig: "http.createServer((req, res) => { … }).listen(3000)", desc: "Create and start an HTTP server" },
      { sig: "res.writeHead(200, { 'Content-Type': 'application/json' })", desc: "Write status code and response headers" },
      { sig: "res.end(JSON.stringify(data))", desc: "Send the response body and finalise the response" },
      { sig: "req.method / req.url / req.headers", desc: "Inspect the incoming method, path, and headers" }
    ]},
    { name: "Routing & body", items: [
      { sig: "const body = await text(req)", desc: "Collect the full request body as a string (from node:stream/consumers)" },
      { sig: "const data = await json(req)", desc: "Parse the request body as JSON" },
      { sig: "if (req.url === '/api' && req.method === 'POST')", desc: "Simple manual routing by URL and method" }
    ]},
    { name: "Outgoing requests", items: [
      { sig: "http.get(url, cb)", desc: "Make a simple GET request (low-level; prefer fetch)" },
      { sig: "const req = http.request(options, cb); req.end()", desc: "Make a generic outgoing request with full control" }
    ]}
  ]
});

registerCheatsheet({
  id: "fetch",
  title: "fetch & undici",
  lesson: "14-fetch-undici",
  blurb: "Make HTTP requests with the native WHATWG Fetch API built into Node 24, or the undici library for advanced use.",
  groups: [
    { name: "Basic fetch", items: [
      { sig: "const res = await fetch(url)", desc: "Perform a GET request; returns a Response object" },
      { sig: "const data = await res.json()", desc: "Parse the response body as JSON" },
      { sig: "const text = await res.text()", desc: "Get the response body as a string" },
      { sig: "res.ok / res.status / res.headers", desc: "Check success, status code, and response headers" }
    ]},
    { name: "Sending data", items: [
      { sig: "fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })", desc: "POST JSON to an endpoint" },
      { sig: "fetch(url, { method: 'POST', body: new FormData() })", desc: "Upload multipart form data" },
      { sig: "fetch(url, { signal: AbortSignal.timeout(5000) })", desc: "Cancel a fetch automatically after a timeout" }
    ]},
    { name: "undici extras", items: [
      { sig: "import { request } from 'undici'", desc: "Import undici's streaming-first request function" },
      { sig: "const { body } = await request(url); for await (const chunk of body)", desc: "Stream a response body with async iteration" },
      { sig: "new Pool(url)", desc: "Create a connection pool for high-throughput requests to one origin" }
    ]}
  ]
});

registerCheatsheet({
  id: "crypto",
  title: "node:crypto",
  lesson: "20-password-hashing",
  blurb: "Hash data, derive keys, generate random values, and sign/verify with the built-in crypto module.",
  groups: [
    { name: "Hashing", items: [
      { sig: "createHash('sha256').update(data).digest('hex')", desc: "Compute a hex-encoded SHA-256 hash" },
      { sig: "createHmac('sha256', secret).update(data).digest('hex')", desc: "Compute an HMAC signature for integrity verification" }
    ]},
    { name: "Password hashing", items: [
      { sig: "await scrypt(password, salt, 64)", desc: "Derive a 64-byte key with the memory-hard scrypt algorithm" },
      { sig: "timingSafeEqual(a, b)", desc: "Compare two Buffers in constant time to prevent timing attacks" },
      { sig: "randomBytes(16).toString('hex')", desc: "Generate 16 cryptographically secure random bytes as hex" }
    ]},
    { name: "Random & utilities", items: [
      { sig: "randomUUID()", desc: "Generate a standards-compliant random UUID v4 string" },
      { sig: "randomInt(min, max)", desc: "Generate a random integer in [min, max)" },
      { sig: "generateKeyPairSync('rsa', { modulusLength: 2048 })", desc: "Synchronously generate an RSA key pair" },
      { sig: "await subtle.digest('SHA-256', data)", desc: "Use the Web Crypto subtle API built into Node" }
    ]}
  ]
});

registerCheatsheet({
  id: "util",
  title: "node:util",
  lesson: "12-parseargs",
  blurb: "Utility helpers: parse CLI args, promisify callbacks, inspect objects, and format terminal output.",
  groups: [
    { name: "CLI args", items: [
      { sig: "parseArgs({ args: process.argv.slice(2), options: { port: { type: 'string' } } })", desc: "Parse named CLI options with built-in validation" },
      { sig: "values.port / positionals", desc: "Access parsed option values and positional arguments from parseArgs" }
    ]},
    { name: "Promisify & callbackify", items: [
      { sig: "promisify(fs.readFile)", desc: "Wrap a Node-style callback function as a promise-returning one" },
      { sig: "callbackify(asyncFn)", desc: "Convert an async function back to the Node callback convention" }
    ]},
    { name: "Inspection & formatting", items: [
      { sig: "inspect(obj, { depth: 4, colors: true })", desc: "Pretty-print any value with colour and depth control" },
      { sig: "styleText('red', 'Error!')", desc: "Apply ANSI colour/style to terminal text (Node 22+)" },
      { sig: "util.types.isDate(val)", desc: "Test the runtime type of a value (Date, Promise, RegExp, …)" },
      { sig: "TextEncoder / TextDecoder", desc: "Encode strings to Uint8Array and back (WHATWG standard)" }
    ]}
  ]
});

registerCheatsheet({
  id: "timers",
  title: "Timers & scheduling",
  lesson: "04-timers-and-microtasks",
  blurb: "Schedule callbacks on the event loop with timers, immediates, and microtask queues.",
  groups: [
    { name: "Macro-task timers", items: [
      { sig: "setTimeout(fn, ms, ...args)", desc: "Schedule fn to run after at least ms milliseconds" },
      { sig: "setInterval(fn, ms)", desc: "Call fn repeatedly every ms milliseconds" },
      { sig: "clearTimeout(id) / clearInterval(id)", desc: "Cancel a pending timer by its ID" }
    ]},
    { name: "Micro-tasks & immediates", items: [
      { sig: "setImmediate(fn)", desc: "Run fn at the end of the current event-loop iteration (I/O phase)" },
      { sig: "queueMicrotask(fn)", desc: "Queue fn as a microtask, before the next macro-task" },
      { sig: "process.nextTick(fn)", desc: "Queue fn before other I/O events, even before microtasks" }
    ]},
    { name: "Promise-based timers", items: [
      { sig: "await setTimeout(ms)", desc: "Await-friendly delay using timers/promises" },
      { sig: "await setImmediate()", desc: "Await-friendly immediate using timers/promises" },
      { sig: "for await (const _ of setInterval(ms))", desc: "Async-iterate on a recurring interval using timers/promises" }
    ]},
    { name: "Event loop order", items: [
      { sig: "nextTick > microtasks (Promise) > timers > I/O > setImmediate", desc: "Execution priority from highest to lowest within one loop tick" }
    ]}
  ]
});

registerCheatsheet({
  id: "test",
  title: "node:test — Test runner",
  lesson: "22-node-test",
  blurb: "Write and run unit tests with the built-in test runner — no external framework needed.",
  groups: [
    { name: "Defining tests", items: [
      { sig: "test('name', async (t) => { … })", desc: "Define a top-level test; receives the test context t" },
      { sig: "t.test('sub', async (t) => { … })", desc: "Nest a sub-test inside a parent test" },
      { sig: "describe('suite', () => { it('case', fn) })", desc: "Use Mocha-style describe/it syntax (also built-in)" }
    ]},
    { name: "Assertions", items: [
      { sig: "assert.strictEqual(actual, expected)", desc: "Fail unless actual === expected" },
      { sig: "assert.deepStrictEqual(a, b)", desc: "Recursively compare two objects or arrays" },
      { sig: "assert.rejects(fn, /pattern/)", desc: "Assert that an async function rejects with a matching error" },
      { sig: "assert.throws(fn, TypeError)", desc: "Assert that a synchronous function throws a specific error" }
    ]},
    { name: "Mocks & utilities", items: [
      { sig: "t.mock.fn(originalFn)", desc: "Wrap a function to track calls and optionally replace it" },
      { sig: "t.mock.method(obj, 'method')", desc: "Spy on or stub an object method for the duration of the test" },
      { sig: "node --test", desc: "Run all *.test.js and test.js files from the command line" },
      { sig: "node --test --test-reporter=tap", desc: "Output results in TAP format for CI integration" }
    ]}
  ]
});

registerCheatsheet({
  id: "child_process",
  title: "node:child_process",
  lesson: "25-child-process",
  blurb: "Spawn subprocesses to run shell commands, scripts, or other executables.",
  groups: [
    { name: "Spawning", items: [
      { sig: "const { stdout } = await execFile('git', ['log', '-1'])", desc: "Run a command and buffer its output as a string" },
      { sig: "exec('ls -la', (err, stdout) => { … })", desc: "Run a shell string and receive output in a callback" },
      { sig: "const child = spawn('node', ['script.js'], { stdio: 'inherit' })", desc: "Spawn a process and inherit stdio from the parent" }
    ]},
    { name: "Communication", items: [
      { sig: "child.stdout.on('data', chunk => { … })", desc: "Read streaming output from a child process" },
      { sig: "child.stdin.write(data); child.stdin.end()", desc: "Send data to a child process via its stdin" },
      { sig: "const cp = fork('worker.js'); cp.send({ task })", desc: "Fork a Node script and communicate over IPC messages" }
    ]},
    { name: "Synchronous", items: [
      { sig: "execSync('cmd', { encoding: 'utf8' })", desc: "Run a command synchronously and return stdout as a string" },
      { sig: "spawnSync('node', ['-e', 'code'])", desc: "Spawn synchronously; returns { stdout, stderr, status }" }
    ]}
  ]
});

registerCheatsheet({
  id: "worker_threads",
  title: "node:worker_threads",
  lesson: "25-worker-threads",
  blurb: "Run JavaScript in parallel threads sharing memory, without the overhead of child processes.",
  groups: [
    { name: "Creating workers", items: [
      { sig: "new Worker('./worker.js', { workerData: { n } })", desc: "Spawn a new worker thread running the given file" },
      { sig: "workerData", desc: "Receive the initial data passed from the main thread inside a worker" },
      { sig: "isMainThread", desc: "Boolean; true in the main thread, false inside a worker" }
    ]},
    { name: "Messaging", items: [
      { sig: "worker.postMessage(value)", desc: "Send a structured-cloneable value to the worker thread" },
      { sig: "parentPort.postMessage(result)", desc: "Send a result back from the worker to the main thread" },
      { sig: "worker.on('message', cb)", desc: "Listen for messages coming from the worker" }
    ]},
    { name: "Shared memory", items: [
      { sig: "const sab = new SharedArrayBuffer(4)", desc: "Allocate memory shared across threads" },
      { sig: "Atomics.add(int32, index, value)", desc: "Perform an atomic read-modify-write on shared memory" },
      { sig: "Atomics.wait / Atomics.notify", desc: "Block a worker or wake blocked threads (futex-style)" }
    ]},
    { name: "Pools & lifecycle", items: [
      { sig: "worker.terminate()", desc: "Forcefully stop a worker thread" },
      { sig: "worker.on('error', cb) / worker.on('exit', cb)", desc: "Handle crashes and clean exit from a worker" }
    ]}
  ]
});

registerCheatsheet({
  id: "sqlite",
  title: "node:sqlite",
  lesson: "17-node-sqlite",
  blurb: "Use the built-in SQLite module for embedded, synchronous database access with no extra dependencies.",
  groups: [
    { name: "Opening & closing", items: [
      { sig: "import { DatabaseSync } from 'node:sqlite'", desc: "Import the built-in synchronous SQLite API (Node 22.5+)" },
      { sig: "const db = new DatabaseSync(':memory:')", desc: "Open an in-memory SQLite database" },
      { sig: "const db = new DatabaseSync('app.db')", desc: "Open (or create) a persistent database file" },
      { sig: "db.close()", desc: "Close the database and release the file lock" }
    ]},
    { name: "Queries", items: [
      { sig: "db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')", desc: "Execute DDL or multi-statement SQL with no result" },
      { sig: "const stmt = db.prepare('SELECT * FROM t WHERE id = ?')", desc: "Compile a reusable prepared statement" },
      { sig: "stmt.get(id)", desc: "Run the statement and return the first row as an object (or undefined)" },
      { sig: "stmt.all()", desc: "Run the statement and return all rows as an array of objects" }
    ]},
    { name: "Writes & transactions", items: [
      { sig: "db.prepare('INSERT INTO t (name) VALUES (?)').run(name)", desc: "Insert a row; returns { lastInsertRowid, changes }" },
      { sig: "db.exec('BEGIN'); /* writes */; db.exec('COMMIT')", desc: "Wrap multiple writes in an explicit transaction" }
    ]}
  ]
});
