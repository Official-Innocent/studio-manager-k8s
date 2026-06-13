'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const sharp   = require('sharp');
const { requireAdmin } = require('../middleware/auth');
const { portfolioUploadsTotal } = require('../metrics');
const router = express.Router();

const PORTFOLIO_DIR = process.env.PORTFOLIO_DIR || '/data/portfolio';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── GET /portfolio — list public portfolio photos ───────────────────────────
router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(PORTFOLIO_DIR)) return res.json({ photos: [] });
    const files = fs.readdirSync(PORTFOLIO_DIR)
      .filter(f => /^opt_.*\.(jpg|jpeg|png)$/i.test(f))
      .sort();
    res.json({ photos: files.map(f => '/assets/portfolio/' + f) });
  } catch (e) {
    res.json({ photos: [] });
  }
});

// ── POST /portfolio/upload — admin: upload + optimise photos ─────────────────
router.post('/upload', requireAdmin, (req, res) => {
  upload.array('photos', 20)(req, res, async function (err) {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });

    if (!fs.existsSync(PORTFOLIO_DIR)) fs.mkdirSync(PORTFOLIO_DIR, { recursive: true });

    const results = [];
    for (const file of req.files) {
      const name = 'opt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.jpg';
      const out = path.join(PORTFOLIO_DIR, name);
      await sharp(file.buffer)
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toFile(out);
      results.push(name);
      portfolioUploadsTotal.inc();
    }
    res.json({ success: true, uploaded: results.length, files: results });
  });
});

// ── DELETE /portfolio/:filename — admin: remove a photo ───────────────────────
router.delete('/:filename', requireAdmin, (req, res) => {
  if (!/^opt_.*\.(jpg|jpeg|png)$/i.test(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const file = path.join(PORTFOLIO_DIR, req.params.filename);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ── PATCH /portfolio/reorder — admin: persist display order ──────────────────
// Stores the desired filename order in site_settings under key 'portfolio_order'.
// GET / returns alphabetical order by default; frontends that care about order
// should read 'portfolio_order' from /site-content and sort client-side.
router.patch('/reorder', requireAdmin, async (req, res) => {
  const { order } = req.body; // array of filenames, desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of filenames' });
  try {
    const { query } = require('../config/database');
    await query(`
      INSERT INTO site_settings (key, value, updated_at) VALUES ('portfolio_order', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [JSON.stringify(order)]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save order.' });
  }
});

module.exports = router;
