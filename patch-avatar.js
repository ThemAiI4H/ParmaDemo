const fs = require('fs');
const path = '/home/generale-kenobi/Scaricati/ParmaDemo/index.html';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = `  const avatarId = '9d569d42-b50f-4772-bf65-93834d55aaac';
  const sessionId = window._liveAvatarSessionId || null;
  // URL ufficiale LiveAvatar embed
  const iframeUrl = sessionId
    ? \`https://app.liveavatar.com/embed/\${sessionId}\`
    : \`https://app.liveavatar.com/avatar/\${avatarId}/embed\`;`;

const newBlock = `  // 1. Crea sessione server-side
  const sessionId = 'liveavatar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const iframeUrl = '/api/liveavatar?sessionId=' + encodeURIComponent(sessionId);`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(path, content);
  console.log('✅ index.html patched successfully');
} else {
  console.log('⚠️ Old block not found');
}
