'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /orders — admin: list all print orders ────────────────────────────────
// Ported from the monolith's routes/store.js GET /api/store/orders.
router.get('/orders', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT o.*, c.first_name, c.last_name, c.email
      FROM print_orders o
      LEFT JOIN clients c ON c.id = o.client_id
      ORDER BY o.created_at DESC LIMIT 100
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load orders.' }); }
});

module.exports = router;
