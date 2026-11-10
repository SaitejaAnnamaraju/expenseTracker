'use strict';
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { avatarUpload, removeFile } = require('../middleware/upload');
const { passwordProblems, validateDisplayName } = require('../utils/validators');
const activity = require('../services/activity');

const router = express.Router();

function renderProfile(res, extra = {}, status = 200) {
  res.status(status).render('profile', {
    title: 'Profile settings', active: 'profile', errors: {}, pwErrors: {}, values: {}, ...extra,
  });
}

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const [[counts]] = await pool.execute('SELECT COUNT(*) AS n FROM expenses WHERE username = ?', [req.user.username]);
    renderProfile(res, { expenseCount: Number(counts.n) });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- Display name
router.post('/profile', requireAuth, async (req, res, next) => {
  try {
    const dn = validateDisplayName(req.body.display_name);
    if (dn.error) {
      return renderProfile(res, { errors: { display_name: dn.error }, values: { display_name: req.body.display_name }, expenseCount: null }, 400);
    }
    await pool.execute('UPDATE users SET display_name = ? WHERE id = ?', [dn.value, req.user.id]);
    await activity.log(req.user.username, 'profile_updated', 'Display name changed', req);
    req.session.flash = { type: 'success', message: 'Profile updated.' };
    res.redirect('/profile');
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- Password
router.post('/profile/password', requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body.current_password || '');
    const next1 = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    const pwErrors = {};

    const [[row]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!current || !(await bcrypt.compare(current, row.password_hash))) pwErrors.current_password = 'Current password is incorrect.';
    const problem = passwordProblems(next1);
    if (problem) pwErrors.new_password = problem;
    else if (next1 === current) pwErrors.new_password = 'New password must be different from the current one.';
    if (!pwErrors.new_password && next1 !== confirm) pwErrors.confirm_password = 'Passwords do not match.';

    if (Object.keys(pwErrors).length) return renderProfile(res, { pwErrors, expenseCount: null, openPassword: true }, 400);

    const hash = await bcrypt.hash(next1, 12);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    // Sign out every other session belonging to this user.
    await pool.execute(
      `DELETE FROM sessions WHERE session_id <> ? AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.userId')) = ?`,
      [req.sessionID, String(req.user.id)]
    );
    await activity.log(req.user.username, 'password_changed', null, req);
    req.session.flash = { type: 'success', message: 'Password changed. Other devices have been signed out.' };
    res.redirect('/profile');
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- Avatar (JSON, multipart)
router.post('/profile/avatar', requireAuth, avatarUpload, async (req, res, next) => {
  try {
    if (req.uploadError) return res.status(400).json({ error: req.uploadError });
    if (!req.file) return res.status(400).json({ error: 'Please choose an image to upload.' });
    const rel = path.relative(config.paths.avatars, req.file.path).split(path.sep).join('/');
    const old = req.user.avatar_path;
    await pool.execute('UPDATE users SET avatar_path = ? WHERE id = ?', [rel, req.user.id]);
    if (old) await removeFile(path.join(config.paths.avatars, old));
    await activity.log(req.user.username, 'avatar_updated', null, req);
    res.json({ ok: true, message: 'Profile picture updated.', url: `/profile/avatar?v=${Date.now()}` });
  } catch (e) {
    await removeFile(req.file && req.file.path);
    next(e);
  }
});

router.post('/profile/avatar/delete', requireAuth, async (req, res, next) => {
  try {
    if (req.user.avatar_path) {
      await pool.execute('UPDATE users SET avatar_path = NULL WHERE id = ?', [req.user.id]);
      await removeFile(path.join(config.paths.avatars, req.user.avatar_path));
      await activity.log(req.user.username, 'avatar_removed', null, req);
    }
    req.session.flash = { type: 'success', message: 'Profile picture removed.' };
    res.redirect('/profile');
  } catch (e) { next(e); }
});

/** Serves ONLY the signed-in user's own avatar (no user-controlled path). */
router.get('/profile/avatar', requireAuth, (req, res) => {
  if (!req.user.avatar_path) return res.status(404).end();
  const full = path.resolve(config.paths.avatars, req.user.avatar_path);
  if (!full.startsWith(path.resolve(config.paths.avatars) + path.sep)) return res.status(404).end();
  res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(full, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

module.exports = router;
