'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const authRouter = require('./routes/auth');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3007;

app.use(express.json({ limit: '1mb' }));
app.use(metricsMiddleware);
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'auth-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/', authRouter);

app.listen(PORT, () => console.log('[auth-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;
