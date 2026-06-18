'use strict';
const express = require('express');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

// ── GET /admin/reports — studio reports & pipeline projections ────────────────
// Ported from the monolith's routes/admin.js GET /reports (Issue 25 / S9d).
// NOTE: the admin frontend's active loadReports() also reads d.galleryStats,
// d.annualRevenue, and d.revenueMonthly, none of which this endpoint (or the
// monolith's original) ever returned — that gap pre-dates the migration and
// is tracked separately in MIGRATION_ISSUES.md (Issue 25) rather than being
// patched here, to keep this endpoint a faithful port of working monolith
// behaviour.
router.get('/reports', async (req, res) => {
  try {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [thisMonthRev, lastMonthRev, outstanding, upcoming, totalPhotos, galleries, monthly, sessions, stages, upcomingSessions, outstandingInvoices, pipelineStages, pipelineTotal, confirmedValue, ytdRevenue, lastYtdRevenue, shootsThisMonth] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount_quoted),0) as total FROM projects WHERE created_at >= $1 AND created_at < $2 AND stage != 'cancelled'`, [thisMonth, nextMonth]),
      query(`SELECT COALESCE(SUM(amount_quoted),0) as total FROM projects WHERE created_at >= $1 AND created_at < $2 AND stage != 'cancelled'`, [lastMonth, thisMonth]),
      query(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM invoices WHERE status IN ('sent','overdue')`),
      query(`SELECT COALESCE(SUM(amount_total),0) as total FROM bookings WHERE session_date >= NOW() AND session_date <= NOW() + INTERVAL '60 days' AND status != 'cancelled'`),
      query(`SELECT COUNT(*) as total FROM photos`),
      query(`SELECT COUNT(*) FILTER (WHERE is_published) as published, COUNT(*) as total FROM galleries`),
      query(`SELECT to_char(date_trunc('month',created_at),'Mon YYYY') as month, date_trunc('month',created_at) as md, COALESCE(SUM(amount_quoted),0) as revenue, COUNT(*) as bookings FROM projects WHERE created_at >= NOW() - INTERVAL '12 months' AND stage != 'cancelled' GROUP BY md ORDER BY md ASC`),
      query(`SELECT session_type, COUNT(*) as count FROM bookings WHERE session_type IS NOT NULL AND status != 'cancelled' GROUP BY session_type ORDER BY count DESC`),
      query(`SELECT stage, COUNT(*) as count FROM projects GROUP BY stage ORDER BY count DESC`),
      query(`SELECT b.*, c.first_name, c.last_name FROM bookings b LEFT JOIN clients c ON b.client_id=c.id WHERE b.session_date >= NOW() ORDER BY b.session_date ASC LIMIT 5`),
      query(`SELECT i.*, c.first_name, c.last_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.status IN ('sent','overdue') ORDER BY i.due_date ASC LIMIT 10`),
      query(`SELECT stage, COUNT(*) as count, COALESCE(SUM(amount_quoted),0) as value FROM projects WHERE stage NOT IN ('completed','archived','cancelled') GROUP BY stage ORDER BY CASE stage WHEN 'lead' THEN 1 WHEN 'quote_sent' THEN 2 WHEN 'booked' THEN 3 WHEN 'covered' THEN 4 WHEN 'delivered' THEN 5 ELSE 6 END`),
      query(`SELECT COALESCE(SUM(amount_quoted),0) as total FROM projects WHERE stage NOT IN ('completed','archived','cancelled')`),
      query(`SELECT COALESCE(SUM(amount_quoted),0) as total FROM projects WHERE stage = 'booked'`),
      query(`SELECT COALESCE(SUM(amount_quoted),0) as ytd FROM projects WHERE stage IN ('completed','delivered') AND created_at >= date_trunc('year', NOW())`),
      query(`SELECT COALESCE(SUM(amount_quoted),0) as ytd FROM projects WHERE stage IN ('completed','delivered') AND created_at >= date_trunc('year', NOW() - interval '1 year') AND created_at < date_trunc('year', NOW())`),
      query(`SELECT COUNT(*) as count FROM bookings WHERE session_date >= CURRENT_DATE AND session_date <= CURRENT_DATE + INTERVAL '30 days' AND status = 'confirmed'`),
    ]);

    res.json({
      summary: {
        this_month: thisMonthRev.rows[0].total,
        last_month: lastMonthRev.rows[0].total,
        outstanding: outstanding.rows[0].total,
        outstanding_count: outstanding.rows[0].count,
        upcoming: upcoming.rows[0].total,
        total_photos: totalPhotos.rows[0].total,
        galleries_published: galleries.rows[0].published,
        galleries_total: galleries.rows[0].total
      },
      monthly: monthly.rows,
      sessions: sessions.rows,
      stages: stages.rows,
      upcoming_sessions: upcomingSessions.rows,
      outstanding_invoices: outstandingInvoices.rows,
      pipeline_stages: pipelineStages.rows,
      pipeline_total: parseFloat(pipelineTotal.rows[0].total),
      confirmed_value: parseFloat(confirmedValue.rows[0].total),
      ytd_revenue: parseFloat(ytdRevenue.rows[0].ytd),
      last_ytd_revenue: parseFloat(lastYtdRevenue.rows[0].ytd),
      shoots_this_month: parseInt(shootsThisMonth.rows[0].count)
    });
  } catch (e) {
    console.error('Reports error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /admin/dashboard — Main studio dashboard stats ────────────────────────
// Ported from the monolith's routes/admin.js GET /dashboard. Never made it
// into crm-service during the original Issue 25 port — only /reports did —
// which is why the admin Dashboard page has been 404ing on every load.
router.get('/dashboard', async (req, res) => {
  try {
    const [bookings, revenue, galleries, orders, recentBookings, upcomingBookings, pipeline, quarter, monthlyTrend] = await Promise.all([
      query(`SELECT status, COUNT(*) as count FROM bookings GROUP BY status`),
      query(`SELECT 
        COALESCE(SUM(amount_paid),0) as total_paid,
        COALESCE(SUM(amount_total),0) as total_invoiced,
        COALESCE(SUM(CASE WHEN date_trunc('month',created_at)=date_trunc('month',NOW()) THEN amount_paid ELSE 0 END),0) as this_month
        FROM bookings`),
      query(`SELECT COUNT(*) as count, SUM(CASE WHEN is_published THEN 1 ELSE 0 END) as published FROM galleries`),
      query(`SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM print_orders WHERE status != 'cancelled'`),
      query(`SELECT id, first_name, last_name, email, session_type, session_date, status, payment_status 
             FROM bookings ORDER BY created_at DESC LIMIT 5`),
      query(`SELECT id, first_name, last_name, session_type, session_date, status 
             FROM bookings WHERE session_date >= CURRENT_DATE AND status IN ('confirmed','pending')
             ORDER BY session_date ASC LIMIT 10`),
      query(`SELECT COALESCE(SUM(amount_total),0) as pipeline_total, COUNT(*) as pipeline_count FROM bookings WHERE status IN ('confirmed','pending') AND session_date >= CURRENT_DATE`),
      query(`SELECT COALESCE(SUM(amount_total),0) as quarter_total, COUNT(*) as quarter_count FROM bookings WHERE status IN ('confirmed','pending') AND session_date >= CURRENT_DATE AND session_date <= CURRENT_DATE + INTERVAL '90 days'`),
      query(`SELECT date_trunc('month', session_date) as month, COALESCE(SUM(amount_total),0) as total, COUNT(*) as count FROM bookings WHERE status IN ('confirmed','completed') AND session_date >= NOW() - INTERVAL '6 months' GROUP BY month ORDER BY month ASC`),
    ]);

    const bookingStats = {};
    bookings.rows.forEach(r => { bookingStats[r.status] = parseInt(r.count); });

    res.json({
      bookings: {
        pending:   bookingStats.pending   || 0,
        confirmed: bookingStats.confirmed || 0,
        completed: bookingStats.completed || 0,
        total: Object.values(bookingStats).reduce((a,b) => a + b, 0),
      },
      revenue: {
        totalPaid:     parseFloat(revenue.rows[0].total_paid),
        totalInvoiced: parseFloat(revenue.rows[0].total_invoiced),
        thisMonth:     parseFloat(revenue.rows[0].this_month),
      },
      galleries: {
        total:     parseInt(galleries.rows[0].count),
        published: parseInt(galleries.rows[0].published) || 0,
      },
      printOrders: {
        total:   parseInt(orders.rows[0].count),
        revenue: parseFloat(orders.rows[0].revenue),
      },
      recentBookings:   recentBookings.rows,
      upcomingBookings: upcomingBookings.rows,
      projections: {
        pipeline: { total: parseFloat(pipeline.rows[0].pipeline_total), count: parseInt(pipeline.rows[0].pipeline_count) },
        quarter:  { total: parseFloat(quarter.rows[0].quarter_total),  count: parseInt(quarter.rows[0].quarter_count) },
        monthlyTrend: monthlyTrend.rows,
      },
    });
  } catch (err) {
    console.error('[GET /admin/dashboard]', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

module.exports = router;
