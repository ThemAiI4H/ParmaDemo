'use strict';

/**
 * rag-agent.js — Retrieval sulla knowledge base indicizzata (ParmaDemo).
 *
 * Adattato da Staging/src/agents/rag-agent.js: ParmaDemo è single-tenant
 * (un'unica fonte RAG sempre pronta, niente demo/knowledgeBaseId), quindi
 * qui non c'è il gating "KB ancora in indicizzazione" né un pipeline
 * multi-tenant — il retrieval delega direttamente a rag.js#retrieve()
 * (RRF corretta, chunking token-aware, LanceDB), già testato.
 *
 * Rimane invariata la logica di dedup citazioni per URL (score più alto
 * vince), il cap MAX_CITATIONS, il calcolo confidence e la formattazione
 * del blocco di contesto passato al modello.
 */

const { createQueryPlannerAgent } = require('./query-planner-agent');
const { retrieve } = require('../../rag');

// Cap sulle citazioni mostrate/citate, non sul contesto passato al modello:
// result.meta è già ordinato per score decrescente (rag.js#reciprocalRankFusion),
// quindi le prime N dopo il dedup per URL sono già le più rilevanti.
const MAX_CITATIONS = 3;

function createRagAgent({ openai } = {}) {
  const queryPlanner = createQueryPlannerAgent({ openai });

  async function search(query, languageHintLabel) {
    // Nota per il modello (non testo da mostrare all'utente verbatim).
    const languageNote = languageHintLabel
      ? `Tell the user, in ${languageHintLabel}`
      : 'Tell the user, in the same language they used in their message,';

    try {
      const plannedQuery = await queryPlanner.plan(query);
      const result = await retrieve(plannedQuery, 10);

      if (!result.empty && result.context) {
        const citations = Array.from(
          (result.meta || [])
            .filter(m => m && m.url)
            .map(m => ({ title: m.title || m.url, url: m.url, score: typeof m.score === 'number' ? m.score : 0 }))
            .reduce((byUrl, c) => {
              const existing = byUrl.get(c.url);
              if (!existing || c.score > existing.score) byUrl.set(c.url, c);
              return byUrl;
            }, new Map())
            .values()
        )
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_CITATIONS);

        const confidence = citations.length ? Math.max(...citations.map(c => c.score)) : 0;
        const fonti = citations.map(c => `- ${c.title} (${c.url})`).join('\n');

        return {
          text: `CONTESTO ESTRATTO DALL'INDICE DEL SITO:\n\n${result.context}\n\nFONTI:\n${fonti}`,
          citations,
          confidence,
          empty: false,
          context: result.context
        };
      }
    } catch (err) {
      console.error('rag retrieve error:', err.message);
    }

    return {
      // Nota per il modello (non testo da mostrare all'utente verbatim).
      text: `[SYSTEM NOTE — not user-facing text: no relevant results were found in the indexed knowledge base for this query. ${languageNote} that you could not find information relevant to their request. Do not invent an answer.]`,
      citations: [],
      confidence: 0,
      empty: true
    };
  }

  return { search };
}

module.exports = { createRagAgent };
