'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { publish } = require('../redis');
const { stageTransitionsTotal } = require('../metrics');
const router = express.Router();
router.use(requireAdmin);

// Stage transition rules - what gets triggered at each stage
const STAGE_TRIGGERS = {
  quote_sent:       { doc: 'quote',          emailTemplate: 'quote_sent' },
  invoice_sent:     { doc: 'invoice',        emailTemplate: 'invoice_sent' },
  project_covered:  { doc: 'questionnaire',  emailTemplate: 'questionnaire_sent' },
  post_production:  { doc: 'contract',       emailTemplate: 'contract_sent' },
  completed:        { doc: 'receipt',        emailTemplate: 'session_complete' },
};

// ── GET /projects — list all projects ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*,
        c.first_name, c.last_name, c.email, c.phone,
        (SELECT COUNT(*) FROM invoices i WHERE i.project_id = p.id) as invoice_count,
        (SELECT COUNT(*) FROM quotes q WHERE q.project_id = p.id) as quote_count,
        (SELECT status FROM invoices i WHERE i.project_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_invoice_status
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY p.session_date ASC NULLS LAST, p.updated_at DESC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load projects.' }); }
});

// ── POST /projects — create project ────────────────────────────────────────
router.post('/', async (req, res) => {
  const { client_id, booking_id, title, session_type, session_date, notes, amount_quoted, stage } = req.body;
  if (!client_id || !title) return res.status(400).json({ error: 'client_id and title required.' });
  try {
    const { rows } = await query(`
      INSERT INTO projects (client_id, booking_id, title, session_type, session_date, notes, amount_quoted, stage)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [client_id, booking_id||null, title, session_type||null, session_date||null, notes||null, amount_quoted||null, stage||'lead']);
    res.status(201).json({ success: true, project: rows[0] });
  } catch(e) { res.status(500).json({ error: 'Failed to create project.' }); }
});

// ── GET /projects/:id — single project ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*, c.first_name, c.last_name, c.email, c.phone
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load project.' }); }
});

// ── PATCH /projects/:id — update project ─────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['title','session_type','session_date','notes','amount_quoted','amount_invoiced','amount_paid','cover_photo','stage','session_location','delivery_due_date'];
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
    await query(`UPDATE projects SET ${updates.join(',')}, updated_at=NOW() WHERE id=$${i}`, values);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update project.' }); }
});

// ── POST /projects/:id/stage — move stage ──────────────────────────────────
router.post('/:id/stage', async (req, res) => {
  const { to_stage, skip_email, skip_doc, override_message } = req.body;
  const validStages = ['lead','quote_sent','invoice_sent','project_covered','post_production','completed','cancelled'];
  if (!validStages.includes(to_stage)) return res.status(400).json({ error: 'Invalid stage.' });
  try {
    const { rows: projRows } = await query(`
      SELECT p.*, c.first_name, c.last_name, c.email
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!projRows.length) return res.status(404).json({ error: 'Project not found.' });
    const project = projRows[0];
    const from_stage = project.stage;
    const trigger = STAGE_TRIGGERS[to_stage];

    // Update stage
    await query('UPDATE projects SET stage=$1, updated_at=NOW() WHERE id=$2', [to_stage, req.params.id]);
    stageTransitionsTotal.inc({ to_stage });

    // Log the stage change
    await query(`
      INSERT INTO project_stage_log (project_id, from_stage, to_stage, triggered_doc, email_sent)
      VALUES ($1,$2,$3,$4,$5)
    `, [req.params.id, from_stage, to_stage, trigger?.doc||null, !skip_email]);

    let docCreated = null;

    // Create document if trigger exists and not skipped
    if (trigger && !skip_doc) {
      if (to_stage === 'invoice_sent') {
        const { rows: quoteRows } = await query(
          "SELECT * FROM quotes WHERE project_id=$1 AND status='accepted' ORDER BY created_at DESC LIMIT 1",
          [req.params.id]
        );
        const quote = quoteRows[0];
        const { rows: counter } = await query(
          "UPDATE doc_counters SET last_num=last_num+1 WHERE doc_type='invoice' RETURNING last_num"
        );
        const invoiceNum = 'INV-' + counter[0].last_num;
        const { rows: invRows } = await query(`
          INSERT INTO invoices (project_id, client_id, quote_id, invoice_number, status,
            line_items, subtotal, total, deposit_pct, deposit_amt, due_date, client_message)
          VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11) RETURNING *
        `, [
          req.params.id, project.client_id, quote?.id||null, invoiceNum,
          quote?.line_items || JSON.stringify([{description: project.title, quantity: 1, unit_price: project.amount_quoted||0, total: project.amount_quoted||0}]),
          quote?.subtotal || project.amount_quoted || 0,
          quote?.total    || project.amount_quoted || 0,
          25,
          Math.round((quote?.total || project.amount_quoted || 0) * 0.25 * 100) / 100,
          new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
          override_message || null,
        ]);
        docCreated = { type: 'invoice', data: invRows[0] };
        await query("UPDATE invoices SET status='sent', sent_at=NOW() WHERE id=$1", [invRows[0].id]);
      }

      if (to_stage === 'quote_sent') {
        const { rows: counter } = await query(
          "UPDATE doc_counters SET last_num=last_num+1 WHERE doc_type='quote' RETURNING last_num"
        );
        const quoteNum = 'QTE-' + counter[0].last_num;
        const { rows: qRows } = await query(`
          INSERT INTO quotes (project_id, client_id, quote_number, status, line_items, subtotal, total, valid_until, notes)
          VALUES ($1,$2,$3,'sent',$4,$5,$6,$7,$8) RETURNING *
        `, [
          req.params.id, project.client_id, quoteNum,
          JSON.stringify([{description: project.title + (project.session_type ? ' - ' + project.session_type : ''), quantity: 1, unit_price: project.amount_quoted||0, total: project.amount_quoted||0}]),
          project.amount_quoted || 0,
          project.amount_quoted || 0,
          new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0],
          override_message || null,
        ]);
        docCreated = { type: 'quote', data: qRows[0] };
      }
    }

    // Publish stage-change event for notification-service
    let emailSent = false;
    if (!skip_email && project.email) {
      await publish('project.stage_changed', {
        client: { email: project.email, first_name: project.first_name, last_name: project.last_name },
        project: { id: project.id, title: project.title },
        from_stage, to_stage,
        doc: docCreated,
        message: override_message || null,
      });
      emailSent = true;
    }

    res.json({
      success: true,
      from_stage, to_stage,
      trigger: trigger || null,
      doc_created: docCreated,
      email_sent: emailSent,
    });
  } catch(e) {
    console.error('[stage move]', e);
    res.status(500).json({ error: 'Failed to move stage.' });
  }
});

// ── DELETE /projects/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete project.' }); }
});

// ── GET /projects/:id/history — stage log ────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM project_stage_log WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load history.' }); }
});

// ── POST /projects/:id/archive — admin: archive/cancel a project ─────────────
router.post('/:id/archive', async (req, res) => {
  const { reason } = req.body;
  try {
    await query(`UPDATE projects SET stage='cancelled', archived_reason=$1, updated_at=NOW() WHERE id=$2`,
      [reason || null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to archive project.' }); }
});

module.exports = router;
