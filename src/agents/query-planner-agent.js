'use strict';

/**
 * query-planner-agent.js — Riscrive la query di retrieval quando serve.
 *
 * Rewrite via gpt-4o-mini solo per query lunghe/complesse, isolato in un
 * agente indipendente così il RAG agent non dipende dai dettagli di
 * quando/come si riscrive una query.
 *
 * Ported from Staging/src/agents/query-planner-agent.js senza modifiche.
 */

const REWRITE_MODEL = 'gpt-4o-mini';

function createQueryPlannerAgent({ openai } = {}) {
  if (!openai) throw new Error('createQueryPlannerAgent: openai client richiesto');

  function shouldRewrite(query) {
    const q = query.trim();
    if (q.length < 80) return false;
    if (q.split(/\s+/).length <= 6) return false;
    return true;
  }

  async function plan(query) {
    if (!shouldRewrite(query)) return query;
    try {
      const res = await openai.chat.completions.create({
        model: REWRITE_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Riscrivi la query per ricerca documentale. Mantieni solo parole chiave. Non aggiungere informazioni.' },
          { role: 'user', content: query }
        ]
      });
      return res.choices[0].message.content.trim();
    } catch {
      return query;
    }
  }

  return { plan, shouldRewrite };
}

module.exports = { createQueryPlannerAgent, REWRITE_MODEL };
