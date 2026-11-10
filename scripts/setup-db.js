'use strict';
/**
 * One-shot database setup (run once after installing MySQL):
 *   1. Creates the database and a least-privilege application user
 *      (SELECT/INSERT/UPDATE/DELETE on expense_tracker.* only).
 *   2. Applies the schema.
 *   3. Seeds the two test accounts.
 * Requires DB_ROOT_USER / DB_ROOT_PASSWORD in .env.
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const migrate = require('./migrate');
const seed = require('./seed');

const IDENT = /^[A-Za-z0-9_]+$/;

async function main() {
  const { DB_NAME = 'expense_tracker', DB_USER, DB_PASSWORD, DB_ROOT_USER, DB_ROOT_PASSWORD } = process.env;
  if (!DB_ROOT_USER) throw new Error('DB_ROOT_USER is not set in .env');
  if (!IDENT.test(DB_NAME) || !IDENT.test(DB_USER)) throw new Error('DB_NAME/DB_USER may only contain letters, digits and _');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: DB_ROOT_USER,
    password: DB_ROOT_PASSWORD,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // Identifiers cannot be parameterised; they are validated by IDENT above. The password is escaped.
    await conn.query(`CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY ${conn.escape(DB_PASSWORD)}`);
    await conn.query(`CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY ${conn.escape(DB_PASSWORD)}`);
    await conn.query(`ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY ${conn.escape(DB_PASSWORD)}`);
    await conn.query(`ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY ${conn.escape(DB_PASSWORD)}`);
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost'`);
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1'`);
    await conn.query('FLUSH PRIVILEGES');
    console.log(`✔ Database "${DB_NAME}" and app user "${DB_USER}" ready`);
  } finally {
    await conn.end();
  }
  await migrate();
  await seed();
  console.log('✔ Setup complete');
}

main().catch((e) => { console.error('✖ Setup failed:', e.message); process.exit(1); });
