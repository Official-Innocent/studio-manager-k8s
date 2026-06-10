// services/monitor-service/src/panels/ga4.js
// Fetches traffic data from the GA4 Data API.
//
// Requires:
//   GA4_PROPERTY_ID  — e.g. "properties/123456789"
//   GA4_API_KEY      — a Google API key with Analytics Data API enabled
//                      OR set GA4_STUB=true to return realistic stub data
//                      (useful during local kind testing before prod credentials)

'use strict';

const fetch = require('node-fetch');

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '';
const GA4_API_KEY     = process.env.GA4_API_KEY     || '';
const GA4_STUB        = process.env.GA4_STUB === 'true';

// ── Stub data (kind cluster / local dev) ─────────────────────────────────────
function stubData() {
  return {
    collectedAt: new Date().toISOString(),
    stub: true,
    last7Days: {
      activeUsers:  42,
      sessions:     68,
      pageviews:    187,
      avgEngagementTimeSecs: 94,
    },
    topPages: [
      { page: '/photography-northampton',         views: 38 },
      { page: '/wedding-photography-northampton', views: 27 },
      { page: '/booking',                         views: 19 },
      { page: '/',                                views: 14 },
    ],
    trafficSources: [
      { source: 'google',   sessions: 31 },
      { source: 'direct',   sessions: 22 },
      { source: 'referral', sessions:  9 },
      { source: 'social',   sessions:  6 },
    ],
  };
}

// ── Real GA4 Data API call ────────────────────────────────────────────────────
async function fetchGA4() {
  const url = `https://analyticsdata.googleapis.com/v1beta/${GA4_PROPERTY_ID}:runReport?key=${GA4_API_KEY}`;

  const body = {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
    ],
    dimensions: [],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 8000,
  });

  if (!res.ok) throw new Error(`GA4 API returned ${res.status}`);
  const json = await res.json();

  // GA4 returns rows[0].metricValues in the order you requested them
  const vals = json.rows?.[0]?.metricValues || [];
  const [activeUsers, sessions, pageviews, avgDuration] = vals.map(v => parseFloat(v.value || 0));

  // Top pages
  const pagesBody = {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics:    [{ name: 'screenPageViews' }],
    dimensions: [{ name: 'pagePath' }],
    orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 5,
  };
  const pagesRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pagesBody),
    timeout: 8000,
  });
  const pagesJson = pagesRes.ok ? await pagesRes.json() : { rows: [] };
  const topPages = (pagesJson.rows || []).map(r => ({
    page:  r.dimensionValues?.[0]?.value || '/',
    views: parseInt(r.metricValues?.[0]?.value || 0, 10),
  }));

  return {
    collectedAt: new Date().toISOString(),
    stub: false,
    last7Days: {
      activeUsers:  Math.round(activeUsers),
      sessions:     Math.round(sessions),
      pageviews:    Math.round(pageviews),
      avgEngagementTimeSecs: Math.round(avgDuration),
    },
    topPages,
    trafficSources: [], // Traffic source requires a separate dimension query — extend as needed
  };
}

async function collectGA4() {
  if (GA4_STUB || !GA4_PROPERTY_ID || !GA4_API_KEY) return stubData();
  return fetchGA4();
}

module.exports = { collectGA4 };
