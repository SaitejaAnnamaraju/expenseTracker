'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { redirectIfAuthenticated, requireAuth } = require('../middleware/auth');
const { USERNAME_RE, EMAIL_RE, passwordProblems, validateDisplayName } = require('../utils/validators');
const activity = require('../services/activity');

const router = express.Router();
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
// Used to keep response time constant when the username does not exist (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('auth/login', {
    title: 'Sign in', values: { username: req.body.username || '' },
    error: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
  }),
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

/** Rotates the session id (prevents session fixation) and signs the user in. */
function establishSession(req, user, remember) {
  const returnTo = req.session.returnTo;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      if (remember) req.session.cookie.maxAge = REMEMBER_MS;
      else req.session.cookie.expires = false; // browser-session cookie
      req.session.save((e) => (e ? reject(e) : resolve(returnTo)));
    });
  });
}

router.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('auth/login', { title: 'Sign in', values: {}, error: null });
});

router.post('/login', redirectIfAuthenticated, loginLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const remember = req.body.remember === 'on';

    if (!identifier || !password) {
      return res.status(400).render('auth/login', { title: 'Sign in', values: { username: identifier }, error: 'Please enter your username and password.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1',
      [identifier, identifier.toLowerCase()]
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).render('auth/login', { title: 'Sign in', values: { username: identifier }, error: 'Invalid username or password.' });
    }

    const returnTo = await establishSession(req, user, remember);
    await activity.log(user.username, 'login', remember ? 'Remember me enabled' : null, req);
    req.session.flash = { type: 'success', message: 'Welcome back! You are now signed in.' };
    const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/api/') ? returnTo : '/dashboard';
    res.redirect(safeReturn);
  } catch (e) { next(e); }
});

router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('auth/register', { title: 'Create account', values: {}, errors: {} });
});

router.post('/register', redirectIfAuthenticated, registerLimiter, async (req, res, next) => {
  try {
    const values = {
      display_name: String(req.body.display_name || ''),
      username: String(req.body.username || '').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
    };
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || '');
    const errors = {};

    const dn = validateDisplayName(values.display_name);
    if (dn.error) errors.display_name = dn.error;
    if (!USERNAME_RE.test(values.username)) errors.username = 'Username must be 3-50 characters: letters, numbers, dot, dash or underscore.';
    if (!EMAIL_RE.test(values.email) || values.email.length > 255) errors.email = 'Please enter a valid email address.';
    const pwErr = passwordProblems(password);
    if (pwErr) errors.password = pwErr;
    else if (password !== confirm) errors.confirm_password = 'Passwords do not match.';
    if (req.body.terms !== 'on') errors.terms = 'Please accept the acceptable-use policy.';

    if (!errors.username || !errors.email) {
      const [dupes] = await pool.execute('SELECT username, email FROM users WHERE username = ? OR email = ?', [values.username, values.email]);
      if (dupes.some((d) => d.username.toLowerCase() === values.username.toLowerCase())) errors.username = 'That username is already taken.';
      if (dupes.some((d) => d.email === values.email)) errors.email = 'An account with that email already exists.';
    }

    if (Object.keys(errors).length) {
      return res.status(400).render('auth/register', { title: 'Create account', values, errors });
    }

    const hash = await bcrypt.hash(password, 12);
    let id;
    try {
      const [r] = await pool.execute(
        'INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, \'user\')',
        [values.username, dn.value, values.email, hash]
      );
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(400).render('auth/register', { title: 'Create account', values, errors: { username: 'That username or email is already registered.' } });
      }
      throw e;
    }
    await activity.log(values.username, 'register', null, req);
    await establishSession(req, { id }, false);
    req.session.flash = { type: 'success', message: `Account created. Welcome, ${dn.value}!` };
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await activity.log(req.user.username, 'logout', null, req);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('bet.sid');
      res.redirect('/login?signedout=1');
    });
  } catch (e) { next(e); }
});

module.exports = router;
