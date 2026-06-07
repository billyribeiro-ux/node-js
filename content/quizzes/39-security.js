registerQuiz("39-threat-modeling", [
  {
    q: "In the STRIDE framework, which threat category does an IDOR (Insecure Direct Object Reference) vulnerability primarily represent?",
    options: [
      "Spoofing",
      "Tampering",
      "Information Disclosure",
      "Elevation of Privilege"
    ],
    answer: 3,
    explain: "IDOR allows a user to access resources belonging to another user by manipulating an identifier (e.g. changing /api/invoices/42 to /api/invoices/43). This violates Authorisation — the E in STRIDE — because the attacker gains access to resources they should not be permitted to view."
  },
  {
    q: "Which secure-default HTTP header set does the 'helmet' middleware apply to a Node.js/Express application?",
    options: [
      "Only the X-Powered-By removal header",
      "Content-Security-Policy, HSTS, X-Frame-Options, and other security-relevant headers",
      "Only CORS headers for cross-origin requests",
      "Authorization and WWW-Authenticate headers for API authentication"
    ],
    answer: 1,
    explain: "helmet() sets multiple security-relevant HTTP headers in a single call: Content-Security-Policy, Strict-Transport-Security (HSTS), X-Frame-Options, X-Content-Type-Options, and others. This is the 'secure by default' pattern — the safest configuration is the default one."
  },
  {
    q: "In a threat risk matrix scored by likelihood x impact, which action should you take first for a threat scored CRITICAL (score >= 15)?",
    options: [
      "Accept the risk and add it to the backlog with low priority",
      "Immediately prioritise mitigation before lower-scored threats, since it represents the highest combined risk",
      "Escalate to the security team only, not the engineering team",
      "Treat it identically to HIGH-scored threats"
    ],
    answer: 1,
    explain: "A likelihood x impact score of 15 or above is CRITICAL because it combines high probability with high damage. Threat modeling produces a prioritised backlog where CRITICAL items must be mitigated first before addressing MEDIUM or LOW items."
  }
]);

registerResources("39-threat-modeling", [
  { title: "OWASP: Threat Modeling", url: "https://owasp.org/www-community/Threat_Modeling" },
  { title: "Microsoft STRIDE threat model", url: "https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats" },
  { title: "OWASP: Defense in Depth", url: "https://cheatsheetseries.owasp.org/cheatsheets/Defense_in_Depth_Cheat_Sheet.html" },
  { title: "helmet: Node.js security headers middleware", url: "https://helmetjs.github.io/" },
  { title: "OWASP: Least Privilege", url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html" }
]);

registerQuiz("39-supply-chain", [
  {
    q: "What makes 'npm ci' more secure than 'npm install' in a CI/CD pipeline?",
    options: [
      "npm ci skips devDependencies to reduce attack surface",
      "npm ci verifies the content hash of every package against the lockfile and fails if anything is out of sync",
      "npm ci uses a separate registry that is scanned for malware",
      "npm ci runs in a sandbox that prevents install scripts from executing"
    ],
    answer: 1,
    explain: "npm ci installs exactly what package-lock.json specifies and verifies each package's integrity hash. If the tarball content has changed since the lockfile was written, the install fails, catching tampering. npm install can resolve to different versions and does not fail on lockfile mismatches."
  },
  {
    q: "What is a Software Bill of Materials (SBOM), and which two dominant machine-readable formats are used for it?",
    options: [
      "A list of npm scripts; formatted as package.json and .npmrc",
      "A machine-readable inventory of all software components, their versions, licences, and hashes; CycloneDX and SPDX are the dominant formats",
      "A security audit report; formatted as SARIF and JUnit XML",
      "A deployment manifest; formatted as Kubernetes YAML and Helm charts"
    ],
    answer: 1,
    explain: "An SBOM is an ingredient list for your software — every direct and transitive dependency with versions, licences, and content hashes. CycloneDX (JSON/XML) and SPDX (ISO standard) are the two main formats. SBOMs let you answer 'are we affected by CVE-X?' in seconds."
  },
  {
    q: "What does npm provenance attestation cryptographically prove about a published package?",
    options: [
      "That the package has no known CVEs at publish time",
      "That the package author has a verified GitHub account",
      "That the published tarball was built from a specific source commit by a specific CI pipeline run",
      "That the package passed all its unit tests before publish"
    ],
    answer: 2,
    explain: "Provenance attestation creates a cryptographic chain linking the published tarball hash to the exact source repository commit SHA and the CI workflow run that built it. Running 'npm audit signatures' verifies this chain, detecting packages where the published artifact does not match the audited source."
  }
]);

registerResources("39-supply-chain", [
  { title: "npm: Auditing package dependencies for security vulnerabilities", url: "https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities" },
  { title: "npm: Package provenance", url: "https://docs.npmjs.com/generating-provenance-statements" },
  { title: "CycloneDX: SBOM standard", url: "https://cyclonedx.org/" },
  { title: "SPDX: Software Package Data Exchange", url: "https://spdx.dev/" },
  { title: "Node.js: Permission Model", url: "https://nodejs.org/api/permissions.html" }
]);

registerQuiz("39-owasp-node", [
  {
    q: "Why is prototype pollution via a recursive merge function so dangerous in a Node.js application?",
    options: [
      "It causes a memory leak that gradually slows the process",
      "It only affects the object being merged, so the blast radius is small",
      "Writing to __proto__ contaminates Object.prototype globally, so every plain object in the process inherits the injected property silently",
      "It triggers an unhandled exception that crashes the server"
    ],
    answer: 2,
    explain: "Object.prototype is the root prototype of all plain objects. Writing to it via __proto__ means every {} in the process suddenly has the injected property. This is global and silent — no error is thrown — and can lead to privilege escalation or remote code execution in templating engines."
  },
  {
    q: "What makes the regex pattern /(a+)+$/ dangerous when applied to user-controlled input like 'aaaaaaaaX'?",
    options: [
      "It matches too broadly and accepts invalid input",
      "The nested quantifiers cause catastrophic backtracking: the engine tries exponentially many paths before concluding no match, stalling the event loop",
      "The $ anchor causes the regex to scan the string twice",
      "It allocates too much memory during matching"
    ],
    answer: 1,
    explain: "Nested quantifiers like (a+)+ on overlapping character classes cause catastrophic backtracking: the engine tries every possible grouping of the 'a' characters exponentially. For n characters, roughly 2^n paths are explored. In Node.js this blocks the single-threaded event loop, making it a denial-of-service attack via one HTTP request."
  },
  {
    q: "Which fix prevents Server-Side Request Forgery (SSRF) when your API fetches a URL supplied by the user?",
    options: [
      "Encoding the URL with encodeURIComponent before fetching",
      "Using a POST request instead of GET to fetch the URL",
      "Validating the URL against an allowlist of permitted schemes and blocking private IP ranges and cloud metadata hostnames before fetching",
      "Setting a short timeout on the fetch call"
    ],
    answer: 2,
    explain: "SSRF is prevented by strict URL validation: allow only https: scheme, block known internal hostnames (169.254.169.254, localhost), and reject private IP ranges (10.x, 172.16-31.x, 192.168.x). Encoding or timeouts do not prevent an attacker from reaching internal services."
  }
]);

registerResources("39-owasp-node", [
  { title: "OWASP Top 10 (2021)", url: "https://owasp.org/Top10/" },
  { title: "OWASP: Prototype Pollution prevention", url: "https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html" },
  { title: "OWASP: Server-Side Request Forgery Prevention", url: "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html" },
  { title: "OWASP: Regular Expression Denial of Service (ReDoS)", url: "https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS" },
  { title: "OWASP: Injection Prevention", url: "https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html" }
]);
