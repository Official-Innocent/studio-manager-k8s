// services/monitor-service/src/panels/clientActivity.js
// Queries portal_activity_log and related tables for recent client actions.

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'biggshots',
  user:     process.env.DB_USER     || 'biggshots_user',
  password: process.env.DB_PASSWORD || '',
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function collectClientActivity() {
  const [
    recentActivity,
    activitySummary,
    galleryStats,
    addonOrders,
  ] = await Promise.all([

    // Last 20 portal events
    q(`
      SELECT
        pal.action,
        pal.created_at,
        c.name AS client_name
      FROM portal_activity_log pal
      LEFT JOIN clients c ON c.id = pal.client_id
      ORDER BY pal.created_at DESC
      LIMIT 20
    `).catch(() => []),

    // Activity counts in last 24h and 7d
    q(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7d,
        COUNT(DISTINCT client_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS unique_clients_7d
      FROM portal_activity_log
    `).catch(() => [{ last_24h: 0, last_7d: 0, unique_clients_7d: 0 }]),

    // Gallery download stats
    q(`
      SELECT
        COUNT(*) FILTER (WHERE action = 'gallery_download' AND created_at >= NOW() - INTERVAL '7 days') AS downloads_7d,
        COUNT(*) FILTER (WHERE action = 'gallery_view'     AND created_at >= NOW() - INTERVAL '7 days') AS views_7d
      FROM portal_activity_log
    `).catch(() => [{ downloads_7d: 0, views_7d: 0 }]),

    // Add-on orders (last 30 days)
    q(`
      SELECT addon_type, COUNT(*) AS count, SUM(price) AS revenue
      FROM addon_orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY addon_type
      ORDER BY count DESC
    `).catch(() => []),

  ]);

  const summary = activitySummary[0] || {};
  const galleries = galleryStats[0] || {};

  return {
    collectedAt: new Date().toISOString(),
    summary: {
      actionsLast24h:    parseInt(summary.last_24h        || 0, 10),
      actionsLast7d:     parseInt(summary.last_7d         || 0, 10),
      uniqueClients7d:   parseInt(summary.unique_clients_7d || 0, 10),
    },
    galleries: {
      downloads7d: parseInt(galleries.downloads_7d || 0, 10),
      views7d:     parseInt(galleries.views_7d     || 0, 10),
    },
    recentActivity: recentActivity.map(r => ({
      action:     r.action,
      clientName: r.client_name || 'Unknown',
      at:         r.created_at,
    })),
    addonOrders: addonOrders.map(r => ({
      type:    r.addon_type,
      count:   parseInt(r.count, 10),
      revenue: parseFloat(r.revenue || 0).toFixed(2),
    })),
  };
}

module.exports = { collectClientActivity };
