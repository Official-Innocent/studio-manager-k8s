'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const portfolioRouter = require('./routes/portfolio');
const siteContentRouter = require('./routes/site-content');
const promotionsRouter = require('./routes/promotions');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3008;

app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'content-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'content-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/portfolio', portfolioRouter);
app.use('/site-content', siteContentRouter);
app.use('/promotions', promotionsRouter);

app.listen(PORT, () => console.log('[content-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;
