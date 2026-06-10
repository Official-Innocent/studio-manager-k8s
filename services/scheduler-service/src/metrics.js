// services/scheduler-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const jobsRunTotal = new client.Counter({
  name: 'scheduler_jobs_run_total',
  help: 'Total scheduler job executions',
  labelNames: ['job_name', 'status'], // status: success | error
  registers: [register],
});

const jobLastRunTimestamp = new client.Gauge({
  name: 'scheduler_job_last_run_timestamp',
  help: 'Unix timestamp of the last time each job ran',
  labelNames: ['job_name'],
  registers: [register],
});

const jobsRegistered = new client.Gauge({
  name: 'scheduler_jobs_registered',
  help: 'Number of cron jobs currently registered',
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  jobsRunTotal,
  jobLastRunTimestamp,
  jobsRegistered,
};
