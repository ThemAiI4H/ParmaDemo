'use strict';

/**
 * extraction.js — Estrazione documento.
 *
 * Trasforma l'HTML grezzo scaricato in testo pulito + link in uscita.
 * Nessun giudizio di qualità qui: l'estrazione ritorna sempre il testo che
 * trova, per quanto corto — decidere se è "abbastanza buono" resta compito
 * di chi chiama (in ParmaDemo: calculateQualityScore in crawler.js, poi il
 * chunking token-aware di rag.js).
 *
 * Approccio strutturale (Readability + fallback a strip di selettori
 * boilerplate) invece delle regex di frasi italiane hardcoded prima usate
 * in crawler.js — più robusto su pagine che non sono "articoli" (elenchi,
 * portali, form).
 *
 * Ported from Staging/src/knowledge-engine/extraction/document.js senza
 * modifiche di logica (solo il path del require di ./url).
 */

const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const cheerio = require('cheerio');
const { normalizeUrl } = require('./url');

const BOILERPLATE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'template',
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.cookie', '.cookies', '.cookie-banner', '#cookie-banner', '.cookie-consent',
  '.nav', '.navbar', '.menu', '.sidebar', '.breadcrumb', '.breadcrumbs',
  '.ads', '.advertisement', '.social-share', '.share-buttons'
];

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Estrazione articolo di Readability — ottima per pagine tipo articolo/blog. */
function extractWithReadability(html, url) {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.textContent) return null;
    return normalizeText(article.textContent);
  } catch {
    return null;
  }
}

/** Testo dell'intero body con boilerplate rimosso — fallback per pagine che Readability non sa interpretare come "articolo" (elenchi, portali, form). */
function extractWithBoilerplateStrip($) {
  const $doc = $.root().clone();
  for (const sel of BOILERPLATE_SELECTORS) {
    try { $doc.find(sel).remove(); } catch {}
  }
  const parts = [];
  $doc.find('h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  });
  return normalizeText(parts.join('\n\n'));
}

function extractLinks($, baseUrl) {
  const out = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) out.add(normalized);
  });
  return [...out];
}

function extractMeta($, url) {
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || '';
  const description = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || '';
  const lang = $('html').attr('lang') || '';
  const canonicalHref = $('link[rel="canonical"]').attr('href');
  const canonicalUrl = canonicalHref ? normalizeUrl(canonicalHref, url) : null;
  return { title, description, lang, canonicalUrl };
}

/**
 * Estrae un documento testuale pulito + link in uscita dall'HTML scaricato.
 * Ritorna sempre un documento, anche se il testo è vuoto/corto — la
 * qualità viene giudicata a valle.
 */
function extractDocument(html, url) {
  const $ = cheerio.load(html);
  const meta = extractMeta($, url);
  const links = extractLinks($, url);

  let text = extractWithReadability(html, url);
  const boilerplateStripped = extractWithBoilerplateStrip($);
  if (!text || boilerplateStripped.length > text.length * 1.4) {
    text = boilerplateStripped;
  }

  return {
    url,
    canonicalUrl: meta.canonicalUrl || url,
    title: meta.title,
    description: meta.description,
    lang: meta.lang,
    text: text || '',
    links
  };
}

module.exports = { extractDocument, normalizeText };
