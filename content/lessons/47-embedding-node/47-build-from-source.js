registerLessonSrc("47-build-from-source", function () {/*
---
id: 47-build-from-source
title: "Building Node from Source & Custom Builds"
minutes: 28
level: advanced
objectives:
  - Walk through the Node build system (GN, ninja, V8, libuv, deps/) and know which flag does what
  - Apply build-time flags for static linking, LTO, custom ICU, and V8 options for real use cases
  - Reason about ABI stability, NODE_MODULE_VERSION, and when a custom build actually pays off
---

# Building Node from Source & Custom Builds

## Why this matters

Nearly every Node engineer treats the runtime as a black box fetched from nodejs.org. That works
until it doesn't: you need a security backport before the upstream release, you want to vendor a
patched version of OpenSSL, you need a fully-static binary for a scratch container, or your
compliance team demands a reproducible, auditable build with a specific ICU locale dataset. At
the distinguished-engineer level you own the platform, not just the code running on it.

## Learning objectives

- Walk through the Node build system: GN, ninja, V8, libuv, and the `deps/` subtree.
- Apply build-time flags (`--fully-static`, `--enable-lto`, `--v8-options`, custom ICU) for
  real use cases and reason about their tradeoffs.
- Understand ABI stability, `NODE_MODULE_VERSION`, and `process.versions` versioning invariants.

## The Build System in Depth

Node is built with **GN** (Generate Ninja) for its configuration layer and **Ninja** for the
actual compilation. The top-level `./configure` wrapper is a Python script that invokes GN and
writes `out/Release/build.ninja` (or `out/Debug/`). Do not think of it as autoconf — GN is
a declarative meta-build system designed by the Chromium team and shared with V8.

```
node/
├── configure           ← Python GN wrapper (the entry point you call)
├── configure.py        ← main configuration logic
├── node.gyp            ← legacy GYP (gradually being replaced by GN)
├── BUILD.gn            ← GN build definition root
├── deps/
│   ├── v8/             ← V8 engine — the biggest subdep by far
│   ├── uv/             ← libuv (async I/O, thread pool)
│   ├── openssl/        ← static OpenSSL (unless --shared-openssl)
│   ├── zlib/           ← compression
│   ├── llhttp/         ← HTTP/1.1 parser (replaces http_parser)
│   ├── ada/            ← WHATWG URL parser (replaces url.parse)
│   ├── simdutf/        ← SIMD-accelerated UTF-8 transcoding
│   ├── cares/          ← c-ares async DNS
│   └── icu-small/      ← small-icu locale data (or full-icu)
├── lib/                ← Node's JavaScript standard library
├── src/                ← Node's C++ layer (node.cc, env.cc, …)
└── out/Release/        ← build artifacts (node binary, .node addons)
```

The `deps/` subtree is **vendored at exact commits** — not pulled from package managers. This is
intentional: reproducibility and security. When a dep has a CVE, the Node security team backports
the patch into `deps/` and releases a security line.

### Configure → Ninja → Binary

```bash
# Step 1: clone and choose a tag
git clone https://github.com/nodejs/node.git
cd node
git checkout v24.0.0

# Step 2: configure (GN phase)
./configure --release-urlbase=https://internal.corp/dist \
            --enable-lto \
            --with-intl=full-icu \
            --openssl-no-asm  # if cross-compiling to a different arch

# Step 3: build (Ninja phase) — parallelise with -j
make -j$(nproc)

# Step 4: optional install
make install DESTDIR=/opt/node24
```

> [!OUTPUT]
> configuring build
> creating out/Release/build.ninja
> ...
> LINK(target) out/Release/node
> Binary: out/Release/node

### Key Build Flags

| Flag | Effect | When to use |
|------|--------|-------------|
| `--fully-static` | Links `libc`, `libstdc++`, `libgcc` statically | Scratch containers, musl-based Alpine |
| `--enable-lto` | Link-Time Optimisation (LLVM `--lto=thin` by default) | Production builds; 5–15% smaller binary, ~2–5% throughput gain |
| `--with-intl=full-icu` | Bundle the full ICU locale dataset (~25 MB) | Apps doing i18n/date formatting in all locales |
| `--with-intl=small-icu` | Minimal ICU (English + root, ~2 MB) | Default; good for most server workloads |
| `--with-intl=system-icu` | Use OS-installed ICU | Distro packages; ICU version can drift |
| `--shared-openssl` | Link against system OpenSSL dynamically | When the OS security team patches OpenSSL faster than Node upstream |
| `--openssl-no-asm` | Disable ASM optimisations in OpenSSL | Cross-compilation, or when targeting a CPU without the ASM path |
| `--v8-options=...` | Pass V8 flags baked into the binary defaults | Experimental — mainly for benchmarking |
| `--debug` | Build the `out/Debug` target with full DWARF | Debugging crashes in C++ land |

> [!PRINCIPAL] `--fully-static` and musl
> On Alpine Linux, glibc is absent; you need musl. `--fully-static` links everything in so the
> resulting `node` binary has zero dynamic dependencies (`ldd node` → `not a dynamic executable`).
> The tradeoff: DNS resolution falls back to the built-in c-ares async resolver rather than
> glibc's `getaddrinfo`, which has subtly different search-domain behaviour. Test your DNS lookups
> in CI if you ship a statically linked Node binary.

### V8 Build Options

V8 has its own GN configuration surface, exposed through `--v8-options` at runtime but also
controllable at build time via `GYP_DEFINES` or GN args. Useful at build time:

```bash
# Enable pointer compression (saves ~40% heap on 64-bit, limits heap to 4 GB)
./configure --v8-options="--experimental-wasm-gc"

# Inspect all V8 flags available in your built binary:
./out/Release/node --v8-options | less
```

The V8 JIT pipeline in Node 24 has four tiers:
1. **Ignition** — bytecode interpreter; starts immediately.
2. **Sparkplug** — non-optimising native-code compiler; very fast to compile, modest speedup.
3. **Maglev** — mid-tier optimising compiler (added in V8 10.x); fills the gap between Sparkplug
   and TurboFan.
4. **TurboFan** — the full optimising compiler; expensive to compile, peak throughput.

Build flags do not select tiers — tiers are selected at runtime based on call-frequency counters
— but they do affect which tier features are compiled in.

## ABI Stability and NODE_MODULE_VERSION

Every Node release exposes a `NODE_MODULE_VERSION` constant (visible at `process.versions.modules`).
Native addons compiled against one version **cannot** load against a different version without
recompilation, because the C++ ABI of V8 and Node's embedding layer changes between major versions.

```bash
node -e "console.log(process.versions)"
```

> [!OUTPUT]
> {
>   node: '24.0.0',
>   v8: '12.8.374.1-node.3',
>   uv: '1.49.0',
>   zlib: '1.3.0.1-motley-82a5b30',
>   ares: '1.28.1',
>   modules: '127',
>   napi: '9',
>   openssl: '3.0.14+quic1',
>   unicode: '15.1',
>   icu: '75.1',
>   ...
> }

`modules: '127'` is `NODE_MODULE_VERSION`. If you build a custom Node with a backported patch
from main, this stays the same for the same major version — that is intentional.

**Node-API (N-API/`napi`)** exists precisely to decouple native addon ABI from `NODE_MODULE_VERSION`.
An addon built against N-API `napi: 9` loads without recompilation on any future Node version
that supports N-API 9+. For new native addons, always target Node-API.

> [!PRINCIPAL] Why custom builds break managed addon installs
> `npm install` runs `node-pre-gyp` or `prebuild` to download pre-compiled `.node` binaries
> keyed by `NODE_MODULE_VERSION` + platform + arch. A custom Node binary — even with a single
> backported commit — has the same `MODULE_VERSION` as the official release and therefore fetches
> the same pre-built addon. Where this **silently breaks**: if you compiled Node with a different
> V8 or added custom patches that shift the V8 internal ABI, the addon will crash at runtime with
> `Error: Module did not self-register` or a SIGSEGV. Pin your addons' native modules and run
> your addon test suite against every custom build in CI.

## CI for Custom Builds

A pragmatic CI pattern for a custom Node build:

```bash
# .github/workflows/custom-node-build.yml (conceptual)
# 1. Cache the source checkout keyed on the Node version + patch hash
# 2. Apply patches from patches/ directory
# 3. ./configure with your flags
# 4. make -j$(nproc)
# 5. Run Node's own test suite subset: make test-only
# 6. Build your app against the custom binary; run your integration suite
# 7. Publish the binary to an internal artifact store keyed by sha256
```

Key points:
- Gate the build on `make test-only` passing — Node's test suite catches regressions in your patches.
- Compute and publish `sha256` of the binary alongside it; your deployment tooling verifies it.
- Store the full `./configure` invocation as a text artifact so any engineer can reproduce the build.

## Build-Config Validator — Try It Yourself

Before running a two-hour `make`, it is worth checking your flag set for conflicts. The block
below simulates a validator that catches common contradictions and surface implications.

```js run
// Build-config validator — pure logic, no Node APIs needed
const IMPLICATIONS = [
  {
    when: f => f.includes("--fully-static"),
    implies: "--openssl-no-asm (static builds usually cross-target; ASM may not match)",
    warn: false,
  },
  {
    when: f => f.includes("--shared-openssl"),
    implies: null,
    conflictWith: "--fully-static",
    msg: "--shared-openssl conflicts with --fully-static: cannot dynamically link in a static build",
  },
  {
    when: f => f.includes("--with-intl=system-icu"),
    implies: null,
    conflictWith: "--with-intl=full-icu",
    msg: "Cannot specify both system-icu and full-icu",
  },
  {
    when: f => f.includes("--enable-lto") && f.includes("--debug"),
    implies: null,
    msg: "--enable-lto + --debug: LTO strips debug info; use --debug alone for debuggable builds",
  },
];

function validateBuildFlags(flags) {
  const issues = [];
  for (const rule of IMPLICATIONS) {
    if (!rule.when(flags)) continue;
    if (rule.conflictWith && flags.includes(rule.conflictWith)) {
      issues.push({ level: "ERROR", msg: rule.msg });
    } else if (rule.msg && !rule.conflictWith) {
      issues.push({ level: "WARN", msg: rule.msg });
    } else if (rule.implies) {
      issues.push({ level: "INFO", msg: "Implied: " + rule.implies });
    }
  }
  return issues;
}

const testCases = [
  ["--fully-static", "--shared-openssl", "--enable-lto"],
  ["--fully-static", "--with-intl=full-icu", "--enable-lto"],
  ["--enable-lto", "--debug"],
  ["--with-intl=full-icu", "--enable-lto"],
];

for (const flags of testCases) {
  const issues = validateBuildFlags(flags);
  console.log("Flags:", flags.join(" "));
  if (issues.length === 0) {
    console.log("  OK — no conflicts detected");
  } else {
    for (const issue of issues) {
      console.log(`  [${issue.level}] ${issue.msg}`);
    }
  }
  console.log();
}
```

## Exercise: Identify the Right Build Profile

You have three deployment targets:

1. Alpine-based scratch container, no glibc, needs to run `node index.mjs` with full i18n support.
2. Ubuntu 24.04 host, the OS security team patches OpenSSL weekly; you want to inherit those patches.
3. A benchmark environment where you want peak throughput and are willing to spend 40 minutes building.

For each, list the flags you would use and explain why.

<details>
<summary>Show solution</summary>

**Target 1 — Alpine scratch:**
`--fully-static --with-intl=full-icu`
Static linking removes the glibc dependency. Full-ICU for i18n. No `--shared-openssl` (nothing to
link against). Consider `--enable-lto` for a smaller binary in the container image.

**Target 2 — Ubuntu + OS-patched OpenSSL:**
`--shared-openssl`
This means the node binary dynamically links against `/usr/lib/x86_64-linux-gnu/libssl.so.3`.
When the OS team does `apt upgrade openssl`, your Node process immediately gets the patched version
on next start — no Node rebuild required. Trade-off: your binary is not portable to machines with
a different OpenSSL version.

**Target 3 — Benchmark:**
`--enable-lto --with-intl=small-icu`
LTO enables the linker to inline and optimise across translation units — particularly important for
the hot paths in V8's JIT calling conventions and Node's I/O dispatch. Small-ICU keeps the binary
lean. Do **not** use `--debug` (it disables optimisation and adds instrumentation overhead).

```js run
// Simulate a "build profile recommender" decision tree
function recommendProfile(target) {
  const flags = [];
  if (target.os === "alpine" || target.staticRequired) {
    flags.push("--fully-static");
  }
  if (target.osManagesOpenssl) {
    flags.push("--shared-openssl");
  }
  if (target.fullI18n) {
    flags.push("--with-intl=full-icu");
  } else {
    flags.push("--with-intl=small-icu");
  }
  if (target.benchmark && !target.debug) {
    flags.push("--enable-lto");
  }
  if (target.debug) {
    flags.push("--debug");
  }
  return flags;
}

const targets = [
  { name: "Alpine scratch", os: "alpine", staticRequired: true, fullI18n: true },
  { name: "Ubuntu + OS OpenSSL", osManagesOpenssl: true, fullI18n: false },
  { name: "Benchmark host", benchmark: true, fullI18n: false },
];

for (const t of targets) {
  console.log(t.name + ":", recommendProfile(t).join(" "));
}
```

</details>

## Common Pitfalls

> [!PITFALL] Building Node on a machine with the wrong LLVM version
> Node's `--enable-lto` uses Thin LTO via clang/LLVM. If your CI uses GCC, LTO still works but
> uses GCC's IR format, which is subtly different. Mixing clang and GCC in the same build
> (e.g., clang for V8 sub-deps, GCC for your C++ layer) produces linker errors or silent
> mis-optimisations. Pin your compiler toolchain. The Node CI uses clang; mirror it in your builds.
> Also: `make -j$(nproc)` will OOM on machines with < 2 GB RAM per core when building V8.
> Rule of thumb: allow 3 GB per parallel job when building with LTO.

## What You Learned

- Node uses GN + Ninja; `./configure` is a Python GN wrapper, not autoconf.
- `deps/` is a vendored snapshot — security patches land there before upstream releases.
- `--fully-static` removes dynamic deps; `--shared-openssl` delegates security patching to the OS.
- `--enable-lto` gives 5–15% binary size reduction and throughput gains at the cost of build time.
- `NODE_MODULE_VERSION` (`process.versions.modules`) governs native addon ABI; Node-API (N-API) is
  the stable alternative that survives major version upgrades.
- Custom builds require an end-to-end CI pipeline including `make test-only` and sha256 attestation.

## Next steps

Now that you can build and customise the runtime itself, the next lesson goes one level deeper:
embedding the Node runtime inside a host C/C++ application using the embedder API.
*/});
