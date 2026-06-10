// shared/metrics.js
// Drop this into any service: const { metricsMiddleware, register, counters } = require('../../shared/metrics')
// Each service may also register its own gauges on top of these defaults.

const client = require('prom-client');

// Use a fresh registry per service process (avoids conflicts when testing locally)
const register = new client.Registry();

// Default Node.js process metrics (memory, CPU, event loop lag, GC)
client.collectDefaultMetrics({ register });

// ── HTTP instrumentation ──────────────────────────────────────────────────────

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

// ── Middleware ────────────────────────────────────────────────────────────────

function metricsMiddleware(req, res, next) {
  // Skip the /metrics endpoint itself
  if (req.path === '/metrics') return next();

  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    // Normalise dynamic segments so /bookings/123 and /bookings/456
    // don't create unbounded label cardinality
    const route = normaliseRoute(req.route ? req.route.path : req.path);
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };
    httpRequestsTotal.inc(labels);
    end(labels);
  });

  next();
}

function normaliseRoute(path) {
  // Replace UUIDs and numeric IDs with a placeholder
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

// ── /metrics endpoint handler ─────────────────────────────────────────────────

async function metricsHandler(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
}

module.exports = {
  register,
  client,
  metricsMiddleware,
  metricsHandler,
  // Expose the core counters so services can increment them directly
  // if they want (e.g. emails_sent from within a handler, not just HTTP)
  counters: {
    httpRequestsTotal,
    httpRequestDuration,
  },
};
