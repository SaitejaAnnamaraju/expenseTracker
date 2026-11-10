'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { sniff } = require('../utils/fileSignature');

const RECEIPT_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};
const RECEIPT_EXT = ['.jpg', '.jpeg', '.png', '.pdf'];

const AVATAR_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const AVATAR_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Files are written OUTSIDE the public web root with random names
 * (the original filename is never used on disk).
 */
function makeUploader({ dir, types, exts, maxBytes, field }) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      // One sub-folder per user id (numeric -> safe path segment).
      const target = path.join(dir, String(req.user.id));
      fs.mkdir(target, { recursive: true }, (err) => cb(err, target));
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${types[file.mimetype]}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxBytes, files: 1, fields: 20, fieldSize: 64 * 1024 },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!types[file.mimetype] || !exts.includes(ext)) {
        const e = new Error('Unsupported file type.');
        e.code = 'UNSUPPORTED_FILE';
        return cb(e);
      }
      cb(null, true);
    },
  }).single(field);

  // Wrap so multer errors become friendly 400s and the content is verified by signature.
  return function uploadMiddleware(req, res, next) {
    upload(req, res, async (err) => {
      if (err) {
        const mb = Math.round(maxBytes / 1024 / 1024);
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large. Maximum size is ${mb} MB.`
          : err.code === 'UNSUPPORTED_FILE' ? `Unsupported file type. Allowed: ${exts.map((e) => e.slice(1).toUpperCase()).join(', ')}.`
          : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field.'
          : 'File upload failed.';
        req.uploadError = msg;
        return next();
      }
      if (req.file) {
        try {
          const real = await sniff(req.file.path);
          if (!real || !types[real]) {
            await removeFile(req.file.path);
            req.file = undefined;
            req.uploadError = 'The file content does not match an allowed type (it may be corrupted or renamed).';
          } else {
            req.file.detectedType = real;
          }
        } catch (e) {
          return next(e);
        }
      }
      next();
    });
  };
}

async function removeFile(p) {
  if (!p) return;
  try { await fsp.unlink(p); } catch { /* already gone */ }
}

const receiptUpload = makeUploader({
  dir: config.paths.receipts, types: RECEIPT_TYPES, exts: RECEIPT_EXT,
  maxBytes: config.uploads.maxReceiptBytes, field: 'receipt',
});
const avatarUpload = makeUploader({
  dir: config.paths.avatars, types: AVATAR_TYPES, exts: AVATAR_EXT,
  maxBytes: config.uploads.maxAvatarBytes, field: 'avatar',
});

module.exports = { receiptUpload, avatarUpload, removeFile };
