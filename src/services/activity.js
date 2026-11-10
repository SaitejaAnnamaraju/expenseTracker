'use strict';
const { pool } = require('../config/db');

const LABELS = {
  register: 'Account created',
  login: 'Signed in',
  logout: 'Signed out',
  expense_submitted: 'Expense submitted',
  profile_updated: 'Profile updated',
  password_changed: 'Password changed',
  avatar_updated: 'Profile picture updated',
  avatar_removed: 'Profile picture removed',
  csv_export: 'Expenses exported to CSV',
};

/** Best-effort audit entry - never breaks the main request if logging fails. */
async function log(username, action, details, req) {
  try {
    await pool.execute(
      'INSERT INTO activity_log (username, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [username, action, details ? String(details).slice(0, 255) : null, req ? String(req.ip || '').slice(0, 45) : null]
    );
  } catch (e) {
    console.error('Activity log failed:', e.message);
  }
}

async function recent(username, limit = 8) {
  const n = Math.max(1, Math.min(50, Number(limit) || 8));
  const [rows] = await pool.execute(
    `SELECT action, details, created_at FROM activity_log
      WHERE username = ? ORDER BY created_at DESC, id DESC LIMIT ${n}`,
    [username]
  );
  return rows.map((r) => ({ ...r, title: LABELS[r.action] || r.action }));
}

module.exports = { log, recent };
