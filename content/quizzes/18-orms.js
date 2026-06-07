registerQuiz("18-prisma", [
  {
    q: "In a Prisma schema, what does the '?' symbol after a field type indicate?",
    options: [
      "The field is the primary key",
      "The field is optional (nullable in the database)",
      "The field has a default value",
      "The field references another model"
    ],
    answer: 1,
    explain: "The '?' makes a field optional, meaning it is nullable in the database. Without '?', the field is required and cannot be NULL."
  },
  {
    q: "Which Prisma Client method loads related records only when you explicitly request them?",
    options: [
      "findMany with lazy: true",
      "include or select",
      "join",
      "populate"
    ],
    answer: 1,
    explain: "Prisma does not support lazy loading. You must opt in to loading relations at query time using 'include' (eager-loads the full relation) or 'select' (fine-grained projection)."
  },
  {
    q: "What is the correct command to apply pending Prisma migrations in a production environment?",
    options: [
      "npx prisma migrate dev",
      "npx prisma db push",
      "npx prisma migrate deploy",
      "npx prisma generate"
    ],
    answer: 2,
    explain: "'prisma migrate deploy' applies pending migrations without prompting and is designed for CI/production. 'migrate dev' is for development only, and 'db push' bypasses the migration history entirely."
  }
]);

registerResources("18-prisma", [
  { title: "Prisma Schema Reference", url: "https://www.prisma.io/docs/orm/reference/prisma-schema-reference" },
  { title: "Prisma Client CRUD Operations", url: "https://www.prisma.io/docs/orm/prisma-client/queries/crud" },
  { title: "Prisma Migrate Overview", url: "https://www.prisma.io/docs/orm/prisma-migrate/getting-started" },
  { title: "Prisma Relations Documentation", url: "https://www.prisma.io/docs/orm/prisma-schema/data-model/relations" },
  { title: "Prisma Studio (Data Browser)", url: "https://www.prisma.io/docs/orm/tools/prisma-studio" }
]);

registerQuiz("18-drizzle", [
  {
    q: "How does Drizzle infer TypeScript types for SELECT query results, without a separate code-generation step?",
    options: [
      "It reads types from a schema.prisma file at build time",
      "It uses '$inferSelect' on the table definition at authorship time",
      "It generates a .d.ts file when the dev server starts",
      "It relies on the database driver to return typed rows"
    ],
    answer: 1,
    explain: "Drizzle schemas are pure TypeScript. 'typeof table.$inferSelect' gives the row shape directly from the column definitions — no 'drizzle generate' needed, and types are always in sync with the schema."
  },
  {
    q: "What does calling '.toSQL()' on a Drizzle query builder return?",
    options: [
      "The query result as a JSON object",
      "An object containing the SQL string and its parameterised values",
      "A compiled query plan from the database",
      "The migration SQL diff for the current schema"
    ],
    answer: 1,
    explain: "'.toSQL()' returns an object with 'sql' (the query string with placeholders) and 'params' (the values). This lets you inspect exactly what SQL Drizzle will send to the database before executing."
  },
  {
    q: "Which 'drizzle-kit' command generates plain SQL migration files from schema changes without applying them?",
    options: [
      "drizzle-kit push",
      "drizzle-kit migrate",
      "drizzle-kit generate",
      "drizzle-kit introspect"
    ],
    answer: 2,
    explain: "'drizzle-kit generate' diffs the TypeScript schema against the live database and writes plain SQL migration files. 'drizzle-kit migrate' applies those files, and 'push' bypasses migration files altogether."
  }
]);

registerResources("18-drizzle", [
  { title: "Drizzle ORM Documentation", url: "https://orm.drizzle.team/docs/overview" },
  { title: "Drizzle Schema Definition", url: "https://orm.drizzle.team/docs/sql-schema-declaration" },
  { title: "Drizzle Query Builder API", url: "https://orm.drizzle.team/docs/select" },
  { title: "drizzle-kit Migrations Guide", url: "https://orm.drizzle.team/docs/migrations" },
  { title: "Drizzle Relational Queries API", url: "https://orm.drizzle.team/docs/rqb" }
]);

registerQuiz("18-orm-tradeoffs", [
  {
    q: "What is the N+1 problem in the context of ORM usage?",
    options: [
      "Running a query with more than N parameters causes a timeout",
      "Fetching N rows then issuing one additional query per row to load a relation",
      "Calling the ORM's 'findMany' method more than N times in a request",
      "Using more than N include levels in a single Prisma query"
    ],
    answer: 1,
    explain: "The N+1 problem occurs when you load N parent rows and then fire N individual queries to load each row's related data. Total queries become 1 + N, growing linearly with the result set."
  },
  {
    q: "When using Prisma's '$queryRaw' tagged template, how are interpolated values handled?",
    options: [
      "They are inlined directly into the SQL string, requiring manual escaping",
      "They are automatically parameterised, preventing SQL injection",
      "They are ignored; only string literals in the template are sent",
      "They must be wrapped in 'Prisma.sql' before use"
    ],
    answer: 1,
    explain: "When you use $queryRaw with a tagged template, Prisma automatically parameterises each interpolated value, so you get raw SQL expressiveness without any SQL injection risk."
  },
  {
    q: "In the DataLoader batching pattern, when does the 'flush' function fire to send a single batched query?",
    options: [
      "After a fixed timer of 100 ms",
      "After the microtask queue drains at the end of the current tick",
      "When the pending ID set reaches 100 entries",
      "Immediately when the first load() call is made"
    ],
    answer: 1,
    explain: "The DataLoader pattern uses 'Promise.resolve().then(flush)' to schedule the batch on the microtask queue. All 'load(id)' calls in the same synchronous tick accumulate before flush fires, collapsing them into one query."
  }
]);

registerResources("18-orm-tradeoffs", [
  { title: "Prisma Raw Queries ($queryRaw)", url: "https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries" },
  { title: "Drizzle SQL Tagged Template", url: "https://orm.drizzle.team/docs/sql" },
  { title: "DataLoader (Facebook) — Batching & Caching", url: "https://github.com/graphql/dataloader" },
  { title: "Prisma Query Logging (log option)", url: "https://www.prisma.io/docs/orm/prisma-client/observability-and-logging/logging" }
]);
