// Chatbot Widget — orb trigger + volcanic glass chat window.
// Usage: ChatbotWidget.init({ name, subtitle, welcomeHtml, welcomeCopyText,
//   chips: [{label, text}], placeholder, errorMessage, apiEndpoint, ttsEndpoint,
//   avatarButton, container }).
// Renders its own markup into `container` (default document.body) and wires
// all interaction — nothing here depends on page-specific globals except the
// optional window.toggleLiveAvatar() hook (see liveavatar-widget.js).
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function now() {
    return new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function getCookie(name) {
    const nameEQ = name + '=';
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const c = cookies[i].trim();
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
  }

  function markdownToHtml(text) {
    if (typeof text !== 'string') return '';

    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');

    html = html.replace(/^### (.*$)/gm, '<h4 style="margin: 0.5em 0 0.3em 0; color: var(--iris-2); font-size: 1.1em; font-weight: 600;">$1</h4>');
    html = html.replace(/^## (.*$)/gm, '<h5 style="margin: 0.8em 0 0.4em 0; color: var(--iris-2); font-size: 1em;">$1</h5>');
    html = html.replace(/^# (.*$)/gm, '<h3 style="margin: 1em 0 0.5em 0; color: var(--iris-2); font-size: 1.2em;">$1</h3>');

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 700; color: var(--t-hi);">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em style="font-style: italic;">$1</em>');

    html = html.replace(/^\s*- (.*$)/gm, '<div style="margin: 0.3em 0; padding-left: 1.2em; position: relative;">::marker $1</div>');
    html = html.replace(/::marker /g, '<span style="display: inline-block; width: 0.6em; margin-right: 0.4em; color: var(--iris-4);">•</span>');

    html = html.replace(/\n\n/g, '</p><p style="margin: 0.6em 0;">');
    html = '<p style="margin: 0.3em 0;">' + html + '</p>';
    html = html.replace(/<p[^>]*><\/p>/g, '');

    return html;
  }

  function linkifyHtml(text) {
    text = text.replace(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--iris-4); text-decoration: none; font-weight: 500; padding: 0.1em 0.2em; border-radius: 4px; background: rgba(56,189,248,0.1); transition: all 0.2s;">$1</a>');
    text = text.replace(/(\b05\d{8,9}\b|\b0521\d{6,7}\b)/g, '<a href="tel:$1" style="color: var(--iris-5); text-decoration: none; font-weight: 600; padding: 0.1em 0.2em; border-radius: 4px; background: rgba(52,211,153,0.15); transition: all 0.2s;">📞 $1</a>');
    text = text.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color: #f59e0b; text-decoration: none; font-weight: 500; padding: 0.1em 0.2em; border-radius: 4px; background: rgba(245,158,11,0.15); transition: all 0.2s;">✉️ $1</a>');
    return text;
  }

  const AI_AVATAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M19 21a7 7 0 00-14 0"/></svg>';

  /** Markup per l'attachment restituito nell'evento `done` (mappa da show_map, PDF da generate_document). */
  function renderAttachmentHtml(attachment) {
    if (!attachment) return '';
    if (attachment.kind === 'map') {
      return `
        <div class="attachment-card attachment-card--map">
          <iframe class="attachment-map-embed" src="${escapeHtml(attachment.embedUrl)}" loading="lazy" title="Mappa: ${escapeHtml(attachment.label)}"></iframe>
          <div class="attachment-map-footer">
            <span class="attachment-map-label">📍 ${escapeHtml(attachment.label)}</span>
            <a href="${escapeHtml(attachment.directionsUrl)}" target="_blank" rel="noopener noreferrer">Ottieni indicazioni ↗</a>
          </div>
        </div>`;
    }
    if (attachment.kind === 'document') {
      const sizeKb = attachment.size ? Math.max(1, Math.round(attachment.size / 1024)) : null;
      return `
        <a class="attachment-card attachment-card--document" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(attachment.name || '')}">
          <span class="attachment-doc-icon">📄</span>
          <span class="attachment-doc-info">
            <span class="attachment-doc-name">${escapeHtml(attachment.name || 'Documento')}</span>
            ${sizeKb ? `<span class="attachment-doc-size">${sizeKb} KB</span>` : ''}
          </span>
          <span class="attachment-doc-download">⬇</span>
        </a>`;
    }
    return '';
  }

  function renderWidgetHtml(cfg) {
    const chipsHtml = cfg.chips.map((c) => `<button class="chip" data-chip-text="${escapeHtml(c.text)}">${escapeHtml(c.label)}</button>`).join('');
    const avatarBtnHtml = cfg.avatarButton
      ? `<button data-action="toggle-avatar" id="avatar-btn" style="margin-left:12px;padding:6px 14px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border:none;border-radius:8px;color:white;font-family:var(--f-mono);font-size:0.7rem;font-weight:500;cursor:pointer;box-shadow:0 0 20px rgba(124,58,237,0.6);animation:avatar-btn-pulse 1.2s ease-in-out infinite">👤 AVATAR</button>`
      : '';

    return `
<div class="widget-wrap" id="chat-window" style="display:none;position:fixed;bottom:90px;right:1.5rem;z-index:99;">
  <div class="resize-handle rh-tl"></div>
  <div class="resize-handle rh-tr"></div>
  <div class="resize-handle rh-bl"></div>
  <div class="resize-handle rh-br"></div>
  <div class="resize-handle rh-t"></div>
  <div class="resize-handle rh-b"></div>
  <div class="resize-handle rh-l"></div>
  <div class="resize-handle rh-r"></div>
  <div class="shell">
    <div class="header">
      <div class="av-wrap">
        <div class="av-orbit"></div>
        <div class="av-core" id="main-av">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z"/>
            <path d="M19 21a7 7 0 00-14 0"/>
            <circle cx="9" cy="9" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="9" r="0.8" fill="currentColor" stroke="none"/>
          </svg>
        </div>
      </div>
      <div class="header-info">
        <div class="header-name"><div class="online-pip"></div>${escapeHtml(cfg.name)}</div>
        <div class="header-sub">${escapeHtml(cfg.subtitle)}</div>
      </div>
      <div class="header-dots">
        <button class="dot dot-r" data-action="close-chat" aria-label="Chiudi"></button>
        <button class="dot dot-y"></button>
        <button class="dot dot-g"></button>
      </div>
      ${avatarBtnHtml}
    </div>

    <div class="messages" id="msg-box">
      <button id="scroll-btn" data-action="scroll-bottom">↓</button>

      <div class="msg msg--ai">
        <div class="mini-av">${AI_AVATAR_ICON}</div>
        <div>
          <div class="bubble-wrap">
            <button class="copy-btn" data-copy-text="${encodeURIComponent(cfg.welcomeCopyText)}" type="button">
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              copia
            </button>
            <div class="bubble">
              <p>${cfg.welcomeHtml}</p>
              <div class="ts">${now()}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="msg msg--ai" id="typing-row" style="display:none">
        <div class="mini-av" id="typing-av">${AI_AVATAR_ICON}</div>
        <div class="bubble msg--ai" style="animation:none;padding:0.65em 1em">
          <div class="typing-row"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>

    <div class="input-area">
      <div class="chips">${chipsHtml}</div>
      <div class="input-row">
        <button class="icon-btn" data-action="trigger-upload">
          <svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          <input type="file" id="upload-input" accept=".txt,.pdf,.doc,.docx" style="display:none;">
        </button>
        <input class="text-in" id="text-in" placeholder="${escapeHtml(cfg.placeholder)}">
        <button class="icon-btn" data-action="toggle-voice" id="voice-btn">
          <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <button class="send-btn" data-action="send">
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<div class="orb" data-action="toggle-chat">
  <div class="orb-core">
    <svg viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  </div>
</div>`;
  }

  // ── Shatter effect — particle burst played when the orb is clicked ──
  let particles = [];
  let animationFrameId = null;
  let canvasCtx = null;

  class Shard {
    constructor(cx, cy, hue) {
      const angle = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 22;
      this.x = cx + Math.cos(angle) * r;
      this.y = cy + Math.sin(angle) * r;
      const speed = 2.5 + Math.random() * 5.5;
      this.vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 2;
      this.vy = Math.sin(angle) * speed + (Math.random() - 0.5) * 2;
      this.vr = (Math.random() - 0.5) * 0.25;
      this.size = 4 + Math.random() * 10;
      this.aspect = 0.35 + Math.random() * 0.6;
      this.rotation = Math.random() * Math.PI * 2;
      this.hue = hue + (Math.random() * 30 - 15);
      this.sat = 60 + Math.random() * 30;
      this.lit = 75 + Math.random() * 20;
      this.alpha = 0.7 + Math.random() * 0.3;
      this.life = 1.0;
      this.decay = 0.018 + Math.random() * 0.022;
      this.gravity = 0.08 + Math.random() * 0.06;
      this.drag = 0.97;
      this.glintPhase = Math.random() * Math.PI * 2;
      this.glintSpeed = 0.08 + Math.random() * 0.12;
      this.type = Math.random() > 0.35 ? 'shard' : 'droplet';
      this.pullBack = false;
      this.pullTarget = null;
      this.pullStrength = 0;
    }

    update() {
      if (this.pullBack && this.pullTarget) {
        const dx = this.pullTarget.x - this.x;
        const dy = this.pullTarget.y - this.y;
        this.vx += dx * this.pullStrength;
        this.vy += dy * this.pullStrength;
        this.vx *= 0.88;
        this.vy *= 0.88;
      }
      this.vx *= this.drag;
      this.vy *= this.drag;
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.rotation += this.vr;
      this.life -= this.decay;
      this.glintPhase += this.glintSpeed;
    }

    draw(ctx) {
      if (this.life <= 0) return;
      const glint = (Math.sin(this.glintPhase) + 1) / 2;
      const alpha = Math.min(this.life, 1) * this.alpha;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.globalAlpha = alpha;
      if (this.type === 'shard') {
        const w = this.size * this.aspect;
        const h = this.size;
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, h * 0.6);
        ctx.lineTo(-w * 0.4, h);
        ctx.closePath();
        const grd = ctx.createLinearGradient(0, -h, 0, h);
        grd.addColorStop(0, `hsla(${this.hue},${this.sat}%,${this.lit}%,${0.85 + glint * 0.15})`);
        grd.addColorStop(0.4, `hsla(${this.hue},${this.sat}%,${this.lit - 10}%,0.5)`);
        grd.addColorStop(1, `hsla(${this.hue},${this.sat}%,${this.lit}%,0.2)`);
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.strokeStyle = `hsla(${this.hue},90%,95%,${0.4 + glint * 0.5})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else {
        const rad = this.size * 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        const grd = ctx.createRadialGradient(-rad * 0.3, -rad * 0.3, 0, 0, 0, rad);
        grd.addColorStop(0, `rgba(255,255,255,${0.7 + glint * 0.3})`);
        grd.addColorStop(0.4, `hsla(${this.hue},${this.sat}%,${this.lit}%,0.5)`);
        grd.addColorStop(1, `hsla(${this.hue},${this.sat}%,${this.lit}%,0.1)`);
        ctx.fillStyle = grd;
        ctx.fill();
      }
      ctx.restore();
    }

    get alive() { return this.life > 0; }
  }

  class Spark {
    constructor(cx, cy, hue) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 7;
      this.x = cx;
      this.y = cy;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.life = 0.6 + Math.random() * 0.4;
      this.decay = 0.035 + Math.random() * 0.04;
      this.size = 1 + Math.random() * 2;
      this.color = `hsl(${hue},90%,90%)`;
      this.gravity = 0.04;
    }

    update() {
      this.vx *= 0.96;
      this.vy *= 0.96;
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.life -= this.decay;
    }

    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.fillStyle = this.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    get alive() { return this.life > 0; }
  }

  function renderParticles() {
    if (!canvasCtx || particles.length === 0) { animationFrameId = null; return; }
    const canvas = document.getElementById('particle-canvas');
    const W = canvas ? canvas.width : window.innerWidth;
    const H = canvas ? canvas.height : window.innerHeight;
    canvasCtx.clearRect(0, 0, W, H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      p.draw(canvasCtx);
      if (!p.alive) particles.splice(i, 1);
    }
    if (particles.length > 0) {
      animationFrameId = requestAnimationFrame(renderParticles);
    } else {
      animationFrameId = null;
      if (canvasCtx) canvasCtx.clearRect(0, 0, W, H);
    }
  }

  function triggerShatterEffect() {
    const canvas = document.getElementById('particle-canvas') || (() => {
      const c = document.createElement('canvas');
      c.id = 'particle-canvas';
      document.body.appendChild(c);
      return c;
    })();

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvasCtx = canvas.getContext('2d');

    const cx = window.innerWidth - 24 - 33;
    const cy = window.innerHeight - 24 - 33;
    const orb = document.querySelector('.orb');

    orb.style.transition = 'opacity 0.12s ease-out, transform 0.18s ease-out';
    orb.style.opacity = '0';
    orb.style.transform = 'scale(0.7)';

    const hues = [310, 280, 220, 185, 160, 25];
    hues.forEach((h) => {
      for (let i = 0; i < 9; i++) particles.push(new Shard(cx, cy, h));
      for (let i = 0; i < 12; i++) particles.push(new Spark(cx, cy, h));
    });

    if (!animationFrameId) renderParticles();

    setTimeout(() => {
      particles.forEach((p) => {
        if (p instanceof Shard) {
          p.pullBack = true;
          p.pullTarget = { x: cx, y: cy };
          p.pullStrength = 0.04 + Math.random() * 0.03;
        }
      });
    }, 1500);

    setTimeout(() => {
      orb.style.opacity = '1';
      orb.style.transform = 'scale(1)';
    }, 4000);

    setTimeout(() => {
      particles = [];
      if (canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }, 4100);
  }

  function init(userConfig) {
    const cfg = Object.assign({
      container: document.body,
      apiEndpoint: '/api/chat',
      ttsEndpoint: '/api/tts',
      name: 'Assistente',
      subtitle: '',
      welcomeHtml: 'Ciao! Come posso aiutarti?',
      welcomeCopyText: 'Ciao! Come posso aiutarti?',
      chips: [],
      placeholder: 'Scrivi qui…',
      errorMessage: 'Mi dispiace, si è verificato un problema tecnico. Riprova più tardi.',
      avatarButton: true
    }, userConfig || {});

    const container = typeof cfg.container === 'string' ? document.querySelector(cfg.container) : cfg.container;
    if (!container) throw new Error('ChatbotWidget: container not found');

    container.insertAdjacentHTML('beforeend', renderWidgetHtml(cfg));

    const chatWindow = document.getElementById('chat-window');
    const msgBox = document.getElementById('msg-box');
    const textIn = document.getElementById('text-in');
    const typingRow = document.getElementById('typing-row');
    const typingAv = document.getElementById('typing-av');
    const uploadInput = document.getElementById('upload-input');

    function toggleChat() {
      if (chatWindow.style.display === 'block') {
        closeChat();
      } else {
        triggerShatterEffect();
        chatWindow.style.display = 'block';
        chatWindow.classList.remove('closing');
        void chatWindow.offsetWidth;
        chatWindow.classList.add('opening');
        chatWindow.addEventListener('animationend', () => chatWindow.classList.remove('opening'), { once: true });
      }
    }

    function closeChat() {
      chatWindow.classList.remove('opening');
      void chatWindow.offsetWidth;
      chatWindow.classList.add('closing');
      chatWindow.addEventListener('animationend', () => {
        chatWindow.style.display = 'none';
        chatWindow.classList.remove('closing');
      }, { once: true });
    }

    function doCopy(btn, text) {
      navigator.clipboard?.writeText(text).catch(() => {});
      btn.classList.add('done');
      btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:9px;height:9px;fill:none;stroke:currentColor;stroke-width:2.5"><path d="M20 6L9 17l-5-5"/></svg> ok';
      setTimeout(() => {
        btn.classList.remove('done');
        btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:9px;height:9px;fill:none;stroke:currentColor;stroke-width:2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> copia';
      }, 2000);
    }

    async function speakText(text, btnElement) {
      const btn = btnElement || chatWindow.querySelector('.tts-btn');
      if (btn) btn.disabled = true;

      const avatar = document.getElementById('main-av');
      if (avatar) avatar.classList.add('speaking');

      try {
        const csrf = getCookie('csrf_token');
        const resp = await fetch(cfg.ttsEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf || ''
          },
          body: JSON.stringify({ text })
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          throw new Error('TTS failed: HTTP ' + resp.status + ' ' + errText);
        }

        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json().catch(() => ({}));
          throw new Error('TTS error: ' + (data && data.error ? data.error : 'unknown'));
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        await audio.play().catch((e) => console.error('TTS play error:', e));

        await new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        });
      } catch (error) {
        console.error('TTS error:', error.message);
      } finally {
        if (avatar) avatar.classList.remove('speaking');
        if (btn) btn.disabled = false;
      }
    }

    async function doSend() {
      const text = textIn.value.trim();
      if (!text) return;

      const row = document.createElement('div');
      row.className = 'msg msg--user';
      row.innerHTML = `<div><div class="bubble bubble--user-anim"><div class="user-text"></div><div class="ts">${now()}</div></div></div>`;
      row.querySelector('.user-text').textContent = text;
      msgBox.appendChild(row);

      const ubub = row.querySelector('.bubble--user-anim');
      ubub.style.opacity = '0';
      ubub.style.transform = 'translateX(30px) scale(0.2) rotate(8deg)';
      ubub.style.filter = 'blur(8px)';
      void ubub.offsetWidth;
      ubub.style.animation = 'bubble-explode-user 0.6s cubic-bezier(0.34,1.5,0.64,1) both';
      ubub.addEventListener('animationend', () => {
        ubub.style.animation = '';
        ubub.style.filter = '';
        ubub.style.opacity = '';
        ubub.style.transform = '';
      }, { once: true });
      textIn.value = '';

      typingRow.style.display = 'flex';
      typingAv.classList.add('typing');
      msgBox.scrollTop = msgBox.scrollHeight;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const csrf = getCookie('csrf_token');
        const response = await fetch(cfg.apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf || ''
          },
          body: JSON.stringify({ message: text }),
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Non nascondere subito l'indicatore "sta scrivendo": response.ok
        // diventa vero non appena arrivano gli header HTTP, molto prima che
        // il modello produca il primo token (guardrail/RAG/tool-calling
        // avvengono nel frattempo). La bolla di risposta va creata solo
        // quando arriva il primo chunk di testo reale, altrimenti resta
        // vuota e sembra bloccata durante quell'attesa.
        let aiRow, bub, p, citationsEl, ttsBtn, copyBtn;
        const ensureAiBubble = () => {
          if (bub) return;
          typingRow.style.display = 'none';
          typingAv.classList.remove('typing');

          aiRow = document.createElement('div');
          aiRow.className = 'msg msg--ai';
          aiRow.innerHTML = `
            <div class="mini-av">${AI_AVATAR_ICON}</div>
            <div>
              <div class="bubble-wrap">
                <button class="tts-btn" data-tts-text="" type="button">
                  <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                  🔊
                </button>
                <button class="copy-btn" data-copy-text="" type="button">
                  <svg viewBox="0 0 24 24" style="width:9px;height:9px;fill:none;stroke:currentColor;stroke-width:2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  copia
                </button>
                <div class="bubble bubble--anim" id="response-${Date.now()}"><p></p><div class="citations" style="margin-top:0.4em;font-size:0.8em;opacity:0.7"></div><div class="ts">${now()}</div></div>
              </div>
            </div>`;
          msgBox.appendChild(aiRow);

          bub = aiRow.querySelector('.bubble--anim');
          p = bub.querySelector('p');
          citationsEl = bub.querySelector('.citations');
          ttsBtn = aiRow.querySelector('.tts-btn');
          copyBtn = aiRow.querySelector('.copy-btn');

          bub.style.opacity = '0';
          bub.style.transform = 'translateX(-40px) scale(0.62) rotate(-12deg)';
          bub.style.filter = 'blur(12px)';
          void bub.offsetWidth;
          bub.style.animation = 'dom_staging 0.62s cubic-bezier(0.34,1.7,0.64,1) both';
          bub.addEventListener('animationend', () => {
            bub.style.animation = '';
            bub.style.filter = '';
            bub.style.opacity = '';
            bub.style.transform = '';
          }, { once: true });
          msgBox.scrollTop = msgBox.scrollHeight;
        };

        let accumulated = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd;
          while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            if (!frame.startsWith('data: ')) continue;

            let evt;
            try { evt = JSON.parse(frame.slice(6)); } catch { continue; }

            if (evt.type === 'chunk') {
              ensureAiBubble();
              accumulated += evt.text;
              p.textContent = accumulated;
              msgBox.scrollTop = msgBox.scrollHeight;
            } else if (evt.type === 'done') {
              ensureAiBubble();
              const finalText = evt.response || accumulated;
              const cleanText = finalText.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
              ttsBtn.dataset.ttsText = encodeURIComponent(cleanText);
              copyBtn.dataset.copyText = encodeURIComponent(cleanText);
              // markdownToHtml escapes HTML first, then reintroduces only whitelisted tags
              p.innerHTML = linkifyHtml(markdownToHtml(finalText));
              if (Array.isArray(evt.citations) && evt.citations.length) {
                citationsEl.innerHTML = 'Fonti: ' + evt.citations
                  .map((c) => `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title || c.url)}</a>`)
                  .join(' · ');
              }
              if (evt.attachment) {
                citationsEl.insertAdjacentHTML('afterend', renderAttachmentHtml(evt.attachment));
              }
              msgBox.scrollTop = msgBox.scrollHeight;
            } else if (evt.type === 'error') {
              throw new Error(evt.error || 'Errore streaming');
            }
          }
        }

        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        typingRow.style.display = 'none';
        typingAv.classList.remove('typing');

        const aiRow = document.createElement('div');
        aiRow.className = 'msg msg--ai';
        const mini = document.createElement('div');
        mini.className = 'mini-av';
        mini.innerHTML = AI_AVATAR_ICON;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const p = document.createElement('p');
        p.textContent = cfg.errorMessage;
        bubble.appendChild(p);

        const bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'bubble-wrap';
        bubbleWrap.appendChild(bubble);

        const right = document.createElement('div');
        right.appendChild(bubbleWrap);

        aiRow.appendChild(mini);
        aiRow.appendChild(right);
        msgBox.appendChild(aiRow);
        msgBox.scrollTop = msgBox.scrollHeight;
        console.error('Chat API error:', error);
      }
    }

    function checkScrollBtn() {
      const btn = document.getElementById('scroll-btn');
      if (!msgBox || !btn) return;
      const atBottom = msgBox.scrollTop + msgBox.clientHeight >= msgBox.scrollHeight - 20;
      btn.classList.toggle('visible', !atBottom);
    }

    function scrollToBottom() {
      msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
    }

    let recognition = null;
    let isListening = false;

    function toggleVoiceInput() {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('Riconoscimento vocale non supportato in questo browser');
        return;
      }

      const btn = document.getElementById('voice-btn');
      if (isListening) {
        recognition.stop();
        return;
      }

      recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'it-IT';

      recognition.onstart = () => {
        isListening = true;
        btn.style.background = '#ff4444';
      };

      recognition.onresult = (event) => {
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
        }
        if (final) textIn.value = final;
      };

      recognition.onerror = (event) => {
        console.error('Voice error:', event.error);
        isListening = false;
        btn.style.background = '';
      };

      recognition.onend = () => {
        isListening = false;
        btn.style.background = '';
      };

      recognition.start();
    }

    function triggerUpload() {
      uploadInput.click();
    }

    function readFileText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }

    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const svg = uploadInput.closest('.icon-btn')?.querySelector('svg');
      if (svg) svg.style.animation = 'spin 1s linear infinite';

      try {
        const text = await readFileText(file);
        textIn.value = text.slice(0, 2000);
      } catch (err) {
        alert('Errore lettura file: ' + err.message);
      } finally {
        if (svg) svg.style.animation = '';
      }
    });

    function chipClick(btn, text) {
      const ripple = document.createElement('span');
      ripple.className = 'chip-ripple';
      btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
      textIn.value = text;
      doSend();
    }

    container.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        switch (actionEl.dataset.action) {
          case 'toggle-chat': toggleChat(); break;
          case 'close-chat': closeChat(); break;
          case 'send': doSend(); break;
          case 'scroll-bottom': scrollToBottom(); break;
          case 'trigger-upload': triggerUpload(); break;
          case 'toggle-voice': toggleVoiceInput(); break;
          case 'toggle-avatar': if (window.toggleLiveAvatar) window.toggleLiveAvatar(); break;
        }
        return;
      }

      const chip = e.target.closest('[data-chip-text]');
      if (chip) { chipClick(chip, chip.dataset.chipText); return; }

      const ttsBtn = e.target.closest('.tts-btn');
      if (ttsBtn) {
        e.preventDefault();
        const text = decodeURIComponent(ttsBtn.dataset.ttsText || '');
        if (text) speakText(text, ttsBtn);
        return;
      }

      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        e.preventDefault();
        const text = decodeURIComponent(copyBtn.dataset.copyText || '');
        if (text) doCopy(copyBtn, text);
      }
    });

    msgBox.addEventListener('scroll', checkScrollBtn);
    textIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    // Resize handles
    (function resizeWidget() {
      const drag = (e, sx, sy, mw, mh) => {
        chatWindow.style.width = Math.max(320, mw + (e.clientX - sx)) + 'px';
        chatWindow.style.height = Math.max(380, mh + (e.clientY - sy)) + 'px';
      };
      chatWindow.querySelectorAll('.resize-handle').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sx = e.clientX, sy = e.clientY, mw = chatWindow.offsetWidth, mh = chatWindow.offsetHeight;
          const m = (ev) => drag(ev, sx, sy, mw, mh);
          const u = () => { document.removeEventListener('mousemove', m); document.removeEventListener('mouseup', u); };
          document.addEventListener('mousemove', m);
          document.addEventListener('mouseup', u);
        });
      });
    })();

    const instance = { toggleChat, closeChat, doSend };
    window.ChatbotWidget.toggleChat = toggleChat;
    window.ChatbotWidget.closeChat = closeChat;
    return instance;
  }

  window.ChatbotWidget = { init: init };
})();
