const CACHE_VERSION = 2;
const CACHE_NAME = `ezan-v${CACHE_VERSION}`;
const FONT_CACHE = 'ezan-fonts-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json',
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ezan Vakitleri - Cevrimdisi</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #070d19;
      color: #e5ddd0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      text-align: center;
      padding: 2rem;
    }
    .offline-box { max-width: 360px; }
    .offline-icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.6; }
    h1 { color: #d4a34b; font-size: 1.3rem; margin-bottom: 0.5rem; }
    p { color: #a3b1c6; font-size: 0.9rem; line-height: 1.5; }
    button {
      margin-top: 1.5rem;
      padding: 0.6rem 1.4rem;
      background: #d4a34b;
      color: #0a0e1a;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="offline-box">
    <div class="offline-icon">&#9788;</div>
    <h1>Baglanti Yok</h1>
    <p>Sunucuya ulasilamiyor. Lutfen ag baglantinizi kontrol edin ve tekrar deneyin.</p>
    <button onclick="location.reload()">Tekrar Dene</button>
  </div>
</body>
</html>`;

// Install — cache app shell (do NOT skipWaiting, let client control activation)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

// Activate — clean old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== FONT_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Allow client to trigger skipWaiting for controlled updates
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Google Fonts — cache-first, separate long-lived cache
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      ).catch(() => new Response('', { status: 408 }))
    );
    return;
  }

  // API calls — network-first, cache successful responses for offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navigation — cache-first with offline fallback page
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Stale-while-revalidate
          fetch(request).then((response) => {
            if (response && response.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(request).catch(() =>
          new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        );
      })
    );
    return;
  }

  // Static assets — stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request).then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
