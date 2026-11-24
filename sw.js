const CACHE_NAME = 'financas-v11';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/charts.js',
  './js/validacoes.js',
  './js/faturas.js',
  './js/vencimentos.js',
  './js/contas.js',
  './js/importar.js',
  './js/importar-tela.js',
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
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Só o próprio site entra no cache. Respostas de outros endereços (o Supabase, com os dados financeiros da pessoa)
  // e as chamadas /api/ passam direto para a rede e nunca são guardadas.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req))
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
