const C = 'mymoney-v27', FILES = ['./', 'index.html', 'app.js', 'scan.js', 'savings.js', 'cards.js', 'backup.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// network first (bypassing the browser's HTTP cache), cache only when offline
self.addEventListener('fetch', e => e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))));
