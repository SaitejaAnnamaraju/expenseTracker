'use strict';

const CATEGORIES = Object.freeze(['Travel', 'Food & Drink', 'Accommodation', 'Other']);
const MAX_AMOUNT = 1000000; // £1,000,000.00 sanity cap per expense
const MIN_EXPENSE_DATE = '2000-01-01';

/** Today's date as YYYY-MM-DD in the server's local timezone. */
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Strict YYYY-MM-DD that is also a real calendar date (rejects 2025-02-30). */
function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Money: up to 2 decimal places, positive. Returns normalised string "12.30" or null. */
function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/^£/, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return n.toFixed(2);
}

/** Collapse control chars (except newline/tab) out of free text. */
function cleanText(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Validates the Add Expense payload. Only whitelisted fields are read -
 * username / submitted_at / status are never taken from the request.
 */
function validateExpense(body) {
  const errors = {};
  const out = {};

  const date = String(body.expense_date || '').trim();
  if (!isValidISODate(date)) errors.expense_date = 'Please choose a valid date.';
  else if (date > todayLocal()) errors.expense_date = 'Expense date cannot be in the future.';
  else if (date < MIN_EXPENSE_DATE) errors.expense_date = 'Expense date is too far in the past.';
  else out.expense_date = date;

  const category = String(body.category || '');
  if (!CATEGORIES.includes(category)) errors.category = 'Please select one of the listed categories.';
  else out.category = category;

  const label = cleanText(body.label).replace(/\s+/g, ' ').trim();
  if (!label) errors.label = 'Expense label is required.';
  else if (label.length > 120) errors.label = 'Label must be 120 characters or fewer.';
  else out.label = label;

  const amount = parseAmount(body.amount);
  if (amount === null) errors.amount = `Enter a positive amount in GBP with up to 2 decimal places (max £${MAX_AMOUNT.toLocaleString('en-GB')}).`;
  else out.amount = amount;

  const description = cleanText(body.description).replace(/\r\n/g, '\n').trim();
  if (description.length > 5000) errors.description = 'Description must be 5,000 characters or fewer.';
  else out.description = description || null;

  return { errors, value: out, ok: Object.keys(errors).length === 0 };
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function passwordProblems(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

function validateDisplayName(raw) {
  const v = cleanText(raw).replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 100) return { error: 'Display name must be between 2 and 100 characters.' };
  return { value: v };
}

module.exports = {
  CATEGORIES, MAX_AMOUNT, MIN_EXPENSE_DATE,
  todayLocal, isValidISODate, isValidMonth, parseAmount, cleanText,
  validateExpense, USERNAME_RE, EMAIL_RE, passwordProblems, validateDisplayName,
};
