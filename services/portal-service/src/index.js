'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const portalRouter = require('./routes/portal');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'portal-secret', resave: false, saveUninitialized: false, cookie: { secure: false } }));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'portal-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/portal', portalRouter);

app.listen(PORT, () => console.log('[portal-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;