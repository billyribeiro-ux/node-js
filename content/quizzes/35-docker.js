registerQuiz("35-dockerfiles", [
  {
    q: "In a multi-stage Dockerfile, what is the PRIMARY security benefit of keeping build tools in the builder stage?",
    options: [
      "Build tools consume more CPU, so isolating them speeds up the runtime container",
      "The final image contains only compiled output and production dependencies, excluding dev tools and their potential CVEs from the attack surface",
      "Multi-stage builds encrypt the builder stage so its contents cannot be inspected",
      "The builder stage runs with elevated privileges that are dropped in the runtime stage"
    ],
    answer: 1,
    explain: "Every package in the final image is a potential vulnerability surface. TypeScript, jest, nodemon, and other dev tools are not needed at runtime. Multi-stage builds ensure they never appear in the shipped artifact, reducing the number of CVEs the image scanner must evaluate and shrinking the attack surface if the container is compromised."
  },
  {
    q: "Why should 'CMD' always use exec form (a JSON array) rather than shell form (a plain string)?",
    options: [
      "Shell form is slower because Docker must spawn an extra sh process for each command",
      "Shell form spawns 'sh -c' as PID 1, which does not forward SIGTERM to Node, so the container waits 10 seconds and is force-killed instead of gracefully shutting down",
      "JSON array form allows Docker to pass arguments with spaces without escaping",
      "Shell form disables the Docker layer cache for that instruction"
    ],
    answer: 1,
    explain: "With shell form, 'sh' becomes PID 1. When Docker sends SIGTERM to stop the container, 'sh' does not forward the signal to the Node child process. Docker then waits the kill timeout (default 10 s) before sending SIGKILL -- no graceful shutdown. Exec form makes Node PID 1 (or tini if used) so SIGTERM is received and handled correctly."
  },
  {
    q: "What is the role of '.dockerignore' when building an image?",
    options: [
      "It lists image layers that should be excluded from the final build",
      "It prevents Docker from caching specific RUN instructions",
      "It excludes files and directories from the build context sent to the Docker daemon, preventing large or sensitive files from entering the image",
      "It specifies which Dockerfile stages to skip during a build"
    ],
    answer: 2,
    explain: "When you run 'docker build', Docker sends the entire build context directory to the daemon. Without .dockerignore, your local node_modules, .env files, .git history, and test coverage reports are all included -- slowing the transfer and risking secrets leaking into the image. .dockerignore works like .gitignore to exclude these files."
  }
]);

registerResources("35-dockerfiles", [
  { title: "Dockerfile reference", url: "https://docs.docker.com/reference/dockerfile/" },
  { title: "Docker multi-stage builds guide", url: "https://docs.docker.com/build/building/multi-stage/" },
  { title: "Google distroless base images", url: "https://github.com/GoogleContainerTools/distroless" },
  { title: "Node.js Docker best practices (Docker official)", url: "https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md" },
  { title: "Docker .dockerignore reference", url: "https://docs.docker.com/reference/dockerfile/#dockerignore-file" }
]);

registerQuiz("35-image-optimization", [
  {
    q: "In a Dockerfile, what is the correct order for 'COPY' and 'RUN npm ci' instructions to maximise layer cache reuse?",
    options: [
      "COPY . . first, then RUN npm ci, because Docker needs all files before installing",
      "RUN npm ci first, then COPY . ., but you must use --no-cache to ensure fresh installs",
      "COPY package*.json ./ first, then RUN npm ci, then COPY . . -- so the install is only invalidated when manifests change",
      "Both COPY instructions can be combined into one to reduce layers"
    ],
    answer: 2,
    explain: "The npm install layer is expensive (30-120 s). By copying only package*.json before running npm ci, Docker caches that install layer until the manifests change. Copying source files last means any source edit only invalidates the cheap COPY . . layer, not the slow install."
  },
  {
    q: "Why does deleting files in a separate 'RUN' layer NOT reduce the final image size?",
    options: [
      "Docker ignores delete operations in RUN instructions for security reasons",
      "Each RUN layer is immutable -- files deleted in a later layer still exist in the earlier layer, so they contribute to the total image size",
      "Docker merges all RUN layers at build time, so separate delete commands have no effect",
      "You must use BuildKit's --squash flag for any size reduction to take effect"
    ],
    answer: 1,
    explain: "Docker images are stacks of immutable layers. If layer 3 creates a 50 MB file and layer 4 deletes it, the 50 MB still exists in layer 3 and is counted in the image size. To actually reclaim space, the install and cleanup must happen in the SAME RUN instruction: 'RUN apt-get install ... && rm -rf /var/lib/apt/lists/*'."
  },
  {
    q: "What does the HEALTHCHECK instruction in a Dockerfile enable that the default 'healthy = process started' does not?",
    options: [
      "It exposes a /health endpoint automatically on the container's port",
      "It lets orchestrators (Kubernetes, ECS) know when the application is truly ready to serve traffic, not just that the process started",
      "It runs the health probe before each request to ensure the service is responsive",
      "It automatically restarts the Node process if the probe fails, without Docker involvement"
    ],
    answer: 1,
    explain: "Without HEALTHCHECK, Docker marks a container 'healthy' the moment the process starts -- before Express binds to the port or database connections are ready. HEALTHCHECK configures a probe (e.g., HTTP GET to /health) that orchestrators poll. Only after the probe succeeds is traffic routed to the container, preventing premature routing during startup."
  }
]);

registerResources("35-image-optimization", [
  { title: "Dockerfile HEALTHCHECK reference", url: "https://docs.docker.com/reference/dockerfile/#healthcheck" },
  { title: "Docker BuildKit -- cache mounts", url: "https://docs.docker.com/build/cache/optimize/" },
  { title: "tini -- tiny init process for containers", url: "https://github.com/krallin/tini" },
  { title: "Docker layer caching guide", url: "https://docs.docker.com/build/cache/" },
  { title: "node:alpine vs distroless -- size and security tradeoffs", url: "https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md" }
]);

registerQuiz("35-compose", [
  {
    q: "In Docker Compose, why is 'depends_on: [db]' (shorthand) insufficient to guarantee Postgres is ready before the API starts?",
    options: [
      "depends_on only works with services that have a 'ports' mapping defined",
      "The shorthand only waits for the database container process to start, not for Postgres to finish initialisation and begin accepting connections",
      "Docker Compose resolves depends_on in parallel, so ordering is not guaranteed",
      "depends_on is deprecated in Compose v2 and has no effect"
    ],
    answer: 1,
    explain: "The shorthand 'depends_on: [db]' uses the default condition 'service_started', which is satisfied as soon as the container process launches. Postgres needs 5-20 seconds to replay WAL, run init scripts, and begin accepting TCP connections. Using 'condition: service_healthy' paired with a 'healthcheck' block ensures the API only starts once Postgres passes its probe."
  },
  {
    q: "What is the difference between a named volume and a bind mount in Docker Compose?",
    options: [
      "Named volumes are stored in RAM; bind mounts are on disk",
      "Named volumes are managed by Docker and persist across container restarts; bind mounts map a specific host directory into the container",
      "Bind mounts are read-only by default; named volumes support read-write access",
      "Named volumes only work on Linux; bind mounts are cross-platform"
    ],
    answer: 1,
    explain: "Named volumes (declared in the 'volumes:' top-level key) are managed by Docker, stored under Docker's storage driver, and survive 'docker compose down'. Bind mounts (using ./host/path:/container/path syntax) map a specific host filesystem path, which is useful for sharing config files or source code during development."
  },
  {
    q: "How do Docker Compose services on the same named network resolve each other's hostnames?",
    options: [
      "Each service must declare its IP address in an 'aliases' block for DNS to work",
      "Services use Docker's embedded DNS, which resolves each service by its service name as defined in the Compose file",
      "Services communicate via the host's /etc/hosts file, which Compose updates on startup",
      "Only services with a 'ports' mapping exposed to the host can be addressed by name"
    ],
    answer: 1,
    explain: "Docker Compose creates a user-defined bridge network for the project. Docker's embedded DNS server automatically registers each service's name, so the 'api' service can connect to Postgres at 'db:5432' and Redis at 'cache:6379' without any additional configuration or IP address management."
  }
]);

registerResources("35-compose", [
  { title: "Docker Compose file reference", url: "https://docs.docker.com/reference/compose-file/" },
  { title: "Docker Compose depends_on with healthcheck", url: "https://docs.docker.com/compose/how-tos/startup-order/" },
  { title: "Docker networking -- user-defined bridge networks", url: "https://docs.docker.com/engine/network/drivers/bridge/" },
  { title: "Docker volumes documentation", url: "https://docs.docker.com/engine/storage/volumes/" },
  { title: "Docker Compose -- environment variables", url: "https://docs.docker.com/compose/how-tos/environment-variables/" }
]);
