registerLessonSrc("07-watching", function () {/*
---
id: 07-watching
title: "Watching Files & --watch"
minutes: 20
level: intermediate
objectives:
  - Watch files and directories for changes with fs.watch and fs.watchFile
  - Debounce noisy change events to avoid redundant work
  - Use node --watch and --watch-path for zero-configuration dev restarts
---

# Watching Files & --watch

## Why this matters

Every dev-server, test runner, and build tool reloads when you save a file. That magic is `fs.watch`. But the raw watch API fires multiple events per save, behaves differently across operating systems, and can overwhelm downstream logic if you react to every event naively. Learning to watch *correctly* — with debouncing and an eye to platform quirks — is the difference between a polished tool and a flaky one.

## Learning objectives

- Use `fs.watch` and `fs.watchFile` and understand their tradeoffs.
- Debounce change events so work runs only once per logical save.
- Enable `--watch` / `--watch-path` for automatic restarts during development.
- Anticipate and handle common cross-platform gotchas.

## `fs.watch` — the fast, event-driven watcher

`fs.watch` uses OS-native file-change notifications (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows) — which makes it fast and low overhead.

```js
import { watch } from "node:fs";

const watcher = watch("src", { recursive: true }, (eventType, filename) => {
  console.log(`[${eventType}] ${filename}`);
});

// Stop watching later
watcher.close();
```

> [!OUTPUT]
> [change] index.js
> [rename] utils/helper.js

The `eventType` is either `"change"` (file content changed) or `"rename"` (file created, deleted, or renamed). The `filename` argument can be `null` on some platforms — always guard for it.

### Options

| Option | Default | Meaning |
|---|---|---|
| `recursive` | `false` | Watch subdirectories too (Windows and macOS only natively; Linux emulated in Node) |
| `persistent` | `true` | Keep the process alive while watching |
| `encoding` | `"utf8"` | Encoding for the `filename` argument |

> [!NOTE] `recursive: true` on Linux
> On Linux, `fs.watch` with `recursive: true` is implemented in Node itself by walking the directory tree and attaching individual watchers. It works, but is less efficient than native recursive watching. For production-grade tooling on Linux, dedicated libraries like `chokidar` use optimised strategies.

## `fs.watchFile` — polling instead of events

`fs.watchFile` uses **polling** — it checks the file's `stat` on a timer and fires when `mtime` or `size` changes. It's slower and less responsive, but works everywhere and on network filesystems where `fs.watch` may silently fail.

```js
import { watchFile, unwatchFile } from "node:fs";

watchFile("config.json", { interval: 1000 }, (curr, prev) => {
  if (curr.mtime > prev.mtime) {
    console.log("config changed, reloading...");
  }
});

// Stop polling
unwatchFile("config.json");
```

> [!OUTPUT]
> config changed, reloading...

The callback receives two `fs.Stats` objects — `curr` (current) and `prev` (previous). Compare `mtime`, `size`, or `ino` to decide whether to act.

### When to use which

| | `fs.watch` | `fs.watchFile` |
|---|---|---|
| Speed | Near-instant (OS push) | Up to `interval` ms delay |
| CPU | Minimal | Proportional to watched files |
| Network drives | Often broken | Works (polling always works) |
| `filename` arg | Sometimes null | N/A — you gave the path |
| Recursive | Varies by OS | No |

> [!PRINCIPAL] Prefer `fs.watch` for local dev tools; fall back to polling for network or container mounts
> Docker volumes, NFS shares, and WSL cross-filesystem mounts are notorious for silently dropping `fs.watch` events. If your tool targets those environments (CI volumes, devcontainers), add a polling fallback or use a library like `chokidar` that does so automatically. In pure local dev-server scenarios, `fs.watch` with debouncing is the right default.

## Debouncing change events

A single file save can fire 2–6 `"change"` events in quick succession (editor writes a temp file, renames it, updates metadata). Without debouncing, your rebuild runs three times for one keypress.

The fix is a **debounce**: wait until events have been quiet for a short window (typically 100–300 ms) before acting.

```js
import { watch } from "node:fs";

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const rebuild = debounce((eventType, filename) => {
  console.log(`Building… triggered by ${filename}`);
  // run your actual build here
}, 200);

watch("src", { recursive: true }, rebuild);
```

> [!OUTPUT]
> Building… triggered by index.js

Now no matter how many events fire in a burst, `rebuild` runs exactly once — 200 ms after the last event.

## `node --watch` — zero-config restarts

Since Node 18 you can restart your script automatically when any of its loaded files change, without any watcher code of your own:

```bash
node --watch server.js
```

Need to also watch files that aren't `require`/`import`ed (templates, config, `.env`)?

```bash
node --watch-path=./src --watch-path=./config server.js
```

> [!NOTE] `--watch` respects `--watch-ignore`
> Add `--watch-ignore=node_modules` (the default is already excluded) or `--watch-ignore=dist` to suppress restarts from generated output files. Node 22+ also reads a `.watchignore` file.

`--watch` is ideal for development; it's the quickest way to get live-reload with zero dependencies.

## Gotchas

**Duplicate events.** A single save can produce `change` + `change` + `rename` from a single editor save. Always debounce.

**`filename` is `null`.** On some Linux kernels and kernel configurations, the `filename` callback argument is `null`. Guard with `filename ?? "(unknown)"`.

**The watcher keeps the process alive.** `fs.watch` with `{ persistent: true }` (the default) prevents the process from exiting. If you start a watcher in a script that should exit after some work, call `watcher.close()` or set `{ persistent: false }`.

**Watching a file that gets replaced.** Many editors save atomically — write to a temp file, then rename it. `fs.watch` on the original file can lose the watch after a rename. Watch the *directory* instead and filter for your filename.

```js
import { watch } from "node:fs";
import path from "node:path";

// Watch the directory, filter for the specific file
watch(".", (eventType, filename) => {
  if (filename === "config.json") {
    console.log("config.json changed");
  }
});
```

## Try it yourself

Debouncing is the core transferable skill from this lesson. Implement it from scratch and explore edge cases:

```js run
function debounce(fn, ms) {
  let timerId = null;
  let callCount = 0;

  return function debounced(...args) {
    callCount++;
    clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn(...args);
    }, ms);
  };
}

// Simulate rapid-fire file events
let eventsFired = 0;
const rebuild = debounce((filename) => {
  console.log(`Build triggered for: ${filename} (after ${eventsFired} raw events)`);
}, 50);

// Fire 5 rapid events — should produce exactly ONE build
for (let i = 0; i < 5; i++) {
  eventsFired++;
  rebuild("index.js");
}

// After a pause, fire 3 more — should produce exactly ONE more build
setTimeout(() => {
  eventsFired = 0;
  for (let i = 0; i < 3; i++) {
    eventsFired++;
    rebuild("utils.js");
  }
}, 200);
```

## Exercise

**Challenge:** Implement a `throttle(fn, ms)` function — unlike debounce (which delays until quiet), throttle fires immediately on the first call, then suppresses further calls for `ms` milliseconds. This is useful when you want instant feedback but still need rate-limiting.

<details>
<summary>Show solution</summary>

```js run
function throttle(fn, ms) {
  let lastRan = 0;
  let timerId = null;

  return function throttled(...args) {
    const now = Date.now();
    const remaining = ms - (now - lastRan);

    if (remaining <= 0) {
      // Enough time has passed — fire immediately
      clearTimeout(timerId);
      timerId = null;
      lastRan = now;
      fn(...args);
    } else if (!timerId) {
      // Schedule a trailing call at the end of the window
      timerId = setTimeout(() => {
        lastRan = Date.now();
        timerId = null;
        fn(...args);
      }, remaining);
    }
  };
}

let count = 0;
const log = throttle((msg) => console.log(`[${++count}] ${msg}`), 100);

// Rapid calls — first fires immediately, rest suppressed for 100ms
log("event A");
log("event B");
log("event C");

// After 150ms — fires again
setTimeout(() => log("event D"), 150);
setTimeout(() => log("event E"), 160);
setTimeout(() => log("event F"), 400);
```

</details>

## Common pitfalls

> [!PITFALL] Watching a symlink target vs the symlink itself
> `fs.watch` on a symlink watches the *link*, not the file it points to. On macOS the distinction matters — tools that create symlinks (like some package managers) can cause watchers to go silent. Watch real paths: use `fs.realpath` to resolve symlinks before watching.

## What you learned

- `fs.watch` is fast and event-driven, using OS native notifications; `fs.watchFile` uses polling and works on network mounts.
- A single editor save can produce several events — always **debounce** to collapse them into one action.
- `node --watch` and `--watch-path` give you automatic process restarts without any watcher code.
- Watch the **directory** rather than the file itself to survive atomic saves (write-then-rename).

## Next steps

You can now react to individual file changes. But what about processing files that are too large to load into memory at all? That's where streams come in — let's look at reading and writing large files safely.
*/});
