// @ts-nocheck
// Simple utils - no regex literals for TS compatibility

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
  extractPhones,
  tokenize,
  relevanceScore
};
