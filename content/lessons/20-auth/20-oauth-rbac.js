registerLessonSrc("20-oauth-rbac", function () {/*
---
id: 20-oauth-rbac
title: "OAuth2/OIDC & Role-Based Access Control"
minutes: 26
level: advanced
objectives:
  - Explain the OAuth2 Authorization Code + PKCE flow and why PKCE is required for public clients
  - Distinguish OIDC identity tokens from OAuth2 access tokens
  - Implement a role-based access control engine with hierarchical permissions
  - Articulate the difference between RBAC and ABAC and when each is appropriate
---

# OAuth2/OIDC & Role-Based Access Control

## Why this matters

Almost every production app has two distinct problems: (1) letting users log in via a third-party provider (Google, GitHub, your company's SSO) without you ever seeing their password, and (2) deciding what each authenticated user is allowed to do once they are in. OAuth2/OIDC solves the first; RBAC/ABAC solves the second. Confusing the two — or implementing either poorly — is a top-5 auth mistake.

## Learning objectives

- Trace the **OAuth2 Authorization Code + PKCE** flow step by step.
- Read an **OIDC ID token** and understand its claims vs an OAuth2 access token.
- Design and implement a **role-based access control (RBAC)** engine.
- Know when RBAC breaks down and **ABAC** is the right tool.

## OAuth2: delegated authorization

OAuth2 is not an authentication protocol — it is an **authorization** protocol. Its job: let a user grant your app permission to access a resource on their behalf, without sharing their password with you.

### The four roles

| Role | Example |
|---|---|
| **Resource Owner** | The user |
| **Client** | Your web/mobile app |
| **Authorization Server (AS)** | Google, GitHub, Auth0, Cognito |
| **Resource Server (RS)** | Google Photos API, GitHub API |

### Authorization Code + PKCE flow

PKCE (Proof Key for Code Exchange) was originally designed for mobile apps that can't keep a secret, but is now **required for all OAuth2 clients** (RFC 9700, 2025) because it prevents authorization-code interception attacks even when a `client_secret` exists.

```
1. Client generates:
     code_verifier  = 43–128 cryptographically random URL-safe chars
     code_challenge = BASE64URL(SHA256(code_verifier))

2. Client redirects browser to AS:
     GET https://as.example.com/authorize
       ?response_type=code
       &client_id=MY_APP
       &redirect_uri=https://myapp.com/callback
       &scope=openid%20email%20profile
       &state=<random-csrf-token>
       &code_challenge=<hash>
       &code_challenge_method=S256

3. User authenticates at AS, grants consent.
   AS redirects back:
     GET https://myapp.com/callback?code=AUTH_CODE&state=<same-token>

4. Client verifies state (CSRF protection), then exchanges:
     POST https://as.example.com/token
       grant_type=authorization_code
       &code=AUTH_CODE
       &redirect_uri=https://myapp.com/callback
       &client_id=MY_APP
       &code_verifier=<original-plain-text-verifier>

5. AS verifies SHA256(code_verifier) == stored code_challenge.
   AS responds:
     { "access_token": "...", "id_token": "...", "refresh_token": "...", "expires_in": 3600 }
```

```js
// Generating PKCE parameters in Node (built-in crypto):
import { randomBytes, createHash } from "node:crypto";

function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url"); // 43 URL-safe chars
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

const { verifier, challenge } = generatePKCE();
console.log("verifier:", verifier);   // kept secret on client
console.log("challenge:", challenge); // sent to AS
```

> [!OUTPUT]
> verifier:  dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
> challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cg

> [!PITFALL] Reusing the same state or code_verifier across requests
> Both `state` and `code_verifier` must be **fresh per authorization request** and stored in the session or `sessionStorage` (not `localStorage`). Reusing them opens CSRF and replay attack windows.

## OIDC: authentication on top of OAuth2

**OpenID Connect (OIDC)** is a thin identity layer on top of OAuth2. When you request the `openid` scope, the authorization server returns an **ID token** (always a JWT) alongside the access token.

| | Access Token | ID Token |
|---|---|---|
| **Purpose** | Authorize API calls | Prove user identity |
| **Audience** | Resource server (your API) | Client application |
| **Claims** | Scopes, expiry | `sub`, `email`, `name`, `aud`, `iss`, `nonce` |
| **Format** | Opaque or JWT (AS-dependent) | Always JWT |

```js
// Verifying an OIDC ID token with the "jose" library (handles JWKS fetching):
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://accounts.google.com/.well-known/openid-configuration/jwks")
);

async function verifyIdToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: "https://accounts.google.com",
    audience: clientId,
  });
  // payload.sub is the stable user identifier — store this, not the email
  return payload;
}
```

> [!NOTE] Use `sub` not `email` as your user's stable identifier
> Emails can change. The `sub` (subject) claim is the authorization server's permanent identifier for that user — use it as the foreign key in your database.

## Scopes: what the user consented to

OAuth2 scopes are space-separated strings the client requests and the user approves:

```
openid email profile   → read basic profile (OIDC standard)
read:posts             → read the user's posts (custom, your API)
write:posts            → create/edit posts
admin                  → everything (use sparingly, prefer narrow scopes)
```

Request the **minimum scopes** needed. Incremental authorization (requesting additional scopes later, when actually needed) improves conversion rates and user trust.

## RBAC: role-based access control

RBAC answers "is this user allowed to do X?" by:
1. Assigning the user one or more **roles** (`admin`, `editor`, `viewer`).
2. Mapping roles to **permissions** (`post:create`, `post:delete`, `user:read`).
3. Checking `can(user, permission)` at every protected action.

```js
// A simple RBAC engine
const ROLES = {
  viewer:  ["post:read",   "comment:read"],
  editor:  ["post:read",   "post:create",  "post:update",
            "comment:read","comment:create"],
  admin:   ["post:read",   "post:create",  "post:update", "post:delete",
            "comment:read","comment:create","comment:delete",
            "user:read",   "user:update",  "user:delete"],
};

function can(user, permission) {
  const roles = user.roles ?? [];
  return roles.some(role => ROLES[role]?.includes(permission));
}

// Example middleware
function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

// Usage:
app.delete("/posts/:id", requirePermission("post:delete"), deletePost);
```

> [!OUTPUT]
> can({ roles: ["editor"] }, "post:delete")  // false
> can({ roles: ["admin"] },  "post:delete")  // true

> [!PRINCIPAL] Design permissions as `resource:action` pairs
> Flat permission strings like `"delete-posts"` don't compose. Use `"resource:action"` (e.g. `"post:delete"`, `"invoice:create"`) — it makes permission enumeration, auditing, and wildcard matching (`"post:*"`) natural. For complex systems, add a `scope` or `tenant` dimension: `"org:{orgId}:post:delete"`.

## RBAC vs ABAC

**RBAC** is role-centric: `can(user, action)`.
**ABAC (Attribute-Based Access Control)** is policy-centric: `can(user, action, resource, environment)`.

ABAC example: "An editor can update a post only if they are the author AND the post is in draft state AND the request comes from the corporate network."

```js
// ABAC-style check
function canEditPost(user, post, requestContext) {
  if (user.roles.includes("admin")) return true;
  if (!user.roles.includes("editor")) return false;
  if (post.authorId !== user.id) return false;        // ownership attribute
  if (post.status !== "draft") return false;          // resource attribute
  if (!requestContext.isCorporateIp) return false;    // environment attribute
  return true;
}
```

> [!NOTE] Start with RBAC, reach for ABAC when roles proliferate
> RBAC is simple to reason about and audit. When you find yourself creating roles like `editor-of-own-draft-posts-from-corp-network`, you've outgrown RBAC — that's ABAC territory.

## Try it yourself

Here is a complete, runnable RBAC engine with role hierarchy (each role inherits from less-privileged roles below it):

```js run
// RBAC engine with inheritance and permission checking.
// can(user, "action", "resource") — fully runnable.

const PERMISSIONS = {
  viewer:  ["post:read",    "comment:read"],
  editor:  ["post:create",  "post:update",   "comment:create", "comment:update"],
  manager: ["post:delete",  "comment:delete","user:read"],
  admin:   ["user:update",  "user:delete",   "settings:write"],
};

// Inheritance chain: admin > manager > editor > viewer
const INHERITS = {
  editor:  ["viewer"],
  manager: ["editor"],
  admin:   ["manager"],
};

function resolvePermissions(role, visited = new Set()) {
  if (visited.has(role)) return new Set();
  visited.add(role);
  const perms = new Set(PERMISSIONS[role] ?? []);
  for (const parent of (INHERITS[role] ?? [])) {
    for (const p of resolvePermissions(parent, visited)) perms.add(p);
  }
  return perms;
}

function can(user, action, resource) {
  const permission = resource ? `${resource}:${action}` : action;
  for (const role of (user.roles ?? [])) {
    if (resolvePermissions(role).has(permission)) return true;
  }
  return false;
}

// Test users
const alice = { name: "Alice", roles: ["editor"] };
const bob   = { name: "Bob",   roles: ["manager"] };
const carol = { name: "Carol", roles: ["admin"] };
const dave  = { name: "Dave",  roles: ["viewer"] };

const checks = [
  [alice, "read",   "post"],
  [alice, "create", "post"],
  [alice, "delete", "post"],
  [bob,   "delete", "post"],
  [bob,   "update", "user"],
  [carol, "update", "user"],
  [carol, "write",  "settings"],
  [dave,  "read",   "comment"],
  [dave,  "create", "comment"],
];

for (const [user, action, resource] of checks) {
  const result = can(user, action, resource);
  const label  = result ? "ALLOW" : "DENY ";
  console.log(`${label}  ${user.name.padEnd(6)} ${resource}:${action}`);
}
```

## Exercise

**Challenge:** Add a `canAny(user, permissions[])` helper that returns `true` if the user has **at least one** of the listed permissions, and a `canAll(user, permissions[])` helper that requires **all** of them. Test them against a multi-role user.

<details>
<summary>Show solution</summary>

```js run
const PERMISSIONS = {
  viewer:  ["post:read", "comment:read"],
  editor:  ["post:create", "post:update", "comment:create"],
  admin:   ["post:delete", "user:read", "user:delete"],
};
const INHERITS = { editor: ["viewer"], admin: ["editor"] };

function resolvePermissions(role, visited = new Set()) {
  if (visited.has(role)) return new Set();
  visited.add(role);
  const perms = new Set(PERMISSIONS[role] ?? []);
  for (const parent of (INHERITS[role] ?? [])) {
    for (const p of resolvePermissions(parent, visited)) perms.add(p);
  }
  return perms;
}

function getUserPerms(user) {
  const all = new Set();
  for (const role of (user.roles ?? [])) {
    for (const p of resolvePermissions(role)) all.add(p);
  }
  return all;
}

function canAny(user, permissions) {
  const userPerms = getUserPerms(user);
  return permissions.some(p => userPerms.has(p));
}

function canAll(user, permissions) {
  const userPerms = getUserPerms(user);
  return permissions.every(p => userPerms.has(p));
}

// A user with two separate roles
const powerUser = { name: "Power", roles: ["editor", "admin"] };
const viewer    = { name: "View",  roles: ["viewer"] };

console.log("Power canAny [post:delete, post:read]:",
  canAny(powerUser, ["post:delete", "post:read"]));   // true (has both)

console.log("Viewer canAny [post:create, post:delete]:",
  canAny(viewer, ["post:create", "post:delete"]));    // false (has neither)

console.log("Power canAll [post:read, post:create, user:delete]:",
  canAll(powerUser, ["post:read", "post:create", "user:delete"])); // true

console.log("Power canAll [post:read, user:delete, settings:write]:",
  canAll(powerUser, ["post:read", "user:delete", "settings:write"])); // false (no settings:write)
```

</details>

## Common pitfalls

> [!PITFALL] Checking roles instead of permissions
> `if (user.role === "admin")` is brittle — it hard-codes assumptions about your role model. Check the specific permission (`can(user, "post:delete")`) so role restructuring doesn't require hunting down every conditional.

> [!PITFALL] Implicitly trusting the OIDC access token without verifying it
> Access tokens from an AS are often opaque strings — they are for the Resource Server to validate (usually by calling the AS's introspection endpoint or verifying as a JWT). Never decode them in your client and use the claims without verification.

## What you learned

- **OAuth2 Authorization Code + PKCE** delegates authentication to a trusted AS; always verify the `state` parameter and supply a fresh `code_verifier` per request.
- **OIDC** adds an `id_token` (JWT) for identity; use `sub` — not `email` — as the stable user identifier.
- Request the **minimum OAuth2 scopes** needed; use incremental auth for rare permissions.
- An **RBAC engine** maps `roles → permissions` and gates every action on `can(user, permission)` — not `user.role === "admin"`.
- RBAC is simple and auditable; reach for **ABAC** only when attribute-level policies are genuinely required.

## Next steps

The final lesson in this module puts it all together: Node's built-in `--permission` flag hardens the runtime itself, and the module project has you build a complete auth system — signup, login, token refresh, RBAC, and secure cookies — hardened with the permission model.
*/});
