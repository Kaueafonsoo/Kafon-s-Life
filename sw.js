const CACHE_NAME = 'financas-v7';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/charts.js',
  './js/supabase-config.js',
  './js/vendor/supabase.js',
  './manifest.json',
  './icons/icon-180-v2.png',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

/* Lembretes por notificação (enviados pelo servidor, ver api/lembretes.js). */
self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (e) { /* payload inválido: mostra o aviso padrão */ }
  event.waitUntil(
    self.registration.showNotification(dados.title || 'GRANA', {
      body: dados.body || '',
      icon: './icons/icon-192-v2.png',
      badge: './icons/icon-192-v2.png',
      tag: 'grana-lembrete',
      data: { url: dados.url || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) if ('focus' in j) return j.focus();
      return self.clients.openWindow(destino);
    })
  );
});
