registerLessonSrc("07-paths-and-dirs", function () {/*
---
id: 07-paths-and-dirs
title: "Paths, Directories & fs.glob"
minutes: 22
level: beginner
objectives:
  - Build and dissect file paths safely with node:path
  - Create, list, and remove directories with node:fs
  - Search the filesystem with fs.glob
---

# Paths, Directories & fs.glob

## Why this matters

Hardcoding path strings like `"C:\\Users\\ada\\project/src/index.js"` is a fast track to code that breaks on every other developer's machine or CI server. Node ships `node:path` — a small but essential utility that lets you build, split, and normalise paths correctly on Windows, macOS, and Linux. Pair it with `node:fs` directory operations and the new `fs.glob` and you can traverse, create, and search entire directory trees with confidence.

## Learning objectives

- Use `path.join`, `path.resolve`, `basename`, `dirname`, `extname`, `sep`, and the `posix` / `win32` sub-objects.
- Create directories recursively with `mkdir`, list entries with `readdir`, and remove with `rm`.
- Search files by pattern with `fs.glob`.

## `node:path` — building paths the right way

The `node:path` module is a collection of pure functions — no I/O, no filesystem access. They just manipulate strings according to the rules of the host OS.

```js
import path from "node:path";

// Join segments with the correct separator for the OS
path.join("src", "utils", "logger.js");   // "src/utils/logger.js"  (unix)
                                           // "src\\utils\\logger.js" (windows)

// Resolve an absolute path (starting from cwd by default)
path.resolve("src", "index.js");          // "/home/ada/project/src/index.js"
path.resolve("/var/log", "../tmp");       // "/var/tmp"  — resolves .. segments

// Decompose a path
path.basename("/home/ada/notes.txt");     // "notes.txt"
path.basename("/home/ada/notes.txt", ".txt"); // "notes"
path.dirname("/home/ada/notes.txt");      // "/home/ada"
path.extname("/home/ada/notes.txt");      // ".txt"
path.extname("archive.tar.gz");           // ".gz"  (last extension only)

// The OS separator
console.log(path.sep);   // "/" on Unix, "\\" on Windows
```

> [!OUTPUT]
> /

### `path.join` vs `path.resolve`

`path.join` simply concatenates segments with the OS separator and normalises `..` and `.`, but **it does not create an absolute path** unless you start from one.

`path.resolve` walks the segments right-to-left and anchors to the current working directory if it never hits an absolute segment. Use it when you need a guaranteed absolute path.

```js
// join does NOT anchor to cwd
path.join("a", "b");          // "a/b"  (relative)

// resolve always gives an absolute path
path.resolve("a", "b");       // "/cwd/a/b"

// An absolute segment in resolve resets the path
path.resolve("/root", "a");   // "/root/a"
path.resolve("x", "/abs");    // "/abs"  — the "/abs" wins
```

### `path.posix` and `path.win32`

On any OS you can access the rules of *either* platform:

```js
import path from "node:path";

// Force POSIX rules (useful for URLs, Docker configs)
path.posix.join("a", "b", "c");  // "a/b/c"

// Force Windows rules (useful for parsing Windows paths cross-platform)
path.win32.basename("C:\\Users\\ada\\file.txt");  // "file.txt"
```

> [!PRINCIPAL] Never build paths with string concatenation
> `"src/" + filename` will silently produce wrong paths when `filename` starts with `/`, turning a relative path into an absolute one that ignores your base. `path.join` normalises this. `path.resolve` handles it even more forcefully. Make `path.join` / `path.resolve` a hard reflex — the payoff is cross-platform correctness and robustness against surprising inputs.

## Directory operations

### Creating directories

`fs.mkdir` (and its sync/callback counterparts) creates a directory. The `recursive: true` option is the flag you'll always want — it creates intermediate directories and does not throw if the directory already exists.

```js
import { mkdir } from "node:fs/promises";

// Create a nested tree in one call — safe to call even if it already exists
await mkdir("dist/assets/images", { recursive: true });
```

> [!OUTPUT]
> (no output on success; throws ENOENT on missing parent without recursive)

### Listing directory contents

`readdir` returns file names. With `{ withFileTypes: true }` it returns `Dirent` objects that expose `isFile()`, `isDirectory()`, `isSymbolicLink()`, and more — no extra `stat` call required.

```js
import { readdir } from "node:fs/promises";

// Basic listing
const names = await readdir("src");
console.log(names); // ["index.js", "utils", "types.ts"]

// With Dirent objects
const entries = await readdir("src", { withFileTypes: true });
for (const entry of entries) {
  const kind = entry.isDirectory() ? "dir " : "file";
  console.log(kind, entry.name);
}
```

> [!OUTPUT]
> file index.js
> dir  utils
> file types.ts

For a **recursive** walk, pass `{ recursive: true }` (Node 20+):

```js
const allFiles = await readdir("src", { recursive: true, withFileTypes: true });
// Returns every entry in every subdirectory
```

### Removing files and directories

`fs.rm` is the modern, unified removal function. Use `{ recursive: true, force: true }` to remove a directory tree — the equivalent of `rm -rf`.

```js
import { rm } from "node:fs/promises";

await rm("dist");                              // remove a file
await rm("dist", { recursive: true });         // remove a dir (must be empty-ish or recursive)
await rm("dist", { recursive: true, force: true }); // like rm -rf — no error if missing
```

> [!NOTE] `rmdir` is legacy
> `fs.rmdir` is still in Node but is soft-deprecated for directory removal. Prefer `fs.rm` with `recursive: true` — it works for both files and directories.

## `fs.glob` — pattern matching without a library

Node 22+ ships `fs.glob`, which accepts gitignore-style glob patterns and returns an async iterable of matching paths. No more reaching for `glob` or `fast-glob` for basic cases.

```js
import { glob } from "node:fs/promises";

// Pattern "src/**" + "/*.ts" matches TypeScript files at any depth under src/
// (the ** glob means "any number of directory levels")
const tsGlob = "src/**" + "/*.ts";
for await (const file of glob(tsGlob)) {
  console.log(file);
}

// Multiple patterns
const configGlobs = ["**" + "/*.json", "**" + "/*.yaml"];
for await (const file of glob(configGlobs, { cwd: "config" })) {
  console.log(file);
}
```

> [!OUTPUT]
> src/index.ts
> src/utils/logger.ts
> src/types/user.ts

> [!NOTE] `fs.glob` landed in Node 22
> If you need glob matching on Node 20 LTS, use the `glob` npm package or `fs.readdir` with `recursive: true` and filter manually.

## Try it yourself

`path.join` and `path.normalize` are pure string logic — perfect for the browser sandbox. Let's implement a minimal version from scratch to understand what the real thing does:

```js run
// Implement a simplified path.join + path.normalize in pure JS.
// Rules:
//   1. Join segments with "/"
//   2. Collapse multiple slashes into one
//   3. Resolve "." (current dir — remove it)
//   4. Resolve ".." (go up one level)

function normalize(p) {
  const parts = p.split("/").filter(Boolean); // split and drop empty segments
  const stack = [];
  for (const part of parts) {
    if (part === ".") {
      // current dir — skip
    } else if (part === "..") {
      if (stack.length > 0) stack.pop(); // go up
    } else {
      stack.push(part);
    }
  }
  const result = stack.join("/");
  return p.startsWith("/") ? "/" + result : result || ".";
}

function join(...segments) {
  return normalize(segments.join("/"));
}

// Tests
console.log(join("a", "b", "c"));           // a/b/c
console.log(join("a", "..", "b"));           // b
console.log(join("src", ".", "utils"));      // src/utils
console.log(join("/var", "log", "../tmp"));  // /var/tmp
console.log(join("a//b", "c"));             // a/b/c
console.log(normalize("./foo/./bar/../baz")); // foo/baz
```

## Exercise

**Challenge:** Extend `join` above to also expose `basename(p)` and `dirname(p)` — the last segment vs everything before it.

<details>
<summary>Show solution</summary>

```js run
function normalize(p) {
  const parts = p.split("/").filter(Boolean);
  const stack = [];
  for (const part of parts) {
    if (part === ".") {
      // skip
    } else if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  const result = stack.join("/");
  return p.startsWith("/") ? "/" + result : result || ".";
}

function join(...segments) {
  return normalize(segments.join("/"));
}

function basename(p) {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "";
}

function dirname(p) {
  const clean = p.replace(/\/+$/, "");
  const idx = clean.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return clean.slice(0, idx);
}

// Tests
console.log(basename("/home/ada/notes.txt"));  // notes.txt
console.log(basename("src/index.js"));         // index.js
console.log(dirname("/home/ada/notes.txt"));   // /home/ada
console.log(dirname("src/index.js"));          // src
console.log(dirname("index.js"));              // .
```

</details>

## Common pitfalls

> [!PITFALL] Using `__dirname` in ES Modules
> `__dirname` is a CommonJS-only global. In ESM files, it is `undefined`. The replacement is `import.meta.dirname` (Node 21.2+) or the older `new URL(".", import.meta.url).pathname`. Always check your Node version if you see "\_\_dirname is not defined".

Also: `readdir` without `recursive: true` is **not** recursive. A common mistake is assuming it walks subdirectories — it returns only the immediate children. Use `{ recursive: true }` or `fs.glob` with a double-star pattern when you need the full tree.

## What you learned

- `path.join` assembles paths safely; `path.resolve` always produces an absolute path anchored to cwd.
- `path.basename`, `dirname`, and `extname` dissect a path string without touching the disk.
- `mkdir({ recursive: true })` creates nested directories idempotently.
- `readdir({ withFileTypes: true })` gives `Dirent` objects so you can classify entries cheaply.
- `fs.rm({ recursive: true, force: true })` is the modern `rm -rf`.
- `fs.glob` (Node 22+) finds files by pattern without a third-party library.

## Next steps

Now that you can navigate and manipulate directories, the next challenge is reacting to changes in real time — watching files and directories for modifications.
*/});
