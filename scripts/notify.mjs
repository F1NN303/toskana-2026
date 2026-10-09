// Läuft bei jeder neuen Position (GitHub Actions, Branch "live").
// Prüft, ob etwas Wichtiges passiert ist, und schickt dann eine Nachricht über ntfy.
// Merkt sich in state.json, was schon gemeldet wurde, und speichert die gefahrene Spur in track.json.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || '.';
const TOPIC = process.env.NTFY_TOPIC || '';
const DRY = process.env.DRY === '1';
const NOW = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();
const PAGE = 'https://f1nn303.github.io/toskana-2026/';
const UA = 'toskana-2026-bus-tracker (https://github.com/F1NN303/toskana-2026)';
const OFFLINE = process.env.OFFLINE === '1'; // Tests ohne Netz
const TOMTOM_KEY = process.env.TOMTOM_KEY || ''; // Live-Verkehr für die Prognose (Secret, optional)
// Web-Push: Handys melden sich über einen ntfy-Briefkasten an, wir schicken mit unserem VAPID-Schlüssel
const SUBS_TOPIC = process.env.SUBS_TOPIC || '';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '';
let webpush = null;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(PAGE, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) { console.log('web-push nicht verfügbar:', String(e)); webpush = null; }
}

const TRIPS = {
  hin: { from: Date.parse('2026-10-04T21:00:00+02:00'), to: Date.parse('2026-10-05T20:00:00+02:00'), dest: [43.88563, 10.77852], near: 0.4 },
  rueck: { from: Date.parse('2026-10-09T04:00:00+02:00'), to: Date.parse('2026-10-10T06:00:00+02:00'), dest: [51.2, 6.45], near: 8 },
};

// Bekannte Wege (grob), um Umleitungen zu erkennen
const ROUTES = [
  [[51.19, 6.44], [50.36, 7.59], [49.48, 8.47], [49.01, 8.40], [47.99, 7.84], [47.56, 7.59], [47.05, 8.31], [46.67, 8.59], [46.53, 8.61], [46.19, 9.02], [46.00, 8.95], [45.83, 9.03], [45.46, 9.19], [45.05, 9.69], [44.80, 10.33], [44.10, 9.82], [43.87, 10.25], [43.84, 10.50], [43.88, 10.77]],
  [[44.80, 10.33], [44.49, 11.34], [43.77, 11.25], [43.88, 10.77]],
  [[47.56, 7.59], [47.38, 8.54], [46.85, 9.53], [46.46, 9.19], [46.19, 9.02]],
];

const CH_POLY = [[47.59, 7.59], [47.56, 8.2], [47.65, 8.6], [47.65, 9.0], [47.6, 9.5], [47.5, 9.7], [47.05, 9.6], [46.9, 10.1], [46.85, 10.45], [46.6, 10.2], [46.35, 10.05], [46.4, 9.6], [46.45, 9.3], [46.05, 9.1], [45.82, 9.03], [45.93, 8.9], [46.0, 8.7], [46.1, 8.5], [46.45, 8.4], [46.4, 8.1], [46.1, 7.9], [45.92, 7.04], [46.2, 6.85], [46.15, 6.25], [46.4, 6.1], [46.95, 6.45], [47.45, 7.0], [47.5, 7.5], [47.59, 7.59]];
const AT_POLY = [[47.5, 9.7], [47.55, 10.4], [47.4, 10.9], [47.55, 11.6], [47.7, 12.2], [47.75, 13.0], [46.6, 13.0], [46.75, 12.1], [47.0, 11.5], [46.75, 11.0], [46.85, 10.45], [46.9, 10.1], [47.05, 9.6]];

const TUNNELS = {
  hin: [[46.666, 8.587, 'gotthard'], [46.522, 9.18, 'sanbernardino']],
  rueck: [[46.528, 8.611, 'gotthard'], [46.463, 9.186, 'sanbernardino']],
};

// Pflicht-Halte (Maut, Grenze): dort ist ein Halt keine Pause und kein Stau. An Grenzen ab 20 Min doch Pause (Raststätten daneben).
const CHECKPTS = [['toll', 'Mautstelle Montecatini', 43.8772, 10.7926], ['toll', 'Mautstelle Milano Sud', 45.3494, 9.31], ['toll', 'Mautstelle Milano Nord', 45.5485, 9.06], ['toll', 'Mautstelle Como Grandate', 45.774, 9.049], ['border', 'Grenze Chiasso-Brogeda', 45.8405, 9.0373], ['border', 'Grenze Weil am Rhein', 47.5964, 7.6035]];

// ---------- Hilfen ----------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
const toMs = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));
const r5 = (x) => Math.round(x * 1e5) / 1e5;
function km(a, b) {
  const k = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  const dx = (b[1] - a[1]) * 111.32 * k, dy = (b[0] - a[0]) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}
function distToLine(p, line) {
  const k = Math.cos(p[0] * Math.PI / 180);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][1] - p[1]) * 111.32 * k, ay = (line[i][0] - p[0]) * 110.57;
    const bx = (line[i + 1][1] - p[1]) * 111.32 * k, by = (line[i + 1][0] - p[0]) * 110.57;
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + vx * t, ay + vy * t));
  }
  return best;
}
function inPoly(lat, lon, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function countryAt(lat, lon) {
  if (inPoly(lat, lon, CH_POLY)) return 'CH';
  if (inPoly(lat, lon, AT_POLY)) return 'AT';
  if (lat < 46.6 || (lat < 47.1 && lon > 10.4)) return 'IT';
  return 'DE';
}
async function getJSON(url, opts = {}) {
  if (OFFLINE) return null;
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Echter Straßenverlauf (routes_geo.json neben dem Skript-Ordner), für Vorwarnungen in Deutschland
let GEO = null;
try { GEO = JSON.parse(fs.readFileSync(new URL('../routes_geo.json', import.meta.url), 'utf8')); } catch { GEO = null; }
function alongLine(line, p) {
  const k = Math.cos(p[0] * Math.PI / 180);
  let best = Infinity, at = 0, acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const ax = (a[1] - p[1]) * 111.32 * k, ay = (a[0] - p[0]) * 110.57, bx = (b[1] - p[1]) * 111.32 * k, by = (b[0] - p[0]) * 110.57;
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L)) : 0;
    const seg = Math.sqrt(L), d = Math.hypot(ax + vx * t, ay + vy * t);
    if (d < best) { best = d; at = acc + t * seg; }
    acc += seg;
  }
  return { at, d: best };
}
const KIND = { STATIONARY_TRAFFIC: 'Stau', QUEUING_TRAFFIC: 'Stockender Verkehr', SLOW_TRAFFIC: 'Zähfließender Verkehr' };
// Staus und Sperrungen auf unserer deutschen Strecke in Fahrtrichtung, mit Abstand in km
async function deIncidents(phase, here) {
  if (!GEO || OFFLINE) return [];
  const line = phase === 'hin' ? GEO.north : GEO.north.slice().reverse();
  const me = alongLine(line, here);
  if (me.d > 5) return [];
  const out = [];
  for (const road of ['A61', 'A6', 'A5']) {
    for (const kind of ['warning', 'closure']) {
      const j = await getJSON(`https://verkehr.autobahn.de/o/autobahn/${road}/services/${kind}`);
      for (const it of (j && (j.warning || j.closure)) || []) {
        const g = it.geometry && it.geometry.coordinates;
        if (!Array.isArray(g) || g.length < 2) continue;
        const a0 = alongLine(line, [g[0][1], g[0][0]]), a1 = alongLine(line, [g[g.length - 1][1], g[g.length - 1][0]]);
        if (a0.d > 1.5 || a1.d > 1.5) continue;           // nicht auf unserer Strecke
        if (a1.at < a0.at - 0.2) continue;                  // Gegenrichtung
        if (it.future === true || it.future === 'true') continue;          // beginnt erst später
        const txt = `${it.title || ''} ${it.subtitle || ''}`;
        // Sperrungen nur, wenn die Hauptfahrbahn betroffen ist (nicht Auffahrten, Rampen, Anschlussstellen)
        if (kind === 'closure' && (/anschlussstelle|rampe|knotenpunkt|auffahrt|abfahrt|\bAS\b|\bAK\b|\bAD\b|aus richtung|rampenprogramm/i.test(txt) || !/->/.test(it.subtitle || ''))) continue;
        const label = kind === 'closure' || it.isBlocked === 'true' || it.isBlocked === true ? 'Sperrung' : (KIND[it.abnormalTrafficType] || 'Verkehrsmeldung');
        if (label === 'Verkehrsmeldung') continue;
        if (out.some((o) => o.title === String(it.title || '').split('|').pop().trim())) continue;
        out.push({ id: it.identifier || (road + it.title), road, label, title: String(it.title || '').split('|').pop().trim(), ahead: Math.min(a0.at, a1.at) - me.at, len: Math.abs(a1.at - a0.at) });
      }
    }
  }
  return out.sort((a, b) => a.ahead - b.ahead);
}

async function placeName(lat, lon) {
  const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat}&lon=${lon}`);
  const a = j && j.address;
  return a ? (a.city || a.town || a.village || a.municipality || a.county || '') : '';
}
// Raststätte, Rastplatz oder Tankstelle in der Nähe? null = nichts gefunden, undefined = Abfrage fehlgeschlagen
// Eigene Raststätten-Liste (pois.json neben dem Skript-Ordner): schnell und auch dann da, wenn OpenStreetMap überlastet ist
let LOCAL_POIS = [];
try { LOCAL_POIS = JSON.parse(fs.readFileSync(new URL('../pois.json', import.meta.url), 'utf8')); } catch { LOCAL_POIS = []; }
function localStop(lat, lon) {
  let best = null;
  for (const o of LOCAL_POIS) {
    const d = km([lat, lon], [o.lat, o.lon]);
    if (d < 0.8 && (!best || d < best.d)) best = { kind: o.k === 's' ? 'Raststätte' : 'Rastplatz', name: o.n || '', d, rank: o.k === 's' ? 0 : 2 };
  }
  return best;
}
async function restStop(lat, lon) {
  const local = localStop(lat, lon);
  if (local) return local;
  const q = `[out:json][timeout:20];(nwr(around:700,${lat},${lon})["highway"~"^(services|rest_area)$"];nwr(around:300,${lat},${lon})["amenity"="fuel"];);out center tags;`;
  const j = await getJSON('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q),
  });
  if (!j) return undefined;
  let best = null, fuelName = '';
  for (const el of j.elements || []) {
    const y = el.lat ?? el.center?.lat, x = el.lon ?? el.center?.lon;
    if (y == null) continue;
    const t = el.tags || {};
    const kind = t.highway === 'services' ? 'Raststätte' : t.highway === 'rest_area' ? 'Rastplatz' : 'Tankstelle';
    const name = t.name || t.brand || t.operator || '';
    if (kind === 'Tankstelle' && name && !fuelName) fuelName = name;
    const c = { kind, name, d: km([lat, lon], [y, x]), rank: kind === 'Raststätte' ? 0 : kind === 'Tankstelle' ? 1 : 2 };
    if (!best || c.rank < best.rank || (c.rank === best.rank && c.d < best.d)) best = c;
  }
  if (best && !best.name && fuelName) best.name = fuelName;
  return best;
}
const stopLabel = (p) => (/rast|area|autogrill|services|aire|tankstelle|stazione/i.test(p.name) ? p.name : p.kind + (p.name ? ' ' + p.name : ''));

async function pushTo(endpointKey, sub, n) {
  if (!webpush) return true;
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title: n.title, body: n.message, url: PAGE, tag: n.tag || '' }), { TTL: 6 * 3600, urgency: n.priority >= 4 ? 'high' : 'normal' });
    return true;
  } catch (e) {
    const code = e && e.statusCode;
    console.log('Push Fehler', code || String(e));
    // 404/410: Handy hat sich abgemeldet oder die App wurde gelöscht
    return !(code === 404 || code === 410);
  }
}
async function send(n) {
  if (DRY) { console.log('[Nachricht]', n.title, '|', n.message); return; }
  // Optional zusätzlich an ein ntfy-Thema (nur wenn NTFY_TOPIC gesetzt ist)
  if (TOPIC) {
    const body = { topic: TOPIC, title: n.title, message: n.message, tags: n.tags || [], priority: n.priority || 3, click: PAGE };
    try {
      const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      console.log('ntfy', r.status, n.title);
    } catch (e) { console.log('ntfy Fehler', String(e)); }
  }
  let ok = 0;
  for (const [key, sub] of Object.entries(subs)) {
    if (await pushTo(key, sub, n)) ok++; else { delete subs[key]; }
  }
  if (Object.keys(subs).length || ok) console.log('Push an', ok, 'Handys:', n.title);
}

// Neue An- und Abmeldungen aus dem ntfy-Briefkasten holen
async function harvestSubs(st) {
  if (!SUBS_TOPIC || OFFLINE) return [];
  // Zeitstempel statt Nachrichten-ID: ntfy löscht alte Nachrichten nach 12 Stunden.
  // Doppelte Anmeldungen schaden nicht, sie überschreiben sich.
  const since = st.subsSince ? String(st.subsSince) : '24h';
  let text = '';
  try {
    const r = await fetch(`https://ntfy.sh/${SUBS_TOPIC}/json?poll=1&since=${encodeURIComponent(since)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    text = await r.text();
  } catch { return []; }
  const added = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.event !== 'message') continue;
    if (m.time && (!st.subsSince || m.time > st.subsSince)) st.subsSince = m.time;
    let d; try { d = JSON.parse(m.message); } catch { continue; }
    const sub = d && d.sub;
    if (d.type === 'sub' && sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.keys && sub.keys.p256dh && sub.keys.auth) {
      const isNew = !subs[sub.endpoint];
      subs[sub.endpoint] = { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
      if (isNew) added.push(sub.endpoint);
    } else if (d.type === 'unsub' && typeof d.endpoint === 'string') {
      delete subs[d.endpoint];
    }
  }
  return added;
}

const BORDER = {
  hin: {
    CH: ['Willkommen in der Schweiz', 'Die Schweiz ist nicht in der EU: Mobile Daten aus, wenn dein Handytarif die Schweiz nicht enthält.'],
    AT: ['Willkommen in Österreich', 'Wir fahren über den Brenner Richtung Italien. EU-Roaming gilt wie zu Hause.'],
    IT: ['Willkommen in Italien', 'Ab jetzt gilt wieder EU-Roaming wie zu Hause.'],
  },
  rueck: {
    CH: ['Wir sind in der Schweiz', 'Die Schweiz ist nicht in der EU: Mobile Daten aus, wenn dein Handytarif die Schweiz nicht enthält.'],
    AT: ['Wir sind in Österreich', 'EU-Roaming gilt wie zu Hause.'],
    DE: ['Zurück in Deutschland', 'Jetzt ist es nicht mehr weit bis Mönchengladbach.'],
  },
};

// ---------- Hauptteil ----------
const pos = readJSON('pos.json', {});
const st = readJSON('state.json', {});
let track = readJSON('track.json', []);
const subs = readJSON('subs.json', {});
// Einmalig: die falschen "Stockender Verkehr"-Einträge direkt nach den Pausen (vor der Korrektur um 07:45) entfernen
if (!st.cleanedSlow1 && Array.isArray(st.log)) {
  st.log = st.log.filter((e) => !(e.kind === 'slow' && e.t < Date.parse('2026-10-05T07:45:00+02:00')));
  st.cleanedSlow1 = true;
}
// Einmalig: zu frühe Ankunft (Radius war 2,5 km um einen ungenauen Punkt) zurücksetzen, damit die echte Ankunft erkannt wird
if (!st.arrFix1) {
  if (st.hin && st.hin.arrived) delete st.hin.arrived;
  st.arrFix1 = true;
}
const before = JSON.stringify([st, track, subs]);
const out = [];

// 0) Neue Anmeldungen: kurze Bestätigung an genau dieses Handy
const added = await harvestSubs(st);
for (const key of added) {
  if (DRY) { console.log('[Willkommen]', key.slice(0, 40)); continue; }
  const ok = await pushTo(key, subs[key], { title: 'Du bist angemeldet', message: 'Ab jetzt bekommst du Nachrichten zur Fahrt: Abfahrt, Grenzen, Pausen, Stau und Ankunft.', tag: 'welcome' });
  if (!ok) delete subs[key];
}
if (added.length) console.log('Neue Anmeldungen:', added.length, 'insgesamt:', Object.keys(subs).length);

// 1) Nachricht aus dem Bus weiterleiten
const msgAt = toMs(pos.msgAt);
if (msgAt && msgAt > (st.msgAt || 0)) {
  if (pos.msg && NOW - msgAt < 30 * 60000) out.push({ title: 'Nachricht aus dem Bus', message: String(pos.msg).slice(0, 300), tags: ['loudspeaker'], priority: 4 });
  st.msgAt = msgAt;
}

const lat = +pos.lat, lon = +pos.lon, t = toMs(pos.t);
const valid = Number.isFinite(lat) && Number.isFinite(lon) && t && NOW - t < 20 * 60000 && !(lat === 0 && lon === 0);
const phase = valid ? Object.keys(TRIPS).find((k) => t >= TRIPS[k].from && t <= TRIPS[k].to) : null;

if (phase) {
  const trip = TRIPS[phase];
  const ps = (st[phase] ||= { seen: {} });
  ps.seen ||= {};
  const here = [lat, lon];

  // Spur: nur während der Fahrt, etwa alle 4 Minuten oder nach 3 km
  const last = track[track.length - 1];
  if (!last || (t > last[2] && (t - last[2] >= (km(last, here) < 3 ? 2 : 4) * 60000 || km(last, here) > 3))) track.push([r5(lat), r5(lon), t]);
  if (track.length > 600) track = track.slice(-600);
  const ptrack = track.filter((q) => q[2] >= trip.from && q[2] <= trip.to);
  const first = ptrack[0];
  const moving = !pos.stopped;

  // 2) Abfahrt: mehr als 3 km vom Startpunkt entfernt
  if (!ps.departed && first && km(first, here) > 3) {
    ps.departed = t;
    out.push(phase === 'hin'
      ? { title: 'Wir sind losgefahren!', message: 'Der Bus ist unterwegs in die Toskana. Geplante Ankunft in Montecatini gegen 14 Uhr.', tags: ['bus'] }
      : { title: 'Heimfahrt gestartet', message: 'Der Bus ist unterwegs nach Mönchengladbach. Geplante Ankunft an der Schule gegen 23:30 Uhr.', tags: ['bus'] });
  }
  const underway = ps.departed && !ps.arrived;

  // 3) Grenzen (jedes Land nur einmal pro Fahrt)
  const country = countryAt(lat, lon);
  if (underway && ps.country && country !== ps.country && !ps.seen[country] && BORDER[phase][country]) {
    const [title, message] = BORDER[phase][country];
    out.push({ title, message, tags: ['world_map'] });
  }
  if (underway) ps.seen[country] = true;
  ps.country = country;

  // 4) Tunnel kurz vor der Einfahrt
  for (const [la, lo, id] of TUNNELS[phase]) {
    if (underway && !ps['tun_' + id] && km([la, lo], here) < 5) {
      ps['tun_' + id] = t;
      out.push(id === 'gotthard'
        ? { title: 'Gleich: Gotthard-Tunnel', message: '16,9 km lang, etwa 15 Minuten. Im Tunnel gibt es kaum Handyempfang.', tags: ['mountain'] }
        : { title: 'Gleich: San-Bernardino-Tunnel', message: '6,6 km lang, ein paar Minuten ohne Handyempfang.', tags: ['mountain'] });
    }
  }

  // 4b) Vorwarnung: Stau oder Sperrung bis 60 km voraus (alle 5 Minuten prüfen, jede Meldung nur einmal)
  let incidents = null;
  const getIncidents = async () => (incidents ??= underway && country === 'DE' ? await deIncidents(phase, here) : []);
  if (underway && country === 'DE' && (!ps.trafficAt || t - ps.trafficAt >= 5 * 60000)) {
    ps.trafficAt = t;
    ps.alerted ||= {};
    for (const it of await getIncidents()) {
      if (it.ahead < 2 || it.ahead > 60 || ps.alerted[it.id]) continue;
      ps.alerted[it.id] = t;
      out.push({ title: `${it.label} voraus`, message: `In ca. ${Math.round(it.ahead)} km: ${it.label} auf der ${it.road} (${it.title})${it.len > 0.5 ? ', ca. ' + Math.round(it.len) + ' km lang' : ''}. Kann zu Verspätung führen.`, tags: ['warning'], priority: 4 });
    }
  }
  // Passende offizielle Meldung direkt vor uns (Grund für Stau oder langsames Fahren)
  const reasonHere = async () => { const r = (await getIncidents()).find((x) => x.ahead > -3 && x.ahead < 8); return r ? ` Laut Autobahn GmbH: ${r.label} (${r.title}).` : ''; };

  // 5) Pause oder Stau
  const since = toMs(pos.stoppedSince);
  if (underway && pos.stopped && since) {
    const mins = (t - since) / 60000;
    const cp = CHECKPTS.find((c) => km([lat, lon], [c[2], c[3]]) < (c[0] === 'toll' ? 0.5 : 0.6));
    if (cp && (cp[0] === 'toll' || mins < 20)) {
      // Maut oder Grenzkontrolle: nur bei langem Warten melden, ohne es Pause oder Stau zu nennen
      if (ps.stopFor !== since && mins >= 12) {
        ps.stopFor = since; ps.stopKind = 'check';
        out.push({ title: cp[0] === 'toll' ? 'Wartezeit an der Maut' : 'Wartezeit an der Grenze', message: `Der Bus wartet seit ${Math.round(mins)} Minuten an der ${cp[1]}.`, tags: ['hourglass'] });
      }
    } else if (ps.stopFor !== since && mins >= 10) {
      let poi = ps.poiFor === since ? ps.poi : undefined;
      if (poi === undefined) { poi = await restStop(lat, lon); if (poi !== undefined) { ps.poiFor = since; ps.poi = poi; } }
      if (poi && mins >= 15) {
        ps.stopFor = since; ps.stopKind = 'pause';
        out.push({ kind: 'pause', title: 'Pause', message: `Wir machen Pause: ${stopLabel(poi)}.`, tags: ['coffee'] });
      } else if (poi === null) {
        ps.stopFor = since; ps.stopKind = 'jam';
        const pl = await placeName(lat, lon);
        out.push({ kind: 'jam', title: 'Stau', message: `Der Bus steht seit ${Math.round(mins)} Minuten${pl ? ' bei ' + pl : ''}. Keine Raststätte in der Nähe, vermutlich Stau.${await reasonHere()}`, tags: ['warning'], priority: 4 });
      }
    }
  } else if (underway && moving && ps.stopFor && ps.resumedFor !== ps.stopFor) {
    ps.resumedFor = ps.stopFor;
    ps.resumedAt = t;
    out.push(ps.stopKind === 'jam' || ps.stopKind === 'check'
      ? { title: 'Es geht weiter', message: 'Der Bus fährt wieder.', tags: ['bus'] }
      : { title: 'Weiter geht’s', message: 'Die Pause ist vorbei, der Bus fährt weiter.', tags: ['bus'] });
  }

  // 6) Stockender Verkehr: in den letzten 12 Minuten im Schnitt unter 35 km/h, ohne anzuhalten
  const recent = ptrack.filter((q) => t - q[2] <= 12 * 60000);
  // kein Halt im Fenster: jeder Abschnitt hat sich bewegt, und die letzte Pause liegt mindestens 15 Minuten zurück
  const allMoving = recent.every((q, i) => i === 0 || km(recent[i - 1], q) > 0.05); // Kriechen im Stau zählt, Stehen an der Raststätte nicht
  const sinceStop = Math.min(ps.resumedAt ? t - ps.resumedAt : Infinity, pos.stoppedSince ? t - toMs(pos.stoppedSince) : Infinity);
  if (underway && moving && recent.length >= 3 && allMoving && sinceStop > 15 * 60000) {
    const a = recent[0], b = recent[recent.length - 1], dt = (b[2] - a[2]) / 3600000;
    const avg = dt >= 0.15 ? km(a, b) / dt : null;
    if (avg !== null && avg < 35 && (!ps.slowAt || t - ps.slowAt > 45 * 60000)) {
      ps.slowAt = t;
      const pl = await placeName(lat, lon);
      out.push({ kind: 'slow', title: 'Stockender Verkehr', message: `Der Bus kommt gerade nur langsam voran (ca. ${Math.round(avg)} km/h)${pl ? ' bei ' + pl : ''}.${await reasonHere()}`, tags: ['warning'] });
    }
  }

  // 7) Umleitung: weiter als 40 km von allen bekannten Wegen entfernt
  const off = Math.min(...ROUTES.map((r) => distToLine(here, r)));
  if (underway && off > 40 && (!ps.offAt || t - ps.offAt > 2 * 3600000)) {
    ps.offAt = t;
    const pl = await placeName(lat, lon);
    out.push({ kind: 'detour', title: 'Umleitung', message: `Der Bus fährt gerade eine andere Strecke${pl ? ', aktuell bei ' + pl : ''}. Auf der Seite siehst du die echte Position.`, tags: ['twisted_rightwards_arrows'] });
  }

  // 8) Ankunft
  if (ps.departed && !ps.arrived && km(trip.dest, here) < trip.near) {
    ps.arrived = t;
    out.push(phase === 'hin'
      ? { title: 'Angekommen!', message: 'Wir sind in Montecatini Terme angekommen.', tags: ['tada'] }
      : { title: 'Gleich da!', message: 'Wir sind in Mönchengladbach und gleich an der Schule.', tags: ['tada'], priority: 4 });
  }
}

// Live-Verkehr auf der ganzen Reststrecke (IT, CH, DE) von TomTom: nur die Stau-Verzögerung wird gebraucht,
// die Fahrzeit des Busses selbst schätzt die Seite aus der Hinfahrt. Höchstens alle 4 Minuten abfragen.
if (phase === 'rueck' && TOMTOM_KEY && !OFFLINE) {
  const ps = st.rueck ||= { seen: {} };
  if (!ps.arrived && (!ps.tt || NOW - ps.tt.at >= 4 * 60000)) {
    const [dla, dlo] = TRIPS.rueck.dest;
    const u = `https://api.tomtom.com/routing/1/calculateRoute/${lat.toFixed(5)},${lon.toFixed(5)}:${dla},${dlo}/json?traffic=true&travelMode=bus&vehicleMaxSpeed=100&computeTravelTimeFor=all&routeType=fastest&key=${encodeURIComponent(TOMTOM_KEY)}`;
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      const j = r.ok ? await r.json() : null;
      const sm = j && j.routes && j.routes[0] && j.routes[0].summary;
      if (sm) {
        // Strecke ab Bus bis Ziel, auf ca. alle 2,5 km ausgedünnt (für die Karte, wenn der Bus von der Planroute abweicht)
        const geo = [];
        for (const leg of j.routes[0].legs || []) for (const q of leg.points || []) {
          const pt = [Math.round(q.latitude * 1e4) / 1e4, Math.round(q.longitude * 1e4) / 1e4];
          if (!geo.length || km(geo[geo.length - 1], pt) >= 2.5) geo.push(pt);
        }
        const lp = (j.routes[0].legs || []).at(-1)?.points?.at(-1);
        if (lp) geo.push([Math.round(lp.latitude * 1e4) / 1e4, Math.round(lp.longitude * 1e4) / 1e4]);
        ps.tt = { at: NOW, gt: t, lat: r5(lat), lon: r5(lon), km: Math.round(sm.lengthInMeters / 100) / 10, sec: sm.travelTimeInSeconds, free: sm.noTrafficTravelTimeInSeconds ?? null, delay: sm.trafficDelayInSeconds || 0, geo };
        console.log('TomTom:', ps.tt.km, 'km, Verzögerung', Math.round(ps.tt.delay / 60), 'Min');
      } else console.log('TomTom: keine Route', r.status);
    } catch (e) { console.log('TomTom-Fehler', String(e).replace(TOMTOM_KEY, '***')); }
  }
}

// Ereignisse mit Ort für die Karte merken (nur während der Fahrt)
if (phase) {
  for (const n of out) {
    if (!n.kind) continue;
    (st.log ||= []).push({ t, lat: r5(lat), lon: r5(lon), kind: n.kind, phase, text: n.message });
  }
  if (st.log && st.log.length > 60) st.log = st.log.slice(-60);
}
for (const n of out) await send(n);
if (JSON.stringify([st, track, subs]) !== before) {
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(st));
  fs.writeFileSync(path.join(DIR, 'track.json'), JSON.stringify(track));
  fs.writeFileSync(path.join(DIR, 'subs.json'), JSON.stringify(subs));
  console.log('Zustand gespeichert');
}
