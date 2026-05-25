const rateLimitState = new Map();

function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const key = `${req.path}|${ip}`;
    const now = Date.now();

    const state = rateLimitState.get(key) || { count: 0, start: now };

    if (now - state.start > windowMs) {
      state.count = 0;
      state.start = now;
    }

    state.count += 1;
    rateLimitState.set(key, state);

    if (state.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}

function validateJsonBody({ required = [], maxMessageLen = 4000 } = {}) {
  return (req, res, next) => {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    for (const k of required) {
      if (body[k] === undefined || body[k] === null) {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    if (typeof body.message === 'string') {
      if (body.message.length < 1 || body.message.length > maxMessageLen) {
        return res.status(400).json({ error: 'Invalid message length' });
      }
    }

    next();
  };
}

function validateDomStagingBody() {
  const allowedActions = new Set(['init', 'speak']);
  return (req, res, next) => {
    const { sessionId, action, message } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    if (!allowedActions.has(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (action === 'speak') {
      if (!message || typeof message !== 'string' || message.length < 1 || message.length > 4000) {
        return res.status(400).json({ error: 'Invalid message' });
      }
    }

    next();
  };
}

module.exports = {
  rateLimit,
  validateJsonBody,
  validateDomStagingBody
};

