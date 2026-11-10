'use strict';
const crypto = require('crypto');

/**
 * Synchronizer-token CSRF protection.
 * - A per-session random token is exposed to views as `csrfToken`.
 * - Every state-changing request must echo it back, either in the
 *   `X-CSRF-Token` header (fetch/XHR, including multipart uploads) or in a
 *   `_csrf` body field (classic url-encoded forms).
 * - Multipart requests MUST use the header, so the token is verified before
 *   multer writes anything to disk.
 */
function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const supplied = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (supplied && safeEqual(supplied, token)) return next();

  const err = new Error('Invalid or missing security token. Please refresh the page and try again.');
  err.status = 403;
  err.code = 'EBADCSRFTOKEN';
  next(err);
}

module.exports = { csrfProtection, ensureToken };
