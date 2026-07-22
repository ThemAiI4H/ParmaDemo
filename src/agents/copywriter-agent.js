'use strict';

/**
 * copywriter-agent.js — Generazione testo in streaming (gpt-4o-mini).
 *
 * Incapsula SOLO l'accumulo streaming di un singolo turno verso il modello
 * (parsing dei delta, accumulo di eventuali tool_calls frammentati,
 * forwarding di ogni pezzo di testo via onChunk) — non decide da solo se
 * rilanciare una seconda chiamata dopo un tool_call: quella è logica di
 * coordinamento e resta nell'orchestratore.
 *
 * Ported from Staging/src/agents/copywriter-agent.js senza modifiche.
 */

const MODEL = 'gpt-4o-mini';

function createCopywriterAgent({ openai } = {}) {
  if (!openai) throw new Error('createCopywriterAgent: openai client richiesto');

  async function streamTurn({ messages, tools, onChunk }) {
    const params = { model: MODEL, messages, stream: true };
    if (tools && tools.length) params.tools = tools;

    const stream = await openai.chat.completions.create(params);

    let text = '';
    let finishReason = null;
    const toolCallsAcc = [];

    for await (const part of stream) {
      const choice = part.choices && part.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};

      if (delta.content) {
        text += delta.content;
        if (onChunk) onChunk(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) toolCallsAcc[idx].id = tc.id;
          if (tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    return { text, toolCalls: toolCallsAcc, finishReason };
  }

  return { streamTurn };
}

module.exports = { createCopywriterAgent };
