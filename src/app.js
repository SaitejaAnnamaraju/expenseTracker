'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const helmet = require('helmet');
const config = require('./config');
const { pool } = require('./config/db');
const { loadUser, wantsJson } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');

const MySQLStore = MySQLStoreFactory(session);
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(config.paths.root, 'views'));
// Behind a hosting proxy (Render, Heroku...) trust the first hop so req.secure is
// correct and the Secure session cookie is actually set. Override with TRUST_PROXY.
app.set('trust proxy', process.env.TRUST_PROXY !== undefined
  ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY)
  : (config.isProd ? 1 : 'loopback'));
app.disable('x-powered-by');

// ---------------------------------------------------------------- Security headers + CSP
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],                                   // no inline scripts anywhere
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:'],                     // blob: = local receipt preview
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------- Static assets
const staticOpts = { maxAge: config.isProd ? '7d' : 0, index: false };
app.use('/static', express.static(path.join(config.paths.root, 'public'), staticOpts));
const vendor = (p) => path.join(config.paths.root, 'node_modules', p);
app.use('/vendor/chart.js', express.static(vendor('chart.js/dist'), staticOpts));
app.use('/vendor/lucide', express.static(vendor('lucide/dist/umd'), staticOpts));
app.use('/vendor/marked', express.static(vendor('marked/lib'), staticOpts));
app.use('/vendor/dompurify', express.static(vendor('dompurify/dist'), staticOpts));
// NOTE: storage/ (receipts, avatars) is intentionally NOT served statically.

// ---------------------------------------------------------------- Body parsing
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------- Sessions (stored in MySQL)
const sessionStore = new MySQLStore({
  createDatabaseTable: false,                 // created by database/schema.sql
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000,            // server-side lifetime for non-"remember me" sessions
  schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
}, pool);

app.use(session({
  name: 'bet.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// ---------------------------------------------------------------- Per-request locals
app.use(loadUser);
app.use(csrfProtection);
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.active = '';
  res.locals.path = req.path;
  // Authenticated pages must never be served from the browser cache after logout.
  if (req.user) res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------- Routes
app.get('/healthz', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up' }); } catch { res.status(503).json({ ok: false, db: 'down' }); }
});
app.use(require('./routes/auth'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/expenses'));
app.use(require('./routes/profile'));

// ---------------------------------------------------------------- 404 + errors
app.use((req, res) => {
  if (wantsJson(req)) return res.status(404).json({ error: 'Not found' });
  res.status(404).render('error', { title: 'Page not found', status: 404, message: 'The page you were looking for does not exist.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message;
  if (wantsJson(req) || req.is('multipart/form-data')) return res.status(status).json({ error: message, code: err.code });
  res.status(status).render('error', { title: 'Error', status, message });
});

module.exports = { app, sessionStore };
