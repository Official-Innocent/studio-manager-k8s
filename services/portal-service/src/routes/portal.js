'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { query } = require('../config/database');
const { requireClient } = require('../middleware/auth');
const emailService = require('../services/email');
const router = express.Router();

// ── POST /api/portal/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await query(
      'SELECT * FROM clients WHERE email=$1 AND is_active=true', [email.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const client = rows[0];
    if (!client.password_hash) return res.status(401).json({ error: 'Invalid email or password.' });
    const match = await bcrypt.compare(password, client.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    await query('UPDATE clients SET last_login=NOW() WHERE id=$1', [client.id]);
    const token = jwt.sign(
      { clientId: client.id, email: client.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('client_token', token, {
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax', path: '/',
    });
    res.json({
      success: true,
      client: {
        id: client.id,
        firstName: client.first_name,
        lastName: client.last_name,
        email: client.email,
      },
    });
  } catch (err) {
    console.error('[portal/login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/portal/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('client_token', { path: '/' });
  res.json({ success: true });
});

// ── GET /api/portal/me ────────────────────────────────────────────────────────
router.get('/me', requireClient, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, first_name, last_name, email, phone, created_at FROM clients WHERE id=$1',
      [req.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

// ── GET /api/portal/galleries ─────────────────────────────────────────────────
router.get('/galleries', requireClient, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT g.id, g.title, g.slug, g.description, g.session_date,
             g.expires_at, g.allow_downloads, g.view_count, g.cover_image_id,
             (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) as photo_count,
             (SELECT COUNT(*) FROM photo_selections ps WHERE ps.gallery_id = g.id AND ps.client_id = $1) as selected_count
      FROM galleries g
      WHERE g.client_id = $1 AND g.is_published = true
      ORDER BY g.created_at DESC
    `, [req.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load galleries.' });
  }
});

// ── GET /api/portal/galleries/:slug ───────────────────────────────────────────
router.get('/galleries/:slug', requireClient, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT g.id, g.title, g.slug, g.description, g.session_date,
             g.expires_at, g.allow_downloads, g.view_count
      FROM galleries g
      WHERE g.slug = $1 AND g.client_id = $2 AND g.is_published = true
    `, [req.params.slug, req.clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Gallery not found.' });
    await query('UPDATE galleries SET view_count=view_count+1 WHERE id=$1', [rows[0].id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load gallery.' });
  }
});

// ── GET /api/portal/galleries/:slug/photos ────────────────────────────────────
router.get('/galleries/:slug/photos', requireClient, async (req, res) => {
  try {
    const { rows: galleryRows } = await query(
      'SELECT id FROM galleries WHERE slug=$1 AND client_id=$2 AND is_published=true',
      [req.params.slug, req.clientId]
    );
    if (!galleryRows.length) return res.status(404).json({ error: 'Gallery not found.' });
    const galleryId = galleryRows[0].id;
    const { rows } = await query(`
      SELECT p.id, p.filename, p.thumb_path, p.web_path, p.width, p.height,
             p.sort_order, p.is_cover,
             CASE WHEN ps.photo_id IS NOT NULL THEN true ELSE false END as is_selected,
             ps.list_type as selected_list
      FROM photos p
      LEFT JOIN photo_selections ps ON ps.photo_id = p.id
        AND ps.client_id = $2 AND ps.list_type = 'favourites'
      WHERE p.gallery_id = $1
      ORDER BY p.sort_order, p.upload_at
    `, [galleryId, req.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

// ── POST /api/portal/galleries/:slug/select ────────────────────────────────────
router.post('/galleries/:slug/select', requireClient, async (req, res) => {
  const { photo_id, selected, list_type = 'favourites' } = req.body;
  if (!photo_id) return res.status(400).json({ error: 'photo_id required.' });
  try {
    const { rows: galleryRows } = await query(
      'SELECT id FROM galleries WHERE slug=$1 AND client_id=$2',
      [req.params.slug, req.clientId]
    );
    if (!galleryRows.length) return res.status(404).json({ error: 'Gallery not found.' });
    const galleryId = galleryRows[0].id;
    if (selected === false) {
      await query(
        'DELETE FROM photo_selections WHERE gallery_id=$1 AND photo_id=$2 AND client_id=$3 AND list_type=$4',
        [galleryId, photo_id, req.clientId, list_type]
      );
    } else {
      await query(`
        INSERT INTO photo_selections (gallery_id, photo_id, client_id, list_type)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
      `, [galleryId, photo_id, req.clientId, list_type]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update selection.' });
  }
});

// ── GET /api/portal/galleries/:slug/selections ───────────────────────────────
router.get('/galleries/:slug/selections', requireClient, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT ps.photo_id, ps.list_type, p.filename, p.thumb_path, p.web_path
      FROM photo_selections ps
      JOIN photos p ON p.id = ps.photo_id
      JOIN galleries g ON g.id = ps.gallery_id
      WHERE g.slug = $1 AND ps.client_id = $2
      ORDER BY ps.selected_at
    `, [req.params.slug, req.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load selections.' });
  }
});


// ── Nodemailer transporter for credentials emails ─────────────────────────────
const nodemailer = require('nodemailer');
const credTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: {user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms'},
  tls: {rejectUnauthorized: false}
});

function bsmEmail(bodyHtml) {
  return '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;">'
    + '<div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;letter-spacing:0.15em;">BIGG SHOTS MEDIA</h1></div>'
    + '<div style="padding:2rem;">' + bodyHtml + '</div>'
    + '<div style="padding:1rem 2rem;border-top:0.5px solid rgba(201,168,76,0.2);font-size:11px;color:#666;text-align:center;">biggshotsmedia.com</div>'
    + '</div>';
}

async function sendCredentialsEmail(client, password) {
  const html = bsmEmail(
    '<p style="font-size:16px;color:#F5F0E8;margin:0 0 1rem;">Hi ' + client.first_name + ',</p>'
    + '<p style="color:#B0A898;font-size:14px;">Your Bigg Shots Media client portal is ready. You can view your gallery, documents, invoices and more.</p>'
    + '<div style="background:#111;border:0.5px solid rgba(201,168,76,0.2);border-radius:4px;padding:1.5rem;margin:1.5rem 0;">'
    + '<p style="margin:0 0 0.5rem;font-size:12px;color:#C9A84C;letter-spacing:0.1em;text-transform:uppercase;">Your login details</p>'
    + '<p style="margin:0 0 0.3rem;font-size:13px;color:#F5F0E8;"><strong>Email:</strong> ' + client.email + '</p>'
    + '<p style="margin:0;font-size:13px;color:#F5F0E8;"><strong>Password:</strong> ' + password + '</p>'
    + '</div>'
    + '<p style="color:#B0A898;font-size:13px;">We recommend changing your password after your first login.</p>'
    + '<div style="text-align:center;margin-top:1.5rem;"><a href="https://biggshotsmedia.com/portal" style="display:inline-block;background:#C9A84C;color:#1a1200;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:0.8rem 2rem;text-decoration:none;">Access Your Portal</a></div>'
  );
  await credTransporter.sendMail({
    from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
    replyTo: 'hello@biggshotsmedia.com',
    to: client.email,
    subject: 'Your Bigg Shots Media client portal is ready',
    html: html
  });
}

// ── Admin: create client account + send credentials ───────────────────────────
router.post('/admin/create-client-account', async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: clientRows } = await query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found.' });
    const client = clientRows[0];
    const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase() + '!' + crypto.randomBytes(4).toString('hex').toLowerCase();
    const hash = await bcrypt.hash(tempPassword, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, client_id]);
    await sendCredentialsEmail(client, tempPassword);
    res.json({ success: true, message: 'Portal credentials sent to ' + client.email });
  } catch(err) {
    console.error('[portal] create account error:', err.message);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

// ── Admin: reset client portal password ───────────────────────────────────────
router.post('/admin/reset-client-password', async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: clientRows } = await query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found.' });
    const client = clientRows[0];
    const newPassword = crypto.randomBytes(4).toString('hex').toUpperCase() + '!' + crypto.randomBytes(4).toString('hex').toLowerCase();
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, client_id]);
    await sendCredentialsEmail(client, newPassword);
    res.json({ success: true, message: 'New credentials sent to ' + client.email });
  } catch(err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ── POST /api/portal/forgot-password ─────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });
  try {
    const { rows } = await query('SELECT * FROM clients WHERE email=$1', [email]);
    if (!rows.length) return res.json({ success: true }); // Don't reveal if email exists
    const client = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await query('INSERT INTO password_reset_tokens(client_id,token,expires_at) VALUES($1,$2,$3)', [client.id, token, expires]);
    const resetUrl = 'https://biggshotsmedia.com/portal?reset=' + token;
    const html = bsmEmail(
      '<p style="font-size:16px;color:#F5F0E8;margin:0 0 1rem;">Hi ' + client.first_name + ',</p>'
      + '<p style="color:#B0A898;font-size:14px;">We received a request to reset your portal password. Click the button below to set a new password. This link expires in 1 hour.</p>'
      + '<div style="text-align:center;margin:1.5rem 0;"><a href="' + resetUrl + '" style="display:inline-block;background:#C9A84C;color:#1a1200;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:0.8rem 2rem;text-decoration:none;">Reset My Password</a></div>'
      + '<p style="color:#666;font-size:12px;">If you did not request this, you can safely ignore this email.</p>'
    );
    await credTransporter.sendMail({
      from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
      replyTo: 'hello@biggshotsmedia.com',
      to: client.email,
      subject: 'Reset your Bigg Shots Media portal password',
      html: html
    });
    res.json({ success: true });
  } catch(err) {
    console.error('[portal] forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to send reset email.' });
  }
});

// ── POST /api/portal/reset-password ──────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const { rows } = await query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    const resetToken = rows[0];
    const hash = await bcrypt.hash(password, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, resetToken.client_id]);
    await query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1', [resetToken.id]);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch(err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ── POST /api/portal/change-password ─────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required.' });
  if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  try {
    const clientId = req.session?.clientId || (req.cookies?.client_token ? jwt.verify(req.cookies.client_token, process.env.JWT_SECRET).clientId : null);
    if (!clientId) return res.status(401).json({ error: 'Not authenticated.' });
    const { rows } = await query('SELECT * FROM clients WHERE id=$1', [clientId]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, clientId]);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// ── GET /api/portal/invoices — client's invoices ──────────────────────────────
router.get('/invoices', requireClient, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, invoice_number, total, amount_paid, status, due_date, paid_at, created_at, client_message
       FROM invoices WHERE client_id=$1 AND status != 'draft' ORDER BY created_at DESC`,
      [req.clientId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load invoices.' }); }
});
// Portal invoice PDF download
router.get('/invoices/:id/pdf', requireClient, async (req, res) => {

  try {
    const { rows } = await query('SELECT id, client_id FROM invoices WHERE id=$1', [req.params.id]);
    if (rows.length === 0 || rows[0].client_id !== req.clientId) return res.status(404).json({ error: 'Invoice not found.' });
    // Fetch full invoice and generate PDF
    const PDFDocument = require('pdfkit');
    const { rows: invRows } = await query('SELECT i.*, c.first_name, c.last_name, c.email FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.id=$1', [req.params.id]);
    if (!invRows.length) return res.status(404).json({ error: 'Not found.' });
    const inv = invRows[0];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + inv.invoice_number + '.pdf"');
    doc.pipe(res);
    doc.fontSize(20).fillColor('#C9A84C').text('BIGG SHOTS MEDIA', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#333').text('Invoice ' + inv.invoice_number, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#333');
    doc.text('Client: ' + (inv.first_name || '') + ' ' + (inv.last_name || ''));
    doc.text('Email: ' + (inv.email || ''));
    if (inv.due_date) doc.text('Due: ' + new Date(inv.due_date).toLocaleDateString('en-GB'));
    doc.moveDown(1);
    var items = typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : (inv.line_items || []);
    items.forEach(function(item) {
      doc.text(item.description + ' - £' + parseFloat(item.total || 0).toFixed(2));
    });
    doc.moveDown(1);
    doc.fontSize(12).fillColor('#C9A84C').text('Total: £' + parseFloat(inv.total).toFixed(2));
    doc.text('Paid: £' + parseFloat(inv.amount_paid || 0).toFixed(2));
    doc.text('Balance: £' + (parseFloat(inv.total) - parseFloat(inv.amount_paid || 0)).toFixed(2));
    doc.end();
  } catch(e) { console.error('[portal pdf]', e.message); res.status(500).json({ error: 'Failed.' }); }
});

// POST /api/portal/addon-order
router.post('/addon-order', requireClient, async (req, res) => {
  try {
    const { order_details, shipping_name, shipping_address } = req.body;
    if (!order_details) return res.status(400).json({ error: 'Order details required.' });
    const { rows: client } = await query('SELECT first_name, last_name, email FROM clients WHERE id=$1', [req.clientId]);
    if (!client.length) return res.status(404).json({ error: 'Client not found.' });
    const c = client[0];
    await query(
      'INSERT INTO print_orders (client_id, status, line_items, shipping_name, shipping_address, notes) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.clientId, 'pending', JSON.stringify([{description: order_details}]), shipping_name||null, shipping_address||null, order_details]
    );
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms' },
      tls: { rejectUnauthorized: false }
    });
    await transporter.sendMail({
      from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
      to: 'hello@biggshotsmedia.com',
      subject: 'New Print Order Request — ' + c.first_name + ' ' + c.last_name,
      html: '<div style="font-family:Georgia,serif;max-width:600px;background:#0A0A0A;color:#F5F0E8;padding:2rem;"><h2 style="color:#C9A84C;">New Print Order</h2><p><strong>Client:</strong> ' + c.first_name + ' ' + c.last_name + ' (' + c.email + ')</p><p><strong>Order:</strong> ' + order_details + '</p><p><strong>Delivery name:</strong> ' + (shipping_name||'Not provided') + '</p><p><strong>Address:</strong> ' + (shipping_address||'Not provided') + '</p></div>'
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[addon-order]', e.message);
    res.status(500).json({ error: 'Failed to place order.' });
  }
});

// POST /api/portal/track-download — track gallery photo download
router.post('/track-download', requireClient, async (req, res) => {
  try {
    const { gallery_slug, photo_id, download_type } = req.body;
    await query(
      `INSERT INTO portal_activity_log (client_id, activity_type, reference_id, meta, created_at)
         VALUES ($1, 'download', $2, $3, NOW())`,
      [req.clientId, photo_id || null, JSON.stringify({ gallery_slug, download_type: download_type || 'photo' })]
    );
    res.json({ success: true });
  } catch(e) {
    console.error('[track-download]', e.message);
    res.json({ success: true }); // never fail silently on tracking
  }
});
module.exports = router;
