'use strict';

const axios = require('axios');
const xml2js = require('xml2js');
const { withRetry } = require('./retry');

const MAX_SITEMAPS = 50;
const MAX_URLS = 50000;
const MAX_SITEMAP_DEPTH = 3;

async function fetchXml(url, timeoutMs) {
  return withRetry(
    async () => {
      const res = await axios.get(url, {
        timeout: timeoutMs,
        headers: { Accept: 'application/xml,text/xml,*/*' },
        validateStatus: (s) => s === 200
      });
      return xml2js.parseStringPromise(res.data);
    },
    { retries: 2, baseDelayMs: 500 }
  );
}

/**
 * Scopre ed espande le sitemap di un sito (i sitemap-index vengono seguiti
 * ricorsivamente, con un tetto per sicurezza). Best-effort: una sitemap
 * mancante o rotta non è fatale, l'URL seed viene comunque accodato a
 * prescindere dal successo di questa funzione.
 *
 * Ported from Staging/src/knowledge-engine/crawler/sitemap.js senza
 * modifiche (solo il path del require di ./retry).
 */
async function discoverSitemapUrls(origin, { robots, timeoutMs = 8000, log = () => {} } = {}) {
  const seeds = new Set();

  if (robots) {
    const fromRobots = await robots.getSitemaps(origin).catch(() => []);
    for (const s of fromRobots) seeds.add(s);
  }
  seeds.add(`${origin.replace(/\/$/, '')}/sitemap.xml`);

  const pageUrls = new Set();
  const visited = new Set();
  let queue = [...seeds].map((url) => ({ url, depth: 0 }));

  while (queue.length && visited.size < MAX_SITEMAPS) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > MAX_SITEMAP_DEPTH) continue;
    visited.add(url);

    let parsed;
    try {
      parsed = await fetchXml(url, timeoutMs);
    } catch {
      continue;
    }

    if (parsed?.sitemapindex?.sitemap) {
      for (const s of parsed.sitemapindex.sitemap) {
        const loc = s.loc?.[0];
        if (loc) queue.push({ url: loc, depth: depth + 1 });
      }
      log(`sitemap index ${url}: ${parsed.sitemapindex.sitemap.length} child sitemaps`);
    } else if (parsed?.urlset?.url) {
      for (const u of parsed.urlset.url) {
        const loc = u.loc?.[0];
        if (loc) pageUrls.add(loc);
        if (pageUrls.size >= MAX_URLS) break;
      }
      log(`sitemap ${url}: ${parsed.urlset.url.length} urls`);
    }

    if (pageUrls.size >= MAX_URLS) break;
  }

  return [...pageUrls];
}

module.exports = { discoverSitemapUrls };
