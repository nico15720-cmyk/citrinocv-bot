// Service Worker — Agenda Citrino PWA
const CACHE = 'agenda-citrino-v1';
const SHELL = [
  '/app/agenda/',
  '/app/agenda/index.html',
  '/app/agenda/manifest.webmanifest',
  '/app/agenda/icon.svg',
];

// Instalar: cachear shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first para API, cache-first para shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API: siempre network, fallback JSON vacío
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión', offline: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Shell: cache-first, actualizar en background
  if (url.pathname.startsWith('/app/agenda/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
        return cached || network;
      })
    );
    return;
  }

  // Resto: network normal
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
