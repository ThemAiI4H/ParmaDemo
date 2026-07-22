'use strict';

/**
 * maps.js — Geocoding (Nominatim/OpenStreetMap, nessuna API key) e
 * costruzione dell'attachment "mappa" per il tool show_map.
 *
 * Nominatim usage policy: max ~1 richiesta/secondo, User-Agent
 * identificativo obbligatorio, niente uso massivo/commerciale — per il
 * volume di un chatbot (una richiesta occasionale per turno) resta
 * ampiamente entro i limiti previsti.
 */

const USER_AGENT = 'ParmaDemo-Chatbot/1.0 (+https://www.clinicacittadiparma.it/)';

// Nominatim è sensibile alle abbreviazioni italiane di tipo-via (es. "P.le"
// per "Piazzale") e spesso non ha il numero civico indicizzato per indirizzi
// italiani: un tentativo con l'indirizzo completo può fallire dove uno più
// semplice (solo nome via/piazza + città) riesce. Prima di arrendersi, si
// riprova con varianti progressivamente semplificate.
const STREET_PREFIX_PATTERN = /^(via|viale|piazza|piazzale|p\.?\s?le|p\.?\s?zza|corso|largo|vicolo|strada)\.?\s+/i;

async function geocodeOnce(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'it' } });
  if (!res.ok) return null;
  const results = await res.json();
  if (!Array.isArray(results) || !results.length) return null;
  const { lat, lon, display_name: displayName } = results[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon), displayName };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prova a geocodificare `query`, con un bounded retry su varianti
 * semplificate se il tentativo completo non produce risultati: rimuove
 * prima il prefisso tipo-via ("Piazzale"/"P.le"/...), poi anche numero
 * civico e CAP, tenendo solo nome via/piazza + città.
 */
async function geocode(query) {
  const attempts = [query];

  const withoutPrefix = query.replace(STREET_PREFIX_PATTERN, '');
  if (withoutPrefix !== query) attempts.push(withoutPrefix);

  const core = withoutPrefix
    .replace(/,?\s*\b\d{5}\b/g, '') // CAP
    .replace(/,\s*\d+\s*(?=,|$)/g, '') // numero civico isolato tra virgole
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (core && core !== withoutPrefix && core !== query) attempts.push(core);

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(1100); // rispetta il rate limit di ~1 richiesta/secondo di Nominatim
    const result = await geocodeOnce(attempts[i]);
    if (result) return result;
  }
  return null;
}

function buildEmbedUrl(lat, lon, deltaDeg = 0.006) {
  const left = lon - deltaDeg;
  const right = lon + deltaDeg;
  const top = lat + deltaDeg;
  const bottom = lat - deltaDeg;
  const bbox = `${left}%2C${bottom}%2C${right}%2C${top}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function buildDirectionsUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

/**
 * Geocodifica `query` e costruisce l'attachment mappa da restituire al
 * widget (stesso canale dell'attachment PDF di generate_document). Ritorna
 * null se l'indirizzo non è geocodificabile — il chiamante (tool-executor-
 * agent.js) decide il messaggio di fallback da mostrare all'utente.
 */
async function buildMapAttachment(query, label) {
  const geo = await geocode(query);
  if (!geo) return null;
  return {
    kind: 'map',
    label: label || query,
    query,
    lat: geo.lat,
    lon: geo.lon,
    displayName: geo.displayName,
    embedUrl: buildEmbedUrl(geo.lat, geo.lon),
    directionsUrl: buildDirectionsUrl(geo.lat, geo.lon)
  };
}

module.exports = { geocode, buildMapAttachment };
