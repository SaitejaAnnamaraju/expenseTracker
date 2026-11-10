'use strict';
/**
 * Seeds the two assignment test accounts with bcrypt-hashed passwords.
 *   user1    / p455w0rd   (role: user)
 *   manager1 / p455w0rd   (role: manager - test login only, no approval features)
 * Idempotent: existing accounts have their password/role reset to the known values.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ACCOUNTS = [
  { username: 'user1', displayName: 'User One', email: 'user1@example.com', role: 'user' },
  { username: 'manager1', displayName: 'Manager One', email: 'manager1@example.com', role: 'manager' },
];
const PASSWORD = 'p455w0rd';

async function seed() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'expense_tracker',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: require('../src/config/ssl').dbSsl(),
  });
  try {
    for (const a of ACCOUNTS) {
      const hash = await bcrypt.hash(PASSWORD, 12);
      await conn.execute(
        `INSERT INTO users (username, display_name, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
        [a.username, a.displayName, a.email, hash, a.role]
      );
      console.log(`✔ Seeded account: ${a.username} (${a.role})`);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seed().catch((e) => { console.error('✖ Seed failed:', e.message); process.exit(1); });
}
module.exports = seed;
