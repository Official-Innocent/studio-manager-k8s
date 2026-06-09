'use strict';
require('dotenv').config();
const express = require('express');
const emailService = require('./email');
const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString(), uptime: process.uptime() });
});
async function handleEmailType(type, data) {
  switch(type) {
    case 'booking.received': return emailService.sendBookingConfirmationToClient(data.booking);
    case 'booking.confirmed': return emailService.sendBookingConfirmed(data.booking);
    case 'booking.owner_notification': return emailService.sendBookingNotificationToOwner(data.booking);
    case 'gallery.ready': return emailService.sendGalleryReady(data.client, data.gallery, data.accessUrl);
    case 'payment.received': return emailService.sendPaymentReceived(data.payment, data.client);
    case 'payment.owner_notification': return emailService.sendPaymentNotificationToOwner(data.payment, data.client);
    case 'order.shipped': return emailService.sendOrderShipped(data.order, data.client);
    default: throw new Error('Unknown email type: ' + type);
  }
}
app.post('/send', async (req, res) => {
  const { type, data } = req.body;
  if (!type || !data) return res.status(400).json({ error: 'type and data required' });
  try { res.json({ success: true, result: await handleEmailType(type, data) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.listen(PORT, () => console.log('[notification-service] running on port ' + PORT));
(async () => {
  try {
    const { createSubscriber } = require('./redis');
    const subscriber = createSubscriber();
    await subscriber.connect();
    console.log('[notification-service] Redis connected');
    const events = ['booking.received','booking.confirmed','booking.owner_notification','gallery.ready','payment.received','payment.owner_notification','order.shipped'];
    for (const event of events) {
      await subscriber.subscribe(event, async (message) => {
        try { await handleEmailType(event, JSON.parse(message)); } catch(e) { console.error('[redis event error]', e.message); }
      });
    }
    console.log('[notification-service] subscribed to ' + events.length + ' events');
  } catch(e) {
    console.log('[notification-service] Redis unavailable - REST-only mode');
  }
})();
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e.message));
module.exports = app;