// LiveAvatar Configuration — server-side only, validates LIVEAVATAR_API_KEY on startup

const liveAvatarConfig = {
  // Core
  apiKey: process.env.LIVEAVATAR_API_KEY,
  baseUrl: 'https://app.liveavatar.com/api/v1',

  // Configurazione HeyGen Embed
  avatarId: process.env.LIVEAVATAR_AVATAR_ID || '9d569d42-b50f-4772-bf65-93834d55aaac',

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

module.exports = {
  liveAvatarConfig
};