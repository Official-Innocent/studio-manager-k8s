'use strict';
const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query }      = require('../config/database');
const { publish }    = require('../redis');
const { requireAdmin } = require('../middleware/auth');
const { loginAttemptsTotal, passwordResetsTotal } = require('../metrics');
const router = express.Router();

// ── POST /admin/login ─────────────────────────────────────────────────────────
router.post('/admin/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials.' });

    const { email, password } = req.body;
    try {
      const { rows } = await query('SELECT * FROM admin_users WHERE email=$1', [email]);
      if (!rows.length) {
        loginAttemptsTotal.inc({ actor: 'admin', result: 'failure' });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const admin = rows[0];
      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) {
        loginAttemptsTotal.inc({ actor: 'admin', result: 'failure' });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      req.session.adminId    = admin.id;
      req.session.adminEmail = admin.email;
      req.session.adminRole  = admin.role;

      await query('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [admin.id]);
      loginAttemptsTotal.inc({ actor: 'admin', result: 'success' });

      // Issue a JWT for cross-service admin auth (other services' requireAdmin
      // middleware accepts `Bearer <token>` where decoded.role === 'admin')
      const token = jwt.sign(
        { id: admin.id, email: admin.email, role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );

      res.json({
        success: true,
        admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
        token,
      });
    } catch (err) {
      console.error('[POST /admin/login]', err);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ── POST /admin/logout ────────────────────────────────────────────────────────
router.post('/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ── GET /admin/me ─────────────────────────────────────────────────────────────
router.get('/admin/me', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, last_login FROM admin_users WHERE id=$1',
      [req.session?.adminId || req.adminId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Admin not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load admin details.' });
  }
});

// ── POST /admin/verify-password — confirm current admin's password ───────────
// Used by the admin UI to require re-entering the password before destructive
// actions (e.g. cancelling a booking).
router.post('/admin/verify-password', requireAdmin,
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Password is required.' });
    try {
      const { rows } = await query('SELECT password_hash FROM admin_users WHERE id=$1', [req.session.adminId || req.adminId]);
      if (!rows.length) return res.status(404).json({ error: 'Admin not found.' });

      const match = await bcrypt.compare(req.body.password, rows[0].password_hash);
      if (!match) return res.status(401).json({ error: 'Incorrect password.' });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Verification failed.' });
    }
  }
);

// ── POST /admin/change-password ───────────────────────────────────────────────
router.post('/admin/change-password', requireAdmin,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { currentPassword, newPassword } = req.body;
    const adminId = req.session?.adminId || req.adminId;
    try {
      const { rows } = await query('SELECT password_hash FROM admin_users WHERE id=$1', [adminId]);
      if (!rows.length) return res.status(404).json({ error: 'Admin not found.' });

      const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

      const hash = await bcrypt.hash(newPassword, 12);
      await query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, adminId]);

      res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update password.' });
    }
  }
);

// ── POST /client/login ────────────────────────────────────────────────────────
router.post('/client/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials.' });

    const { email, password } = req.body;
    try {
      const { rows } = await query('SELECT * FROM clients WHERE email=$1 AND is_active=true', [email]);
      if (!rows.length) {
        loginAttemptsTotal.inc({ actor: 'client', result: 'failure' });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const client = rows[0];
      if (!client.password_hash) {
        return res.status(401).json({ error: 'Please use your gallery link to access your images.' });
      }

      const match = await bcrypt.compare(password, client.password_hash);
      if (!match) {
        loginAttemptsTotal.inc({ actor: 'client', result: 'failure' });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await query('UPDATE clients SET last_login=NOW() WHERE id=$1', [client.id]);
      loginAttemptsTotal.inc({ actor: 'client', result: 'success' });

      const token = jwt.sign(
        { clientId: client.id, email: client.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('client_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'strict',
      });

      res.json({
        success: true,
        client: { id: client.id, email: client.email, firstName: client.first_name, lastName: client.last_name },
        token,
      });
    } catch (err) {
      console.error('[POST /client/login]', err);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ── POST /client/logout ───────────────────────────────────────────────────────
router.post('/client/logout', (req, res) => {
  res.clearCookie('client_token');
  res.json({ success: true });
});

// ── POST /gallery/access — Validate gallery access token/password ─────────────
router.post('/gallery/access', async (req, res) => {
  const { slug, token, password } = req.body;
  if (!slug) return res.status(400).json({ error: 'Gallery slug is required.' });

  try {
    const { rows } = await query(
      'SELECT id, access_token, password_hash, is_published, expires_at FROM galleries WHERE slug=$1',
      [slug]
    );
    if (!rows.length || !rows[0].is_published) {
      return res.status(404).json({ error: 'Gallery not found.' });
    }
    const gallery = rows[0];

    if (gallery.expires_at && new Date() > new Date(gallery.expires_at)) {
      return res.status(403).json({ error: 'This gallery link has expired.' });
    }

    if (token && token === gallery.access_token) {
      res.cookie(`gallery_${gallery.id}`, token, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'strict',
      });
      return res.json({ success: true, galleryId: gallery.id });
    }

    if (password && gallery.password_hash) {
      const match = await bcrypt.compare(password, gallery.password_hash);
      if (match) {
        res.cookie(`gallery_${gallery.id}`, gallery.access_token, {
          httpOnly: true, secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'strict',
        });
        return res.json({ success: true, galleryId: gallery.id });
      }
    }

    return res.status(403).json({
      error: 'Access denied.',
      requiresPassword: !!gallery.password_hash,
    });
  } catch (err) {
    res.status(500).json({ error: 'Access check failed.' });
  }
});

// ── Admin: create client portal account + send credentials ────────────────────
router.post('/admin/create-client-account', requireAdmin, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: clientRows } = await query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found.' });
    const client = clientRows[0];

    const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase() + '!' + crypto.randomBytes(4).toString('hex').toLowerCase();
    const hash = await bcrypt.hash(tempPassword, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, client_id]);

    await publish('portal.credentials', { client, password: tempPassword });

    res.json({ success: true, message: 'Portal credentials sent to ' + client.email });
  } catch (err) {
    console.error('[POST /admin/create-client-account]', err.message);
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

// ── Admin: reset client portal password ────────────────────────────────────────
router.post('/admin/reset-client-password', requireAdmin, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: clientRows } = await query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found.' });
    const client = clientRows[0];

    const newPassword = crypto.randomBytes(4).toString('hex').toUpperCase() + '!' + crypto.randomBytes(4).toString('hex').toLowerCase();
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE clients SET password_hash=$1 WHERE id=$2', [hash, client_id]);

    await publish('portal.credentials', { client, password: newPassword });

    res.json({ success: true, message: 'New credentials sent to ' + client.email });
  } catch (err) {
    console.error('[POST /admin/reset-client-password]', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ── POST /forgot-password ────────────────────────────────────────────────────
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

    const resetUrl = (process.env.SITE_URL || 'https://biggshotsmedia.com') + '/portal?reset=' + token;
    await publish('portal.password_reset', { client, resetUrl });
    passwordResetsTotal.inc();

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /forgot-password]', err.message);
    res.status(500).json({ error: 'Failed to send reset email.' });
  }
});

// ── POST /reset-password ─────────────────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

module.exports = router;
