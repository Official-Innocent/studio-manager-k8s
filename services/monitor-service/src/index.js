// services/monitor-service/src/index.js
// BiggShots Monitor v2 — SSE aggregation server
//
// GET /monitor/stream  — EventSource endpoint, pushes JSON every 10s
// GET /monitor/        — dashboard HTML (served as static file)
// GET /health          — liveness probe

'use strict';

const express = require('express');
const path = require('path');
const { collectSystemHealth } = require('./panels/systemHealth');
const { collectBusinessMetrics } = require('./panels/businessMetrics');
const { collectClientActivity } = require('./panels/clientActivity');
const { collectGA4 } = require('./panels/ga4');

const app = express();
const PORT = process.env.PORT || 3006;
const SSE_INTERVAL_MS = parseInt(process.env.SSE_INTERVAL_MS || '10000', 10);

// ── Static dashboard ──────────────────────────────────────────────────────────
app.use('/monitor', express.static(path.join(__dirname, '../public')));

// ── Health probe ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'monitor-service', timestamp: new Date().toISOString() });
});

// ── SSE stream ────────────────────────────────────────────────────────────────
app.get('/monitor/stream', async (req, res) => {
  // SSE headers — disable all buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  let closed = false;

  function send(data) {
    if (closed) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  async function push() {
    try {
      // Gather all panels concurrently — if one fails it returns an error
      // payload rather than crashing the stream
      const [systemHealth, businessMetrics, clientActivity, ga4] = await Promise.allSettled([
        collectSystemHealth(),
        collectBusinessMetrics(),
        collectClientActivity(),
        collectGA4(),
      ]);

      send({
        timestamp: new Date().toISOString(),
        systemHealth:    settledValue(systemHealth),
        businessMetrics: settledValue(businessMetrics),
        clientActivity:  settledValue(clientActivity),
        ga4:             settledValue(ga4),
      });
    } catch (err) {
      send({ error: err.message, timestamp: new Date().toISOString() });
    }
  }

  // Send immediately on connect, then on interval
  await push();
  const interval = setInterval(push, SSE_INTERVAL_MS);

  // Keep-alive comment every 20s to prevent nginx/proxy timeouts
  const keepAlive = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 20000);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
    clearInterval(keepAlive);
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────
function settledValue(result) {
  if (result.status === 'fulfilled') return result.value;
  return { error: result.reason?.message || 'collection failed' };
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[monitor-service] listening on :${PORT}`);
  console.log(`[monitor-service] SSE interval: ${SSE_INTERVAL_MS}ms`);
});
