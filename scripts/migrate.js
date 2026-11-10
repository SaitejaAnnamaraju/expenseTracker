'use strict';
/**
 * Applies database/schema.sql (idempotent).
 * Uses the admin credentials (DB_ROOT_USER) if present, otherwise the app user.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_ROOT_USER || process.env.DB_USER,
    password: process.env.DB_ROOT_USER ? process.env.DB_ROOT_PASSWORD : process.env.DB_PASSWORD,
    multipleStatements: true, // trusted, static file only
  });
  try {
    await conn.query(sql);
    console.log('✔ Schema applied (database/schema.sql)');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate().catch((e) => { console.error('✖ Migration failed:', e.message); process.exit(1); });
}
module.exports = migrate;
