'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// ── GET /site-content — public: all site_settings as key/value map ───────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await query('SELECT key, value FROM site_settings ORDER BY key');
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });
    res.json(out);
  } catch (e) {
    console.error('[site-content]', e.message);
    res.status(500).json({ error: 'Failed.' });
  }
});

// ── PUT /site-content/:key — admin: upsert a single setting ──────────────────
router.put('/:key', requireAdmin, async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required.' });
  try {
    await query(`
      INSERT INTO site_settings (key, value, updated_at) VALUES ($1,$2,NOW())
      ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
    `, [req.params.key, typeof value === 'string' ? value : JSON.stringify(value)]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update setting.' });
  }
});

// ── DELETE /site-content/:key — admin: remove a setting ───────────────────────
router.delete('/:key', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM site_settings WHERE key=$1', [req.params.key]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete setting.' });
  }
});

module.exports = router;
