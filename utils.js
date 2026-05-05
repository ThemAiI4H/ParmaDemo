// @ts-nocheck
// Simple utils - no regex literals for TS compatibility

function markdownToHtml(text) {
  if (typeof text !== 'string') return '';
  
  let html = text
    .replace('&', '&amp;')
    .replace('<', '<')
    .replace('>', '>')
    .replace('"', '"')
    .replace("'", '&#39;');
  
  // Basic bold/italics
  html = html.split('**').map((part, i) => i % 2 ? `<strong>${part}</strong>` : part).join('');
  html = html.split('*').map((part, i) => i % 2 ? `<em>${part}</em>` : part).join('');
  
  // Headers
  if (html.indexOf('\\n# ') >= 0) html = html.split('\\n# ').join('\\n<h3>').split('\\n')[0] + '</h3>' + html.split('\\n')[1];
  if (html.indexOf('\\n## ') >= 0) html = html.split('\\n## ').join('\\n<h4>').split('\\n')[0] + '</h4>' + html.split('\\n')[1];
  
  html = '<p>' + html.split('\\n\\n').join('</p><p>') + '</p>';
  
  return html;
}

function queryClassifier(query) {
  const lower = query.toLowerCase();
  if (lower.includes('prenot') || lower.includes('appunt')) return 'booking';
  if (lower.includes('orario') || lower.includes('apertura')) return 'hours';
  if (lower.includes('indirizzo') || lower.includes('dove') || lower.includes('ubicazione') || lower.includes('mappa')) return 'address';
  if (lower.includes('laborator') || lower.includes('analisi')) return 'lab';
  if (lower.includes('emergenza') || lower.includes('urgenza') || lower.includes('pronto')) return 'emergency';
  if (lower.includes('medico') || lower.includes('dott') || lower.includes('specialista')) return 'doctor';
  return 'general';
}

function extractPhones(text) {
  const words = text.split(/[^0-9]/);
  const phones = words.filter(w => w.length >= 9 && w.match(/^05/));
  return phones.filter(p => p.indexOf('0521') >= 0);
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2);
}

function relevanceScore(query, doc) {
  const qTokens = tokenize(query);
  const dTokens = tokenize(doc);
  const matches = [];
  for (var i = 0; i < qTokens.length; i++) {
    for (var j = 0; j < dTokens.length; j++) {
      if (qTokens[i] === dTokens[j]) {
        matches.push(qTokens[i]);
        break;
      }
    }
  }
  return matches.length / Math.max(qTokens.length, 1);
}

module.exports = {
  markdownToHtml,
  queryClassifier,
  extractPhones,
  tokenize,
  relevanceScore
};
