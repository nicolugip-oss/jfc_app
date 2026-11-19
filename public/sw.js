// Service Worker: macht die App installierbar und lädt sie auch bei schlechtem Netz.
// Strategie "zuerst Netzwerk, sonst Cache" – so kommen Updates immer sofort an.
const CACHE = 'jfc-__VERSION__';
const SKIP = /\/(api|uploads|socket\.io|bestaetigen|passwort-neu|einladung)\//;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jfc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Push-Benachrichtigung anzeigen (Ankündigungen, Quick-Events, neue Challenges)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Jesus First Camp', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    tag: data.tag,
    data: { url: data.url || './' },
  }));
});

// Antippen öffnet die App (bzw. holt sie nach vorne) an der richtigen Stelle
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      if ('navigate' in win) await win.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./'))),
  );
});
