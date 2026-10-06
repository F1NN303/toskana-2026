// Cloudflare Worker für f1nn303.github.io/toskana-2026
//  POST /        Reise-KI (Claude Haiku), Schlüssel als Secret ANTHROPIC_API_KEY
//  GET  /place   Foto und Bewertung eines Lokals von Google (Places API New), Schlüssel als Secret GOOGLE_PLACES_KEY
// Die Schlüssel liegen nur hier, nie in der Webseite.

const MODEL = 'claude-haiku-4-5';
const ALLOWED = ['https://f1nn303.github.io', 'http://localhost:8765'];
const MAX_MSGS = 8, MAX_MSG_CHARS = 600, MAX_CTX_CHARS = 9000;
const PLACE_TTL = 12 * 3600; // Sekunden, kurzzeitig zwischenspeichern, damit nicht jedes Handy neu fragt

const SYSTEM = `Du bist die Reise-KI auf der Live-Seite einer Klassenfahrt (Stufenfahrt, Schülerinnen und Schüler, ca. 16–18 Jahre) von Mönchengladbach nach Montecatini Terme in der Toskana, 04.–09.10.2026.
Du beantwortest Fragen zur Fahrt (wo der Bus ist, wann wir ankommen, Tagesplan, Wetter) und vor allem zum Essen: wo es in der Nähe gutes, günstiges Essen gibt.

Regeln:
- Antworte auf Deutsch, locker aber freundlich, kurz (meist 2–6 Sätze oder eine kurze Liste). Keine Einleitungsfloskeln.
- Nutze die mitgeschickten Live-Daten (KONTEXT). Erfinde keine Öffnungszeiten, Preise, Adressen oder Ereignisse. Wenn etwas nicht in den Daten steht, sag das ehrlich und gib allgemeines Wissen nur als solches gekennzeichnet.
- Bei Essens-Empfehlungen: bevorzuge Läden aus der Liste im KONTEXT, nenne Name, Art, ungefähren Preis und Fußweg. Einträge mit UNSER TIPP sind geprüft. Google-Bewertungen stehen dabei, wenn bekannt. Achte auf offen/geschlossen und auf die Zeit bis zum nächsten Programmpunkt.
- Zeiten gelten in deutscher/italienischer Zeit (gleich). Was Lehrer oder Busfahrer entscheiden, kannst du nicht wissen: verweise dann auf sie.
- Keine Empfehlungen zu Alkohol, Rauchen oder Regelverstößen. Bei Notfällen: Begleitpersonen informieren, Notruf in Italien 112.
- Du kannst keine Links öffnen, nichts buchen und nichts bestellen.`;

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function json(obj, status, origin, extra) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...(extra || {}) } });
}
function km(a, b, c, d) { const k = Math.cos((a + c) / 2 * Math.PI / 180); return Math.hypot((d - b) * 111.32 * k, (c - a) * 110.57); }

async function place(url, env, origin, ctx) {
  if (!env.GOOGLE_PLACES_KEY) return json({ error: 'off' }, 503, origin);
  const q = (url.searchParams.get('q') || '').slice(0, 120), lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon');
  if (!q || !isFinite(lat) || !isFinite(lon)) return json({ error: 'Ungültig' }, 400, origin);
  // Nur Toskana und Strecke (grob), damit der Worker nicht als freier Google-Zugang taugt
  if (lat < 43 || lat > 51.6 || lon < 5.5 || lon > 12.5) return json({ error: 'Außerhalb' }, 400, origin);
  const cacheKey = new Request('https://cache.toskana/place?q=' + encodeURIComponent(q) + '&p=' + lat.toFixed(4) + ',' + lon.toFixed(4));
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) { const b = await hit.text(); return new Response(b, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), 'X-Cache': 'HIT' } }); }

  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'places.id,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.photos' },
    body: JSON.stringify({ textQuery: q, maxResultCount: 1, languageCode: 'de', locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 250 } } }),
  });
  if (!r.ok) return json({ error: 'google ' + r.status }, 502, origin);
  const j = await r.json(), p = (j.places || [])[0];
  let out = { found: false };
  if (p && p.location && km(lat, lon, p.location.latitude, p.location.longitude) < 0.35) {
    out = { found: true, rating: p.rating || null, count: p.userRatingCount || 0, maps: p.googleMapsUri || null, photo: null, by: null, byUrl: null };
    const ph = (p.photos || [])[0];
    if (ph && ph.name) {
      const m = await fetch('https://places.googleapis.com/v1/' + ph.name + '/media?maxWidthPx=480&skipHttpRedirect=true&key=' + env.GOOGLE_PLACES_KEY);
      if (m.ok) { const mj = await m.json(); out.photo = mj.photoUri || null; }
      const a = (ph.authorAttributions || [])[0];
      if (a) { out.by = a.displayName || null; out.byUrl = a.uri || null; }
    }
  }
  const body = JSON.stringify(out);
  ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + PLACE_TTL } })));
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), 'X-Cache': 'MISS' } });
}

async function chat(req, env, origin) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Der Server ist noch nicht eingerichtet.' }, 500, origin);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400, origin); }
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MSGS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'Keine Frage' }, 400, origin);
  const ctxText = typeof body.context === 'string' ? body.context.slice(0, MAX_CTX_CHARS) : '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: 'KONTEXT (Live-Daten der Seite, Stand jetzt):\n' + ctxText }],
      messages: msgs,
    }),
  });
  if (!r.ok) {
    const status = r.status === 429 || r.status === 529 ? 503 : 502;
    return json({ error: status === 503 ? 'Die KI ist gerade überlastet. Versuch es gleich nochmal.' : 'Die KI hat gerade nicht geantwortet.' }, status, origin);
  }
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return json({ text: text || 'Dazu habe ich gerade keine Antwort.' }, 200, origin);
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!ALLOWED.includes(origin)) return json({ error: 'Nicht erlaubt' }, 403, origin);
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (req.method === 'GET' && url.pathname === '/place') {
      if (limited('p' + ip, 80, 10 * 60 * 1000)) return json({ error: 'Zu viele Anfragen' }, 429, origin);
      return place(url, env, origin, ctx);
    }
    if (req.method === 'POST' && url.pathname === '/') {
      if (limited('c' + ip, 12, 10 * 60 * 1000)) return json({ error: 'Kurz Pause: höchstens 12 Fragen in 10 Minuten. Gleich geht es weiter.' }, 429, origin);
      return chat(req, env, origin);
    }
    return json({ error: 'Nicht gefunden' }, 404, origin);
  },
};
