registerQuiz("36-github-actions", [
  {
    q: "What is the key difference between 'npm ci' and 'npm install' in a CI/CD pipeline?",
    options: [
      "npm ci is faster because it skips downloading packages",
      "npm ci installs exactly what the lockfile specifies and fails if the lockfile is out of sync",
      "npm ci only installs devDependencies",
      "npm ci requires a .npmrc file to function"
    ],
    answer: 1,
    explain: "npm ci installs exactly what package-lock.json specifies, fails if the lockfile is out of sync with package.json, and is significantly faster than npm install because it skips resolution."
  },
  {
    q: "In a GitHub Actions matrix build with 3 Node versions and 2 operating systems, how many parallel jobs are created by default?",
    options: [
      "3 jobs",
      "2 jobs",
      "6 jobs",
      "5 jobs"
    ],
    answer: 2,
    explain: "A matrix strategy multiplies all dimensions together: 3 Node versions x 2 OSes = 6 parallel jobs, each running the full pipeline for one combination."
  },
  {
    q: "Which commit message prefix causes semantic-release to bump a MINOR version (e.g. 1.2.3 to 1.3.0)?",
    options: [
      "fix:",
      "feat:",
      "chore:",
      "refactor:"
    ],
    answer: 1,
    explain: "According to the Conventional Commits convention used by semantic-release, a 'feat:' prefix triggers a minor version bump, 'fix:' triggers a patch bump, and 'feat!:' or 'BREAKING CHANGE' triggers a major bump."
  }
]);

registerResources("36-github-actions", [
  { title: "GitHub Actions: Workflow syntax reference", url: "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions" },
  { title: "actions/setup-node: caching dependencies", url: "https://github.com/actions/setup-node#caching-global-packages-data" },
  { title: "semantic-release documentation", url: "https://semantic-release.gitbook.io/semantic-release/" },
  { title: "Conventional Commits specification", url: "https://www.conventionalcommits.org/en/v1.0.0/" },
  { title: "GitHub Actions: matrix strategy", url: "https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs" }
]);

registerQuiz("36-k8s-basics", [
  {
    q: "What is the primary reason you should almost never create bare Pods in a Kubernetes production environment?",
    options: [
      "Bare Pods cannot have environment variables injected",
      "Bare Pods have no self-healing — if the node dies, the Pod is gone with no replacement",
      "Bare Pods cannot expose ports via a Service",
      "Bare Pods do not support resource requests and limits"
    ],
    answer: 1,
    explain: "A bare Pod has no controller watching it. If the node it lives on dies, the Pod is gone permanently. A Deployment manages a ReplicaSet that continuously ensures the desired number of healthy Pods are running."
  },
  {
    q: "What Kubernetes object provides a stable virtual IP and DNS name that load-balances traffic across a dynamic set of Pods?",
    options: [
      "Deployment",
      "ReplicaSet",
      "Service",
      "ConfigMap"
    ],
    answer: 2,
    explain: "A Service provides a stable virtual IP (ClusterIP) and DNS name. It selects Pods by label and automatically updates its endpoint list as Pods come and go, so callers never need to track individual Pod IPs."
  },
  {
    q: "In a Kubernetes rolling update, what do 'maxSurge: 1' and 'maxUnavailable: 0' mean together?",
    options: [
      "At most 1 new Pod is created and at most 1 old Pod is terminated simultaneously",
      "One extra Pod above the desired count can exist, and the replica count never drops below the desired count during the update",
      "The rollout pauses after each Pod and waits for manual approval",
      "All old Pods are terminated before any new Pods are started"
    ],
    answer: 1,
    explain: "maxSurge: 1 allows one extra Pod above the desired replica count temporarily. maxUnavailable: 0 means the live replica count never drops below the desired count, ensuring full capacity is maintained throughout the rollout."
  }
]);

registerResources("36-k8s-basics", [
  { title: "Kubernetes: Deployments", url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/" },
  { title: "Kubernetes: Services", url: "https://kubernetes.io/docs/concepts/services-networking/service/" },
  { title: "Kubernetes: Pods", url: "https://kubernetes.io/docs/concepts/workloads/pods/" },
  { title: "kubectl Cheat Sheet", url: "https://kubernetes.io/docs/reference/kubectl/cheatsheet/" }
]);

registerQuiz("36-deploying", [
  {
    q: "What is the key difference between a livenessProbe and a readinessProbe in Kubernetes?",
    options: [
      "livenessProbe checks external dependencies; readinessProbe only checks process health",
      "livenessProbe failure restarts the container; readinessProbe failure removes the Pod from Service endpoints without restarting it",
      "livenessProbe runs during startup only; readinessProbe runs continuously",
      "They are identical and can be used interchangeably"
    ],
    answer: 1,
    explain: "A failed livenessProbe causes Kubernetes to kill and restart the container. A failed readinessProbe removes the Pod from the Service's endpoint list so it stops receiving traffic, but does NOT restart it — allowing the app to temporarily stop serving while recovering."
  },
  {
    q: "What is base64 encoding used for in a Kubernetes Secret, and why is it insufficient for true security?",
    options: [
      "It encrypts the value with AES-256 before storing it in etcd",
      "It is only encoding, not encryption — anyone with read access to the cluster can decode the value trivially",
      "It compresses the value to save space in etcd",
      "It hashes the value so the original cannot be recovered"
    ],
    answer: 1,
    explain: "Kubernetes Secrets store values as base64-encoded strings, which is reversible encoding, not encryption. Anyone with 'kubectl get secret' access can instantly decode the value. True at-rest encryption requires KMS envelope encryption or tools like HashiCorp Vault."
  },
  {
    q: "Given 3 replicas at 72% CPU and an HPA target of 60% CPU, how many replicas does the HPA scale to?",
    options: [
      "3",
      "5",
      "4",
      "6"
    ],
    answer: 2,
    explain: "The HPA formula is ceil(currentReplicas x currentMetric / targetMetric) = ceil(3 x 72/60) = ceil(3.6) = 4 replicas."
  }
]);

registerResources("36-deploying", [
  { title: "Kubernetes: Configure Liveness, Readiness and Startup Probes", url: "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/" },
  { title: "Kubernetes: ConfigMaps", url: "https://kubernetes.io/docs/concepts/configuration/configmap/" },
  { title: "Kubernetes: Secrets", url: "https://kubernetes.io/docs/concepts/configuration/secret/" },
  { title: "Kubernetes: HorizontalPodAutoscaler", url: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/" },
  { title: "Kubernetes: Resource Management for Pods and Containers", url: "https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/" }
]);
