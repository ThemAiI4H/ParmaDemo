require('dotenv').config();
const OpenAI = require('openai');
const lancedb = require('@lancedb/lancedb');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RAW_DIR = path.join(__dirname, 'data/raw');
const DB_PATH = path.join(__dirname, 'data/lancedb');

let db = null;
let table = null;

async function initDB() {
  if (db) return;
  db = await lancedb.connect(DB_PATH);
  
  const tables = await db.tableNames();
  if (!tables.includes('documents')) {
    // Dummy record per inizializzare correttamente lo schema LanceDB
    const dummy = [{
      vector: Array(1536).fill(0),
      text: 'init',
      title: 'init',
      url: 'init',
      site: 'init',
      hash: 'init',
      createdAt: Date.now()
    }];
    table = await db.createTable('documents', dummy);
  } else {
    table = await db.openTable('documents');
  }
}

function semanticChunk(text, maxChunkSize = 800, overlap = 120) {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    
    if (currentLength + trimmed.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      
      const overlapSentences = currentChunk.slice(-Math.ceil(overlap / 100));
      currentChunk = overlapSentences;
      currentLength = overlapSentences.reduce((sum, s) => sum + s.length, 0);
    }
    
    currentChunk.push(trimmed);
    currentLength += trimmed.length;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks.filter(c => c.length > 150 && c.length < 2000);
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

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.text),
      dimensions: 1536
    });

    const vectors = batch.map((chunk, idx) => ({
      vector: response.data[idx].embedding,
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
    .map(s => s.item);
}

const { tokenize, relevanceScore } = require('./utils');

async function queryRAG(query, k = 15) {
  await initDB();

  // Query expansion for booking terms
  const expansions = {
    'prenotare': ['prenotazione', 'appuntamento', 'visita', 'segreteria', 'telefono'],
    'visita': ['prenotazione', 'appuntamento', 'ambulatoriale'],
  };
  const expandedQuery = expansions[query.toLowerCase()] 
    ? query + ' ' + expansions[query.toLowerCase()].join(' ')
    : query;

  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: expandedQuery,
    dimensions: 1536
  });

  // 1. SEMANTIC SEARCH (top 50)
  const vectorResults = await table
    .query()
    .nearestTo(embedding.data[0].embedding)
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

  // 3. RRF Fusion
  const fused = [...vectorResults, ...keywordResults]
    .reduce((acc, doc) => {
      const key = doc.hash;
      acc[key] = acc[key] || { item: doc, rrf: 0 };
      const rank = acc[key].rrf;
      acc[key].rrf += 1 / (60 + rank);
      return acc;
    }, {});

  const reranked = Object.values(fused)
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, k)
    .map(r => r.item)
    .filter(doc => doc.hash !== 'init'); // Remove dummy

  const context = reranked.map((r, i) => 
    `📄 [${r.title}](${r.url})\n${r.text}\n`
  ).join('\n───\n');

  return context;
}

async function getStats() {
  await initDB();
  const count = await table.countRows();
  return { totalChunks: count };
}

module.exports = { ingestData, queryRAG, getStats, initDB };
