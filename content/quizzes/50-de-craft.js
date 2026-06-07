registerQuiz("50-technical-strategy", [
  {
    q: "According to Rumelt's kernel, which of the following is a diagnosis rather than mere ambition?",
    options: [
      "We want to be best-in-class for reliability across all services",
      "Our p99 latency degrades 8x under fan-out write load because there is no backpressure between the API layer and the job queue",
      "We need to improve our incident response time by 50% this year",
      "Engineering should adopt a culture of quality and ownership"
    ],
    answer: 1,
    explain: "A diagnosis names the specific mechanism and points to a tractable intervention. Option B identifies the exact failure mode (fan-out write load, missing backpressure) rather than stating a goal or aspiration. The other options are ambitions or vague objectives, not diagnoses."
  },
  {
    q: "In a tech radar, what is the most informative signal about a blip that moves from 'Trial' to 'Hold' after three months?",
    options: [
      "The technology is too new to evaluate fairly",
      "The organisation ran out of budget for the evaluation",
      "The trial produced a specific negative finding the org must document and communicate",
      "The radar is being reset for a new quarter"
    ],
    answer: 2,
    explain: "Blip movement tells a story. A rapid move from Trial to Hold means the evaluation found a specific problem — performance, operational cost, licensing, or a mismatch with org needs. That story must be captured (ideally in an ADR) so other teams do not repeat the evaluation."
  },
  {
    q: "When using a weighted decision matrix for a build-vs-buy-vs-adopt decision, what additional step is required before the result is trustworthy?",
    options: [
      "Presenting the matrix to the entire engineering organisation for a vote",
      "Running sensitivity analysis to check if the winning option changes when key weights are varied",
      "Adding at least five criteria so no single criterion dominates",
      "Converting all scores to percentages before multiplying by weights"
    ],
    answer: 1,
    explain: "Sensitivity analysis varies each weight and checks if the winner changes. If it does, the decision hinges on a contested assumption that must be surfaced and debated. Without this step the matrix produces a false sense of precision and hides the real point of disagreement."
  }
]);

registerResources("50-technical-strategy", [
  { title: "Good Strategy Bad Strategy — Richard Rumelt (overview)", url: "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/the-perils-of-bad-strategy" },
  { title: "ThoughtWorks Technology Radar — format and methodology", url: "https://www.thoughtworks.com/radar/faq" },
  { title: "Martin Fowler: Bliki — TechRadar", url: "https://martinfowler.com/bliki/TechRadar.html" },
  { title: "Will Larson: Strategies and visions (lethain.com)", url: "https://lethain.com/strategies-visions/" },
  { title: "AWS Architecture Blog: One-way and two-way door decisions", url: "https://aws.amazon.com/executive-insights/content/how-amazon-defines-and-operationalizes-a-day-1-culture/" }
]);

registerQuiz("50-rfcs-adrs", [
  {
    q: "Why is the 'Non-Goals' section of an RFC considered a promise rather than an apology?",
    options: [
      "It signals that the author did not have time to address those topics",
      "It explicitly scopes future RFCs, preventing scope creep in the current review and making clear what will be addressed later",
      "It reduces the length of the RFC so reviewers are more likely to read it",
      "It allows the RFC to be marked Accepted without resolving all open questions"
    ],
    answer: 1,
    explain: "Non-goals bound the RFC's scope precisely. They prevent reviewers from expanding the discussion into adjacent areas and implicitly commit the author (or team) to addressing those areas in follow-on documents. A well-defined non-goals list is a sequencing signal, not an admission of incompleteness."
  },
  {
    q: "What makes an Architecture Decision Record (ADR) immutable, and what happens when the decision changes?",
    options: [
      "ADRs are immutable because they are stored in a read-only system; changes require admin access",
      "ADRs capture reasoning at a point in time and are never edited; a new ADR with 'Superseded by' status replaces the old one",
      "ADRs are immutable only until the RFC that generated them is closed",
      "The immutability rule applies only to ADRs approved by a principal engineer or above"
    ],
    answer: 1,
    explain: "The power of ADR immutability is that the chain of supersession preserves every reasoning snapshot. A future engineer can trace why the current approach replaced the old one and evaluate whether the conditions that drove the change are still valid. Editing in place destroys this chain."
  },
  {
    q: "In an async RFC design review, what is the correct role of the optional convergence call?",
    options: [
      "To allow the highest-ranking engineer to make the final decision in real time",
      "To replace the written comment phase when the RFC is particularly complex",
      "To resolve the remaining substantive objections so the decision can still be recorded in writing",
      "To present the RFC to stakeholders who refused to read the written document"
    ],
    answer: 2,
    explain: "The convergence call is a last-resort tool for unresolved written objections, not a replacement for async review. Its output is a written summary posted to the RFC thread, keeping the decision record in writing. The call resolves unknowns; the decision itself is still made and recorded asynchronously."
  }
]);

registerResources("50-rfcs-adrs", [
  { title: "Documenting Architecture Decisions — Michael Nygard (original ADR post)", url: "https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions" },
  { title: "adr.github.io — ADR tools, templates, and community resources", url: "https://adr.github.io/" },
  { title: "Martin Fowler: Writing Architecturally Significant Decisions", url: "https://martinfowler.com/articles/scaling-architecture-conversationally.html" },
  { title: "Google Engineering Practices: Code Review and Design Review", url: "https://google.github.io/eng-practices/" },
  { title: "RFC 2119: Key words for use in RFCs to Indicate Requirement Levels", url: "https://datatracker.ietf.org/doc/html/rfc2119" }
]);

registerQuiz("50-influence", [
  {
    q: "According to Will Larson's Staff Engineer archetypes, what is the primary failure mode of the Tech Lead archetype?",
    options: [
      "Writing too many RFCs instead of shipping code",
      "Becoming the team's fastest senior IC again, making the team dependent on one person and preventing others from growing",
      "Taking on too many cross-team responsibilities and losing focus on the home team",
      "Spending too much time in architecture diagrams rather than production code"
    ],
    answer: 1,
    explain: "The Tech Lead's leverage comes from establishing patterns others follow, not from being the fastest individual contributor. When a Tech Lead over-invests in personal output — fastest reviewer, most PRs, constant pairing — the team ships but no one grows and a single point of failure is created."
  },
  {
    q: "In the leverage model (leverage = impact x reach / effort), what is the most common failure mode when evaluating a 'paved road' initiative?",
    options: [
      "Overestimating impact because the library is technically interesting",
      "Underestimating effort by ignoring the ongoing maintenance tail, which causes the denominator to grow without bound and collapses the leverage",
      "Underestimating reach because only the teams you know personally are counted",
      "Choosing reach over impact, leading to widespread adoption of a low-value tool"
    ],
    answer: 1,
    explain: "A paved road that 60 teams adopt looks like high leverage, but if it requires constant maintenance and breaks on every runtime upgrade, the effort denominator grows continuously. Effort must include the maintenance tail to produce an honest leverage estimate."
  },
  {
    q: "What distinguishes sponsorship from mentorship at the staff-plus level, and why is sponsorship considered the higher-leverage lever?",
    options: [
      "Sponsorship involves formal performance reviews; mentorship is informal advice",
      "Mentorship transfers knowledge one-to-one; sponsorship uses credibility and network to create opportunities for someone, compounding through the careers of those sponsored",
      "Sponsorship is for engineers at the same level; mentorship is for those more junior",
      "They are equivalent — both scale linearly with the number of people you support"
    ],
    answer: 1,
    explain: "Mentoring gives advice and scales linearly. Sponsorship spends social capital to open doors — recommending someone for a high-visibility project, including them in a design review, naming them as ready for promotion. The sponsored engineer's growing credibility then sponsors others, compounding the original investment."
  }
]);

registerResources("50-influence", [
  { title: "Staff Engineer: Leadership Beyond the Management Track — Will Larson", url: "https://staffeng.com/book" },
  { title: "lethain.com: Staff archetypes in practice", url: "https://lethain.com/staff-engineer-archetypes/" },
  { title: "lethain.com: Finding your role in the staff+ transition", url: "https://lethain.com/finding-the-right-company/" },
  { title: "Martin Fowler: Bliki — StranglerFigApplication (influence through paved roads)", url: "https://martinfowler.com/bliki/StranglerFigApplication.html" },
  { title: "Tanya Reilly: Being Glue (the hidden work of senior engineers)", url: "https://noidea.dog/glue" }
]);

registerQuiz("50-capstone-de", [
  {
    q: "In the seven-phase system design method, what is the primary purpose of back-of-envelope estimation in Phase 2?",
    options: [
      "To produce the exact numbers that will appear in the system's SLA commitments",
      "To determine the order-of-magnitude scale so design decisions are not made for the wrong class of system",
      "To justify the budget request to management before architecture work begins",
      "To identify which engineers will be responsible for each component"
    ],
    answer: 1,
    explain: "Phase 2 estimation is about order-of-magnitude correctness — knowing whether you need one database node or a hundred, whether your fan-out is thousands or billions of writes per second. Numbers that don't close in Phase 2 cannot be patched in later phases, and a design sized for the wrong scale requires a full re-architecture under production pressure."
  },
  {
    q: "For a messaging system with users who have 100 million followers, why is pure write-time fan-out the wrong strategy, and what is the standard mitigation?",
    options: [
      "Write-time fan-out is too slow; the mitigation is to use a read-through cache for all users",
      "Write-time fan-out at celebrity scale produces 100 GB of inbox writes per post; the mitigation is a hybrid strategy — write-time fan-out for users below a follower threshold, read-time merge from the celebrity timeline above it",
      "Write-time fan-out creates consistency problems; the mitigation is to use eventual consistency for all users equally",
      "Write-time fan-out is insecure for high-follower accounts; the mitigation is rate limiting at the write API tier"
    ],
    answer: 1,
    explain: "A post from a 100-million-follower account triggers 100 million inbox updates at write time — at 1 KB per message, that is 100 GB of fan-out writes per post. The hybrid strategy applies write-time fan-out only below a defined follower threshold and merges the celebrity's timeline at read time above it, with a precise definition of the threshold and the transition logic."
  },
  {
    q: "What makes a tradeoff statement in a design review defensible, as opposed to merely presenting advantages?",
    options: [
      "A defensible statement uses formal notation and includes mathematical proofs of correctness",
      "A defensible statement names the criterion, the alternative considered, what was given up, and the condition under which the decision would be reversed",
      "A defensible statement lists all stakeholders who approved the choice",
      "A defensible statement cites at least three published papers supporting the design"
    ],
    answer: 1,
    explain: "Reviewers probe for what breaks. A tradeoff statement that names only advantages provides no signal that the designer found the weaknesses first. A defensible statement exposes the criterion that drove the choice, the realistic alternative, the cost accepted, and the reversal condition — leaving no surface for a reviewer to poke that has not already been named."
  }
]);

registerResources("50-capstone-de", [
  { title: "Google SRE Book: Service Level Objectives and error budgets", url: "https://sre.google/sre-book/service-level-objectives/" },
  { title: "Martin Fowler: Patterns of Distributed Systems", url: "https://martinfowler.com/articles/patterns-of-distributed-systems/" },
  { title: "lethain.com: System design at scale — back-of-envelope estimation", url: "https://lethain.com/introduction-to-architecting-systems-for-scale/" },
  { title: "Designing Data-Intensive Applications — Martin Kleppmann (chapter summaries)", url: "https://dataintensive.net/" },
  { title: "Google SRE Book: Distributed Consensus in Reliable Storage Systems", url: "https://sre.google/sre-book/table-of-contents/" }
]);
