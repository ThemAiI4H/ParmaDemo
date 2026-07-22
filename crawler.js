const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const PQueue = require('p-queue').default;

const { PageFetcher } = require('./src/knowledge-engine/fetcher');
const { RobotsGate } = require('./src/knowledge-engine/robots');
const { discoverSitemapUrls } = require('./src/knowledge-engine/sitemap');
const { HostThrottle } = require('./src/knowledge-engine/host-throttle');
const { extractDocument } = require('./src/knowledge-engine/extraction');
const { normalizeUrl, sameSite, hostOf } = require('./src/knowledge-engine/url');

const SITES = [
  'https://www.clinicacittadiparma.it/',
  'https://www.ausl.pr.it/come_fare/ticket/default.aspx',
  'https://www.ausl.pr.it/come_fare/ticket/default.aspx',
  'https://www.comune.parma.it/it/servizi/salute-benessere-e-assistenza/esenzione-dal-pagamento-del-ticket-sanitario-2026',
  'https://www.ausl.pr.it/dove_curarsi/privato_accreditato/default.aspx',
  'https://www.ausl.pr.it/come_fare/prenotazioni_disdette/assistenza-specialistica.aspx#:~:text=Con%20la%20prescrizione%20del%20medico,strutture%20sanitarie%20convenzionate%20del%20territorio.'

];

const CONFIG = {
  MAX_DEPTH: 12,
  MAX_PAGES_PER_SITE: 2000,
  CONCURRENCY: 4,
  DATA_DIR: path.join(__dirname, 'data/raw'),
  CACHE_FILE: path.join(__dirname, 'data/crawl-cache.json'),
  RAW_HTML_MAX_CHARS: 150000,
  CONTENT_MIN_LENGTH: 200
};

// Politeness per-host (indipendente dalla concorrenza globale CONFIG.CONCURRENCY
// sopra): al più 2 richieste in volo per host, almeno 300ms tra l'avvio di
// due richieste sullo stesso host. Sostituisce il precedente REQUEST_DELAY_MS
// fisso globale — vedi src/knowledge-engine/host-throttle.js.
const HOST_THROTTLE_OPTIONS = { maxPerHost: 2, minDelayMs: 300 };

let CACHE = { pages: {}, lastRun: null };
const FORCE_CRAWL = process.argv.includes('--force');

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

async function loadCache() {
  try {
    const data = await fs.readFile(CONFIG.CACHE_FILE, 'utf8');
    CACHE = JSON.parse(data);
  } catch {}
}

async function saveCache() {
  await fs.writeFile(CONFIG.CACHE_FILE, JSON.stringify(CACHE, null, 2));
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function calculateQualityScore(text) {
  let score = 0;
  const length = text.length;
  if (length > 200) score += 30;
  if (length > 1000) score += 20;
  if (length > 5000) score += 10;

  const sentences = (text.match(/[.!?]\s/g) || []).length;
  score += Math.min(sentences, 40);

  return Math.min(score, 100);
}

function normalizeBlock(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function deduplicateSiteBlocks(pages) {
  const blockCounts = new Map();
  const pageBlocks = new Map();

  for (const [url, doc] of pages) {
    const blocks = doc.content.split(/\n{2,}/).map(b => b.trim()).filter(b => b.length > 20);
    const normalized = blocks.map(normalizeBlock);
    pageBlocks.set(url, { blocks, normalized });

    normalized.forEach(nb => {
      blockCounts.set(nb, (blockCounts.get(nb) || 0) + 1);
    });
  }

  const threshold = Math.max(2, Math.floor(pages.size * 0.3));
  const boilerplateBlocks = new Set();

  for (const [block, count] of blockCounts) {
    if (count >= threshold) {
      boilerplateBlocks.add(block);
    }
  }

  for (const [url, { blocks, normalized }] of pageBlocks) {
    const filteredBlocks = blocks.filter((_, i) => !boilerplateBlocks.has(normalized[i]));
    const newContent = filteredBlocks.join('\n\n');

    if (newContent.length >= CONFIG.CONTENT_MIN_LENGTH) {
      const doc = pages.get(url);
      doc.content = newContent;
      doc.qualityScore = calculateQualityScore(newContent);

      const fileName = hashContent(url).slice(0, 12) + '.json';
      await fs.writeFile(path.join(CONFIG.DATA_DIR, fileName), JSON.stringify(doc, null, 2));
      pages.set(url, doc);
    }
  }
}

/** Estrazione link "leggera" (solo cheerio, no Readability/boilerplate-strip) — usata sui cache-hit per proseguire la traversal senza rifare il lavoro pesante di estrazione testo. */
function extractLinksQuick(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href]').each((_, el) => {
    const normalized = normalizeUrl($(el).attr('href'), baseUrl);
    if (normalized) out.push(normalized);
  });
  return out;
}

function isExcludedPath(url) {
  return /login|logout|download/i.test(url);
}

async function crawlSite(baseUrl, { fetcher, robots, hostThrottle }) {
  console.log(`\n▶ Crawling: ${baseUrl}`);

  const pages = new Map();
  const processed = new Set();
  const toCrawl = [{ url: baseUrl, depth: 0 }];
  const baseHost = hostOf(baseUrl);

  // Discovery via sitemap.xml: pre-popola la coda con gli URL scoperti,
  // in aggiunta (non in sostituzione) al link-following. Best-effort: una
  // sitemap mancante/rotta non è fatale, il seed è già in coda a prescindere.
  try {
    const sitemapUrls = await discoverSitemapUrls(baseUrl, { robots, log: (m) => console.log(`  🗺 ${m}`) });
    let added = 0;
    for (const u of sitemapUrls) {
      if (sameSite(hostOf(u), baseHost) && !isExcludedPath(u)) {
        toCrawl.push({ url: u, depth: 1 });
        added++;
      }
    }
    if (added) console.log(`  🗺 ${added} URL aggiunti dalla sitemap.xml`);
  } catch (e) {
    console.log(`  ⚠ Sitemap discovery fallita: ${e.message}`);
  }

  const queue = new PQueue({ concurrency: CONFIG.CONCURRENCY });

  const enqueueLinks = (links, depth) => {
    if (depth >= CONFIG.MAX_DEPTH) return;
    for (const link of links) {
      if (sameSite(hostOf(link), baseHost) && !processed.has(link) && !isExcludedPath(link)) {
        toCrawl.push({ url: link, depth: depth + 1 });
      }
    }
  };

  const processPage = async ({ url, depth }) => {
    if (processed.has(url) || depth > CONFIG.MAX_DEPTH || pages.size >= CONFIG.MAX_PAGES_PER_SITE) return;
    processed.add(url);

    // Rispetta robots.txt (i seed non vengono mai esclusi per policy).
    if (url !== baseUrl && !(await robots.isAllowed(url))) {
      console.log(`🚫 robots.txt vieta: ${url}`);
      return;
    }

    const host = hostOf(url);
    await hostThrottle.acquire(host);
    let fetchResult;
    try {
      fetchResult = await fetcher.fetch(url);
    } finally {
      hostThrottle.release(host);
    }

    if (!fetchResult.ok) {
      console.log(`⚠ Fetch fallito ${url}: ${fetchResult.error}`);
      return;
    }

    const html = fetchResult.html;
    const contentHash = hashContent(html);
    const isCached = !FORCE_CRAWL && CACHE.pages[url] === contentHash;

    if (isCached) {
      // Estrai solo i link (leggero) per proseguire la traversal, poi salta
      // il resto: se il file raw esiste già su disco è identico a quello
      // che rigenereremmo.
      enqueueLinks(extractLinksQuick(html, url), depth);

      const fileName = hashContent(url).slice(0, 12) + '.json';
      try {
        const cachedRaw = await fs.readFile(path.join(CONFIG.DATA_DIR, fileName), 'utf8');
        pages.set(url, JSON.parse(cachedRaw));
        console.log(`⏭ Cached, skip processing: ${url}`);
        return;
      } catch {
        // File raw mancante nonostante hash in cache: procedi con l'estrazione normale.
      }
    }

    const extracted = extractDocument(html, url);
    if (!isCached) enqueueLinks(extracted.links, depth);

    const content = extracted.text.trim().slice(0, 150000);

    if (content.length >= CONFIG.CONTENT_MIN_LENGTH) {
      const qualityScore = calculateQualityScore(content);
      const doc = {
        title: extracted.title || 'Untitled',
        url,
        content,
        rawHtml: html.slice(0, CONFIG.RAW_HTML_MAX_CHARS),
        excerpt: content.slice(0, 300).replace(/\n/g, ' '),
        site: baseUrl,
        crawledAt: new Date().toISOString(),
        hash: contentHash,
        qualityScore,
        extractionMethod: 'knowledge-engine'
      };

      const fileName = hashContent(url).slice(0, 12) + '.json';
      await fs.writeFile(path.join(CONFIG.DATA_DIR, fileName), JSON.stringify(doc, null, 2));

      pages.set(url, doc);
      CACHE.pages[url] = contentHash;
      console.log(`✅ Saved: ${doc.title.slice(0,60)} (${content.length} chars, score: ${qualityScore})`);
    } else {
      console.log(`⏭ Too short (${content.length} chars): ${url}`);
    }
  };

  while (toCrawl.length > 0 && pages.size < CONFIG.MAX_PAGES_PER_SITE) {
    const batch = toCrawl.splice(0, CONFIG.CONCURRENCY * 2);
    await queue.addAll(batch.map(item => () => processPage(item)));
    await saveCache();
  }

  await queue.onIdle();

  // Cross-page deduplication
  if (pages.size > 1) {
    console.log(`🧹 Deduplicating common blocks across ${pages.size} pages...`);
    await deduplicateSiteBlocks(pages);
  }

  console.log(`✓ Completed ${baseUrl}: ${pages.size} pages crawled`);
  return pages.size;
}

async function crawlSites() {
  console.log('🚀 CPARMA Optimized Crawler started - Città Cura di Parma');
  if (FORCE_CRAWL) {
    console.log('🔥 Force mode enabled: ignoring cache');
  }
  await ensureDir(CONFIG.DATA_DIR);
  await loadCache();

  // Istanze condivise fra tutti i siti: un solo browser Puppeteer lazy
  // (aperto solo se/quando un fetch HTTP-first non basta), una sola cache
  // robots.txt, un solo limitatore di concorrenza per-host.
  const fetcher = new PageFetcher();
  const robots = new RobotsGate();
  const hostThrottle = new HostThrottle(HOST_THROTTLE_OPTIONS);

  let totalPages = 0;
  try {
    for (const site of SITES) {
      totalPages += await crawlSite(site, { fetcher, robots, hostThrottle });
    }
  } finally {
    await fetcher.close();
  }

  CACHE.lastRun = new Date().toISOString();
  await saveCache();

  console.log(`\n🎉 Crawl finished! Total pages: ${totalPages}`);
  return totalPages;
}

if (require.main === module) {
  crawlSites().catch(console.error);
}

module.exports = { crawlSites };
