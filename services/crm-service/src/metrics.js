'use strict';
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const stageTransitionsTotal = new client.Counter({
  name: 'crm_project_stage_transitions_total',
  help: 'Total project stage transitions',
  labelNames: ['to_stage'],
  registers: [register],
});

module.exports = { metricsMiddleware, metricsHandler, stageTransitionsTotal };
