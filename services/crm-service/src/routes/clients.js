'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /clients ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id) as project_count,
        cl.total_sessions, cl.current_cycle, cl.threshold, cl.discount_pct, cl.award_count
      FROM clients c
      LEFT JOIN client_loyalty cl ON cl.client_id=c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load clients.' }); }
});

// ── GET /clients/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// ── POST /clients ──────────────────────────────────────────────────────────
// Note: portal account creation is handled separately via
// auth-service POST /admin/create-client-account, not here.
router.post('/', async (req, res) => {
  const { first_name, last_name, email, phone, birthday, anniversary_date, notes, marketing_consent } = req.body;
  if (!first_name || !last_name || !email) return res.status(400).json({ error: 'first_name, last_name and email required.' });
  try {
    const { rows } = await query(`
      INSERT INTO clients (first_name, last_name, email, phone, birthday, anniversary_date, notes, marketing_consent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [first_name, last_name, email, phone||null, birthday||null, anniversary_date||null, notes||null, marketing_consent||false]);
    const newClient = rows[0];
    await query(`
      INSERT INTO client_loyalty (client_id, threshold, discount_pct)
      VALUES ($1, 3, 10) ON CONFLICT DO NOTHING
    `, [newClient.id]);
    res.status(201).json(newClient);
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A client with this email already exists.' });
    res.status(500).json({ error: 'Failed to create client.' });
  }
});

// ── PATCH /clients/:id ──────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['first_name','last_name','email','phone','birthday','anniversary_date','notes','marketing_consent','status'];
  const updates = [];
  const values = [];
  let i = 1;
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      updates.push(`${k}=$${i++}`);
      values.push(req.body[k]);
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update.' });
  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE clients SET ${updates.join(',')} WHERE id=$${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to update client.' }); }
});

// ── PATCH /clients/:id/status ───────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['lead','prospect','active','delivered','archived'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const { rows } = await query(
      `UPDATE clients SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to update status.' }); }
});

// ── DELETE /clients/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { delete_projects, delete_galleries, delete_invoices } = {...req.query, ...req.body};
  const id = req.params.id;
  try {
    if (delete_galleries === true || delete_galleries === 'true') {
      const { rows: gals } = await query('SELECT id FROM galleries WHERE client_id=$1', [id]);
      for (const g of gals) {
        await query('DELETE FROM photos WHERE gallery_id=$1', [g.id]);
      }
      await query('DELETE FROM galleries WHERE client_id=$1', [id]);
    }
    if (delete_projects === true || delete_projects === 'true') {
      await query('DELETE FROM project_stage_log WHERE project_id IN (SELECT id FROM projects WHERE client_id=$1)', [id]);
      await query('DELETE FROM projects WHERE client_id=$1', [id]);
    }
    if (delete_invoices === true || delete_invoices === 'true') {
      await query('DELETE FROM payment_installments WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id=$1)', [id]);
      await query('DELETE FROM invoices WHERE client_id=$1', [id]);
      await query('DELETE FROM quotes WHERE client_id=$1', [id]);
    }
    await query('DELETE FROM client_loyalty WHERE client_id=$1', [id]);
    await query('DELETE FROM contracts WHERE client_id=$1', [id]);
    await query('DELETE FROM email_log WHERE client_id=$1', [id]);
    await query('DELETE FROM bookings WHERE email=(SELECT email FROM clients WHERE id=$1)', [id]);
    await query('DELETE FROM clients WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete client: ' + e.message }); }
});

// ── GET /clients/:id/emails ──────────────────────────────────────────────────
router.get('/:id/emails', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT subject, email_type, direction, sent_at, created_at, to_email, from_email
         FROM email_log
         WHERE client_id = $1
         ORDER BY COALESCE(sent_at, created_at) DESC
         LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load emails.' }); }
});

// ── POST /clients/reset-all — danger: wipe all CRM/business data ────────────
router.post('/reset-all', async (req, res) => {
  const { confirmation } = req.body;
  if (confirmation !== 'RESET') return res.status(400).json({ error: 'Confirmation required.' });
  try {
    const tables = ['email_log','client_loyalty','photos','galleries','payment_installments',
      'payment_plans','invoices','quotes','contracts','questionnaires','projects','bookings','clients'];
    for (const t of tables) {
      await query(`DELETE FROM ${t}`).catch(() => {});
    }
    res.json({ success: true, message: 'All data reset.' });
  } catch(e) { res.status(500).json({ error: 'Reset failed: ' + e.message }); }
});

module.exports = router;
