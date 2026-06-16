'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /quotes/addons — get all add-ons ──────────────────────────────────────
router.get('/addons', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM quote_addons WHERE is_active=true ORDER BY sort_order ASC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load add-ons.' }); }
});

// ── PATCH /quotes/addons/:id — update add-on price ────────────────────────────
router.patch('/addons/:id', async (req, res) => {
  const { price, name, description, is_active } = req.body;
  try {
    const { rows } = await query(
      `UPDATE quote_addons SET
        price=COALESCE($1,price),
        name=COALESCE($2,name),
        description=COALESCE($3,description),
        is_active=COALESCE($4,is_active)
       WHERE id=$5 RETURNING *`,
      [price, name, description, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to update add-on.' }); }
});

// ── GET /quotes — list all quotes ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT q.*, c.first_name, c.last_name, c.email, p.title as project_title
      FROM quotes q
      LEFT JOIN clients c ON c.id=q.client_id
      LEFT JOIN projects p ON p.id=q.project_id
      ORDER BY q.created_at DESC`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load quotes.' }); }
});

// ── POST /quotes — create quote ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { project_id, client_id, line_items, subtotal, discount_pct, discount_amt, total, valid_until, notes, client_message } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    const { rows: ctr } = await query("UPDATE doc_counters SET last_num=last_num+1 WHERE doc_type='quote' RETURNING last_num");
    const quoteNumber = 'QTE-' + ctr[0].last_num;
    const items = Array.isArray(line_items) ? line_items : [];
    const calc_sub = subtotal || items.reduce((s,i)=>s+(i.total||0),0);
    const disc = discount_amt || (calc_sub*(discount_pct||0)/100);
    const calc_total = total || (calc_sub - disc);
    const { rows } = await query(`
      INSERT INTO quotes (project_id,client_id,quote_number,line_items,subtotal,discount_pct,discount_amt,total,valid_until,notes,client_message,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [project_id||null,client_id,quoteNumber,JSON.stringify(items),calc_sub,discount_pct||0,disc,calc_total,valid_until||null,notes||null,client_message||null,req.body.status||'draft']);
    res.status(201).json({ success: true, quote: rows[0] });
  } catch(e) { res.status(500).json({ error: 'Failed to create quote.' }); }
});

// ── GET /quotes/:id — get single quote ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT q.*, c.first_name, c.last_name, c.email, c.phone, p.title as project_title
      FROM quotes q LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN projects p ON p.id=q.project_id
      WHERE q.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Quote not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load quote.' }); }
});

// ── PATCH /quotes/:id — update quote ───────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['status','line_items','subtotal','discount_pct','discount_amt','total','valid_until','notes','client_message'];
  const updates=[]; const values=[]; let i=1;
  allowed.forEach(k => { if(req.body[k]!==undefined){ updates.push(`${k}=$${i++}`); values.push(k==='line_items'?JSON.stringify(req.body[k]):req.body[k]); }});
  if(!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.params.id);
  try {
    await query(`UPDATE quotes SET ${updates.join(',')},updated_at=NOW() WHERE id=$${i}`, values);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update quote.' }); }
});

// ── POST /quotes/:id/accept — mark quote accepted ──────────────────────────────
router.post('/:id/accept', async (req, res) => {
  try {
    await query("UPDATE quotes SET status='accepted',accepted_at=NOW(),updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to accept quote.' }); }
});

// ── DELETE /quotes/:id — delete quote ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete quote.' }); }
});

module.exports = router;
