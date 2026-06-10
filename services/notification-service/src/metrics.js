// services/notification-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

// ── Service-specific metrics ──────────────────────────────────────────────────

const emailsSentTotal = new client.Counter({
  name: 'emails_sent_total',
  help: 'Total emails sent by the notification service',
  labelNames: ['template', 'status'], // status: success | error
  registers: [register],
});

const emailQueueDepth = new client.Gauge({
  name: 'email_queue_depth',
  help: 'Number of email events waiting in Redis queue',
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  emailsSentTotal,
  emailQueueDepth,
};
