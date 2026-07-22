'use strict';

/**
 * lib/embeddings.js — client OpenAI embeddings condiviso.
 *
 * Usato sia dall'ingest (rag.js, scritture in batch) sia dalla query RAG
 * (rag.js, letture singole), cosi' entrambi i lati producono vettori nello
 * stesso modo e condividono la cache in-memory per query/chunk ripetuti
 * nella vita del processo.
 *
 * Ported from Staging/src/lib/embeddings.js senza modifiche.
 */

const DEFAULT_MODEL = 'text-embedding-3-small';
const CACHE_SIZE = 500;
const RETRIES = 5;
const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err) {
  const status = err && (err.status || err.code);
  if (status === 400 || status === 401 || status === 403) return false;
  return true;
}

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === RETRIES) throw e;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
      await sleep(delay + Math.floor(Math.random() * 0.3 * delay));
    }
  }
  throw lastErr;
}

function createEmbedder({ openai, model = DEFAULT_MODEL } = {}) {
  if (!openai) throw new Error('createEmbedder: openai client richiesto');

  // Simple LRU via Map insertion order: re-inserting a hit moves it to the
  // back, and the front (oldest) is evicted once the cache is full.
  const cache = new Map();

  function cacheKey(text) {
    return `${model}:${text}`;
  }

  function cacheGet(text) {
    const key = cacheKey(text);
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(text, vector) {
    const key = cacheKey(text);
    cache.delete(key);
    cache.set(key, vector);
    if (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function embedRaw(texts) {
    const response = await withRetry(() => openai.embeddings.create({ model, input: texts }));
    return response.data.map((d) => d.embedding);
  }

  /** Embeds a single string. Returns one vector. */
  async function embed(text) {
    const cached = cacheGet(text);
    if (cached) return cached;
    const [vector] = await embedRaw([text]);
    cacheSet(text, vector);
    return vector;
  }

  /**
   * Embeds a batch of `{ text }` items, preserving order. Cache hits are
   * resolved without a network call; misses are embedded in a single
   * request.
   */
  async function embedBatch(items) {
    const texts = items.map((item) => item.text);
    const vectors = new Array(texts.length);
    const missIndices = [];
    const missTexts = [];

    texts.forEach((text, i) => {
      const cached = cacheGet(text);
      if (cached) {
        vectors[i] = cached;
      } else {
        missIndices.push(i);
        missTexts.push(text);
      }
    });

    if (missTexts.length) {
      const fresh = await embedRaw(missTexts);
      fresh.forEach((vector, j) => {
        const i = missIndices[j];
        vectors[i] = vector;
        cacheSet(texts[i], vector);
      });
    }

    return vectors;
  }

  return { embed, embedBatch };
}

module.exports = { createEmbedder, DEFAULT_MODEL };
