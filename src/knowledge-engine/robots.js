'use strict';

/**
 * robots.js — Gate robots.txt, con cache su file JSON (data/knowledge-engine/
 * robots-cache.json) invece del backing SQLite di Staging (deciso con
 * l'utente: niente better-sqlite3 per un caso d'uso di 2 soli siti fissi).
 * Cache a due livelli: Map in-process (nessuna scadenza entro il processo)
 * + file JSON su disco con TTL 24h, cosi' un robots.txt già scaricato
 * sopravvive a un riavvio invece di essere ri-scaricato ad ogni ingest.
 *
 * Adattato da Staging/src/knowledge-engine/crawler/robots.js.
 */

const fs = require('fs');
const path = require('path');
const robotsParser = require('robots-parser');
const { withRetry, withTimeout } = require('./retry');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, '..', '..', 'data', 'knowledge-engine', 'robots-cache.json');

function loadCacheFile() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCacheFile(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('robots-cache write failed:', e.message);
  }
}

class RobotsGate {
  constructor({ userAgent = 'ParmaDemoBot', ttlMs = DEFAULT_TTL_MS, fetchTimeoutMs = 8000 } = {}) {
    this.userAgent = userAgent;
    this.ttlMs = ttlMs;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this._mem = new Map(); // host -> istanza robots-parser (cache per-processo)
    this._diskCache = loadCacheFile(); // host -> { body, ok, fetched_at }
  }

  async _fetch(host) {
    const robotsUrl = `https://${host}/robots.txt`;
    try {
      return await withRetry(
        async () => {
          const t = withTimeout(this.fetchTimeoutMs);
          try {
            const res = await fetch(robotsUrl, { signal: t.signal });
            if (!res.ok) return { body: null, ok: false };
            return { body: await res.text(), ok: true };
          } finally {
            t.clear();
          }
        },
        { retries: 2, baseDelayMs: 500 }
      );
    } catch {
      return { body: null, ok: false };
    }
  }

  async _load(host) {
    if (this._mem.has(host)) return this._mem.get(host);

    const cached = this._diskCache[host];
    const fresh = cached && Date.now() - cached.fetched_at < this.ttlMs;

    let body, ok;
    if (fresh) {
      body = cached.body;
      ok = !!cached.ok;
    } else {
      const res = await this._fetch(host);
      body = res.body;
      ok = res.ok;
      this._diskCache[host] = { body, ok, fetched_at: Date.now() };
      saveCacheFile(this._diskCache);
    }

    const parsed = body && ok ? robotsParser(`https://${host}/robots.txt`, body) : null;
    this._mem.set(host, parsed);
    return parsed;
  }

  async isAllowed(url) {
    try {
      const host = new URL(url).hostname;
      const robots = await this._load(host);
      if (!robots) return true; // niente robots.txt / irraggiungibile -> permesso
      return robots.isAllowed(url, this.userAgent) !== false;
    } catch {
      return true;
    }
  }

  async getSitemaps(url) {
    try {
      const host = new URL(url).hostname;
      const robots = await this._load(host);
      if (!robots || typeof robots.getSitemaps !== 'function') return [];
      return robots.getSitemaps() || [];
    } catch {
      return [];
    }
  }
}

module.exports = { RobotsGate };
