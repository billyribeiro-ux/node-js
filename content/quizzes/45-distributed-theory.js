registerQuiz("45-consistency-models", [
  {
    q: "Which consistency model guarantees that if operation A completes before operation B starts, every observer must see A's effect before B's — and which real systems offer it?",
    options: [
      "Sequential consistency; offered by Cassandra with QUORUM reads and writes",
      "Causal consistency; offered by MongoDB with causally consistent sessions",
      "Linearizability; offered by etcd (Raft-backed), CockroachDB, and PostgreSQL with synchronous replication and fencing",
      "Read-your-writes; offered by DynamoDB with session-level routing"
    ],
    answer: 2,
    explain: "Linearizability (Herlihy & Wing, 1990) is the strongest practical consistency model. It provides a real-time ordering guarantee: any operation that finishes before another begins must appear to take effect first. etcd uses Raft to achieve linearizability; CockroachDB and Spanner also provide it. The cost is at least one network round-trip per operation to achieve distributed agreement."
  },
  {
    q: "In a system with N=5 replicas using W=2 write quorum and R=2 read quorum, does R+W>N hold, and what does this mean for consistency?",
    options: [
      "Yes, R+W=4 > N=5 is false; this configuration provides only eventual consistency",
      "No, R+W=4 is not greater than N=5; reads may miss the latest write since the read and write quorums might not overlap",
      "Yes, R+W=4 > N=5; strong consistency is guaranteed because quorums always overlap",
      "The quorum formula R+W>N does not apply when N is odd"
    ],
    answer: 1,
    explain: "R+W > N is the quorum invariant that guarantees at least one node in any read set participated in the last acknowledged write. With N=5, W=2, R=2: R+W=4, which is NOT greater than 5. This means a read quorum and a write quorum might not share any nodes, so a read can return stale data. For strong consistency with N=5 you need R+W >= 6, e.g., W=3 R=3."
  },
  {
    q: "The PACELC model extends CAP by analysing what additional tradeoff that occurs even during normal operation without a partition?",
    options: [
      "PACELC extends CAP by quantifying the storage cost of maintaining multiple replicas",
      "PACELC captures that even without partition, a system must trade off Latency against Consistency: stronger consistency requires coordination round-trips that add latency",
      "PACELC formalises the tradeoff between Partition tolerance and Availability in multi-datacenter deployments",
      "PACELC replaces CAP entirely and is only applicable to globally distributed databases"
    ],
    answer: 1,
    explain: "Abadi's PACELC (2010) model states: if there is a Partition, choose between Availability and Consistency; Else (normal operation), choose between Latency and Consistency. CAP only discusses partitioned operation. The L vs C tradeoff in normal operation is often the dominant factor for interactive workloads: achieving linearizability requires coordination that adds 10-100 ms of latency in multi-AZ or multi-region deployments."
  }
]);

registerResources("45-consistency-models", [
  { title: "Herlihy & Wing: Linearizability (1990, ACM TOPLAS)", url: "https://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf" },
  { title: "Brewer: CAP Twelve Years Later (IEEE, 2012)", url: "https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/" },
  { title: "Abadi: Consistency Tradeoffs in Modern DBMS Design (PACELC, 2012)", url: "https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf" },
  { title: "Jepsen: Consistency Models overview", url: "https://jepsen.io/consistency" },
  { title: "Martin Kleppmann: Designing Data-Intensive Applications — Consistency and Consensus", url: "https://dataintensive.net/" }
]);

registerQuiz("45-consensus", [
  {
    q: "What does the FLP impossibility result (Fischer, Lynch, Paterson 1985) prove about deterministic consensus algorithms in asynchronous distributed systems?",
    options: [
      "No consensus algorithm can guarantee both safety (agreement) and liveness (termination) if even one process may crash, in a purely asynchronous network",
      "Consensus is impossible when more than half the nodes in a cluster fail simultaneously",
      "No consensus algorithm can operate without a designated leader node",
      "FLP proves that Paxos is strictly stronger than Raft in terms of fault tolerance"
    ],
    answer: 0,
    explain: "FLP proves that no deterministic algorithm can guarantee termination (liveness) in a purely asynchronous network where even a single process may fail. The intuition: you cannot distinguish a slow node from a crashed one. Real systems escape FLP by assuming partial synchrony (messages arrive within some bound most of the time) and using randomisation — Raft's randomised election timeouts are a direct application."
  },
  {
    q: "In Raft's leader election, a candidate requests votes from peers. Under which two conditions will a peer grant its vote to the candidate?",
    options: [
      "The peer has not yet voted in the current term, AND the candidate's log is at least as up-to-date as the peer's log",
      "The peer recognises the candidate as the previous term's leader, AND the candidate's term is higher",
      "The peer's own election timeout has expired, AND the candidate's log is longer than the peer's",
      "The candidate has a higher node ID than the peer, AND the candidate's term matches the peer's"
    ],
    answer: 0,
    explain: "Raft's vote-granting rules are: (a) the voter has not already voted in the current term (votedFor is null or is the candidate), and (b) the candidate's log is at least as up-to-date as the voter's log (compared by last-log-term first, then log length). Condition (b) is Raft's core safety property — it prevents a leader from winning an election if its log is missing committed entries that other nodes hold."
  },
  {
    q: "A 3-node Raft cluster partitions into a 2-node majority side and a 1-node minority side. The minority node repeatedly times out and increments its term. When the partition heals, what happens?",
    options: [
      "The minority node immediately becomes the new leader because it has the highest term number",
      "The minority node's higher term causes the majority-side leader to step down; a new election occurs, but because the minority node's log is empty or stale, it cannot win — a node from the majority side wins and retains all committed entries",
      "The cluster enters a split-brain state until an operator manually resets all term numbers",
      "The minority node's excess terms are silently discarded by the rejoining cluster protocol"
    ],
    answer: 1,
    explain: "When the minority node reconnects with a higher term, the existing leader sees the higher term and immediately steps down (term-fencing). A new election begins in the higher term. However, Raft's log-up-to-date check prevents the minority node from winning: voters on the majority side have log entries that the minority node lacks, so they will not grant it their votes. A majority-side node wins and all committed entries are preserved."
  }
]);

registerResources("45-consensus", [
  { title: "Raft: In Search of an Understandable Consensus Algorithm (Ongaro & Ousterhout, 2014)", url: "https://raft.github.io/raft.pdf" },
  { title: "Raft interactive visualisation", url: "https://raft.github.io/" },
  { title: "FLP Impossibility: Impossibility of Distributed Consensus with One Faulty Process (1985)", url: "https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf" },
  { title: "etcd: Raft implementation and documentation", url: "https://etcd.io/docs/v3.5/learning/design-learner/" },
  { title: "Jepsen: Raft and consensus analysis", url: "https://jepsen.io/analyses" }
]);

registerQuiz("45-clocks-crdts", [
  {
    q: "Given vector clocks A = {R0: 2, R1: 0} and B = {R0: 0, R1: 1}, what is their causal relationship?",
    options: [
      "A happened-before B because R0 component of A is larger",
      "B happened-before A because R1 component of B is larger",
      "A and B are concurrent — neither dominates the other because A has a component larger than B (R0: 2 > 0) AND B has a component larger than A (R1: 1 > 0)",
      "A and B are equal because their total values are both 2"
    ],
    answer: 2,
    explain: "Two vector clocks A and B are concurrent (neither happened-before the other) when there exists at least one component where A > B AND at least one component where B > A. Here A[R0]=2 > B[R0]=0 and B[R1]=1 > A[R1]=0. Neither dominates, so the events are concurrent. This means they represent causally independent writes that need conflict resolution — the correct tool for this is a CRDT or explicit application-level merge."
  },
  {
    q: "Why is using wall-clock timestamps (Date.now()) for Last-Write-Wins (LWW) conflict resolution in a distributed system dangerous?",
    options: [
      "Wall clocks are too imprecise; they have only millisecond resolution which is insufficient for high-throughput systems",
      "Wall clocks can skew between servers due to NTP corrections (which can step the clock backward), causing a write that occurred later in real time to have a smaller timestamp and be silently discarded by LWW",
      "Date.now() is not available in all JavaScript environments used for distributed systems",
      "Wall-clock LWW works correctly but is slower than vector clock comparison"
    ],
    answer: 1,
    explain: "NTP can correct clock drift by stepping the clock backward, meaning a process's timestamps can be non-monotonic across restarts or NTP adjustments. Two servers synchronised to within ±10 ms can still produce timestamps where a later write from server A has a smaller timestamp than an earlier write from server B. LWW with wall-clock timestamps can silently discard the more recent write. Hybrid Logical Clocks (HLC) combine wall time with a Lamport counter to provide both human-readable timestamps and monotonic causal ordering."
  },
  {
    q: "In an OR-Set CRDT, replicas R0 and R1 are partitioned. R0 adds element 'user:1' with tag T1 then removes it (tombstoning T1). R1 concurrently adds 'user:1' with tag T2. After partition heals and states are merged, is 'user:1' present in the merged set?",
    options: [
      "No — the remove operation on R0 tombstones the element globally, so it is absent from the merged set",
      "Yes — R0's tombstone only covers tag T1; R1's add uses a different unique tag T2 which is not tombstoned, so 'user:1' survives as an alive element in the merge",
      "The result is undefined because OR-Set does not handle concurrent add and remove of the same element",
      "No — OR-Set uses remove-wins semantics, so any tombstone removes the element permanently"
    ],
    answer: 1,
    explain: "OR-Set (Observed-Remove Set) uses add-wins semantics. Each add operation attaches a unique tag (e.g., a UUID). A remove tombstones only the specific tags observed at remove time. R0's remove tombstones T1. R1's concurrent add introduces T2, which R0 has never seen. The merge takes the union of all adds minus the union of tombstoned tags: T1 is gone but T2 is alive, so 'user:1' appears in the merged set."
  }
]);

registerResources("45-clocks-crdts", [
  { title: "Lamport: Time, Clocks, and the Ordering of Events (1978)", url: "https://lamport.azurewebsites.net/pubs/time-clocks.pdf" },
  { title: "Shapiro et al: A comprehensive study of CRDTs (2011)", url: "https://inria.hal.science/inria-00555588/document" },
  { title: "Riak: Vector Clocks and Conflict Resolution", url: "https://docs.riak.com/riak/kv/latest/learn/concepts/causal-context/index.html" },
  { title: "CockroachDB: Hybrid Logical Clocks", url: "https://www.cockroachlabs.com/blog/living-without-atomic-clocks/" },
  { title: "Martin Kleppmann: CRDTs: The Hard Parts (talk)", url: "https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html" }
]);

registerQuiz("45-exactly-once", [
  {
    q: "Kafka's exactly-once semantics (EOS) prevents duplicate records within Kafka using idempotent producers and transactions. What does this NOT protect against, and what must application developers implement themselves?",
    options: [
      "Kafka EOS does not protect against duplicate records within a single partition; developers must use client-side deduplication",
      "Kafka EOS guarantees delivery within the Kafka ecosystem, but when a consumer reads a message and writes to an external system (PostgreSQL, REST API), the developer must implement an idempotent consumer with a dedup store to prevent duplicate side effects",
      "Kafka EOS only works with exactly 3 brokers; with other cluster sizes developers must implement their own producer IDs",
      "Kafka EOS is only available in the Java client; Node.js consumers must always handle duplicates manually"
    ],
    answer: 1,
    explain: "Kafka EOS (idempotent producers + transactions) prevents duplicate records within Kafka and enables atomic read-process-produce within Kafka. However, the moment a consumer reads a Kafka message and writes to an external database or calls an external API, Kafka provides no exactly-once guarantee for that external write. The application must implement an idempotent consumer — typically using a dedup store keyed by message ID — to prevent duplicate processing of redelivered messages."
  },
  {
    q: "In the Transactional Outbox pattern, an application writes to both a 'orders' business table and an 'outbox' table in the same database transaction. A relay process then reads the outbox and publishes events to a message broker. What happens if the relay crashes between publishing a message and marking the outbox row as 'sent'?",
    options: [
      "The message is permanently lost; the outbox row must be manually recovered by an operator",
      "On restart the relay finds the row still marked unsent and re-publishes the same event; if the relay uses the stable outbox row UUID as the message idempotency key, the broker or consumer deduplicates the redelivery",
      "The database transaction is automatically rolled back because the relay crashed, so no duplicate is possible",
      "The relay uses a two-phase commit with the message broker to ensure exactly-once delivery without any retry"
    ],
    answer: 1,
    explain: "The transactional outbox is designed to be crash-safe. If the relay crashes after publishing but before marking the row sent, on restart it finds the row unsent and re-publishes. The key to safety is using the outbox row's stable UUID as the message ID / idempotency key so the broker or consumer can deduplicate the retry. This is the core property of the pattern: the relay is idempotent because it always publishes with the same key."
  },
  {
    q: "What is the fundamental reason exactly-once message delivery is provably impossible in any asynchronous distributed system with faulty channels, even with sophisticated protocols?",
    options: [
      "Clock synchronisation cannot be achieved accurately enough to assign unique timestamps to every message",
      "After a consumer processes a message and before it sends an acknowledgement, the network can fail or the consumer can crash; the sender cannot distinguish 'processed but ack lost' from 'never processed', so it must retry — and the consumer must handle the resulting duplicate",
      "Message brokers have finite storage and will eventually drop messages under load",
      "The TCP protocol guarantees at-most-once delivery, which is incompatible with at-least-once requirements"
    ],
    answer: 1,
    explain: "The core impossibility is the Two Generals Problem variant: between 'consumer processes message' and 'consumer sends ACK', the channel can fail or the consumer can crash. From the sender's perspective, it cannot know whether the consumer processed the message or not, so it must retry (ensuring at-least-once) or risk losing the message (at-most-once). No protocol can guarantee both without shared durable state visible to both sides. Exactly-once effects are achieved by idempotent processing, not by exactly-once delivery."
  }
]);

registerResources("45-exactly-once", [
  { title: "Kafka Documentation: Exactly-Once Semantics", url: "https://kafka.apache.org/documentation/#semantics" },
  { title: "Martin Fowler: Transactional Outbox Pattern", url: "https://martinfowler.com/eaaDev/TransactionalOutbox.html" },
  { title: "Martin Fowler: Saga Pattern", url: "https://martinfowler.com/eaaDev/Sagas.html" },
  { title: "Node.js Docs: node:sqlite (DatabaseSync)", url: "https://nodejs.org/api/sqlite.html" },
  { title: "Stripe: Idempotency Keys and API design", url: "https://stripe.com/docs/api/idempotent_requests" }
]);
