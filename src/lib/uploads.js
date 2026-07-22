'use strict';

/**
 * uploads.js — Upload allegati chat (immagini/documenti) su disco.
 *
 * File salvati in data/uploads/ e serviti staticamente da /uploads (server.js).
 * Nomi file generati (uuid) per evitare collisioni/traversal; il nome
 * originale resta solo come metadato mostrato nel widget.
 *
 * Ported from Staging/src/lib/uploads.js senza modifiche (stessa profondità
 * relativa: ParmaDemo/src/lib/ come Staging/src/lib/).
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

const MIME_KIND = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'text/plain': 'document'
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

function classifyMime(mimeType) {
  return MIME_KIND[mimeType] || null;
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    cb(null, !!classifyMime(file.mimetype));
  }
});

/** Risolve un url pubblico /uploads/<file> nel path assoluto su disco. */
function resolveUploadPath(url) {
  const filename = path.basename(url);
  return path.join(UPLOAD_DIR, filename);
}

module.exports = { UPLOAD_DIR, upload, classifyMime, resolveUploadPath, MAX_FILE_SIZE };
