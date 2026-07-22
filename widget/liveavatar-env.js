// LiveAvatar Client Config - ENHANCED (Step 4/5) - Cookie-safe iframe
(function() {
  'use strict';
  
  // Import server config (for iframe attrs)
  const config = window.LIVEAVATAR_CONFIG || {};
  
  window.LIVEAVATAR_CONFIG = {
    // Secure proxy (no apiKey client-side)
    proxy: true,
    baseUrl: '/api/liveavatar',
    
    // Full secure iframe attributes (fixes cookie warnings)
    getIframeAttrs: function(sessionId) {
      const attrs = {
        src: `${this.baseUrl}?sessionId=${sessionId}`,
        title: 'LiveAvatar Assistant',
        width: '100%',
        height: '100%',
        loading: 'lazy',
        allow: 'microphone; camera; display-capture; autoplay; encrypted-media; clipboard-write',
        sandbox: 'allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation',
        scrolling: 'no',
        style: 'border: none; border-radius: 8px; background: transparent;',
        // Cookie + security fixes
        referrerpolicy: 'no-referrer-when-downgrade',
        'crossorigin': 'anonymous'
      };
      return attrs;
    },
    
    // Session pre-creation (call before iframe load)
    createSession: async function() {
      const sessionId = `liveavatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const getApiBasePath = () => {
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/demo/')) {
          return '/demo/api';
        }
        return '/api';
      };
      const API_BASE = getApiBasePath();
      try {
        const resp = await fetch(API_BASE + '/liveavatar/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await resp.json();
        if (data.success) {
          console.log('✅ LiveAvatar session ready:', sessionId);
          return data.sessionId;
        }
      } catch (err) {
        console.warn('Session creation failed:', err);
      }
      return sessionId; // fallback
    }
  };
  
  console.log('✅ LiveAvatar ENHANCED config - Cookie-safe + session proxy');
})();



