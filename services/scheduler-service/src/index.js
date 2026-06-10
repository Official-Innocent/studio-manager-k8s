'use strict';
require('dotenv').config();
const express = require('express');
const { runAll } = require('./scheduler');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3003;
app.use(metricsMiddleware);

const jobHealth = { lastRun: null, lastStatus: 'never', nextRun: null };

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'scheduler-service', timestamp: new Date().toISOString(), uptime: process.uptime(), scheduler: jobHealth });
});

app.post('/run', async (req, res) => {
  try {
    jobHealth.lastStatus = 'running';
    await runAll();
    jobHealth.lastRun = new Date().toISOString();
    jobHealth.lastStatus = 'ok';
    res.json({ success: true, lastRun: jobHealth.lastRun });
  } catch(e) {
    jobHealth.lastStatus = 'error';
    res.status(500).json({ error: e.message });
  }
});

const INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS) || 30 * 60 * 1000;

async function tick() {
  console.log('[scheduler-service] tick at', new Date().toISOString());
  jobHealth.lastStatus = 'running';
  try {
    await runAll();
    jobHealth.lastRun = new Date().toISOString();
    jobHealth.lastStatus = 'ok';
  } catch(e) {
    console.error('[scheduler-service] runAll error:', e.message);
    jobHealth.lastStatus = 'error';
  }
  jobHealth.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();
}

app.listen(PORT, async () => {
  console.log('[scheduler-service] running on port ' + PORT);
  await tick();
  setInterval(tick, INTERVAL_MS);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;