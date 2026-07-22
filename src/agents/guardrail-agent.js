'use strict';

/**
 * guardrail-agent.js — Controlli di sicurezza su input/output.
 *
 * checkInput: euristica regex conservativa contro tentativi espliciti di
 * prompt-injection/jailbreak. Bias verso NON bloccare, per evitare falsi
 * positivi su richieste legittime che possono contenere parole come
 * "ignora" in contesti benigni.
 *
 * checkOutput: rimuove link markdown con schema non-http(s) (es.
 * `[file.pdf](sandbox:/file.pdf)`) che il modello a volte inventa per gli
 * allegati generati — va usata SOLO quando la risposta viene già
 * bufferizzata per altri motivi (dopo generate_document), perché
 * generalizzarla a ogni turno richiederebbe bufferizzare tutte le risposte
 * prima di mostrarle, eliminando lo streaming token-per-token.
 *
 * Ported from Staging/src/agents/guardrail-agent.js senza modifiche.
 */

const INJECTION_PATTERNS = [
  /ignora\s+(tutte\s+le\s+)?istruzioni\s+(precedenti|di\s+sistema)/i,
  /disattiva\s+(le\s+)?(tue\s+)?(regole|restrizioni|limitazioni)/i,
  /(rivelami|mostrami|stampa)\s+.{0,20}(system\s?prompt|prompt\s+di\s+sistema|istruzioni\s+di\s+sistema)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|jailbreak|developer\s+mode)/i,
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions)/i
];

function createGuardrailAgent({ openai, llmFallback = false } = {}) {
  function checkInput(text) {
    if (!text) return { blocked: false };
    const hit = INJECTION_PATTERNS.some(re => re.test(text));
    if (!hit) return { blocked: false };
    return {
      blocked: true,
      refusalText: 'Non posso soddisfare questa richiesta. Sono qui per aiutarti con le informazioni disponibili su questo servizio: come posso esserti utile?'
    };
  }

  function checkOutput(text, { hasAttachment = false } = {}) {
    if (!text || !hasAttachment) return text;
    return text.replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]*\)/g, '$1');
  }

  return { checkInput, checkOutput };
}

module.exports = { createGuardrailAgent };
