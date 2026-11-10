'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const stats = require('../services/stats');
const activity = require('../services/activity');
const { CATEGORIES } = require('../utils/validators');

const router = express.Router();

// ---------------------------------------------------------------- Dashboard
// Aggregates only - the dashboard deliberately does NOT list individual expenses.
router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard', active: 'dashboard' });
});

router.get('/api/dashboard', requireAuth, async (req, res, next) => {
  try {
    const all = stats.buildFilter(req.user.username, {});
    const [summary, categories, monthly, recent] = await Promise.all([
      stats.summary(all),
      stats.byCategory(all),
      stats.monthly(all, 12),
      activity.recent(req.user.username, 8),
    ]);
    res.set('Cache-Control', 'no-store').json({ summary, categories, monthly: monthly.slice(-12), activity: recent });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- Analytics
router.get('/analytics', requireAuth, async (req, res, next) => {
  try {
    const months = await stats.submissionMonths(req.user.username);
    res.render('analytics', { title: 'Analytics', active: 'analytics', categories: CATEGORIES, months, q: req.query });
  } catch (e) { next(e); }
});

router.get('/api/analytics', requireAuth, async (req, res, next) => {
  try {
    const filter = stats.buildFilter(req.user.username, req.query);
    const [summary, categories, monthly] = await Promise.all([
      stats.summary(filter), stats.byCategory(filter), stats.monthly(filter, 12),
    ]);
    res.set('Cache-Control', 'no-store').json({ filters: filter.applied, summary, categories, monthly });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- CSV export
/** RFC 4180 quoting + neutralises spreadsheet formula injection (=, +, -, @, tab, CR). */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/analytics/export.csv', requireAuth, async (req, res, next) => {
  try {
    const filter = stats.buildFilter(req.user.username, req.query); // username is forced from the session
    const rows = await stats.exportRows(filter);
    const header = ['Expense Date', 'Category', 'Label', 'Amount (GBP)', 'Description', 'Submitted At (UTC)', 'Status'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([r.expense_date, r.category, r.label, Number(r.amount).toFixed(2), r.description, r.submitted_at, r.status].map(csvCell).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await activity.log(req.user.username, 'csv_export', `${rows.length} record${rows.length === 1 ? '' : 's'}`, req);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${req.user.username}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send(`﻿${lines.join('\r\n')}\r\n`); // BOM so Excel opens UTF-8 (£) correctly
  } catch (e) { next(e); }
});

module.exports = router;
