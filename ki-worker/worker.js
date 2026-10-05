// Cloudflare Worker: Zwischenserver für die Reise-KI auf f1nn303.github.io/toskana-2026
// Der API-Schlüssel liegt nur hier als Secret ANTHROPIC_API_KEY, nie in der Webseite.

const MODEL = 'claude-haiku-4-5';
const ALLOWED = ['https://f1nn303.github.io', 'http://localhost:8765'];
const LIMIT = { perIp: 12, windowMs: 10 * 60 * 1000 }; // 12 Fragen pro 10 Minuten und Gerät
const MAX_MSGS = 8, MAX_MSG_CHARS = 600, MAX_CTX_CHARS = 9000;

const SYSTEM = `Du bist die Reise-KI auf der Live-Seite einer Klassenfahrt (Stufenfahrt, Schülerinnen und Schüler, ca. 16–18 Jahre) von Mönchengladbach nach Montecatini Terme in der Toskana, 04.–09.10.2026.
Du beantwortest Fragen zur Fahrt (wo der Bus ist, wann wir ankommen, Tagesplan, Wetter) und vor allem zum Essen: wo es in der Nähe gutes, günstiges Essen gibt.

Regeln:
- Antworte auf Deutsch, locker aber freundlich, kurz (meist 2–6 Sätze oder eine kurze Liste). Keine Einleitungsfloskeln.
- Nutze die mitgeschickten Live-Daten (KONTEXT). Erfinde keine Öffnungszeiten, Preise, Adressen oder Ereignisse. Wenn etwas nicht in den Daten steht, sag das ehrlich und gib allgemeines Wissen nur als solches gekennzeichnet.
- Bei Essens-Empfehlungen: bevorzuge Läden aus der Liste im KONTEXT, nenne Name, Art, ungefähren Preis und Fußweg. „Unser Tipp“-Einträge sind geprüft. Achte auf "offen" und auf die Zeit bis zum nächsten Programmpunkt.
- Zeiten gelten in deutscher/italienischer Zeit (gleich). Was Lehrer oder Busfahrer entscheiden, kannst du nicht wissen: verweise dann auf sie.
- Keine Empfehlungen zu Alkohol, Rauchen oder Regelverstößen. Bei Notfällen: Begleitpersonen informieren, Notruf in Italien 112.
- Du kannst keine Links öffnen, nichts buchen und nichts bestellen.`;

const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < LIMIT.windowMs);
  if (arr.length >= LIMIT.perIp) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'Nicht erlaubt' }, 403, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Der Server ist noch nicht eingerichtet.' }, 500, origin);

    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (limited(ip)) return json({ error: 'Kurz Pause: höchstens 12 Fragen in 10 Minuten. Gleich geht es weiter.' }, 429, origin);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400, origin); }
    const msgs = (Array.isArray(body.messages) ? body.messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_MSGS)
      .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'Keine Frage' }, 400, origin);
    const ctx = typeof body.context === 'string' ? body.context.slice(0, MAX_CTX_CHARS) : '';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: 'KONTEXT (Live-Daten der Seite, Stand jetzt):\n' + ctx }],
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
  },
};
