const CACHE_NAME = 'war-chess-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker geïnstalleerd');
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
