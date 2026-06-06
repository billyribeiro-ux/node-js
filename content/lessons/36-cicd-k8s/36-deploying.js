registerLessonSrc("36-deploying", function () {/*
---
id: 36-deploying
title: "Probes, ConfigMaps, Secrets & Autoscaling"
minutes: 28
level: principal
objectives:
  - Configure liveness, readiness, and startup probes to make Kubernetes aware of app health
  - Decouple configuration and credentials from images using ConfigMaps and Secrets
  - Set up HorizontalPodAutoscaler to scale a Deployment automatically under load
---

# Probes, ConfigMaps, Secrets & Autoscaling

## Why this matters

A Deployment that keeps your Pods running is necessary — but not sufficient. Kubernetes also needs to know *when* a Pod is genuinely ready to serve traffic, *when* it has entered an unrecoverable bad state, and *how many copies* are needed right now. Probes, resource management, and the HorizontalPodAutoscaler (HPA) are what turn a working Deployment into a production-grade, self-operating service. And ConfigMaps with Secrets are what keep credentials out of your container images.

## Learning objectives

- Configure `livenessProbe`, `readinessProbe`, and `startupProbe` correctly and explain why each exists.
- Separate configuration from code using ConfigMaps and Secrets, and inject them into containers.
- Set resource requests/limits and deploy a HorizontalPodAutoscaler to scale on CPU usage.

## Health probes

Kubernetes uses three types of probes, each interrogating your container in a different way:

| Probe | Question | Action on failure |
|---|---|---|
| **startupProbe** | Has the app finished starting? | Kill and restart (lets slow starters initialize) |
| **livenessProbe** | Is the app still alive? | Kill and restart the container |
| **readinessProbe** | Is the app ready to receive traffic? | Remove from Service endpoints (no restart) |

Each probe can use an `httpGet`, `tcpSocket`, or `exec` check.

```js
// Deployment spec → containers[0] — three probes on a Node.js API:
//
// startupProbe:
//   httpGet:
//     path: /healthz
//     port: 3000
//   failureThreshold: 30   // 30 × 10s = 5 minutes to start up
//   periodSeconds: 10
//
// livenessProbe:
//   httpGet:
//     path: /healthz
//     port: 3000
//   initialDelaySeconds: 5
//   periodSeconds: 15
//   failureThreshold: 3     // 3 consecutive failures → restart
//
// readinessProbe:
//   httpGet:
//     path: /ready
//     port: 3000
//   periodSeconds: 5
//   failureThreshold: 2     // 2 failures → pulled from Service load balancer
```

> [!OUTPUT]
> $ kubectl describe pod api-deployment-6d7f84b9c7-4hxkp
> ...
> Liveness:   http-get http://:3000/healthz delay=5s timeout=1s period=15s #success=1 #failure=3
> Readiness:  http-get http://:3000/ready   delay=0s timeout=1s period=5s  #success=1 #failure=2
> Startup:    http-get http://:3000/healthz delay=0s timeout=1s period=10s #success=1 #failure=30

> [!PITFALL] Confusing liveness and readiness
> The single most common probe mistake: using the same endpoint for both liveness and readiness, and having that endpoint check downstream dependencies (database, Redis, etc.). If your database goes down, liveness fails → Kubernetes restarts your Pod in a loop while the database is still down → crash-loop backoff. Instead: **liveness** should be a lightweight "is the event loop alive?" check (literally `res.send("ok")`), while **readiness** can check dependencies and indicate "I cannot serve traffic right now."

> [!PRINCIPAL] The startup probe eliminates the initialDelaySeconds guess
> Before startup probes existed, developers used `initialDelaySeconds` on the liveness probe as a rough buffer for app startup. Set it too low and the app gets killed before it finishes initializing; set it too high and crashes during startup go undetected for that long. The `startupProbe` solves this cleanly: it runs first, holds liveness at bay until the app reports healthy, then hands off to the liveness probe. This is especially important for JVM apps or apps that run database migrations at boot — but it matters for any service that takes more than a few seconds to initialize.

## ConfigMaps

A **ConfigMap** stores non-secret configuration (feature flags, URLs, log levels) as key-value pairs. You inject them into containers as environment variables or as mounted files.

```js
// configmap.yaml
// apiVersion: v1
// kind: ConfigMap
// metadata:
//   name: api-config
// data:
//   LOG_LEVEL: "info"
//   PORT: "3000"
//   DB_HOST: "postgres-service.default.svc.cluster.local"
//   FEATURE_NEW_DASHBOARD: "true"
```

```js
// Reference in the Deployment's container spec:
//
// envFrom:
//   - configMapRef:
//       name: api-config
//
// Or pick individual keys:
// env:
//   - name: LOG_LEVEL
//     valueFrom:
//       configMapKeyRef:
//         name: api-config
//         key: LOG_LEVEL
```

> [!OUTPUT]
> $ kubectl apply -f configmap.yaml
> configmap/api-config created
>
> $ kubectl exec api-deployment-6d7f84b9c7-4hxkp -- env | grep LOG_LEVEL
> LOG_LEVEL=info

## Secrets

A **Secret** is like a ConfigMap but for sensitive data. The values are base64-encoded at rest in etcd (and can be encrypted at rest with provider-level KMS). They are exposed to containers as environment variables or mounted files, never baked into the image.

```js
// Create a Secret from literals (kubectl handles the base64 encoding):
// $ kubectl create secret generic api-secrets \
//     --from-literal=DATABASE_URL="postgresql://user:pass@host/db" \
//     --from-literal=JWT_SECRET="s3cr3t-key-goes-here"
//
// Or as YAML (values must be base64-encoded manually):
// apiVersion: v1
// kind: Secret
// metadata:
//   name: api-secrets
// type: Opaque
// data:
//   DATABASE_URL: cG9zdGdyZXNxbDovL3VzZXI6cGFzc0Bob3N0L2Ri
//   JWT_SECRET: czNjcjN0LWtleS1nb2VzLWhlcmU=
```

```js
// Reference Secrets in the Deployment:
//
// envFrom:
//   - secretRef:
//       name: api-secrets
//
// Or per-key:
// env:
//   - name: DATABASE_URL
//     valueFrom:
//       secretKeyRef:
//         name: api-secrets
//         key: DATABASE_URL
```

> [!NOTE] Base64 is encoding, not encryption
> `kubectl get secret api-secrets -o yaml` reveals the base64-encoded values, which anyone with cluster read access can decode instantly. For true at-rest encryption, enable KMS envelope encryption in your cloud provider, or use tools like Sealed Secrets or HashiCorp Vault with the Vault Agent Injector. Never commit Secret YAML with real values to Git.

## Resource requests and limits

Every container should declare what it *needs* (`requests`) and the ceiling it can use (`limits`):

```js
// resources:
//   requests:
//     cpu: "100m"       // 0.1 CPU cores — used for scheduling
//     memory: "128Mi"   // 128 MiB — used for scheduling
//   limits:
//     cpu: "500m"       // throttled if it exceeds 0.5 cores
//     memory: "256Mi"   // OOMKilled if it exceeds 256 MiB
```

The scheduler places Pods on nodes that have enough *requested* capacity. Limits are enforced at runtime by the Linux kernel's cgroup machinery.

## HorizontalPodAutoscaler

The **HPA** watches a metric (CPU, memory, or custom) and adjusts the Deployment's `replicas` automatically:

```js
// hpa.yaml
// apiVersion: autoscaling/v2
// kind: HorizontalPodAutoscaler
// metadata:
//   name: api-hpa
// spec:
//   scaleTargetRef:
//     apiVersion: apps/v1
//     kind: Deployment
//     name: api-deployment
//   minReplicas: 2
//   maxReplicas: 20
//   metrics:
//     - type: Resource
//       resource:
//         name: cpu
//         target:
//           type: Utilization
//           averageUtilization: 60   // target 60% CPU across all Pods
```

> [!OUTPUT]
> $ kubectl get hpa
> NAME      REFERENCE                    TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
> api-hpa   Deployment/api-deployment    72%/60%   2         20        4          3m
>
> (CPU above target → HPA scaled from 3 → 4 replicas)

The HPA scaling formula (simplified):

```
desiredReplicas = ceil(currentReplicas × (currentMetric / targetMetric))
```

So with 3 replicas at 72% CPU and a target of 60%: `ceil(3 × 72/60)` = `ceil(3.6)` = **4 replicas**.

> [!PRINCIPAL] Scale-down delay prevents flapping
> The HPA deliberately scales down slowly (default: wait 5 minutes of sustained low load before removing replicas). This prevents the "thundering herd" problem: if a spike passes and you immediately remove replicas, the next small spike causes another scale-up, which triggers another scale-down, and your fleet oscillates. Tune `--horizontal-pod-autoscaler-downscale-stabilization` in the controller or use a behavior block in the HPA spec to match your traffic pattern. For bursty workloads, keep `minReplicas` higher and let scale-down be conservative.

## Try it yourself

The HPA formula is pure math. Let's build a simulator that computes desired replica counts over a series of CPU samples:

```js run
// HPA simulator — models how Kubernetes computes desired replicas
// from current CPU utilization vs the target.

function hpaDesiredReplicas(currentReplicas, currentCpuPct, targetCpuPct, min, max) {
  const raw = currentReplicas * (currentCpuPct / targetCpuPct);
  return Math.min(max, Math.max(min, Math.ceil(raw)));
}

function runHpaSimulation(samples, targetCpuPct, minReplicas, maxReplicas) {
  let replicas = minReplicas;
  console.log(`HPA target=${targetCpuPct}% cpu, min=${minReplicas}, max=${maxReplicas}\n`);
  console.log("Time  CPU%   Current  Desired  Action");
  console.log("----  -----  -------  -------  ------");

  for (const { t, cpu } of samples) {
    const desired = hpaDesiredReplicas(replicas, cpu, targetCpuPct, minReplicas, maxReplicas);
    let action = "stable";
    if (desired > replicas) action = `scale UP  (+${desired - replicas})`;
    else if (desired < replicas) action = `scale DOWN (-${replicas - desired})`;
    console.log(
      `${String(t).padStart(4)}  ${String(cpu).padStart(5)}%  ${String(replicas).padStart(7)}  ${String(desired).padStart(7)}  ${action}`
    );
    replicas = desired;
  }
}

const samples = [
  { t:  "0s", cpu: 30 },
  { t: "30s", cpu: 55 },
  { t: "60s", cpu: 78 },
  { t: "90s", cpu: 91 },
  { t:"120s", cpu: 95 },
  { t:"150s", cpu: 62 },
  { t:"180s", cpu: 40 },
  { t:"210s", cpu: 22 },
];

runHpaSimulation(samples, 60, 2, 10);
```

## Exercise: add scale-down stabilization

Extend the simulator to implement scale-down stabilization: the controller should only scale down if the desired replica count has been consistently lower than the current count for `stabilizationWindowSeconds` of consecutive samples. Scale-up should still happen immediately.

<details>
<summary>Show solution</summary>

```js run
function hpaDesired(cur, cpu, target, min, max) {
  return Math.min(max, Math.max(min, Math.ceil(cur * (cpu / target))));
}

function runStabilized(samples, targetCpu, min, max, windowTicks) {
  let replicas = min;
  let ticksBelowDesired = 0;
  console.log(`HPA with stabilization window=${windowTicks} ticks\n`);

  for (const { t, cpu } of samples) {
    const desired = hpaDesired(replicas, cpu, targetCpu, min, max);

    if (desired > replicas) {
      // Scale up immediately
      console.log(`t=${t} cpu=${cpu}% → scale UP  ${replicas} → ${desired}`);
      replicas = desired;
      ticksBelowDesired = 0;
    } else if (desired < replicas) {
      // Accumulate stabilization ticks
      ticksBelowDesired++;
      if (ticksBelowDesired >= windowTicks) {
        console.log(`t=${t} cpu=${cpu}% → scale DOWN ${replicas} → ${desired} (after ${ticksBelowDesired} ticks)`);
        replicas = desired;
        ticksBelowDesired = 0;
      } else {
        console.log(`t=${t} cpu=${cpu}% → hold (stabilizing: ${ticksBelowDesired}/${windowTicks})`);
      }
    } else {
      ticksBelowDesired = 0;
      console.log(`t=${t} cpu=${cpu}% → stable at ${replicas}`);
    }
  }
}

const samples = [
  { t: "0s",   cpu: 80 },
  { t: "30s",  cpu: 90 },
  { t: "60s",  cpu: 35 },
  { t: "90s",  cpu: 28 },
  { t: "120s", cpu: 22 },
  { t: "150s", cpu: 20 },
  { t: "180s", cpu: 18 },
];

runStabilized(samples, 60, 2, 10, 3);
```

</details>

## Project

**Build a full CI/CD pipeline plus a Kubernetes manifest set deploying the API with autoscaling.**

You will wire together everything from this module — GitHub Actions CI/CD and a complete Kubernetes deployment — into a production-ready setup.

### Acceptance criteria

1. **GitHub Actions pipeline** — a `.github/workflows/ci.yml` workflow that runs lint, tests, and builds a Docker image on every push to `main`. On success it pushes the image to a container registry (GHCR or Docker Hub) tagged with the Git SHA.
2. **Deployment manifest** — a `k8s/deployment.yaml` with `replicas: 2`, a startup probe, a liveness probe, and a readiness probe all pointing to a `/healthz` endpoint. Resource requests and limits must be set.
3. **ConfigMap + Secret** — a `k8s/configmap.yaml` for non-sensitive config and a `k8s/secret.yaml` (or documented `kubectl create secret` command) for `DATABASE_URL` and `JWT_SECRET`. The Deployment must reference both.
4. **Service** — a `k8s/service.yaml` of type `LoadBalancer` (or `ClusterIP` + Ingress) exposing port 80 → 3000.
5. **HPA** — a `k8s/hpa.yaml` that scales the Deployment between 2 and 20 replicas, targeting 60% CPU utilization.
6. **CD step** — the GitHub Actions `release` job applies the Kubernetes manifests to the cluster (via `kubectl apply -f k8s/`) after the image is pushed, using a cluster credential stored as a GitHub secret.

### Starter — HPA simulator (pure JS, runs in the sandbox)

The code below is the pure-logic core of the HPA formula you will configure in `hpa.yaml`. Use it to reason about your autoscaling settings before deploying.

```js run
// HPA replica calculator — pure-logic core of Kubernetes autoscaling.
// Useful for reasoning about min/max/target before writing the YAML.

function computeDesiredReplicas({ current, cpuPct, targetPct, min, max }) {
  if (cpuPct === 0) return min;
  const raw = current * (cpuPct / targetPct);
  return Math.min(max, Math.max(min, Math.ceil(raw)));
}

// Scenario: your API is handling a traffic ramp-up.
// You configured: targetCpu=60%, min=2, max=20.
const config = { targetPct: 60, min: 2, max: 20 };

const trafficRamp = [
  { label: "quiet night",    cpuPct: 15 },
  { label: "morning ramp",   cpuPct: 45 },
  { label: "peak hour",      cpuPct: 80 },
  { label: "viral spike",    cpuPct: 130 },  // over-subscribed: HPA maxes out
  { label: "spike settling", cpuPct: 70 },
  { label: "afternoon lull", cpuPct: 25 },
];

let replicas = config.min;
console.log("Scenario          CPU%   Replicas");
console.log("----------------  -----  --------");
for (const { label, cpuPct } of trafficRamp) {
  replicas = computeDesiredReplicas({ current: replicas, cpuPct, ...config });
  console.log(
    label.padEnd(18) + "  " +
    String(cpuPct).padStart(4) + "%  " +
    String(replicas).padStart(6) + " pods"
  );
}
```

## Common pitfalls

> [!PITFALL] Setting limits much higher than requests causes noisy-neighbour problems
> When `limits.cpu` is 10× `requests.cpu`, the scheduler places Pods as if they need little CPU, but they can burst and starve other Pods on the same node. Keep the limit-to-request ratio to 2–5× for CPU. For memory, set requests = limits (memory is non-compressible: a Pod that hits its memory limit is OOMKilled, there is no throttling).

Also watch out for HPA fighting with Cluster Autoscaler: if your HPA scales Pods to 10 but no node has room, pods stay `Pending` until the Cluster Autoscaler provisions a new node (typically 2–5 minutes). Size your node pools or keep `minReplicas` high enough to absorb common spikes without needing new nodes.

## What you learned

- **startupProbe** holds liveness checks at bay during initialization; **livenessProbe** restarts unresponsive containers; **readinessProbe** removes unhealthy Pods from the Service without restarting them.
- **ConfigMaps** decouple non-secret config from images; **Secrets** do the same for credentials — neither should ever be baked into a Docker image.
- Resource `requests` drive scheduling; `limits` are enforced at runtime — always set both for every container.
- The **HPA** formula `ceil(current × currentMetric / targetMetric)` is simple, but scale-down stabilization and min/max bounds are what make it production-safe.
- Combining a GitHub Actions CI/CD pipeline with Kubernetes manifests gives you a fully automated path from `git push` to running, self-scaling production service.

## Next steps

You now have a complete deployment story: code is linted, tested, and built by CI; the image is pushed and applied to Kubernetes; and the cluster scales automatically under load. Next, explore **serverless and edge computing** — where infrastructure disappears entirely and you deploy functions instead of containers.
*/});
