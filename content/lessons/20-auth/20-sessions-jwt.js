registerLessonSrc("20-sessions-jwt", function () {/*
---
id: 20-sessions-jwt
title: "Sessions vs JWT & Secure Cookies"
minutes: 24
level: advanced
objectives:
  - Distinguish stateful server-side sessions from stateless JWTs and articulate the trade-offs
  - Decode and understand the three-part JWT structure and the HMAC signing contract
  - Configure cookies correctly with httpOnly, Secure, and SameSite to mitigate XSS and CSRF
  - Design a safe refresh-token flow that bounds session lifetime without forcing re-login
---

# Sessions vs JWT & Secure Cookies

## Why this matters

Once a user proves their identity with a password, the server must remember that fact across every subsequent HTTP request — HTTP itself is stateless. The choice between server-side sessions and signed JWTs has real consequences for scalability, revocability, and attack surface. Get the cookie flags wrong and you hand attackers a read-on-XSS or free-on-CSRF. This lesson gives you the full picture.

@diagram:jwt-structure

## Learning objectives

- Explain **stateful sessions** and **stateless JWTs** and the trade-offs of each.
- Read and verify a JWT's three-part structure (header, payload, signature).
- Set **httpOnly**, **Secure**, and **SameSite** cookie attributes correctly.
- Design an **access + refresh token** pair that balances security and usability.
- Know the XSS and CSRF threats each approach faces.

## Stateful sessions: the classic approach

In a stateful session flow the server is the source of truth:

1. User logs in — server creates a session record in a store (memory, Redis, database).
2. Server gives the browser a **session ID** cookie — a random opaque token.
3. Every subsequent request sends that cookie; the server looks up the ID in the store.
4. Logout deletes the record — the session is instantly dead.

```js
// Express + express-session (typical setup)
import session from "express-session";
import RedisStore from "connect-redis";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,  // signs the cookie to prevent tampering
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,    // JavaScript cannot read it
    secure: true,      // HTTPS only
    sameSite: "lax",   // CSRF mitigation
    maxAge: 1000 * 60 * 60 * 24,  // 24 hours
  },
}));

// After verifying the password:
req.session.userId = user.id;

// On protected routes:
if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
```

> [!OUTPUT]
> Set-Cookie: connect.sid=s%3A<signed-opaque-id>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400

**Trade-offs:** Sessions are easy to revoke (delete the record) but require shared store access on every request — a challenge with many stateless servers or edge deployments.

## Stateless JWTs: tokens that carry their own proof

A **JSON Web Token (JWT)** encodes the session data inside the token itself, signed so the server can verify it without a database lookup.

### JWT structure

A JWT is three base64url-encoded parts separated by dots:

```
<header>.<payload>.<signature>
```

**Header** — algorithm metadata:

```json
{ "alg": "HS256", "typ": "JWT" }
```

**Payload** — claims (registered + custom):

```json
{
  "sub": "user-123",
  "email": "ada@example.com",
  "role": "editor",
  "iat": 1717200000,
  "exp": 1717203600
}
```

**Signature** — HMAC-SHA256 of `base64url(header) + "." + base64url(payload)` using a secret key.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// Using the "jsonwebtoken" npm package in practice:
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;  // long random string, treat like a password

function issueTokens(userId, role) {
  const accessToken = jwt.sign(
    { sub: userId, role },
    SECRET,
    { expiresIn: "15m" }       // short-lived
  );
  const refreshToken = jwt.sign(
    { sub: userId, type: "refresh" },
    SECRET,
    { expiresIn: "7d" }        // long-lived, stored in DB to allow revocation
  );
  return { accessToken, refreshToken };
}

function verifyAccess(token) {
  try {
    return jwt.verify(token, SECRET);  // throws if expired or tampered
  } catch {
    return null;
  }
}
```

> [!OUTPUT]
> accessToken:  eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJlZGl0b3IifQ.<sig>
> refreshToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInR5cGUiOiJyZWZyZXNoIn0.<sig>

> [!PITFALL] "Stateless" JWTs cannot be instantly revoked
> Because the server trusts the signature, a stolen access token is valid until it expires. Keep **access token lifetime short (5–15 minutes)**. For revocation, maintain a server-side refresh-token store — on logout, delete the refresh token so new access tokens cannot be minted.

## Access + refresh token flow

Short-lived access tokens limit blast radius; refresh tokens enable continuous sessions:

```
Browser                            API Server
  |-- POST /login (password) -------->|
  |<-- accessToken (15m) + -----------|
  |    refreshToken (7d, httpOnly) ----|
  |                                   |
  |-- GET /resource (Bearer token) -->|  (fast: no DB hit, just verify sig)
  |<-- 200 OK ------------------------|
  |                                   |
  |-- GET /resource (expired token) ->|
  |<-- 401 Unauthorized --------------|
  |                                   |
  |-- POST /refresh (cookie) -------->|  (DB: validate refresh token)
  |<-- new accessToken (15m) ---------|
```

> [!PRINCIPAL] Store refresh tokens server-side
> The only durable security property of a "stateless" JWT system comes from the refresh-token store. Treat it like a session store: record the token hash, user ID, expiry, and device fingerprint. On logout, suspicious activity, or password change — delete all refresh tokens for that user. This gives you the scalability of JWTs with the revocability of sessions.

## Secure cookie flags

Cookies carry authentication material, so every flag matters:

| Flag | What it does | Why it matters |
|---|---|---|
| `httpOnly` | Hides cookie from `document.cookie` (JS cannot read it) | Defeats XSS token theft |
| `Secure` | Cookie only sent over HTTPS | Prevents network sniffing |
| `SameSite=Strict` | Cookie never sent on cross-site requests | Strongest CSRF protection; breaks OAuth redirect flows |
| `SameSite=Lax` | Cookie sent on top-level GET navigation, not cross-site POST | Good default; covers most CSRF without breaking UX |
| `SameSite=None; Secure` | Sent on all cross-origin requests | Required for embedded iframes; pair with CSRF tokens |
| `Max-Age` / `Expires` | Persistent session length | Omitting both = session cookie (deleted when browser closes) |
| `Path=/` | Limit cookie scope to a path prefix | Least-privilege; use `/api` if only the API needs it |

```js
// Sending an httpOnly refresh-token cookie from Express:
res.cookie("refreshToken", token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days in ms
  path: "/auth",                      // only sent to /auth routes
});
```

> [!WARNING] Do not store JWTs in localStorage
> `localStorage` is accessible to any JavaScript on your page. An XSS attack that runs `localStorage.getItem("accessToken")` exfiltrates the token silently. Use `httpOnly` cookies for the refresh token; keep the access token in memory only (a JS variable), re-mint it on page load via the refresh endpoint.

## XSS vs CSRF: the threat model

**XSS (Cross-Site Scripting)** — attacker injects JS into your page, which can read whatever JS can read.
- `httpOnly` cookies are invisible to JS → immune to XSS token theft.
- `localStorage` / `sessionStorage` are fully visible to JS → vulnerable.

**CSRF (Cross-Site Request Forgery)** — attacker's page makes your browser send a request to your API, browser automatically attaches cookies.
- `SameSite=Lax` prevents cookies on cross-site POST (covers most CSRF).
- Pair with a **CSRF token** (double-submit cookie pattern) for maximum protection when using `SameSite=None`.

## Try it yourself

The browser sandbox can't run Node crypto, but we can decode and verify the structure of a JWT using only base64url decoding and a toy HMAC:

```js run
// Decode a JWT and verify the HMAC-SHA256 signature with a toy implementation.
// In production you'd use the "jsonwebtoken" package — this shows the mechanics.

function base64urlDecode(s) {
  // base64url uses - and _ instead of + and /
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - b64.length % 4) % 4);
  return atob(padded);
}

function base64urlEncode(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Toy HMAC using a simple polynomial — NOT cryptographically secure, just illustrates structure.
function toyHmac(message, key) {
  let h = 0;
  const combined = key + "|" + message;
  for (let i = 0; i < combined.length; i++) {
    h = (Math.imul(h, 31) + combined.charCodeAt(i)) | 0;
  }
  return base64urlEncode(h.toString(16).padStart(8, "0"));
}

function createToyJWT(payload, secret) {
  const header  = base64urlEncode(JSON.stringify({ alg: "TOY256", typ: "JWT" }));
  const body    = base64urlEncode(JSON.stringify(payload));
  const sig     = toyHmac(header + "." + body, secret);
  return header + "." + body + "." + sig;
}

function verifyToyJWT(token, secret) {
  const [header, body, sig] = token.split(".");
  const expected = toyHmac(header + "." + body, secret);
  if (sig !== expected) return { valid: false };
  const payload = JSON.parse(base64urlDecode(body));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { valid: false, reason: "expired" };
  return { valid: true, payload };
}

const SECRET = "super-secret-key";
const token = createToyJWT({ sub: "user-42", role: "admin", exp: Math.floor(Date.now()/1000) + 300 }, SECRET);
console.log("Token:", token);

const [h, p] = token.split(".");
console.log("Header:", JSON.parse(base64urlDecode(h)));
console.log("Payload:", JSON.parse(base64urlDecode(p)));

const good = verifyToyJWT(token, SECRET);
console.log("Valid (correct secret):", good.valid, "| role:", good.payload.role);

const tampered = token.slice(0, -5) + "XXXXX";
const bad = verifyToyJWT(tampered, SECRET);
console.log("Valid (tampered token):", bad.valid);

const wrongSecret = verifyToyJWT(token, "wrong-key");
console.log("Valid (wrong secret):  ", wrongSecret.valid);
```

## Exercise

**Challenge:** Write `encodePayload(obj)` and `decodePayload(encoded)` functions that base64url-encode and decode a JSON object — the exact transformation applied to a JWT's header and payload.

<details>
<summary>Show solution</summary>

```js run
function encodePayload(obj) {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePayload(encoded) {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - b64.length % 4) % 4);
  return JSON.parse(atob(padded));
}

const original = { sub: "user-7", role: "editor", iat: 1717200000, exp: 1717203600 };
const encoded  = encodePayload(original);
const decoded  = decodePayload(encoded);

console.log("Encoded:", encoded);
console.log("Decoded:", JSON.stringify(decoded));
console.log("Round-trip OK:", JSON.stringify(original) === JSON.stringify(decoded));

// Demonstrate: editing the encoded payload invalidates it (no signature check here, just the idea)
const tampered = encodePayload({ ...original, role: "superadmin" });
console.log("Same token after role change?", encoded === tampered);
```

</details>

## Common pitfalls

> [!PITFALL] Signing JWTs with a weak or hardcoded secret
> `jwt.sign(payload, "secret")` has appeared in thousands of tutorials. A short, guessable secret makes your tokens forgeable. Generate a 256-bit random secret (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and store it in an environment variable — never in source code.

> [!PITFALL] Trusting the "alg" field from the token
> Older JWT libraries accepted `"alg": "none"` — letting attackers strip the signature entirely. Always pass the expected algorithm explicitly to `jwt.verify(token, secret, { algorithms: ["HS256"] })`.

## What you learned

- **Stateful sessions** store truth server-side and support instant revocation; **JWTs** are self-contained and scale horizontally but cannot be instantly invalidated.
- A JWT is three base64url-encoded parts: header, payload, signature — only the signature proves authenticity.
- Use a **short-lived access token** (in memory) plus a **long-lived refresh token** (httpOnly cookie) to balance security and usability.
- `httpOnly` defeats XSS theft; `SameSite=Lax` defeats most CSRF; `Secure` prevents network sniffing.
- Refresh tokens must be stored server-side so logout and revocation are possible.

## Next steps

With authentication in place, the next question is *what* an authenticated user is allowed to do. Next up: OAuth2/OIDC for delegated third-party auth, and role-based access control (RBAC) for fine-grained permission checks inside your own system.
*/});
