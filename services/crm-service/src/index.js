'use strict';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const clientsRouter = require('./routes/clients');
const projectsRouter = require('./routes/projects');
const paymentPlansRouter = require('./routes/payment-plans');
const questionnairesRouter = require('./routes/questionnaires');
const templatesRouter = require('./routes/templates');
const tasksRouter = require('./routes/tasks');

const { metricsMiddleware, metricsHandler } = require('./metrics');
const app = express();
const PORT = process.env.PORT || 3009;

app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'crm-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.get('/metrics', metricsHandler);
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'crm-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/clients', clientsRouter);
app.use('/projects', projectsRouter);
app.use('/payment-plans', paymentPlansRouter);
app.use('/questionnaires', questionnairesRouter);
app.use('/settings', templatesRouter);
app.use('/tasks', tasksRouter);

app.listen(PORT, () => console.log('[crm-service] running on port ' + PORT));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));

module.exports = app;
