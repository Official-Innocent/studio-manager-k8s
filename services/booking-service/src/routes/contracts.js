'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { query } = require('../config/database');
const { requireAdmin, requireClient } = require('../middleware/auth');
const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';

// Multer for signed PDF uploads
const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, 'contracts');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `contract-${req.params.id}-signed-${Date.now()}.pdf`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files accepted'));
  }
});

// Fill template variables
function fillTemplate(body, vars) {
  return body
    .replace(/{{CLIENT_NAME}}/g,       vars.client_name    || '')
    .replace(/{{SESSION_DATE}}/g,       vars.session_date   || '')
    .replace(/{{SESSION_TYPE}}/g,       vars.session_type   || '')
    .replace(/{{SESSION_LOCATION}}/g,   vars.session_location || '')
    .replace(/{{TOTAL_AMOUNT}}/g,       vars.total_amount   || '')
    .replace(/{{DEPOSIT_AMOUNT}}/g,     vars.deposit_amount || '')
    .replace(/{{BALANCE_DUE_DATE}}/g,   vars.balance_due    || '');
}

// ── GET /api/contracts — Admin: list all ─────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.*, cl.first_name, cl.last_name, cl.email,
        p.title as project_title, p.session_type, p.session_date
      FROM contracts c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load contracts.' }); }
});

// ── POST /api/contracts — Admin: create from template ─────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { project_id, client_id, template_id, contract_type, title, custom_body } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required.' });
  try {
    let body = custom_body || '';
    if (template_id && !custom_body) {
      const { rows: tmpl } = await query('SELECT * FROM contract_templates WHERE id=$1', [template_id]);
      if (tmpl.length) {
        // Get client details
        const { rows: clientRows } = await query(
          'SELECT first_name, last_name FROM clients WHERE id=$1', [client_id]
        );
        const cl = clientRows[0] || {};
        // Get project details if project_id provided
        let proj = {};
        if (project_id) {
          const { rows: projRows } = await query(
            'SELECT * FROM projects WHERE id=$1', [project_id]
          );
          proj = projRows[0] || {};
          // Get deposit invoice if exists
          const { rows: invRows } = await query(
            "SELECT deposit_amt, total FROM invoices WHERE project_id=$1 AND invoice_type='deposit' ORDER BY created_at DESC LIMIT 1",
            [project_id]
          );
          if (invRows.length) {
            proj.deposit_amt = invRows[0].deposit_amt;
            proj.inv_total   = invRows[0].total;
          }
        }
        const clientName = [cl.first_name, cl.last_name].filter(Boolean).join(' ');
        body = fillTemplate(tmpl[0].body, {
          client_name:      clientName || 'Client',
          session_date:     proj.session_date
            ? new Date(proj.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
            : 'TBC',
          session_type:     proj.session_type     || 'TBC',
          session_location: proj.session_location || 'TBC',
          total_amount:     proj.amount_quoted
            ? '£' + parseFloat(proj.amount_quoted).toFixed(2)
            : 'TBC',
          deposit_amount:   proj.deposit_amt
            ? '£' + parseFloat(proj.deposit_amt).toFixed(2)
            : proj.amount_quoted
              ? '£' + (parseFloat(proj.amount_quoted) * 0.25).toFixed(2) + ' (25%)'
              : 'TBC',
          balance_due:      proj.balance_due_date
            ? new Date(proj.balance_due_date).toLocaleDateString('en-GB')
            : 'TBC',
        });
        if (!title) title = tmpl[0].name + ' — ' + clientName;
      }
    }
    const { rows } = await query(`
      INSERT INTO contracts (project_id, client_id, template_id, contract_type, title, body, status)
      VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING *
    `, [project_id||null, client_id, template_id||null, contract_type||'general', title||'Photography Contract', body]);
    res.status(201).json({ success: true, contract: rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Failed to create contract.' }); }
});

// ── GET /api/contracts/project/:projectId ─────────────────────────────────────
router.get('/project/:projectId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM contracts WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load contracts.' }); }
});

// ── GET /api/contracts/client/:clientId — Portal: client's contracts ──────────
router.get('/client/:clientId', requireClient, async (req, res) => {
  if (req.clientId !== req.params.clientId) return res.status(403).json({ error: 'Not authorised.' });
  try {
    const { rows } = await query(
      "SELECT * FROM contracts WHERE client_id=$1 AND status IN ('sent','signed') ORDER BY created_at DESC",
      [req.clientId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load contracts.' }); }
});


// ── DELETE /api/contracts/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM contracts WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete contract.' }); }
});


// ── GET /api/contracts/templates — Admin: list all templates ──────────────────
router.get('/templates', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contract_templates ORDER BY is_default DESC, name ASC');
    res.json({ templates: rows });
  } catch(err) {
    res.status(500).json({ error: 'Failed to load templates.' });
  }
});
module.exports = router;
// ── GET /api/contracts/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.*, cl.first_name, cl.last_name, cl.email,
        p.title as project_title
      FROM contracts c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contract not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load contract.' }); }
});

// ── PATCH /api/contracts/:id — Admin: update body/title ───────────────────────
router.patch('/:id', requireAdmin, async (req, res) => {
  const { title, body, status } = req.body;
  try {
    await query(`UPDATE contracts SET
      title=COALESCE($1,title), body=COALESCE($2,body),
      status=COALESCE($3,status), updated_at=NOW() WHERE id=$4`,
      [title||null, body||null, status||null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update contract.' }); }
});

// ── POST /api/contracts/:id/send — Admin: mark as sent ────────────────────────
router.post('/:id/send', requireAdmin, async (req, res) => {
  try {
    await query("UPDATE contracts SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to send contract.' }); }
});

// ── POST /api/contracts/:id/sign — Client: sign digitally ────────────────────
router.post('/:id/sign', requireClient, async (req, res) => {
  const { client_name, signature } = req.body;
  if (!client_name || !signature) return res.status(400).json({ error: 'Name and signature required.' });
  try {
    const { rows } = await query('SELECT * FROM contracts WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contract not found.' });
    if (rows[0].client_id !== req.clientId) return res.status(403).json({ error: 'Not authorised.' });
    await query(`UPDATE contracts SET
      status='signed', client_name_signed=$1, client_signature=$2,
      signed_at=NOW(), updated_at=NOW() WHERE id=$3`,
      [client_name, signature, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to sign contract.' }); }
});

// ── POST /api/contracts/:id/upload-signed — Upload signed PDF ────────────────
router.post('/:id/upload-signed', pdfUpload.single('signed_pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const filePath = `/uploads/contracts/${req.file.filename}`;
    await query(`UPDATE contracts SET
      status='signed', client_signature=$1, signed_at=NOW(), updated_at=NOW()
      WHERE id=$2`,
      ['pdf:' + filePath, req.params.id]);
    res.json({ success: true, file: filePath });
  } catch(e) { res.status(500).json({ error: 'Upload failed.' }); }
});

