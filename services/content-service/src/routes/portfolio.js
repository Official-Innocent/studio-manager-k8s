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
router.get('/', async (req, res) => {
  try {
    if (!fs.existsSync(PORTFOLIO_DIR)) return res.json({ photos: [] });
    const files = fs.readdirSync(PORTFOLIO_DIR)
      .filter(f => /^opt_.*\.(jpg|jpeg|png)$/i.test(f));
    const category = req.query.category;
    const carouselOnly = req.query.carousel === 'true';
    try {
      const { query } = require('../config/database');
      const r = await query("SELECT value FROM site_settings WHERE key='portfolio_order'");
      const ord = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
      let sorted = ord.filter(f => files.includes(f)).concat(files.filter(f => !ord.includes(f)));
      let catMap = {};
      try {
        const rc = await query("SELECT value FROM site_settings WHERE key='portfolio_categories'");
        catMap = rc.rows[0] ? JSON.parse(rc.rows[0].value) : {};
      } catch(e) {}
      if (category) {
        sorted = sorted.filter(f => (catMap[f] || 'uncategorized') === category);
      }
      if (carouselOnly) {
        let carouselRow = null;
        try {
          const rcar = await query("SELECT value FROM site_settings WHERE key='portfolio_carousel'");
          carouselRow = rcar.rows[0] || null;
        } catch(e) {}
        if (carouselRow) {
          const carouselSet = JSON.parse(carouselRow.value);
          sorted = sorted.filter(f => carouselSet.includes(f));
        }
        // If the setting has never been saved, default to showing everything
        // (so the carousel isn't empty before an admin makes a first selection).
      }
      return res.json({ photos: sorted.map(f => '/assets/portfolio/' + f) });
    } catch(e) {
      let files2 = files.sort();
      return res.json({ photos: files2.map(f => '/assets/portfolio/' + f) });
    }
  } catch (e) {
    res.json({ photos: [] });
  }
});
// ── GET /portfolio/categories — admin: list current category assignments ────
router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const r = await query("SELECT value FROM site_settings WHERE key='portfolio_categories'");
    const catMap = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    res.json({ categories: catMap });
  } catch (e) {
    res.json({ categories: {} });
  }
});
// ── PATCH /portfolio/:filename/category — admin: assign a category ──────────
router.patch('/:filename/category', requireAdmin, async (req, res) => {
  const { category } = req.body;
  if (!/^opt_.*\.(jpg|jpeg|png)$/i.test(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  try {
    const { query } = require('../config/database');
    const r = await query("SELECT value FROM site_settings WHERE key='portfolio_categories'");
    const catMap = r.rows[0] ? JSON.parse(r.rows[0].value) : {};
    if (category) catMap[req.params.filename] = category;
    else delete catMap[req.params.filename];
    await query(`
      INSERT INTO site_settings (key, value, updated_at) VALUES ('portfolio_categories', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [JSON.stringify(catMap)]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save category.' });
  }
});

// ── GET /portfolio/carousel — admin: list current carousel selections ───────
router.get('/carousel', requireAdmin, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const r = await query("SELECT value FROM site_settings WHERE key='portfolio_carousel'");
    const carouselSet = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
    res.json({ carousel: carouselSet });
  } catch (e) {
    res.json({ carousel: [] });
  }
});
// ── PATCH /portfolio/:filename/carousel — admin: toggle carousel inclusion ──
router.patch('/:filename/carousel', requireAdmin, async (req, res) => {
  const { include } = req.body;
  if (!/^opt_.*\.(jpg|jpeg|png)$/i.test(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  try {
    const { query } = require('../config/database');
    const r = await query("SELECT value FROM site_settings WHERE key='portfolio_carousel'");
    let carouselSet = r.rows[0] ? JSON.parse(r.rows[0].value) : [];
    if (include) {
      if (!carouselSet.includes(req.params.filename)) carouselSet.push(req.params.filename);
    } else {
      carouselSet = carouselSet.filter(f => f !== req.params.filename);
    }
    await query(`
      INSERT INTO site_settings (key, value, updated_at) VALUES ('portfolio_carousel', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [JSON.stringify(carouselSet)]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save carousel selection.' });
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
router.patch('/reorder', requireAdmin, async (req, res) => {
  const { order } = req.body;
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
