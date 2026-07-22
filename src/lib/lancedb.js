'use strict';

/**
 * lib/lancedb.js — connessione LanceDB condivisa.
 *
 * Adattato da Staging/src/lib/lancedb.js: ParmaDemo e' single-tenant (un solo
 * sito/knowledge-base), quindi qui NON si usa un path per-kbId ne' uno schema
 * Arrow esplicito (apache-arrow) — si mantiene lo stesso path fisso
 * (data/lancedb) e lo stesso schema inferito-da-record-dummy che l'indice
 * gia' popolato usa oggi, per non richiedere un reset dei dati esistenti.
 */

const path = require('path');
const lancedb = require('@lancedb/lancedb');

const EMBEDDING_DIM = 1536; // text-embedding-3-small
const TABLE_NAME = 'documents';
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'lancedb');

let _db = null;
let _table = null;

/** Apre (o crea al primo utilizzo) la tabella `documents`. Cache in-process. */
async function getTable() {
  if (_table) return _table;

  _db = await lancedb.connect(DB_PATH);
  const names = await _db.tableNames();

  if (names.includes(TABLE_NAME)) {
    _table = await _db.openTable(TABLE_NAME);
  } else {
    // Record dummy per inizializzare correttamente lo schema (LanceDB lo
    // inferisce dal primo insert quando non si passa uno schema esplicito).
    const dummy = [{
      vector: Array(EMBEDDING_DIM).fill(0),
      text: 'init',
      title: 'init',
      url: 'init',
      site: 'init',
      hash: 'init',
      createdAt: Date.now()
    }];
    _table = await _db.createTable(TABLE_NAME, dummy);
  }

  return _table;
}

module.exports = { getTable, DB_PATH, TABLE_NAME, EMBEDDING_DIM };
