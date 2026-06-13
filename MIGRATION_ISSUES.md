
## Issue 18: monitor-service Docker build copies wrong package.json

**Symptom**: `npm ci` fails with "no package-lock.json found" despite lockfile
existing in `services/monitor-service/`. Build context shows only 830B
transferred — the lockfile is not reaching the build layer.

**Cause**: Two compounding problems. First, `COPY package*.json ./` with build
context `.` (repo root) copies the repo root `package.json`, not the
monitor-service one — so no lockfile is found. Second, tar extraction created
a spurious nested `services/monitor-service/monitor-service/` directory due to
`--strip-components` miscounting when the tarball had an extra path level.

**Fix**: Prefix all `COPY` instructions in the monitor-service Dockerfile with
`services/monitor-service/` since the build context is the repo root:

```dockerfile
COPY services/monitor-service/package*.json ./
COPY services/monitor-service/src/ ./src/
COPY services/monitor-service/public/ ./public/
```

Also remove the spurious nested directory:
```bash
rm -rf services/monitor-service/monitor-service
```

**Prevention**: When building a service from repo root context, every COPY path
must be relative to that root, not to the service directory.

## Issue 19: k3s control plane unusable on QNAP due to custom kernel iptables limitations — pivoted to Docker Swarm

**Symptom**: Following the original plan to run k3s on the QNAP NAS (S7), a
k3s server was deployed via a privileged Docker container with host
networking (`rancher/k3s:v1.28.8-k3s1`). The control plane came up
successfully — `kubectl get nodes` showed the node `Ready`, and the apiserver
responded to `kubectl get --raw=/healthz` with `ok`. However, CoreDNS never
reached `Ready`, looping on:

```
[WARNING] plugin/kubernetes: Kubernetes API connection failure:
Get "https://10.43.0.1:443/version": dial tcp 10.43.0.1:443: i/o timeout
[INFO] plugin/ready: Still waiting on: "kubernetes"
```

`metrics-server` and `local-path-provisioner` failed identically, both
panicking on the same `10.43.0.1:443: i/o timeout` when trying to load
configmaps via the in-cluster API.

**Root cause**: QNAP's QTS ships a custom kernel
(`5.10.60-qnap`) that is missing or has misconfigured `ip6tables` NAT support:

```
ip6tables v1.8.8 (legacy): can't initialize ip6tables table `nat':
Table does not exist (do you need to insmod?)
error creating chain "KUBE-KUBELET-CANARY"
```

This broke kube-proxy's iptables rules for the in-cluster `10.43.0.1:443`
ClusterIP (the Kubernetes API service). The apiserver itself was reachable
from the host (`127.0.0.1:6443`) and via kubectl, but pods on the flannel pod
network (`10.42.0.0/16`) could not reach the ClusterIP — so any pod that
needs to talk to the Kubernetes API on startup (CoreDNS, metrics-server,
local-path-provisioner) failed.

**Attempts made** (in order, each tested and ruled out):
1. Default flannel (vxlan) — `10.43.0.1:443` timeout, confirmed via `wget`/raw
   API checks and `/proc/net/tcp` socket inspection.
2. `--bind-address 0.0.0.0` / `--kube-apiserver-arg=bind-address=0.0.0.0` —
   apiserver remained bound to `127.0.0.1:6443` only
   (`0100007F:192C` in `/proc/net/tcp`); KUBE-SEP rules pointed at the node IP
   (`192.168.0.38:6443`) where nothing listened.
3. Manual `iptables -t nat` DNAT redirect from `192.168.0.38:6443` →
   `127.0.0.1:6443` — worked intermittently (pods briefly went `1/1 Running`
   after configmaps loaded successfully) but settled back into
   `CrashLoopBackOff` within ~30s, suggesting a secondary/related iptables
   issue beyond the single redirect.
4. `--flannel-backend=host-gw` (avoids vxlan encapsulation entirely, uses
   direct routes since QNAP and pods share an L2 network) — etcd-persisted
   pod/flannel state from the previous attempts meant the same stale pod was
   reused; the underlying `10.43.0.1` routing issue was not retested cleanly
   in isolation due to time constraints.

**Decision**: After exceeding the 10-attempt threshold across four distinct
mitigation strategies, k3s-on-QNAP was deferred. **Docker Swarm** was adopted
for the immediate microservices deployment (S8 onward), since:

- Swarm is built into the Docker Engine already running on QNAP — no nested
  privileged containers, no custom CNI, no second iptables/netfilter layer.
- Swarm's overlay network provides built-in DNS-based service discovery,
  which was verified working immediately and without any workarounds:

  ```
  docker exec <auth-service container> wget -qO- http://notification-service:3001/health
  → {"status":"ok","service":"notification-service",...}
  ```

  This is the exact capability (in-cluster service-name resolution) that
  CoreDNS could not provide on k3s/QNAP — Swarm solved it natively on the
  first attempt.
- `docker stack deploy -c docker-stack.yml biggshots` brought up all 7
  microservices plus a fresh Postgres (32-table schema applied cleanly via
  `docker-entrypoint-initdb.d`) and Redis, all reaching `1/1` replicas.

**Future plan**: Kubernetes remains the target architecture for the portfolio
narrative (manifests, kind validation already completed in S5, and the
EKS/Terraform plan for S15-17 is unaffected — standard Linux kernels on EKS
nodes do not have QNAP's `ip6tables` limitation). A dedicated Ubuntu Server VM
(with a standby/backup VM for resilience) is planned as the future home for
k3s; at that point the Swarm deployment documented here would be migrated to
k8s, itself a further documented migration exercise. The QNAP would then
shift to a storage/backup role (NFS-backed PersistentVolumes, DB backups,
DR target) — separating compute from storage, a realistic production pattern.

**Prevention / general lesson**: when self-hosting Kubernetes on consumer NAS
hardware, verify `ip6tables`/`iptables` NAT table availability
(`iptables -t nat -L` inside a privileged container, checking for "Table does
not exist" errors) *before* investing time in cluster setup. NAS vendors'
custom kernels frequently strip netfilter modules that standard distro
kernels include.

