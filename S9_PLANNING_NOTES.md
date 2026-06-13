# S9 Planning Note: Frontend Extraction & API Gap Analysis

**Status as of S8 completion**: All 7 microservices (auth, booking, gallery,
notification, portal, scheduler, monitor) are deployed via Docker Swarm and
internally healthy, with a fresh `biggshots_prod` database. This note covers
the discovery made at the start of S9 when planning the DNS cutover of
`biggshotsmedia.com` from the monolith to the Swarm stack.

## Finding: the frontend was never extracted

The microservices extraction (S2-S8) was API-layer only. None of the 7
services serve any HTML/CSS/JS. The entire frontend — public website, admin
dashboard, client portal, CRM pipeline, documents area, and 6 SEO landing
pages — exists only in the monolith's `public/` directory:

```
public/index.html                              (1193 lines, public site)
public/admin/index.html                        (3175 lines, admin dashboard)
public/portal/index.html                       (1127 lines, client portal)
public/pipeline/index.html                     (915 lines, CRM/project board)
public/documents/index.html                    (649 lines, contracts/questionnaires)
public/{wedding,portrait,maternity,headshot,event,bespoke}-photographer-northampton/
                                                (86 lines each, SEO landing pages)
public/assets/                                 (34MB, portfolio images etc.)
```

All JavaScript is inline within these HTML files (no separate `.js` files).
A literal DNS cutover at this point would serve no frontend at all.

## API call inventory vs. microservice coverage

Every `fetch`/`api()` call across all 11 HTML files was extracted and
cross-referenced against the 7 microservices' actual routes.

### Covered (microservice exists, possibly with path differences)

| Frontend call                          | Microservice route                          |
|-----------------------------------------|----------------------------------------------|
| `/api/auth/admin/me`                    | auth-service `/admin/me`                     |
| `/api/bookings*`                        | booking-service `/bookings`                  |
| `/api/invoices*`                        | booking-service `/invoices`                  |
| `/api/contracts*`                       | booking-service `/contracts`                 |
| `/api/galleries*`                       | gallery-service `/galleries`                 |
| `/api/photos*`                          | gallery-service `/photos`                    |
| `/api/portal/login`, `/logout`, `/me`   | portal-service `/portal`                     |

### Moved between services (path mismatch — needs nginx remap or frontend update)

| Frontend call                                  | Now lives in                                  |
|--------------------------------------------------|------------------------------------------------|
| `/api/portal/admin/create-client-account`        | auth-service `/admin/create-client-account`   |
| `/api/portal/admin/reset-client-password`        | auth-service `/admin/reset-client-password`   |
| `/api/portal/forgot-password`                    | auth-service `/forgot-password`               |
| `/api/portal/reset-password`                     | auth-service `/reset-password`                |
| `/api/auth/admin/verify-password`                | not found in auth-service — needs checking    |

### Missing entirely — no microservice covers these

| Frontend call                | Feature area                                  | Used by                  |
|--------------------------------|--------------------------------------------------|----------------------------|
| `/api/portfolio*`              | Public portfolio gallery (upload/reorder/CMS)    | public site, admin        |
| `/api/site-content*`           | Homepage CMS content                             | public site               |
| `/api/clients*`                 | Client CRUD (admin)                              | admin, pipeline           |
| `/api/projects*`                | Project pipeline / CRM board                     | pipeline, documents        |
| `/api/payment-plans*`           | Payment plans & installments                     | admin, pipeline             |
| `/api/promotions*`              | Promotions / flash sale banners                  | admin, public portal       |
| `/api/tasks*`                   | Admin task list                                  | admin                       |
| `/api/calendar/sync`            | Google Calendar sync trigger                     | admin                       |
| `/api/questionnaires*`          | Client questionnaires                            | documents                   |
| `/api/settings/*-templates`     | Contract & questionnaire templates               | documents                   |
| `/api/loyalty`                  | Client loyalty programme                         | portal                       |

This corresponds to entire route files in the monolith
(`clients.js`, `projects.js`, `payment-plans.js`, `promotions.js`,
`questionnaires.js`, `settings.js`, parts of `portal.js` and `bookings.js`)
that have no microservice equivalent yet.

## Revised plan

A literal "S9: ingress + DNS cutover" is not yet achievable. The session is
split into sub-stages:

- **S9a** — Build the missing backend coverage. Likely as one or two new
  services (e.g. `content-service` for portfolio/site-content/promotions,
  and `crm-service` for clients/projects/payment-plans/tasks/questionnaires/
  templates/loyalty/calendar-sync), or by extending existing services where
  the domain fits naturally (e.g. loyalty → portal-service, calendar-sync →
  scheduler-service).
- **S9b** — Copy the frontend (`public/`) from the monolith into
  `studio-manager-k8s` as a new `frontend/` directory. Build an nginx
  layer that serves these static files and proxies `/api/*` to the correct
  microservice, remapping the moved paths identified above.
- **S9c** — TLS (Let's Encrypt/cert-manager equivalent for Swarm) and the
  actual DNS cutover of `biggshotsmedia.com`, with the monolith repurposed
  as `monolith-demo.biggshotsmedia.com`.

No files have been copied yet — copying the frontend before the missing
backend coverage and routing layer exist would not result in a working site,
so this was deferred pending S9a.
