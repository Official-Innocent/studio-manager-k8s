// services/monitor-service/src/panels/businessMetrics.js
// Queries PostgreSQL directly for business pipeline data.
// These are the same queries that power the monolith's revenue dashboard.

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'biggshots',
  user:     process.env.DB_USER     || 'biggshots_user',
  password: process.env.DB_PASSWORD || '',
  max: 3, // small pool — monitor is low-frequency
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function collectBusinessMetrics() {
  const [
    stageCounts,
    revenueRows,
    upcomingSessions,
    recentBookings,
    outstandingBalance,
    conversionRate,
  ] = await Promise.all([

    // Bookings by pipeline stage
    q(`
      SELECT stage, COUNT(*) AS count
      FROM bookings
      GROUP BY stage
      ORDER BY stage
    `),

    // Pipeline value and confirmed revenue (last 90 days vs all-time)
    q(`
      SELECT
        SUM(CASE WHEN stage IN ('Lead','Quote Sent') THEN total_price ELSE 0 END)           AS pipeline_value,
        SUM(CASE WHEN stage IN ('Booked','Covered','Delivered','Completed') THEN total_price ELSE 0 END) AS confirmed_revenue,
        SUM(CASE WHEN stage = 'Completed' AND session_date >= NOW() - INTERVAL '90 days'
                 THEN total_price ELSE 0 END)                                                AS revenue_90d,
        COUNT(*) FILTER (WHERE stage = 'Completed')                                          AS completed_total
      FROM bookings
      WHERE archived = false OR archived IS NULL
    `),

    // Sessions in the next 30 days
    q(`
      SELECT id, client_name, session_type, session_date, stage
      FROM bookings
      WHERE session_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'
        AND stage NOT IN ('Archived','Completed')
      ORDER BY session_date ASC
      LIMIT 5
    `),

    // Last 5 bookings created
    q(`
      SELECT id, client_name, session_type, stage, created_at
      FROM bookings
      ORDER BY created_at DESC
      LIMIT 5
    `),

    // Outstanding balance across all bookings
    q(`
      SELECT
        COALESCE(SUM(total_price - COALESCE(deposit_paid, 0)), 0) AS outstanding
      FROM bookings
      WHERE stage IN ('Booked','Covered','Delivered')
    `),

    // Lead → Booked conversion rate (last 90 days)
    q(`
      SELECT
        COUNT(*) FILTER (WHERE stage != 'Lead') AS converted,
        COUNT(*) AS total
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '90 days'
    `),

  ]);

  const rev = revenueRows[0] || {};
  const bal = outstandingBalance[0] || {};
  const conv = conversionRate[0] || {};

  return {
    collectedAt: new Date().toISOString(),
    pipeline: {
      byStage: stageCounts.map(r => ({ stage: r.stage, count: parseInt(r.count, 10) })),
      pipelineValue:    parseFloat(rev.pipeline_value    || 0).toFixed(2),
      confirmedRevenue: parseFloat(rev.confirmed_revenue || 0).toFixed(2),
      revenue90d:       parseFloat(rev.revenue_90d       || 0).toFixed(2),
      completedTotal:   parseInt(rev.completed_total     || 0, 10),
    },
    upcoming: upcomingSessions,
    recentBookings,
    outstandingBalance: parseFloat(bal.outstanding || 0).toFixed(2),
    conversionRate90d: conv.total > 0
      ? ((conv.converted / conv.total) * 100).toFixed(1)
      : '0.0',
  };
}

module.exports = { collectBusinessMetrics };
