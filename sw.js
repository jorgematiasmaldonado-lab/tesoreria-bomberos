/* =====================================================================
   sw.js · Service worker: permite instalar la app (PWA) y abrirla rápido.
   Los datos SIEMPRE se leen en línea desde Supabase (nunca se guardan acá).
   Al publicar una versión nueva, cambiar el número de VERSION.
   ===================================================================== */
const VERSION = 'bv-v1.2.0';
const ARCHIVOS = [
  './', './index.html', './styles.css', './config.js', './app.js', './manifest.json', './logo.png', './jmm-logo.png',
  './icons/icon-192.png', './icons/icon-512.png',
  './js/util.js', './js/adjuntos.js', './js/resumen.js', './js/movimientos.js', './js/gastos.js',
  './js/subsidios.js', './js/extintores.js', './js/socios.js', './js/presupuesto.js', './js/informes.js',
  './js/encargado.js', './js/notas.js', './js/configuracion.js'
];
const CDN = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Nunca interceptar Supabase (datos, sesión, archivos, tiempo real)
  if (/supabase\.(co|in)$/.test(url.hostname) || /\/(rest|auth|storage|realtime)\/v1\//.test(url.pathname)) return;

  // Librerías de CDN: se usan desde la caché y se actualizan en segundo plano
  if (CDN.includes(url.hostname)) {
    ev.respondWith(caches.open(VERSION).then(async (cache) => {
      const guardada = await cache.match(req);
      const red = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => guardada);
      return guardada || red;
    }));
    return;
  }

  // Archivos propios: primero la red (para tener siempre la última versión), si no hay conexión, la caché
  if (url.origin === self.location.origin) {
    ev.respondWith(
      fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
  }
});
