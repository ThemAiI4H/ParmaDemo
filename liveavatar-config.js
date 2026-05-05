// LiveAvatar Configuration
// Questo file contiene la configurazione per l'integrazione LiveAvatar
// LiveAvatar Configuration - CLEAN VERSION (fixes duplicate exports)
// Server-side only, validates LIVEAVATAR_API_KEY on startup
// LiveAvatar Config - ENHANCED for proxy (Step 3/5)
// Uses LIVEAVATAR_API_KEY env exclusively (server-side only)

const liveAvatarConfig = {
  // Core
  apiKey: process.env.LIVEAVATAR_API_KEY,
  baseUrl: 'https://app.liveavatar.com/api/v1',

  // Session defaults
  sessionDefaults: {
    mode: 'live',
    language: 'it-IT',
    voice: 'nova',
    maxDuration: 30 * 60 * 1000 // 30min
  },

  // Iframe attributes for client (widget.js)
  getIframeAttrs: (sessionId) => ({
    src: `/api/liveavatar?sessionId=${sessionId}`,
    title: 'LiveAvatar Assistant',
    width: '100%',
  }),

  // Security origins (postMessage validation)
  allowedOrigins: [
    'https://app.liveavatar.com',
    'https://api.liveavatar.com',
    'https://liveavatar.com'
  ],

  // Configurazione HeyGen Embed
  avatarId: process.env.LIVEAVATAR_AVATAR_ID || '9d569d42-b50f-4772-bf65-93834d55aaac',

  // Configurazione iframe
  iframeConfig: {
    // Modalità di funzionamento
    mode: 'live', // 'live' per avatar in tempo reale

    // Dimensioni minime
    minWidth: 300,
    minHeight: 200,

    // Opzioni di sandbox per sicurezza
    sandbox: [
      'allow-scripts',
      'allow-same-origin',
      'allow-forms',
      'allow-popups',
      'allow-modals'
    ],

    // Permessi per dispositivi
    allow: [
      'camera',
      'microphone',
      'autoplay',
      'encrypted-media',
      'display-capture'
    ]
  },

  // Configurazione messaggi
  messageConfig: {
    // Timeout per la connessione WebSocket
    connectionTimeout: 10000,

    // Timeout per le risposte
    responseTimeout: 30000,

    // Massimo numero di tentativi di riconnessione
    maxRetries: 3,

    // Intervallo tra i tentativi (ms)
    retryInterval: 2000
  },

  // Configurazione sessione
  sessionConfig: {
    // Durata massima della sessione (ms)
    maxSessionDuration: 30 * 60 * 1000, // 30 minuti

    // Intervallo di ping per mantenere viva la sessione
    pingInterval: 30000 // 30 secondi
  },

  // Configurazione sicurezza
  security: {
    // Origini consentite per i messaggi iframe
    allowedOrigins: [
      'https://app.liveavatar.com',
      'https://liveavatar.com'
    ],

    // Verifica SSL
    strictSSL: true,

    // Timeout per la verifica dell'origine
    originCheckTimeout: 5000
  },

  // Configurazione fallback
  fallback: {
    // Abilita fallback a testo puro se LiveAvatar non è disponibile
    enabled: true,

    // Messaggio di fallback
    message: 'Avatar temporaneamente non disponibile. Passando alla modalità testo.',

    // Tempo di attesa prima del fallback (ms)
    timeout: 15000
  },

  // Validate (called on server startup)
  validate: function() {
    const apiKey = this.apiKey;
    if (!apiKey || apiKey.length < 10) {
      console.warn('⚠️  LIVEAVATAR_API_KEY non configurata - Avatar disabilitato.');
      console.warn('   Per abilitare LiveAvatar, configura LIVEAVATAR_API_KEY in Plesk o nel .env');
      return false;
    }
    console.log(`✅ LiveAvatar configured ✓ (key: ${apiKey.slice(0,8)}... base: ${this.baseUrl})`);
    return true;
  }
};

// Funzione per validare la configurazione
function validateConfig() {
  const errors = [];

  if (!liveAvatarConfig.apiKey || liveAvatarConfig.apiKey === 'YOUR_LIVEAVATAR_API_KEY') {
    errors.push('API Key LiveAvatar non configurata');
  }

  if (!liveAvatarConfig.baseUrl) {
    errors.push('URL base LiveAvatar non configurato');
  }

  if (errors.length > 0) {
    console.warn('⚠️ Configurazione LiveAvatar incompleta:');
    errors.forEach(error => console.warn(`   - ${error}`));
    console.warn('   Per favore, configura le variabili d\'ambiente correttamente.');
    return false;
  }

  return true;
}

// Funzione per ottenere l'URL dell'iframe
function getIframeUrl() {
  const params = new URLSearchParams({
    apiKey: liveAvatarConfig.apiKey,
    mode: liveAvatarConfig.iframeConfig.mode
  });

  return `${liveAvatarConfig.baseUrl}/iframe?${params.toString()}`;
}

// Funzione per ottenere gli attributi di sicurezza dell'iframe
function getIframeAttributes() {
  return {
    src: getIframeUrl(),
    title: 'LiveAvatar',
    allow: liveAvatarConfig.iframeConfig.allow.join('; '),
    sandbox: liveAvatarConfig.iframeConfig.sandbox.join(' '),
    style: {
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'transparent'
    }
  };
}

// SINGLE EXPORT - No duplicates
module.exports = {
  liveAvatarConfig,
  validateConfig,
  getIframeUrl,
  getIframeAttributes
};