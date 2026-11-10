'use strict';
const { pool } = require('../config/db');
const { CATEGORIES, isValidISODate, isValidMonth, parseAmount } = require('../utils/validators');

/**
 * Turns query-string filters into a parameterised WHERE clause.
 * The username condition is ALWAYS first and always comes from the session,
 * so a user can never aggregate or export somebody else's rows.
 */
function buildFilter(username, q = {}) {
  const where = ['username = ?'];
  const params = [username];
  const applied = {};

  if (isValidISODate(q.from)) { where.push('expense_date >= ?'); params.push(q.from); applied.from = q.from; }
  if (isValidISODate(q.to)) { where.push('expense_date <= ?'); params.push(q.to); applied.to = q.to; }
  if (CATEGORIES.includes(q.category)) { where.push('category = ?'); params.push(q.category); applied.category = q.category; }

  // Amount bounds accept 0 for "min"; parseAmount rejects 0, so handle it explicitly.
  const minRaw = String(q.min ?? '').trim();
  const min = /^0+(\.0{1,2})?$/.test(minRaw) ? null : parseAmount(minRaw); // a min of 0 is a no-op
  const max = parseAmount(q.max);
  if (min !== null) { where.push('amount >= ?'); params.push(min); applied.min = min; }
  if (max !== null) { where.push('amount <= ?'); params.push(max); applied.max = max; }

  if (isValidMonth(q.month)) {
    // Submission month -> half-open DATETIME range (index-friendly).
    const [y, m] = q.month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    where.push('submitted_at >= ? AND submitted_at < ?');
    params.push(`${q.month}-01 00:00:00`, `${next}-01 00:00:00`);
    applied.month = q.month;
  }
  return { sql: where.join(' AND '), params, applied };
}

async function summary(filter) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total,
            COALESCE(AVG(amount), 0) AS average,
            COALESCE(MAX(amount), 0) AS largest,
            SUM(submitted_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')) AS this_month_count,
            COALESCE(SUM(CASE WHEN submitted_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01') THEN amount END), 0) AS this_month_total
       FROM expenses WHERE ${filter.sql}`,
    filter.params
  );
  return {
    count: Number(row.count),
    total: Number(row.total),
    average: Number(row.average),
    largest: Number(row.largest),
    thisMonthCount: Number(row.this_month_count || 0),
    thisMonthTotal: Number(row.this_month_total),
  };
}

async function byCategory(filter) {
  const [rows] = await pool.execute(
    `SELECT category, COUNT(*) AS count, SUM(amount) AS total
       FROM expenses WHERE ${filter.sql} GROUP BY category`,
    filter.params
  );
  // Always return all four categories in a stable order (zeros included).
  return CATEGORIES.map((c) => {
    const r = rows.find((x) => x.category === c);
    return { category: c, count: r ? Number(r.count) : 0, total: r ? Number(r.total) : 0 };
  });
}

/** Spending per month of expense_date. If no explicit range, the last `months` months (zero-filled). */
async function monthly(filter, months = 12) {
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS ym, COUNT(*) AS count, SUM(amount) AS total
       FROM expenses WHERE ${filter.sql} GROUP BY ym ORDER BY ym`,
    filter.params
  );
  const map = new Map(rows.map((r) => [r.ym, { count: Number(r.count), total: Number(r.total) }]));

  let start; let end;
  const now = new Date();
  end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  if (filter.applied.from) start = new Date(`${filter.applied.from.slice(0, 7)}-01T00:00:00Z`);
  if (filter.applied.to) end = new Date(`${filter.applied.to.slice(0, 7)}-01T00:00:00Z`);
  // Extend the window so no returned data is hidden.
  if (rows.length) {
    const first = new Date(`${rows[0].ym}-01T00:00:00Z`);
    const last = new Date(`${rows[rows.length - 1].ym}-01T00:00:00Z`);
    if (first < start) start = first;
    if (last > end) end = last;
  }
  const out = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard++ < 240) {
    const ym = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
    const v = map.get(ym) || { count: 0, total: 0 };
    out.push({ month: ym, ...v });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

/** Months (YYYY-MM) in which this user has submitted expenses - feeds the "Submission month" filter. */
async function submissionMonths(username) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT DATE_FORMAT(submitted_at, '%Y-%m') AS ym
       FROM expenses WHERE username = ? ORDER BY ym DESC`,
    [username]
  );
  return rows.map((r) => r.ym);
}

async function exportRows(filter) {
  const [rows] = await pool.execute(
    `SELECT expense_date, category, label, amount, description, submitted_at, status
       FROM expenses WHERE ${filter.sql} ORDER BY expense_date DESC, id DESC`,
    filter.params
  );
  return rows;
}

module.exports = { buildFilter, summary, byCategory, monthly, submissionMonths, exportRows };
