'use strict';
const gcal = require('../services/googleCalendar');
const express  = require('express');
const { body, validationResult, param } = require('express-validator');
const { query, transaction } = require('../config/database');
const { requireAdmin }       = require('../middleware/auth');
const emailService           = require('../services/email');
const smsService             = require('../services/sms');
const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────
const bookingValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required').isLength({ max: 100 }),
  body('last_name').trim().notEmpty().withMessage('Last name is required').isLength({ max: 100 }),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().trim().isLength({ max: 30 }),
  body('session_type').trim().notEmpty().withMessage('Session type is required'),
  body('session_date').isDate().withMessage('Valid date is required'),
  body('notes').optional().trim().isLength({ max: 2000 }),
];

// ── POST /api/bookings — Public: submit a booking request ─────────────────────
router.post('/', bookingValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { first_name, last_name, email, phone, session_type, session_date, notes, enquiry_source, enquiry_source_detail } = req.body;

  try {
    // Check if date is already fully booked
    const { rows: conflicts } = await query(
      `SELECT id FROM bookings 
       WHERE session_date = $1 AND status IN ('confirmed','pending') 
       LIMIT 1`,
      [session_date]
    );
    if (conflicts.length) {
      return res.status(409).json({ error: 'This date already has a booking. Please choose another date.' });
    }

    // Check blocked dates
    const { rows: blocked } = await query(
      'SELECT id FROM blocked_dates WHERE date = $1',
      [session_date]
    );
    if (blocked.length) {
      return res.status(409).json({ error: 'This date is not available. Please choose another date.' });
    }

    // Create booking
    const { rows } = await query(`
      INSERT INTO bookings (first_name, last_name, email, phone, session_type, session_date, notes, status, enquiry_source, enquiry_source_detail)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
      RETURNING *
    `, [first_name, last_name, email, phone, session_type, session_date, notes, enquiry_source||null, enquiry_source_detail||null]);

    const booking = rows[0];

    // Auto-create client as lead if not already exists, then create pipeline project
    const { rows: existing } = await query(
      'SELECT id FROM clients WHERE email=$1', [email]
    );
    let leadClientId = existing.length ? existing[0].id : null;
    if (!existing.length) {
      const { rows: newClient } = await query(`
        INSERT INTO clients (first_name, last_name, email, phone, status)
        VALUES ($1,$2,$3,$4,'lead')
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `, [first_name, last_name, email, phone||null]);
      if (newClient.length) leadClientId = newClient[0].id;
    }
    if (leadClientId) {
      const { rows: ep } = await query('SELECT id FROM projects WHERE client_id=$1 LIMIT 1', [leadClientId]);
      if (!ep.length) {
        await query(`INSERT INTO projects (client_id, title, stage, session_type, notes) VALUES ($1,$2,'lead',$3,$4)`,
          [leadClientId, (first_name+' '+last_name+' — '+session_type)||'New Project', session_type||'general', notes||'']);
      }
    }

    // Send notifications (non-blocking)
    emailService.sendBookingConfirmationToClient(booking).catch(console.error);
    emailService.sendBookingNotificationToOwner(booking).catch(console.error);
    smsService.notifyOwnerNewBooking(booking).catch(console.error);

    res.status(201).json({
      success: true,
      message: 'Booking request received! You will hear from us within 24 hours.',
      bookingId: booking.id,
      reference: booking.id.split('-')[0].toUpperCase(),
    });
  } catch (err) {
    console.error('[POST /bookings]', err);
    res.status(500).json({ error: 'Failed to create booking. Please try again.' });
  }
});

// ── GET /api/bookings/availability?month=2026-05 — Public: get booked dates ───
router.get('/availability', async (req, res) => {
  const { month } = req.query; // format: YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
  }
  try {
    const [year, mon] = month.split('-');
    const { rows: bookedRows } = await query(`
      SELECT session_date::text as date FROM bookings
      WHERE to_char(session_date,'YYYY-MM') = $1
        AND status IN ('confirmed','pending')
    `, [month]);

    const { rows: blockedRows } = await query(`
      SELECT date::text as date FROM blocked_dates
      WHERE to_char(date,'YYYY-MM') = $1
    `, [month]);

    const bookedDates  = bookedRows.map(r => r.date);
    const blockedDates = blockedRows.map(r => r.date);

    res.json({ bookedDates, blockedDates });
  } catch (err) {
    console.error('[GET /bookings/availability]', err);
    res.status(500).json({ error: 'Failed to load availability.' });
  }
});

// ── All routes below require admin login ──────────────────────────────────────

// GET /api/bookings — Admin: list all bookings
router.get('/', requireAdmin, async (req, res) => {
  const { status, month, limit = 50, offset = 0 } = req.query;
  try {
    let whereClause = 'WHERE 1=1';
    const params = [];
    if (status) { params.push(status); whereClause += ` AND b.status = $${params.length}`; }
    if (month)  { params.push(month);  whereClause += ` AND to_char(b.session_date,'YYYY-MM') = $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await query(`
      SELECT b.*, c.id as client_id
      FROM bookings b
      LEFT JOIN clients c ON c.email = b.email
      ${whereClause}
      ORDER BY b.session_date ASC, b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM bookings b ${whereClause}`,
      params.slice(0, -2)
    );

    res.json({ bookings: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[GET /bookings]', err);
    res.status(500).json({ error: 'Failed to load bookings.' });
  }
});

// GET /api/bookings/:id — Admin: get single booking
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM bookings WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load booking.' });
  }
});

// PATCH /api/bookings/:id — Admin: update booking status/details
router.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['status','payment_status','session_time','location','internal_notes',
                   'amount_total','amount_paid','contract_signed','session_date',
                   'first_name','last_name','email','phone','session_type','notes',
                   'enquiry_source','enquiry_source_detail'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }
  try {
    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [req.params.id, ...Object.values(updates)];
    const { rows } = await query(
      `UPDATE bookings SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });

    // If confirming, send confirmation email
    if (updates.status === 'confirmed') {
      emailService.sendBookingConfirmed(rows[0]).catch(console.error);
      autoSendContract(rows[0]).catch(console.error);
      query("SELECT id FROM clients WHERE email=$1", [rows[0].email]).then(function(cr){ if(cr.rows.length) { autoCreatePortalAccount(cr.rows[0].id, rows[0].first_name, rows[0].last_name, rows[0].email).catch(console.error); } }).catch(console.error);
      // Create Google Calendar event
      gcal.createEvent(rows[0]).then(function(eventId) {
        return query('UPDATE bookings SET calendar_event_id= WHERE id=', [eventId, rows[0].id]);
      }).catch(function(e) { console.error("[gcal] create failed:", e.message); });
    } else if (rows[0].calendar_event_id && (updates.session_date || updates.status)) {
      gcal.updateEvent(rows[0].calendar_event_id, rows[0]).catch(function(e) { console.error("[gcal] update failed:", e.message); });
    }

    res.json({ success: true, booking: rows[0] });
  } catch (err) {
    console.error('[PATCH /bookings]', err);
    res.status(500).json({ error: 'Failed to update booking.' });
  }
});

// DELETE /api/bookings/:id — Admin: delete booking
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM bookings WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking.' });
  }
});

// POST /api/bookings/blocked — Admin: block a date
router.post('/blocked', requireAdmin, async (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required.' });
  try {
    await query(
      'INSERT INTO blocked_dates (date, reason) VALUES ($1,$2) ON CONFLICT (date) DO NOTHING',
      [date, reason || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to block date.' });
  }
});

// DELETE /api/bookings/blocked/:date — Admin: unblock a date
router.delete('/blocked/:date', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM blocked_dates WHERE date=$1', [req.params.date]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unblock date.' });
  }
});


async function sendAutoEmail(clientId, templateKey, extraMerge) {
  try {
    const nodemailer = require('nodemailer');
    const {query} = require('../config/database');
    const cr = await query('SELECT * FROM clients WHERE id=$1', [clientId]);
    if (!cr.rows.length) return;
    const c = cr.rows[0];
    const templates = {
      bc: {subj:'Your session is confirmed - Bigg Shots Media', body:'Dear {{first_name}},\n\nYour session is confirmed.\n\nDate: {{session_date}}\nType: {{session_type}}\n\nWarm regards,\nAdak Jose\nBigg Shots Media'},
      gr: {subj:'Your gallery is ready - Bigg Shots Media', body:'Dear {{first_name}},\n\nYour photographs are ready! Please log in to view and select your favourites.\n\nPortal: {{portal_link}}\n\nWith warmth,\nAdak Jose\nBigg Shots Media'},
      ps: {subj:'Getting ready for your session - Bigg Shots Media', body:'Dear {{first_name}},\n\nYour session is coming up soon. Tips: wear comfortable outfits, solid colours photograph well, arrive 10 mins early.\n\nWarm regards,\nAdak Jose\nBigg Shots Media'},
    };
    const t = templates[templateKey]; if (!t) return;
    const merge = (str) => {
      let s = str.replace(/{{first_name}}/g, c.first_name||'')
                 .replace(/{{last_name}}/g, c.last_name||'')
                 .replace(/{{portal_link}}/g, 'https://biggshotsmedia.com/portal');
      if (extraMerge) Object.keys(extraMerge).forEach(k => { s = s.replace(new RegExp('{{'+k+'}}','g'), extraMerge[k]||''); });
      return s;
    };
    const subj = merge(t.subj);
    const body = merge(t.body);
    const rows = body.split('\n').map(l => l ? '<p style="margin:0 0 0.8rem;">'+l+'</p>' : '<br>').join('');
    const html = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;"><div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;">BIGG SHOTS MEDIA</h1></div><div style="padding:2rem;">'+rows+'</div></div>';
    const tr = nodemailer.createTransport({host:'smtp.gmail.com',port:587,secure:false,auth:{user:'thephotographerltd@gmail.com',pass:'pymy olhw nkca bhms'},tls:{rejectUnauthorized:false}});
    await tr.sendMail({from:'Bigg Shots Media <thephotographerltd@gmail.com>',replyTo:'hello@biggshotsmedia.com',to:c.email,subject:subj,html:html});
    await query('INSERT INTO email_log(client_id,subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6,$7)',[clientId,subj,body,c.email,'thephotographerltd@gmail.com',templateKey,'outbound']);
    console.log('[auto-email] sent',templateKey,'to',c.email);
  } catch(e) { console.error('[auto-email] failed:',e.message); }
}


router.post('/lead-capture', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });
  try {
    await query(
      `INSERT INTO clients (first_name, last_name, email, status, marketing_consent)
         VALUES ($1, '', $2, 'lead', true)
         ON CONFLICT (email) DO UPDATE SET marketing_consent=true`,
      [name || 'Visitor', email]
    );
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms' },
      tls: { rejectUnauthorized: false }
    });
    await transporter.sendMail({
      from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
      replyTo: 'hello@biggshotsmedia.com',
      to: email,
      subject: 'Your Bigg Shots Media Package Guide',
      html: '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;"><div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;">BIGG SHOTS MEDIA</h1></div><div style="padding:2rem;"><p>Thank you for your interest in Bigg Shots Media.</p><p style="color:#B0A898;">Please find your package guide attached. I would love to hear from you.</p><p style="color:#B0A898;">With warmth,<br>Innocent<br>Bigg Shots Media</p></div></div>',
      attachments: [{ filename: 'Bigg-Shots-Media-Package-Guide.pdf', path: '/app/public/assets/downloads/bigg-shots-package-guide.pdf' }]
    });
    res.json({ success: true });
  } catch(e) {
    console.error('[lead-capture]', e.message);
    res.status(500).json({ error: 'Failed.' });
  }
});

async function autoCreatePortalAccount(clientId, firstName, lastName, email) {
  try {
    const bcrypt = require('bcryptjs');
    const { rows: existing } = await query('SELECT id FROM clients WHERE id=$1 AND portal_enabled=true', [clientId]);
    if (existing.length) return; // already has portal account
    const pass = (lastName || 'client').toLowerCase().replace(/\s/g,'') + Math.floor(1000 + Math.random() * 9000);
    const hash = await bcrypt.hash(pass, 10);
    await query('UPDATE clients SET password_hash=$1, portal_enabled=true WHERE id=$2', [hash, clientId]);
    // Send welcome email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms' },
      tls: { rejectUnauthorized: false }
    });
    await transporter.sendMail({
      from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
      replyTo: 'hello@biggshotsmedia.com',
      to: email,
      subject: 'Your Bigg Shots Media Client Portal — Login Details',
      html: '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;"><div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;letter-spacing:0.15em;">BIGG SHOTS MEDIA</h1></div><div style="padding:2rem;"><p style="font-size:16px;margin:0 0 1rem;">Hi ' + firstName + ',</p><p style="color:#B0A898;margin:0 0 1.5rem;">Your client portal is now ready. You can view your contracts, invoices, gallery and questionnaires all in one place.</p><div style="background:#111;border:0.5px solid rgba(201,168,76,0.2);padding:1.5rem;margin-bottom:1.5rem;"><p style="margin:0 0 0.5rem;font-size:12px;color:#C9A84C;letter-spacing:0.1em;text-transform:uppercase;">Your login details</p><p style="margin:0 0 0.3rem;font-size:13px;"><strong>Email:</strong> ' + email + '</p><p style="margin:0;font-size:13px;"><strong>Password:</strong> ' + pass + '</p></div><p style="color:#B0A898;font-size:13px;margin:0 0 1.5rem;">We recommend changing your password after your first login.</p><a href="https://biggshotsmedia.com/portal" style="display:inline-block;background:#C9A84C;color:#1a1200;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;padding:0.8rem 2rem;text-decoration:none;">Access Your Portal</a></div><div style="padding:1rem 2rem;border-top:0.5px solid rgba(201,168,76,0.2);font-size:11px;color:#666;text-align:center;">biggshotsmedia.com</div></div>'
    });
    console.log('[portal] auto-created for', email);
  } catch(e) { console.error('[portal] auto-create failed:', e.message); }
}
module.exports = router;

// ── Auto-send contract on booking confirmation ────────────────────────────────
async function autoSendContract(booking) {
  try {
    const jwt = require('jsonwebtoken');
    const { query } = require('../config/database');
    const emailService = require('../services/email');

    // Map session type to contract template
    const typeMap = {
      'wedding': '02b53574-c287-496c-a457-7871ba4868f8',
      'Wedding Photography': '02b53574-c287-496c-a457-7871ba4868f8',
      'portrait': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'Portrait Sessions': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'Family Portraits': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'maternity': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'Maternity Sessions': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'headshots': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'Headshots': '405233b8-54c2-4189-8dc3-ec7069cbf011',
      'events': 'a98883b2-9325-4eee-8500-60cfbb52e2e6',
      'Birthday & Events': 'a98883b2-9325-4eee-8500-60cfbb52e2e6',
      'Event Photography': 'a98883b2-9325-4eee-8500-60cfbb52e2e6',
    };

    const templateId = typeMap[booking.session_type] || '291b28a7-6ef3-46c6-8240-afb351dc03a5';

    // Get template
    const { rows: tmpl } = await query('SELECT * FROM contract_templates WHERE id=$1', [templateId]);

    // Fill template
    const clientName = booking.first_name + ' ' + booking.last_name;
    const sessionDate = new Date(booking.session_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    let body = tmpl[0].body
      .replace(/{{CLIENT_NAME}}/g, clientName)
      .replace(/{{SESSION_DATE}}/g, sessionDate)
      .replace(/{{SESSION_TYPE}}/g, booking.session_type || 'Photography Session')
      .replace(/{{SESSION_LOCATION}}/g, booking.location || 'TBC')
      .replace(/{{TOTAL_AMOUNT}}/g, 'TBC')
      .replace(/{{DEPOSIT_AMOUNT}}/g, 'TBC')
      .replace(/{{BALANCE_DUE_DATE}}/g, 'TBC');

    // Find client
    const { rows: clients } = await query('SELECT id FROM clients WHERE email=$1', [booking.email]);
    const clientId = clients[0].id;

    // Create contract
    const { rows: contract } = await query(
      `INSERT INTO contracts (client_id, template_id, contract_type, title, body, status)
       VALUES ($1,$2,$3,$4,$5,'sent') RETURNING *`,
      [clientId, templateId, tmpl[0].contract_type,
       tmpl[0].name + ' — ' + clientName, body]
    );

    // Generate signing token
    const token = jwt.sign(
      { contractId: contract[0].id, clientId, bookingId: booking.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Update sent_at
    await query('UPDATE contracts SET sent_at=NOW() WHERE id=$1', [contract[0].id]);

    // Send email
    await emailService.sendContractForSigning(booking, contract[0].id, token);
    console.log('[contract] sent to', booking.email);
  } catch(e) {
    console.error('[contract] failed:', e.message);
  }
}
