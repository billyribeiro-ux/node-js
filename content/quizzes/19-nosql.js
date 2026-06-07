registerQuiz("19-mongodb", [
  {
    q: "Why should the '$match' stage be placed as early as possible in a MongoDB aggregation pipeline?",
    options: [
      "MongoDB requires '$match' to be the first stage by syntax rules",
      "Placing '$match' first allows MongoDB to use a collection index, avoiding a full scan",
      "Later stages cannot filter documents; only '$match' can do that",
      "'$match' resets the document stream and must precede '$group'"
    ],
    answer: 1,
    explain: "A '$match' stage placed first can be pushed down to an index scan on the collection. If placed after '$group', MongoDB must scan the entire intermediate result set in memory, which can be orders of magnitude slower on large collections."
  },
  {
    q: "Which MongoDB update operator merges new fields into an existing document without replacing the whole document?",
    options: [
      "$replace",
      "$merge",
      "$set",
      "$update"
    ],
    answer: 2,
    explain: "'$set' merges specified fields into the existing document. Passing the document object directly as the second argument to 'updateOne' replaces the entire document (keeping only the '_id'), which is a common data-loss mistake."
  },
  {
    q: "When should you prefer embedding data inside a MongoDB document over referencing a separate document?",
    options: [
      "When the embedded data is large and grows unboundedly over time",
      "When the embedded data is frequently queried independently of the parent",
      "When the data is always read together with the parent and is owned by it",
      "When many-to-many relationships need to be expressed"
    ],
    answer: 2,
    explain: "Embedding is best when related data is co-owned by the parent document and always read together, because it avoids a '$lookup' join. Data that grows unboundedly or is queried independently should be referenced instead."
  }
]);

registerResources("19-mongodb", [
  { title: "MongoDB Node.js Driver Documentation", url: "https://www.mongodb.com/docs/drivers/node/current/" },
  { title: "MongoDB Aggregation Pipeline Stages", url: "https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/" },
  { title: "MongoDB Data Modeling Introduction", url: "https://www.mongodb.com/docs/manual/core/data-modeling-introduction/" },
  { title: "MongoDB CRUD Operations Reference", url: "https://www.mongodb.com/docs/manual/crud/" },
  { title: "MongoDB Indexes Overview", url: "https://www.mongodb.com/docs/manual/indexes/" }
]);

registerQuiz("19-redis-caching", [
  {
    q: "In the cache-aside pattern, what is the recommended action when a write (update) modifies a cached entity?",
    options: [
      "Update both the database and the cache atomically in a transaction",
      "Immediately write the new value into the cache to keep it fresh",
      "Delete the cache key so the next read re-fetches from the database",
      "Set the TTL to 1 second so it expires almost immediately"
    ],
    answer: 2,
    explain: "Deleting the key on write is safer than trying to update it: updating both DB and cache without a distributed transaction risks a race where another request reads a stale key between the two writes. The next reader simply takes a cache miss and fetches fresh data."
  },
  {
    q: "Which Redis eviction policy is best suited for a cache with a power-law (Zipf) access distribution, where a small fraction of keys receive the vast majority of traffic?",
    options: [
      "noeviction",
      "volatile-ttl",
      "allkeys-lru",
      "allkeys-lfu"
    ],
    answer: 3,
    explain: "'allkeys-lfu' evicts the least frequently used key, so celebrity keys accessed constantly are kept even if they were not touched in the last few seconds. LRU would evict them after a brief quiet period, making LFU the winner for skewed access patterns."
  },
  {
    q: "What problem does the mutex-lock pattern (using 'SET lockKey 1 NX EX 5') solve in caching?",
    options: [
      "It prevents duplicate keys from being inserted into Redis",
      "It stops the cache from growing beyond its maxmemory limit",
      "It prevents a cache stampede where many concurrent misses hit the database simultaneously",
      "It ensures TTL values are applied consistently across all keys"
    ],
    answer: 2,
    explain: "When a popular key expires, many concurrent requests can all miss and race to rebuild the cache. The mutex lock allows only the first requester to run the expensive DB query while others either wait or serve a slightly stale value, preventing a thundering herd."
  }
]);

registerResources("19-redis-caching", [
  { title: "Redis Commands Reference (GET, SET, EX, DEL)", url: "https://redis.io/commands/" },
  { title: "Redis node client (node-redis) Documentation", url: "https://github.com/redis/node-redis" },
  { title: "Redis Key Expiration and TTL", url: "https://redis.io/docs/latest/commands/ttl/" },
  { title: "Redis Eviction Policies (maxmemory-policy)", url: "https://redis.io/docs/latest/develop/reference/eviction/" },
  { title: "Redis Caching Patterns Overview", url: "https://redis.io/docs/latest/develop/use/patterns/" }
]);

registerQuiz("19-redis-patterns", [
  {
    q: "What is the key delivery guarantee of Redis pub/sub, and what does it mean for missed messages?",
    options: [
      "At-least-once delivery: messages are retried until acknowledged",
      "Exactly-once delivery: Redis deduplicates messages automatically",
      "At-most-once delivery: messages published while a subscriber is offline are lost forever",
      "Ordered delivery: all subscribers receive messages in the same sequence"
    ],
    answer: 2,
    explain: "Redis pub/sub is fire-and-forget with at-most-once delivery. There is no persistence or replay. A subscriber that is offline when a message is published never receives it. For reliable delivery, use Redis Streams with consumer groups."
  },
  {
    q: "Why must a Redis client that calls 'subscribe' use a separate connection from the one used for publishing?",
    options: [
      "Redis limits the number of channels a single connection can use",
      "A subscribed client enters a special mode where it can only receive messages, not issue other commands",
      "Publishing and subscribing use different TCP ports in Redis",
      "Authentication is required for publishers but not for subscribers"
    ],
    answer: 1,
    explain: "Once a client calls 'subscribe', it enters pub/sub mode and can only receive messages and execute a small set of subscription-management commands. Any attempt to issue a regular command on that connection will be rejected."
  },
  {
    q: "When implementing a distributed lock with 'SET key token NX PX ttlMs', why is a unique random token stored as the value rather than a constant like '1'?",
    options: [
      "To make the key harder to guess by other clients",
      "Redis requires non-integer values for NX-mode SET commands",
      "So that the lock can only be released by the process that acquired it, preventing accidental theft",
      "To ensure the TTL is reset correctly on each heartbeat"
    ],
    answer: 2,
    explain: "The Lua release script checks that the stored value matches the caller's token before deleting. If another process acquired the lock after a timeout, the original holder's token will not match, so it cannot accidentally delete the new lock."
  }
]);

registerResources("19-redis-patterns", [
  { title: "Redis Pub/Sub Documentation", url: "https://redis.io/docs/latest/develop/interact/pubsub/" },
  { title: "Redis Streams Introduction", url: "https://redis.io/docs/latest/develop/data-types/streams/" },
  { title: "Redis Distributed Locks (SET NX PX pattern)", url: "https://redis.io/docs/latest/develop/use/patterns/distributed-locks/" },
  { title: "Redlock Algorithm Specification", url: "https://redis.io/docs/latest/develop/use/patterns/distributed-locks/#the-redlock-algorithm" },
  { title: "Redis INCR Command (atomic counter for rate limiting)", url: "https://redis.io/commands/incr/" }
]);
