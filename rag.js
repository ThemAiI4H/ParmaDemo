require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const tiktoken = require('tiktoken');
const { getTable } = require('./src/lib/lancedb');
const { createEmbedder } = require('./src/lib/embeddings');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embedder = createEmbedder({ openai });
const RAW_DIR = path.join(__dirname, 'data/raw');

let table = null;

async function initDB() {
  if (table) return;
  table = await getTable();
}

// Token-aware chunking (technique ported from the Staging project's knowledge-engine):
// group paragraphs into ~1000-token windows, hard-splitting any paragraph that alone
// exceeds the budget (with a 150-token overlap between hard-split pieces).
const CHUNK_TOKENS = 1000;
const CHUNK_OVERLAP_TOKENS = 150;
const MIN_CHUNK_CHARS = 150;
const MAX_CHUNK_CHARS = 6000;

let _enc = null;
function encoder() {
  if (!_enc) _enc = tiktoken.encoding_for_model('text-embedding-3-small');
  return _enc;
}

function tokenLength(text) {
  return encoder().encode(text).length;
}

function decodeTokens(tokens) {
  const decoded = encoder().decode(tokens);
  return (decoded instanceof Uint8Array ? Buffer.from(decoded).toString('utf8') : decoded).trim();
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}

function splitLargeParagraph(paragraph) {
  const tokens = encoder().encode(paragraph);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const decoded = decodeTokens(tokens.slice(i, i + CHUNK_TOKENS));
    if (decoded.length >= MIN_CHUNK_CHARS) out.push(decoded);
    i += CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS;
  }
  return out;
}

function semanticChunk(text) {
  const paragraphs = splitParagraphs(text);
  const chunks = [];
  let current = '';

  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (tokenLength(candidate) <= CHUNK_TOKENS) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (tokenLength(p) > CHUNK_TOKENS) {
      chunks.push(...splitLargeParagraph(p));
      current = '';
    } else {
      current = p;
    }
  }
  if (current) chunks.push(current);

  return chunks.filter(c => c.length >= MIN_CHUNK_CHARS && c.length <= MAX_CHUNK_CHARS);
}

async function loadRawDocs() {
  const chunks = [];
  const files = await fs.readdir(RAW_DIR);
  
  console.log(`📄 Processing ${files.length} raw files...`);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    try {
      const data = await fs.readFile(path.join(RAW_DIR, file), 'utf8');
      const doc = JSON.parse(data);
      
      const docChunks = semanticChunk(doc.content);
      
      docChunks.forEach(text => {
        chunks.push({
          text,
          title: doc.title,
          url: doc.url,
          site: doc.site,
          hash: crypto.createHash('sha256').update(text).digest('hex')
        });
      });

      console.log(`   ${doc.title.slice(0,50)} → ${docChunks.length} chunks`);
    } catch (e) {
      console.log(`⚠ Error loading ${file}: ${e.message}`);
    }
  }

  return chunks;
}

async function ingestData() {
  await initDB();
  
  const rawChunks = await loadRawDocs();
  console.log(`\n🔢 Generated ${rawChunks.length} total chunks`);

  const existingHashes = new Set();
  const records = await table.query().select(['hash']).limit(100000).toArray();
  records.forEach(r => existingHashes.add(r.hash));

  const newChunks = rawChunks.filter(c => !existingHashes.has(c.hash));
  console.log(`🆕 ${newChunks.length} new chunks to embed`);

  if (newChunks.length === 0) {
    console.log('✅ All documents already indexed');
    return 0;
  }

  const BATCH_SIZE = 512;
  let inserted = 0;

  for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
    const batch = newChunks.slice(i, i + BATCH_SIZE);
    console.log(`\n⚡ Embedding batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(newChunks.length/BATCH_SIZE)} (${batch.length} items)`);

    const embeddings = await embedder.embedBatch(batch);

    const vectors = batch.map((chunk, idx) => ({
      vector: embeddings[idx],
      text: chunk.text,
      title: chunk.title,
      url: chunk.url,
      site: chunk.site,
      hash: chunk.hash,
      createdAt: Date.now()
    }));

    await table.add(vectors);
    inserted += batch.length;
    console.log(`   ✅ Added ${batch.length} vectors`);
  }

  console.log(`\n🎉 Ingest completed! Total inserted: ${inserted}`);
  return inserted;
}

function reciprocalRankFusion(resultsList, k = 60) {
  const scores = new Map();
  
  resultsList.forEach(list => {
    list.forEach((item, rank) => {
      const key = item.hash;
      const current = scores.get(key) || { item, score: 0 };
      current.score += 1 / (k + rank + 1);
      scores.set(key, current);
    });
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...s.item, rrfScore: s.score }));
}

const { tokenize, relevanceScore } = require('./utils');


function sanitizeRagText(text) {
  if (typeof text !== 'string') return '';
  let t = text;

  // Neutralize common prompt-injection / instruction patterns.
  // Goal: reduce the chance the model treats crawled text as higher-priority instructions.
  const denyPatterns = [
    /\bignore\s+(all\s+)?(previous|above)\s+(instructions|prompts)\b/gi,
    /\bdo\s+not\s+follow\b/gi,
    /\bdisregard\b/gi,
    /\b(you are|you\s+are)\s+(an|a)\b/gi,
    /\b(system|developer|user)\s*:\s*/gi,
    /\b(act as|roleplay|developer mode)\b/gi,
    /\btool\s+call\b/gi,
    /\b(assistant|model)\s+instructions\b/gi,
    /```[\s\S]*?```/g,
    /<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi
  ];

  for (const r of denyPatterns) {
    t = t.replace(r, '');
  }

  // Remove jailbreak-like meta markers.
  t = t
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000/g, '')
    .trim();

  return t;
}

/**
 * Retrieval completo: ritorna sia il testo di contesto formattato sia i
 * metadati per-documento (titolo/url/score) necessari a costruire citazioni
 * lato agente (src/agents/rag-agent.js). queryRAG() sotto resta un wrapper
 * di comodo che restituisce solo la stringa, per compatibilità con il
 * codice esistente.
 */
async function retrieve(query, k = 15) {
  await initDB();

  // Query expansion for booking terms (matches when the term appears anywhere in the query)
  const expansions = {
    'prenotare': ['prenotazione', 'appuntamento', 'visita', 'segreteria', 'telefono'],
    'visita': ['prenotazione', 'appuntamento', 'ambulatoriale'],
  };
  const lowerQuery = query.toLowerCase();
  const matchedTerms = Object.keys(expansions).filter(term =>
    new RegExp(`\\b${term}\\b`, 'i').test(lowerQuery)
  );
  const expandedQuery = matchedTerms.length
    ? query + ' ' + [...new Set(matchedTerms.flatMap(t => expansions[t]))].join(' ')
    : query;

  const queryVector = await embedder.embed(expandedQuery);

  // 1. SEMANTIC SEARCH (top 50)
  const vectorResults = await table
    .query()
    .nearestTo(queryVector)
    .limit(50)
    .toArray();

  // 2. KEYWORD BM25-like (top 20)
  const allDocs = await table.query().limit(2000).toArray();
  const keywordResults = allDocs
    .map(doc => ({
      ...doc,
      score: relevanceScore(query, doc.text),
      type: 'keyword'
    }))
    .filter(r => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // 3. RRF Fusion (rank-based, see reciprocalRankFusion above)
  const reranked = reciprocalRankFusion([vectorResults, keywordResults], 60)
    .slice(0, k)
    .filter(doc => doc.hash !== 'init'); // Remove dummy

  if (reranked.length === 0) {
    return { context: '', empty: true, meta: [] };
  }

  const meta = reranked.map(r => ({
    title: r.title,
    url: r.url,
    score: typeof r.rrfScore === 'number' ? r.rrfScore : 0
  }));

  const context = reranked.map((r) => {
    const safeText = sanitizeRagText(r.text);
    return `📄 [${r.title}](${r.url})\n${safeText}\n`;
  }).join('\n───\n');

  return { context, empty: false, meta };
}

async function queryRAG(query, k = 15) {
  const { context } = await retrieve(query, k);
  return context;
}

module.exports = { ingestData, queryRAG, retrieve, initDB, sanitizeRagText, semanticChunk, reciprocalRankFusion, tokenLength };

