'use strict';
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const portfolioUploadsTotal = new client.Counter({
  name: 'content_portfolio_uploads_total',
  help: 'Total portfolio photos uploaded',
  registers: [register],
});

module.exports = { metricsMiddleware, metricsHandler, portfolioUploadsTotal };
