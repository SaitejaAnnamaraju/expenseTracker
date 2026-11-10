'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { pool } = require('../config/db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { receiptUpload, removeFile } = require('../middleware/upload');
const { CATEGORIES, validateExpense, todayLocal, MIN_EXPENSE_DATE, MAX_AMOUNT } = require('../utils/validators');
const activity = require('../services/activity');

const router = express.Router();
const MAX_PENDING_FORM_TOKENS = 20;
// Tokens currently being processed. Two near-simultaneous requests (double click)
// may both read the session before either saves it, so this in-process lock closes that race.
const inFlight = new Set();

/**
 * One-time form tokens: each rendered Add Expense form gets a token that can
 * be consumed exactly once. A double-click, a retried request or a browser
 * "resubmit" therefore cannot create a duplicate expense.
 */
function issueFormToken(req) {
  const t = crypto.randomBytes(18).toString('hex');
  const list = (req.session.expenseFormTokens || []).slice(-(MAX_PENDING_FORM_TOKENS - 1));
  list.push(t);
  req.session.expenseFormTokens = list;
  return t;
}
function consumeFormToken(req, token) {
  const list = req.session.expenseFormTokens || [];
  const i = typeof token === 'string' ? list.indexOf(token) : -1;
  if (i === -1) return false;
  list.splice(i, 1);
  req.session.expenseFormTokens = list;
  return true;
}

// ---------------------------------------------------------------- Add Expense page
router.get('/expenses/new', requireAuth, (req, res) => {
  res.render('expenses/new', {
    title: 'Add Expense',
    active: 'add',
    categories: CATEGORIES,
    today: todayLocal(),
    minDate: MIN_EXPENSE_DATE,
    maxAmount: MAX_AMOUNT,
    maxUploadMb: Math.round(config.uploads.maxReceiptBytes / 1024 / 1024),
    receiptRequired: config.uploads.receiptRequired,
    formToken: issueFormToken(req),
  });
});

// ---------------------------------------------------------------- Submit (JSON API)
router.post('/expenses', requireAuth, receiptUpload, async (req, res, next) => {
  const file = req.file;
  const fail = async (status, payload) => {
    await removeFile(file && file.path);       // never keep orphaned uploads
    return res.status(status).json(payload);
  };

  const formToken = typeof req.body.form_token === 'string' ? req.body.form_token : '';
  if (!formToken || inFlight.has(formToken)) {
    await removeFile(file && file.path);
    return res.status(409).json({ error: 'This expense is already being submitted.', code: 'DUPLICATE_SUBMISSION' });
  }
  inFlight.add(formToken);
  res.on('finish', () => inFlight.delete(formToken));
  res.on('close', () => inFlight.delete(formToken));

  try {
    if (!consumeFormToken(req, formToken)) {
      return fail(409, {
        error: 'This form has already been submitted or has expired. Please reload the page to add another expense.',
        code: 'DUPLICATE_SUBMISSION',
      });
    }
    // Any failure from here on hands the client a fresh token so the user can fix and retry.
    const retry = async (status, payload) => {
      payload.formToken = issueFormToken(req);
      return fail(status, payload);
    };

    if (req.uploadError) return retry(400, { error: req.uploadError, errors: { receipt: req.uploadError } });

    const { ok, errors, value } = validateExpense(req.body);
    if (config.uploads.receiptRequired && !file) errors.receipt = 'Please attach a receipt.';
    if (!ok || errors.receipt) return retry(422, { error: 'Please correct the highlighted fields.', errors });

    // Store a POSIX-style path relative to storage/receipts (never an absolute server path).
    const receiptPath = file
      ? path.relative(config.paths.receipts, file.path).split(path.sep).join('/')
      : null;

    // username comes from the session; submitted_at and status are set by the
    // database defaults (CURRENT_TIMESTAMP / 'not-approved') and are written
    // explicitly here as well so they can never be influenced by the client.
    const [result] = await pool.execute(
      `INSERT INTO expenses
         (username, expense_date, category, label, amount, description, receipt_path, submitted_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'not-approved')`,
      [req.user.username, value.expense_date, value.category, value.label, value.amount, value.description, receiptPath]
    );

    const [[saved]] = await pool.execute(
      'SELECT id, expense_date, category, label, amount, submitted_at, status FROM expenses WHERE id = ? AND username = ?',
      [result.insertId, req.user.username]
    );

    await activity.log(
      req.user.username, 'expense_submitted',
      `${saved.category} · £${Number(saved.amount).toFixed(2)}${receiptPath ? ' · receipt attached' : ''}`, req
    );

    res.status(201).json({
      ok: true,
      message: 'Expense submitted successfully.',
      expense: { ...saved, hasReceipt: Boolean(receiptPath) },
      formToken: issueFormToken(req),
    });
  } catch (e) {
    await removeFile(file && file.path);
    next(e);
  }
});

module.exports = router;
