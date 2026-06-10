// services/booking-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const bookingsCreatedTotal = new client.Counter({
  name: 'bookings_created_total',
  help: 'Total bookings created',
  labelNames: ['session_type'], // e.g. wedding, portrait, maternity
  registers: [register],
});

const bookingsByStage = new client.Gauge({
  name: 'bookings_by_stage',
  help: 'Current count of bookings in each pipeline stage',
  labelNames: ['stage'],
  registers: [register],
});

const contractsSentTotal = new client.Counter({
  name: 'contracts_sent_total',
  help: 'Total contracts sent to clients',
  registers: [register],
});

const depositInvoicesSentTotal = new client.Counter({
  name: 'deposit_invoices_sent_total',
  help: 'Total deposit invoices sent after contract signing',
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  bookingsCreatedTotal,
  bookingsByStage,
  contractsSentTotal,
  depositInvoicesSentTotal,
};
