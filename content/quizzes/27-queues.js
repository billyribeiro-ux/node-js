registerQuiz("27-bullmq", [
  {
    q: "What does the BullMQ 'concurrency' option on a Worker control?",
    options: [
      "The number of separate Worker processes spawned automatically",
      "How many jobs that single Worker instance processes in parallel",
      "The maximum number of jobs that can exist in the queue at once",
      "The number of Redis connections the Worker maintains"
    ],
    answer: 1,
    explain: "The 'concurrency' option on a Worker instance sets the maximum number of jobs that worker will run simultaneously. For I/O-bound processors it can be set high (20-50); for CPU-bound processors it should be 1 per core. Horizontal scaling is achieved by running more worker processes."
  },
  {
    q: "What is the difference between QueueEvents and Worker-level 'completed'/'failed' events?",
    options: [
      "QueueEvents fires before the job executes; Worker events fire after",
      "Worker events only fire on that specific worker process; QueueEvents subscribes to Redis and fires for every job across all workers",
      "QueueEvents only tracks delayed jobs; Worker events track immediate jobs",
      "There is no difference; they are aliases for the same underlying event"
    ],
    answer: 1,
    explain: "Worker-level events ('completed', 'failed') are local to the process that ran the job. QueueEvents connects to Redis pub/sub and receives notifications for every job processed by any worker across all processes, making it suitable for monitoring dashboards."
  },
  {
    q: "Why must a BullMQ job processor be designed to be idempotent?",
    options: [
      "BullMQ always runs each job exactly twice to verify the result",
      "Workers can crash mid-job, causing BullMQ to re-run the job on restart, so the same operation may execute more than once",
      "Redis pub/sub delivers messages at most once, so BullMQ compensates by retrying all jobs",
      "Idempotency is only required for repeatable jobs, not one-off jobs"
    ],
    answer: 1,
    explain: "If a worker crashes after completing work but before BullMQ marks the job as done, BullMQ will re-run it. A non-idempotent processor (like sending an email without checking if it was already sent) would cause duplicate side effects. Idempotency guards (checking a flag in the DB before acting) prevent this."
  }
]);

registerResources("27-bullmq", [
  { title: "BullMQ documentation", url: "https://docs.bullmq.io/" },
  { title: "BullMQ Worker API", url: "https://docs.bullmq.io/guide/workers" },
  { title: "BullMQ Queue API", url: "https://docs.bullmq.io/guide/queues" },
  { title: "BullMQ repeatable jobs", url: "https://docs.bullmq.io/guide/jobs/repeatable" },
  { title: "Redis data types (used by BullMQ)", url: "https://redis.io/docs/latest/develop/data-types/" }
]);

registerQuiz("27-retries-dlq", [
  {
    q: "What is the primary purpose of adding full jitter to exponential backoff?",
    options: [
      "Jitter compresses retry delays to be faster on average",
      "Jitter randomises delays so retrying workers do not all wake up at the same instant, avoiding a thundering herd on the recovering downstream",
      "Jitter increases the maximum delay cap to reduce total retry count",
      "Jitter ensures retries are evenly distributed across available worker threads"
    ],
    answer: 1,
    explain: "Without jitter, exponential backoff still synchronises retries: all workers that failed together calculate the same delay and retry together. Full jitter multiplies the exponential value by Math.random(), spreading retries uniformly across the backoff window and dramatically reducing contention on the recovering service."
  },
  {
    q: "What should happen to a job that throws an UnrecoverableError in BullMQ?",
    options: [
      "The job is retried immediately without any backoff",
      "The job is moved to the failed set without consuming any retry attempts",
      "The worker process is restarted to handle the error",
      "The job is silently deleted from the queue"
    ],
    answer: 1,
    explain: "Wrapping an error in BullMQ's UnrecoverableError signals that the failure is permanent and retrying would be wasteful or harmful (e.g., a card declined). BullMQ moves the job directly to the failed set without consuming retry attempts."
  },
  {
    q: "What is a dead-letter queue (DLQ) and why is it preferred over simply discarding failed jobs?",
    options: [
      "A DLQ is a backup queue that automatically replays jobs every hour",
      "A DLQ stores jobs that have exhausted their retry attempts so engineers can inspect, fix, and replay them rather than lose them silently",
      "A DLQ is a Redis Sorted Set that prioritises failed jobs above new jobs",
      "A DLQ is a monitoring dashboard that shows failing job rates over time"
    ],
    answer: 1,
    explain: "A DLQ captures jobs that could not be processed after all retry attempts. Instead of silent data loss, engineers can inspect the DLQ to understand what failed and why, fix the underlying bug, and then replay the jobs. This is critical for business-critical workflows where silent failures are unacceptable."
  }
]);

registerResources("27-retries-dlq", [
  { title: "BullMQ retries and backoff", url: "https://docs.bullmq.io/guide/retrying-failing-jobs" },
  { title: "AWS blog: exponential backoff and jitter", url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/" },
  { title: "BullMQ UnrecoverableError", url: "https://docs.bullmq.io/guide/workers/error-handling#unrecoverable-errors" },
  { title: "BullMQ failed jobs (DLQ pattern)", url: "https://docs.bullmq.io/guide/jobs/job-states" }
]);

registerQuiz("27-brokers", [
  {
    q: "What is the fundamental difference between a RabbitMQ queue and a Kafka topic?",
    options: [
      "RabbitMQ supports larger message payloads than Kafka",
      "RabbitMQ deletes messages after they are acknowledged by a consumer; Kafka retains messages in an append-only log for a configurable period and allows replay",
      "Kafka is limited to one consumer per topic; RabbitMQ supports many",
      "RabbitMQ requires TLS; Kafka does not"
    ],
    answer: 1,
    explain: "RabbitMQ is a queue: messages are removed after a consumer acknowledges them. Kafka is a partitioned append-only log: records are retained for a configured period regardless of consumption, and any consumer group can replay from any offset independently."
  },
  {
    q: "How do Kafka consumer groups achieve independent consumption of the same topic?",
    options: [
      "Each consumer group gets its own copy of the Kafka topic on a separate broker",
      "Each consumer group tracks its own offset per partition, so multiple groups can read the same records independently without affecting each other",
      "Consumer groups use separate Redis instances to store their read positions",
      "Kafka replicates each message once per registered consumer group at publish time"
    ],
    answer: 1,
    explain: "Kafka does not duplicate records per consumer group. Instead, each group maintains its own committed offset for each partition. Two groups reading the same topic advance their own cursors independently, so each group sees every record, enabling fan-out to multiple services without duplicating storage."
  },
  {
    q: "Which messaging model should you choose when consumers need to replay historical messages from the beginning?",
    options: [
      "RabbitMQ with a fanout exchange",
      "BullMQ with repeatable jobs",
      "Kafka or NATS JetStream, because they are append-only logs that retain messages and support seeking to any offset",
      "NATS Core, because it has the lowest latency"
    ],
    answer: 2,
    explain: "Only log-based brokers (Kafka, NATS JetStream) retain messages and allow consumers to seek to any historical offset. RabbitMQ deletes messages on acknowledgement and NATS Core is fire-and-forget, so neither supports replay. Choose a log broker whenever replay, event sourcing, or audit trails are required."
  }
]);

registerResources("27-brokers", [
  { title: "RabbitMQ documentation", url: "https://www.rabbitmq.com/docs" },
  { title: "Apache Kafka documentation", url: "https://kafka.apache.org/documentation/" },
  { title: "KafkaJS (Node.js Kafka client)", url: "https://kafka.js.org/docs/getting-started" },
  { title: "NATS documentation", url: "https://docs.nats.io/" },
  { title: "NATS JetStream documentation", url: "https://docs.nats.io/nats-concepts/jetstream" }
]);
