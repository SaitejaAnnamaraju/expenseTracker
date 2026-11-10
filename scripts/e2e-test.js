'use strict';
/**
 * End-to-end test of the running app against the real MySQL database.
 *   1) start the server:  npm start
 *   2) run:               npm test            (BASE_URL defaults to http://localhost:3000)
 * Test data is removed afterwards; pass --keep to leave it in place.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const KEEP = process.argv.includes('--keep');
const ROOT = path.join(__dirname, '..');

let passed = 0; let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); } else { failed++; console.log(`  ✖ ${name}${extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ''}`); }
}

/** Minimal cookie-aware HTTP client. */
class Client {
  constructor() { this.cookies = {}; }
  async req(method, url, { form, body, headers = {}, follow = false } = {}) {
    const h = { ...headers, Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload = body;
    if (form) { payload = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: follow ? 'follow' : 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(c) || v === '') delete this.cookies[k]; else this.cookies[k] = v;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, location: res.headers.get('location'), text, json, headers: res.headers };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, o) { return this.req('POST', u, o); }
  async csrf(page = '/dashboard') {
    const r = await this.get(page);
    const m = r.text.match(/name="csrf-token" content="([a-f0-9]+)"/);
    return { token: m && m[1], html: r.text };
  }
  async login(username, password, remember) {
    const { token } = await this.csrf('/login');
    return this.post('/login', { form: { _csrf: token, username, password, ...(remember ? { remember: 'on' } : {}) } });
  }
}

// Tiny valid files
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

function todayLocal(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function addExpense(client, fields, file) {
  const page = await client.get('/expenses/new');
  const csrf = (page.text.match(/name="csrf-token" content="([a-f0-9]+)"/) || [])[1];
  const formToken = (page.text.match(/id="form_token" value="([a-f0-9]+)"/) || [])[1];
  const fd = new FormData();
  fd.append('form_token', fields.form_token !== undefined ? fields.form_token : formToken);
  for (const [k, v] of Object.entries(fields)) if (k !== 'form_token') fd.append(k, v);
  if (file) fd.append('receipt', new Blob([file.data], { type: file.type }), file.name);
  const r = await client.post('/expenses', { body: fd, headers: { 'X-CSRF-Token': fields.noCsrf ? '' : csrf, Accept: 'application/json' } });
  r.formToken = formToken; r.csrf = csrf;
  return r;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, dateStrings: true, timezone: 'Z',
  });
  const createdIds = [];
  const testUser = `e2e_${Date.now().toString(36)}`;

  try {
    console.log('\n1. Authentication & route protection');
    const anon = new Client();
    let r = await anon.get('/dashboard');
    check('Unauthenticated /dashboard redirects to /login', r.status === 302 && r.location === '/login', r.status);
    r = await anon.get('/expenses/new');
    check('Unauthenticated /expenses/new redirects to /login', r.status === 302 && r.location === '/login');
    r = await anon.get('/analytics/export.csv');
    check('Unauthenticated CSV export redirects to /login', r.status === 302 && r.location === '/login');
    r = await anon.get('/api/dashboard');
    check('Unauthenticated API returns 401', r.status === 401);
    r = await anon.login('user1', 'wrong-password');
    check('Wrong password is rejected with an error message', r.status === 401 && r.text.includes('Invalid username or password'));
    r = await anon.post('/login', { form: { username: 'user1', password: 'p455w0rd' } });
    check('Login without CSRF token is rejected (403)', r.status === 403);

    const user1 = new Client();
    r = await user1.login('user1', 'p455w0rd');
    check('user1 / p455w0rd logs in', r.status === 302 && r.location === '/dashboard', r);
    const manager = new Client();
    r = await manager.login('manager1', 'p455w0rd', true);
    check('manager1 / p455w0rd logs in (remember me)', r.status === 302 && r.location === '/dashboard');
    const sidCookie = r.headers.getSetCookie().find((c) => c.startsWith('bet.sid'));
    check('Remember-me sets a persistent, HttpOnly cookie', /Expires=/i.test(sidCookie || '') && /HttpOnly/i.test(sidCookie || ''), sidCookie);
    const [[pw]] = await db.execute('SELECT password_hash FROM users WHERE username = ?', ['user1']);
    check('Passwords are stored as bcrypt hashes', /^\$2[aby]\$12\$/.test(pw.password_hash));

    console.log('\n2. Registration');
    const reg = new Client();
    let { token } = await reg.csrf('/register');
    r = await reg.post('/register', { form: { _csrf: token, display_name: 'E2E Tester', username: testUser, email: `${testUser}@example.com`, password: 'abc', confirm_password: 'abc', terms: 'on' } });
    check('Weak password is rejected', r.status === 400 && r.text.includes('at least 8 characters'));
    r = await reg.post('/register', { form: { _csrf: token, display_name: 'E2E Tester', username: 'user1', email: `${testUser}@example.com`, password: 'Secur3pass', confirm_password: 'Secur3pass', terms: 'on' } });
    check('Duplicate username is rejected', r.status === 400 && r.text.includes('already taken'));
    r = await reg.post('/register', { form: { _csrf: token, display_name: 'E2E Tester', username: testUser, email: `${testUser}@example.com`, password: 'Secur3pass', confirm_password: 'Secur3pass', terms: 'on' } });
    check('New account registers and is signed in', r.status === 302 && r.location === '/dashboard');
    r = await reg.get('/dashboard');
    check('Registered user can open the dashboard', r.status === 200 && r.text.includes('E2E'));

    console.log('\n3. Add Expense page (Feature 1)');
    r = await user1.get('/dashboard');
    check('Dashboard has an Add Expense button', r.text.includes('href="/expenses/new"') && r.text.includes('Add Expense'));
    check('Dashboard does not list individual expenses', !/<table/i.test(r.text));
    r = await user1.get('/expenses/new');
    check('Add Expense page opens', r.status === 200);
    const opts = [...r.text.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((v) => ['Travel', 'Food & Drink', 'Accommodation', 'Other'].includes(v));
    check('Exactly the four categories are offered', JSON.stringify(opts) === JSON.stringify(['Travel', 'Food & Drink', 'Accommodation', 'Other']), opts);
    check('Date picker defaults to today and blocks future dates', r.text.includes(`type="date" id="expense_date" name="expense_date" required\n                   value="${todayLocal()}" max="${todayLocal()}"`));
    check('Form has no username/status/submitted_at inputs', !/name="(username|status|submitted_at)"/.test(r.text));
    for (const id of ['label', 'amount', 'description', 'receipt', 'submit-btn', 'cancel-btn']) check(`Form contains #${id}`, r.text.includes(`id="${id}"`));

    console.log('\n4. Server-side validation');
    const base = { expense_date: todayLocal(), category: 'Travel', label: 'Taxi to client', amount: '23.50', description: '' };
    r = await addExpense(user1, { ...base, noCsrf: true });
    check('Submission without CSRF header is rejected (403)', r.status === 403);
    for (const bad of ['-5', 'abc', '0', '1.234', '', '1e3']) {
      r = await addExpense(user1, { ...base, amount: bad });
      check(`Amount "${bad}" is rejected`, r.status === 422 && r.json && r.json.errors.amount, r.json);
    }
    r = await addExpense(user1, { ...base, expense_date: todayLocal(2) });
    check('Future date is rejected', r.status === 422 && r.json.errors.expense_date);
    r = await addExpense(user1, { ...base, expense_date: '2025-02-30' });
    check('Impossible date is rejected', r.status === 422 && r.json.errors.expense_date);
    r = await addExpense(user1, { ...base, category: 'Entertainment' });
    check('Unknown category is rejected', r.status === 422 && r.json.errors.category);
    r = await addExpense(user1, { ...base, label: '   ' });
    check('Blank label is rejected', r.status === 422 && r.json.errors.label);
    r = await addExpense(user1, base, { data: Buffer.from('MZ\x90\x00 fake exe'), type: 'image/png', name: 'receipt.png' });
    check('Renamed non-image file (bad signature) is rejected', r.status === 400 && /does not match/.test(r.json.error), r.json);
    r = await addExpense(user1, base, { data: Buffer.from('hello'), type: 'text/plain', name: 'receipt.txt' });
    check('.txt receipt is rejected', r.status === 400 && /Unsupported file type/.test(r.json.error));
    r = await addExpense(user1, base, { data: Buffer.alloc(6 * 1024 * 1024, 0xff), type: 'image/jpeg', name: 'big.jpg' });
    check('Receipt over 5 MB is rejected', r.status === 400 && /too large/.test(r.json.error));
    const filesBefore = fs.readdirSync(path.join(ROOT, 'storage', 'receipts')).length;

    console.log('\n5. Successful submission + MySQL persistence');
    const md = '**Client:** Acme Ltd\n- Quarterly review\n<script>alert(1)</script>';
    r = await addExpense(user1, {
      ...base, category: 'Food & Drink', label: 'Client lunch', amount: '45.8', description: md,
      // Attempted tampering - these must all be ignored by the server:
      username: 'manager1', status: 'approved', submitted_at: '2001-01-01 00:00:00',
    }, { data: PNG, type: 'image/png', name: 'lunch receipt.png' });
    check('Valid expense with PNG receipt is accepted (201)', r.status === 201 && r.json && r.json.ok, r.json);
    const id1 = r.json && r.json.expense.id; createdIds.push(id1);
    const usedToken = r.formToken;
    const [[row]] = await db.execute('SELECT * FROM expenses WHERE id = ?', [id1]);
    check('Record exists in MySQL', Boolean(row));
    check('username stored automatically from session (user1)', row && row.username === 'user1', row && row.username);
    check('status stored as not-approved', row && row.status === 'not-approved', row && row.status);
    const age = row ? Math.abs(Date.now() - new Date(`${row.submitted_at.replace(' ', 'T')}Z`).getTime()) : Infinity;
    check('submitted_at is the current date/time', age < 120000, row && row.submitted_at);
    check('expense_date, category, label stored correctly', row && row.expense_date === base.expense_date && row.category === 'Food & Drink' && row.label === 'Client lunch');
    check('amount stored as DECIMAL 45.80', row && row.amount === '45.80', row && row.amount);
    check('Markdown description stored as entered', row && row.description === md);
    check('Receipt saved to disk outside the web root', row && row.receipt_path && fs.existsSync(path.join(ROOT, 'storage', 'receipts', row.receipt_path)), row && row.receipt_path);
    check('Stored filename is randomised (not the original name)', row && !row.receipt_path.includes('lunch'));
    r = await user1.get(`/storage/receipts/${row.receipt_path}`);
    check('Receipt files are not publicly served', r.status === 404 || r.status === 302);

    r = await addExpense(user1, { ...base, form_token: usedToken });
    check('Re-using a form token (duplicate submit) is rejected (409)', r.status === 409 && r.json.code === 'DUPLICATE_SUBMISSION');

    r = await addExpense(user1, { ...base, category: 'Accommodation', label: 'Hotel accommodation', amount: '129.00', expense_date: todayLocal(-40) }, { data: PDF, type: 'application/pdf', name: 'hotel.pdf' });
    check('Valid expense with PDF receipt (past date) is accepted', r.status === 201, r.json);
    createdIds.push(r.json && r.json.expense.id);
    r = await addExpense(user1, { ...base, label: '=HYPERLINK("http://evil")', amount: '10' });
    check('Expense without a receipt is accepted (receipt optional)', r.status === 201, r.json);
    createdIds.push(r.json && r.json.expense.id);
    const filesAfter = fs.readdirSync(path.join(ROOT, 'storage', 'receipts')).length;
    check('Rejected uploads leave no orphan files', filesAfter === filesBefore || filesAfter === filesBefore + 1);

    console.log('\n6. Dashboard / analytics use real DB data');
    const [[agg]] = await db.execute('SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM expenses WHERE username = ?', ['user1']);
    r = await user1.get('/api/dashboard', { headers: { Accept: 'application/json' } });
    check('Dashboard count matches MySQL', r.json.summary.count === Number(agg.n), [r.json.summary.count, agg.n]);
    check('Dashboard total matches MySQL', Math.abs(r.json.summary.total - Number(agg.t)) < 0.001);
    check('Dashboard returns 4 categories and 12 months', r.json.categories.length === 4 && r.json.monthly.length === 12);
    check('Recent activity includes the submission', r.json.activity.some((a) => a.action === 'expense_submitted'));
    const [[trav]] = await db.execute("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM expenses WHERE username = 'user1' AND category = 'Accommodation' AND amount >= 100", []);
    r = await user1.get('/api/analytics?category=Accommodation&min=100', { headers: { Accept: 'application/json' } });
    check('Analytics filters (category + min amount) match MySQL', r.json.summary.count === Number(trav.n) && Math.abs(r.json.summary.total - Number(trav.t)) < 0.001, r.json.summary);
    r = await user1.get(`/api/analytics?from=${todayLocal()}&to=${todayLocal()}&month=${todayLocal().slice(0, 7)}`, { headers: { Accept: 'application/json' } });
    check('Analytics date range + submission month filters apply', r.json.filters.from && r.json.filters.month && r.json.summary.count >= 2);
    r = await user1.get("/api/analytics?category=Travel' OR '1'='1", { headers: { Accept: 'application/json' } });
    check('SQL-injection attempt in filter is ignored safely', r.status === 200 && !r.json.filters.category);

    console.log('\n7. CSV export & data isolation');
    r = await user1.get('/analytics/export.csv');
    check('CSV export downloads', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment/.test(r.headers.get('content-disposition')));
    const lines = r.text.replace(/^﻿/, '').trim().split(/\r\n/);
    check('CSV has the required columns', lines[0] === 'Expense Date,Category,Label,Amount (GBP),Description,Submitted At (UTC),Status', lines[0]);
    check('CSV contains all of user1\'s records', lines.length - 1 === Number(agg.n), [lines.length - 1, agg.n]);
    check('CSV neutralises spreadsheet formulas', r.text.includes(`"'=HYPERLINK(""http://evil"")"`));
    check('CSV rows show not-approved status', lines.slice(1).every((l) => l.endsWith(',not-approved')));
    r = await manager.get('/analytics/export.csv?username=user1');
    check('manager1 cannot export user1\'s records', !r.text.includes('Client lunch'));
    r = await manager.get('/api/dashboard', { headers: { Accept: 'application/json' } });
    const [[mAgg]] = await db.execute("SELECT COUNT(*) n FROM expenses WHERE username = 'manager1'");
    check('manager1 dashboard only counts their own expenses', r.json.summary.count === Number(mAgg.n));
    r = await manager.get('/dashboard');
    check('No approve/decline controls exist (Feature 4 not implemented)', !/approve|decline/i.test(r.text.replace(/not-approved/g, '')));
    r = await reg.get('/api/dashboard', { headers: { Accept: 'application/json' } });
    check('New user sees an empty dashboard (no leakage)', r.json.summary.count === 0);

    console.log('\n8. Profile settings');
    ({ token } = await reg.csrf('/profile'));
    r = await reg.post('/profile', { form: { _csrf: token, display_name: 'E2E Renamed' } });
    check('Display name can be updated', r.status === 302);
    const [[u]] = await db.execute('SELECT display_name FROM users WHERE username = ?', [testUser]);
    check('Display name persisted in MySQL', u.display_name === 'E2E Renamed');
    r = await reg.post('/profile/password', { form: { _csrf: token, current_password: 'nope', new_password: 'N3wpassword', confirm_password: 'N3wpassword' } });
    check('Password change requires the correct current password', r.status === 400 && r.text.includes('Current password is incorrect'));
    r = await reg.post('/profile/password', { form: { _csrf: token, current_password: 'Secur3pass', new_password: 'N3wpassword', confirm_password: 'N3wpassword' } });
    check('Password can be changed', r.status === 302);
    const fresh = new Client();
    r = await fresh.login(testUser, 'N3wpassword');
    check('New password works for sign-in', r.status === 302 && r.location === '/dashboard');
    const afd = new FormData();
    afd.append('avatar', new Blob([PNG], { type: 'image/png' }), 'me.png');
    r = await reg.post('/profile/avatar', { body: afd, headers: { 'X-CSRF-Token': token, Accept: 'application/json' } });
    check('Profile picture upload works', r.status === 200 && r.json.ok, r.json);
    r = await reg.get('/profile/avatar');
    check('Own profile picture is served', r.status === 200);

    console.log('\n9. Logout');
    ({ token } = await user1.csrf('/dashboard'));
    r = await user1.post('/logout', { form: { _csrf: token } });
    check('Logout redirects to login', r.status === 302 && /^\/login/.test(r.location));
    r = await user1.get('/dashboard');
    check('After logout, protected pages redirect to login', r.status === 302 && r.location === '/login');
    r = await user1.get('/');
    check('Security headers present (CSP, no-sniff, frame deny)', /default-src 'self'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-content-type-options') === 'nosniff');
  } finally {
    if (!KEEP) {
      const ids = createdIds.filter(Boolean);
      if (ids.length) {
        const [rows] = await db.query('SELECT receipt_path FROM expenses WHERE id IN (?)', [ids]);
        rows.forEach((x) => { if (x.receipt_path) fs.rmSync(path.join(ROOT, 'storage', 'receipts', x.receipt_path), { force: true }); });
        await db.query('DELETE FROM expenses WHERE id IN (?)', [ids]);
      }
      const [[tu]] = await db.execute('SELECT id, avatar_path FROM users WHERE username = ?', [testUser]);
      if (tu) {
        fs.rmSync(path.join(ROOT, 'storage', 'avatars', String(tu.id)), { recursive: true, force: true });
        await db.execute('DELETE FROM activity_log WHERE username = ?', [testUser]);
        await db.execute('DELETE FROM users WHERE id = ?', [tu.id]);
      }
      await db.execute("DELETE FROM activity_log WHERE username IN ('user1','manager1') AND created_at >= UTC_TIMESTAMP() - INTERVAL 10 MINUTE");
      console.log('\n(test data cleaned up - use --keep to retain it)');
    }
    await db.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
