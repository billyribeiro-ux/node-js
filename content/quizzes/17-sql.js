registerQuiz("17-sql-basics", [
  {
    q: "What does the 'ON DELETE CASCADE' clause on a foreign key constraint do?",
    options: [
      "It prevents the referenced parent row from being deleted if child rows exist",
      "When the referenced parent row is deleted, all child rows referencing it are automatically deleted as well",
      "It sets the foreign key column to NULL when the parent row is deleted",
      "It logs the deletion to an audit table before allowing it"
    ],
    answer: 1,
    explain: "'ON DELETE CASCADE' instructs the database to automatically delete all child rows that reference a parent row when that parent is deleted. Alternatives include 'RESTRICT' (block the delete), 'SET NULL', and the default 'NO ACTION' (raise an error at commit time)."
  },
  {
    q: "Which JOIN type returns ALL rows from the left table, including those with no matching rows in the right table?",
    options: [
      "INNER JOIN",
      "RIGHT JOIN",
      "LEFT JOIN",
      "FULL OUTER JOIN"
    ],
    answer: 2,
    explain: "A LEFT JOIN returns every row from the left table. For rows that have no match in the right table, the right-side columns appear as NULL. This is useful for finding users with no orders, products in no categories, etc. INNER JOIN only returns rows matched on both sides."
  },
  {
    q: "What problem does normalization solve, and which normal form prohibits storing a derived value like 'city' when 'zip_code' already determines it?",
    options: [
      "Normalization solves query performance; Third Normal Form (3NF) prohibits the redundancy",
      "Normalization eliminates data duplication and anomalies; Third Normal Form (3NF) prohibits columns that depend on other non-key columns",
      "Normalization improves write speed; Second Normal Form (2NF) prohibits derived columns",
      "Normalization enforces foreign keys; First Normal Form (1NF) prohibits composite values"
    ],
    answer: 1,
    explain: "Normalization structures data so each fact is stored exactly once, preventing update anomalies and inconsistency. Third Normal Form (3NF) specifically requires that every non-key column depends only on the primary key, not on another non-key column. Storing 'city' when it can be derived from 'zip_code' violates 3NF."
  }
]);

registerResources("17-sql-basics", [
  { title: "PostgreSQL documentation: SQL language", url: "https://www.postgresql.org/docs/current/sql.html" },
  { title: "MDN: SQL basics (introductory guide)", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/First_steps/Web_frameworks" },
  { title: "PostgreSQL: CREATE TABLE reference", url: "https://www.postgresql.org/docs/current/sql-createtable.html" },
  { title: "PostgreSQL: JOIN types", url: "https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN" },
  { title: "SQLite documentation (for comparison)", url: "https://www.sqlite.org/docs.html" }
]);

registerQuiz("17-postgres-pg", [
  {
    q: "Why should you use 'Pool' from 'node-postgres' in a web server rather than creating a new 'Client' for each request?",
    options: [
      "A 'Pool' is required to run parameterized queries; a standalone 'Client' cannot use '$1' placeholders",
      "Opening and closing a Postgres connection on every request is slow and exhausts the database's connection limit; a Pool reuses connections efficiently",
      "A 'Client' does not support transactions, only 'Pool' does",
      "Postgres only allows one active 'Client' per database at a time"
    ],
    answer: 1,
    explain: "Establishing a TCP connection plus authentication handshake for every request adds significant latency and quickly exhausts Postgres's 'max_connections'. A 'Pool' keeps a configurable number of connections open and reuses them, automatically acquiring and releasing them for each query."
  },
  {
    q: "Why is 'pool.query(sql, values)' with a '$1' placeholder safer than template-literal string interpolation?",
    options: [
      "The placeholder syntax is faster to parse than a concatenated string",
      "The '$1' placeholder causes the driver to send SQL and values as separate protocol messages, so Postgres never interprets the values as SQL",
      "The 'pg' library automatically escapes special characters in template literals",
      "Template literals are not valid JavaScript syntax in Node.js scripts"
    ],
    answer: 1,
    explain: "Parameterized queries send the SQL text and the values array as separate parts of the Postgres wire protocol. The database receives the value as data, not as part of the SQL to be parsed, making SQL injection structurally impossible regardless of the value's contents."
  },
  {
    q: "When running a multi-statement database transaction with 'node-postgres', why must you use 'pool.connect()' to get a dedicated client rather than calling 'pool.query()' for each statement?",
    options: [
      "Because 'pool.query()' does not support 'BEGIN' and 'COMMIT' keywords",
      "Because 'pool.query()' may use a different physical connection for each call, so 'BEGIN' and 'COMMIT' would apply to different sessions",
      "Because dedicated clients are faster than pool queries for multi-step operations",
      "Because Postgres transactions require a keep-alive timer that only the dedicated client supports"
    ],
    answer: 1,
    explain: "A transaction requires all statements to execute on the same physical connection, because 'BEGIN' starts a transaction state on that connection. 'pool.query()' acquires any available connection for each call; two consecutive calls may use different connections. Use 'pool.connect()' to check out a dedicated client for the entire transaction, and 'client.release()' in 'finally' to return it."
  }
]);

registerResources("17-postgres-pg", [
  { title: "node-postgres (pg) documentation", url: "https://node-postgres.com/" },
  { title: "node-postgres: connection pooling", url: "https://node-postgres.com/features/pooling" },
  { title: "node-postgres: parameterized queries", url: "https://node-postgres.com/features/queries#parameterized-query" },
  { title: "PostgreSQL: transactions", url: "https://www.postgresql.org/docs/current/tutorial-transactions.html" },
  { title: "OWASP: SQL injection prevention cheat sheet", url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html" }
]);

registerQuiz("17-migrations", [
  {
    q: "Once a migration file has been applied to a production database, what should you do if you discover a mistake in it?",
    options: [
      "Edit the file and re-run the migration runner — it will detect the changed content",
      "Delete the version from 'schema_migrations' so the runner re-applies it",
      "Write a new migration that corrects the mistake; never edit an applied migration",
      "Use 'ALTER TABLE' directly in production to fix the mistake without a migration"
    ],
    answer: 2,
    explain: "Applied migrations are tracked by version in 'schema_migrations'. Editing a file does not re-run it — the version is already marked as applied. The correct approach is to write a new, incremented migration that corrects the mistake. Applied migrations are treated as immutable history."
  },
  {
    q: "On which type of column does a B-tree index provide the least benefit, and why?",
    options: [
      "A high-cardinality column like 'email', because every row has a unique value",
      "A low-cardinality column like a boolean 'active' flag, because most rows match and the planner still scans most of the table",
      "A timestamp column, because range queries cannot use B-tree indexes",
      "A foreign key column, because joins bypass indexes entirely"
    ],
    answer: 1,
    explain: "A B-tree index on a low-cardinality column (e.g., 'active = true' where 95% of rows are active) forces the database to fetch most of the heap anyway. The query planner often prefers a sequential scan in this case, so the index adds write overhead without meaningful read benefit."
  },
  {
    q: "In a Postgres EXPLAIN ANALYZE output, what does seeing 'Seq Scan' on a large table usually indicate?",
    options: [
      "The query is using an optimal index-only scan path",
      "The table is empty, so the planner chose the cheapest plan",
      "The query is doing a full table scan because no suitable index exists or the planner chose not to use one, which may be a performance problem",
      "The database is in recovery mode and cannot use indexes"
    ],
    answer: 2,
    explain: "'Seq Scan' means the database is reading every row in the table sequentially. For small tables this is fine and often optimal. For large tables with millions of rows, a 'Seq Scan' on a filtered query suggests a missing or unused index and is the primary signal to investigate adding one."
  }
]);

registerResources("17-migrations", [
  { title: "node-pg-migrate documentation", url: "https://salsita.github.io/node-pg-migrate/" },
  { title: "PostgreSQL: CREATE INDEX", url: "https://www.postgresql.org/docs/current/sql-createindex.html" },
  { title: "PostgreSQL: EXPLAIN ANALYZE", url: "https://www.postgresql.org/docs/current/sql-explain.html" },
  { title: "PostgreSQL: B-tree index internals", url: "https://www.postgresql.org/docs/current/btree-implementation.html" },
  { title: "Flyway database migration tool", url: "https://flywaydb.org/" }
]);

registerQuiz("17-node-sqlite", [
  {
    q: "What is the key characteristic of the 'DatabaseSync' API provided by 'node:sqlite', and when is this a good fit?",
    options: [
      "It is asynchronous (Promise-based), making it suitable for high-concurrency web servers",
      "It is fully synchronous, making it ideal for CLIs, embedded tools, and test fixtures where async overhead is unnecessary",
      "It requires a running SQLite server process separate from Node",
      "It only supports in-memory databases, not file-backed ones"
    ],
    answer: 1,
    explain: "'DatabaseSync' provides a synchronous API: no Promises, no async/await needed. Individual SQLite queries complete in microseconds, so synchronous execution is appropriate for CLIs, test fixtures, and embedded apps. For async usage in servers, run 'StatementSync' in a worker thread."
  },
  {
    q: "Why should you use 'db.prepare(sql)' and call 'statement.run()' or 'statement.get()' rather than 'db.exec(sql)' for queries with user-supplied values?",
    options: [
      "Because 'db.exec()' only supports DDL statements like CREATE and DROP",
      "Because prepared statements compile the SQL once, use '?' placeholders for values (preventing SQL injection), and are faster for repeated executions",
      "Because 'db.exec()' returns results as a stream, not as an array",
      "Because 'db.prepare()' automatically handles connection pooling"
    ],
    answer: 1,
    explain: "Prepared statements send SQL and values separately: the SQL is compiled once and values are bound at execution time using '?' placeholders, which the driver handles safely — user input is never interpreted as SQL. This prevents SQL injection and is also faster for repeated queries."
  },
  {
    q: "In what scenario is using 'node:sqlite' (SQLite) a better choice than Postgres?",
    options: [
      "A write-heavy multi-user e-commerce platform with hundreds of concurrent users",
      "A distributed microservices architecture requiring cross-service transactions",
      "A CLI tool, local development database, automated test fixture, or edge deployment where zero-dependency embedded storage is needed",
      "Any application running in production on a cloud server"
    ],
    answer: 2,
    explain: "SQLite excels when you need an embedded, zero-configuration, zero-dependency database: CLI tools, local development, test suites (in-memory databases are perfect), and edge deployments (Cloudflare D1, Turso). For multi-process concurrent write workloads, Postgres is the correct choice."
  }
]);

registerResources("17-node-sqlite", [
  { title: "Node.js docs: node:sqlite module", url: "https://nodejs.org/api/sqlite.html" },
  { title: "SQLite official documentation", url: "https://www.sqlite.org/docs.html" },
  { title: "SQLite WAL mode documentation", url: "https://www.sqlite.org/wal.html" },
  { title: "Cloudflare D1 (SQLite at the edge)", url: "https://developers.cloudflare.com/d1/" },
  { title: "Turso (libSQL / distributed SQLite)", url: "https://turso.tech/libsql" }
]);
