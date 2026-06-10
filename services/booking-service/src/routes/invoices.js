'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /api/invoices ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, client_id } = req.query;
  try {
    // Auto-mark overdue first
    await query(`UPDATE invoices SET status='overdue'
      WHERE status='sent' AND due_date < CURRENT_DATE AND amount_paid < total`);
    let q = `SELECT i.*, c.first_name, c.last_name, c.email, p.title as project_title
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id WHERE 1=1`;
    const params = [];
    if (status) { q += ` AND i.status=$${params.length+1}`; params.push(status); }
    if (client_id) { q += ` AND i.client_id=$${params.length+1}`; params.push(client_id); }
    q += ' ORDER BY i.created_at DESC';
    const { rows } = await query(q, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load invoices.' }); }
});

// ── POST /api/invoices ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { project_id, client_id, quote_id, invoice_type, line_items, subtotal, discount_pct,
    discount_amt, total, deposit_pct, deposit_amt, due_date, bank_sort_code, bank_account,
    monzo_link, payment_ref, notes, client_message } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: ctr } = await query(
      'UPDATE doc_counters SET last_num=last_num+1 WHERE doc_type=\'invoice\' RETURNING last_num');
    const invoiceNumber = 'INV-' + ctr[0].last_num;
    const items = Array.isArray(line_items) ? line_items : [];
    const calc_subtotal = subtotal || items.reduce((s,i)=>s+(i.total||0),0);
    const disc = discount_amt || (calc_subtotal * (discount_pct||0) / 100);
    const calc_total = total || (calc_subtotal - disc);
    const dep_pct = deposit_pct || 25;
    const dep_amt = deposit_amt || Math.round(calc_total * dep_pct / 100 * 100) / 100;
    const { rows } = await query(`
      INSERT INTO invoices (project_id, client_id, quote_id, invoice_number, invoice_type,
        line_items, subtotal, discount_pct, discount_amt, total, deposit_pct, deposit_amt,
        due_date, bank_sort_code, bank_account, monzo_link, payment_ref, notes, client_message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *
    `, [project_id||null, client_id, quote_id||null, invoiceNumber, invoice_type||'deposit',
      JSON.stringify(items), calc_subtotal, discount_pct||0, disc, calc_total,
      dep_pct, dep_amt, due_date||null, bank_sort_code||null, bank_account||null,
      monzo_link||null, payment_ref||null, notes||null, client_message||null]);
    res.status(201).json({ success: true, invoice: rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Failed to create invoice.' }); }
});

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.*, c.first_name, c.last_name, c.email, c.phone,
        p.title as project_title, p.session_type, p.session_date, p.session_location
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load invoice.' }); }
});

// ── PATCH /api/invoices/:id ───────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['status','line_items','subtotal','discount_pct','discount_amt','total',
    'deposit_pct','deposit_amt','amount_paid','due_date','paid_at','payment_method',
    'bank_sort_code','bank_account','monzo_link','payment_ref','notes','client_message'];
  const updates = []; const values = []; let i = 1;
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      updates.push(`${k}=$${i++}`);
      values.push(k === 'line_items' ? JSON.stringify(req.body[k]) : req.body[k]);
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.params.id);
  try {
    await query(`UPDATE invoices SET ${updates.join(',')},updated_at=NOW() WHERE id=$${i}`, values);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update invoice.' }); }
});

// ── POST /api/invoices/:id/send ───────────────────────────────────────────────
router.post('/:id/send', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.*, c.first_name, c.last_name, c.email
      FROM invoices i LEFT JOIN clients c ON c.id=i.client_id
      WHERE i.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found.' });
    await query('UPDATE invoices SET status=\'sent\',sent_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Invoice marked as sent.' });
  } catch(e) { res.status(500).json({ error: 'Failed to send invoice.' }); }
});

// ── POST /api/invoices/:id/mark-paid ─────────────────────────────────────────
router.post('/:id/mark-paid', async (req, res) => {
  const { amount, method, ref } = req.body;
  try {
    await query(`UPDATE invoices SET status='paid', amount_paid=$1, paid_at=NOW(),
      payment_method=$2, payment_ref=$3, updated_at=NOW() WHERE id=$4`,
      [amount, method||'bank_transfer', ref||null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to mark paid.' }); }
});

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete invoice.' }); }
});

module.exports = router;
