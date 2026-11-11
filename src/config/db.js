'use strict';
const mysql = require('mysql2/promise');
const config = require('./index');

// Single shared connection pool. All queries in the app use placeholders
// (pool.execute / pool.query with `?`), so user input is never concatenated into SQL.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  // Each Vercel function instance gets its own pool; keep it small so many
  // instances don't exhaust the free Aiven plan's connection limit.
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || (process.env.VERCEL ? 2 : 10),
  charset: 'utf8mb4',
  timezone: 'Z',          // MySQL server runs in UTC; keep the driver consistent
  dateStrings: true,      // return DATE/DATETIME as strings -> no accidental TZ shifts
  decimalNumbers: false,  // keep DECIMAL as exact strings
});

async function ping() {
  const conn = await pool.getConnection();
  try { await conn.ping(); } finally { conn.release(); }
}

module.exports = { pool, ping };
