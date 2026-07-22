'use strict';

/**
 * fetcher.js — Scarica l'HTML di una pagina.
 *
 * HTTP-first, fallback browser: la maggior parte dei siti istituzionali
 * (comune, clinica) è server-rendered, quindi una GET HTTP semplice ottiene
 * il contenuto reale in poche centinaia di millisecondi, senza l'overhead
 * — né la superficie di bot-detection — di aprire un Chromium per ogni URL.
 * Puppeteer viene usato solo quando la fetch semplice non ha prodotto
 * contenuto utilizzabile (shell JS-rendered) o ha fallito in modo
 * "retryable" (bloccato/rate-limited).
 *
 * Il browser Puppeteer è condiviso e lanciato pigramente (e rilanciato
 * trasparentemente se crasha/si disconnette), così il resto del crawler
 * non deve mai sapere che un browser è coinvolto.
 *
 * Ported from Staging/src/knowledge-engine/crawler/fetcher.js senza
 * modifiche di logica (solo il path del require di ./retry).
 */

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { withRetry, withTimeout } = require('./retry');

const ABORT_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
const ABORT_URL_PATTERN = /\.(pdf|zip|doc|docx|xls|xlsx|rar|7z)(\?|$)/i;
const MIN_HTTP_TEXT_CHARS = 200; // sotto questa soglia, si assume che la pagina richieda rendering JS
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function quickTextLength(html) {
  try {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().length;
  } catch {
    return 0;
  }
}

class PageFetcher {
  constructor({
    headless = true,
    navigationTimeoutMs = 25000,
    httpTimeoutMs = 12000,
    waitUntil = 'domcontentloaded',
    retries = 3
  } = {}) {
    this.headless = headless;
    this.navigationTimeoutMs = navigationTimeoutMs;
    this.httpTimeoutMs = httpTimeoutMs;
    this.waitUntil = waitUntil;
    this.retries = retries;
    this.browser = null;
    this._launching = null;
  }

  async _ensureBrowser() {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this._launching) return this._launching;
    this._launching = puppeteer
      .launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-gpu']
      })
      .then((browser) => {
        this.browser = browser;
        this._launching = null;
        browser.on('disconnected', () => {
          if (this.browser === browser) this.browser = null;
        });
        return browser;
      });
    return this._launching;
  }

  /**
   * Fetch di un URL. Non lancia mai eccezioni: i fallimenti tornano come
   * `{ ok: false, error, retryable }` cosi' il chiamante non deve avvolgere
   * ogni chiamata in un try/catch.
   */
  async fetch(url, { timeoutMs = this.navigationTimeoutMs, retries = this.retries } = {}) {
    const httpResult = await this._fetchHttp(url, { retries });
    if (httpResult.ok && quickTextLength(httpResult.html) >= MIN_HTTP_TEXT_CHARS) {
      return httpResult;
    }
    if (httpResult.ok === false && httpResult.retryable === false) {
      return httpResult; // fallimento definitivo (404, non-html, ...) -- un browser non risolverebbe
    }

    // O la fetch semplice non ha restituito abbastanza testo (probabile
    // pagina JS-rendered) o è fallita in un modo che un browser vero
    // potrebbe superare (bloccato, rate-limited, serve cookie/JS challenge).
    return this._fetchBrowser(url, { timeoutMs, retries });
  }

  async _fetchHttp(url, { retries = this.retries } = {}) {
    try {
      let lastStatus = null;
      const result = await withRetry(
        async () => {
          const t = withTimeout(this.httpTimeoutMs);
          try {
            const res = await fetch(url, {
              redirect: 'follow',
              signal: t.signal,
              headers: {
                'User-Agent': BROWSER_UA,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              }
            });
            lastStatus = res.status;
            if (res.status >= 500 || res.status === 429) {
              const e = new Error(`HTTP ${res.status}`);
              e.retryable = true;
              throw e;
            }
            if (res.status >= 400) {
              const e = new Error(`HTTP ${res.status}`);
              e.retryable = false;
              throw e;
            }
            const contentType = res.headers.get('content-type') || '';
            if (contentType && !/text\/html|application\/xhtml/.test(contentType)) {
              const e = new Error(`non-html content-type: ${contentType}`);
              e.retryable = false;
              throw e;
            }
            return { html: await res.text(), finalUrl: res.url || url };
          } finally {
            t.clear();
          }
        },
        { retries, baseDelayMs: 800, isRetryable: (e) => e.retryable !== false }
      );
      return { ok: true, html: result.html, finalUrl: result.finalUrl };
    } catch (e) {
      return { ok: false, error: e.message, retryable: e.retryable !== false };
    }
  }

  async _fetchBrowser(url, { timeoutMs = this.navigationTimeoutMs, retries = this.retries } = {}) {
    const browser = await this._ensureBrowser();
    const page = await browser.newPage();
    try {
      await page.setUserAgent(BROWSER_UA);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        const rurl = req.url().toLowerCase();
        if (ABORT_RESOURCE_TYPES.has(type) || ABORT_URL_PATTERN.test(rurl) || rurl.startsWith('mailto:')) {
          return req.abort();
        }
        req.continue();
      });

      try {
        await withRetry(
          async () => {
            const response = await page.goto(url, { waitUntil: this.waitUntil, timeout: timeoutMs });
            if (response) {
              const status = response.status();
              if (status >= 500 || status === 429) {
                const e = new Error(`HTTP ${status}`);
                e.retryable = true;
                throw e;
              }
              if (status >= 400) {
                const e = new Error(`HTTP ${status}`);
                e.retryable = false;
                throw e;
              }
            }
          },
          { retries, baseDelayMs: 1000, isRetryable: (e) => e.retryable !== false }
        );
      } catch (e) {
        return { ok: false, error: e.message, retryable: e.retryable !== false };
      }

      const finalUrl = page.url();
      const contentType = await page.evaluate(() => document.contentType || '').catch(() => '');
      if (contentType && !/text\/html|application\/xhtml/.test(contentType)) {
        return { ok: false, error: `non-html content-type: ${contentType}`, retryable: false };
      }

      const html = await page.content();
      return { ok: true, html, finalUrl };
    } catch (e) {
      return { ok: false, error: e.message, retryable: true };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }
}

module.exports = { PageFetcher };
