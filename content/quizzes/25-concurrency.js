registerQuiz("25-child-process", [
  {
    q: "Which child_process function passes arguments as a separate array, bypassing the shell entirely?",
    options: [
      "exec",
      "spawn",
      "fork",
      "Both spawn and fork"
    ],
    answer: 3,
    explain: "Both spawn and fork accept the command binary and arguments as separate values (not a shell string), so the OS receives them directly without shell interpretation. This eliminates the risk of shell injection from user-controlled input."
  },
  {
    q: "What is the primary security risk of using exec() with user-controlled input?",
    options: [
      "exec() buffers output in memory which can cause OOM",
      "exec() passes the command string to the shell, so user input can inject arbitrary shell commands",
      "exec() runs without any timeout by default",
      "exec() leaks environment variables to the child process"
    ],
    answer: 1,
    explain: "exec() runs the command string through the system shell (/bin/sh or cmd.exe). If user input is interpolated into that string, an attacker can inject shell metacharacters (semicolons, backticks, pipes) to execute arbitrary commands. Use spawn or execFile with a separate args array for any untrusted input."
  },
  {
    q: "Which child_process function is best suited for creating a sibling Node.js process that exchanges structured messages?",
    options: [
      "exec",
      "execFile",
      "spawn",
      "fork"
    ],
    answer: 3,
    explain: "fork() is spawn specialised for Node.js child scripts: it automatically establishes an IPC channel so the parent and child can call .send() and listen on 'message' events to exchange JSON-serialisable messages."
  }
]);

registerResources("25-child-process", [
  { title: "Node.js child_process API", url: "https://nodejs.org/api/child_process.html" },
  { title: "child_process.spawn documentation", url: "https://nodejs.org/api/child_process.html#child_processspawncommand-args-options" },
  { title: "child_process.fork documentation", url: "https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options" },
  { title: "child_process/promises (promisified API)", url: "https://nodejs.org/api/child_process.html#child-process-promises-api" }
]);

registerQuiz("25-cluster", [
  {
    q: "How does the cluster module allow multiple worker processes to share the same TCP port?",
    options: [
      "Workers each bind a different port and a reverse proxy forwards traffic",
      "The primary process accepts connections and forwards them to workers via IPC or the OS SO_REUSEPORT socket option",
      "Workers share a single JavaScript event loop in the primary process",
      "Workers use SharedArrayBuffer to coordinate which one accepts each connection"
    ],
    answer: 1,
    explain: "On Linux with SO_REUSEPORT the kernel distributes connections across all processes bound to the port. On other platforms Node's primary process accepts connections and hand-delivers them to workers via IPC. Either way, all workers appear to share the same port transparently."
  },
  {
    q: "Why is the cluster module less effective for CPU-bound workloads than for I/O-bound ones?",
    options: [
      "Cluster workers cannot access the filesystem",
      "Each cluster worker is still single-threaded, so a 200 ms CPU computation still blocks that worker's entire event loop",
      "Cluster workers share memory so CPU work causes contention",
      "The cluster module limits each worker to 100 MB of RAM"
    ],
    answer: 1,
    explain: "Each cluster worker runs a full Node.js process with a single event loop. CPU-bound synchronous work blocks that worker from handling any other requests. For CPU parallelism within each worker, worker_threads is the right tool; cluster handles scaling I/O-bound servers across cores."
  },
  {
    q: "What is the recommended way to perform a graceful worker restart without dropping live connections?",
    options: [
      "Call worker.kill() immediately so a fresh worker can start",
      "Send the worker a shutdown message, call worker.disconnect(), and force-kill with setTimeout as a safety net",
      "Restart the entire primary process along with all workers",
      "Set cluster.schedulingPolicy to SCHED_NONE and let the OS handle it"
    ],
    answer: 1,
    explain: "A graceful restart tells the worker to stop accepting new connections (server.close()) via a shutdown message, then calls worker.disconnect() so the IPC channel closes when in-flight requests finish. A safety-net setTimeout force-kills the worker if it takes too long to drain."
  }
]);

registerResources("25-cluster", [
  { title: "Node.js cluster module API", url: "https://nodejs.org/api/cluster.html" },
  { title: "os.availableParallelism()", url: "https://nodejs.org/api/os.html#osavailableparallelism" },
  { title: "Node.js cluster documentation (how it works)", url: "https://nodejs.org/api/cluster.html#how-it-works" },
  { title: "SO_REUSEPORT overview (Linux kernel docs)", url: "https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html" }
]);

registerQuiz("25-worker-threads", [
  {
    q: "Why must Atomics methods be used when reading or writing a SharedArrayBuffer from multiple threads?",
    options: [
      "SharedArrayBuffer only works with Atomics; plain array indexing throws a TypeError",
      "Plain read-then-write operations are not atomic, so two threads can both read the old value and both write back the same incremented value, losing an update",
      "Atomics methods automatically compress the buffer to save memory",
      "SharedArrayBuffer values are immutable without Atomics"
    ],
    answer: 1,
    explain: "A non-atomic increment (read, add, write) is three separate steps. Two threads running concurrently can both read the same old value before either writes, so both write the same result and one increment is lost. Atomics.add performs the full read-modify-write as a single indivisible operation."
  },
  {
    q: "What happens to the original ArrayBuffer after it is transferred to a worker using the transferList?",
    options: [
      "It is copied to the worker; both sides have independent copies",
      "It becomes detached (zero byteLength) in the sender; ownership has moved to the receiver",
      "It is frozen and becomes read-only in the sender",
      "It is garbage collected immediately after transfer"
    ],
    answer: 1,
    explain: "Transferring an ArrayBuffer moves ownership to the destination thread with zero copying. The original buffer in the sending thread is detached: its byteLength becomes 0 and any attempt to access it throws. This is the zero-copy mechanism for large data."
  },
  {
    q: "Why is Atomics.wait() forbidden on the main thread in Node.js?",
    options: [
      "The main thread does not have access to SharedArrayBuffer",
      "Atomics.wait() blocks the calling thread, which would freeze the main event loop and stop all I/O, timers, and callbacks",
      "Node.js has not yet implemented Atomics.wait() for the main thread",
      "The main thread uses a different memory model that is incompatible with Atomics"
    ],
    answer: 1,
    explain: "Atomics.wait() blocks the OS thread until a condition is met. The Node.js main thread drives the entire event loop; blocking it starves every pending I/O callback, timer, and stream event. Use Atomics.waitAsync() on the main thread instead, which returns a non-blocking Promise."
  }
]);

registerResources("25-worker-threads", [
  { title: "Node.js worker_threads API", url: "https://nodejs.org/api/worker_threads.html" },
  { title: "SharedArrayBuffer (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer" },
  { title: "Atomics (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics" },
  { title: "Structured clone algorithm (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm" },
  { title: "Transferable objects (MDN)", url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects" }
]);

registerQuiz("25-worker-pools", [
  {
    q: "Why does a fixed worker pool outperform spawning a new worker thread per task at scale?",
    options: [
      "A pool uses less CPU because tasks run sequentially inside it",
      "Each new Worker() costs 5-20 ms and megabytes of heap; a pool pays that startup cost once and reuses warm threads for all tasks",
      "Worker pools automatically compress task data before sending it",
      "Node.js limits the total number of concurrent Promises, so pools avoid that cap"
    ],
    answer: 1,
    explain: "Creating a Worker thread allocates a V8 heap and bootstraps a JavaScript environment, taking 5-20 ms. For high-throughput workloads, paying this cost per task is prohibitive. A pool pre-warms a fixed set of threads and routes tasks to idle ones, making the startup cost a one-time expense."
  },
  {
    q: "In a worker pool implementation, what is the purpose of the maxQueue option?",
    options: [
      "It sets the maximum number of worker threads",
      "It limits the number of completed results stored in memory",
      "It caps the number of pending tasks so the queue does not grow unboundedly and cause OOM",
      "It controls how many messages a single worker can receive per second"
    ],
    answer: 2,
    explain: "Without a queue bound, tasks accumulate in memory faster than workers can drain them, eventually exhausting heap. The maxQueue option rejects new tasks with an error when the queue is full, giving callers a signal to apply backpressure (retry, shed load, or return a 503)."
  },
  {
    q: "What is the recommended pool size for CPU-bound work on a multi-core machine?",
    options: [
      "Always exactly 1 worker regardless of core count",
      "As many workers as there are pending tasks",
      "At most availableParallelism() workers, one per logical CPU",
      "Twice the number of logical CPUs to account for blocking"
    ],
    answer: 2,
    explain: "For CPU-bound work, adding more threads than logical CPUs causes context-switching overhead that reduces throughput. os.availableParallelism() returns the CPU count available to this process (respecting container CPU quotas), making it the correct upper bound for a CPU-bound pool."
  }
]);

registerResources("25-worker-pools", [
  { title: "Node.js worker_threads API", url: "https://nodejs.org/api/worker_threads.html" },
  { title: "piscina - worker thread pool library", url: "https://github.com/piscinajs/piscina" },
  { title: "os.availableParallelism() (Node.js docs)", url: "https://nodejs.org/api/os.html#osavailableparallelism" },
  { title: "MDN: Web Workers API", url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API" }
]);
