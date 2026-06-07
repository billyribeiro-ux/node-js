registerQuiz("20-password-hashing", [
  {
    q: "Why are fast cryptographic hashes like SHA-256 unsuitable for storing passwords?",
    options: [
      "They produce output that is too short to store securely",
      "They cannot incorporate a salt value",
      "GPUs can compute billions of them per second, making brute-force attacks practical",
      "They are not deterministic, so verification fails"
    ],
    answer: 2,
    explain: "Fast hash functions are designed for throughput, not security. A modern GPU can test billions of SHA-256 guesses per second, making even long passwords crackable in minutes. Purpose-built algorithms like scrypt and argon2 add artificial cost so each guess takes milliseconds."
  },
  {
    q: "What is the role of a random salt in password hashing?",
    options: [
      "It encrypts the hash so only the server can read it",
      "It prevents rainbow-table attacks and ensures two users with the same password get different hashes",
      "It increases the hash output length for extra security",
      "It replaces the need for a slow hashing algorithm"
    ],
    answer: 1,
    explain: "A salt is a unique random value mixed into each password before hashing. It defeats precomputed rainbow tables and ensures identical passwords produce different hashes, so cracking one reveals nothing about others. Salts do not need to be secret."
  },
  {
    q: "Why must secret comparisons use 'timingSafeEqual' from 'node:crypto' instead of '===' or 'Buffer.equals()'?",
    options: [
      "Because '===' cannot compare Buffer objects at all",
      "Because regular equality short-circuits on the first differing byte, leaking information through timing differences",
      "Because 'timingSafeEqual' performs a cryptographic hash of both sides before comparing",
      "Because '===' converts Buffers to strings, causing encoding errors"
    ],
    answer: 1,
    explain: "String and Buffer equality in JavaScript returns early on the first mismatching character. An attacker can measure response times statistically to learn how many leading bytes match. 'timingSafeEqual' always takes the same time regardless of where the mismatch occurs."
  }
]);

registerResources("20-password-hashing", [
  { title: "Node.js crypto.scrypt Documentation", url: "https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback" },
  { title: "Node.js crypto.timingSafeEqual Documentation", url: "https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b" },
  { title: "OWASP Password Storage Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html" },
  { title: "argon2 npm package Documentation", url: "https://github.com/ranisalt/node-argon2" },
  { title: "Password Hashing Competition (argon2 winner)", url: "https://www.password-hashing.net/" }
]);

registerQuiz("20-sessions-jwt", [
  {
    q: "A JWT is composed of three base64url-encoded parts separated by dots. What does the third part (the signature) prove?",
    options: [
      "That the payload was encrypted and cannot be read by the client",
      "That the header and payload have not been tampered with since they were signed by the server",
      "That the token was issued by a trusted certificate authority",
      "That the token was generated within the last 15 minutes"
    ],
    answer: 1,
    explain: "The signature is an HMAC of the base64url-encoded header and payload using the server's secret key. Any modification to the header or payload produces a different signature, which the server detects on verification."
  },
  {
    q: "Why should JWT access tokens be kept short-lived (e.g. 15 minutes) rather than long-lived?",
    options: [
      "Longer tokens are larger and slow down HTTP requests",
      "Because JWTs cannot be signed with HMAC for more than 15 minutes",
      "A stolen access token remains valid until it expires, so a short lifetime limits the blast radius",
      "Short tokens are required by the OAuth2 specification"
    ],
    answer: 2,
    explain: "Because JWTs are stateless and validated by signature alone, the server cannot instantly revoke a stolen access token. Keeping lifetime short (5-15 minutes) minimises the window an attacker can exploit a stolen token."
  },
  {
    q: "Which cookie attribute prevents JavaScript on the page from reading the cookie's value, defeating XSS-based token theft?",
    options: [
      "SameSite=Strict",
      "Secure",
      "httpOnly",
      "Path=/"
    ],
    answer: 2,
    explain: "The 'httpOnly' flag hides the cookie from 'document.cookie' so JavaScript cannot access it at all. 'Secure' ensures HTTPS-only transmission, and 'SameSite' mitigates CSRF, but neither prevents JS from reading the cookie value."
  }
]);

registerResources("20-sessions-jwt", [
  { title: "JWT Introduction (jwt.io)", url: "https://jwt.io/introduction" },
  { title: "RFC 7519 — JSON Web Token (JWT)", url: "https://datatracker.ietf.org/doc/html/rfc7519" },
  { title: "MDN — HTTP Cookies (Set-Cookie attributes)", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie" },
  { title: "jsonwebtoken npm package", url: "https://github.com/auth0/node-jsonwebtoken" },
  { title: "OWASP Session Management Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html" }
]);

registerQuiz("20-oauth-rbac", [
  {
    q: "In the OAuth2 Authorization Code + PKCE flow, what is the 'code_challenge' sent to the authorization server?",
    options: [
      "The client's plain-text secret key",
      "A base64url-encoded SHA-256 hash of the 'code_verifier'",
      "A random CSRF token stored in the session",
      "The authorization code received from the server after login"
    ],
    answer: 1,
    explain: "The client generates a random 'code_verifier', computes 'BASE64URL(SHA256(code_verifier))', and sends that hash (the 'code_challenge') to the authorization server. When exchanging the code for tokens, the client sends the original verifier so the server can verify the hash."
  },
  {
    q: "In an OIDC ID token, which claim should be used as the stable identifier to store in your database when linking a user to their provider account?",
    options: [
      "email",
      "name",
      "sub",
      "aud"
    ],
    answer: 2,
    explain: "The 'sub' (subject) claim is the authorization server's permanent, stable identifier for a user. Emails can change; 'sub' does not. Using 'email' as a foreign key breaks when a user changes their email address."
  },
  {
    q: "In a role-based access control (RBAC) engine, why is it better to check a specific permission string like 'post:delete' than to check 'user.role === \"admin\"'?",
    options: [
      "Permission strings are faster to evaluate than string role comparisons",
      "Checking the role directly exposes the role model in code and breaks when roles are restructured",
      "RBAC requires at least three role levels to function correctly",
      "The 'role' property is not available inside middleware functions"
    ],
    answer: 1,
    explain: "Hard-coding role names in conditionals couples your permission logic to the current role structure. When roles change, every conditional must be hunted down. Checking a specific permission decouples the policy (which role has it) from the enforcement point."
  }
]);

registerResources("20-oauth-rbac", [
  { title: "RFC 7636 — Proof Key for Code Exchange (PKCE)", url: "https://datatracker.ietf.org/doc/html/rfc7636" },
  { title: "OpenID Connect Core Specification", url: "https://openid.net/specs/openid-connect-core-1_0.html" },
  { title: "OAuth 2.0 Security Best Current Practice (RFC 9700)", url: "https://datatracker.ietf.org/doc/html/rfc9700" },
  { title: "jose npm package (JWT/JWKS verification)", url: "https://github.com/panva/jose" },
  { title: "OWASP Authorization Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html" }
]);

registerQuiz("20-permission-model", [
  {
    q: "What happens when you start a Node process with '--permission' but provide no '--allow-*' flags?",
    options: [
      "Node logs a deprecation warning but runs normally",
      "Only filesystem reads are denied; all other capabilities are allowed",
      "All gated capabilities (filesystem, child processes, workers, addons) are denied by default",
      "The process exits immediately with an error"
    ],
    answer: 2,
    explain: "The '--permission' flag activates a deny-by-default sandbox. Without any '--allow-*' flags, every restricted capability — filesystem reads and writes, child-process spawning, worker threads, and native addons — is denied. You opt in to only what your service needs."
  },
  {
    q: "Which API lets your application code check at runtime whether a specific filesystem path is accessible under the current permission grants?",
    options: [
      "fs.accessSync(path, fs.constants.R_OK)",
      "process.permission.has('fs.read', path)",
      "os.checkPermission('fs.read', path)",
      "require('node:permissions').check('fs.read', path)"
    ],
    answer: 1,
    explain: "'process.permission.has(scope, reference)' returns true if the current process was granted the specified capability for the given path. It is the standard way to probe permissions at startup or before attempting an I/O operation."
  },
  {
    q: "What does Node's '--permission' flag NOT protect against, according to the lesson?",
    options: [
      "Spawning child processes",
      "Reading files outside the allowed paths",
      "Outbound network requests (HTTP, TCP sockets)",
      "Loading native addons"
    ],
    answer: 2,
    explain: "Network access — HTTP/HTTPS, DNS, TCP sockets — is not yet gated by the permission model. An exploited process can still make outbound connections. Use firewall rules and network policies for that layer in addition to the permission model."
  }
]);

registerResources("20-permission-model", [
  { title: "Node.js Permissions Model Documentation", url: "https://nodejs.org/api/permissions.html" },
  { title: "Node.js process.permission.has() API", url: "https://nodejs.org/api/process.html#processpermissionhasscope-reference" },
  { title: "Node.js Security Releases & Advisories", url: "https://nodejs.org/en/about/security-releases" },
  { title: "OWASP Defense in Depth", url: "https://owasp.org/www-community/Defense_in_depth" },
  { title: "Node.js --allow-fs-read / --allow-fs-write Flags", url: "https://nodejs.org/api/cli.html#--allow-fs-readpath" }
]);
