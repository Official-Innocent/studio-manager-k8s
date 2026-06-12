'use strict';
const nodemailer = require('nodemailer');
const { query }  = require('./config/database');

// ── Transporter ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_HOST || 'localhost',
  port:   parseInt(process.env.MAIL_PORT) || 587,
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

// ── Base HTML email wrapper ───────────────────────────────────────────────────
function emailWrapper(content, preheader = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<title>Bigg Shots Media</title>
<style>
  body{margin:0;padding:0;background:#0A0A0A;font-family:'Helvetica Neue',Arial,sans-serif;}
  .wrap{max-width:600px;margin:0 auto;background:#111111;}
  .header{background:#0A0A0A;padding:32px 40px;border-bottom:1px solid #1A1A1A;text-align:center;}
  .header h1{color:#C9A84C;font-size:22px;font-weight:700;letter-spacing:3px;margin:0;}
  .header p{color:#B0A898;font-size:11px;letter-spacing:6px;text-transform:uppercase;margin:4px 0 0;}
  .body{padding:40px;}
  .gold-line{width:40px;height:1px;background:#C9A84C;margin:24px 0;}
  h2{color:#F5F0E8;font-size:24px;font-weight:300;margin:0 0 8px;}
  h2 em{color:#C9A84C;font-style:italic;}
  p{color:#B0A898;font-size:14px;line-height:1.8;margin:0 0 16px;}
  .highlight{background:#1A1A1A;border-left:3px solid #C9A84C;padding:16px 20px;margin:24px 0;}
  .highlight p{margin:4px 0;font-size:13px;}
  .highlight .label{color:#C9A84C;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;}
  .btn{display:inline-block;background:#C9A84C;color:#0A0A0A !important;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;padding:14px 32px;text-decoration:none;margin:16px 0;}
  .footer{background:#060606;padding:24px 40px;text-align:center;border-top:1px solid #1A1A1A;}
  .footer p{color:#444;font-size:11px;margin:4px 0;}
  .footer a{color:#C9A84C;text-decoration:none;}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<div class="wrap">
  <div class="header">
    <h1>BIGG SHOTS</h1>
    <p>Media</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>Bigg Shots Media &middot; Professional Photography</p>
    <p><a href="mailto:${process.env.MAIL_FROM || 'hello@biggshots.media'}">${process.env.MAIL_FROM || 'hello@biggshots.media'}</a></p>
    <p style="color:#2a2a2a;margin-top:12px;font-size:10px;">You are receiving this email because you have a booking or account with Bigg Shots Media.</p>
  </div>
</div>
</body></html>`;
}

// ── Log email to database ─────────────────────────────────────────────────────
async function logEmail(to, subject, template, status, error = null) {
  try {
    await query(
      'INSERT INTO email_log (to_email, subject, template, status, error) VALUES ($1,$2,$3,$4,$5)',
      [to, subject, template, status, error]
    );
  } catch (e) { /* non-critical */ }
}

// ── Send helper ───────────────────────────────────────────────────────────────
async function send(to, subject, html, template = 'generic') {
  try {
    await transporter.sendMail({
      from:    process.env.MAIL_FROM || 'Bigg Shots Media <hello@biggshots.media>',
      to,
      subject,
      html,
    });
    await logEmail(to, subject, template, 'sent');
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send to ${to}:`, err.message);
    await logEmail(to, subject, template, 'failed', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

// 1. Client: Booking request received
async function sendBookingConfirmationToClient(booking) {
  const html = emailWrapper(`
    <h2>Booking Request <em>Received</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${booking.first_name}, thank you for reaching out to Bigg Shots Media. Your booking request has been received and I will be in touch within 24 hours to confirm your date.</p>
    <div class="highlight">
      <p class="label">Your Booking Details</p>
      <p><strong style="color:#F5F0E8">Session Type:</strong> ${booking.session_type}</p>
      <p><strong style="color:#F5F0E8">Requested Date:</strong> ${new Date(booking.session_date).toLocaleDateString('en-GB', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      <p><strong style="color:#F5F0E8">Name:</strong> ${booking.first_name} ${booking.last_name}</p>
      <p><strong style="color:#F5F0E8">Booking Reference:</strong> #${booking.id.split('-')[0].toUpperCase()}</p>
    </div>
    <p>If you need to make any changes or have questions, please don't hesitate to get in touch.</p>
    <a href="mailto:${process.env.MAIL_USER}" class="btn">Contact Us</a>
  `, 'Your booking request has been received');

  return send(booking.email, 'Booking Request Received — Bigg Shots Media', html, 'booking_client');
}

// 2. Owner: New booking notification
async function sendBookingNotificationToOwner(booking) {
  const ownerEmail = process.env.ADMIN_EMAIL;
  if (!ownerEmail) return;

  const html = emailWrapper(`
    <h2>New Booking <em>Request</em></h2>
    <div class="gold-line"></div>
    <p>A new booking request has been submitted. Log in to your studio dashboard to review and confirm.</p>
    <div class="highlight">
      <p class="label">Booking Details</p>
      <p><strong style="color:#F5F0E8">Client:</strong> ${booking.first_name} ${booking.last_name}</p>
      <p><strong style="color:#F5F0E8">Email:</strong> ${booking.email}</p>
      <p><strong style="color:#F5F0E8">Phone:</strong> ${booking.phone || 'Not provided'}</p>
      <p><strong style="color:#F5F0E8">Session Type:</strong> ${booking.session_type}</p>
      <p><strong style="color:#F5F0E8">Date Requested:</strong> ${new Date(booking.session_date).toLocaleDateString('en-GB', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      <p><strong style="color:#F5F0E8">Notes:</strong> ${booking.notes || 'None'}</p>
      <p><strong style="color:#F5F0E8">Reference:</strong> #${booking.id.split('-')[0].toUpperCase()}</p>
    </div>
    <a href="${process.env.SITE_URL}/admin/bookings/${booking.id}" class="btn">View in Dashboard</a>
  `, `New booking from ${booking.first_name} ${booking.last_name}`);

  return send(ownerEmail, `📸 New Booking Request — ${booking.first_name} ${booking.last_name}`, html, 'booking_owner');
}

// 3. Client: Booking confirmed
async function sendBookingConfirmed(booking) {
  const html = emailWrapper(`
    <h2>Your Booking is <em>Confirmed!</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${booking.first_name}, I'm delighted to confirm your photography session. I can't wait to work with you!</p>
    <div class="highlight">
      <p class="label">Confirmed Session</p>
      <p><strong style="color:#F5F0E8">Session Type:</strong> ${booking.session_type}</p>
      <p><strong style="color:#F5F0E8">Date:</strong> ${new Date(booking.session_date).toLocaleDateString('en-GB', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      ${booking.session_time ? `<p><strong style="color:#F5F0E8">Time:</strong> ${booking.session_time}</p>` : ''}
      ${booking.location ? `<p><strong style="color:#F5F0E8">Location:</strong> ${booking.location}</p>` : ''}
      <p><strong style="color:#F5F0E8">Reference:</strong> #${booking.id.split('-')[0].toUpperCase()}</p>
    </div>
    <p>A contract and invoice will follow shortly. If you have any questions before your session, please don't hesitate to reach out.</p>
    <a href="mailto:${process.env.MAIL_USER}" class="btn">Get in Touch</a>
  `, 'Your session is confirmed!');

  return send(booking.email, 'Session Confirmed — Bigg Shots Media', html, 'booking_confirmed');
}

// 4. Client: Gallery is ready
async function sendGalleryReady(client, gallery, accessUrl) {
  const html = emailWrapper(`
    <h2>Your Gallery is <em>Ready!</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${client.first_name}, your photos are ready to view! Your private gallery has been published — click below to browse your images, select your favourites, and order prints.</p>
    <div class="highlight">
      <p class="label">Your Gallery</p>
      <p><strong style="color:#F5F0E8">Gallery:</strong> ${gallery.title}</p>
      ${gallery.expires_at ? `<p><strong style="color:#F5F0E8">Access Until:</strong> ${new Date(gallery.expires_at).toLocaleDateString('en-GB', {year:'numeric',month:'long',day:'numeric'})}</p>` : ''}
      <p><strong style="color:#C9A84C">Your private link is below — do not share it publicly.</strong></p>
    </div>
    <a href="${accessUrl}" class="btn">View My Gallery →</a>
    <p style="margin-top:24px;font-size:12px;">From your gallery you can: select favourite photos, build your album, download high-resolution images, and order print products.</p>
  `, 'Your photos are ready!');

  return send(client.email, '🎉 Your Gallery is Ready — Bigg Shots Media', html, 'gallery_ready');
}

// 5. Payment received — client
async function sendPaymentReceived(payment, client) {
  const html = emailWrapper(`
    <h2>Payment <em>Received</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${client.first_name}, thank you — your payment has been received and processed successfully.</p>
    <div class="highlight">
      <p class="label">Payment Summary</p>
      <p><strong style="color:#F5F0E8">Amount:</strong> £${Number(payment.amount).toFixed(2)}</p>
      <p><strong style="color:#F5F0E8">Method:</strong> ${payment.method}</p>
      <p><strong style="color:#F5F0E8">Reference:</strong> ${payment.provider_ref || payment.id.split('-')[0].toUpperCase()}</p>
      <p><strong style="color:#F5F0E8">Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>
    </div>
    <p>A receipt has been saved to your account. If you have any questions, please get in touch.</p>
  `, 'Your payment has been received');

  return send(client.email, 'Payment Received — Bigg Shots Media', html, 'payment_client');
}

// 6. Payment received — owner notification
async function sendPaymentNotificationToOwner(payment, client) {
  const ownerEmail = process.env.ADMIN_EMAIL;
  if (!ownerEmail) return;
  const html = emailWrapper(`
    <h2>Payment <em>Received</em></h2>
    <div class="gold-line"></div>
    <div class="highlight">
      <p class="label">Payment Details</p>
      <p><strong style="color:#F5F0E8">From:</strong> ${client.first_name} ${client.last_name} (${client.email})</p>
      <p><strong style="color:#F5F0E8">Amount:</strong> £${Number(payment.amount).toFixed(2)}</p>
      <p><strong style="color:#F5F0E8">Method:</strong> ${payment.method}</p>
      <p><strong style="color:#F5F0E8">Reference:</strong> ${payment.provider_ref || payment.id}</p>
    </div>
    <a href="${process.env.SITE_URL}/admin/payments" class="btn">View in Dashboard</a>
  `);
  return send(ownerEmail, `💷 Payment Received — £${Number(payment.amount).toFixed(2)} from ${client.first_name} ${client.last_name}`, html, 'payment_owner');
}

// 7. Print order shipped
async function sendOrderShipped(order, client) {
  const html = emailWrapper(`
    <h2>Your Order is <em>On Its Way!</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${client.first_name}, great news — your print order has been dispatched and is on its way to you.</p>
    <div class="highlight">
      <p class="label">Shipping Details</p>
      <p><strong style="color:#F5F0E8">Order Reference:</strong> #${order.id.split('-')[0].toUpperCase()}</p>
      ${order.tracking_number ? `<p><strong style="color:#F5F0E8">Tracking Number:</strong> ${order.tracking_number}</p>` : ''}
      ${order.carrier ? `<p><strong style="color:#F5F0E8">Carrier:</strong> ${order.carrier}</p>` : ''}
      <p><strong style="color:#F5F0E8">Shipping To:</strong> ${order.shipping_name}</p>
    </div>
    <p>Delivery typically takes 3–7 working days. If you have any issues with your order, please contact us and we'll make it right.</p>
  `, 'Your prints are on the way!');

  return send(client.email, '📦 Your Order Has Shipped — Bigg Shots Media', html, 'order_shipped');
}

// 8. Portal credentials (new account / admin reset)
async function sendPortalCredentials(client, password) {
  const html = emailWrapper(`
    <h2>Your Portal is <em>Ready</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${client.first_name}, your Bigg Shots Media client portal is ready. You can view your gallery, documents, invoices and more.</p>
    <div class="highlight">
      <p class="label">Your Login Details</p>
      <p><strong style="color:#F5F0E8">Email:</strong> ${client.email}</p>
      <p><strong style="color:#F5F0E8">Password:</strong> ${password}</p>
    </div>
    <p>We recommend changing your password after your first login.</p>
    <a href="${process.env.SITE_URL || 'https://biggshotsmedia.com'}/portal" class="btn">Access Your Portal</a>
  `, 'Your client portal is ready');

  return send(client.email, 'Your Bigg Shots Media client portal is ready', html, 'portal_credentials');
}

// 9. Portal password reset
async function sendPasswordReset(client, resetUrl) {
  const html = emailWrapper(`
    <h2>Reset Your <em>Password</em></h2>
    <div class="gold-line"></div>
    <p>Hi ${client.first_name}, we received a request to reset your portal password. Click below to set a new password. This link expires in 1 hour.</p>
    <a href="${resetUrl}" class="btn">Reset My Password</a>
    <p style="margin-top:24px;font-size:12px;color:#666;">If you did not request this, you can safely ignore this email.</p>
  `, 'Reset your portal password');

  return send(client.email, 'Reset your Bigg Shots Media portal password', html, 'portal_password_reset');
}

module.exports = {
  sendBookingConfirmationToClient,
  sendBookingNotificationToOwner,
  sendBookingConfirmed,
  sendGalleryReady,
  sendPaymentReceived,
  sendPaymentNotificationToOwner,
  sendOrderShipped,
  sendPortalCredentials,
  sendPasswordReset,
};
