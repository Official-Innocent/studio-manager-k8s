'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'biggshots',
  user:     process.env.DB_USER     || 'biggshots_user',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB] New client connected');
  }
});

// Helper: run a query with automatic client release
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production' && duration > 100) {
      console.log(`[DB] Slow query (${duration}ms):`, text.substring(0, 60));
    }
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nQuery:', text);
    throw err;
  }
}

// Helper: get a client for transactions
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  const timeout = setTimeout(() => {
    console.error('[DB] Client checked out for >5 seconds');
  }, 5000);
  client.release = () => {
    clearTimeout(timeout);
    client.release = release;
    return release();
  };
  client.query = (...args) => originalQuery(...args);
  return client;
}

// Helper: run a transaction
async function transaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, getClient, transaction, pool };
