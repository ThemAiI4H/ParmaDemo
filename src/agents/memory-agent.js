'use strict';

/**
 * memory-agent.js — Storico conversazioni (in-memory).
 *
 * Map globale, nessun TTL, nessuna persistenza — stesso comportamento della
 * Map di sessioni già usata altrove in server.js (es. liveavatarSessions).
 *
 * Ported from Staging/src/agents/memory-agent.js senza modifiche.
 */

function createMemoryAgent() {
  const sessions = new Map();

  function getHistory(sessionId) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    return sessions.get(sessionId);
  }

  function append(sessionId, message) {
    getHistory(sessionId).push(message);
  }

  function clear(sessionId) {
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
  }

  return { getHistory, append, clear };
}

module.exports = { createMemoryAgent };
