const CACHE = 'along-shell-v35';
const SHELL = ['./live-vehicles.js','./live-context.js','./live-time.js','./live-predictions.js','./live-client.js','./live-config.js','./feedback.js','./feedback-ui.js','./i18n.js','./locales.js','./install.html','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png','./vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png','./vendor/leaflet/images/marker-shadow.png','./explore.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './', './style.css', './app.js', './updates.js', './worker.js', './planner.js', './streets.js', './preferences.js', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // A new worker must not copy an old, still-fresh HTTP response into its
    // permanent offline shell (static hosts can cache HTML for several minutes).
    await cache.addAll(SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
    const html=await (await cache.match(self.registration.scope)).text();
    if(html.match(/App version (\d+)/)?.[1]!==CACHE.replace('along-shell-v','')){
      await caches.delete(CACHE);
      throw new Error('The published interface and worker versions do not match. Keep the existing app.');
    }
  })());
});
self.addEventListener('message', event => {
  if(event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if(event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({version:CACHE.replace('along-shell-v','')});
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('along-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.includes('/data/')) return;
  // Update-confirmation query parameters must not break an offline reopen.
  const key=event.request.mode==='navigate'&&url.pathname===new URL(self.registration.scope).pathname?self.registration.scope:event.request;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(key)) || fetch(event.request)));
});
