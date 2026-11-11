'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const ROOT = path.join(__dirname, '..', '..');
const isProd = process.env.NODE_ENV === 'production';
// On Vercel the project folder is read-only; only /tmp is writable (and it is wiped
// between cold starts), so uploads go there. STORAGE_DIR overrides it anywhere.
const STORAGE = process.env.STORAGE_DIR
  || (process.env.VERCEL ? path.join('/tmp', 'storage') : path.join(ROOT, 'storage'));

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  sessionSecret: required('SESSION_SECRET'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || 'expense_tracker',
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    ssl: require('./ssl').dbSsl(),
  },
  paths: {
    root: ROOT,
    receipts: path.join(STORAGE, 'receipts'),
    avatars: path.join(STORAGE, 'avatars'),
  },
  uploads: {
    maxReceiptBytes: (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024,
    maxAvatarBytes: 2 * 1024 * 1024,
    receiptRequired: String(process.env.RECEIPT_REQUIRED || 'false').toLowerCase() === 'true',
  },
};
