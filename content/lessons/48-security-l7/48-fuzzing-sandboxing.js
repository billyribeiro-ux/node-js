registerLessonSrc("48-fuzzing-sandboxing", function () {/*
---
id: 48-fuzzing-sandboxing
title: "Fuzzing, Sandboxing & Isolation"
minutes: 30
level: principal
objectives:
  - Apply coverage-guided fuzzing and property-based testing to find security bugs in Node.js code
  - Understand why vm.runInNewContext is NOT a security boundary and what real isolation requires
  - Design capability-based isolation using separate processes, the permission model, and containers
---

# Fuzzing, Sandboxing & Isolation

## Why this matters

Security vulnerabilities rarely announce themselves during happy-path testing. Fuzzing and property-based testing are the automated techniques that find the edge cases — the malformed input that triggers a buffer overflow in a native addon, the regex that ReDoS-hangs the event loop, the JSON parser that allocates 4 GB on a crafted input. And when untrusted code does run inside your system (plugins, user-defined transforms, serverless functions), the question is not "can we stop all attacks?" but "when this code is hostile, how do we bound what it can damage?" That question demands real isolation, not the false comfort of `vm.runInNewContext`.

## Learning objectives

- Understand **coverage-guided fuzzing** (jsfuzz, Jazzer.js model) and how it differs from random testing.
- Use **property-based testing** (fast-check) to define security-relevant invariants that must hold over all inputs.
- Apply **delta-debugging** to shrink a failing input to its minimal reproducer.
- Explain precisely why `vm.Script` / `vm.runInNewContext` is **not a security boundary**.
- Design real isolation: separate process + Node permission model + seccomp + container.
- Apply **capability-based design** to limit what any component can reach.

## Coverage-guided fuzzing: how it actually works

A **fuzzer** generates inputs, feeds them to a target function, and monitors for crashes or hangs. A *random* fuzzer is slow because most random inputs are rejected by early validation checks. A **coverage-guided fuzzer** (AFL, libFuzzer, Jazzer) instruments the target to observe which branches execute, then uses a genetic algorithm to mutate the corpus toward *unexplored branches* — inputs that reach deep into the parsing or processing logic.

For JavaScript:

- **jsfuzz** wraps a `fuzz(buf: Buffer)` export and runs libFuzzer under the hood via N-API. It requires a native build but gives true coverage feedback.
- **Jazzer.js** (by Code Intelligence) brings Java's Jazzer approach to Node — coverage instrumentation via Babel, corpus management, and libFuzzer integration.
- For pure-JS logic without native deps, **fast-check** property-based testing is the pragmatic middle ground: it generates thousands of structured inputs and shrinks failures automatically.

```js
// fuzz-target.js — jsfuzz harness (read-only: requires native build)
// jsfuzz calls this with generated Buffer inputs.
module.exports.fuzz = function (buf) {
  try {
    // The function under test — e.g., your custom YAML parser
    parseYaml(buf.toString('utf8'));
  } catch (e) {
    // Expected errors (syntax errors in the input) are fine.
    // Unexpected errors (RangeError, TypeError) indicate a bug.
    if (!(e instanceof SyntaxError)) throw e;
  }
};
```

```bash
# Run jsfuzz for 60 seconds against the harness
jsfuzz fuzz-target.js --fuzz --timeout 60
```

> [!OUTPUT]
> INFO: Seed: 2583941728
> INFO: Loaded 1 modules   (512 inline 8-bit counters)
> #2   INITED cov: 23 ft: 23 corp: 1/1b exec/s: 0 rss: 35Mb
> #512 NEW    cov: 41 ft: 58 corp: 3/12b exec/s: 512 rss: 36Mb
> #8192 NEW   cov: 67 ft: 89 corp: 9/312b exec/s: 8192 rss: 38Mb

When the fuzzer finds a crash, it saves the minimal reproducer to `crash-*`. Feed that file back with `--artifact_prefix` to reproduce deterministically.

## Property-based testing with fast-check

Property-based testing lets you express **security invariants** that must hold for all inputs in a domain, then automatically generates thousands of cases to falsify them.

```js
// properties-test.mjs (read-only — runs under a test runner)
import fc from 'fast-check';
import { sanitize } from './sanitize.mjs';

// Property: sanitized output must NEVER contain a script tag, regardless of input
fc.assert(
  fc.property(fc.string(), input => {
    const out = sanitize(input);
    return !/<script/i.test(out);
  }),
  { numRuns: 10000 }
);

// Property: output length must never exceed input length (no amplification)
fc.assert(
  fc.property(fc.string(), input => {
    return sanitize(input).length <= input.length;
  }),
  { numRuns: 10000 }
);
```

When fast-check finds a counterexample it **shrinks** it: it applies a bisection-style minimization to find the smallest input that still fails the property. This is the same idea as delta-debugging, but integrated into the framework.

> [!PRINCIPAL]
> Property-based testing is most powerful when the property is a **security invariant**, not a functional one. "Output equals expected" tests only the cases you imagined. "Output never contains `<script`" tests all inputs you didn't imagine. Security bugs almost always live in the cases you didn't imagine — which is exactly what the fuzzer explores. At L7 you should be defining security properties in the same PR that introduces a new parser, codec, or input-handling path.

## Delta-debugging: minimizing failure inputs

When a fuzzer or a production crash gives you a 50 KB input that triggers a bug, you need the **minimum reproducer** — the smallest input that still triggers the same failure. **Delta-debugging** (Andreas Zeller, 2002) formalizes this as a binary-search over input subsets:

1. Split the failing input into two halves.
2. Test each half: if one half still fails, recurse on it.
3. If neither half fails, the bug requires interaction between parts — try removing smaller subsets (1/4, 1/8, …).
4. Terminate when no single removal preserves the failure.

The resulting input is **1-minimal**: no single character or byte can be removed without fixing the bug. This is invaluable both for filing bug reports and for root-cause analysis.

## vm.Script is NOT a security sandbox

This is one of the most persistent and dangerous misconceptions in the Node.js ecosystem:

```js
// THIS IS NOT SAFE — vm gives NO security guarantee
const vm = require('node:vm');
const ctx = vm.createContext({ console });
vm.runInNewContext('console.log(process.version)', ctx);
// Output: v24.x.y  — process is reachable through prototype chains
```

The `vm` module documentation explicitly states: *"The node:vm module is not a security mechanism. Do not use it to run untrusted code."* The reason is structural: all JavaScript objects in a V8 isolate share the same heap. A `vm.Context` is a separate *global object* but still the *same isolate*. Prototype chain traversal (`({}).constructor.constructor('return process')()`) can escape the context. Numerous CVEs have demonstrated this. The Node.js security team's position is clear: fixing vm escapes is out of scope.

```js
// Classic vm escape (illustrative — do not run untrusted code this way)
const vm = require('node:vm');
const ctx = vm.createContext({});
// Attacker gains access to process via prototype chain
const result = vm.runInNewContext(
  `this.constructor.constructor('return process')()`,
  ctx
);
// result is the real Node.js process object — full access
```

> [!PITFALL]
> Every few months a package appears on npm claiming to be a "secure sandbox" built on `vm`. It is not. The V8 isolate boundary is the relevant security boundary, not the `vm.Context` boundary. If you need to run untrusted JavaScript, you need a separate OS process or a purpose-built isolate (Cloudflare's `workerd`, Deno's permission model in a subprocess, or a dedicated container).

## Real isolation: the correct architecture

Isolation must be enforced at the OS level, not at the language level. The layered model:

**Layer 1: Separate process.**
Spawn untrusted code as a child process via `child_process.fork` or `spawn`. The process boundary means the untrusted code cannot access the parent's memory, file descriptors (unless explicitly inherited), or event loop.

**Layer 2: Node permission model.**
Start the child with `--experimental-permission` and grant only what it needs:

```bash
node --experimental-permission \
     --allow-fs-read=/tmp/sandbox-inputs \
     --allow-fs-write=/tmp/sandbox-outputs \
     plugin-runner.mjs
```

The permission model is enforced in Node's C++ layer — it cannot be bypassed by JavaScript. Any attempt to open a file outside the allowed paths throws `ERR_ACCESS_DENIED` before the syscall reaches the kernel.

**Layer 3: seccomp (Linux) / Seatbelt (macOS).**
Even with the permission model, the process can still make arbitrary syscalls. A seccomp-BPF filter whitelist reduces the syscall surface to exactly what Node needs:

```bash
# Using Docker with a custom seccomp profile
docker run --security-opt seccomp=node-minimal.json my-sandbox-image
```

**Layer 4: Container / VM boundary.**
For highest assurance, run the untrusted code in a separate container (same kernel, but separate namespaces and cgroups) or a microVM (Firecracker, gVisor). Cloudflare Workers uses V8 isolates (separate V8 instance, not just context) with `workerd`, plus OS-level sandboxing.

```js
// Correct pattern: fork a child, send work via IPC, kill if it misbehaves
const { fork } = require('node:child_process');

function runUntrusted(code, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = fork('./sandbox-worker.mjs', [], {
      execArgv: [
        '--experimental-permission',
        '--allow-fs-read=/tmp/inputs',
      ],
      serialization: 'advanced',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('sandbox timeout'));
    }, timeoutMs);
    child.on('message', msg => { clearTimeout(timer); child.kill(); resolve(msg); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.send({ code });
  });
}
```

> [!PRINCIPAL]
> Cloudflare's `workerd` runtime and Deno Deploy demonstrate that production-grade JS sandboxing requires at minimum: (1) a separate V8 isolate instance (not just a Context), (2) a custom event loop that doesn't expose Node's built-in modules, (3) OS-level seccomp/namespace isolation, and (4) resource accounting (CPU time, memory) enforced outside the isolate. If your use case can tolerate ~100 ms cold-start, Firecracker microVMs give near-VM isolation at container-like density — AWS Lambda uses them. Do not try to replicate this with `vm`. It has been tried; it has always failed.

## Capability-based design

The principle of least privilege, applied at the design level, means every component should receive *only the capabilities it needs* — not because of access-control lists checked at runtime, but because it structurally cannot reach anything else. This is **capability-based design**:

- A plugin receives a `context` object with only `{ readInput, writeOutput, log }` — no reference to the database, the HTTP client, or the filesystem.
- The HTTP client module is constructed with a base URL and credential token; it cannot be reconfigured to point elsewhere.
- The database module is injected as a parameter; a component that never receives it cannot query it, regardless of what code runs inside it.

This is structurally different from RBAC: RBAC checks permissions at runtime and can be bypassed by privilege escalation; capability-based design makes escalation structurally impossible because the reference simply does not exist.

## Try it yourself

This delta-debugging minimizer implements the core algorithm in pure browser JS. Give it a failing string and a predicate (the bug reproducer), and it finds the smallest substring that still triggers the failure.

```js run
// Delta-debugging minimizer: finds the 1-minimal failing input.
// Based on Zeller & Hildebrandt (2002), "Simplifying and Isolating
// Failure-Inducing Input."

function deltaDebug(input, test) {
  // test(s) returns true if s still reproduces the failure
  const chars = [...input]; // work with character array

  function tryRemove(arr, start, len) {
    // Try removing chars[start..start+len-1]
    const candidate = [...arr.slice(0, start), ...arr.slice(start + len)];
    return { candidate, passes: test(candidate.join('')) };
  }

  let current = chars;
  let granularity = 2; // start by splitting into 2 halves

  while (current.length > 1) {
    const n = current.length;
    const chunkSize = Math.ceil(n / granularity);
    let reduced = false;

    for (let i = 0; i < granularity; i++) {
      const start = i * chunkSize;
      const len = Math.min(chunkSize, n - start);
      if (len <= 0) continue;

      const { candidate, passes } = tryRemove(current, start, len);
      if (passes) {
        current = candidate;
        granularity = Math.max(granularity - 1, 2);
        reduced = true;
        break;
      }
    }

    if (!reduced) {
      if (granularity >= current.length) break; // 1-minimal
      granularity = Math.min(granularity * 2, current.length);
    }
  }

  return current.join('');
}

// Example: find the minimal input that causes a simulated "SQL injection" detector
// to flag a string as dangerous.
function containsSqlInjection(s) {
  // Simplified: true if string contains a quote followed by SQL keyword
  return /['"]\s*(or|and|union|select|drop)\b/i.test(s);
}

// Start with a long malicious input with lots of padding
const bigInput = "hello world this is padding ' OR 1=1 -- more padding filler text here";

console.log('Original input:', JSON.stringify(bigInput));
console.log('Original length:', bigInput.length);
console.log('Reproduces bug:', containsSqlInjection(bigInput));
console.log();

const minimal = deltaDebug(bigInput, containsSqlInjection);
console.log('Minimized input:', JSON.stringify(minimal));
console.log('Minimized length:', minimal.length);
console.log('Still reproduces bug:', containsSqlInjection(minimal));
console.log(`Reduction: ${bigInput.length} → ${minimal.length} chars`);

// Demonstrate with a ReDoS pattern
function triggersRedos(s) {
  // Vulnerable regex: catastrophic backtracking on input like 'aaa...a!'
  // We simulate it with a simpler check for the demo
  return /^(a+)+$/.test(s) && s.length > 5 && s.endsWith('b');
}

const bigRedosInput = 'aaaaaaaaaaaaaaaaaab';
console.log('\n--- ReDoS minimization ---');
console.log('Original:', JSON.stringify(bigRedosInput));
const minimalRedos = deltaDebug(bigRedosInput, triggersRedos);
console.log('Minimized:', JSON.stringify(minimalRedos));
```

## Exercise

**Exercise:** Extend the delta-debugging minimizer to work on arrays of arbitrary tokens (not just character strings). Use it to minimize a failing JSON array input — for example, find the smallest subarray of a 20-element array that still triggers a hypothetical "array with duplicate adjacent values" invariant violation.

<details>
<summary>Show solution</summary>

```js run
function deltaDebugArray(input, test) {
  let current = [...input];
  let granularity = 2;

  while (current.length > 1) {
    const n = current.length;
    const chunkSize = Math.ceil(n / granularity);
    let reduced = false;

    for (let i = 0; i < granularity; i++) {
      const start = i * chunkSize;
      const len = Math.min(chunkSize, n - start);
      if (len <= 0) continue;

      const candidate = [...current.slice(0, start), ...current.slice(start + len)];
      if (test(candidate)) {
        current = candidate;
        granularity = Math.max(granularity - 1, 2);
        reduced = true;
        break;
      }
    }

    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(granularity * 2, current.length);
    }
  }
  return current;
}

// Invariant: array must not contain adjacent duplicate values
function hasAdjacentDuplicates(arr) {
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] === arr[i + 1]) return true;
  }
  return false;
}

// 20-element array with duplicates buried in the middle
const bigArray = [1, 2, 3, 5, 7, 11, 13, 17, 42, 42, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59];
console.log('Original length:', bigArray.length);
console.log('Reproduces bug:', hasAdjacentDuplicates(bigArray));

const minimal = deltaDebugArray(bigArray, hasAdjacentDuplicates);
console.log('Minimized:', JSON.stringify(minimal));
console.log('Minimized length:', minimal.length);
console.log('Still reproduces bug:', hasAdjacentDuplicates(minimal));
// Expect: [42, 42] — the exact minimal reproducer
```

</details>

## Project

### Threat-Model a Platform End-to-End, Reach SLSA L2, Add a Fuzzing Harness, and Sandbox Untrusted Code

You will apply the full security engineering stack from this module to a realistic Node.js platform: a multi-tenant plugin execution service that accepts user-uploaded JavaScript plugins, runs them against provided data, and returns results.

**Acceptance criteria:**

1. **Threat model.** Produce a written DFD (as a comment or Markdown file) for the platform covering at least: browser → API gateway → plugin runner → result store trust boundaries. Apply STRIDE to each boundary crossing. Identify at least three security invariants and encode two of them as automated property-based tests (fast-check).

2. **SLSA level.** Configure a GitHub Actions workflow that uses the official `slsa-framework/slsa-github-generator` to produce a signed SLSA L2 provenance attestation for the platform's build artifact. The workflow must run `npm ci` (not `npm install`) and pin the Node version by hash. Verify the attestation with `cosign verify-attestation`.

3. **SBOM.** Add a CI step that generates a CycloneDX SBOM (`@cyclonedx/cyclonedx-npm`), attaches it as a workflow artifact, and scans it with `grype`. The pipeline must fail if any direct dependency has a CRITICAL CVE with a known fix.

4. **Fuzzing harness.** Write a jsfuzz-compatible `fuzz(buf)` export for the plugin runner's input-parsing function. The harness must: (a) suppress expected `SyntaxError` and `TypeError` from malformed inputs, (b) re-throw any unexpected error class (potential bug), and (c) track the maximum input length that reached the core parsing logic (as a coverage proxy). Include a 30-second run in CI (`jsfuzz --fuzz --timeout 30`).

5. **Sandboxed plugin execution.** Implement a `runPlugin(code, inputData)` function that: (a) spawns the plugin in a separate child process using `node:child_process.fork`, (b) passes `--experimental-permission` with only `--allow-fs-read=/tmp/plugin-inputs` and `--allow-fs-write=/tmp/plugin-outputs` to the child, (c) enforces a 5-second wall-clock timeout via `SIGKILL`, and (d) communicates via structured IPC messages (no shell interpolation of user code). Demonstrate that a plugin attempting `require('node:fs').readFileSync('/etc/passwd')` throws `ERR_ACCESS_DENIED` rather than returning content.

6. **Delta-debugging integration.** When the fuzzing harness finds a crashing input, automatically run the delta-debugging minimizer (starter below) to shrink it before saving to the `crashes/` directory. The saved file must be the 1-minimal reproducer, not the raw fuzzer output.

**Starter — delta-debugging minimizer (the pure-logic core, runs in browser):**

```js run
// Delta-debugging minimizer — portfolio project starter.
// This is the pure-logic core you will integrate with your fuzzing harness.

function deltaDebug(input, test) {
  const chars = [...input];
  let current = chars;
  let granularity = 2;

  while (current.length > 1) {
    const n = current.length;
    const chunkSize = Math.ceil(n / granularity);
    let reduced = false;

    for (let i = 0; i < granularity; i++) {
      const start = i * chunkSize;
      const len = Math.min(chunkSize, n - start);
      if (len <= 0) continue;
      const candidate = [...current.slice(0, start), ...current.slice(start + len)];
      if (test(candidate.join(''))) {
        current = candidate;
        granularity = Math.max(granularity - 1, 2);
        reduced = true;
        break;
      }
    }

    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(granularity * 2, current.length);
    }
  }
  return current.join('');
}

// Simulate a plugin parser that crashes on inputs containing
// a null byte followed by a specific control sequence
function pluginParser(src) {
  if (src.includes('\x00\x1b[')) throw new RangeError('terminal escape in source');
  return { ok: true, tokens: src.split(/\s+/).length };
}

function fuzzTest(input) {
  try {
    pluginParser(input);
    return false; // no crash
  } catch (e) {
    return e instanceof RangeError; // crash preserved
  }
}

// Simulate a fuzzer-found crashing input (lots of noise around the trigger)
const fuzzerCrash = 'function foo() { return 42; }\n' +
  'const x = 1 + 2;\n'.repeat(10) +
  'let z = "\x00\x1b[31m";\n' +
  'export default foo;\n' +
  'const y = "padding".repeat(100);\n';

console.log('Fuzzer crash length:', fuzzerCrash.length, 'chars');
console.log('Reproduces crash:', fuzzTest(fuzzerCrash));

const minimal = deltaDebug(fuzzerCrash, fuzzTest);
console.log('\nMinimized crash length:', minimal.length, 'chars');
console.log('Minimized:', JSON.stringify(minimal));
console.log('Still crashes:', fuzzTest(minimal));
console.log(`Reduction ratio: ${((1 - minimal.length / fuzzerCrash.length) * 100).toFixed(1)}%`);

// Show the security invariant this catches:
console.log('\nSecurity invariant: plugin source must never contain terminal escape sequences.');
console.log('A plugin containing \\x00\\x1b[ could manipulate terminal output logs.');
```

## Common pitfalls

> [!PITFALL]
> **Using `vm.runInNewContext` and believing it is sandboxed.** This is the single most common security mistake in Node.js plugin systems. Every npm package that claims to sandbox code with `vm` is wrong. The only safe answer is a separate OS process with restricted permissions. If you see a PR that adds `vm`-based sandboxing, flag it immediately — it is not defense, it is a false sense of security that may actually make the codebase *less* secure by removing pressure to implement real isolation.

A second pitfall: running the fuzzer in CI with a token budget that is too low to be meaningful. Ten seconds of fuzzing explores roughly 50,000 inputs — enough to find trivial crashes but not deep parser bugs. Real fuzzing runs for hours or days on dedicated infrastructure. CI fuzzing should be treated as a regression check (replaying the corpus, not exploring new paths) once you have a seed corpus from longer offline runs.

## What you learned

- **Coverage-guided fuzzing** (jsfuzz, Jazzer.js) instruments code to drive inputs toward unexplored branches; fast-check property-based testing complements it by testing security invariants over structured input domains.
- **Delta-debugging** finds the 1-minimal input that reproduces a failure, making crashes actionable for root-cause analysis.
- `vm.Script` / `vm.runInNewContext` is **not a security boundary** — prototype chain escapes give full `process` access; this is documented and will not be fixed.
- Real isolation requires: separate OS process + Node permission model (`ERR_ACCESS_DENIED`) + seccomp + (optionally) container/microVM.
- **Capability-based design** makes privilege escalation structurally impossible by not granting references to sensitive resources in the first place.
- A complete security engineering posture combines threat modeling (lesson 1), supply-chain integrity (lesson 2), and runtime isolation + fuzzing (this lesson).

## Next steps

You have now worked through the full Tier 6 security engineering stack: threat modeling and trust boundaries, SLSA provenance and supply-chain hardening, and runtime fuzzing and isolation. The natural next frontier is **incident response and forensics** — how to detect, contain, and learn from breaches in production Node.js systems.
*/});
