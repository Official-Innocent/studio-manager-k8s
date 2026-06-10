'use strict';

let twilioClient = null;

function getClient() {
  if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return twilioClient;
}

async function sendSMS(to, message) {
  const client = getClient();
  if (!client) {
    console.log('[SMS] Twilio not configured — skipping SMS');
    return false;
  }
  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to,
    });
    console.log(`[SMS] Sent to ${to}`);
    return true;
  } catch (err) {
    console.error('[SMS] Failed:', err.message);
    return false;
  }
}

// ── Owner notifications ───────────────────────────────────────────────────────

async function notifyOwnerNewBooking(booking) {
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) return;
  const date = new Date(booking.session_date).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  return sendSMS(ownerPhone,
    `📸 BIGG SHOTS: New booking request!\n${booking.first_name} ${booking.last_name}\n${booking.session_type}\n${date}\n${booking.email}\nRef: #${booking.id.split('-')[0].toUpperCase()}`
  );
}

async function notifyOwnerPayment(amount, clientName, method) {
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) return;
  return sendSMS(ownerPhone,
    `💷 BIGG SHOTS: Payment received!\n${clientName} paid £${Number(amount).toFixed(2)} via ${method}`
  );
}

async function notifyOwnerNewOrder(order, clientName) {
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) return;
  return sendSMS(ownerPhone,
    `🛒 BIGG SHOTS: New print order!\n${clientName}\nTotal: £${Number(order.total).toFixed(2)}\nRef: #${order.id.split('-')[0].toUpperCase()}`
  );
}

module.exports = {
  sendSMS,
  notifyOwnerNewBooking,
  notifyOwnerPayment,
  notifyOwnerNewOrder,
};
