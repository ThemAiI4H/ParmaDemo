const puppeteer = require('puppeteer');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const PQueue = require('p-queue').default;

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
  CONCURRENCY: 2,
  DATA_DIR: path.join(__dirname, 'data/raw'),
  CACHE_FILE: path.join(__dirname, 'data/crawl-cache.json'),
  REQUEST_DELAY_MS: 500,
  RAW_HTML_MAX_CHARS: 150000,
  CONTENT_MIN_LENGTH: 200,
  QUALITY_SCORE_THRESHOLD: 20
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
];

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

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function scrollToBottom(page) {
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    // Ignore scroll errors
  }
}

function tableToMarkdown($, tableEl) {
  const rows = [];
  $(tableEl).find('tr').each((_, tr) => {
    const cells = [];
    $(tr).find('th, td').each((_, cell) => {
      let text = $(cell).text().trim().replace(/\|/g, '\\|').replace(/\n/g, ' ');
      cells.push(text);
    });
    if (cells.length > 0) rows.push(cells);
  });
  if (rows.length === 0) return '';
  let md = '\n';
  rows.forEach((row, idx) => {
    md += '| ' + row.join(' | ') + ' |\n';
    if (idx === 0) {
      md += '|' + row.map(() => ' --- ').join('|') + '|\n';
    }
  });
  return md + '\n';
}

function extractStructuredMarkdown($) {
  const parts = [];
  
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const level = parseInt(el.tagName[1]);
    const text = $(el).text().trim();
    if (text) parts.push({ type: 'heading', level, text });
  });

  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text) parts.push({ type: 'paragraph', text });
  });

  $('ul, ol').each((_, el) => {
    const items = [];
    $(el).find('li').each((_, li) => {
      const text = $(li).text().trim();
      if (text) items.push(text);
    });
    if (items.length > 0) parts.push({ type: 'list', ordered: el.tagName === 'OL', items });
  });

  $('table').each((_, el) => {
    const md = tableToMarkdown($, el);
    if (md) parts.push({ type: 'table', markdown: md });
  });

  $('dl').each((_, el) => {
    const items = [];
    $(el).find('dt').each((_, dt) => {
      const term = $(dt).text().trim();
      const dd = $(dt).nextUntil('dt', 'dd').map((_, d) => $(d).text().trim()).get().join(' ');
      if (term) items.push({ term, definition: dd });
    });
    if (items.length > 0) parts.push({ type: 'deflist', items });
  });

  let markdown = '';
  parts.forEach(part => {
    switch (part.type) {
      case 'heading':
        markdown += '\n' + '#'.repeat(part.level) + ' ' + part.text + '\n\n';
        break;
      case 'paragraph':
        markdown += part.text + '\n\n';
        break;
      case 'list':
        part.items.forEach((item, i) => {
          const prefix = part.ordered ? `${i + 1}. ` : '- ';
          markdown += prefix + item + '\n';
        });
        markdown += '\n';
        break;
      case 'table':
        markdown += part.markdown;
        break;
      case 'deflist':
        part.items.forEach(item => {
          markdown += `**${item.term}**: ${item.definition}\n\n`;
        });
        break;
    }
  });

  return markdown.trim();
}

function calculateQualityScore(markdown) {
  let score = 0;
  const length = markdown.length;
  if (length > 200) score += 30;
  if (length > 1000) score += 20;
  if (length > 5000) score += 10;
  
  const headings = (markdown.match(/^#{1,6}\s/mg) || []).length;
  score += Math.min(headings * 5, 20);
  
  const tables = (markdown.match(/\| --- \|/g) || []).length;
  score += Math.min(tables * 5, 10);
  
  const lists = (markdown.match(/^\s*[-*\d]\s/mg) || []).length;
  score += Math.min(lists * 2, 10);
  
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

async function crawlSite(baseUrl) {
  console.log(`\n▶ Crawling: ${baseUrl}`);
  
  const pages = new Map();
  const toCrawl = [{ url: baseUrl, depth: 0 }];
  const processed = new Set();
  
  const CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ];

  let browser = await puppeteer.launch({ 
    headless: true,
    args: CHROME_ARGS
  });

  const queue = new PQueue({ concurrency: CONFIG.CONCURRENCY });
  const pageMutex = new PQueue({ concurrency: 1 });
  
  const onBrowserDisconnect = async () => {
    console.log('⚠ Browser disconnected, restarting...');
    try {
      browser = await puppeteer.launch({ 
        headless: true,
        args: CHROME_ARGS
      });
      browser.on('disconnected', onBrowserDisconnect);
      console.log('✅ Browser restarted successfully');
    } catch (e) {
      console.log('⚠ Failed to restart browser:', e.message);
    }
  };
  
  browser.on('disconnected', onBrowserDisconnect);

  const processPage = async ({ url, depth, _retryCount = 0 }) => {
    if (processed.has(url) || depth > CONFIG.MAX_DEPTH || pages.size >= CONFIG.MAX_PAGES_PER_SITE) return;
    processed.add(url);

    // Polite crawling delay
    await new Promise(r => setTimeout(r, CONFIG.REQUEST_DELAY_MS));

    let page;
    try {
      page = await pageMutex.add(async () => {
        await new Promise(r => setTimeout(r, 150));
        return browser.newPage();
      });
      
      await page.setUserAgent(getRandomUserAgent());
      await page.setBypassCSP(true);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
      await scrollToBottom(page);
      
      const html = await page.content();
      
      const contentHash = hashContent(html);
      const isCached = !FORCE_CRAWL && CACHE.pages[url] === contentHash;
      if (isCached) {
        console.log(`⏭ Cached: ${url}`);
      }

      const $ = cheerio.load(html);

      // Extract links BEFORE cleaning
      if (depth < CONFIG.MAX_DEPTH) {
        $('a[href]').each((_, el) => {
          let href = $(el).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
          
          try {
            const parsed = new URL(href, baseUrl);
            const absolute = parsed.href;
            
            if (absolute.startsWith(baseUrl) && !processed.has(absolute) && 
                !absolute.includes('login') && !absolute.includes('logout') &&
                !absolute.includes('download') && !absolute.match(/\.(pdf|zip|doc|xls|ppt|mp3|mp4|jpg|png|gif)$/i)) {
              toCrawl.push({ url: absolute, depth: depth + 1 });
            }
          } catch {}
        });
      }

      // Less aggressive cleaning: only remove script, style, noscript, iframe, .ads
      $('script, style, noscript, iframe, .ads, [class*="ad-"], [id*="ad-"]').remove();

      const rawHtml = $.html().slice(0, CONFIG.RAW_HTML_MAX_CHARS);
      
      // Try structured extraction first
      let structuredContent = extractStructuredMarkdown($);
      let qualityScore = calculateQualityScore(structuredContent);
      let content = structuredContent;
      let extractionMethod = 'structured';

      // Fallback to Readability if structured extraction is poor
      if (structuredContent.length < CONFIG.CONTENT_MIN_LENGTH || qualityScore < CONFIG.QUALITY_SCORE_THRESHOLD) {
        const cleanHtml = $.html();
        const dom = new JSDOM(cleanHtml, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        
        if (article && article.textContent.length >= CONFIG.CONTENT_MIN_LENGTH) {
          content = article.textContent
            .replace(/\s+/g, ' ')
            .replace(/consulta(?:re)? il sito(?: ufficiale)?/gi, '')
            .replace(/contatta(?:re)? l'ufficio/gi, '')
            .replace(/per ulteriori informazioni/gi, '')
            .replace(/ti consigliamo/gi, '')
            .replace(/puoi trovare/gi, '')
            .replace(/visitare il sito/gi, '')
            .trim();
          
          extractionMethod = 'readability';
          qualityScore = calculateQualityScore(content);
        }
      }

      // Remove common boilerplate phrases
      const commonBlocks = [
        /vai al contenuto/gi,
        /torna su/gi,
        /menu principale/gi,
        /accedi all'area riservata/gi,
        /cookie policy/gi,
        /privacy policy/gi
      ];
      
      commonBlocks.forEach(regex => {
        content = content.replace(regex, '');
      });

      content = content.trim().slice(0, 150000);

      if (content.length >= CONFIG.CONTENT_MIN_LENGTH) {
        const doc = {
          title: $('title').text().trim() || 'Untitled',
          url,
          content,
          rawHtml,
          excerpt: content.slice(0, 300).replace(/\n/g, ' '),
          site: baseUrl,
          crawledAt: new Date().toISOString(),
          hash: contentHash,
          qualityScore,
          extractionMethod
        };

        const fileName = hashContent(url).slice(0, 12) + '.json';
        await fs.writeFile(path.join(CONFIG.DATA_DIR, fileName), JSON.stringify(doc, null, 2));
        
        pages.set(url, doc);
        CACHE.pages[url] = contentHash;
        console.log(`✅ Saved: ${doc.title.slice(0,60)} (${content.length} chars, score: ${qualityScore}, method: ${extractionMethod})`);
      } else {
        console.log(`⏭ Too short (${content.length} chars): ${url}`);
      }

    } catch (e) {
      console.log(`⚠ Error ${url}: ${e.message.substring(0,80)}`);
      
      const retryCount = _retryCount + 1;
      if (retryCount <= 2 && (e.message.includes('Session with given id not found') || e.message.includes('ProtocolError') || e.message.includes('Navigation timeout'))) {
        console.log(`↻ Retrying ${url} (${retryCount}/2)`);
        processed.delete(url);
        toCrawl.unshift({ url, depth, _retryCount: retryCount });
      }
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignora errori in chiusura pagina
        }
      }
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
  
  await browser.close();
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

  let totalPages = 0;
  for (const site of SITES) {
    totalPages += await crawlSite(site);
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

