registerLessonSrc("45-consensus", function () {/*
---
id: 45-consensus
title: "Consensus: Raft Leader Election & Log Replication"
minutes: 30
level: advanced
objectives:
  - Understand the consensus problem and why FLP impossibility matters
  - Walk through Raft's leader election, log replication, and safety properties
  - Build and step through a Raft leader-election state machine
---

# Consensus: Raft Leader Election & Log Replication

## Why this matters

Databases, distributed locks, service discovery registries, and configuration stores all rely on **consensus** — the ability of a cluster of nodes to agree on a value even when nodes crash or messages are delayed. etcd, the key-value store that backs every Kubernetes cluster, runs Raft. CockroachDB uses a per-range Raft group. Understanding Raft means you can debug split-brain events, tune election timeouts, and reason about why your distributed database stalls writes during a leadership election.

## Learning objectives

- Articulate the consensus problem formally and why it is impossible to solve deterministically in a purely async system (FLP).
- Explain Raft's three sub-problems: leader election, log replication, and safety.
- Trace through Raft's term/vote/commit lifecycle step by step.
- Run a Raft leader-election state machine and observe split-vote and re-election.

## The Consensus Problem

Given a cluster of N processes, each starting with some value, reach **consensus** such that:

1. **Termination** — every non-faulty process eventually decides.
2. **Agreement** — all deciding processes decide the same value.
3. **Validity** — the decided value was proposed by some process.
4. **Integrity** — each process decides at most once.

The naive attempt: "whoever broadcasts first wins." Fails under network partition — two nodes both think they broadcast first.

## FLP Impossibility (informally)

Fischer, Lynch, and Paterson (1985) proved: **no deterministic consensus algorithm can guarantee termination in an asynchronous network where even one process may fail**.

The intuition: in a purely async system, you cannot distinguish a slow node from a crashed one. If you wait forever for a response, you never terminate. If you stop waiting, you might be ignoring the crucial vote that would break a tie.

Practical systems escape FLP by using **partial synchrony** (assume messages arrive within some bound, most of the time) and **randomization** (Raft uses randomized election timeouts). These don't violate FLP — they relax the "purely async" assumption.

> [!PRINCIPAL]
> FLP is not a dead end — it's a design constraint. Every real consensus system (Raft, Paxos, ZAB, PBFT) escapes FLP by assuming *bounded message delay most of the time*. Raft's liveness depends on election timeout >> network round-trip. If your datacenter's P99 RTT is 5 ms, your election timeout should be at least 150–300 ms, with randomization spread of another 150 ms. Tune this wrong and you get flapping leaders under network jitter, which is far more common than node crashes.

## Raft Overview

Raft (Ongaro & Ousterhout, 2014) decomposes consensus into three relatively independent sub-problems:

1. **Leader election** — elect exactly one leader per term.
2. **Log replication** — the leader accepts log entries and replicates them to followers.
3. **Safety** — if a log entry is committed, it is present in all future leaders' logs.

### Terms

Raft time is divided into **terms** — monotonically increasing integers. Each term starts with an election. If a candidate wins, it leads for the rest of the term. If no winner is elected (split vote), a new term starts immediately.

Terms act as logical clocks. If a node receives a message from a higher term, it immediately updates its term and reverts to follower.

### Server Roles

- **Follower** — passive; responds to RPC from leader and candidates. If it receives no heartbeat within the election timeout, it starts an election.
- **Candidate** — follower that timed out; increments term, votes for itself, sends RequestVote RPCs.
- **Leader** — won the election; sends periodic heartbeats (AppendEntries with empty payload) to suppress new elections; accepts client requests.

### Leader Election

1. Follower's election timeout fires (random interval, e.g., 150–300 ms).
2. Follower increments `currentTerm`, transitions to Candidate, votes for itself.
3. Candidate broadcasts `RequestVote(term, candidateId, lastLogIndex, lastLogTerm)` to all other nodes.
4. Voters grant vote if: (a) they haven't voted in this term yet, and (b) candidate's log is at least as up-to-date as theirs.
5. Candidate wins if it receives votes from a majority (⌊N/2⌋ + 1 nodes). Transitions to Leader, sends immediate heartbeat.
6. If two candidates tie, the term ends without a winner; both restart with a new random timeout.

The "log up-to-date" check (step 4b) is Raft's key safety property: it ensures a new leader always has all committed entries.

> [!PRINCIPAL]
> Election timeout jitter is load-bearing. Without randomization, every follower times out simultaneously after a leader crash — they all become candidates, vote for themselves, and nobody gets a majority (split vote). The random spread ensures typically one node fires first and gathers votes before others even start. In practice, etcd defaults to 1000–2000 ms election timeouts, deliberately conservative to handle underloaded dev clusters. Production Kubernetes control planes often tune lower (500 ms) for faster failover.

### Log Replication

Once elected, the leader:

1. Receives client commands, appends them as new log entries with the current term.
2. Sends `AppendEntries(term, leaderId, prevLogIndex, prevLogTerm, entries[], leaderCommit)` to all followers.
3. Followers check `prevLogIndex`/`prevLogTerm` against their own log (consistency check). If it matches, they append the entries and reply success.
4. When a majority acknowledge an entry, the leader marks it **committed** and advances `commitIndex`.
5. The leader includes `commitIndex` in subsequent AppendEntries; followers apply committed entries to their state machine.

### Safety: the Log Matching Property

Raft guarantees: if two logs contain an entry with the same index and term, they are identical up to that point. This follows from the facts that (a) a leader creates at most one entry per term per index, and (b) followers only accept entries that pass the consistency check.

Combined with the election constraint (voters only elect candidates with up-to-date logs), Raft guarantees that committed entries are never overwritten.

## Raft vs Paxos

| | Raft | Multi-Paxos |
|---|---|---|
| Design goal | Understandability | Correctness first |
| Leader election | Integrated | Separate Phase 1 |
| Log gaps | Not allowed | Possible (holes) |
| Reconfiguration | Joint consensus | Ad-hoc |
| Implementations | etcd, CockroachDB, TiKV, Consul | Chubby, Zookeeper (ZAB variant) |

Raft's explicit leader model makes it easier to reason about — there is always one source of truth. Paxos allows any acceptor to initiate a write (leaderless in theory), which enables optimistic concurrency but complicates implementations. In practice, most Paxos deployments add a distinguished leader (Multi-Paxos), making them operationally similar to Raft.

## Split-Brain

Split-brain occurs when two nodes both believe they are the leader simultaneously — typically during a network partition where the quorum check is misconfigured or violated. Raft prevents this with **term-fencing**: if a stale leader receives a message from a higher term (new leader's heartbeat), it immediately steps down. A stale leader's writes are rejected by followers who know a newer term.

Production risk: split-brain can still cause *read* inconsistency. A stale leader with a stale `commitIndex` can serve reads that are behind the current committed state. etcd mitigates this with **linearizable reads** that require the leader to confirm it is still the leader via a quorum heartbeat before responding.

> [!PITFALL]
> Symmetric network partition with odd-N cluster: if 3-node cluster partitions 2-1, the minority node (1) times out and starts an election. It cannot win (needs 2 votes). It increments its term repeatedly. When the partition heals, the formerly-isolated node has a higher term than the current leader. The leader sees the higher-term message, steps down, and a new election starts — potentially causing a brief availability window. This is expected Raft behavior, not a bug. Monitor `raft_term` metrics for unexpected rapid term increases: it indicates network instability.

## Try it yourself

A fully runnable Raft leader-election state machine. Step through multiple election rounds, including a split-vote scenario.

```js run
// Raft leader-election state machine — pure JS, stepable

const FOLLOWER  = "follower";
const CANDIDATE = "candidate";
const LEADER    = "leader";

function makeNode(id, totalNodes) {
  return {
    id,
    totalNodes,
    state: FOLLOWER,
    currentTerm: 0,
    votedFor: null,
    votesReceived: new Set(),
    log: [], // [{term, command}]
    commitIndex: -1,
    // For simulation: track election timeout (random 150-300ms, modeled as ticks)
    electionTimeout: 150 + Math.floor(Math.random() * 150),
    electionTick: 0,
  };
}

function requestVote(candidate, voter) {
  // Voter grants if: (a) hasn't voted in this term, (b) candidate log >= voter log
  const candidateLogOk =
    candidate.log.length === 0 ||
    voter.log.length === 0 ||
    candidate.log[candidate.log.length - 1].term >= voter.log[voter.log.length - 1].term;

  if (
    voter.currentTerm <= candidate.currentTerm &&
    (voter.votedFor === null || voter.votedFor === candidate.id) &&
    candidateLogOk
  ) {
    voter.votedFor = candidate.id;
    voter.currentTerm = candidate.currentTerm;
    return { granted: true, term: voter.currentTerm };
  }
  return { granted: false, term: voter.currentTerm };
}

function startElection(node, allNodes) {
  node.state = CANDIDATE;
  node.currentTerm += 1;
  node.votedFor = node.id;
  node.votesReceived = new Set([node.id]);
  node.electionTick = 0;
  node.electionTimeout = 150 + Math.floor(Math.random() * 150); // re-randomize

  console.log(`  [T${node.currentTerm}] ${node.id} starts election`);

  const majority = Math.floor(node.totalNodes / 2) + 1;

  for (const other of allNodes) {
    if (other.id === node.id) continue;
    const result = requestVote(node, other);
    if (result.granted) {
      node.votesReceived.add(other.id);
      console.log(`    ${other.id} -> votes YES for ${node.id}`);
    } else {
      console.log(`    ${other.id} -> votes NO (term=${result.term}, votedFor=${other.votedFor})`);
    }
    // If voter has higher term, candidate steps down
    if (result.term > node.currentTerm) {
      node.state = FOLLOWER;
      node.currentTerm = result.term;
      console.log(`  ${node.id} steps down — saw higher term ${result.term}`);
      return false;
    }
  }

  if (node.votesReceived.size >= majority) {
    node.state = LEADER;
    console.log(`  [T${node.currentTerm}] ${node.id} wins with ${node.votesReceived.size}/${node.totalNodes} votes -> LEADER`);
    return true;
  } else {
    node.state = FOLLOWER;
    console.log(`  [T${node.currentTerm}] ${node.id} fails — only ${node.votesReceived.size}/${majority} needed`);
    return false;
  }
}

// Scenario 1: normal election in a 5-node cluster
console.log("=== Scenario 1: Normal 5-node election ===");
const cluster = [0,1,2,3,4].map(i => makeNode(`N${i}`, 5));
// N0's timeout fires first
startElection(cluster[0], cluster);
console.log("Final states:", cluster.map(n => `${n.id}:${n.state}[T${n.currentTerm}]`).join(", "));

// Scenario 2: split-vote (two candidates at the same time, small cluster)
console.log("\n=== Scenario 2: Split-vote in 4-node cluster ===");
const c4 = [0,1,2,3].map(i => makeNode(`M${i}`, 4));
// M0 and M2 both start elections in same term
c4[0].currentTerm = 1; c4[0].state = CANDIDATE; c4[0].votedFor = "M0"; c4[0].votesReceived = new Set(["M0"]);
c4[2].currentTerm = 1; c4[2].state = CANDIDATE; c4[2].votedFor = "M2"; c4[2].votesReceived = new Set(["M2"]);
// M1 votes for M0 (first RPC), M3 votes for M2
c4[1].votedFor = "M0"; c4[1].currentTerm = 1; c4[0].votesReceived.add("M1");
c4[3].votedFor = "M2"; c4[3].currentTerm = 1; c4[2].votesReceived.add("M3");

const majority4 = Math.floor(4/2)+1; // 3
console.log(`M0 has ${c4[0].votesReceived.size} votes (needs ${majority4}): ${c4[0].votesReceived.size >= majority4 ? "WIN" : "SPLIT"}`);
console.log(`M2 has ${c4[2].votesReceived.size} votes (needs ${majority4}): ${c4[2].votesReceived.size >= majority4 ? "WIN" : "SPLIT"}`);
console.log("Both candidates failed — new election with higher term will be needed");

// Scenario 3: re-election after split
console.log("\n=== Scenario 3: Re-election after split ===");
// Reset all to follower, bump term, re-randomize timeouts
c4.forEach(n => { n.state = FOLLOWER; n.votedFor = null; n.currentTerm = 1; });
// M1 fires first with T=2
startElection(c4[1], c4);
console.log("Final states:", c4.map(n => `${n.id}:${n.state}[T${n.currentTerm}]`).join(", "));
```

## Exercise: Raft invariant verification

Given the following cluster state after a partition heals, identify which nodes hold a valid committed entry and which are stale.

- N1 (was leader): log = [{term:1,cmd:"set x=1"}, {term:1,cmd:"set x=2"}], commitIndex = 1
- N2 (follower): log = [{term:1,cmd:"set x=1"}], commitIndex = 0
- N3 (was isolated, new candidate): log = [], currentTerm = 3

<details>
<summary>Show solution</summary>

N3 has a higher term (3 vs 1) — when it reconnects it sends a message with term=3. N1 and N2 see the higher term and immediately step down (revert to follower, clear votedFor). A new election in term 3 starts. N3 requests votes, but voters N1 and N2 check the log-up-to-date condition: N3 has an empty log, N1 has two entries with term 1. **N1 and N2 will NOT vote for N3** because N3's log is not at least as up-to-date as theirs. N1 or N2 will win the election in term 3 and bring their committed log entries. The committed entry at commitIndex=1 (set x=2) on N1 is safe.

```js run
function logUpToDate(candidate, voter) {
  if (candidate.length === 0 && voter.length === 0) return true;
  if (candidate.length === 0) return false;
  if (voter.length === 0) return true;
  const cl = candidate[candidate.length - 1];
  const vl = voter[voter.length - 1];
  if (cl.term !== vl.term) return cl.term > vl.term;
  return candidate.length >= voter.length;
}

const n1Log = [{term:1,cmd:"set x=1"}, {term:1,cmd:"set x=2"}];
const n2Log = [{term:1,cmd:"set x=1"}];
const n3Log = [];

console.log("N3 can beat N1?", logUpToDate(n3Log, n1Log)); // false
console.log("N3 can beat N2?", logUpToDate(n3Log, n2Log)); // false
console.log("N1 can beat N2?", logUpToDate(n1Log, n2Log)); // true
console.log("=> N1 wins the election, committed entries are safe");
```

</details>

## Common pitfalls

> [!PITFALL]
> Miscounting quorum when nodes join or leave. Raft's safety proofs assume a fixed N during an election. Adding or removing nodes without a joint consensus protocol (where both old and new configurations must agree) can create two simultaneously valid majorities. etcd's learner nodes and CockroachDB's joint quorum address this. Never remove nodes from a Raft cluster one at a time without verifying the cluster still has a safe majority — a 3-node cluster reduced to 2 has no fault tolerance.

## What you learned

- Consensus requires agreement, termination, validity, and integrity — and is impossible to guarantee in purely async networks (FLP).
- Raft uses randomized timeouts (liveness) and term-fencing (safety) to elect exactly one leader per term.
- Log entries are committed only when a majority of nodes acknowledge them; the leader election constraint ensures committed entries survive leadership changes.
- Split votes are resolved by re-randomizing timeouts; stale leaders are defused by term numbers.
- Raft's log-up-to-date check is the core safety invariant — voters reject candidates whose logs could be missing committed entries.

## Next steps

Consensus and quorums require nodes to communicate and merge state. But how do you represent state that can be merged without coordination — across nodes that may never see all writes in the same order? That's what logical clocks and CRDTs solve, covered next.
*/});
