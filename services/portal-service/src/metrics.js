// services/portal-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const portalLoginsTotal = new client.Counter({
  name: 'portal_logins_total',
  help: 'Total successful client portal logins',
  registers: [register],
});

const portalActiveSessionsGauge = new client.Gauge({
  name: 'portal_active_sessions',
  help: 'Number of currently active portal sessions (Redis-backed)',
  registers: [register],
});

const addonOrdersTotal = new client.Counter({
  name: 'portal_addon_orders_total',
  help: 'Total add-on orders placed through the client portal',
  labelNames: ['addon_type'], // prints, canvas, photobook
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  portalLoginsTotal,
  portalActiveSessionsGauge,
  addonOrdersTotal,
};
