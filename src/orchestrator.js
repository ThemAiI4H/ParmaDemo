'use strict';

/**
 * orchestrator.js — Coordina i micro-agent per un turno di chat.
 *
 * Adattato da Staging/src/orchestrator.js: ParmaDemo è single-tenant (un
 * unico system prompt, un'unica fonte RAG sempre pronta), quindi niente
 * demoId/product/database-agent/router-agent, e niente prefetch di
 * ricerca live (nessun deep-search-engine.js — l'unica fonte è
 * search_configured_sites → rag-agent → rag.js).
 *
 * Contratto SSE verso il frontend (index.html / comune_parma.html):
 *   - richiesta: {message, sessionId, attachment}
 *   - risposta SSE: eventi {type:'chunk', text}, {type:'done', ...},
 *     {type:'error', error}
 *   - shape dell'evento `done`: {response, sessionId, citations,
 *     confidence, lowConfidence, attachment}
 *
 * Il testo mostrato nel widget viene costruito SOLO accumulando gli eventi
 * `chunk` — ogni path che produce testo (incluso un rifiuto del guardrail)
 * deve quindi emetterlo via evento/i `chunk` prima del `done`.
 */

const { buildSystemPrompt } = require('./config/prompts');
const { resolveUploadPath } = require('./lib/uploads');
const { extractDocumentText, imageToDataUrl } = require('./lib/attachments');
const { filterHistoryForAPI } = require('./lib/chat');
const { detectLanguage } = require('./lib/tts');
const { getTools } = require('./lib/tools');

const { createMemoryAgent } = require('./agents/memory-agent');
const { createRagAgent } = require('./agents/rag-agent');
const { createGuardrailAgent } = require('./agents/guardrail-agent');
const { createToolExecutorAgent } = require('./agents/tool-executor-agent');
const { createCopywriterAgent } = require('./agents/copywriter-agent');
const { createQaAgent } = require('./agents/qa-agent');

// Rinforzo deterministico (euristico, no LLM) all'istruzione di lingua nel
// system prompt: gpt-4o-mini non segue sempre in modo affidabile "rispondi
// nella lingua dell'utente" quando il resto del prompt è interamente in
// italiano. Un hint esplicito, posizionato subito prima del messaggio
// dell'utente, è molto più efficace.
const LANGUAGE_HINT_LABELS = { en: 'inglese', de: 'tedesco', fr: 'francese', ar: 'arabo' };

// Istanza condivisa fra tutte le richieste, stesso ciclo di vita della Map
// globale già usata da liveavatarSessions in server.js.
const memory = createMemoryAgent();

/**
 * Costruisce il contenuto multimodale/testuale da inviare al modello per
 * questo turno, arricchito con l'eventuale allegato (immagine → vision,
 * documento → testo estratto). La history mantiene invece solo il
 * messaggio testuale originale.
 */
async function buildApiUserContent(messageText, attachment) {
  if (attachment && attachment.kind === 'image') {
    try {
      const dataUrl = imageToDataUrl(resolveUploadPath(attachment.url), attachment.mimeType);
      return [
        { type: 'text', text: messageText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    } catch (err) {
      console.error('imageToDataUrl error:', err.message);
      return messageText;
    }
  }
  if (attachment && attachment.kind === 'document') {
    const docText = await extractDocumentText(resolveUploadPath(attachment.url), attachment.mimeType);
    return `${messageText}\n\n[Contenuto del documento allegato "${attachment.name}"]:\n${docText || '(non è stato possibile estrarre il testo da questo documento)'}`;
  }
  return messageText;
}

/**
 * Costruisce la risposta arricchita con citations + confidence, con
 * eventuale correzione advisory del QA agent (solo confidence/lowConfidence,
 * mai il testo o le citations).
 */
function buildChatResponse(responseText, sid, retrieval = {}, attachment = null, qaResult = null) {
  const citations = Array.isArray(retrieval.citations) ? retrieval.citations : [];
  let confidence, lowConfidence;

  if (qaResult && typeof qaResult.confidence === 'number') {
    // Giudizio esplicito 0-1 del QA agent (LLM): la soglia assoluta ha senso.
    confidence = qaResult.confidence;
    lowConfidence = citations.length === 0 || confidence < 0.3;
  } else {
    // Senza QA (timeout/non grounded) resta solo il punteggio RRF grezzo di
    // rag-agent.js, che NON è su scala 0-1 comparabile a una soglia assoluta
    // (somme di 1/(k+rank+1), tipicamente 0.02-0.07 anche per il risultato
    // migliore): confrontarlo con 0.3 marcherebbe quasi ogni risposta come
    // "low confidence" a prescindere dalla qualità reale. L'unico segnale
    // affidabile qui è l'assenza di citazioni.
    confidence = typeof retrieval.confidence === 'number' ? retrieval.confidence : 0;
    lowConfidence = citations.length === 0;
  }

  return { response: responseText, sessionId: sid, citations, confidence, lowConfidence, attachment: attachment || null };
}

async function orchestrateChat(req, res, openai) {
  const { message, sessionId, attachment } = req.body;

  if (!message && !attachment) {
    return res.status(400).json({ success: false, error: 'Message or attachment is required' });
  }

  const messageText = message && message.trim()
    ? message
    : (attachment && attachment.kind === 'image'
        ? 'Descrivi questa immagine e rispondi a eventuali domande su di essa.'
        : 'Analizza il contenuto di questo documento allegato.');

  const sid = sessionId || `session_${Date.now()}`;

  const guardrail = createGuardrailAgent({ openai });
  const ragAgent = createRagAgent({ openai });
  const toolExecutor = createToolExecutorAgent({ openai, ragAgent });
  const copywriter = createCopywriterAgent({ openai });
  const qa = createQaAgent({ openai });

  // ── Fase 1: attività indipendenti in parallelo ──────────────────
  const [guardrailResult, sessionHistory, apiUserContent] = await Promise.all([
    Promise.resolve(guardrail.checkInput(messageText)),
    Promise.resolve(memory.getHistory(sid)),
    buildApiUserContent(messageText, attachment)
  ]);

  let systemPrompt = buildSystemPrompt();

  if (attachment && attachment.kind === 'document') {
    systemPrompt += '\n\nNOTA SU ALLEGATI: l\'utente ha allegato un documento; il suo testo è stato estratto automaticamente e incluso nel messaggio utente tra parentesi quadre. Hai pieno accesso a questo contenuto: usalo direttamente per rispondere, senza mai affermare di non poter leggere allegati.';
  } else if (attachment && attachment.kind === 'image') {
    systemPrompt += '\n\nNOTA SU ALLEGATI: l\'utente ha allegato un\'immagine fornita direttamente nel messaggio in formato visivo. Hai pieno accesso a questa immagine: descrivila e rispondi alle domande su di essa senza mai affermare di non poter vedere immagini.';
  }

  const detectedLang = detectLanguage(messageText);
  const languageHintLabel = LANGUAGE_HINT_LABELS[detectedLang];

  const messagesForAPI = [
    { role: 'system', content: systemPrompt },
    ...filterHistoryForAPI(sessionHistory.slice(-9)),
    ...(languageHintLabel
      ? [{ role: 'system', content: `Promemoria: il messaggio dell'utente qui sotto sembra scritto in ${languageHintLabel}. Rispondi in ${languageHintLabel}.` }]
      : []),
    { role: 'user', content: apiUserContent }
  ];

  memory.append(sid, { role: 'user', content: messageText });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // ── Guardrail: blocco input ───────────────────────────────────────
  // Il rifiuto va inviato come evento `chunk` (non solo dentro done.response):
  // il widget costruisce il testo mostrato SOLO accumulando i `chunk`.
  if (guardrailResult.blocked) {
    sendEvent({ type: 'chunk', text: guardrailResult.refusalText });
    memory.append(sid, { role: 'assistant', content: guardrailResult.refusalText });
    sendEvent({ type: 'done', ...buildChatResponse(guardrailResult.refusalText, sid, {}, null) });
    return res.end();
  }

  const availableTools = getTools();

  // Numero massimo di round di tool-calling in sequenza in un singolo turno
  // (es. search_configured_sites per trovare un indirizzo, poi show_map per
  // mostrarlo: due tool distinti in cascata, non un singolo tool-call
  // isolato). Un tetto evita loop infiniti se il modello continuasse a
  // richiedere altri tool indefinitamente.
  const MAX_TOOL_ROUNDS = 3;

  try {
    let messagesSoFar = messagesForAPI;
    let retrieval = {};
    let generatedAttachment = null;
    let toolRound = 0;

    let current = await copywriter.streamTurn({
      messages: messagesSoFar,
      tools: availableTools,
      onChunk: (text) => sendEvent({ type: 'chunk', text })
    });

    while (current.finishReason === 'tool_calls' && current.toolCalls.length && toolRound < MAX_TOOL_ROUNDS) {
      toolRound++;
      const assistantMessage = { role: 'assistant', content: current.text || null, tool_calls: current.toolCalls };
      const result = await toolExecutor.execute(current.toolCalls, { languageHintLabel });

      if (result.retrieval && Object.keys(result.retrieval).length) retrieval = result.retrieval;
      if (result.attachment) generatedAttachment = result.attachment;

      messagesSoFar = [...messagesSoFar, assistantMessage, ...result.toolResults];

      // Una volta generato un allegato (documento o mappa) in un turno, il
      // testo della sintesi finale va sanificato (rimuovendo eventuali link
      // "sandbox:"/indirizzi fittizi) prima di essere mostrato: non si può
      // farlo chunk-per-chunk perché andrebbe a modificare testo già
      // inviato, quindi da qui in poi si bufferizza invece di stremare
      // token-per-token — anche nei round intermedi (se il modello chiama
      // un altro tool dopo l'allegato, quel giro non produce comunque testo
      // utente-visibile).
      const bufferOnly = !!generatedAttachment;
      // All'ultimo round consentito, niente altri tool: il modello deve
      // per forza rispondere con del testo (rete di sicurezza anti-loop).
      const roundsLeft = toolRound < MAX_TOOL_ROUNDS;

      current = await copywriter.streamTurn({
        messages: messagesSoFar,
        tools: roundsLeft ? availableTools : undefined,
        onChunk: bufferOnly ? undefined : (text) => sendEvent({ type: 'chunk', text })
      });

      if (bufferOnly && current.finishReason !== 'tool_calls') {
        current.text = guardrail.checkOutput(current.text, { hasAttachment: true });
        sendEvent({ type: 'chunk', text: current.text });
      }
    }

    const finalText = current.text;
    const grounded = retrieval.empty === false;
    const qaResult = grounded
      ? await qa.review({ query: messageText, context: retrieval.context, answer: finalText })
      : null;

    memory.append(sid, { role: 'assistant', content: finalText });
    sendEvent({ type: 'done', ...buildChatResponse(finalText, sid, retrieval, generatedAttachment, qaResult) });
    return res.end();
  } catch (error) {
    console.error('Chat error:', error.message);
    sendEvent({ type: 'error', error: error.message || 'Errore nella comunicazione con il servizio AI' });
    return res.end();
  }
}

function clearChatSession(sessionId) {
  memory.clear(sessionId);
}

module.exports = { orchestrateChat, clearChatSession };
