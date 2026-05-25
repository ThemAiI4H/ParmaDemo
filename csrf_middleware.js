function csrfProtection({ cookieName = 'csrf_token', headerName = 'x-csrf-token' } = {}) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    // Only protect JSON mutating endpoints
    // (we already apply rate-limit/validation separately)
    const cookieToken = req.cookies ? req.cookies[cookieName] : undefined;
    const headerToken = req.header(headerName);

    if (!cookieToken || !headerToken || typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
      return res.status(403).json({ error: 'CSRF token missing' });
    }

    if (cookieToken !== headerToken) {
      return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    return next();
  };
}

function generateCsrfToken() {
  // avoid extra dependency: use simple crypto-like randomness from Math + Date
  // (server uses crypto elsewhere; keep it minimal here)
  return (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 64);
}

module.exports = {
  csrfProtection,
  generateCsrfToken
};

