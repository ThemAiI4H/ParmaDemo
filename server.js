require('dotenv').config();
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { liveAvatarConfig } = require('./liveavatar-config.js');
liveAvatarConfig.validate();
const httpProxyMiddleware = require('http-proxy-middleware');
const { createProxyMiddleware } = httpProxyMiddleware;
const express = require('express');
const cors = require('cors');
const path = require('path');

const crawler = require('./crawler');
const { ingestData, queryRAG, initDB } = require('./rag');
const { extractPhones } = require('./utils');
const crawlSites = crawler.crawlSites;

async function handleChatQuery(userMessage) {
  const context = await queryRAG(userMessage);
  console.log('📚 Context: ' + context.length + ' chars');

  const lowerQuery = userMessage.toLowerCase();
  let basePrompt = `SEI L'ASSISTENTE UFFICIALE CLINICA CITTÀ DI PARMA. Usa SEMPRE e TUTTO il contesto fornito qui sotto. Rispondi in modo DETTAGLIATO ed ESAUSTIVO con tutti i dettagli rilevanti (orari, contatti, reparti). NON omettere informazioni. Usa Markdown ricco: **grassetto** per titoli/nomi, *corsivo* per enfasi, - elenchi puntati, [link ai documenti](url). REGOLA ASSOLUTA: NON rispondere su COVID.

CONTENUTO DAL SITO UFFICIALE:
${context}`;

  if (lowerQuery.includes('orario') || lowerQuery.includes('ora')) {
    const allText = context.replace(/[^0-9a-zA-Z ]/g, ' ');
    const phones = extractPhones(allText);
    if (phones.length > 0) {
      basePrompt += `

**📞 Numeri Utili Parma trovati:** ${phones.map(p => `**${p}**`).join(', ')}`;
    }
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: basePrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.1,
    max_tokens: 8000
  });
  
  return completion.choices[0].message.content;
}

const app = express();
const PORT = process.env.PORT || 4848;

app.use(cors({
  origin: ['http://localhost:4848', 'https://app.liveavatar.com', 'https://staging.ai4smartcity.ai', 'http://staging.ai4smartcity.ai'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(express.static('.'));

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE AVATAR PROXY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

const liveavatarSessions = new Map();

// POST /api/liveavatar/session - Create session server-side
app.post('/api/liveavatar/session', cors({
  origin: ['http://localhost:4848', 'https://app.liveavatar.com'],
  credentials: true
}), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const apiKey = process.env.LIVEAVATAR_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'LiveAvatar API key not configured' });

    liveavatarSessions.set(sessionId, {
      created: new Date().toISOString(),
      apiKey,
      status: 'active'
    });

    console.log('✅ LiveAvatar session created: ' + sessionId);

    res.cookie('liveavatar_session', sessionId, {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 30 * 60 * 1000
    });

    res.json({
      success: true,
      sessionId,
      iframeUrl: '/api/liveavatar?sessionId=' + sessionId,
      expires: new Date(Date.now() + 30*60*1000).toISOString()
    });
  } catch (error) {
    console.error('LiveAvatar session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/liveavatar - Iframe embed proxy (main client endpoint)
app.get('/api/liveavatar', cors({
  origin: ['http://localhost:4848', 'https://app.liveavatar.com'],
  credentials: true,
  methods: ['GET']
}), async (req, res) => {
  try {
    const { sessionId, chatSessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    console.log('🔄 LiveAvatar proxy: liveSession=' + sessionId + ', chatSession=' + (chatSessionId || 'none'));

    const apiKey = liveAvatarConfig.apiKey;
    if (!apiKey) {
      return res.status(503).json({ error: 'LiveAvatar service unavailable' });
    }

    console.log('🔄 LiveAvatar CONTENT proxy GET: ' + sessionId + ' (apiKey: ' + apiKey.slice(0,8) + '...)');

    if (!liveavatarSessions.has(sessionId)) {
      console.warn('⚠️ LiveAvatar unknown session: ' + sessionId);
      liveavatarSessions.set(sessionId, { created: new Date().toISOString(), apiKey, status: 'active' });
    }

    const avatarId = liveAvatarConfig.avatarId || '5059544e-f7b3-4ffa-8cc0-5b2160f87892';
    const externalAvatarUrl = 'https://embed.liveavatar.com/v1/' + avatarId + '?sessionId=' + encodeURIComponent(sessionId);

    console.log('📄 Building LiveAvatar scaled iframe: ' + sessionId);

    const scaledHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiveAvatar</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    .avatar-scaler { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; transform-origin: top left center; }
    .avatar-scaler iframe { width: 100%; height: 100%; border: none !important; background: transparent !important; display: block; }
  </style>
</head>
<body>
  <div class="avatar-scaler">
    <iframe 
      src="${externalAvatarUrl}" 
      allow="microphone; camera; display-capture; autoplay; encrypted-media"
      sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation"
      title="LiveAvatar Assistant"
      scrolling="no"
    ></iframe>
  </div>
  <script>
    window.liveavatarProxySessionId = '${sessionId}';
    window.liveavatarProxyOrigin = '${req.headers.origin || 'https://app.liveavatar.com'}';
    console.log('✅ LiveAvatar scaled iframe loaded:', '${sessionId}');
    window.parent.postMessage({ type: 'avatar_session_ready', sessionId: '${sessionId}' }, '*');
  </script>
</body>
</html>`;

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'ALLOWALL',
      'Referrer-Policy': 'no-referrer-when-downgrade',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.cookie('liveavatar_proxy', 'true', {
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 60 * 1000
    });

    console.log('✅ LiveAvatar scaled HTML sent: ' + sessionId);
    res.status(200).send(scaledHtml);

  } catch (error) {
    console.error('❌ LiveAvatar proxy error:', error.message);

    const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <title>LiveAvatar Assistant</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#333;}
    .fallback{max-width:320px;padding:40px 30px;background:hsla(0,0%,100%,.95);border-radius:20px;box-shadow:0 25px 50px rgba(0,0,0,.25);text-align:center;}
    .emoji{font-size:4rem;margin-bottom:1rem;display:block;}
    .title{font-size:1.4rem;font-weight:700;color:#2d3748;margin-bottom:.5rem;}
    .subtitle{font-size:.95rem;color:#718096;margin-bottom:1.5rem;}
    .session{font-size:.8rem;color:#a0aec0;font-family:monospace;padding:8px;border-radius:6px;background:#f7fafc;margin-bottom:1.5rem;}
    .link{padding:12px 24px;background:#4299e1;color:white;text-decoration:none;border-radius:8px;font-weight:600;transition:all .2s;display:inline-block;}
    .link:hover{background:#3182ce;transform:translateY(-1px);}
  </style>
</head>
<body>
  <div class="fallback">
    <span class="emoji">🤖</span>
    <div class="title">LiveAvatar Assistant</div>
    <div class="subtitle">Caricamento in corso...</div>
    <div class="session">Session: ${req.query.sessionId || 'N/A'}</div>
    <a href="https://liveavatar.com" target="_blank" rel="noopener" class="link">Visita LiveAvatar</a>
  </div>
  <script>
    console.warn('LiveAvatar fallback active (proxy error)');
    window.liveavatarProxyError = true;
    window.liveavatarProxySessionId = '${req.query.sessionId || ''}';
  </script>
</body>
</html>`;

    res.status(200).send(fallbackHtml);
  }
});

app.use('/_next', (req, res) => {
  res.status(204).end();
});

app.use('/proxy-liveavatar', createProxyMiddleware({
    target: 'https://api.liveavatar.com',
    changeOrigin: true,
    pathRewrite: {
        '^/proxy-liveavatar': '',
    },
    onProxyReq: (proxyReq, req, res) => {
        const apiKey = liveAvatarConfig.apiKey || process.env.LIVEAVATAR_API_KEY;
        if (apiKey) {
            proxyReq.setHeader('Authorization', 'Bearer ' + apiKey);
            proxyReq.setHeader('x-api-key', apiKey);
            proxyReq.setHeader('x-liveavatar-api-key', apiKey);
            proxyReq.setHeader('api-key', apiKey);
        }
        proxyReq.setHeader('Cookie', 'SameSite=None; Secure; Path=/');
        proxyReq.setHeader('User-Agent', 'LiveAvatarProxy/2.0');
        proxyReq.setHeader('Origin', 'https://app.liveavatar.com');
        console.log('🔌 Proxy API req: ' + req.method + ' ' + req.url + ' → api.liveavatar.com');
    },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['access-control-allow-origin'] = '*';
        proxyRes.headers['access-control-allow-credentials'] = 'true';
        proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
        proxyRes.headers['access-control-allow-headers'] = 'Content-Type,Authorization,x-api-key,x-liveavatar-api-key';
        proxyRes.headers['access-control-max-age'] = '86400';
        console.log('📡 Proxy API res: ' + proxyRes.statusCode + ' ' + req.url);
    },
    onError: (err, req, res) => {
        console.error('❌ Proxy error ' + req.url + ':', err.message);
        res.status(502).json({ error: 'Proxy error', message: err.message });
    }
}));

app.post('/api/dom_staging', async (req, res) => {
  try {
    const { sessionId, action, message } = req.body;
    
    console.log('🔵 DOM_STAGING event: ' + action + ' for session ' + sessionId);
    
    if (action === 'init') {
      return res.json({
        success: true,
        stage: 'dom_staging_initialized',
        animationEnabled: true,
        transitions: {
          appearDuration: 800,
          speakTransition: 300,
          idleAnimation: true
        },
        avatarId: process.env.LIVEAVATAR_AVATAR_ID || '9d569d42-b50f-4772-bf65-93834d55aaac',
        voice: 'nova',
        language: 'it-IT'
      });
    }
    
    if (action === 'speak') {
      try {
        const userMessage = message;
        console.log('🎤 LiveAvatar domanda: "' + userMessage + '"');
        
        const reply = await handleChatQuery(userMessage);
        console.log('✅ Risposta LiveAvatar: ' + reply.substring(0,100) + '...');
        
        return res.json({
          success: true,
          reply: reply,
          text: reply,
          queued: true,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error('❌ Errore LiveAvatar chat:', e.message);
        return res.json({
          success: true,
          reply: 'Mi dispiace, non sono in grado di rispondere in questo momento.',
          text: 'Mi dispiace, non sono in grado di rispondere in questo momento.',
          queued: true,
          timestamp: Date.now()
        });
      }
    }
    
    return res.json({ success: true, received: true });
    
  } catch (error) {
    console.error('DOM_STAGING error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

initDB().then(() => {
  console.log('✅ RAG Database initialized and ready');
}).catch(console.error);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Messaggio richiesto' });
    
    console.log('💬 Chat query: "' + message + '"');
    const replyText = await handleChatQuery(message);
    
    res.json({ reply: replyText });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'OpenAI error: ' + error.message });
  }
});

app.post('/api/ingest', async (req, res) => {
  try {
    await crawlSites();
    await ingestData();
    res.json({ status: 'Ingest OK - data/raw & data/lancedb ready' });
  } catch (error) {
    res.status(500).json({ error });
  }
});

const [, , cmd] = process.argv;
if (cmd === 'ingest') {
  crawlSites().then(ingestData).then(() => process.exit(0)).catch(console.error);
} else {
  app.listen(PORT, () => {
    console.log('MedicAI RAG su http://localhost:' + PORT);
    console.log('Test: POST /api/ingest');
    console.log('Chat: POST /api/chat');
    console.log('Site: /index.html');
  });
}
