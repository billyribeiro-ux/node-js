registerLessonSrc("25-worker-threads", function () {/*
---
id: 25-worker-threads
title: "worker_threads, SharedArrayBuffer & Atomics"
minutes: 28
level: principal
objectives:
  - Create worker threads with workerData and communicate via parentPort
  - Allocate a SharedArrayBuffer and read/write it safely with Atomics
  - Transfer ownership of an ArrayBuffer to avoid copying
  - Identify when to offload CPU-bound work to a worker thread
---

# worker_threads, SharedArrayBuffer & Atomics

## Why this matters

Node's event loop is brilliant at juggling thousands of concurrent I/O operations, but it has one critical blind spot: CPU-intensive synchronous work. Hash a large file, run a regex over a gigabyte of text, compile a template — while that computation runs, your entire server is frozen. `worker_threads` gives you real OS threads running JavaScript in parallel, including the ability to share raw memory buffers between threads for zero-copy coordination. This is the foundation of every high-throughput Node data pipeline.

## Learning objectives

- Spawn a worker thread and send data in both directions with `workerData` and `parentPort`.
- Allocate a `SharedArrayBuffer` and share it between the main thread and a worker.
- Use `Atomics.add`, `Atomics.load`, `Atomics.wait`, and `Atomics.notify` for lock-free coordination.
- Transfer an `ArrayBuffer` to a worker without copying (transferList).
- Decide when `worker_threads` is the right tool versus `cluster` or `child_process`.

## Spawning a worker thread

The `worker_threads` module creates real POSIX threads within the same Node process. Each thread gets its own V8 JavaScript context and its own event loop, but they share the same native heap — which is what makes `SharedArrayBuffer` possible.

```js
// main.mjs
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  // Main thread: spawn a worker running this same file
  const worker = new Worker(import.meta.filename, {
    workerData: { input: [1, 2, 3, 4, 5] }
  });

  worker.on('message', (result) => {
    console.log('Sum from worker:', result); // 15
  });

  worker.on('error', (err) => console.error('Worker error:', err));
  worker.on('exit', (code) => console.log('Worker exited with code', code));

} else {
  // Worker thread: workerData holds what we passed above
  const { input } = workerData;
  const sum = input.reduce((acc, n) => acc + n, 0);
  parentPort.postMessage(sum);
}
```

> [!OUTPUT]
> Sum from worker: 15
> Worker exited with code 0

A few important points about this pattern:

- `isMainThread` is `true` in the main thread, `false` in workers.
- `workerData` is a **structured clone** of the object you pass — it's a deep copy, not a reference.
- `parentPort.postMessage(value)` sends a message to the main thread; the main thread receives it via `worker.on('message', ...)`.
- You can use a separate file instead of `import.meta.filename`: `new Worker('./worker.mjs')`.

## SharedArrayBuffer — true shared memory

`workerData` and `postMessage` copy data. For large buffers (image data, audio frames, numeric arrays) the copy overhead is prohibitive. `SharedArrayBuffer` is raw memory that *multiple threads can access simultaneously* — no copy, no serialization.

```js
// main.mjs — creating and sharing a SharedArrayBuffer
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  // Allocate 4 bytes — one Int32
  const sharedBuffer = new SharedArrayBuffer(4);
  const sharedArray  = new Int32Array(sharedBuffer);
  sharedArray[0] = 0; // initial counter value

  const worker = new Worker(import.meta.filename, {
    workerData: { sharedBuffer } // SharedArrayBuffer can be shared without copying
  });

  worker.on('exit', () => {
    // Read the final value after the worker is done
    console.log('Final counter value:', Atomics.load(sharedArray, 0)); // 1000
  });

} else {
  const { sharedBuffer } = workerData;
  const sharedArray = new Int32Array(sharedBuffer);

  // Increment the shared counter 1000 times
  for (let i = 0; i < 1000; i++) {
    Atomics.add(sharedArray, 0, 1); // atomic increment
  }
}
```

> [!OUTPUT]
> Final counter value: 1000

> [!WARNING] Raw reads/writes to SharedArrayBuffer are unsafe
> If you use `sharedArray[0]++` (a read-then-write) across two threads simultaneously, you get a **data race**: both threads read the old value, both add 1, and both write the same incremented value — losing one increment. Always use `Atomics` methods for reads and writes shared between threads.

## Atomics — the concurrency primitives

`Atomics` provides a set of operations guaranteed to be atomic — indivisible even when multiple threads run simultaneously. The key operations:

| Operation | What it does |
|---|---|
| `Atomics.load(ta, i)` | Read `ta[i]` atomically |
| `Atomics.store(ta, i, v)` | Write `v` to `ta[i]` atomically |
| `Atomics.add(ta, i, v)` | `ta[i] += v` atomically; returns old value |
| `Atomics.compareExchange(ta, i, expected, replacement)` | CAS: write only if current value equals `expected` |
| `Atomics.wait(ta, i, expected)` | Block thread until `ta[i] !== expected`; like a mutex lock wait |
| `Atomics.notify(ta, i, count)` | Wake up `count` threads waiting on `ta[i]` |

`Atomics.wait` / `Atomics.notify` implement a **futex**-style primitive — the same building block used by mutex locks in C. In Node, `wait` can only be called in a worker thread (calling it on the main thread would freeze the event loop).

```js
// Worker signals "done" by storing 1, then notifying the main thread.
// Main thread was waiting on that index with Atomics.waitAsync().

// main.mjs
import { Worker, isMainThread, workerData } from 'node:worker_threads';

if (isMainThread) {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  Atomics.store(flag, 0, 0); // 0 = not done

  const worker = new Worker(import.meta.filename, { workerData: { sab } });

  // waitAsync is non-blocking — returns a Promise, safe on the main thread
  Atomics.waitAsync(flag, 0, 0).value.then(() => {
    console.log('Main thread: worker signalled done, flag =', Atomics.load(flag, 0));
  });

} else {
  const { sab } = workerData;
  const flag = new Int32Array(sab);

  // Simulate work
  let sum = 0;
  for (let i = 0; i < 1_000_000; i++) sum += i;

  // Signal completion
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0, 1); // wake up one waiter
}
```

> [!OUTPUT]
> Main thread: worker signalled done, flag = 1

> [!PRINCIPAL] Atomics.wait vs Atomics.waitAsync
> `Atomics.wait` blocks the calling thread in a kernel wait — perfect inside a worker. `Atomics.waitAsync` is its non-blocking counterpart: it returns a `{ async: true, value: Promise }` object and integrates with Node's event loop on the main thread. This distinction exists because the main thread *must never block* — blocking it starves every I/O callback, timer, and stream event in your server.

## Transferables — zero-copy ArrayBuffer handoff

When you `postMessage` a plain `ArrayBuffer` (not `Shared`), Node makes a full copy by default. With a **transfer list**, ownership of the buffer moves to the destination thread — zero bytes are copied, and the original buffer becomes detached (unusable) in the sender.

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  // Create a 16 MB buffer
  const buffer = new ArrayBuffer(16 * 1024 * 1024);
  const view = new Float64Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = Math.random();

  const worker = new Worker(import.meta.filename);

  // Transfer ownership — no copy. buffer.byteLength is now 0 here.
  worker.postMessage({ buffer }, [buffer]);
  console.log('After transfer, buffer.byteLength:', buffer.byteLength); // 0

  worker.on('message', (result) => console.log('Mean:', result));

} else {
  parentPort.once('message', ({ buffer }) => {
    const view = new Float64Array(buffer);
    let sum = 0;
    for (let i = 0; i < view.length; i++) sum += view[i];
    parentPort.postMessage(sum / view.length);
  });
}
```

> [!OUTPUT]
> After transfer, buffer.byteLength: 0
> Mean: 0.4998...

## Try it yourself

This runnable example models the classic **data race** problem and shows how atomic operations fix it — all in single-threaded JavaScript using a simulation. The concept maps exactly to what happens in multi-threaded code:

```js run
// Simulating a shared counter race condition and the atomic fix.
// In real worker_threads, these "threads" would run in parallel.
// Here we model them as sequential state machines to see the race clearly.

function simulateRace() {
  let counter = 0;

  // Non-atomic increment: read, increment, write — three steps
  // With two concurrent threads, both might read 0, both write 1.
  function unsafeIncrement() {
    const snapshot = counter; // "read"
    // Simulate interleaving: another thread could run here
    counter = snapshot + 1;   // "write"
  }

  // Simulate two "threads" both incrementing from 0
  // If they interleave at the snapshot step, we lose an update
  const snapshotA = counter;  // Thread A reads: 0
  const snapshotB = counter;  // Thread B reads: 0 (race!)
  counter = snapshotA + 1;    // Thread A writes: 1
  counter = snapshotB + 1;    // Thread B writes: 1 — lost Thread A's work!

  console.log('After race: counter =', counter, '(should be 2, got 1 — BUG)');
  counter = 0; // reset

  // Atomic fix: the read-modify-write is one indivisible step
  function atomicIncrement(arr, index) {
    const old = arr[index];
    arr[index] = old + 1;
    return old; // returns previous value, like Atomics.add
  }

  const shared = [0]; // simulate Int32Array backed by SharedArrayBuffer
  atomicIncrement(shared, 0); // Thread A: atomically 0 -> 1
  atomicIncrement(shared, 0); // Thread B: atomically 1 -> 2
  console.log('After atomic increments: counter =', shared[0], '(correct!)');
}

simulateRace();

// Now model a producer/consumer handoff using a flag
function simulateSignal() {
  const flag = [0]; // 0 = not ready, 1 = ready

  // "Worker thread" sets result and signals
  const result = 42;
  flag[0] = 1; // Atomics.store would do this atomically

  // "Main thread" polls (in reality, waitAsync would yield)
  if (flag[0] === 1) {
    console.log('Main thread received result:', result, '(flag =', flag[0] + ')');
  }
}

simulateSignal();
```

## Exercises

**Exercise 1:** Using the race simulation above as a starting point, implement a **spinlock** — a simple mutual exclusion mechanism that uses `Atomics.compareExchange`-style logic. Use a `[0]` array (0 = unlocked, 1 = locked) and implement `lock()` and `unlock()` functions, then demonstrate two "threads" safely incrementing a counter 5 times each without losing updates.

<details>
<summary>Show solution</summary>

```js run
// Spinlock simulation using compareExchange logic
function createLock(state) {
  return {
    lock() {
      // Keep trying until we atomically swap 0 -> 1
      while (true) {
        const old = state[0];
        if (old === 0) {
          state[0] = 1; // compareExchange(0, 1) succeeds
          return;
        }
        // old === 1 means locked; spin (in real code, yield the thread)
      }
    },
    unlock() {
      state[0] = 0;
    }
  };
}

const lockState = [0];
const lock = createLock(lockState);
let counter = 0;

function safeIncrement(threadName, times) {
  for (let i = 0; i < times; i++) {
    lock.lock();
    const old = counter;
    counter = old + 1;
    console.log(`${threadName}: ${old} -> ${counter}`);
    lock.unlock();
  }
}

// Sequential simulation of two "threads"
safeIncrement('Thread-A', 3);
safeIncrement('Thread-B', 3);
console.log('Final counter:', counter); // must be 6
```

</details>

**Exercise 2:** Model a simple **work-stealing queue** in pure JavaScript. Two workers take tasks from a shared array (the "deque"). Worker A pushes tasks onto one end, Worker B steals from the other end if it runs out of its own tasks. Simulate 6 tasks and show which worker handled each.

<details>
<summary>Show solution</summary>

```js run
function createDeque() {
  const items = [];
  return {
    push(item) { items.push(item); },
    pop() { return items.pop(); },     // take from the top (owner end)
    steal() { return items.shift(); }, // steal from the bottom
    get length() { return items.length; }
  };
}

const deque = createDeque();
const log = [];

// Worker A produces tasks
for (let i = 1; i <= 6; i++) deque.push(`task-${i}`);

// Worker A processes tasks from the top; Worker B steals from the bottom
function runWorker(name, strategy) {
  const results = [];
  let item;
  while ((item = strategy()) !== undefined) {
    results.push(`${name} handled ${item}`);
  }
  return results;
}

// Interleaved simulation: A and B alternate
const results = [];
let turn = 0;
while (deque.length > 0) {
  if (turn % 2 === 0) {
    const t = deque.pop();
    if (t) results.push(`Worker-A handled ${t}`);
  } else {
    const t = deque.steal();
    if (t) results.push(`Worker-B stole   ${t}`);
  }
  turn++;
}

results.forEach(r => console.log(r));
```

</details>

## Common pitfalls

> [!PITFALL] Using worker_threads for I/O-bound tasks
> Threads shine for CPU-bound work. If your "heavy" operation is actually waiting for a database query or a network call, moving it to a worker thread gains nothing — Node's event loop already handles I/O concurrency. Before reaching for `worker_threads`, profile and confirm that the CPU is the bottleneck, not I/O wait.

Another common mistake: passing non-transferable objects in the transfer list. Only `ArrayBuffer`, `MessagePort`, `ReadableStream`, `WritableStream`, `TransformStream`, `WebAssembly.Memory`, and `ImageBitmap` can be transferred. Attempting to transfer a plain object throws a `DataCloneError`.

## What you learned

- `Worker` creates a real OS thread running JavaScript with its own V8 context; `workerData` deep-copies data in.
- `parentPort.postMessage` / `worker.on('message')` communicate between threads via structured clone.
- `SharedArrayBuffer` is raw memory visible to multiple threads simultaneously — always access it through `Atomics` methods to avoid data races.
- `Atomics.wait` (blocks; worker only) and `Atomics.waitAsync` (non-blocking Promise; safe on main thread) enable thread synchronization without busy-waiting.
- The transfer list moves `ArrayBuffer` ownership across threads with zero copying — the original becomes detached.

## Next steps

Managing individual workers is powerful but tedious — you have to track which workers are busy, queue tasks when all are occupied, and route results back to the right caller. The next lesson packages all of that into a **worker pool**: a reusable scheduler that keeps N threads warm and dispatches tasks with full backpressure support.
*/});
