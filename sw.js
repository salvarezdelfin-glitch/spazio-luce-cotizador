const CACHE_NAME = 'spazio-luce-v4';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/catalog.js',
  './js/importers.js',
  './js/app.js',
  './manifest.json',
  './assets/logo.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cascarón de la app (HTML/CSS/JS/íconos propios): red primero, para que un
// cambio publicado se vea en la SIGUIENTE carga (no dos cargas después como
// pasaba antes) — cae a caché solo si no hay conexión. GitHub Pages manda
// "max-age=600": sin cache:'no-cache' el navegador se quedaba hasta 10 minutos
// con la copia vieja aunque ya hubiera versión nueva; no-cache pregunta al
// servidor cada vez (si no cambió responde 304, casi gratis). Todo lo demás
// (Supabase, librerías de CDN) va directo a la red: son datos en vivo o
// dependencias que deben estar al día.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
