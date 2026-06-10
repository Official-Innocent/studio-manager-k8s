'use strict';
const { query } = require('./config/database');

async function upsertTask(type, refId, title, description, priority, clientId, bookingId, projectId, dueDate) {
  const existing = await query(
    "SELECT id FROM tasks WHERE type=$1 AND status='open' AND (booking_id=$2 OR project_id=$3 OR (client_id=$4 AND booking_id IS NULL AND project_id IS NULL))",
    [type, bookingId||null, projectId||null, clientId||null]
  );
  if (existing.rows.length) return;
  await query(
    'INSERT INTO tasks(type,title,description,priority,status,client_id,booking_id,project_id,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [type, title, description, priority, 'open', clientId||null, bookingId||null, projectId||null, dueDate||null]
  );
}

async function resolveTask(type, bookingId, projectId, clientId) {
  await query(
    "UPDATE tasks SET status='resolved', updated_at=NOW() WHERE type=$1 AND status='open' AND (booking_id=$2 OR project_id=$3 OR client_id=$4)",
    [type, bookingId||null, projectId||null, clientId||null]
  );
}

async function generateTasks() {
  const today = new Date(); today.setHours(0,0,0,0);
  const overduePayments = await query(`SELECT pi.*, c.first_name, c.last_name, c.id as client_id, b.id as booking_id FROM payment_installments pi JOIN clients c ON c.id = pi.client_id LEFT JOIN bookings b ON b.client_id = c.id WHERE pi.status NOT IN ('paid','cancelled','waived') AND pi.due_date < NOW() AND pi.due_date IS NOT NULL`);
  for (var p of overduePayments.rows) { var daysOver = Math.round((today - new Date(p.due_date)) / 86400000); await upsertTask('overdue_payment', p.id, 'Overdue payment — ' + p.first_name + ' ' + p.last_name, '£' + parseFloat(p.amount).toFixed(2) + ' overdue by ' + daysOver + ' days', daysOver >= 14 ? 'high' : daysOver >= 7 ? 'medium' : 'low', p.client_id, p.booking_id, null, p.due_date); }
  const unsignedContracts = await query(`SELECT co.*, c.first_name, c.last_name, c.id as client_id, b.id as booking_id FROM contracts co JOIN clients c ON c.id = co.client_id LEFT JOIN bookings b ON b.client_id = c.id WHERE co.status = 'sent' AND co.created_at < NOW() - INTERVAL '2 days'`);
  for (var co of unsignedContracts.rows) { var daysSent = Math.round((today - new Date(co.created_at)) / 86400000); await upsertTask('unsigned_contract', co.id, 'Contract unsigned — ' + co.first_name + ' ' + co.last_name, 'Contract sent ' + daysSent + ' days ago', daysSent >= 7 ? 'high' : 'medium', co.client_id, co.booking_id, null, null); }
  const upcomingBookings = await query(`SELECT b.*, c.first_name, c.last_name, c.id as client_id FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.status = 'confirmed' AND b.session_date >= CURRENT_DATE AND b.session_date <= CURRENT_DATE + INTERVAL '7 days'`);
  for (var b of upcomingBookings.rows) { var daysTo = Math.round((new Date(b.session_date) - today) / 86400000); await upsertTask('upcoming_shoot', b.id, 'Shoot in ' + daysTo + ' days — ' + b.first_name + ' ' + b.last_name, b.session_type, daysTo <= 2 ? 'high' : daysTo <= 5 ? 'medium' : 'low', b.client_id, b.id, null, b.session_date); }
  console.log('[tasks] generation complete');
}

module.exports = { generateTasks, resolveTask, upsertTask };
