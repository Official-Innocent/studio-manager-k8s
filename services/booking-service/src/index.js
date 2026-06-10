'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bookingsRouter = require('./routes/bookings');
const contractsRouter = require('./routes/contracts');
const invoicesRouter = require('./routes/invoices');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'booking-secret', resave: false, saveUninitialized: false, cookie: { secure: false } }));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/bookings', bookingsRouter);
app.use('/contracts', contractsRouter);
app.use('/invoices', invoicesRouter);

app.listen(PORT, () => console.log('[booking-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;