# Bigg Shots Media — Microservices & Kubernetes

This repository is **Phase 2** of the Bigg Shots Media platform.

## Context

Phase 1 (monolith) is at: https://github.com/Official-Innocent/studio-manager

The monolith was built intentionally to document real production limitations.
This repo solves those documented problems with a microservices architecture on Kubernetes.

## Architecture

- **notification-service** — all email sending, event-driven
- **gallery-service** — galleries, photos, image processing
- **booking-service** — bookings, contracts, invoices
- **portal-service** — client portal, auth, downloads
- **scheduler-service** — 13 automated jobs, individually isolated
- **auth-service** — admin authentication

## Infrastructure

- Local dev: kind (Kubernetes in Docker)
- Production: k3s on self-hosted QNAP NAS
- Optional: AWS EKS

## Status

- [x] Stage 0 — Repo setup
- [x] Stage 1 — Notification service (complete — REST API + Redis pub/sub verified, emails delivered)
- [x] Stage 2 — Gallery service (complete — health endpoint verified, Redis event publisher, Docker image built)
- [ ] Stage 3 — Scheduler service
- [ ] Stage 4 — Booking + Portal services
- [ ] Stage 5 — Kubernetes manifests + kind
- [ ] Stage 6 — k3s on QNAP
- [ ] Stage 7 — Prometheus + Grafana
- [ ] Stage 8 — BiggShots Monitor v2
- [ ] Stage 9 — Benchmarking + docs
- [ ] Stage 10 — AWS EKS (optional)


## Related

- Monolith repo: https://github.com/Official-Innocent/studio-manager
- Live site: https://biggshotsmedia.com
- Architecture doc: see monolith repo ARCHITECTURE.md
