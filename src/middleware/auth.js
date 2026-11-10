'use strict';
const { pool } = require('../config/db');

/** Loads the logged-in user (fresh from DB) into req.user / res.locals.currentUser. */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (!req.session || !req.session.userId) return next();
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, display_name, email, role, avatar_path, created_at FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (!rows.length) {
      // Account vanished - kill the stale session.
      return req.session.regenerate(() => next());
    }
    req.user = rows[0];
    res.locals.currentUser = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json') || req.path.startsWith('/api/');
}

/** Blocks anonymous access. Pages redirect to /login, API calls get 401. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.session.flash = { type: 'info', message: 'Please sign in to continue.' };
  return res.redirect('/login');
}

/** For login/register pages: signed-in users go straight to the dashboard. */
function redirectIfAuthenticated(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

module.exports = { loadUser, requireAuth, redirectIfAuthenticated, wantsJson };
