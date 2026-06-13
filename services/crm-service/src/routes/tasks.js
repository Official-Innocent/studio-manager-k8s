'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /tasks — list (optionally filter by status) ───────────────────────────
router.get('/', async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE t.status=$1';
    }
    const { rows } = await query(`
      SELECT t.*, c.first_name, c.last_name, c.email
      FROM tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      ${where}
      ORDER BY
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load tasks.' }); }
});

// ── POST /tasks — create a task ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { type, title, description, priority, client_id, booking_id, project_id, due_date } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'type and title required.' });
  try {
    const { rows } = await query(`
      INSERT INTO tasks (type, title, description, priority, client_id, booking_id, project_id, due_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [type, title, description||null, priority||'medium', client_id||null, booking_id||null, project_id||null, due_date||null]);
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to create task.' }); }
});

// ── PATCH /tasks/:id — update a task ─────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['title','description','priority','status','due_date'];
  const updates = [];
  const values = [];
  let i = 1;
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      updates.push(`${k}=$${i++}`);
      values.push(req.body[k]);
    }
  });
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.params.id);
  try {
    const { rows } = await query(
      `UPDATE tasks SET ${updates.join(',')}, updated_at=NOW() WHERE id=$${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to update task.' }); }
});

// ── POST /tasks/:id/dismiss — mark task dismissed/done ────────────────────────
router.post('/:id/dismiss', async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE tasks SET status='dismissed', dismissed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to dismiss task.' }); }
});

// ── DELETE /tasks/:id ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete task.' }); }
});

module.exports = router;
