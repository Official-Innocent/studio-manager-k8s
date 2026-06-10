# Stage 8 — new MIGRATION_ISSUES entries

## Issue 13: prom-client registry collision on hot-reload

**Symptom**: `Error: A metric ... has already been registered` when nodemon
restarts a service.

**Cause**: prom-client uses a default global registry. If the module is
re-required without a full process restart (e.g. test harness, nodemon with
full-module-cache-clear disabled), counters are re-registered against the same
singleton.

**Fix**: Create a fresh `Registry` per service process and pass it explicitly
to every metric constructor:

```js
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const myCounter = new client.Counter({ ..., registers: [register] });
```

This is already done in `shared/metrics.js`. No action needed unless you add
metrics outside that file.

---

## Issue 14: ServiceMonitor not picked up by Prometheus

**Symptom**: Services show as `unknown` targets in Prometheus UI despite
`ServiceMonitor` resources being applied.

**Root cause**: Prometheus Operator uses a `serviceMonitorSelector` to decide
which `ServiceMonitor` resources it watches. The kube-prometheus-stack Helm
chart sets this to `{ matchLabels: { release: prometheus } }` by default.

**Fix**: Ensure every `ServiceMonitor` has `labels: release: prometheus` in its
metadata. This is already in `k8s/service-monitors/service-monitors.yaml`.

Verify with:
```bash
kubectl get servicemonitor -n biggshots
kubectl describe prometheus -n monitoring | grep -A5 serviceMonitorSelector
```

---

## Issue 15: SSE stream buffered by nginx / ingress

**Symptom**: Dashboard receives all events in a single burst rather than
incrementally; the page appears frozen for 30s then updates all at once.

**Root cause**: Nginx (and many ingress controllers) buffer proxy responses by
default. SSE requires unbuffered streaming.

**Fix**: Add `X-Accel-Buffering: no` header in the SSE handler (already done in
`monitor-service/src/index.js`). If using an ingress, also add the annotation:

```yaml
nginx.ingress.kubernetes.io/proxy-buffering: "off"
```

---

## Issue 16: EventSource reconnect loop on pod restart

**Symptom**: Browser console shows repeated `EventSource failed to connect`
then `connecting…` cycling.

**Root cause**: When the monitor-service pod restarts, the browser's
`EventSource` fires `onerror` and the default browser behaviour is to
reconnect every 3 seconds indefinitely. This is fine, but without a visual
indicator users assume the page is broken.

**Fix**: The dashboard's `onerror` handler sets the connection dot to red and
shows "reconnecting…", then calls `connect()` again after 5s. This is already
implemented in `public/index.html`.
