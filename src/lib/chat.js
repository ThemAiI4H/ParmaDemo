'use strict';

/**
 * chat.js — Helper di chat condivisi.
 *
 * Ported from Staging/src/lib/chat.js senza modifiche.
 */

function filterHistoryForAPI(history) {
  return history.filter(msg => {
    // Escludi solo i messaggi assistant con tool_calls (non utili per la
    // chiamata API successiva). I messaggi `tool` (risultati) vanno tenuti.
    if (msg.role === 'assistant' && msg.tool_calls) {
      return false;
    }
    return true;
  });
}

module.exports = { filterHistoryForAPI };
