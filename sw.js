/* Service worker del Comité de Transporte Universitario.
   Guarda la app en el dispositivo para que abra aunque no haya internet.
   Los datos (boletos, perfil) los guarda la propia app: Firestore con caché persistente + copia local del boleto. */
const CACHE = 'ctu-shell-v1';
const INDEX = new URL('./index.html', self.registration.scope).href;
const PRECACHE = [
  INDEX,
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Sans+3:wght@400;600&display=swap'
];
// Solo se guardan estos orígenes. Las llamadas a Firestore/Auth (googleapis.com) NUNCA pasan por aquí.
const CDN = /^https:\/\/(www\.gstatic\.com\/firebasejs|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Páginas: primero la red (para tener siempre la última versión); si tarda más de 4 s o no hay internet, la copia guardada.
async function pagina(req){
  const c = await caches.open(CACHE);
  try{
    const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if(r && r.ok) c.put(INDEX, r.clone());
    return r;
  }catch(_){
    return (await c.match(INDEX)) || Response.error();
  }
}

// Recursos: se sirve lo guardado y se actualiza en segundo plano.
async function recurso(req){
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const red = fetch(req).then(r => { if(r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await red) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(req.mode === 'navigate' && url.origin === self.location.origin){
    if(url.pathname.startsWith('/__/')) return;      // rutas reservadas de Firebase (login con popup, etc.)
    e.respondWith(pagina(req)); return;
  }
  if(url.origin === self.location.origin && !url.pathname.startsWith('/__/')){ e.respondWith(recurso(req)); return; }
  if(CDN.test(req.url)) e.respondWith(recurso(req));
});

// La página avisa qué recursos externos cargó (módulos de Firebase, fuentes) para dejarlos guardados.
self.addEventListener('message', e => {
  if(!e.data || e.data.type !== 'warm') return;
  const urls = (e.data.urls || []).filter(u => CDN.test(u));
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(u => c.match(u).then(h => h || c.add(u).catch(() => {}))))));
});
