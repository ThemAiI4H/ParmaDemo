'use strict';

/**
 * retry.js — Backoff esponenziale con jitter, condiviso da fetcher.js e
 * robots.js. Ported from Staging/src/knowledge-engine/lib/retry.js senza
 * modifiche.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter. `isRetryable(err)` decide se un errore
 * merita un altro tentativo (es. HTTP 404 non va ritentato, un timeout o
 * 503 sì).
 */
async function withRetry(fn, {
  retries = 3,
  baseDelayMs = 500,
  maxDelayMs = 20000,
  isRetryable = () => true
} = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      if (!retryable || attempt === retries) {
        e.retryable = retryable;
        throw e;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay + Math.floor(Math.random() * 0.3 * delay));
    }
  }
  throw lastErr;
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

module.exports = { sleep, withRetry, withTimeout };
