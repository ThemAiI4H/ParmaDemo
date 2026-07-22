'use strict';

/**
 * documents.js — Generazione PDF al volo per il tool `generate_document`.
 *
 * Usato dall'AI per produrre un allegato scaricabile (es. riepilogo,
 * scheda informativa) su richiesta esplicita dell'utente.
 *
 * Ported from Staging/src/lib/documents.js senza modifiche.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const { UPLOAD_DIR } = require('./uploads');

function generatePdf(title, content) {
  return new Promise((resolve, reject) => {
    const filename = `${uuidv4()}.pdf`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(18).text(title, { align: 'left' });
    doc.moveDown();
    doc.fontSize(11).text(content, { align: 'left' });
    doc.end();

    stream.on('finish', () => {
      const { size } = fs.statSync(filePath);
      resolve({ filename, size });
    });
    stream.on('error', reject);
  });
}

module.exports = { generatePdf };
