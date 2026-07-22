'use strict';

/**
 * Canonicalizzazione URL condivisa da crawler ed extraction. Nessuna
 * dipendenza esterna (solo WHATWG URL).
 *
 * Ported from Staging/src/knowledge-engine/lib/url.js senza modifiche.
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'igshid'
]);

const SKIP_PROTOCOLS = ['mailto:', 'tel:', 'javascript:', 'sms:', 'whatsapp:', 'data:', 'ftp:'];

const BINARY_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.dmg', '.exe',
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.ogg', '.webm',
  '.css', '.js', '.mjs', '.woff', '.woff2', '.ttf', '.eot', '.json', '.xml'
]);

const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };

/**
 * Canonicalizza un URL per accodamento/dedup. Ritorna null SOLO per URL
 * strutturalmente non crawlabili (schema errato, malformato, punta a un
 * asset binario) — mai in base alla qualità del contenuto.
 */
function normalizeUrl(raw, base) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  if (SKIP_PROTOCOLS.some((p) => lower.startsWith(p))) return null;

  let u;
  try {
    u = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  if (DEFAULT_PORT[u.protocol] === u.port) u.port = '';

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  const sorted = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of sorted) u.searchParams.append(k, v);

  const pathLower = u.pathname.toLowerCase();
  const dot = pathLower.lastIndexOf('.');
  if (dot !== -1 && BINARY_EXTENSIONS.has(pathLower.slice(dot))) return null;

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Rimuove un eventuale "www." iniziale, cosi' "www.example.com" ed "example.com" sono considerati lo stesso sito. */
function registrableHost(host) {
  return host && host.startsWith('www.') ? host.slice(4) : host;
}

function sameSite(hostA, hostB) {
  return registrableHost(hostA) === registrableHost(hostB);
}

module.exports = { normalizeUrl, hostOf, registrableHost, sameSite };
