'use strict';

/**
 * tts.js — Logica Text-To-Speech condivisa (OpenAI-only).
 *
 *   textToSpeech(text, voice, speed, openai)
 *
 * Ported from Staging/src/lib/tts.js senza modifiche.
 */

// Valori validi per l'API OpenAI TTS: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'ash' | 'sage' | 'coral'.
const voiceMap = {
  it: 'marin',
  en: 'marin',
  de: 'marin',
  fr: 'marin',
  ar: 'marin'
};

/**
 * Rilevazione lingua euristica (regex su parole chiave), usata sia per la
 * selezione voce TTS sia (in orchestrator.js) per l'hint di lingua nel
 * prompt. Ritorna `null` quando nessun pattern matcha — i chiamanti
 * applicano il proprio default in quel caso.
 */
function detectLanguage(text) {
  const italianPatterns = /\b(il|lo|la|di|da|in|con|per|tra|frra|gli|sono|essere|avere|fare|volevo|possso|come|cosa|dove|quando|perché|grazie|buongiorno|buonasera|prego|scusi|perdoni|chiedere|rispondere|comunicare|informare|richiedere|ottenere|documento|certificato|ufficio|anagrafe|tributi|imposta|tassa|servizio|appuntamento|prenotazione|versamento|bollette|bolletta|pagamento|scadenza|comune|cittadino)\b/i;
  const germanPatterns = /\b(der|die|das|ein|eine|und|oder|aber|nicht|sein|haben|werden|können|müssen|sollen|wollen|bitte|danke|guten|morgen|abend|herr|frau|ich|du|wir|sie|es|hat|ist|war|werden)\b/i;
  const frenchPatterns = /\b(le|la|les|un|une|du|des|et|ou|mais|ne|pas|être|avoir|pouvoir|vouloir|doit|falloir|savoir|merci|bonjour|bonsoir|madame|monsieur|je|tu|nous|vous|ils|elle|est|sont|était|été)\b/i;
  const arabicPatterns = /[؀-ۿ]/;
  const englishPatterns = /\b(the|is|are|you|your|what|how|can|could|would|please|hello|hi|thanks|thank|information|need|want|payment|bill|bills|help|when|where|which|who|does|do|did|have|has|will|about|invoice|document|office|certificate|appointment|schedule|request|tax|and|for|with)\b/i;

  if (arabicPatterns.test(text)) return 'ar';
  if (italianPatterns.test(text)) return 'it';
  if (germanPatterns.test(text)) return 'de';
  if (frenchPatterns.test(text)) return 'fr';
  if (englishPatterns.test(text)) return 'en';
  return null;
}

async function openaiTextToSpeech(text, voice = 'marin', speed = 1.0, openai) {
  const mp3 = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice,
    input: text,
    speed
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  const base64 = buffer.toString('base64');

  return {
    success: true,
    audio: `data:audio/mpeg;base64,${base64}`,
    message: 'Audio generato con OpenAI TTS'
  };
}

async function textToSpeech(text, voice = 'marin', speed = 1.0, openai) {
  const lang = detectLanguage(text);
  const voiceName = voiceMap[lang] || voice;
  return await openaiTextToSpeech(text, voiceName, speed, openai);
}

module.exports = { voiceMap, detectLanguage, textToSpeech };
