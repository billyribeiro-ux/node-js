registerLessonSrc("36-k8s-basics", function () {/*
---
id: 36-k8s-basics
title: "Kubernetes Basics: Pods, Deployments & Services"
minutes: 26
level: principal
objectives:
  - Understand why container orchestration exists and what Kubernetes solves
  - Work with Pods, Deployments, and Services at the YAML level
  - Explain the desired-state reconciliation loop and rolling update strategy
---

# Kubernetes Basics: Pods, Deployments & Services

## Why this matters

Running a single Docker container on your laptop is easy. Running that same container reliably across dozens of machines, restarting it when it crashes, scaling it under load, and routing traffic to healthy instances — that is a genuinely hard distributed-systems problem. **Kubernetes (K8s)** solves it by treating your cluster as a single programmable computer: you declare *what you want*, and Kubernetes continuously works to make the real world match that declaration.

## Learning objectives

- Explain the problem container orchestration solves and why Kubernetes became the industry default.
- Define Pods, Deployments, and Services and describe how they relate to each other.
- Understand the reconciliation loop, rolling updates, and how `kubectl` drives the cluster.

## Why orchestration?

Imagine your Node API runs in a Docker container. You need three replicas for availability. When replica 2 crashes at 3 AM, someone must notice, restart it, and put it back behind the load balancer. When traffic spikes, someone must add replicas. When you deploy a new image, you need to replace containers without downtime.

**Without orchestration:** You script all of this manually — and the scripts break in interesting ways.
**With Kubernetes:** You write a YAML file that says "I want three replicas of this image behind a LoadBalancer." Kubernetes runs a control loop forever that makes reality match that intent.

## Pods: the atomic unit

A **Pod** is the smallest deployable unit in Kubernetes. It wraps one or more containers that share:

- A network namespace (the same IP, port space, `localhost`)
- A storage namespace (shared mounted volumes)
- A lifecycle (they start and stop together)

In practice, most Pods contain exactly one application container, sometimes with a sidecar (logging agent, proxy, etc.).

```js
// pod.yaml — the simplest possible Pod
// apiVersion: v1
// kind: Pod
// metadata:
//   name: api-pod
//   labels:
//     app: api
// spec:
//   containers:
//     - name: api
//       image: my-org/node-api:1.4.0
//       ports:
//         - containerPort: 3000
```

> [!NOTE] Pods are ephemeral
> A Pod has no self-healing. If the node it lives on dies, the Pod is gone. You almost never create bare Pods in production — you create a **Deployment** that creates Pods for you and keeps them alive.

## Deployments: desired state for groups of Pods

A **Deployment** is a higher-level object that manages a **ReplicaSet**, which in turn manages Pods. You tell the Deployment: "I want N replicas of this Pod template." The controller loop ensures that exactly N healthy replicas are always running.

```js
// deployment.yaml
// apiVersion: apps/v1
// kind: Deployment
// metadata:
//   name: api-deployment
// spec:
//   replicas: 3
//   selector:
//     matchLabels:
//       app: api
//   template:                         // this is the Pod template
//     metadata:
//       labels:
//         app: api
//     spec:
//       containers:
//         - name: api
//           image: my-org/node-api:1.4.0
//           ports:
//             - containerPort: 3000
//           resources:
//             requests:
//               cpu: "100m"
//               memory: "128Mi"
//             limits:
//               cpu: "500m"
//               memory: "256Mi"
```

> [!OUTPUT]
> $ kubectl apply -f deployment.yaml
> deployment.apps/api-deployment created
>
> $ kubectl get pods
> NAME                              READY   STATUS    RESTARTS   AGE
> api-deployment-6d7f84b9c7-4hxkp  1/1     Running   0          12s
> api-deployment-6d7f84b9c7-7nqtr  1/1     Running   0          12s
> api-deployment-6d7f84b9c7-fzm9w  1/1     Running   0          12s

### Rolling updates

When you update the container image, Kubernetes performs a **rolling update** by default: it brings up one new Pod, waits for it to be ready, then terminates one old Pod, and repeats. At no point does traffic see fewer than `replicas - maxUnavailable` healthy Pods.

```js
// Update the image in-place — Kubernetes rolls it out for you:
// $ kubectl set image deployment/api-deployment api=my-org/node-api:1.5.0
//
// Or update the YAML and re-apply:
// spec:
//   strategy:
//     type: RollingUpdate
//     rollingUpdate:
//       maxSurge: 1          // at most 1 extra Pod above desired
//       maxUnavailable: 0    // never go below desired count
```

> [!OUTPUT]
> $ kubectl rollout status deployment/api-deployment
> Waiting for deployment "api-deployment" rollout to finish: 1 out of 3 new replicas have been updated...
> Waiting for deployment "api-deployment" rollout to finish: 2 out of 3 new replicas have been updated...
> deployment "api-deployment" successfully rolled out

> [!PRINCIPAL] The reconciliation loop is not magic — it is a pattern
> Kubernetes controllers all share the same structure: watch the desired state (spec), observe the current state, compute a diff, and take the minimum corrective action. This "reconcile" pattern is universal in distributed systems. If you ever build a custom operator or even a backend service that manages long-running resources, model it the same way — never assume the world is in any particular state; always observe and correct. It makes your systems far more resilient to partial failures and restarts.

## Services: stable networking for dynamic Pods

Pods come and go — their IPs change every time one is replaced. A **Service** provides a stable virtual IP and DNS name that load-balances across all matching Pods (selected by label).

| Service type | Scope | When to use |
|---|---|---|
| `ClusterIP` | Cluster-internal only | Microservice-to-microservice |
| `NodePort` | Exposed on every node's IP | Development, bare-metal testing |
| `LoadBalancer` | Cloud load balancer provisioned | Production external traffic |
| `ExternalName` | CNAME alias | Integrating external DNS |

```js
// service.yaml — a LoadBalancer service in front of the api Deployment
// apiVersion: v1
// kind: Service
// metadata:
//   name: api-service
// spec:
//   type: LoadBalancer
//   selector:
//     app: api           // routes to all Pods with this label
//   ports:
//     - port: 80
//       targetPort: 3000
```

> [!OUTPUT]
> $ kubectl apply -f service.yaml
> service/api-service created
>
> $ kubectl get service api-service
> NAME          TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)        AGE
> api-service   LoadBalancer   10.96.42.17     34.120.18.200    80:31400/TCP   45s

Traffic arriving at `34.120.18.200:80` is round-robin distributed across the three api Pods. If a Pod dies and is replaced, the Service automatically updates its endpoint list — no manual work required.

## The kubectl workflow

```js
// Most-used kubectl commands for a Node.js developer:
//
// kubectl apply -f manifest.yaml       // create or update resources
// kubectl get pods                     // list Pods and their status
// kubectl describe pod <name>          // full details + recent events
// kubectl logs <pod-name> -f           // stream logs (like docker logs -f)
// kubectl exec -it <pod-name> -- sh    // shell into a running container
// kubectl rollout undo deployment/<n>  // roll back to previous version
// kubectl scale deployment/<n> --replicas=5
```

> [!NOTE] Kubernetes contexts
> A single `kubectl` binary can manage multiple clusters. Each cluster is a **context** in `~/.kube/config`. Switch with `kubectl config use-context <name>` or use a tool like `kubectx` for quick switching. Always double-check your context before running destructive commands.

## Try it yourself

The reconciliation loop — observe desired vs actual, compute delta, act — is a pure algorithm you can model in JavaScript. Let's simulate it:

```js run
// Simulate a Kubernetes-style reconciliation loop.
// The controller drives the current replica count toward the desired count.

function createReplicaController(desired) {
  let current = 0;

  function reconcile() {
    if (current === desired) {
      console.log(`[reconcile] stable: ${current}/${desired} replicas running`);
      return false; // nothing to do
    }
    if (current < desired) {
      const toAdd = desired - current;
      console.log(`[reconcile] scaling UP: launching ${toAdd} pod(s)...`);
      current += toAdd;
    } else {
      const toRemove = current - desired;
      console.log(`[reconcile] scaling DOWN: terminating ${toRemove} pod(s)...`);
      current -= toRemove;
    }
    console.log(`[reconcile] current replicas: ${current}`);
    return true; // acted
  }

  function simulateCrash(count) {
    current = Math.max(0, current - count);
    console.log(`\n[event] ${count} pod(s) crashed! current: ${current}`);
  }

  function scale(n) {
    desired = n;
    console.log(`\n[event] desired replicas changed to ${desired}`);
  }

  return { reconcile, simulateCrash, scale };
}

const ctrl = createReplicaController(3);

// Initial startup
ctrl.reconcile();
ctrl.reconcile(); // second call: already stable

// Simulate a pod crash
ctrl.simulateCrash(1);
ctrl.reconcile(); // controller notices and heals

// Scale up
ctrl.scale(5);
ctrl.reconcile();
ctrl.reconcile(); // stable again

// Scale down
ctrl.scale(2);
ctrl.reconcile();
```

## Exercise: implement a rolling-update simulator

Extend the reconciliation concept to simulate a rolling update: given an old version and a new version, replace old Pods with new ones one at a time, maintaining at least `minAvailable` healthy Pods throughout.

<details>
<summary>Show solution</summary>

```js run
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function rollingUpdate(pods, newImage, minAvailable) {
  console.log(`Rolling update to ${newImage} (minAvailable: ${minAvailable})`);
  let updated = 0;

  for (let i = 0; i < pods.length; i++) {
    const available = pods.length - updated;
    if (available <= minAvailable) {
      // Wait for a previously launched pod to be ready before proceeding.
      // In real K8s the readiness probe handles this; here we just check.
      console.log(`  [wait] available=${available}, minAvailable=${minAvailable} — holding`);
    }
    const old = pods[i];
    pods[i] = newImage;
    updated++;
    console.log(`  [updated] slot ${i}: ${old} -> ${pods[i]} (${pods.length - updated} old remaining)`);
    await delay(20);
  }

  console.log("Rolling update complete:", pods);
}

const pods = ["api:1.0", "api:1.0", "api:1.0", "api:1.0"];
rollingUpdate(pods, "api:2.0", 2);
```

</details>

## Common pitfalls

> [!PITFALL] Forgetting to set resource requests and limits
> Without `resources.requests`, the Kubernetes scheduler has no idea how much CPU or memory your Pod needs, so it may schedule too many Pods on one node and cause an OOMKill cascade. Always set `requests` (used for scheduling) and `limits` (enforced ceiling). A good starting point for a Node.js API: `cpu: 100m / 500m`, `memory: 128Mi / 256Mi`. Tune with real profiling.

A second common trap: using `latest` as your image tag. Kubernetes caches images per node, so two nodes may run different code if the `latest` tag was pushed between pulls. Always pin to a specific digest or version tag in production.

## What you learned

- Kubernetes orchestrates containers by maintaining a **desired state** — a control loop continuously reconciles current reality to the spec.
- **Pods** are ephemeral groups of co-located containers; **Deployments** manage groups of Pods with self-healing and rolling updates.
- **Services** provide stable virtual IPs and DNS names that load-balance across dynamic Pod sets, selected by label.
- Rolling updates replace Pods incrementally, keeping traffic flowing; `maxSurge` and `maxUnavailable` control the rollout pace.
- `kubectl apply` is idempotent — run it again and Kubernetes figures out what changed.

## Next steps

With Pods, Deployments, and Services mastered, you are ready to configure them deeply: health probes that tell Kubernetes when a Pod is truly ready, ConfigMaps and Secrets that decouple configuration from images, resource limits, and HorizontalPodAutoscaler that scales your fleet automatically under load.
*/});
