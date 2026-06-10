// services/monitor-service/src/panels/systemHealth.js
// Queries Prometheus HTTP API for per-service health signals.

'use strict';

const fetch = require('node-fetch');

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus-operated.monitoring.svc.cluster.local:9090';

const SERVICES = [
  'notification-service',
  'gallery-service',
  'scheduler-service',
  'booking-service',
  'portal-service',
];

async function promQuery(query) {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { timeout: 5000 });
  if (!res.ok) throw new Error(`Prometheus returned ${res.status}`);
  const json = await res.json();
  return json.data.result;
}

async function collectSystemHealth() {
  const services = await Promise.all(SERVICES.map(async (name) => {
    // up{job="<name>"} — 1 if Prometheus can scrape it, 0 otherwise
    const upResult = await promQuery(`up{job="${name}"}`).catch(() => []);
    const up = upResult[0]?.value?.[1] === '1';

    // Request rate over last 5 minutes
    const rateResult = await promQuery(
      `sum(rate(http_requests_total{job="${name}"}[5m]))`
    ).catch(() => []);
    const requestRate = parseFloat(rateResult[0]?.value?.[1] || 0).toFixed(3);

    // p99 latency
    const p99Result = await promQuery(
      `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="${name}"}[5m])) by (le))`
    ).catch(() => []);
    const p99Ms = Math.round(parseFloat(p99Result[0]?.value?.[1] || 0) * 1000);

    // Error rate (5xx) over last 5 minutes
    const errResult = await promQuery(
      `sum(rate(http_requests_total{job="${name}",status_code=~"5.."}[5m]))`
    ).catch(() => []);
    const errorRate = parseFloat(errResult[0]?.value?.[1] || 0).toFixed(4);

    return { name, up, requestRate, p99Ms, errorRate };
  }));

  // Scheduler-specific: jobs registered + last run timestamps
  const jobsRegistered = await promQuery('scheduler_jobs_registered').catch(() => []);
  const jobsRunRate = await promQuery('sum(rate(scheduler_jobs_run_total[5m])) by (job_name)').catch(() => []);

  // Redis: query process_resident_memory_bytes from notification-service as a proxy
  // (Redis itself isn't instrumented — this is a reasonable signal)
  const redisProxyMem = await promQuery(
    `process_resident_memory_bytes{job="notification-service"}`
  ).catch(() => []);

  return {
    collectedAt: new Date().toISOString(),
    services,
    scheduler: {
      jobsRegistered: parseInt(jobsRegistered[0]?.value?.[1] || 0, 10),
      jobsRunRate: jobsRunRate.map(r => ({
        jobName: r.metric.job_name,
        rate: parseFloat(r.value[1]).toFixed(4),
      })),
    },
    redis: {
      proxyMemoryBytes: parseInt(redisProxyMem[0]?.value?.[1] || 0, 10),
    },
  };
}

module.exports = { collectSystemHealth };
