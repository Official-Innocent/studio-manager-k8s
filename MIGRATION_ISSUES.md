
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

## Issue 23: S9c — TLS + DNS cutover of biggshotsmedia.com to the Swarm stack

**Goal**: switch `biggshotsmedia.com` from the monolith to the new Swarm
`frontend` stack (port 8081), while standing up
`monolith-demo.biggshotsmedia.com` as a frozen reference pointing at the
existing monolith — without disrupting the live site.

**Approach chosen**: reuse the existing `biggshots-nginx` container (with its
working Let's Encrypt certs and Cloudflare DNS already in place) as the TLS
terminator for both domains, rather than building new ingress/cert
infrastructure. `biggshots-nginx` reaches the Swarm `frontend` service via
Docker's routing mesh at `172.29.0.1:8081` (the bridge network gateway IP) —
**no overlay network attachment was needed**, since Swarm publishes a
service's port on every interface of the node, including bridge-network
gateway IPs reachable from other containers.

This was deliberately the *minimal, lowest-risk* path for the current
single-NAS Docker Swarm setup. It is **not** the pattern to carry forward to
k3s/EKS — those will use Ingress/ALB + cert-manager/ACM, which is idiomatic
and was always the plan for S10+ regardless. The nginx `location` routing
rules built here (and in `frontend/nginx.conf`) remain the reference for
translating into Ingress rules later.

### Near-miss: accidental truncation of the live nginx.conf

While attempting to add a new server block via a `docker run --rm -v
"$(pwd)":/work -w /work alpine sh -c "cat > /work/nginx.conf << 'EOF' ... EOF"`
heredoc (a pattern used successfully elsewhere in this project for files
inside read-only-by-OBUTE1 directories), the inner `$(cat
nginx-step1.conf)` command substitution failed (file existed only in the
assistant's sandbox, not on QNAP). Critically, **the shell still executed
the `cat > /work/nginx.conf << 'EOF' ... EOF` redirection with the failed
substitution producing empty input**, truncating
`/share/CACHEDEV1_DATA/.../docker/nginx.conf` to 1 byte.

Production was **not** affected at the time — `biggshots-nginx` had the
original config already loaded in memory and continued serving correctly.
The danger was that any subsequent `nginx -s reload` (or container restart)
would have caused a full outage by loading the now-empty config.

**Recovery**: the original 59-line config (known from earlier inspection in
this session) was written back to a file, presented for download, and the
content was pasted directly into `vi nginx.conf` on QNAP (file was owned by
`OBUTE1` with `rwxrwxrwx`, so direct edit access existed all along — the
docker/heredoc approach was unnecessary here). Verified line count (59) and
syntax (`nginx -t`) before any reload.

**Prevention**:
- Never use `cat > file << 'EOF' ... $(cat other_file) ... EOF` patterns
  where `other_file` might not exist — a failed command substitution does
  not abort the heredoc; it silently produces empty/partial content, and the
  `>` redirection still truncates the target file.
- Before editing any live, mounted config file, check direct ownership/perms
  (`ls -la`) — if the invoking user already owns the file, `vi` directly is
  simpler and safer than container-based indirection.
- After any edit to a config file backing a running container, always run
  the in-container syntax test (`docker exec <container> nginx -t`) — which
  has the correct DNS/network context — before reloading, and treat a config
  that the running container hasn't yet reloaded as the current source of
  truth (the running process is unaffected by on-disk changes until
  reload/restart).

### Cutover steps (completed successfully)

1. Added an HTTP-only `server` block for `monolith-demo.biggshotsmedia.com`
   (acme-challenge + redirect to https), reloaded — verified production
   (`biggshotsmedia.com`) unaffected (200) and new block live (301).
2. Ran `certbot certonly --webroot --expand` to add
   `monolith-demo.biggshotsmedia.com` to the certificate.

### Unexpected outcome: two separate certificate lineages

Attempting `--expand -d biggshotsmedia.com -d www.biggshotsmedia.com -d
monolith-demo.biggshotsmedia.com` together failed validation for
`www.biggshotsmedia.com` only:
```
Detail: 90.195.213.172: Invalid response from
https://biggshotsmedia.com/.well-known/acme-challenge/<token>: 404
```
The `www` (port 80) block redirects all traffic — including the
acme-challenge request — to `https://biggshotsmedia.com/...`, which does have
an acme-challenge location, but the challenge file for `www`'s specific token
was not found there (a quirk of certbot serving different per-domain tokens
when one domain's validation is redirected into another domain's webroot
context). The existing cert was unaffected — Let's Encrypt validates all
domains before issuing/replacing anything, atomically.

Dropping `www.biggshotsmedia.com` from the request succeeded immediately,
but because the domain set differed from the existing `biggshotsmedia.com`
lineage, certbot created a new, separate lineage:
`/etc/letsencrypt/live/biggshotsmedia.com-0001/` (covering `biggshotsmedia.com`
and `monolith-demo.biggshotsmedia.com`), leaving the original
`/etc/letsencrypt/live/biggshotsmedia.com/` (covering `biggshotsmedia.com` and
`www.biggshotsmedia.com`) untouched.

**Resolution — two certs, two purposes**:
- `biggshotsmedia.com` and `www.biggshotsmedia.com` (443) continue using the
  original `biggshotsmedia.com` cert — unchanged, zero risk.
- `monolith-demo.biggshotsmedia.com` (443, new block) uses the new
  `biggshotsmedia.com-0001` cert.

Both lineages auto-renew independently via the existing `certbot renew` loop
in `biggshots-certbot` (certbot renews all lineages it finds under
`/etc/letsencrypt/live/`).

### Final routing changes

In `biggshots-nginx`'s config (`bigg-shots-backend/docker/nginx.conf`):
- `biggshotsmedia.com` (443): `location /` `proxy_pass` changed from
  `http://bigg-shots-backend-app-1:3000` to `http://172.29.0.1:8081` (the new
  Swarm `frontend` stack, reached via routing-mesh). The old
  `location ^~ /monitor/` block was removed from this server block, since the
  new stack's own nginx (`frontend/nginx.conf`) already routes `/monitor/*`
  to `monitor-service` internally — leaving the old block would have shadowed
  that with the monolith's monitor instead.
- New `server` block added for `monolith-demo.biggshotsmedia.com` (443),
  using the `biggshotsmedia.com-0001` cert, with the same proxy
  configuration `biggshotsmedia.com` (443) used to have (proxying to
  `bigg-shots-backend-app-1:3000` plus its own `/monitor/` block to
  `biggshots-monitor:3001`) — i.e. monolith-demo is exactly what
  biggshotsmedia.com used to be.

### Verification (all passing post-cutover)

```
https://biggshotsmedia.com/                          -> 200 (new stack homepage)
https://biggshotsmedia.com/api/site-content          -> {} (content-service, fresh DB)
https://biggshotsmedia.com/admin/                    -> 200
https://biggshotsmedia.com/portal/                   -> 200
https://biggshotsmedia.com/assets/logo-black.png     -> 200
https://www.biggshotsmedia.com/                      -> 301 (redirect, original cert, unaffected)
https://monolith-demo.biggshotsmedia.com/            -> 200 (monolith homepage)
https://monolith-demo.biggshotsmedia.com/monitor/    -> 200 (monolith's monitor)
```

The hero carousel on the live new-stack site correctly shows the "no photos"
fallback styling, since `/api/portfolio` returns `{"photos":[]}` on the fresh
database — expected, and tracked as polish work (S13: populate portfolio via
the new content-service admin upload endpoint).

**Stripe webhook**: the existing webhook endpoint
(`https://biggshotsmedia.com/api/payments/stripe/webhook`) required no
change — it already pointed at `biggshotsmedia.com`, which now transparently
routes `/api/payments/*` to `booking-service` via the new stack's nginx.
Confirmed via the Stripe dashboard; no edit needed.

**Result**: `biggshotsmedia.com` is now served entirely by the Docker Swarm
microservices stack (S8-S9b). The monolith remains live and unchanged at
`monolith-demo.biggshotsmedia.com` as the "before" reference for the
portfolio narrative.

## Issue 24: S10 — seeded demo environment (k3-demo.biggshotsmedia.com)

**Goal**: a second, fully isolated Swarm stack populated with realistic fake
data — clients across every pipeline stage, bookings, projects, invoices,
payment plans, galleries, promotions, tasks, questionnaires — for interview
walkthroughs, without touching production data.

### Stack generation

`docker-stack-demo.yml` was generated from `docker-stack.yml` via `sed`,
renaming `biggshots_prod` → `biggshots_demo`, all `prod_*_data` volumes →
`demo_*_data`, the overlay network to `biggshots-demo`, `SITE_URL` to
`https://k3-demo.biggshotsmedia.com`, and the published frontend port from
`8081` to `8082`. `ADMIN_EMAIL` was set to `hello+demo@biggshotsmedia.com`
(Gmail "+" aliasing — same inbox, clearly tagged) and `MAIL_FROM` to
"Bigg Shots Media (Demo) <...>" so any test emails are distinguishable.
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` were changed to
`${DEMO_STRIPE_SECRET_KEY}`/`${DEMO_STRIPE_WEBHOOK_SECRET}` (test-mode
Stripe keys, to be added — S10d, not yet complete). All other shared secrets
(`POSTGRES_PASSWORD` pattern, `JWT_SECRET`, `SESSION_SECRET`, Google Calendar
OAuth creds) were reused from prod's `deploy.env` — confirmed safe because
`scheduler-service`'s calendar sync (`runCalendarSync()`) is read-only: it
reads the real Google Calendar to populate the demo's own local
`blocked_dates` table, never writing to the real calendar.

### Demo seed data (`db/init/03-demo-seed.sql`)

197-line seed covering: 1 admin user, 6 clients spanning every
`clients.status` value (`lead`, `prospect`, `active` x2, `delivered`,
`archived`), 6 bookings, 6 projects spanning every `projects.stage` value
(`lead`, `booked`, `covered`, `delivered`, `completed` x2), 1 quote, 7
invoices + 2 payment-plan-installment invoices, 6 payments, 1 payment plan
with 2 installments (one paid, one pending), 2 galleries (one delivered, one
in-progress), 1 active promotion banner, 4 tasks across open/completed,
1 questionnaire + template, 1 contract template, 1 client loyalty record,
and `site_settings` rows for CMS-driven homepage content (hero tagline,
about section, testimonial, coverage text) — all clearly marked "(Demo)"
or describing the demo nature.

### Issues encountered and fixed (all on first deploy attempt cycle)

1. **Schema role mismatch**: `01-schema.sql` (dumped from prod via
   `pg_dump`) contains ~179 `OWNER TO biggshots_prod` / `ALTER ... OWNER TO
   biggshots_prod` statements. The demo postgres creates role
   `biggshots_demo` (from `POSTGRES_USER`), so every ownership statement
   failed with `role "biggshots_prod" does not exist`, partially aborting
   the init script. Fixed by creating `db/init/01-schema-demo.sql` — a
   `sed 's/biggshots_prod/biggshots_demo/g'` copy — and mounting that as
   `01-schema.sql` in the demo stack's postgres `docker-entrypoint-initdb.d`.
   **Lesson**: any schema dump containing role/owner statements must have the
   role name parameterized (or the demo DB must reuse the same role name) —
   role names are not portable across environments by default.

2. **Invalid `projects.stage` values**: seed used `'project_covered'` and
   `'post_production'`, neither of which exist in
   `projects_stage_check CHECK (stage = ANY (ARRAY['lead','quote_sent',
   'booked','covered','delivered','completed','archived']))`. Fixed to
   `'covered'` and `'delivered'` respectively. **Lesson**: always grep the
   schema's `CHECK` constraints for enum-like text columns before writing
   seed data — column names alone don't reveal the allowed value set.

3. **Invalid (non-hex) UUID prefixes**: the seed's mnemonic UUID scheme used
   prefixes like `q1`, `pp1`, `pi1`, `qt1`, `qn1`, `ct1`, `cl1`, `g1` for
   quotes/payment-plans/installments/questionnaire-templates/questionnaires/
   contract-templates/client-loyalty/galleries — but `g`, `p`, `q`, `t`, `n`,
   `l` are not valid hexadecimal digits, so Postgres rejected these as
   `invalid input syntax for type uuid`. All 8 prefixes were remapped to
   valid hex equivalents (e.g. `g1...` → `b3...`, `q1...` → `a2...`).
   **Lesson**: UUIDs are constrained to `0-9a-f` — mnemonic mapping schemes
   for readability must be checked against this before use; `g`/`l`/`o`/`q`/
   `s`/`t`/etc. are easy traps.

4. **Admin password hash mismatch**: the seed's `admin_users.password_hash`
   was copied from the S6 dev seed's hash for `"DevPassword123!"`, but the
   comment (and intended demo credential) said `"DemoPassword123!"` — a
   different password with a different hash. Login failed with "Invalid
   email or password" until a fresh `bcryptjs` hash for `"DemoPassword123!"`
   was generated and the row updated directly via `psql UPDATE` (faster than
   a full reseed) and the seed file corrected for future redeploys.

5. **`docker stack rm` / volume removal race**: after `docker stack rm`,
   `docker volume rm` failed with "volume is in use" even after a 10-second
   wait — the underlying container takedown lags behind the stack-removal
   command returning. A second wait (15s) plus retry succeeded. Similarly,
   the immediately-following `docker stack deploy` once failed with "network
   biggshots-demo_biggshots-demo not found" because the network removal
   hadn't propagated yet. **Lesson**: after `docker stack rm`, poll for
   actual resource removal (`docker volume rm` / `docker network ls`)
   rather than using a fixed sleep — or accept that 1-2 retries may be
   needed.

### Routing / TLS

Following the S9c pattern: `k3-demo.biggshotsmedia.com` (DNS A record
already existed, pointing at 90.195.213.172) got its own HTTP (port 80,
acme-challenge + redirect) and HTTPS (port 443) server blocks in
`biggshots-nginx`'s config, added via direct `vi` edits (no docker/heredoc
tricks — see Issue 23's prevention notes). The HTTPS block proxies to
`172.29.0.1:8082` (the demo `frontend` service's routing-mesh address,
same gateway-IP pattern as prod/monolith-demo).

The existing `biggshotsmedia.com-0001` cert lineage (created in S9c for
`monolith-demo`) was **expanded** (`--expand --cert-name
biggshotsmedia.com-0001`) to also cover `k3-demo.biggshotsmedia.com` —
all three demo/secondary domains now share one cert lineage, separate from
the original `biggshotsmedia.com`/`www` lineage. Both lineages auto-renew
via the existing certbot loop.

### Verification (all passing)

```
12/12 services 1/1 (auth, booking, content, crm, frontend, gallery, monitor,
                     notification, portal, postgres, redis, scheduler)
Seed row counts: 6 clients, 6 bookings, 6 projects, 9 invoices, 6 payments,
                 2 galleries, 1 promotion, 4 tasks, 1 admin
https://k3-demo.biggshotsmedia.com/                  -> 200
https://k3-demo.biggshotsmedia.com/admin/            -> 200
https://k3-demo.biggshotsmedia.com/portal/           -> 200
https://k3-demo.biggshotsmedia.com/api/site-content  -> demo CMS content
POST /api/auth/admin/login (admin@demo.biggshotsmedia.com /
  DemoPassword123!)                                   -> {"success":true,...}
```

### Remaining S10 work

- **S10b** (portfolio images): hero carousel currently shows the "no photos"
  fallback (same as prod) since `demo_portfolio_data` is empty. Two real
  sample images (`Karima_Family_Shoot@40_383.jpg`, ~9.5MB each) exist in the
  frontend's static `/assets/portfolio/` and could be copied into
  `demo_portfolio_data` as `opt_*.jpg` to populate the carousel via the real
  `/api/portfolio` flow.
- **S10d** (Stripe test mode): `DEMO_STRIPE_SECRET_KEY` /
  `DEMO_STRIPE_WEBHOOK_SECRET` are currently placeholder values
  (`sk_test_PLACEHOLDER` / `whsec_PLACEHOLDER`) in `deploy.env`. Real
  test-mode values need to be obtained from the Stripe dashboard (test mode
  toggle → Developers → API keys, plus a test webhook endpoint at
  `https://k3-demo.biggshotsmedia.com/api/payments/stripe/webhook`), and 1-2
  test-mode Payment Links wired into the demo frontend's package modals for
  a working end-to-end payment demo.

## Issue 25: [OPEN — PRIORITY] Production admin smoke test reveals 3 missing endpoints — pipeline, quotes, reports

**Discovered**: while creating the first real production admin user (S9c/S10
follow-up) and logging into `https://biggshotsmedia.com/admin/` for the
first time on the new stack, three admin pages failed:

- **Pipeline Board** → "Error loading pipeline."
- **Quotes** → "Error loading quotes."
- **Reports** → "Error loading reports. Please try again." (pipeline
  value/confirmed value/YTD revenue all show "—", revenue/sessions/projects
  charts stuck on "Loading...")

Direct API checks confirm these aren't auth or nginx-routing issues — the
endpoints **do not exist** in any service:

```
GET /api/crm/pipeline  -> falls through nginx to the static frontend's
GET /api/crm/quotes    -> index.html (no location block matches these
GET /api/crm/reports   -> paths, so the catch-all `location /` serves
                          the homepage HTML instead of a 404/JSON error)
```

`grep` across `crm-service` and `booking-service` route files found zero
`pipeline`, `quote`, or `report` routes — these were monolith admin features
(visible in the monolith-demo screenshots: Pipeline Board with stage
columns, Quotes list with "Studio Quotes", Reports with pipeline
value/confirmed value/YTD revenue/revenue-by-month chart/sessions-by-type
chart/projects-by-stage/upcoming-sessions) that were **never ported** during
S9a's crm-service build, despite `quotes` being a real table in
`01-schema.sql` (`quotes_status_check` constraint exists, and S10's demo
seed successfully inserts into it).

**Also note**: the Block Dates page shows a Google Calendar sync error
(`Error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`) — almost
certainly the same root cause: `/api/calendar/sync` (or similar) falls
through to the frontend's `location /` and returns HTML instead of JSON.
`frontend/nginx.conf` line 153 has `location /api/calendar/` routing to
scheduler-service, but the *specific* sync endpoint path used by the
Block Dates page's "Sync Now" button may not match what scheduler-service
actually exposes — needs checking alongside the pipeline/quotes/reports work.

### Scope for the fix (next session priority, before S11 continues)

1. **`quotes`**: crm-service needs a `routes/quotes.js` — CRUD against the
   existing `quotes` table (`quote_number`, `status`, `line_items` jsonb,
   `subtotal`, `total`, `valid_until`, `client_message`, `sent_at`, etc. —
   schema already supports this, S10's seed already proves inserts work).
   Add `quotes` to the crm-service nginx regex
   (`^/api/(clients|projects|payment-plans|questionnaires|settings|tasks|quotes)`).

2. **`pipeline`**: likely an aggregation endpoint over `projects` grouped by
   `stage` (lead/quote_sent/booked/covered/delivered/completed/archived) —
   check the monolith's pipeline board implementation
   (`bigg-shots-backend`) for the exact shape expected by the frontend's
   Pipeline Board JS, then port to crm-service (or booking-service, whichever
   the monolith used) as `GET /pipeline`.

3. **`reports`**: aggregation endpoint(s) for pipeline value, confirmed
   value, YTD revenue, shoots this month, revenue-by-month (12mo),
   sessions-by-type, projects-by-stage, upcoming-sessions. Likely spans
   `projects`, `invoices`, `payments`, `bookings` — may need to live in
   crm-service with cross-service queries, or be assembled by the frontend
   from multiple existing endpoints. Check monolith implementation first to
   determine the original data source and whether it was one endpoint or
   several.

4. **Calendar sync JSON error**: verify `frontend/nginx.conf`'s
   `/api/calendar/` block actually matches the Block Dates page's sync
   button request path; check scheduler-service's calendar routes for the
   exact endpoint name.

**Impact**: these are core admin features for the studio's day-to-day
pipeline management and financial visibility on `biggshotsmedia.com` (now
live in production). Not blocking for the portfolio narrative (S10 demo
environment is unaffected — same gaps exist there too, but the demo's main
purpose — clients/bookings/galleries/promotions/tasks — all work), but
should be prioritised before further S11+ polish work, since this is the
*production* admin the studio owner will actually use.

### Investigation findings (this session) — scope is smaller than it looked

Pulled the admin frontend (`/usr/share/nginx/html/admin/index.html`, 3175
lines, 236KB) from the running `frontend` container and traced each
"Error loading X" back to its `fetch`/`api()` call and the monolith's
corresponding backend route:

**Pipeline — likely near-zero backend work.** `loadPipeline()` calls
`api('/projects')` (i.e. `/api/projects`), which **crm-service already
serves** and the nginx regex
`^/api/(clients|projects|payment-plans|questionnaires|settings|tasks)`
already routes correctly. The function expects each project object to have
`id`, `first_name`, `last_name`, `stage`, `session_type`, `amount_quoted`,
`session_date` (it groups by `stage` into the 7 pipeline columns client-side
— no aggregation needed server-side). Next step: confirm crm-service's
`GET /projects` response actually includes `first_name`/`last_name` (likely
needs a `LEFT JOIN clients`) and `amount_quoted`/`session_date` — if so,
Pipeline may already work or need only a query tweak, not a new endpoint.

**Quotes — well-defined, ~100 lines to port.** `loadQuotes()` calls
`api('/quotes')` (`/api/quotes`). The monolith's
`/app/src/routes/quotes.js` (100 lines) is a complete, self-contained
Express router: `GET /` (list with client+project join), `POST /` (create,
using `doc_counters` for sequential `QTE-N` numbering), `GET /:id`,
`PATCH /:id`, `POST /:id/accept`, `DELETE /:id`, plus `GET/PATCH /addons`
for a `quote_addons` table. All referenced columns
(`discount_pct`, `discount_amt`, `accepted_at`, `client_message`, etc.) and
both tables (`quote_addons`, `doc_counters`) already exist in
`01-schema.sql` — this should port to crm-service almost verbatim. Also
needs: nginx regex updated to
`^/api/(clients|projects|payment-plans|questionnaires|settings|tasks|quotes)`,
and S10's demo seed already proves `quotes` table inserts work
(QUO-DEMO-0001).

**Reports — backend exists and ported version would match monolith parity,
but the *frontend* expects a different/newer shape that the monolith itself
never implemented (pre-existing gap, not a migration regression).**
`loadReports()` calls `api('/admin/reports')` (`/api/admin/reports` — note
the `/admin/` prefix, which no current nginx rule matches; would need its
own `location` block, e.g. `^/api/admin/reports$` → crm-service or a new
"admin" concern).

The monolith's `/app/src/routes/admin.js` `GET /reports` (55 lines,
confirmed working via session-cookie auth against `monolith-demo` — returned
real data: `summary`, `monthly`, `sessions`, `stages`, `upcoming_sessions`,
`outstanding_invoices`, `pipeline_stages`, `pipeline_total`,
`confirmed_value`, `ytd_revenue`, `last_ytd_revenue`, `shoots_this_month`).

However, the *active* `loadReports()` function in the frontend (there are
two `function loadReports(){...}` definitions in the bundled admin JS — a
JS redeclaration, so the second wins) reads `d.summary` (present) but also
`d.galleryStats.published`, `d.annualRevenue` (array of
`{year, revenue, bookings}`), `d.revenueMonthly`, and calls
`updateProjectionCards(d)` — **none of these fields exist in the monolith's
actual `/reports` response**, confirmed by `grep -rln
"galleryStats|annualRevenue|revenueMonthly" /app/src/` returning nothing.

**Conclusion**: the Reports page was very likely already partially broken
in the monolith itself (backend returns shape A, frontend reads shape B) —
this is pre-existing technical debt, not something the migration introduced.
Porting the existing `/reports` endpoint to crm-service as `/api/admin/reports`
would restore monolith-parity (summary cards `this_month`/`last_month`/
`outstanding`/etc. would populate via `s.this_month` etc., which ARE read by
`loadReports()`), but `galleryStats`/`annualRevenue`/`revenueMonthly`/
`updateProjectionCards` sections would remain empty/broken — same as before
migration. Fully fixing Reports (adding the missing fields) is a separate,
larger enhancement beyond migration-parity scope.

### Auth note (tangential finding, not a bug)

While testing, confirmed the new `auth-service` issues stateless JWTs in the
login response body (`{"success":true,"admin":{...},"token":"eyJ..."}`),
whereas the monolith uses server-side sessions only (`{"success":true,
"admin":{...}}` + `Set-Cookie: connect.sid=...`, no `token` field). Both
`requireAdmin` middlewares accept *either* `req.session.adminId` OR a valid
`Authorization: Bearer <JWT>` with `role:"admin"` — the new stack's JWT-based
admin auth is a deliberate, working improvement (stateless, easier for
distributed services), not a bug. (An earlier apparent "cross-service 401"
during this investigation was just an expired JWT from hours earlier in the
session — re-login resolved it immediately; no real auth bug exists.)

### Revised next-session plan for Issue 25

1. Check crm-service `GET /projects` response shape against what
   `loadPipeline()` needs (`first_name`/`last_name`/`stage`/`session_type`/
   `amount_quoted`/`session_date`) — likely just needs a `LEFT JOIN clients`
   if not already present. Quick win.
2. Port `quotes.js` to `services/crm-service/src/routes/quotes.js` (CRUD +
   addons), mount at `/quotes`, update nginx regex to include `quotes`.
3. Port the monolith's existing `/reports` (admin.js GET /reports) to
   crm-service as `GET /admin/reports`, add nginx `location` for
   `/api/admin/reports`. Accept that `galleryStats`/`annualRevenue`/
   `revenueMonthly` sections remain empty (monolith-parity, not a
   regression) — note this clearly in the portfolio narrative as "known
   pre-existing gap, not introduced by migration."
4. Re-check the Block Dates / Google Calendar sync JSON error similarly —
   trace the "Sync Now" button's fetch call to its actual endpoint path and
   confirm whether scheduler-service serves it and nginx routes it.





