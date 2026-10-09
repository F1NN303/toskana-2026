// Hält die Seite offline verfügbar und zeigt Push-Nachrichten an.
// Seiten immer zuerst aus dem Netz, damit Updates sofort ankommen.
const CACHE = 'toskana-v51';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const SUBS_TOPIC = 'toskana26-subs-r8x2kp';
const VAPID_PUBLIC = 'BEUcM2EYTTmgcaBX2OWDhRxC6rD02HrXhDZqLjjzZ_YZ0leAIYj__XqZJ6Xo6QJeRj0N3TEklowThK79ErVGQMc';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Live-Daten (Position, Verkehr, Wetter) nie aus dem Cache
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('.json')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('./')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Toskana-Fahrt', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(target);
    })
  );
});

// Falls der Browser das Abo erneuert: neu anmelden
function b64ToU8(b) {
  const p = '='.repeat((4 - (b.length % 4)) % 4);
  const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) })
      .then((sub) => fetch('https://ntfy.sh/' + SUBS_TOPIC, { method: 'POST', body: JSON.stringify({ type: 'sub', sub: sub.toJSON(), at: Date.now() }) }))
      .catch(() => {})
  );
});
