registerQuiz("42-loop-internals", [
  {
    q: "What is the fundamental difference between a libuv handle and a libuv request?",
    options: [
      "Handles are for network I/O only; requests are for file I/O only",
      "Handles are long-lived objects (timers, sockets, signal watchers) that persist across loop iterations; requests are one-shot operations that complete and are destroyed",
      "Handles are created in C++; requests are created from JavaScript",
      "Handles run on the thread pool; requests run on the main event loop thread"
    ],
    answer: 1,
    explain: "A libuv handle (uv_handle_t hierarchy) is a persistent object representing an ongoing capability such as a TCP socket, timer, or signal watcher. It keeps the loop alive while active and referenced. A request (uv_req_t hierarchy) is a one-shot operation like a file read or DNS lookup that completes and is destroyed; it does not by itself keep the loop alive."
  },
  {
    q: "In Node.js, calling 'timer.unref()' on a setInterval handle has which precise effect on the event loop?",
    options: [
      "The timer stops firing immediately and is removed from the loop",
      "The timer continues to fire normally if the loop is kept alive by other handles, but it no longer contributes to the active-referenced-handle count that prevents the loop from exiting",
      "The timer is moved to the thread pool so it fires on a background thread",
      "The timer fires once more and is then automatically cleared"
    ],
    answer: 1,
    explain: "unref() decrements the handle's reference count to 0. The loop's exit condition in UV_RUN_DEFAULT mode is 'active_referenced_handles + pending_requests > 0'. An unreffed handle is still active and will still fire its callback if other handles keep the loop alive, but it no longer prevents the process from exiting on its own."
  },
  {
    q: "How does the libuv thread pool deliver the result of a completed 'fs.readFile' back to the main event-loop thread?",
    options: [
      "The pool thread directly invokes the JS callback from the worker thread",
      "The pool thread writes the result to a shared memory buffer that the poll phase reads on every tick",
      "The pool thread calls uv_async_send() on the loop's shared async handle, which writes to an eventfd and wakes the poll phase; the main thread then drains the work queue and invokes the JS callback",
      "The pool thread places the result in V8's microtask queue, which is drained before the next macrotask"
    ],
    answer: 2,
    explain: "When a thread-pool worker finishes (e.g., a uv_fs_t read), it stores the result in the request struct and calls uv_async_send() on the loop's wq_async handle. On Linux this writes to an eventfd, waking epoll_wait in the poll phase. The event-loop thread then drains the loop's work queue, picks up completed requests, and invokes their JavaScript callbacks — always on the main thread."
  }
]);

registerResources("42-loop-internals", [
  { title: "libuv Design Overview", url: "https://docs.libuv.org/en/v1.x/design.html" },
  { title: "libuv Handles and Requests", url: "https://docs.libuv.org/en/v1.x/handle.html" },
  { title: "libuv Thread Pool", url: "https://docs.libuv.org/en/v1.x/threadpool.html" },
  { title: "Node.js: The Event Loop, Timers, and process.nextTick", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" },
  { title: "Node.js API: process._getActiveHandles()", url: "https://nodejs.org/api/process.html#processgetactivehandlesinternal" }
]);

registerQuiz("42-os-backends", [
  {
    q: "In epoll's edge-triggered (ET) mode, what must a consumer do after receiving a readiness notification to avoid silently missing data?",
    options: [
      "Call epoll_ctl to re-register the fd for the next notification",
      "Drain the fd by looping reads until EAGAIN is returned, because the kernel fires only once per readiness transition",
      "Close and reopen the fd to reset the kernel's readiness state",
      "Call fsync() on the fd to flush any buffered data"
    ],
    answer: 1,
    explain: "In edge-triggered mode, the kernel fires exactly once when a fd transitions from not-ready to ready. If the consumer reads only part of the available data, no further notification is sent until more data arrives. The consumer must loop read() until EAGAIN to fully drain the kernel buffer. libuv uses ET mode and its uv__read function honours this contract internally."
  },
  {
    q: "Why does Linux file I/O bypass epoll and require libuv to use a thread pool instead?",
    options: [
      "Regular files are not supported by the kernel's socket layer that epoll is built on",
      "Regular file fds always appear 'ready' to epoll regardless of actual disk availability, so epoll gives no useful async notification; a read() on a cold-cache file can still block for tens of milliseconds",
      "libuv's thread pool is faster than epoll for file I/O on modern SSDs",
      "The Linux VFS layer requires all file reads to be issued from the same thread that opened the file"
    ],
    answer: 1,
    explain: "The Linux kernel marks regular file fds as always-ready in epoll because it assumes disk reads are 'fast enough.' A read() on a file with a cold page cache can still block for tens of milliseconds waiting for the disk. epoll provides no completion notification for actual disk reads. libuv therefore dispatches all fs operations to its thread pool where blocking pread()/pwrite() calls are safe."
  },
  {
    q: "Which statement best describes io_uring's key architectural improvement over epoll for high-throughput I/O, and what is its current adoption status in libuv (Node 24)?",
    options: [
      "io_uring replaces the thread pool entirely for all I/O types including TCP sockets; libuv uses it for everything in Node 24",
      "io_uring uses shared-memory submission and completion rings so many I/O operations can be submitted and harvested with a single syscall or zero syscalls; in libuv (Node 24) it is used for file I/O on Linux >= 5.1, but network sockets still use epoll",
      "io_uring allows file I/O to bypass the kernel page cache for zero-copy reads; libuv uses it for all fs calls including stat and readdir",
      "io_uring is a userspace library that wraps epoll; it has no kernel involvement and is available on all Linux versions"
    ],
    answer: 1,
    explain: "io_uring uses a pair of shared-memory ring buffers between userspace and kernel. Submissions and completions avoid per-call syscall overhead at high IOPS. In libuv as shipped with Node 24, io_uring handles uv_fs_t read/write operations on Linux >= 5.1, eliminating the thread-pool requirement for file I/O on supported kernels. TCP/UDP sockets still use the epoll readiness model."
  }
]);

registerResources("42-os-backends", [
  { title: "Linux man page: epoll(7)", url: "https://man7.org/linux/man-pages/man7/epoll.7.html" },
  { title: "Linux man page: io_uring(7)", url: "https://man7.org/linux/man-pages/man2/io_uring_setup.2.html" },
  { title: "Axboe: Efficient IO with io_uring (design paper)", url: "https://kernel.dk/io_uring.pdf" },
  { title: "libuv: epoll backend source (src/unix/linux.c)", url: "https://github.com/libuv/libuv/blob/v1.x/src/unix/linux.c" },
  { title: "Dan Kegel: The C10K Problem", url: "http://www.kegel.com/c10k.html" }
]);

registerQuiz("42-zerocopy-fds", [
  {
    q: "When a Node.js HTTP server pipes a file read stream directly to a TCP net.Socket (bypassing HTTP response framing), what kernel optimisation can libuv invoke and what copies does it eliminate?",
    options: [
      "splice(2) is used to move data between two pipe fds with zero user-space involvement, eliminating all copies",
      "sendfile(2) transfers bytes directly from the page cache to the socket send buffer without passing through a user-space buffer, eliminating the two CPU-side memory copies of the normal read+write path",
      "mmap(2) maps the file directly into the socket buffer, eliminating kernel-side copies",
      "Node uses O_DIRECT to bypass the page cache entirely, reducing copy count from four to two"
    ],
    answer: 1,
    explain: "sendfile(2) takes a file fd and a socket fd and tells the kernel to transfer bytes directly from the page cache to the socket send buffer without entering user space. The normal read()+write() path copies data from page cache to user-space buffer (copy 1) and then from user-space to socket buffer (copy 2). sendfile eliminates both CPU-side copies. Note: TLS termination forces a user-space copy regardless, so sendfile only helps on plaintext paths."
  },
  {
    q: "What is the default soft limit for open file descriptors on most Linux distributions, and what error does Node throw when it is exceeded?",
    options: [
      "65,536 fds; throws ENOBUFS",
      "1,024 fds; throws EMFILE: too many open files",
      "4,096 fds; throws ENFILE: file table overflow",
      "256 fds; throws EACCES: permission denied"
    ],
    answer: 1,
    explain: "The default RLIMIT_NOFILE soft limit on most Linux distributions is 1,024 (and only 256 on macOS). When any call that opens a new fd (open(), socket(), accept()) would exceed the soft limit, the kernel returns EMFILE. In Node.js this propagates as an error with code 'EMFILE: too many open files'. The limit must be raised via ulimit -n or systemd's LimitNOFILE before deployment."
  },
  {
    q: "Why must UV_THREADPOOL_SIZE be set in the OS environment before the Node process starts, rather than via 'process.env.UV_THREADPOOL_SIZE = \"32\"' inside the application code?",
    options: [
      "Setting environment variables from JS is blocked by the Node permission model by default",
      "libuv reads UV_THREADPOOL_SIZE once when the thread pool is first initialised, which happens at the first fs or DNS call — often during module resolution at startup; a late assignment after I/O has started has no effect",
      "process.env changes are not propagated to child processes, so the thread pool in worker threads would still use the default",
      "The value must be a power of two; the OS validates this at process launch but not at runtime"
    ],
    answer: 1,
    explain: "libuv initialises its thread pool lazily on the first pool-requiring operation, which can occur during require()/import() resolution of application modules. Once the pool is created its size is fixed. Setting process.env.UV_THREADPOOL_SIZE = '32' inside application code is too late if any I/O has already occurred. The only safe method is setting the variable in the shell environment before launching Node, or via --env-file."
  }
]);

registerResources("42-zerocopy-fds", [
  { title: "Linux man page: sendfile(2)", url: "https://man7.org/linux/man-pages/man2/sendfile.2.html" },
  { title: "Linux man page: splice(2)", url: "https://man7.org/linux/man-pages/man2/splice.2.html" },
  { title: "Node.js CLI: UV_THREADPOOL_SIZE", url: "https://nodejs.org/api/cli.html#uv_threadpool_sizesize" },
  { title: "libuv: Thread Pool documentation", url: "https://docs.libuv.org/en/v1.x/threadpool.html" },
  { title: "graceful-fs: EMFILE handling patterns", url: "https://github.com/isaacs/node-graceful-fs" }
]);
