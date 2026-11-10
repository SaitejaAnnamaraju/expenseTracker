'use strict';
/**
 * Applies database/schema.sql (idempotent).
 * Uses the admin credentials (DB_ROOT_USER) if present, otherwise the app user.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { dbSsl } = require('../src/config/ssl');

async function migrate() {
  let sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  const asAdmin = Boolean(process.env.DB_ROOT_USER);
  if (!asAdmin) {
    // Hosted MySQL (e.g. on Render deployments): the provider creates the database
    // for you, so skip CREATE DATABASE / USE and apply the tables to DB_NAME.
    sql = sql.replace(/CREATE DATABASE[\s\S]*?;/i, '').replace(/^\s*USE\s+\w+\s*;/im, '');
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: asAdmin ? process.env.DB_ROOT_USER : process.env.DB_USER,
    password: asAdmin ? process.env.DB_ROOT_PASSWORD : process.env.DB_PASSWORD,
    database: asAdmin ? undefined : (process.env.DB_NAME || 'expense_tracker'),
    ssl: dbSsl(),
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
