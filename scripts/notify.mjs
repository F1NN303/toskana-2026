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
  hin: { from: Date.parse('2026-10-04T21:00:00+02:00'), to: Date.parse('2026-10-05T20:00:00+02:00'), dest: [43.882, 10.772], near: 2.5 },
  rueck: { from: Date.parse('2026-10-09T06:00:00+02:00'), to: Date.parse('2026-10-10T06:00:00+02:00'), dest: [51.2, 6.45], near: 8 },
};

// Bekannte Wege (grob), um Umleitungen zu erkennen
const ROUTES = [
  [[51.19, 6.44], [50.36, 7.59], [49.48, 8.47], [49.01, 8.40], [47.99, 7.84], [47.56, 7.59], [47.05, 8.31], [46.67, 8.59], [46.53, 8.61], [46.19, 9.02], [46.00, 8.95], [45.83, 9.03], [45.46, 9.19], [45.05, 9.69], [44.80, 10.33], [44.10, 9.82], [43.87, 10.25], [43.84, 10.50], [43.88, 10.77]],
  [[44.80, 10.33], [44.49, 11.34], [43.77, 11.25], [43.88, 10.77]],
  [[47.56, 7.59], [47.38, 8.54], [46.85, 9.53], [46.46, 9.19], [46.19, 9.02]],
  [[51.19, 6.44], [50.94, 6.96], [50.11, 8.68], [49.79, 9.95], [49.45, 11.08], [48.14, 11.58], [47.58, 12.17], [47.26, 11.39], [47.00, 11.51], [46.50, 11.35], [45.44, 10.99], [44.65, 10.93], [44.49, 11.34]],
];

const CH_POLY = [[47.59, 7.59], [47.56, 8.2], [47.65, 8.6], [47.65, 9.0], [47.6, 9.5], [47.5, 9.7], [47.05, 9.6], [46.9, 10.1], [46.85, 10.45], [46.6, 10.2], [46.35, 10.05], [46.4, 9.6], [46.45, 9.3], [46.05, 9.1], [45.82, 9.03], [45.93, 8.9], [46.0, 8.7], [46.1, 8.5], [46.45, 8.4], [46.4, 8.1], [46.1, 7.9], [45.92, 7.04], [46.2, 6.85], [46.15, 6.25], [46.4, 6.1], [46.95, 6.45], [47.45, 7.0], [47.5, 7.5], [47.59, 7.59]];
const AT_POLY = [[47.5, 9.7], [47.55, 10.4], [47.4, 10.9], [47.55, 11.6], [47.7, 12.2], [47.75, 13.0], [46.6, 13.0], [46.75, 12.1], [47.0, 11.5], [46.75, 11.0], [46.85, 10.45], [46.9, 10.1], [47.05, 9.6]];

const TUNNELS = {
  hin: [[46.666, 8.587, 'gotthard'], [46.522, 9.18, 'sanbernardino']],
  rueck: [[46.528, 8.611, 'gotthard'], [46.463, 9.186, 'sanbernardino']],
};

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
async function placeName(lat, lon) {
  const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat}&lon=${lon}`);
  const a = j && j.address;
  return a ? (a.city || a.town || a.village || a.municipality || a.county || '') : '';
}
// Raststätte, Rastplatz oder Tankstelle in der Nähe? null = nichts gefunden, undefined = Abfrage fehlgeschlagen
async function restStop(lat, lon) {
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
  if (!last || (t > last[2] && (t - last[2] >= 4 * 60000 || km(last, here) > 3))) track.push([r5(lat), r5(lon), t]);
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

  // 5) Pause oder Stau
  const since = toMs(pos.stoppedSince);
  if (underway && pos.stopped && since) {
    const mins = (t - since) / 60000;
    if (ps.stopFor !== since && mins >= 10) {
      let poi = ps.poiFor === since ? ps.poi : undefined;
      if (poi === undefined) { poi = await restStop(lat, lon); if (poi !== undefined) { ps.poiFor = since; ps.poi = poi; } }
      if (poi && mins >= 15) {
        ps.stopFor = since; ps.stopKind = 'pause';
        out.push({ title: 'Pause', message: `Wir machen Pause: ${stopLabel(poi)}.`, tags: ['coffee'] });
      } else if (poi === null) {
        ps.stopFor = since; ps.stopKind = 'jam';
        const pl = await placeName(lat, lon);
        out.push({ title: 'Stau', message: `Der Bus steht seit ${Math.round(mins)} Minuten${pl ? ' bei ' + pl : ''}. Keine Raststätte in der Nähe, vermutlich Stau.`, tags: ['warning'], priority: 4 });
      }
    }
  } else if (underway && moving && ps.stopFor && ps.resumedFor !== ps.stopFor) {
    ps.resumedFor = ps.stopFor;
    out.push(ps.stopKind === 'jam'
      ? { title: 'Es geht weiter', message: 'Der Bus fährt wieder.', tags: ['bus'] }
      : { title: 'Weiter geht’s', message: 'Die Pause ist vorbei, der Bus fährt weiter.', tags: ['bus'] });
  }

  // 6) Stockender Verkehr: in den letzten 20 Minuten im Schnitt unter 25 km/h, ohne anzuhalten
  const recent = ptrack.filter((q) => t - q[2] <= 20 * 60000);
  if (underway && moving && recent.length >= 3) {
    const a = recent[0], b = recent[recent.length - 1], dt = (b[2] - a[2]) / 3600000;
    const avg = dt >= 0.25 ? km(a, b) / dt : null;
    if (avg !== null && avg < 25 && (!ps.slowAt || t - ps.slowAt > 60 * 60000)) {
      ps.slowAt = t;
      const pl = await placeName(lat, lon);
      out.push({ title: 'Stockender Verkehr', message: `Der Bus kommt gerade nur langsam voran${pl ? ' bei ' + pl : ''}.`, tags: ['warning'] });
    }
  }

  // 7) Umleitung: weiter als 40 km von allen bekannten Wegen entfernt
  const off = Math.min(...ROUTES.map((r) => distToLine(here, r)));
  if (underway && off > 40 && (!ps.offAt || t - ps.offAt > 2 * 3600000)) {
    ps.offAt = t;
    const pl = await placeName(lat, lon);
    out.push({ title: 'Umleitung', message: `Der Bus fährt gerade eine andere Strecke${pl ? ', aktuell bei ' + pl : ''}. Auf der Seite siehst du die echte Position.`, tags: ['twisted_rightwards_arrows'] });
  }

  // 8) Ankunft
  if (ps.departed && !ps.arrived && km(trip.dest, here) < trip.near) {
    ps.arrived = t;
    out.push(phase === 'hin'
      ? { title: 'Angekommen!', message: 'Wir sind in Montecatini Terme angekommen.', tags: ['tada'] }
      : { title: 'Gleich da!', message: 'Wir sind in Mönchengladbach und gleich an der Schule.', tags: ['tada'], priority: 4 });
  }
}

for (const n of out) await send(n);
if (JSON.stringify([st, track, subs]) !== before) {
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(st));
  fs.writeFileSync(path.join(DIR, 'track.json'), JSON.stringify(track));
  fs.writeFileSync(path.join(DIR, 'subs.json'), JSON.stringify(subs));
  console.log('Zustand gespeichert');
}
