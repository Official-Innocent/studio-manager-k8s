// services/auth-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const loginAttemptsTotal = new client.Counter({
  name: 'auth_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['actor', 'result'],
  registers: [register],
});

const passwordResetsTotal = new client.Counter({
  name: 'auth_password_resets_total',
  help: 'Total password reset requests issued',
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  loginAttemptsTotal,
  passwordResetsTotal,
};
