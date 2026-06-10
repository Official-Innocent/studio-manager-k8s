// services/gallery-service/src/metrics.js
const { register, client, metricsMiddleware, metricsHandler } = require('./sharedMetrics');

const galleriesPublishedTotal = new client.Counter({
  name: 'galleries_published_total',
  help: 'Total galleries published and made available to clients',
  registers: [register],
});

const galleryDownloadsTotal = new client.Counter({
  name: 'gallery_downloads_total',
  help: 'Total gallery download events triggered by clients',
  registers: [register],
});

const galleriesActive = new client.Gauge({
  name: 'galleries_active',
  help: 'Number of galleries currently published and not expired',
  registers: [register],
});

module.exports = {
  metricsMiddleware,
  metricsHandler,
  galleriesPublishedTotal,
  galleryDownloadsTotal,
  galleriesActive,
};
