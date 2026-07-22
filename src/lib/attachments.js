'use strict';

/**
 * attachments.js — Lettura del contenuto degli allegati chat per l'AI.
 *
 * Documenti: estrazione testo (pdf-parse / mammoth / plain text), troncato
 * per non far esplodere il contesto. Immagini: incapsulate come data URL da
 * passare come content multimodale a OpenAI (gpt-4o-mini supporta vision).
 *
 * Ported from Staging/src/lib/attachments.js (no adaptation needed — pure
 * filesystem/string functions, nessuna dipendenza da demo/tenant).
 */

const fs = require('fs');

const MAX_EXTRACTED_CHARS = 8000;

async function extractDocumentText(absPath, mimeType) {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(absPath));
      return data.text.slice(0, MAX_EXTRACTED_CHARS);
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: absPath });
      return result.value.slice(0, MAX_EXTRACTED_CHARS);
    }
    if (mimeType === 'text/plain') {
      return fs.readFileSync(absPath, 'utf8').slice(0, MAX_EXTRACTED_CHARS);
    }
    return null;
  } catch (err) {
    console.error('extractDocumentText error:', err.message);
    return null;
  }
}

function imageToDataUrl(absPath, mimeType) {
  const buffer = fs.readFileSync(absPath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

module.exports = { extractDocumentText, imageToDataUrl };
