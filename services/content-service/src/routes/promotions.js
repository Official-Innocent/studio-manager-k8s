'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// ── GET /promotions/active — public: current active promotion banner ─────────
router.get('/active', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, type, message, eyebrow, cta_label, cta_link, bg_colour, show_countdown, ends_at
      FROM promotions
      WHERE active = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    res.json(rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load promotion.' });
  }
});

// ── GET /promotions/admin — admin: list all promotions ────────────────────────
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM promotions ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load promotions.' });
  }
});

// ── POST /promotions/admin — admin: create a promotion ─────────────────────────
router.post('/admin', requireAdmin, async (req, res) => {
  const {
    type = 'banner', message, eyebrow, cta_label, cta_link,
    bg_colour = 'gold', show_countdown = false, active = false,
    starts_at, ends_at,
  } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required.' });
  try {
    const { rows } = await query(`
      INSERT INTO promotions (type, message, eyebrow, cta_label, cta_link, bg_colour, show_countdown, active, starts_at, ends_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [type, message, eyebrow, cta_label, cta_link, bg_colour, show_countdown, active, starts_at || null, ends_at || null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create promotion.' });
  }
});

// ── PATCH /promotions/admin/:id — admin: update a promotion ────────────────────
router.patch('/admin/:id', requireAdmin, async (req, res) => {
  const fields = ['type','message','eyebrow','cta_label','cta_link','bg_colour','show_countdown','active','starts_at','ends_at'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=$${i++}`);
      values.push(req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE promotions SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Promotion not found.' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update promotion.' });
  }
});

// ── DELETE /promotions/admin/:id — admin: remove a promotion ───────────────────
router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM promotions WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete promotion.' });
  }
});

module.exports = router;
