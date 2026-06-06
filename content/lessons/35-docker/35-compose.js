registerLessonSrc("35-compose", function () {/*
---
id: 35-compose
title: "Local Stacks with Docker Compose"
minutes: 28
level: advanced
objectives:
  - Define multi-service stacks with Docker Compose and understand key directives
  - Use depends_on with healthchecks to guarantee correct startup order
  - Wire volumes, networks, and environment variables for dev and CI parity
---

# Local Stacks with Docker Compose

## Why this matters

Running a Node API in isolation is a toy. Real services depend on a database, a cache, maybe a message broker. Without Compose, every new team member runs a different version of Postgres through a different method, environment variables differ between machines, and "it worked yesterday" tickets pile up. Compose turns a multi-service stack into a single file that anyone can spin up with `docker compose up`. Mastering it — especially `depends_on`, healthchecks, named volumes, and networks — is a daily-driver skill for every backend engineer.

## Learning objectives

- Write a `docker-compose.yml` that starts an API, Postgres, and Redis together.
- Use `depends_on` with `condition: service_healthy` to enforce startup order.
- Manage persistent data with named volumes and isolate services with networks.
- Pass environment variables safely via `.env` files and `environment` keys.

## Docker Compose fundamentals

**Docker Compose** is a tool (bundled with modern Docker) that reads a YAML file defining multiple services, networks, and volumes, then creates and connects them. The file is named `docker-compose.yml` (or `compose.yaml` — both work).

```js
// docker-compose.yml — minimal example with two services
```

```yaml
services:
  api:
    build: .           # build from local Dockerfile
    ports:
      - "3000:3000"    # host:container
    environment:
      - NODE_ENV=development

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
```

> [!OUTPUT]
> $ docker compose up
> [+] Running 2/2
>  ✔ Container myapp-db-1   Started  0.8s
>  ✔ Container myapp-api-1  Started  1.1s
> myapp-db-1   | PostgreSQL init process complete; ready for start up.
> myapp-api-1  | Server listening on port 3000

Services within a Compose project can reach each other by their **service name** as a hostname. The `api` service connects to Postgres at `postgres://app:secret@db:5432/appdb` — the hostname is `db`, the service name in the file.

## A production-grade API + DB + Redis stack

Here is a complete `docker-compose.yml` for a Node API with Postgres and Redis, including healthchecks, named volumes, isolated networks, and an `.env` file.

```js
// docker-compose.yml — full dev stack
```

```yaml
// syntax=docker/dockerfile:1
name: myapp

services:

  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime          # stops at the 'runtime' stage in a multi-stage build
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      REDIS_URL: redis://cache:6379
    env_file:
      - .env                   # load extra vars without hardcoding secrets in YAML
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
    networks:
      - backend
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-secret}
      POSTGRES_DB: ${POSTGRES_DB:-appdb}
    volumes:
      - pgdata:/var/lib/postgresql/data   # named volume — survives container restart
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-appdb}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - backend

  cache:
    image: redis:7-alpine
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - backend

volumes:
  pgdata:
  redisdata:

networks:
  backend:
    driver: bridge
```

> [!OUTPUT]
> $ docker compose up --build
> [+] Building api (7 layers) ... DONE
> [+] Running 3/3
>  ✔ Container myapp-db-1     Healthy  12.3s
>  ✔ Container myapp-cache-1  Healthy   5.1s
>  ✔ Container myapp-api-1    Started  13.0s
> myapp-db-1     | database system is ready to accept connections
> myapp-cache-1  | Ready to accept connections
> myapp-api-1    | Server listening on :3000

> [!PRINCIPAL] depends_on condition: service_healthy vs service_started
> The default `depends_on: db` only waits for the container *process* to start — not for Postgres to finish initialising. Postgres needs 5–20 seconds to replay WAL, run init scripts, and begin accepting connections. Without `condition: service_healthy`, your API starts, tries to connect, and crashes with "ECONNREFUSED". Always pair `depends_on` with `condition: service_healthy` and a matching `healthcheck`.

## Key directives explained

### volumes

Named volumes (`pgdata:`, `redisdata:`) persist data beyond the container's lifecycle. When you run `docker compose down`, containers are destroyed but volumes survive. `docker compose down -v` removes them — useful to reset state in CI.

Bind mounts (`./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro`) map host paths into containers. The `:ro` flag makes them read-only inside the container, a good security default for config files.

### networks

Defining a custom `backend` network isolates your services from other Compose projects on the same machine. Services on the same network resolve each other by service name via Docker's embedded DNS. Services on *different* networks cannot communicate unless explicitly connected to both.

### env_file and environment

```yaml
// Compose variable precedence (highest to lowest):
// 1. environment: keys in compose file (explicit, visible)
// 2. env_file: .env  (loaded per-service)
// 3. Shell environment variables (from the host shell running docker compose)
// 4. Default values in ${VAR:-default}
```

Keep passwords out of the Compose file itself. Commit a `.env.example` with placeholder values; each developer/CI copies it to `.env` and fills in real values. Never commit `.env` to git.

> [!WARNING] Secret management at scale
> `.env` files work for dev and small teams. In production on Kubernetes or ECS, use a proper secrets manager (AWS Secrets Manager, HashiCorp Vault, Kubernetes Secrets with external-secrets-operator). Compose's `secrets:` directive supports Docker Swarm-managed secrets for teams in-between.

## Useful Compose commands

```bash
docker compose up -d            # start in background (detached)
docker compose up --build       # rebuild images before starting
docker compose down             # stop and remove containers (volumes survive)
docker compose down -v          # also remove named volumes
docker compose logs -f api      # tail logs for a single service
docker compose exec api sh      # open a shell in a running service
docker compose ps               # show running services and health status
docker compose restart api      # restart just the api service
```

> [!NOTE] compose vs docker-compose
> Docker Compose v2 is a plugin: `docker compose` (space, no hyphen). It ships with Docker Desktop and modern Docker Engine. The old standalone `docker-compose` (Python, hyphenated) is deprecated. Use `docker compose` for all new work.

## Try it yourself

The following runnable block implements a **dependency-ordered service starter**. It reads a `depends_on` graph and resolves the correct startup order using topological sort (Kahn's algorithm). This is exactly what Docker Compose does internally before launching your services.

```js run
// Topological service starter: resolves depends_on into a boot order.

const services = {
  api:   { dependsOn: ["db", "cache"] },
  db:    { dependsOn: [] },
  cache: { dependsOn: [] },
  worker: { dependsOn: ["db", "cache"] },
  scheduler: { dependsOn: ["api", "db"] },
};

function resolveStartOrder(services) {
  // Build in-degree count and adjacency list
  const inDegree = {};
  const dependents = {};           // dependents[X] = services that depend on X

  for (const name of Object.keys(services)) {
    inDegree[name] = inDegree[name] || 0;
    dependents[name] = dependents[name] || [];
  }

  for (const [name, cfg] of Object.entries(services)) {
    for (const dep of cfg.dependsOn) {
      inDegree[name] = (inDegree[name] || 0) + 1;
      (dependents[dep] = dependents[dep] || []).push(name);
    }
  }

  // Kahn's algorithm
  const queue = Object.keys(inDegree).filter(s => inDegree[s] === 0);
  const order = [];

  while (queue.length) {
    const svc = queue.shift();
    order.push(svc);
    for (const dependent of (dependents[svc] || [])) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) queue.push(dependent);
    }
  }

  if (order.length !== Object.keys(services).length) {
    throw new Error("Circular dependency detected!");
  }
  return order;
}

const bootOrder = resolveStartOrder(services);
console.log("Resolved startup order:");
bootOrder.forEach((svc, i) => {
  const deps = services[svc].dependsOn;
  const depStr = deps.length ? `  (waits for: ${deps.join(", ")})` : "  (no dependencies)";
  console.log(`  ${i + 1}. ${svc}${depStr}`);
});

// Test circular dependency detection
try {
  resolveStartOrder({
    a: { dependsOn: ["b"] },
    b: { dependsOn: ["a"] },
  });
} catch (e) {
  console.log("\nCircular test:", e.message);
}
```

## Exercise

**Challenge 1:** Add a `migration` service to the graph above that depends on `db` but must complete *before* `api` starts (i.e., `api` depends on `migration`). Verify the resolver puts `migration` between `db` and `api`.

<details>
<summary>Show solution</summary>

```js run
const services = {
  db:        { dependsOn: [] },
  cache:     { dependsOn: [] },
  migration: { dependsOn: ["db"] },
  api:       { dependsOn: ["migration", "cache"] },
  worker:    { dependsOn: ["db", "cache"] },
};

function resolveStartOrder(services) {
  const inDegree = {};
  const dependents = {};
  for (const name of Object.keys(services)) {
    inDegree[name] = inDegree[name] || 0;
    dependents[name] = dependents[name] || [];
  }
  for (const [name, cfg] of Object.entries(services)) {
    for (const dep of cfg.dependsOn) {
      inDegree[name] = (inDegree[name] || 0) + 1;
      (dependents[dep] = dependents[dep] || []).push(name);
    }
  }
  const queue = Object.keys(inDegree).filter(s => inDegree[s] === 0);
  const order = [];
  while (queue.length) {
    const svc = queue.shift();
    order.push(svc);
    for (const dep of (dependents[svc] || [])) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) queue.push(dep);
    }
  }
  return order;
}

resolveStartOrder(services).forEach((svc, i) => {
  const deps = services[svc].dependsOn;
  console.log(`${i + 1}. ${svc}${deps.length ? "  ← " + deps.join(", ") : ""}`);
});
// db and cache first, then migration, then api and worker
```

`migration` appears after `db` and before `api`, so schema migrations run before the API starts accepting traffic.
</details>

**Challenge 2:** What single change to `docker-compose.yml` resets the Postgres volume to a clean state without touching the cache volume?

<details>
<summary>Show solution</summary>

```bash
docker compose down && docker volume rm myapp_pgdata && docker compose up
```

Or more precisely, to remove only `pgdata`:

```bash
docker volume rm $(docker compose config --volumes | grep pgdata)
```

The Redis volume (`redisdata`) is untouched. This is the advantage of named volumes over anonymous volumes — you can target them individually.
</details>

## Project

### Containerize the whole system with optimised multi-stage images and a Docker Compose dev stack

You have a Node API, a Postgres database, and a Redis cache. Your task is to containerize the full system so any engineer can run `docker compose up --build` and have a fully working dev environment — with correct startup ordering, persistent data, and no secrets in version control.

**Acceptance criteria:**

1. **Multi-stage Dockerfile** — a `builder` stage installs all dependencies and compiles TypeScript (or runs any build step); a lean `runtime` stage (Alpine or distroless) copies only the compiled output and production `node_modules`. The final image must be under 250 MB.
2. **docker-compose.yml** includes three services (`api`, `db`, `cache`) with a custom bridge network. Services communicate by name, not by IP or `localhost`.
3. **Health-gated startup** — `api` uses `depends_on` with `condition: service_healthy` for both `db` and `cache`. Both dependency services have working `healthcheck` blocks.
4. **Named volumes** — Postgres and Redis data persist across `docker compose down` (but not `docker compose down -v`).
5. **Secrets via env file** — database credentials and the Redis URL are read from `.env` (not hardcoded in YAML). A `.env.example` file is committed; `.env` is in `.gitignore`.
6. **Non-root user** — the `api` container runs as a non-root user (uid ≥ 1000). The Dockerfile includes a `.dockerignore` that excludes `node_modules`, `.git`, and `.env*`.

**Starter — service dependency resolver (the logic core of criteria 3):**

```js run
// Paste this resolver into your project and adapt it to validate your compose graph
// programmatically in a smoke-test or CI step.

const composeServices = {
  api:   { dependsOn: ["db", "cache"], healthcheck: false },
  db:    { dependsOn: [],              healthcheck: true  },
  cache: { dependsOn: [],              healthcheck: true  },
};

function validateAndOrder(services) {
  const errors = [];

  // Check: every dependency has a healthcheck
  for (const [name, cfg] of Object.entries(services)) {
    for (const dep of cfg.dependsOn) {
      if (!services[dep]?.healthcheck) {
        errors.push(`${name} depends on ${dep} with service_healthy but ${dep} has no healthcheck`);
      }
    }
  }

  // Topological sort
  const inDegree = Object.fromEntries(Object.keys(services).map(k => [k, 0]));
  const dependents = Object.fromEntries(Object.keys(services).map(k => [k, []]));
  for (const [name, cfg] of Object.entries(services)) {
    for (const dep of cfg.dependsOn) {
      inDegree[name]++;
      dependents[dep].push(name);
    }
  }
  const queue = Object.keys(inDegree).filter(k => inDegree[k] === 0);
  const order = [];
  while (queue.length) {
    const s = queue.shift();
    order.push(s);
    for (const d of dependents[s]) {
      inDegree[d]--;
      if (inDegree[d] === 0) queue.push(d);
    }
  }
  if (order.length !== Object.keys(services).length) {
    errors.push("Circular dependency detected");
  }

  return { order, errors };
}

const { order, errors } = validateAndOrder(composeServices);

if (errors.length) {
  console.log("Validation errors:");
  errors.forEach(e => console.log("  ERROR:", e));
} else {
  console.log("Stack is valid. Startup order:");
  order.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
```

## Common pitfalls

> [!PITFALL] depends_on without healthcheck causes race conditions
> `depends_on: [db]` (shorthand) only waits for the container to *start*, not for Postgres to be ready. The `api` service will try to connect before Postgres has run its init scripts and begun accepting connections. The fix is always `condition: service_healthy` paired with a `healthcheck:` block on the dependency — no exceptions.

## What you learned

- `docker-compose.yml` defines multi-service stacks as code; `docker compose up` is the single command to reproduce any environment.
- Services reach each other by service name via Docker's embedded DNS on a shared network.
- `depends_on` with `condition: service_healthy` and a proper `healthcheck` is the only reliable way to enforce startup order.
- Named volumes persist data; bind mounts share host files; both have different lifecycle semantics.
- Credentials belong in `.env` files (or secrets managers), never hardcoded in YAML.

## Next steps

You now have a fully containerised local stack. Next up: **CI/CD and Kubernetes** — taking those images through an automated pipeline into a production cluster with rolling deployments, readiness probes, and horizontal scaling.
*/});
