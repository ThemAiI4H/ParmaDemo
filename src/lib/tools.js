'use strict';

/**
 * tools.js — Schemi dei tool OpenAI (single source).
 *
 * Adattato da Staging/src/lib/tools.js: rimosso `search_websites` (ricerca
 * web generale di fallback, legata a deep-search-engine.js che ParmaDemo non
 * ha — qui la conoscenza e' sempre e solo quella indicizzata via RAG) e la
 * distinzione multi-demo (getToolsForDemo). ParmaDemo ha un'unica fonte RAG
 * sempre disponibile, quindi la lista di tool e' fissa.
 */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_configured_sites',
      description: 'Search the indexed knowledge base built from this organization\'s configured website(s) for services, information, contacts, or content. Use this whenever the user asks about anything specific to this organization, its services, or its website content.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A concise search query in the same language as the user\'s message, focused on finding the specific information needed from the configured websites' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Send an SMS message to a user. Use this when the user wants to receive information via SMS.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Phone number in international format (e.g., +393331234567)' },
          message: { type: 'string', description: 'The SMS message' }
        },
        required: ['phone', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send an email to a user. Use this when the user wants to receive information via email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Email address' },
          subject: { type: 'string', description: 'Email subject' },
          message: { type: 'string', description: 'Email body content' }
        },
        required: ['to', 'subject', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'text_to_speech',
      description: 'Convert text to speech (TTS). Use this when the user wants to listen to the response or needs audio output.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to convert to speech' },
          voice: { type: 'string', description: "Voice to use: 'alloy', 'echo', 'fable', 'onyx', 'nova', or 'shimmer'", enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
          speed: { type: 'number', description: 'Speed of speech: 0.25 (slow) to 4.0 (fast), default is 1.0' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'show_map',
      description: 'Show an embedded map with the location of a specific address or place. Use this whenever the user asks how to reach a location or where it is (e.g. "come si raggiunge", "dove si trova", directions). Always pass the most specific address known from context (e.g. a specific office\'s address if the user asked about a specific office/service); if no specific address is known, use the organization\'s main address.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The address or place name to locate on the map, as specific as possible (street, number, city)' },
          label: { type: 'string', description: 'A short human-readable label for what this location is (e.g. "Ufficio Anagrafe", "Clinica Città di Parma")' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_document',
      description: 'Generate a downloadable PDF document for the user (e.g. a summary, an information sheet, or requested content in document form). Use this only when the user explicitly asks to receive something as a PDF/document/file to download.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title, also used as the file name' },
          content: { type: 'string', description: 'The full plain-text content of the document' }
        },
        required: ['title', 'content']
      }
    }
  }
];

function getTools() {
  return TOOLS;
}

module.exports = { TOOLS, getTools };
