'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { publish } = require('../redis');
const router = express.Router();
router.use(requireAdmin);

// Helper: calculate evenly spaced installment dates
function calcInstallmentDates(bookingDate, sessionDate, count, depositPct, totalAmount) {
  // Final balance due 1 week before session
  const finalDue = new Date(sessionDate);
  finalDue.setDate(finalDue.getDate() - 7);
  const start = new Date(bookingDate);
  const installments = [];

  const depositAmt = Math.round(totalAmount * depositPct / 100 * 100) / 100;
  installments.push({
    installment_num: 1,
    label: 'Booking deposit',
    amount: depositAmt,
    due_date: start.toISOString().split('T')[0],
    is_deposit: true,
    is_non_refundable: true,
  });

  const remaining = totalAmount - depositAmt;
  const remainingCount = count;
  const totalMs = finalDue - start;
  const stepMs = totalMs / (remainingCount + 1);

  for (let i = 1; i <= remainingCount; i++) {
    const dueDate = new Date(start.getTime() + stepMs * i);
    const isLast = i === remainingCount;
    const amt = isLast
      ? Math.round((remaining - installments.slice(1).reduce((s,x)=>s+x.amount,0)) * 100) / 100
      : Math.round((remaining / remainingCount) * 100) / 100;
    installments.push({
      installment_num: i + 1,
      label: isLast ? 'Final balance' : `Instalment ${i}`,
      amount: amt,
      due_date: dueDate.toISOString().split('T')[0],
      is_deposit: false,
      is_non_refundable: false,
    });
  }

  return installments;
}

// ── GET /payment-plans/project/:projectId ────────────────────────────────────
router.get('/project/:projectId', async (req, res) => {
  try {
    const { rows: plans } = await query(
      'SELECT * FROM payment_plans WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    if (!plans.length) return res.json(null);
    const plan = plans[0];
    const { rows: installments } = await query(
      'SELECT * FROM payment_installments WHERE plan_id=$1 ORDER BY installment_num',
      [plan.id]
    );
    const today = new Date().toISOString().split('T')[0];
    await query(
      "UPDATE payment_installments SET status='overdue' WHERE plan_id=$1 AND status='pending' AND due_date < $2",
      [plan.id, today]
    );
    res.json({ ...plan, installments });
  } catch(e) { res.status(500).json({ error: 'Failed to load payment plan.' }); }
});

// ── POST /payment-plans/preview — preview dates before creating ──────────────
router.post('/preview', async (req, res) => {
  const { session_date, booking_date, installment_count, deposit_pct, total_amount } = req.body;
  if (!session_date || !total_amount) return res.status(400).json({ error: 'session_date and total_amount required.' });
  try {
    const dates = calcInstallmentDates(
      booking_date || new Date().toISOString(),
      session_date,
      Math.min(Math.max(parseInt(installment_count)||1, 1), 3),
      parseFloat(deposit_pct) || 25,
      parseFloat(total_amount)
    );
    res.json({ installments: dates, total: total_amount });
  } catch(e) { res.status(500).json({ error: 'Failed to calculate dates.' }); }
});

// ── POST /payment-plans — create plan ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { project_id, client_id, total_amount, installments } = req.body;
  if (!project_id || !client_id || !total_amount || !installments?.length)
    return res.status(400).json({ error: 'project_id, client_id, total_amount and installments required.' });
  try {
    const { rows: planRows } = await query(`
      INSERT INTO payment_plans (project_id, client_id, total_amount)
      VALUES ($1,$2,$3) RETURNING *
    `, [project_id, client_id, total_amount]);
    const plan = planRows[0];

    for (const inst of installments) {
      await query(`
        INSERT INTO payment_installments
          (plan_id, project_id, client_id, installment_num, label, amount, due_date, is_deposit, is_non_refundable)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [plan.id, project_id, client_id, inst.installment_num, inst.label,
          inst.amount, inst.due_date, inst.is_deposit||false, inst.is_non_refundable||false]);
    }

    const lastInst = installments[installments.length - 1];
    await query('UPDATE projects SET balance_due_date=$1 WHERE id=$2', [lastInst.due_date, project_id]);

    const { rows: allInst } = await query(
      'SELECT * FROM payment_installments WHERE plan_id=$1 ORDER BY installment_num',
      [plan.id]
    );
    res.status(201).json({ success: true, plan: { ...plan, installments: allInst } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Failed to create payment plan.' }); }
});

// ── PATCH /payment-plans/installments/:id — update single installment ────────
router.patch('/installments/:id', async (req, res) => {
  const { amount, due_date, label } = req.body;
  try {
    await query(`UPDATE payment_installments SET
      amount=COALESCE($1,amount), due_date=COALESCE($2,due_date),
      label=COALESCE($3,label), updated_at=NOW()
      WHERE id=$4`,
      [amount||null, due_date||null, label||null, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update installment.' }); }
});

// ── POST /payment-plans/installments/:id/mark-paid ────────────────────────────
router.post('/installments/:id/mark-paid', async (req, res) => {
  const { amount, method, ref, notify } = req.body;
  try {
    const { rows } = await query('SELECT * FROM payment_installments WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Installment not found.' });
    const inst = rows[0];
    const paidAmt = parseFloat(amount) || inst.amount;

    await query(`UPDATE payment_installments SET
      status='paid', paid_at=NOW(), paid_amount=$1, payment_method=$2, payment_ref=$3, updated_at=NOW()
      WHERE id=$4`,
      [paidAmt, method||'bank_transfer', ref||null, req.params.id]);

    await query(`UPDATE payment_plans SET amount_paid=amount_paid+$1, updated_at=NOW()
      WHERE id=$2`, [paidAmt, inst.plan_id]);

    const { rows: planRows } = await query('SELECT * FROM payment_plans WHERE id=$1', [inst.plan_id]);
    const plan = planRows[0];
    if (plan.amount_paid >= plan.total_amount) {
      await query("UPDATE payment_plans SET status='completed' WHERE id=$1", [plan.id]);
    }

    // Default to sending the confirmation email unless explicitly disabled
    // (notify:false), so admins marking several installments at once can
    // suppress emails for backfilled/historic entries if needed.
    if (notify !== false) {
      try {
        const { rows: clientRows } = await query(
          'SELECT first_name, last_name, email FROM clients WHERE id=$1', [inst.client_id]
        );
        const client = clientRows[0];
        const { rows: nextInst } = await query(
          `SELECT * FROM payment_installments
           WHERE plan_id=$1 AND status='pending' ORDER BY due_date ASC LIMIT 1`,
          [inst.plan_id]
        );
        const remaining = Math.max(0, parseFloat(plan.total_amount) - parseFloat(plan.amount_paid));
        if (client) {
          await publish('payment.received', {
            client: { first_name: client.first_name, last_name: client.last_name, email: client.email },
            payment: {
              amount: paidAmt,
              method: method || 'bank_transfer',
              provider_ref: ref || null,
              id: inst.id,
              label: inst.label,
              remaining_balance: remaining,
              next_due_date: nextInst[0] ? nextInst[0].due_date : null,
              next_due_amount: nextInst[0] ? nextInst[0].amount : null,
              plan_completed: plan.amount_paid >= plan.total_amount,
            },
          });
        }
      } catch (notifyErr) {
        console.error('[payment-plans] notify failed:', notifyErr.message);
      }
    }

    res.json({ success: true, paid: paidAmt });
  } catch(e) { res.status(500).json({ error: 'Failed to mark paid.' }); }
});

// ── GET /payment-plans/delivery-timeframes ────────────────────────────────────
router.get('/delivery-timeframes', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM delivery_timeframes ORDER BY delivery_days');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Failed to load timeframes.' }); }
});

// ── PATCH /payment-plans/delivery-timeframes/:sessionType ────────────────────
router.patch('/delivery-timeframes/:sessionType', async (req, res) => {
  const { delivery_days, gallery_expiry_days } = req.body;
  try {
    await query(`UPDATE delivery_timeframes SET
      delivery_days=COALESCE($1,delivery_days),
      gallery_expiry_days=COALESCE($2,gallery_expiry_days)
      WHERE session_type=$3`,
      [delivery_days||null, gallery_expiry_days||null, req.params.sessionType]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to update timeframe.' }); }
});

module.exports = router;
