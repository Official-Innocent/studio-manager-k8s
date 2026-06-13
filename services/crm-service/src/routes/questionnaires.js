'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin, requireClient } = require('../middleware/auth');
const { publish } = require('../redis');
const router = express.Router();

// ── GET /questionnaires — admin list ──────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT q.*, c.first_name, c.last_name, c.email,
        p.title as project_title, p.session_type
      FROM questionnaires q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      ORDER BY q.created_at DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load questionnaires.' }); }
});

// ── POST /questionnaires — admin: create ──────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { project_id, client_id, template_id, title } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    let questions = [];
    let finalTitle = title || 'Pre-Shoot Questionnaire';
    if (template_id) {
      const { rows: tmpl } = await query('SELECT * FROM questionnaire_templates WHERE id=$1', [template_id]);
      if (tmpl.length) {
        questions = typeof tmpl[0].questions === 'string' ? JSON.parse(tmpl[0].questions) : tmpl[0].questions;
        finalTitle = title || tmpl[0].name;
      }
    }
    const { rows } = await query(`
      INSERT INTO questionnaires (project_id, client_id, template_id, title, questions, answers, status)
      VALUES ($1,$2,$3,$4,$5,'{}','draft') RETURNING *
    `, [project_id||null, client_id, template_id||null, finalTitle, JSON.stringify(questions)]);
    res.status(201).json({ success: true, questionnaire: rows[0] });
  } catch(e) { res.status(500).json({ error: 'Failed to create questionnaire.' }); }
});

// ── GET /questionnaires/project/:projectId ────────────────────────────────────
router.get('/project/:projectId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM questionnaires WHERE project_id=$1 ORDER BY created_at DESC', [req.params.projectId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// ── GET /questionnaires/client/:clientId — portal ─────────────────────────────
router.get('/client/:clientId', requireClient, async (req, res) => {
  if (req.clientId !== req.params.clientId) return res.status(403).json({ error: 'Not authorised.' });
  try {
    const { rows } = await query(
      "SELECT * FROM questionnaires WHERE client_id=$1 AND status IN ('sent','completed') ORDER BY created_at DESC",
      [req.clientId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// ── GET /questionnaires/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT q.*, c.first_name, c.last_name, p.title as project_title
      FROM questionnaires q
      LEFT JOIN clients c ON c.id = q.client_id
      LEFT JOIN projects p ON p.id = q.project_id
      WHERE q.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load.' }); }
});

// ── POST /questionnaires/:id/send — admin: send to client ─────────────────────
router.post('/:id/send', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT q.*, c.first_name, c.email
      FROM questionnaires q
      JOIN clients c ON c.id = q.client_id
      WHERE q.id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    const q = rows[0];
    await query("UPDATE questionnaires SET status='sent', sent_at=NOW() WHERE id=$1", [req.params.id]);

    await publish('questionnaire.sent', {
      client: { email: q.email, first_name: q.first_name },
      questionnaire: { id: q.id, title: q.title },
    });

    res.json({ success: true, sent_to: q.email });
  } catch(e) { res.status(500).json({ error: 'Failed.' }); }
});

// ── PATCH /questionnaires/:id/answers — save answers ──────────────────────────
router.patch('/:id/answers', async (req, res) => {
  const { answers, admin_notes, completed } = req.body;
  try {
    const updates = [];
    const values = [];
    let i = 1;
    if (answers !== undefined) { updates.push('answers=$'+i); i++; values.push(JSON.stringify(answers)); }
    if (admin_notes !== undefined) { updates.push('admin_notes=$'+i); i++; values.push(admin_notes); }
    if (completed) { updates.push("status='completed'"); updates.push('completed_at=NOW()'); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    values.push(req.params.id);
    await query('UPDATE questionnaires SET '+updates.join(',')+ ' WHERE id=$'+i, values);

    if (completed) {
      const { rows } = await query(`
        SELECT q.title, c.first_name, c.last_name, c.id as client_id
        FROM questionnaires q JOIN clients c ON c.id=q.client_id WHERE q.id=$1
      `, [req.params.id]);
      if (rows.length) {
        const r = rows[0];
        await query('INSERT INTO email_log(client_id,subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [r.client_id, 'Questionnaire completed: '+r.title,
           r.first_name+' '+r.last_name+' completed the questionnaire: '+r.title,
           'thephotographerltd@gmail.com','thephotographerltd@gmail.com','questionnaire_completed','inbound']);
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to save answers.' }); }
});

module.exports = router;
