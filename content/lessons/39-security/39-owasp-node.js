registerLessonSrc("39-owasp-node", function () {/*
---
id: 39-owasp-node
title: "Prototype Pollution, ReDoS, SSRF & More"
minutes: 28
level: principal
objectives:
  - Exploit and prevent prototype pollution in object-merge scenarios
  - Identify catastrophic backtracking in regular expressions and apply safe alternatives
  - Recognise SSRF, insecure deserialization, and injection patterns in Node code
---

# Prototype Pollution, ReDoS, SSRF & More

## Why this matters

The OWASP Top 10 is not a list of exotic academic vulnerabilities — it is a ranked list of the vulnerabilities that real attackers actually exploit in real applications today. Node.js has its own flavour of many of them, plus a few that are nearly unique to the JavaScript runtime: prototype pollution and ReDoS can be triggered with a single crafted HTTP request, turning a seemingly harmless merge utility or regex into a complete denial-of-service or privilege-escalation vector. Principal engineers know these attack patterns cold and design systems that cannot be put into those states.

## Learning objectives

- Understand **prototype pollution**: how JavaScript's prototype chain is exploited, what damage it causes, and how to prevent it with a guarded merge.
- Understand **ReDoS** (Regular Expression Denial of Service): what catastrophic backtracking is and how to write safe patterns.
- Recognise **SSRF** (Server-Side Request Forgery) and understand how to validate and restrict outbound requests.
- Identify **injection** (SQL, command, log) and **insecure deserialization** patterns in Node.js.
- Map these vulnerabilities to the **OWASP Top 10** categories.

## OWASP Top 10 and Node.js

The OWASP Top 10 (2021 edition) maps cleanly to Node-specific vulnerabilities:

| OWASP Category | Node.js manifestation |
|---|---|
| A01 Broken Access Control | IDOR, JWT role tampering, path traversal |
| A02 Cryptographic Failures | Weak JWT secrets, HTTP in production, short salts |
| A03 Injection | SQL injection, command injection, log injection |
| A04 Insecure Design | Missing threat model, no rate limits, wide trust zones |
| A05 Security Misconfiguration | Debug endpoints in prod, verbose error responses, default secrets |
| A06 Vulnerable Components | Outdated dependencies with known CVEs |
| A07 Auth Failures | Weak passwords, no MFA, session fixation |
| A08 Integrity Failures | Prototype pollution, insecure deserialization, no SRI |
| A09 Logging Failures | Missing audit logs, PII in logs, log injection |
| A10 SSRF | Unrestricted fetch to attacker-controlled URLs |

Let's dig into the most Node-specific ones.

## Prototype Pollution

### How it works

Every JavaScript object has a prototype. When you write `obj.toString`, JS looks up `obj` itself, then `obj.__proto__`, then `Object.prototype`, and so on up the chain. Prototype pollution occurs when an attacker can cause code to write to `__proto__`, `constructor`, or `prototype` — contaminating *every* plain object in the process.

A classic vulnerable pattern is a recursive `merge` function:

```js
// UNSAFE merge — do not use
function unsafeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (!target[key]) target[key] = {};
      unsafeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Attacker-controlled JSON from a request body:
// { "__proto__": { "isAdmin": true } }
//
// After unsafeMerge({}, attackerPayload):
//   Object.prototype.isAdmin === true  ← every plain object is now "admin"
//
// Authorization check later:
//   if (user.isAdmin) grantAccess();   ← user.isAdmin is now true for ALL users!
```

### The blast radius

Prototype pollution is catastrophic because:

1. It is **global** — it affects every plain object in the process, not just the one being merged.
2. It is **silent** — no error is thrown; the property just appears.
3. It can lead to **RCE** — in some templating engines and ORMs, a polluted prototype enables code execution.

### A guarded merge that blocks `__proto__`

The fix is to explicitly reject any key that targets the prototype chain:

```js
// Safe merge: rejects __proto__, constructor, and prototype
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue; // skip — never write to prototype-chain keys
    }
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```

Other mitigations include:

```js
// Create objects with a null prototype — they have no __proto__ to pollute:
const safeObj = Object.create(null);

// Or freeze Object.prototype so it cannot be modified at all:
Object.freeze(Object.prototype);
// Caution: this may break some third-party libraries that legitimately extend it.

// Use Map instead of plain objects for user-controlled key-value stores:
const store = new Map();
store.set(userKey, value); // Map has no prototype to pollute
```

> [!PRINCIPAL] Prototype pollution at the library boundary
> The most dangerous prototype pollution vectors are usually *libraries*, not your own merge code. `lodash.merge`, `jquery.extend`, and many config parsers were historically vulnerable. Before using any library that merges or deep-copies objects, check its CVE history and whether it uses `Object.create(null)` or key allowlisting internally. Runtime Object.freeze of Object.prototype, applied early in your process entry point, is the strongest systemic mitigation — but test it thoroughly because some packages rely on prototype extension.

## ReDoS: Regular Expression Denial of Service

### Catastrophic backtracking

Most regex engines use a backtracking algorithm. Given certain patterns and certain inputs, the engine explores an exponential number of paths before concluding there is no match. This is called **catastrophic backtracking**, and it can cause a single-threaded Node.js event loop to stall for seconds — or minutes — on a single malformed string.

```js
// Vulnerable regex: nested quantifiers on overlapping character classes
// The pattern /(a+)+$/ on the input "aaaaaaaaaaaaaaaaX" causes:
//   - the engine to try every possible way to split "aaaa...a" into groups
//   - exponential time: 2^n attempts for n 'a' characters
//
// Real-world examples found in production:
// /^(\w+\s?)+$/     (username validation)
// /^(a|a?)+$/       (pathological alternation)
// /(\d+\.)+\d+$/    (version string — ok for short strings, dangerous for long ones)
```

### Detecting and fixing ReDoS

Tools: `safe-regex`, `redos-detector`, or `vuln-regex-detector`.

```bash
npx safe-regex '/^(\w+\s?)+$/'
# → unsafe!
```

Fix strategies:

```js
// 1. Rewrite to atomic/possessive-style (not available in JS, so rewrite the logic):
//    Instead of /^(\w+\s?)+$/, validate with explicit bounds:
const safeUsernamePattern = /^\w{1,32}$/;  // max length + character class, no nesting

// 2. Apply a length gate before running any regex on untrusted input:
function safeMatch(input, pattern) {
  if (input.length > 1000) return false; // ReDoS can't happen on short strings
  return pattern.test(input);
}

// 3. Use linear-time alternatives (State-machine parsers, RE2 via a native binding):
// import RE2 from 're2';
// const re = new RE2('^(\\w+\\s?)+$');  // RE2 guarantees linear-time matching
```

> [!WARNING] Node's event loop is single-threaded
> A ReDoS in a route handler blocks the entire event loop. While one request hangs in the regex, every other request — including health checks — is blocked too. This makes ReDoS an extremely effective denial-of-service attack with a single HTTP request.

## SSRF: Server-Side Request Forgery

SSRF occurs when your server-side code fetches a URL that is wholly or partially under attacker control. The attacker pivots through your server to reach internal services, cloud metadata endpoints, or even `file://` paths.

```js
// Vulnerable: user-controlled URL fed directly to fetch
app.post('/api/preview', async (req, res) => {
  const { url } = req.body; // attacker sends "http://169.254.169.254/latest/meta-data/"
  const response = await fetch(url); // now your server leaks AWS instance credentials
  res.send(await response.text());
});
```

### Mitigations

```js
import { URL } from 'node:url';

const ALLOWED_SCHEMES = new Set(['https:']);
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'localhost']);
const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
];

function validateOutboundUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Disallowed scheme: ${parsed.protocol}`);
  }
  if (BLOCKED_HOSTS.has(parsed.hostname)) {
    throw new Error('Blocked host');
  }
  if (PRIVATE_RANGES.some(re => re.test(parsed.hostname))) {
    throw new Error('Private IP ranges are not allowed');
  }

  return parsed.href;
}
```

> [!NOTE] DNS rebinding bypasses hostname checks
> An attacker can register a DNS name that initially resolves to a public IP (passing your check) then rapidly changes the TTL to resolve to an internal IP for the actual connection. The definitive solution is to resolve the hostname to an IP *before* connecting and check that IP as well — or use a dedicated HTTP egress proxy that enforces the allowlist at the network level.

## Injection

### SQL Injection

```js
// Vulnerable: string concatenation in queries
const rows = await db.query(`SELECT * FROM users WHERE name = '${req.params.name}'`);
// Attacker input: "' OR '1'='1" — returns all rows

// Safe: parameterised queries
const rows = await db.query('SELECT * FROM users WHERE name = $1', [req.params.name]);
```

### Command Injection

```js
import { exec, execFile } from 'node:child_process';

// Vulnerable: user input in a shell command
exec(`convert ${req.body.filename} output.png`); // filename can contain '; rm -rf /'

// Safe: execFile does not spawn a shell; arguments are passed directly to the binary
execFile('convert', [req.body.filename, 'output.png'], { shell: false });
// Even safer: validate filename against a strict pattern before use
```

### Log Injection

```js
// Vulnerable: user input embedded in log strings
console.log(`User logged in: ${req.body.username}`);
// Attacker input: "admin\n[ERROR] Unauthorized access detected" — forges log entries

// Safe: use structured logging — the username is a field, not part of the message
logger.info({ event: 'login', username: req.body.username });
```

## Insecure Deserialization

Node.js does not expose Java-style serialization, but several patterns are dangerous:

```js
// Dangerous: eval() on user-supplied JSON "extensions"
const config = eval('(' + req.body.config + ')');  // arbitrary code execution

// Dangerous: node-serialize (historical CVE) — do not use
// const obj = serialize.unserialize(userInput);

// Safe: JSON.parse is sandboxed — it only produces plain data structures
const config = JSON.parse(req.body.config); // cannot execute code

// Safe pattern: validate the deserialized object with a schema before trusting it
import Ajv from 'ajv';
const ajv = new Ajv();
const validate = ajv.compile(configSchema);
if (!validate(config)) throw new Error('Invalid config');
```

> [!PITFALL] `JSON.parse` + `JSON.stringify` as a "safe clone" still enables prototype pollution
> If you `JSON.parse` a string, merge the result with `Object.assign` or `{...spread}`, you are still vulnerable to prototype pollution via the `__proto__` key, because `JSON.parse('{"__proto__":{"isAdmin":true}}')` produces an object with a literal `__proto__` key. Always use the guarded merge from the section above, or use `structuredClone` for deep-copying your own objects.

## Try it yourself

Explore the difference between unsafe and safe object merge — and see prototype pollution in action, then stopped:

```js run
// Safe merge: guards against __proto__, constructor, prototype keys
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      console.log(`[BLOCKED] Attempt to write to key: "${key}"`);
      continue;
    }
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Normal merge works fine
const base = { role: "user", prefs: { theme: "dark" } };
const update = { prefs: { lang: "en" } };
const merged = safeMerge(base, update);
console.log("Normal merge:", JSON.stringify(merged));

// Prototype pollution attempt is blocked
const attackerPayload = JSON.parse('{"__proto__":{"isAdmin":true},"name":"hacker"}');
const result = safeMerge({}, attackerPayload);
console.log("After attack attempt, result.name:", result.name);
console.log("Object.prototype.isAdmin:", ({}).isAdmin); // should be undefined
console.log("Pollution blocked:", ({}).isAdmin === undefined);

// Demonstrate why length gates help with ReDoS
function safeRegexMatch(input, pattern, maxLength = 200) {
  if (input.length > maxLength) {
    console.log(`[RATELIMITED] Input too long for regex: ${input.length} chars`);
    return false;
  }
  return pattern.test(input);
}

console.log("\nReDoS guard:");
const username = "alice123";
const oversized = "a".repeat(500);
console.log("Short input match:", safeRegexMatch(username, /^\w+$/));
console.log("Long input blocked:", safeRegexMatch(oversized, /^\w+$/));
```

## Exercises

**Exercise 1 — URL validator.** Implement a stricter `validateOutboundUrl` that also blocks `file://`, `ftp://`, and any URL where the hostname is a numeric IP in a private range. Test it with several inputs.

<details>
<summary>Show solution</summary>

```js run
function isPrivateIp(hostname) {
  const privateRanges = [
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^127\.\d+\.\d+\.\d+$/,
    /^::1$/,
    /^0\.0\.0\.0$/,
  ];
  return privateRanges.some(re => re.test(hostname));
}

function validateOutboundUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL syntax" };
  }

  const allowedSchemes = ["https:"];
  if (!allowedSchemes.includes(parsed.protocol)) {
    return { ok: false, reason: `Disallowed scheme: ${parsed.protocol}` };
  }

  const blockedHosts = ["169.254.169.254", "metadata.google.internal", "localhost"];
  if (blockedHosts.includes(parsed.hostname)) {
    return { ok: false, reason: `Blocked hostname: ${parsed.hostname}` };
  }

  if (isPrivateIp(parsed.hostname)) {
    return { ok: false, reason: `Private IP blocked: ${parsed.hostname}` };
  }

  return { ok: true, href: parsed.href };
}

const tests = [
  "https://example.com/api",
  "http://example.com/api",
  "file:///etc/passwd",
  "https://169.254.169.254/latest/meta-data/",
  "https://192.168.1.1/admin",
  "https://127.0.0.1:8080/",
  "ftp://files.example.com/",
];

tests.forEach(url => {
  const result = validateOutboundUrl(url);
  console.log(`${result.ok ? "ALLOW" : "BLOCK "} ${url}`);
  if (!result.ok) console.log(`       Reason: ${result.reason}`);
});
```

</details>

**Exercise 2 — Detect prototype pollution.** Write a function `isPolluted()` that checks whether `Object.prototype` has been modified from its expected state, and a test harness that verifies your `safeMerge` leaves it clean.

<details>
<summary>Show solution</summary>

```js run
function getOwnProtoKeys() {
  return Object.getOwnPropertyNames(Object.prototype);
}

function isPolluted(before) {
  const after = getOwnProtoKeys();
  const added = after.filter(k => !before.includes(k));
  return { polluted: added.length > 0, added };
}

function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      if (typeof target[key] !== 'object') target[key] = {};
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const beforeKeys = getOwnProtoKeys();

// Attempt pollution via safeMerge
const payload = JSON.parse('{"__proto__":{"evil":true},"data":42}');
safeMerge({}, payload);

const { polluted, added } = isPolluted(beforeKeys);
console.log("Prototype polluted?", polluted);        // false
console.log("Extra proto keys:", added);             // []
console.log("({}).evil:", ({}).evil);                // undefined
console.log("safeMerge result data:", safeMerge({}, payload).data); // 42

console.log("\nAll checks passed — safeMerge is pollution-free.");
```

</details>

## Project

### Full Security Review of the Platform

You have built a substantial Node.js platform throughout this course. Now conduct a **structured security review** covering supply chain, threat model, hardening checklist, and concrete fixes. This mirrors the security review process used at principal-engineer level before a major release or compliance audit.

**Acceptance criteria:**

1. **SBOM generated.** Run `npx @cyclonedx/cyclonedx-npm` (or equivalent) and produce a `sbom.json` file. Identify any dependency with a known CVE via `npm audit --json`. Document at least one finding and its remediation (upgrade, alternative, or accepted risk with justification).

2. **Threat model documented.** Using the STRIDE framework from lesson 39-threat-modeling, identify at least five threats against your platform's most critical endpoint (e.g. the authentication flow or the most privileged API route). Score each with likelihood × impact and propose a mitigation for each HIGH/CRITICAL item.

3. **Prototype pollution audit.** Locate every call to `Object.assign`, `{...spread}` with user-supplied data, or any deep-merge utility in the codebase. Replace or wrap each with the guarded `safeMerge` from this lesson. Add a test that verifies `Object.prototype` is unchanged after processing a payload containing `__proto__`.

4. **Regex audit for ReDoS.** Find every regex applied to user-supplied input. Run each through `npx safe-regex` (or equivalent). Replace any flagged as unsafe with either a bounded pattern or a guarded wrapper that applies a length limit before executing the regex.

5. **SSRF hardening.** Locate every place the codebase makes an outbound HTTP/HTTPS request using a URL derived from user input. Apply the `validateOutboundUrl` guard (or a tested equivalent) to each call site. Add at least one test covering a private-IP bypass attempt.

6. **Hardening checklist shipped.** Verify and document the state of: HTTPS-only in production, `helmet` headers, rate limiting on all public routes, no stack traces in error responses, structured audit logging for auth events, `npm ci` in the CI pipeline, and secrets stored in a secret manager (not in `.env` files committed to the repo). For any item not yet in place, open a GitHub issue with a concrete implementation plan.

**Starter — safe merge (the core of criterion 3):**

```js run
// Safe merge starter — ready for you to integrate into the platform
function safeMerge(target, source) {
  const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  for (const key of Object.keys(source)) {
    if (BLOCKED_KEYS.has(key)) {
      console.log(`[safeMerge] Blocked key: "${key}"`);
      continue;
    }
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Demonstrate safe operation
const userPrefs = safeMerge(
  { theme: "light", notifications: { email: true } },
  { notifications: { sms: true }, displayName: "Ada" }
);
console.log("Merged:", JSON.stringify(userPrefs));

// Demonstrate attack blocked
const attack = JSON.parse('{"__proto__":{"isAdmin":true},"legit":"value"}');
const safe = safeMerge({}, attack);
console.log("After attack — legit:", safe.legit);
console.log("After attack — isAdmin on new object:", ({}).isAdmin);
console.log("Attack neutralised:", ({}).isAdmin === undefined);
```

## Common pitfalls

> [!PITFALL] "We use a library for merging, so we're safe"
> Libraries like `lodash.merge` have historically been vulnerable to prototype pollution (patched in lodash 4.17.21, but earlier versions are still widely installed transitively). Treating a third-party merge as inherently safe is the mistake — always check the version in your lockfile and audit transitive dependencies, not just direct ones. When in doubt, wrap the library call with an explicit key allowlist or use `structuredClone` for copies you control.

Also watch for: using regex literals hardcoded in files but applied to request data at runtime — the file appears safe during code review but the input is unbounded at runtime. Apply length gates as a defence-in-depth measure regardless of whether the regex looks safe.

## What you learned

- **Prototype pollution** exploits JS's prototype chain via unsafe object merges; the fix is to explicitly skip `__proto__`, `constructor`, and `prototype` keys — or use `Object.create(null)` / `Map`.
- **ReDoS** arises from nested quantifiers on overlapping character classes; prevent it with bounded patterns, length gates, and RE2-backed matching.
- **SSRF** lets attackers use your server to reach internal networks; defend with strict URL validation, scheme allowlists, and IP blocklists — ideally at the network egress layer.
- **Injection** (SQL, command, log) is prevented by parameterised queries, `execFile` over `exec`, and structured logging.
- **Insecure deserialization** in Node means `eval`-based patterns; use `JSON.parse` with schema validation.
- The **OWASP Top 10** maps directly to Node.js — knowing the taxonomy helps you find the right mitigation for each category.

## Next steps

You have completed the Security Hardening module. The capstone module brings everything together — architecture, performance, observability, and security — in a full-scale production system design challenge. Apply your threat model there from the very first design decision.
*/});
