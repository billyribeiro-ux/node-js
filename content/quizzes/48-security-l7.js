// Module 48 — Security Engineering & Supply-Chain Assurance

registerQuiz("48-threat-modeling-scale", [
  {
    q: "In STRIDE threat modeling, which category applies when an attacker crafts a forged JWT 'kid' header that redirects signature verification to an attacker-controlled JWKS endpoint?",
    options: [
      "Tampering",
      "Spoofing",
      "Elevation of Privilege",
      "Repudiation",
    ],
    answer: 1,
    explain: "Spoofing violates Authentication — the attacker is impersonating a legitimate identity. By forging the 'kid' header to point to their own key, they make the server verify a JWT they signed themselves, effectively spoofing any user identity.",
  },
  {
    q: "When computing a composite threat risk score as (likelihood x impact x STRIDE_weight x boundary_multiplier), why does crossing a trust boundary receive a 1.5x multiplier rather than being scored as a flat additive bonus?",
    options: [
      "Trust-boundary crossings always involve encryption overhead that linearly scales risk.",
      "A multiplicative factor reflects that boundary crossings amplify blast radius: a successful exploit at a boundary propagates into the inner zone, compounding the impact of all downstream threats.",
      "The 1.5x matches the CVSS base score formula for network-accessible vulnerabilities.",
      "It is an arbitrary convention from the STRIDE original paper by Michael Howard.",
    ],
    answer: 1,
    explain: "Crossing a trust boundary means a successful attack escapes from the outer zone into the inner zone, making every subsequent threat in that zone more reachable. A multiplicative factor captures this compounding effect — a boundary crossing does not just add risk, it multiplies the consequence of all threats behind it.",
  },
  {
    q: "According to the lesson, what is the most dangerous failure mode of threat modeling at scale — more dangerous than having no threat model at all?",
    options: [
      "Using STRIDE instead of PASTA or LINDDUN as the taxonomy.",
      "Not quantifying likelihood and impact numerically.",
      "A threat model that was done at kickoff and never updated, creating false confidence while the actual system diverges from the diagram.",
      "Failing to involve the security team in the initial DFD review.",
    ],
    answer: 2,
    explain: "A stale threat model gives false confidence: engineers believe the security posture is understood and reviewed when in reality new services, new external vendors, and new trust-boundary crossings have accumulated unreviewed. The lesson states this is worse than no model because it actively suppresses the pressure to do real security work.",
  },
]);

registerResources("48-threat-modeling-scale", [
  { title: "OWASP Threat Modeling Cheat Sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html" },
  { title: "Microsoft STRIDE threat categories", url: "https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats" },
  { title: "Google SRE Book — Security and Reliability", url: "https://sre.google/sre-book/security/" },
  { title: "Node.js Permission Model documentation", url: "https://nodejs.org/api/permissions.html" },
  { title: "OWASP Attack Tree methodology", url: "https://owasp.org/www-community/Threat_Modeling_Process" },
]);

registerQuiz("48-slsa-supplychain", [
  {
    q: "A typical GitHub Actions build using the official slsa-framework/slsa-github-generator achieves which SLSA level, and what requirement prevents it from reaching the next level?",
    options: [
      "SLSA L1; it cannot reach L2 because provenance is not signed.",
      "SLSA L2; it cannot reach L3 because the standard GitHub-hosted runner is not a hardened platform and the build can reach the internet mid-build.",
      "SLSA L3; it cannot reach L4 because GitHub does not support two-party review of workflow files.",
      "SLSA L4; no further levels are defined.",
    ],
    answer: 1,
    explain: "The SLSA GitHub generator produces signed provenance from a build-service identity (satisfying L2). Standard GitHub-hosted runners fail L3 because they are not hardened (SSH is accessible, runner has internet access during the build, secrets can be exfiltrated via environment). L3 requires an isolated, hardened build platform.",
  },
  {
    q: "Sigstore's keyless signing model stores signatures in the Rekor transparency log. What makes this fundamentally more secure than traditional long-lived private key signing?",
    options: [
      "Rekor encrypts signatures with AES-256, making them unreadable to attackers.",
      "The keyless approach uses OIDC ephemeral certificates so there is no long-lived private key to steal; an attacker must simultaneously compromise the OIDC issuer and forge a Rekor entry in the tamper-evident log.",
      "Rekor stores keys in hardware security modules (HSMs) owned by the Linux Foundation.",
      "Keyless signing automatically rotates the signing key every 30 days without operator action.",
    ],
    answer: 1,
    explain: "Traditional signing requires protecting a long-lived private key — the SolarWinds attack succeeded by stealing the build signing key. Sigstore's keyless model uses short-lived OIDC-issued certificates; no persistent key exists to steal. An attacker would need to compromise both the OIDC issuer (e.g., GitHub's identity system) and forge an entry in Rekor's append-only public log.",
  },
  {
    q: "The xz-utils backdoor (2024) bypassed source code review. Which SLSA control would have been most structurally effective at containing it?",
    options: [
      "SLSA L1: ensuring provenance documents exist for the build.",
      "SLSA L2: signing provenance with the build service identity.",
      "SLSA L3/L4: hermetic builds with two-party review of all inputs including build scripts and CI configuration, plus an isolated build environment preventing mid-build network access.",
      "Dependency pinning (npm ci) and lockfile verification.",
    ],
    answer: 2,
    explain: "The xz attack inserted malicious code in the build test harness, not the main source. It activated only during package builds and only on specific platforms. SLSA L3 requires isolated builds that cannot exfiltrate secrets or fetch mid-build; L4 requires two-party review of all inputs including build pipeline scripts. Either would have required review of the malicious build-system change.",
  },
]);

registerResources("48-slsa-supplychain", [
  { title: "SLSA framework specification", url: "https://slsa.dev/spec/v1.0/" },
  { title: "SLSA levels overview", url: "https://slsa.dev/levels" },
  { title: "Sigstore / cosign documentation", url: "https://docs.sigstore.dev/cosign/overview/" },
  { title: "in-toto Attestation Framework", url: "https://in-toto.io/" },
  { title: "npm provenance documentation", url: "https://docs.npmjs.com/generating-provenance-statements" },
  { title: "OpenSSF Supply Chain Security guidance", url: "https://openssf.org/blog/2022/09/01/supply-chain-security-resources/" },
]);

registerQuiz("48-fuzzing-sandboxing", [
  {
    q: "Why does coverage-guided fuzzing (jsfuzz, AFL, libFuzzer) find security bugs more efficiently than purely random input generation?",
    options: [
      "Coverage-guided fuzzers run in parallel across many machines, giving them more wall-clock time.",
      "They instrument the target to observe which branches execute, then use a genetic algorithm to mutate inputs toward unexplored branches, systematically reaching deep parsing and processing logic that random inputs almost never hit.",
      "They use a pre-built dictionary of known malicious payloads rather than generating inputs from scratch.",
      "They focus exclusively on inputs that cause out-of-memory errors, which are more security-relevant.",
    ],
    answer: 1,
    explain: "A random fuzzer is blocked by early validation checks that reject most random inputs before reaching interesting code. A coverage-guided fuzzer observes which branches execute and mutates a corpus to maximize branch coverage, efficiently driving inputs past validators and deep into parsing logic where security bugs live.",
  },
  {
    q: "The Node.js vm module documentation explicitly states that vm.runInNewContext is NOT a security boundary. Why can prototype chain traversal escape a vm.Context?",
    options: [
      "vm.Context objects share file descriptor tables with the outer process, allowing direct I/O access.",
      "A vm.Context provides a separate global object but runs in the same V8 Isolate and heap; traversing the prototype chain via ({}).constructor.constructor gives access to the Function constructor which can return the real process object.",
      "The vm module does not sandbox require(), so any module can be loaded from within the context.",
      "V8 Isolate boundaries can be crossed using SharedArrayBuffer from within a vm.Context.",
    ],
    answer: 1,
    explain: "A vm.Context is a different global object but shares the same V8 heap and Isolate. Prototype chain access like 'this.constructor.constructor(\"return process\")()' traverses up to the real Function constructor and executes code with full access to the outer process. This is documented behaviour, not a bug, and the Node security team explicitly does not treat vm escapes as security issues.",
  },
  {
    q: "For running truly untrusted JavaScript plugins, what is the minimum set of isolation layers the lesson recommends before any VM-level isolation is considered meaningful?",
    options: [
      "vm.runInNewContext with a frozen global object and Object.freeze on all prototypes.",
      "A separate OS process spawned via child_process.fork, combined with --experimental-permission granting only the required filesystem paths, plus a seccomp filter to restrict the syscall surface.",
      "A worker_threads Worker with a ResourceLimits object constraining CPU and memory.",
      "Running in a Docker container without specifying seccomp, which already provides default isolation.",
    ],
    answer: 1,
    explain: "Real isolation requires OS-level enforcement, not JavaScript-level tricks. The layered model is: (1) separate OS process via fork so a crash cannot corrupt the parent, (2) Node permission model enforced in C++ to restrict FS/net access before syscalls reach the kernel, and (3) seccomp-BPF to whitelist the allowed syscall surface. Worker threads share the Isolate and heap, providing no security boundary.",
  },
]);

registerResources("48-fuzzing-sandboxing", [
  { title: "Node.js vm module documentation (with security warning)", url: "https://nodejs.org/api/vm.html" },
  { title: "Node.js Permission Model documentation", url: "https://nodejs.org/api/permissions.html" },
  { title: "OWASP Fuzzing guide", url: "https://owasp.org/www-community/Fuzzing" },
  { title: "fast-check property-based testing library", url: "https://fast-check.io/" },
  { title: "Cloudflare workerd runtime (V8 isolate-based sandboxing)", url: "https://github.com/cloudflare/workerd" },
]);
