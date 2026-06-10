'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const galleriesRouter = require('./routes/galleries');
const photosRouter = require('./routes/photos');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'gallery-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gallery-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/galleries', galleriesRouter);
app.use('/photos', photosRouter);

app.listen(PORT, () => console.log('[gallery-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;