'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── Contract Templates ─────────────────────────────────────────────────────

router.get('/contract-templates', async (req, res) => {
  try {
    const { rows } = await query('SELECT id, name, contract_type, is_default, created_at FROM contract_templates ORDER BY is_default DESC, name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load templates.' }); }
});

router.get('/contract-templates/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contract_templates WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load template.' }); }
});

router.post('/contract-templates', async (req, res) => {
  const { name, contract_type, body, is_default } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'Name and body required.' });
  try {
    const { rows } = await query(`
      INSERT INTO contract_templates (name, contract_type, body, is_default)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [name, contract_type||'general', body, !!is_default]);
    res.status(201).json({ success: true, template: rows[0] });
  } catch(e) { res.status(500).json({ error: 'Failed to create template.' }); }
});

router.patch('/contract-templates/:id', async (req, res) => {
  const { name, contract_type, body, is_default } = req.body;
  try {
    await query(`UPDATE contract_templates SET
      name=COALESCE($1,name), contract_type=COALESCE($2,contract_type),
      body=COALESCE($3,body), is_default=COALESCE($4,is_default), updated_at=NOW()
      WHERE id=$5`,
      [name||null, contract_type||null, body||null, is_default!==undefined?!!is_default:null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update template.' }); }
});

router.delete('/contract-templates/:id', async (req, res) => {
  try {
    await query('DELETE FROM contract_templates WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete template.' }); }
});

// ── Questionnaire Templates ───────────────────────────────────────────────────

router.get('/questionnaire-templates', async (req, res) => {
  try {
    const { rows } = await query('SELECT id, name, session_type, created_at FROM questionnaire_templates ORDER BY name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load questionnaire templates.' }); }
});

router.get('/questionnaire-templates/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM questionnaire_templates WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load template.' }); }
});

router.post('/questionnaire-templates', async (req, res) => {
  const { name, session_type, questions } = req.body;
  if (!name || !questions) return res.status(400).json({ error: 'Name and questions required.' });
  try {
    const { rows } = await query(`
      INSERT INTO questionnaire_templates (name, session_type, questions)
      VALUES ($1,$2,$3) RETURNING *
    `, [name, session_type||null, JSON.stringify(questions)]);
    res.status(201).json({ success: true, template: rows[0] });
  } catch(e) { res.status(500).json({ error: 'Failed to create template.' }); }
});

router.patch('/questionnaire-templates/:id', async (req, res) => {
  const { name, session_type, questions } = req.body;
  try {
    await query(`UPDATE questionnaire_templates SET
      name=COALESCE($1,name), session_type=COALESCE($2,session_type),
      questions=COALESCE($3,questions)
      WHERE id=$4`,
      [name||null, session_type||null, questions ? JSON.stringify(questions) : null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update template.' }); }
});

router.delete('/questionnaire-templates/:id', async (req, res) => {
  try {
    await query('DELETE FROM questionnaire_templates WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete template.' }); }
});

module.exports = router;
