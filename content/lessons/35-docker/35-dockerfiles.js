registerLessonSrc("35-dockerfiles", function () {/*
---
id: 35-dockerfiles
title: "Dockerfiles for Node (Multi-Stage, Distroless)"
minutes: 24
level: advanced
objectives:
  - Understand what a container is and how a Dockerfile defines one
  - Write a production-quality Node Dockerfile with multi-stage builds
  - Use distroless and alpine base images and a non-root USER for security
---

# Dockerfiles for Node (Multi-Stage, Distroless)

## Why this matters

Shipping "works on my machine" is a joke until containers make it literal. A Docker container packages your Node app, its runtime, and every system dependency into a single immutable artifact that runs identically in development, CI, staging, and production. Understanding multi-stage builds and lean base images is the difference between a 1.2 GB image that ships every `node_modules` dev tool and a 90 MB image that is faster to pull, has a smaller attack surface, and starts in milliseconds.

@diagram:container-layers

## Learning objectives

- Explain what a container image and layer are.
- Write a multi-stage Dockerfile that separates build dependencies from the runtime image.
- Choose between `node:alpine`, `node:slim`, and distroless base images.
- Add a non-root `USER` and a `.dockerignore` file for security and correctness.

## What is a container?

A **container** is a process running in an isolated Linux namespace with its own filesystem. That filesystem comes from an **image** — a stack of read-only **layers**, each produced by one Dockerfile instruction. When a container starts, Docker adds a thin writable layer on top.

```
┌─────────────────────────────────┐
│  Writable container layer       │  ← your running process writes here
├─────────────────────────────────┤
│  COPY . .   (your app code)     │  ← image layer 4
├─────────────────────────────────┤
│  RUN npm ci --omit=dev          │  ← image layer 3
├─────────────────────────────────┤
│  COPY package*.json .           │  ← image layer 2
├─────────────────────────────────┤
│  node:22-alpine base            │  ← image layer 1 (from Docker Hub)
└─────────────────────────────────┘
```

Because layers are **content-addressed**, Docker only rebuilds a layer when its instruction or any earlier input changes — this is the layer cache, and it is the most important performance concept in Docker.

## A minimal Node Dockerfile

```js
// Dockerfile — single-stage, good for dev/learning
```

```
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
```

> [!OUTPUT]
> $ docker build -t my-api .
> [1/5] FROM node:22-alpine
> [2/5] WORKDIR /app
> [3/5] COPY package*.json ./
> [4/5] RUN npm ci --omit=dev
> [5/5] COPY . .
> Successfully built a2f3b9c1d5e7

The `COPY package*.json` before `COPY . .` is deliberate — more on that in the next lesson. `CMD` sets the default command; it should use **exec form** (JSON array) so the Node process is PID 1 and receives OS signals.

## Multi-stage builds

A **multi-stage build** uses multiple `FROM` statements in one Dockerfile. Each stage gets a name with `AS`. The final image is built from the *last* stage, and only files explicitly `COPY --from=<stage>` are included. Build tools (`typescript`, `esbuild`, dev dependencies) stay in the build stage and never appear in the shipped image.

```js
// Dockerfile — multi-stage for a TypeScript app
```

```
// Stage 1: install ALL deps and compile TypeScript
FROM node:22-alpine AS builder
WORKDIR /build

COPY package*.json ./
RUN npm ci                          // includes devDependencies

COPY tsconfig.json ./
COPY src ./src
RUN npm run build                   // emits dist/

// Stage 2: production runtime — only compiled output + prod deps
FROM node:22-alpine AS runtime
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /build/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

> [!OUTPUT]
> $ docker build -t my-api:prod .
> [builder 1/6] FROM node:22-alpine
> [builder 4/6] RUN npm ci
> [builder 6/6] RUN npm run build
> [runtime 1/4] FROM node:22-alpine
> [runtime 3/4] RUN npm ci --omit=dev
> [runtime 4/4] COPY --from=builder /build/dist ./dist
> Successfully built c7d19e3a8b2f
> $ docker images my-api
> REPOSITORY   TAG    SIZE
> my-api       prod   118MB   // vs 890MB if devDeps were included

> [!PRINCIPAL] Why multi-stage matters for security
> Every megabyte you exclude is a megabyte of potential CVEs. TypeScript compiler, jest, nodemon — none of these belong in a production image. Multi-stage is not premature optimisation; it is a baseline security practice. The builder stage can install anything you need without polluting the shipped artifact.

## Distroless and Alpine base images

| Base image | Size (node 22) | Shell | Use case |
|---|---|---|---|
| `node:22` (Debian) | ~1 GB | yes | Dev, compat testing |
| `node:22-slim` | ~230 MB | yes | Good default runtime |
| `node:22-alpine` | ~175 MB | ash | Production, fast pulls |
| `gcr.io/distroless/nodejs22-debian12` | ~115 MB | **no** | Hardened production |

**Alpine** uses `musl libc` and `ash` instead of `bash`. Occasionally causes issues with native binaries compiled against `glibc` (check with `npm rebuild`). For most pure-JS apps it is fine.

**Distroless** (Google) strips the shell, package manager, and most OS utilities entirely. There is nothing to exec into — that is the point. You can still debug with `docker run --entrypoint sh gcr.io/distroless/nodejs22-debian12:debug`.

```js
// Dockerfile — distroless runtime stage
```

```
FROM node:22-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
EXPOSE 3000
CMD ["dist/index.js"]             // distroless runs node automatically
```

## Non-root USER and .dockerignore

By default, Docker runs as root inside the container. This is unnecessary and dangerous — a container escape becomes a root exploit.

```js
// Dockerfile — adding a non-root user
```

```
FROM node:22-alpine AS runtime
WORKDIR /app

// node:alpine already has a "node" user (uid 1000)
RUN chown -R node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .

EXPOSE 3000
CMD ["node", "src/index.js"]
```

Your `.dockerignore` keeps the build context lean and prevents secrets leaking into images:

```
// .dockerignore
node_modules
dist
.git
.env
.env.*
*.log
coverage
.nyc_output
.DS_Store
```

> [!PITFALL] Forgetting .dockerignore copies node_modules into the image
> Without `.dockerignore`, `COPY . .` sends your local `node_modules` into the image context. Docker then overwrites it with `npm ci`, but the build context transfer is slow and your local platform-native binaries may shadow the in-image install. Always have a `.dockerignore`.

## Try it yourself

The layer cache is the most misunderstood part of Docker. When a layer's instruction or input changes, Docker invalidates that layer **and every layer after it**. Below is a simulator — play with it to see which steps rebuild when a file changes.

```js run
// Layer-cache simulator: each "instruction" lists which files it reads.
// When a file changes, the corresponding layer and all subsequent ones are rebuilt.

const instructions = [
  { name: "FROM node:22-alpine",     reads: [] },
  { name: "COPY package*.json ./",   reads: ["package.json", "package-lock.json"] },
  { name: "RUN npm ci --omit=dev",   reads: ["package.json", "package-lock.json"] },
  { name: "COPY . .",                reads: ["src/index.js", "src/router.js"] },
  { name: "CMD [\"node\", \"src/index.js\"]", reads: [] },
];

function simulate(changedFiles) {
  let cacheInvalidated = false;
  console.log("Changed files:", changedFiles.length ? changedFiles.join(", ") : "(none)");
  instructions.forEach((instr, i) => {
    const hit = instr.reads.some(f => changedFiles.includes(f));
    if (hit) cacheInvalidated = true;
    const status = cacheInvalidated ? "REBUILD" : "CACHED ";
    console.log(`  Step ${i + 1} [${status}]  ${instr.name}`);
  });
  console.log();
}

// Scenario A: only app source changed — fast! package install is cached.
simulate(["src/router.js"]);

// Scenario B: package.json changed — npm ci and everything after must rebuild.
simulate(["package.json"]);

// Scenario C: nothing changed — fully cached.
simulate([]);
```

## Exercise

**Challenge:** What happens if you put `COPY . .` *before* `RUN npm ci`? Trace through the simulator above by reordering the instructions array so `COPY . .` (reads `src/index.js`) comes before `RUN npm ci`. Change only `src/index.js` and observe what rebuilds. Why is the standard order safer?

<details>
<summary>Show solution</summary>

```js run
// Reordered Dockerfile — COPY . . BEFORE npm ci (bad practice!)
const badOrder = [
  { name: "FROM node:22-alpine",     reads: [] },
  { name: "COPY package*.json ./",   reads: ["package.json", "package-lock.json"] },
  { name: "COPY . .",                reads: ["src/index.js", "src/router.js"] }, // moved up!
  { name: "RUN npm ci --omit=dev",   reads: ["package.json", "package-lock.json"] },
  { name: "CMD [\"node\",\"src/index.js\"]", reads: [] },
];

function simulate(instructions, changedFiles) {
  let invalid = false;
  changedFiles.forEach(f => console.log("Changed:", f));
  instructions.forEach((instr, i) => {
    if (instr.reads.some(f => changedFiles.includes(f))) invalid = true;
    console.log(`  Step ${i + 1} [${invalid ? "REBUILD" : "CACHED "}]  ${instr.name}`);
  });
}

// Edit src/index.js — npm ci now ALWAYS reruns! Every code change reinstalls deps.
simulate(badOrder, ["src/index.js"]);
```

When `COPY . .` comes before `npm ci`, any source file change invalidates the `npm ci` layer. A cold install on every code edit can add 30–120 seconds to every build cycle.
</details>

## Common pitfalls

> [!PITFALL] Using CMD with shell form breaks signal handling
> `CMD node src/index.js` (shell form, a plain string) spawns `sh -c "node src/index.js"`. The shell is PID 1 and does NOT forward SIGTERM to Node. Your container takes 10 seconds to stop (Docker's kill timeout) instead of gracefully shutting down. Always use exec form: `CMD ["node", "src/index.js"]`.

## What you learned

- A container image is a stack of immutable layers; a running container adds a writable layer on top.
- Multi-stage builds use multiple `FROM` statements so build tools never enter the runtime image.
- Alpine and distroless base images drastically shrink image size and attack surface.
- The non-root `USER` instruction is a baseline security practice — `node:alpine` ships a `node` user for this purpose.
- `.dockerignore` prevents `node_modules` and `.env` files from leaking into the build context.

## Next steps

Now that you can build a correct image, the next lesson focuses on making it *fast and small*: layer caching strategy, minimising layers, HEALTHCHECK, and signal handling with tini.
*/});
