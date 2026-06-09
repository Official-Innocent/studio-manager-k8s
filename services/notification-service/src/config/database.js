'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'biggshots',
  user:     process.env.DB_USER     || 'biggshots_user',
  password: process.env.DB_PASSWORD || '',
  max: 10,
});

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    return res;
  } catch(err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

module.exports = { query, pool };
