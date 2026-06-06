registerLessonSrc("20-password-hashing", function () {/*
---
id: 20-password-hashing
title: "Password Hashing with scrypt & argon2"
minutes: 22
level: advanced
objectives:
  - Explain why passwords must be hashed with slow, salted algorithms rather than fast cryptographic hashes
  - Use Node's built-in node:crypto scrypt implementation to hash and verify passwords
  - Understand argon2 and when to choose it over scrypt
  - Implement a timing-safe comparison to defeat timing-based side-channel attacks
---

# Password Hashing with scrypt & argon2

## Why this matters

A leaked database with plaintext passwords is one of the most damaging breaches a company can suffer — users reuse passwords everywhere, so your breach becomes everyone else's breach too. Even hashed passwords are exposed to offline cracking when the hash is fast. Choosing the right algorithm and implementing it correctly is a mandatory minimum for any system that stores credentials.

## Learning objectives

- Understand why fast hashes (MD5, SHA-256) are the wrong tool for passwords.
- Salt every hash to defeat rainbow-table and multi-user attacks.
- Use **node:crypto scrypt** (built-in, no install needed) to hash and verify.
- Know where **argon2** fits and why it is the current gold standard.
- Always compare hashes with a **timing-safe equality** function.

## Never store plaintext passwords

This feels obvious, yet breaches happen every year where production databases contain `password: "hunter2"`. A real attacker who dumps your `users` table should gain nothing of value. The solution is to store a **one-way hash** of the password, not the password itself.

At login time you hash the candidate and compare the hashes — you never recover the original.

## Why fast hashes (MD5, SHA-256) are wrong

MD5 and SHA-family hashes are designed to be **fast** — billions of hashes per second on a modern GPU. That speed is an asset for checksums and signatures but catastrophic for passwords:

- A 8-character lowercase password has ~200 billion combinations.
- A GPU farm can test all of them in under a minute using SHA-256.

Password hashing algorithms are *deliberately slow*: they perform thousands of iterations or require large amounts of memory so that each guess takes milliseconds on your server — and is practically infeasible at scale for an attacker.

```
Speed comparison (rough, 2025 hardware):
  SHA-256         :  ~10 billion hashes/sec per GPU
  bcrypt (cost 12):  ~20 thousand hashes/sec per GPU
  scrypt (N=32768):  ~3 thousand hashes/sec per GPU
  argon2id        :  tunable — can be slower still
```

> [!PITFALL] Using SHA-256 with a salt is still wrong
> Adding a salt prevents rainbow tables but does nothing about raw speed. Salted SHA-256 can still be brute-forced at billions of guesses per second. Use a purpose-built slow algorithm.

## Salts: defending against precomputation

A **salt** is a random value mixed into each password before hashing. Its role:

1. **Kills rainbow tables** — precomputed hash tables are useless because no table covers every salt.
2. **Different hash per user** — two users with the same password get different hashes, so cracking one leaks nothing about others.

Salts do not need to be secret — they are stored alongside the hash. Their only job is to be unique per credential.

## node:crypto scrypt

Node ships `scrypt` in its built-in `node:crypto` module — no npm package required. `scrypt` is a memory-hard algorithm designed to be expensive on both CPU and RAM, which limits GPU/ASIC attacks.

```js
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 16;   // 128 bits of randomness
const KEY_LEN   = 64;    // 512-bit output hash
const PARAMS    = { N: 32768, r: 8, p: 1 };  // N=work factor, r=block size, p=parallelism

async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEY_LEN, PARAMS);
  // Store everything needed to verify: salt + hash, base64-encoded
  return salt.toString("base64") + ":" + hash.toString("base64");
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(":");
  const salt         = Buffer.from(saltB64, "base64");
  const storedHash   = Buffer.from(hashB64, "base64");
  const candidateHash = await scryptAsync(password, salt, KEY_LEN, PARAMS);
  // timingSafeEqual prevents timing side-channels
  return timingSafeEqual(storedHash, candidateHash);
}
```

> [!OUTPUT]
> // hashPassword("hunter2") might produce:
> eW91cnNhbHRoZXJl:9Xj4...base64hash...==
> // verifyPassword("hunter2", stored) => true
> // verifyPassword("wrong",   stored) => false

**Tuning `N`:** The parameter `N` (must be a power of 2) controls memory and CPU cost. `N=32768` (32 KiB) is a reasonable starting point; for user-facing login with a slow server you might use `N=65536`. Benchmark on your hardware so each hash takes 100–300 ms.

## argon2: the current gold standard

**argon2** won the 2015 Password Hashing Competition and is the recommended algorithm for new systems in 2025+. It has three variants:

| Variant | Use case |
|---|---|
| argon2d | GPU resistance (not side-channel safe, avoid for passwords) |
| argon2i | Side-channel resistant |
| **argon2id** | Hybrid — best choice for passwords |

argon2id is configurable across time cost (iterations), memory cost, and parallelism — making it harder to optimise with custom silicon than scrypt.

```js
// Using the "argon2" npm package (not built-in):
import argon2 from "argon2";

async function hashPasswordArgon2(password) {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MiB
    timeCost:   3,      // iterations
    parallelism: 1,
  });
}

async function verifyArgon2(password, hash) {
  return await argon2.verify(hash, password);
}
```

> [!OUTPUT]
> $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>

The argon2 package encodes everything (variant, version, params, salt, hash) into a single portable string — no manual salt management needed.

> [!PRINCIPAL] scrypt vs argon2 in practice
> Both are excellent. Use **scrypt** (built-in) when you want zero extra dependencies and Node 22+ is your baseline. Use **argon2id** (via npm) when you want the PHC winner, a simpler API, or you are aligning with OWASP's current top recommendation. Never use bcrypt for new systems — it truncates passwords at 72 bytes.

## Timing-safe comparison

Even with a slow hash, a naive `===` or `Buffer.equals()` comparison can leak information through **timing side channels**: the function returns faster when the first byte differs, giving an attacker a statistical oracle.

```js
import { timingSafeEqual } from "node:crypto";

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a dummy compare to hide the length mismatch timing.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

> [!WARNING] Always use timingSafeEqual for secret comparisons
> This includes hash comparisons, HMAC comparisons, API key comparisons, and CSRF token comparisons. Regular equality leaks timing information.

## Try it yourself

The sandbox can't run Node crypto, but we can demonstrate the **core ideas** — salting, a deliberately slow hash (simulated with repeated XOR rounds), and timing-safe compare — in pure JS:

```js run
// Toy demo: salting + a "slow" hash + constant-time compare.
// In production you'd use node:crypto scrypt or argon2id.

function pseudoRandBytes(n, seed) {
  // Deterministic "random" for demo purposes
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Simulate a salt (in real code: crypto.randomBytes(16))
function makeSalt(userIdSeed) {
  return pseudoRandBytes(8, userIdSeed);
}

// "Slow" hash: iterate mixing many times (toy — real scrypt uses ~32768 rounds + memory)
function slowHash(password, salt, rounds = 10000) {
  const pw = new TextEncoder().encode(password);
  let state = new Uint8Array(32);
  // Absorb salt
  for (let i = 0; i < salt.length; i++) state[i % 32] ^= salt[i];
  // Absorb password
  for (let i = 0; i < pw.length; i++) state[i % 32] ^= pw[i];
  // Iterate to add cost
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 32; i++) {
      state[i] = ((state[i] << 1) | (state[i] >> 7)) ^ state[(i + 1) % 32] ^ (r & 0xff);
    }
  }
  return state;
}

// Constant-time compare
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Hash a password
const salt = makeSalt(42);
const hash = slowHash("correcthorsebatterystaple", salt);

console.log("Salt (hex):", toHex(salt));
console.log("Hash (hex):", toHex(hash));

// Verify correct password
const candidate1 = slowHash("correcthorsebatterystaple", salt);
console.log("Correct password matches:", timingSafeEq(hash, candidate1));

// Verify wrong password
const candidate2 = slowHash("wrongpassword", salt);
console.log("Wrong password matches:  ", timingSafeEq(hash, candidate2));
```

## Exercise

**Challenge:** Extend the toy hasher above to store the salt alongside the hash (as a combined string like `"<salt_hex>:<hash_hex>"`), and write `hashPw(password)` and `verifyPw(password, stored)` functions.

<details>
<summary>Show solution</summary>

```js run
function pseudoRandBytes(n, seed) {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let saltCounter = 0;
function makeSalt() {
  return pseudoRandBytes(8, ++saltCounter * 999983);
}

function slowHash(password, salt, rounds = 5000) {
  const pw = new TextEncoder().encode(password);
  let state = new Uint8Array(32);
  for (let i = 0; i < salt.length; i++) state[i % 32] ^= salt[i];
  for (let i = 0; i < pw.length; i++) state[i % 32] ^= pw[i];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 32; i++) {
      state[i] = ((state[i] << 1) | (state[i] >> 7)) ^ state[(i + 1) % 32] ^ (r & 0xff);
    }
  }
  return state;
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hashPw(password) {
  const salt = makeSalt();
  const hash = slowHash(password, salt);
  return toHex(salt) + ":" + toHex(hash);
}

function verifyPw(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const salt = fromHex(saltHex);
  const storedHash = fromHex(hashHex);
  const candidate = slowHash(password, salt);
  return timingSafeEq(storedHash, candidate);
}

const stored = hashPw("my-secret-pass");
console.log("Stored:", stored.slice(0, 40) + "...");
console.log("Correct:", verifyPw("my-secret-pass", stored));
console.log("Wrong:  ", verifyPw("hacker-guess", stored));
```

</details>

## Common pitfalls

> [!PITFALL] Re-using the same salt for every user
> If every row in your database has the same salt, an attacker can crack all passwords simultaneously with a single dictionary pass. Generate a fresh random salt for **every** individual hash operation.

> [!PITFALL] Storing the hash before the await resolves
> scrypt is async. A common mistake is to call `scrypt()` without awaiting and store the pending Promise object. Always `await scryptAsync(...)`.

> [!PITFALL] Comparing digests with `===`
> String equality in JavaScript short-circuits on the first mismatched character, leaking timing information. Use `timingSafeEqual` from `node:crypto` every time you compare secrets.

## What you learned

- Fast hashes (MD5, SHA-256) are wrong for passwords because GPUs can compute billions per second; purpose-built algorithms add artificial cost.
- A random **salt** per password defeats rainbow tables and makes identical passwords hash differently.
- **node:crypto scrypt** is built-in and solid; tune `N` so each hash takes ~100–300 ms.
- **argon2id** (via npm) is the PHC winner and OWASP's top recommendation for new systems.
- Always compare hashes using `timingSafeEqual` to prevent timing side-channel attacks.

## Next steps

Secure storage is only one piece of the puzzle. Next we look at how authenticated sessions are maintained across HTTP requests — the battle between stateful **sessions** and stateless **JWTs**, and how to set cookies safely.
*/});
