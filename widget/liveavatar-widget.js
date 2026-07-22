(function () {
  function getCookie(name) {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const c = cookies[i].trim();
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  let liveAvatarActive = false;

  async function createLiveAvatarSession(sessionId) {
    const csrf = getCookie('csrf_token');

    const resp = await fetch('/api/liveavatar/session', {
      method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        // CSRF double-submit cookie (server requires matching header)
        'x-csrf-token': csrf || ''
      },
      body: JSON.stringify({ sessionId })
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LiveAvatar session create failed: HTTP ${resp.status} ${text}`);
    }

    return resp.json();
  }

  window.toggleLiveAvatar = async function toggleLiveAvatar() {
    if (liveAvatarActive) {
      const av = document.querySelector('.avatar-frame-ext');
      if (av) {
        av.style.animation = 'chat-close 0.28s ease-in both';
        setTimeout(() => av.remove(), 300);
      }
      liveAvatarActive = false;

      const btn = document.getElementById('avatar-btn');
      if (btn) btn.textContent = '🔄 AVATAR';
      return;
    }

    // 1) Create server-side session first (prevents 403 unknown sessionId)
    const sessionId = 'liveavatar_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
    const created = await createLiveAvatarSession(sessionId);
    const iframeUrl = created && created.iframeUrl
      ? created.iframeUrl
      : '/api/liveavatar?sessionId=' + encodeURIComponent(sessionId);

    // 2) Build UI + iframe (sandbox hardened: remove allow-same-origin)
    const frame = document.createElement('div');
    frame.className = 'avatar-frame-ext';
    frame.style.cssText = `
      position:fixed; bottom:90px; right:calc(1.5rem + 465px);
      width:360px; height:480px; z-index:98;
      border-radius:22px; overflow:hidden;
      background:#100e17;
      box-shadow:0 24px 72px rgba(0,0,0,.75),0 0 60px -20px rgba(192,132,252,.4),0 0 0 1px rgba(192,132,252,.15);
      transform-origin:bottom right;
      animation:chat-open 0.48s cubic-bezier(0.34,1.56,0.64,1) both;
      display:flex; flex-direction:column;
    `;

    frame.innerHTML = `
      <div style="background:linear-gradient(180deg,#252230,#1a1723);padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(192,132,252,.15)">
        <div style="width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.7);animation:pip-pulse 3s ease-in-out infinite"></div>
        <span style="color:#efefef;font-size:.82rem;font-family:system-ui">LiveAvatar</span>
        <button onclick="toggleLiveAvatar()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:1rem;line-height:1">✕</button>
      </div>

      <iframe
        id="la-iframe"
        src="${iframeUrl}"
        title="LiveAvatar Assistant"
        style="flex:1;width:100%;border:none;background:#100e17;"
        allow="microphone; camera; display-capture; autoplay; encrypted-media; clipboard-write"
        allowfullscreen
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin allow-storage-access-by-user-activation"
        referrerpolicy="no-referrer-when-downgrade"
        crossorigin="anonymous"
      ></iframe>

      <div id="la-fallback" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;text-align:center">
        <div style="font-size:2.5rem">🎭</div>
        <p style="color:#a0a0b0;font-size:.82rem;font-family:system-ui;line-height:1.5">
          Avatar non disponibile.<br>
          Funziona con API key configurata sul server.
        </p>
        <code style="background:#15131c;color:#c084fc;font-size:.7rem;padding:6px 12px;border-radius:8px;display:block">LIVEAVATAR_API_KEY</code>
      </div>
    `;

    document.body.appendChild(frame);
    liveAvatarActive = true;

    const btn = document.getElementById('avatar-btn');
    if (btn) btn.textContent = '✕ CHIUDI';

    // Show fallback if iframe fails to load within 5s
    const iframe = frame.querySelector('#la-iframe');
    const fallback = frame.querySelector('#la-fallback');
    const fallbackTimer = setTimeout(() => {
      iframe.style.display = 'none';
      fallback.style.display = 'flex';
    }, 5000);

    iframe.addEventListener('load', () => clearTimeout(fallbackTimer));
  };

  // Keep legacy functions used by pages (if any) from breaking.
  window.__liveavatar_widget__ = { escapeHtml: escapeHtml };
})();

