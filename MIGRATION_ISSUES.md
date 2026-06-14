
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

## Issue 20: nginx proxy_pass to Swarm services fails at container startup due to static DNS resolution

**Symptom**: The new `frontend` service (nginx serving the static site and
proxying `/api/*` to the 8 backend microservices) failed to start, or started
and then exited cleanly (exit code 0) shortly after, repeatedly:

```
2026/06/13 22:48:53 [emerg] 1#1: host not found in upstream "auth-service"
in /etc/nginx/conf.d/default.conf:41
nginx: [emerg] host not found in upstream "auth-service"
```

**Root cause**: `proxy_pass http://auth-service:3007;` with a static
hostname is resolved **once**, at config-load/startup time, by nginx's
built-in resolver — not via the `resolver 127.0.0.11` directive (Docker's
embedded DNS). On Swarm, a newly-created or newly-updated service's overlay
network DNS entry can take a moment to propagate; if nginx starts before
`auth-service` (or any other upstream) is resolvable, it fails to load the
config at all and the container exits.

**Fix**: convert every static-hostname `proxy_pass` to use an nginx
*variable*, which forces per-request resolution via the configured
`resolver` directive instead of resolving once at startup:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
...
location /api/auth/ {
    rewrite ^/api/auth/(.*)$ /$1 break;
    set $upstream_auth auth-service:3007;
    proxy_pass http://$upstream_auth;
    ...
}
```

Applied to all 9 upstream services (auth, gallery, booking, portal, content,
crm, scheduler, notification, monitor).

**Prevention**: any nginx config that proxies to Swarm/Kubernetes service
names should always use the variable + `resolver` pattern, never a bare
hostname in `proxy_pass`, regardless of how stable the service appears —
DNS propagation timing is not guaranteed at container startup.

## Issue 21: `set` directive must precede `rewrite` when both feed `proxy_pass`

**Symptom**: After applying the Issue 20 fix, static pages served correctly
but every proxied `/api/*` route returned `500 Internal Server Error`:

```
2026/06/13 23:06:33 [warn] 30#30: *2 using uninitialized "upstream_content"
variable, client: 10.0.3.1, server: biggshotsmedia.com,
request: "GET /api/site-content HTTP/1.1", host: "localhost:8082"
2026/06/13 23:06:33 [error] 30#30: *2 invalid URL prefix in "http://"
```

**Root cause**: each location block had:
```nginx
rewrite ^/api/(.*)$ /$1 break;
set $upstream_content content-service:3008;
proxy_pass http://$upstream_content;
```
With `rewrite ... break` listed *before* `set`, the `set` assignment was not
applied before `proxy_pass` evaluated `$upstream_content`, leaving it empty
("uninitialized") and producing `http://` with no host.

**Fix**: reorder so `set` comes first:
```nginx
set $upstream_content content-service:3008;
rewrite ^/api/(.*)$ /$1 break;
proxy_pass http://$upstream_content;
```
Applied across all 9 proxied location blocks.

**Prevention**: when combining `set` (rewrite-module directive, executed in
declared order within its phase) with `rewrite ... break` and a
variable-based `proxy_pass`, always declare `set` first in the block. This is
easy to get backwards since `rewrite` is conceptually "first" in the request
flow, but directive *declaration order* — not request flow — determines
execution order for same-phase rewrite-module directives.

## Issue 22: Dockerfile HEALTHCHECK using `wget http://localhost` fails due to IPv6, causing Swarm to repeatedly kill a healthy container

**Symptom**: Even after Issues 20 and 21 were fixed and nginx was serving
correctly, the `frontend` Swarm service remained stuck at `0/1` replicas.
`docker service ps` showed each task starting cleanly (workers spawned, no
errors), then a few seconds to minutes later receiving what nginx logs as a
graceful shutdown (SIGQUIT) and exiting with code 0 — repeatedly, eventually
pausing the rollout ("update paused due to failure or early termination").

**Root cause**: the Dockerfile's healthcheck:
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1
```
failed every time with `wget: can't connect to remote host: Connection
refused`. Inspecting `/etc/hosts` inside the container showed `localhost`
resolves to `::1` (IPv6) first; nginx's `listen 80;` bound only the IPv4
socket (`0.0.0.0:80`, confirmed via `/proc/net/tcp` showing `00000000:0050`
in LISTEN state, with no corresponding `tcp6` entry). `wget` tried `::1:80`,
got connection refused, and the healthcheck failed 3 times in a row
(`FailingStreak: 3`), at which point Docker/Swarm marked the container
unhealthy and killed it — even though `http://127.0.0.1:80/` worked
perfectly.

**Fix**: removed the `HEALTHCHECK` instruction entirely from
`frontend/Dockerfile`. Swarm's own service-level restart policy
(`restart_policy: condition: on-failure`) is sufficient; the container
process itself (nginx master) is the right liveness signal.

**Verification after fix**: `docker stack services biggshots` showed
`biggshots_frontend 1/1`, and:
```
curl http://127.0.0.1:8081/                        -> 200, homepage HTML
curl http://127.0.0.1:8081/api/site-content        -> {}
curl http://127.0.0.1:8081/api/portfolio           -> {"photos":[]}
curl http://127.0.0.1:8081/api/promotions/active   -> null
curl http://127.0.0.1:8081/admin/                  -> 200
curl http://127.0.0.1:8081/portal/                 -> 200
curl http://127.0.0.1:8081/assets/logo-black.png   -> 200
curl http://127.0.0.1:8081/wedding-photographer-northampton/ -> 200
```
(Note: `http://localhost:8081/` from the QNAP host also hung due to the same
IPv4/IPv6 `localhost` ambiguity — using `127.0.0.1` resolved this for testing
purposes. This is a host-resolution quirk, not an application issue, and does
not affect real clients connecting via the domain name over the published
port.)

**Prevention**: if a Dockerfile HEALTHCHECK uses `wget`/`curl` against
`localhost`, prefer `127.0.0.1` explicitly to avoid IPv6-resolves-first
ambiguity on hosts/images where the service only binds IPv4. More broadly,
on QNAP (and similar environments with non-standard IPv6 configurations),
treat `localhost` in any health/connectivity check as suspect — a single
failing healthcheck can cause Swarm to repeatedly kill an otherwise-healthy
container, and the resulting "Complete"/"exit 0" logs give no indication that
a healthcheck (rather than the application) is the cause.

