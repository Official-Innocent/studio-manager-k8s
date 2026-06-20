# QNAP host-level nginx (TLS termination)

This is the standalone `biggshots-nginx` container's config — it runs
**outside** Docker Swarm (plain `docker run`, not a stack service), holds
ports 80/443 on the QNAP host, terminates TLS via Let's Encrypt certs, and
reverse-proxies to the Swarm stacks' published ports:

- `biggshotsmedia.com` (production)        -> `172.29.0.1:8081` (biggshots_frontend)
- `k3-demo.biggshotsmedia.com` (demo)       -> `172.29.0.1:8082` (biggshots-demo_frontend)

Source of truth on QNAP:
`/share/CACHEDEV1_DATA/Multimedia/biggshots/app/bigg-shots-backend/docker/nginx.conf`

This file was previously **not version-controlled** — it lived only on QNAP's
disk. That gap directly contributed to a production outage (see below), since
nobody could review or diff changes to it. It's now mirrored here for
visibility; QNAP's copy remains the live source of truth until a proper
deploy pipeline is set up for it.

## Incident — 2026-06-20

`biggshots-nginx` had been crash-looping for ~6 hours due to a stale
`monolith-demo.biggshotsmedia.com` server block referencing a hostname
(`biggshots-monitor`) that no longer existed post-microservices-migration.
Because nginx fails to start entirely if any server block has an unresolvable
upstream, this took down the **whole** container — including the healthy
production and k3-demo server blocks — with no error/alerting to surface it.

Compounding issue: all Swarm services had also scaled to 0 and needed
`docker service update --force` (not just `scale=1`) to recover from a stuck
scheduler state.

Fix: removed the broken `monolith-demo` server blocks, added a working
`/monitor/` route to production, and rebuilt+redeployed the frontend image
(the running image was stale — a known nginx fix from an earlier session had
been committed to source but never actually rebuilt into the live image).

**Action items:**
- [ ] Add uptime monitoring/alerting for `biggshots-nginx` specifically
      (it sits outside Swarm's self-healing and went undetected for 6 hours)
- [ ] Formally decide whether to rebuild `monolith-demo` properly or retire it
- [ ] Consider a deploy step that always rebuilds+pushes the frontend image
      rather than relying on remembering to do so after nginx.conf edits
