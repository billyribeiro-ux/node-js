registerLessonSrc("35-image-optimization", function () {/*
---
id: 35-image-optimization
title: "Image Size, Caching & Healthchecks"
minutes: 22
level: advanced
objectives:
  - Apply layer caching strategy to minimise rebuild times
  - Reduce image size by combining layers and using lean base images
  - Add HEALTHCHECK and fix PID 1 signal handling with tini
---

# Image Size, Caching & Healthchecks

## Why this matters

A poorly structured Dockerfile is a hidden tax on every engineer on the team. A 10-second build becomes a 3-minute build because `npm ci` reruns on every source edit. A 1.2 GB image becomes a slow pull in CI, a cold-start penalty in production, and a CVE-scanner nightmare. Getting layer ordering, size, and health probes right is craft-level Docker — and these patterns ship in every serious Node service in the wild.

## Learning objectives

- Order Dockerfile instructions so expensive layers are cached as long as possible.
- Combine layers, use `--omit=dev`, and pick the right base to minimise image size.
- Add a `HEALTHCHECK` so orchestrators know when your app is truly ready.
- Understand why Node must not be PID 1 and how `tini` (or `--init`) fixes it.

## Layer caching strategy: copy package.json first

Docker builds images instruction by instruction. When a layer's input changes, that layer **and every layer below it** are invalidated. The critical insight: `npm ci` is expensive (30–120 seconds) but your `package.json` changes far less often than your source files.

The correct order:

```js
// Dockerfile — cache-optimised layer order
```

```
FROM node:22-alpine

WORKDIR /app

// 1. Copy manifests first — changes rarely
COPY package.json package-lock.json ./

// 2. Install — cached until manifests change
RUN npm ci --omit=dev

// 3. Copy source — changes on every edit (invalidates only this layer and below)
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> // first build — everything runs
> $ docker build -t api .
> [1/5] FROM node:22-alpine         DONE  0.1s
> [2/5] WORKDIR /app                DONE  0.0s
> [3/5] COPY package*.json ./       DONE  0.1s
> [4/5] RUN npm ci --omit=dev       DONE  42.7s
> [5/5] COPY . .                    DONE  0.3s
>
> // second build after editing src/index.js — npm ci is CACHED
> $ docker build -t api .
> [1/5] FROM node:22-alpine         CACHED
> [2/5] WORKDIR /app                CACHED
> [3/5] COPY package*.json ./       CACHED
> [4/5] RUN npm ci --omit=dev       CACHED  ← 42 seconds saved every time
> [5/5] COPY . .                    DONE  0.3s

> [!PRINCIPAL] Cache invalidation is sequential, not selective
> Docker cannot skip a changed layer and re-use a later one — the DAG flows downward. Every architectural decision about what to `COPY` and when is really a decision about cache locality. This is why monorepos with workspace packages need careful orchestration: copying `packages/shared/package.json` before `packages/api/src` keeps shared-package installs cached when only the api source changes.

## Minimising image size

Three levers: base image choice, layer combining, and excluding what you don't need.

### 1. Base image choice

| Base image | Approx. size | Shell | Suitable for |
|---|---|---|---|
| `node:22` | ~1.1 GB | bash | Local dev parity |
| `node:22-slim` | ~240 MB | bash | Default runtime |
| `node:22-alpine` | ~180 MB | ash | Most prod workloads |
| `gcr.io/distroless/nodejs22-debian12` | ~120 MB | none | Hardened prod |

### 2. Combine related RUN instructions

Each `RUN` is a layer. Separate `RUN apt-get update` and `RUN apt-get install` is a classic mistake — the update is cached separately and may become stale. Combine with `&&` and clean up in the same layer:

```js
// Dockerfile — combining apt steps on Debian-based images
```

```
FROM node:22-slim

// Bad: three layers, and the apt cache persists in layer 2
// RUN apt-get update
// RUN apt-get install -y dumb-init
// RUN rm -rf /var/lib/apt/lists/*

// Good: one layer, cache cleaned inside the same RUN
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> $ docker images api
> REPOSITORY   TAG       SIZE
> api          latest    198MB   // vs 1.1 GB full Debian node image

### 3. Build cache mounts (BuildKit)

BuildKit (enabled by default since Docker 23) supports `--mount=type=cache` in `RUN` instructions. This caches the npm download cache *outside* the image layer, so reinstalls reuse previously downloaded tarballs without bloating the image.

```js
// Dockerfile — BuildKit cache mount for npm
```

```
// syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./

// npm's download cache is stored on the build host, not in the layer
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY . .
CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> // first build: downloads packages, stores in host cache
> [3/4] RUN --mount=type=cache ... npm ci --omit=dev   DONE  41.2s
>
> // second build after package.json change:
> [3/4] RUN --mount=type=cache ... npm ci --omit=dev   DONE  4.8s  ← tarballs cached

## HEALTHCHECK

`HEALTHCHECK` tells the Docker daemon (and orchestrators like Kubernetes or ECS) how to probe your container. Without it, Docker considers the container "healthy" the moment the process starts — before your Express server has bound to the port or your database connection is ready.

```js
// Dockerfile — adding a HEALTHCHECK
```

```
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000

// probe every 30s, timeout after 5s, 3 retries before "unhealthy", 10s grace period at start
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> $ docker ps
> CONTAINER ID   IMAGE   STATUS
> a3f8c1d9b2e7   api     Up 20 seconds (health: starting)
>
> // after 10s start-period and first successful probe:
> a3f8c1d9b2e7   api     Up 35 seconds (healthy)

Your `/health` endpoint should return HTTP 200 when the app is ready to serve traffic. If a dependency (database, cache) is unavailable, returning 503 lets the orchestrator restart the container or stop routing traffic to it.

> [!NOTE] wget vs curl in Alpine
> Alpine does not include `curl` by default but ships `wget`. Use `wget -qO- <url>` or install `curl` explicitly. Alternatively, write the health check in Node itself: `CMD ["node", "-e", "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"]`

## Signal handling and PID 1

When Docker stops a container it sends `SIGTERM` to PID 1. If your `CMD` uses shell form (`CMD node src/index.js`), the shell (`sh`) is PID 1 and does **not** forward SIGTERM to Node. The container waits 10 seconds (the kill timeout), then receives SIGKILL — no graceful shutdown.

Even with exec form (`CMD ["node", "src/index.js"]`), Node becomes PID 1 itself and must handle zombie reaping — something it only does partially (Node does not reap all orphan child processes by default).

The solution is **tini** (or the equivalent `--init` flag to `docker run`):

```js
// Dockerfile — tini as the init process
```

```
FROM node:22-alpine

// tini is a tiny init process that handles zombie reaping and signal forwarding
RUN apk add --no-cache tini

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

USER node
EXPOSE 3000

// ENTRYPOINT runs before CMD; tini becomes PID 1 and launches node as a child
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> $ docker stop my-container
> // with tini: Node receives SIGTERM → runs graceful shutdown → exits 0 in <1s
> // without tini: 10 second wait → SIGKILL → exit 137 (dirty shutdown)

> [!PITFALL] Shell form CMD silently eats SIGTERM
> `CMD node src/index.js` looks harmless but causes every container stop to time out. `docker stop` appears to hang, CI pipelines run slower, and database connections are closed by force rather than gracefully. Always use exec form and tini.

## Try it yourself

The runnable block below computes "image size" from a list of layers and lets you experiment with combining layers to see the savings. It mirrors the mental model of `docker history <image>`.

```js run
// Image-size analyser: compute total size and show savings from layer combining.

const layers = [
  { instruction: "FROM node:22-alpine",          sizeMB: 178 },
  { instruction: "RUN apt-get update",           sizeMB: 12  },  // stale cache risk!
  { instruction: "RUN apt-get install -y tini",  sizeMB: 4   },
  { instruction: "RUN rm -rf /var/lib/apt/lists", sizeMB: -8  },  // cleanup in separate layer doesn't shrink the image!
  { instruction: "COPY package*.json ./",        sizeMB: 0.1 },
  { instruction: "RUN npm ci --omit=dev",        sizeMB: 65  },
  { instruction: "COPY . .",                     sizeMB: 2   },
];

function totalSize(ls) {
  // In a real image, a layer that deletes files doesn't reclaim space from earlier layers
  // because each layer is immutable. Only combining into one RUN reclaims space.
  return ls.reduce((sum, l) => sum + l.sizeMB, 0);
}

console.log("=== Naïve layer order ===");
layers.forEach(l => console.log(`  ${l.sizeMB >= 0 ? "+" : ""}${l.sizeMB.toFixed(1)} MB  ${l.instruction}`));
console.log(`  TOTAL: ${totalSize(layers).toFixed(1)} MB`);
console.log();

// Combine the three apt steps into one layer — cleanup NOW reduces the layer size
const optimised = [
  { instruction: "FROM node:22-alpine",                      sizeMB: 178 },
  { instruction: "RUN apt-get update && install && cleanup", sizeMB: 5   }, // combined!
  { instruction: "COPY package*.json ./",                    sizeMB: 0.1 },
  { instruction: "RUN npm ci --omit=dev",                    sizeMB: 65  },
  { instruction: "COPY . .",                                 sizeMB: 2   },
];

console.log("=== Optimised (combined RUN) ===");
optimised.forEach(l => console.log(`  +${l.sizeMB.toFixed(1)} MB  ${l.instruction}`));
const saved = totalSize(layers) - totalSize(optimised);
console.log(`  TOTAL: ${totalSize(optimised).toFixed(1)} MB`);
console.log(`  Saved: ${saved.toFixed(1)} MB by combining apt steps`);
```

## Exercise

**Challenge:** A team-mate wrote this Dockerfile fragment. List every caching and size problem you can spot, then write a corrected version.

```js
// Their Dockerfile (read-only — spot the problems)
```

```
FROM node:22

COPY . .
RUN npm install
RUN npm run build
RUN apt-get install -y curl
```

<details>
<summary>Show solution</summary>

Problems:

1. `FROM node:22` — full Debian image (~1.1 GB). Use `node:22-slim` or `node:22-alpine`.
2. `COPY . .` before `npm install` — every source change busts the install cache.
3. `npm install` — installs devDependencies. Use `npm ci --omit=dev` for production.
4. No multi-stage — build artifacts (tsc output) and dev deps all go into the final image.
5. `apt-get install` without `apt-get update` in the same layer — may install stale packages.
6. No `USER node` — runs as root.
7. No `HEALTHCHECK`, no tini.

```js run
// Simulate cache behaviour: COPY . . before npm install
const bad = [
  { name: "FROM node:22",        reads: [] },
  { name: "COPY . .",            reads: ["src/index.js", "package.json"] },
  { name: "RUN npm install",     reads: ["package.json"] },
];

const good = [
  { name: "FROM node:22-alpine", reads: [] },
  { name: "COPY package*.json",  reads: ["package.json"] },
  { name: "RUN npm ci",          reads: ["package.json"] },
  { name: "COPY . .",            reads: ["src/index.js"] },
];

function simulate(steps, changed, label) {
  console.log(label, "| changed:", changed.join(", ") || "(none)");
  let dirty = false;
  steps.forEach((s, i) => {
    if (s.reads.some(f => changed.includes(f))) dirty = true;
    console.log(`  Step ${i+1} [${dirty ? "REBUILD" : "CACHED "}]  ${s.name}`);
  });
  console.log();
}

simulate(bad,  ["src/index.js"], "BAD order  ");
simulate(good, ["src/index.js"], "GOOD order ");
```

In the good order, editing `src/index.js` keeps `npm ci` cached. In the bad order, `npm install` reruns on every source change.
</details>

## Common pitfalls

> [!PITFALL] Deleting files in a later RUN layer does not shrink the image
> `RUN npm install` then `RUN rm -rf node_modules/.cache` does not remove those bytes from the image — the files exist in the earlier layer, which is immutable. You must combine both operations into **one** `RUN` statement: `RUN npm install && rm -rf node_modules/.cache`.

## What you learned

- Copy `package.json` before source files so the expensive `npm ci` step is cached as long as possible.
- Combine related `RUN` steps to avoid stranded bytes in earlier layers.
- BuildKit `--mount=type=cache` caches the npm download cache outside the image.
- `HEALTHCHECK` lets orchestrators detect truly-ready containers.
- Node should not be PID 1 — use `tini` or `docker run --init` for correct signal forwarding and zombie reaping.

## Next steps

Individual containers are useful, but real applications are multi-service stacks. Next up: **Docker Compose** for running your API, database, and Redis together with a single command.
*/});
