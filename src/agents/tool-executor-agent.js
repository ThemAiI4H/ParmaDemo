'use strict';

/**
 * tool-executor-agent.js — Dispatch/esecuzione dei tool richiesti dal
 * Copywriter (function-calling).
 *
 * Adattato da Staging/src/agents/tool-executor-agent.js: rimosso il tool
 * `search_websites` e il fallback su deep-search-engine.js (ParmaDemo non
 * ha una ricerca live di fallback — l'unica fonte è la knowledge base
 * indicizzata via rag-agent), rimossa la distinzione demo.searchMode
 * live/crawling (ParmaDemo ha sempre e solo la modalità "crawling").
 *
 * Le tool_calls di un turno vengono eseguite in Promise.all invece che in
 * un `for` sequenziale — sono già indipendenti tra loro, quindi eseguirle
 * in parallelo riduce la latenza totale a ~max() invece di sum().
 */

const { sendSMS, sendEmail } = require('../lib/notify');
const { textToSpeech } = require('../lib/tts');
const { generatePdf } = require('../lib/documents');
const { buildMapAttachment } = require('../lib/maps');

async function showMapTool(query, label) {
  try {
    const attachment = await buildMapAttachment(query, label);
    if (!attachment) {
      return { content: `Non sono riuscito a individuare "${query}" sulla mappa. Puoi indicare un indirizzo più preciso?` };
    }
    return {
      content: `La mappa con la posizione di "${attachment.label}" è già visualizzata nell'interfaccia utente (con un link cliccabile per le indicazioni stradali). Nella tua risposta di testo NON includere alcun link, immagine markdown (![...](...)), URL di mappe o servizi esterni: la mappa è già mostrata separatamente e qualsiasi link che inventeresti (es. Google Maps embed) non funzionerebbe. Limitati a confermare in una frase che la mappa è pronta.`,
      meta: { attachment }
    };
  } catch (err) {
    console.error('buildMapAttachment error:', err.message);
    return { content: 'Si è verificato un problema tecnico nel recuperare la mappa.' };
  }
}

async function generateDocumentTool(title, content) {
  try {
    const { filename, size } = await generatePdf(title, content);
    const attachment = {
      url: `/uploads/${filename}`,
      name: `${title}.pdf`,
      mimeType: 'application/pdf',
      size,
      kind: 'document'
    };
    return {
      content: `Documento generato con successo: "${title}.pdf". Il file è già allegato al messaggio con un pulsante di download nell'interfaccia utente: nella tua risposta conferma semplicemente che il documento è pronto, senza inserire link, URL o markdown di download (non inventare URL, il download è già gestito dall'interfaccia).`,
      meta: { attachment }
    };
  } catch (err) {
    console.error('generatePdf error:', err.message);
    return { content: `Errore nella generazione del documento: ${err.message}` };
  }
}

function createToolExecutorAgent({ openai, ragAgent } = {}) {
  async function runOne(toolCall, ctx) {
    const { function: fn } = toolCall;
    let outcome;

    try {
      const parsedArgs = JSON.parse(fn.arguments);

      switch (fn.name) {
        case 'search_configured_sites': {
          const ragResult = await ragAgent.search(parsedArgs.query, ctx.languageHintLabel);
          const retrieval = {
            citations: ragResult.citations,
            confidence: ragResult.confidence,
            empty: ragResult.empty,
            context: ragResult.context
          };
          outcome = { content: ragResult.text, meta: { retrieval } };
          break;
        }
        case 'send_sms':
          outcome = { content: await sendSMS(parsedArgs.phone, parsedArgs.message) };
          break;
        case 'send_email':
          outcome = { content: await sendEmail(parsedArgs.to, parsedArgs.subject, parsedArgs.message) };
          break;
        case 'text_to_speech':
          outcome = { content: await textToSpeech(parsedArgs.text, parsedArgs.voice, parsedArgs.speed, openai) };
          break;
        case 'generate_document':
          outcome = await generateDocumentTool(parsedArgs.title, parsedArgs.content);
          break;
        case 'show_map':
          outcome = await showMapTool(parsedArgs.query, parsedArgs.label);
          break;
        default:
          outcome = { content: { error: 'Tool not implemented' } };
      }
    } catch (parseError) {
      outcome = { content: { error: 'Invalid arguments' } };
    }

    return { toolCall, outcome };
  }

  async function execute(toolCalls, ctx = {}) {
    const settled = await Promise.all(toolCalls.map(tc => runOne(tc, ctx)));

    const toolResults = settled.map(({ toolCall, outcome }) => ({
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolCall.function.name,
      content: typeof outcome.content === 'string' ? outcome.content : JSON.stringify(outcome.content)
    }));

    // Se il turno ha invocato più volte lo stesso tool, mantieni l'ordine
    // delle toolCalls (non l'ordine di completamento) per un comportamento
    // deterministico.
    let retrieval = {};
    let attachment = null;
    for (const { outcome } of settled) {
      if (outcome.meta && outcome.meta.retrieval) retrieval = outcome.meta.retrieval;
      if (outcome.meta && outcome.meta.attachment) attachment = outcome.meta.attachment;
    }

    return { toolResults, retrieval, attachment };
  }

  return { execute };
}

module.exports = { createToolExecutorAgent };
