/* CACHE_NAME and PRECACHE are injected by build-offline.mjs. */
const LOCAL_PREVIEW = ['localhost', '127.0.0.1'].includes(
  self.location.hostname,
);
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(PRECACHE);
        if (LOCAL_PREVIEW) await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE_NAME);
        throw error;
      }
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const existingCaches = await caches.keys();
      const updating = existingCaches.some(
        (name) => name.startsWith('eccv-scout-shell-') && name !== CACHE_NAME,
      );
      for (const name of existingCaches)
        if (name.startsWith('eccv-scout-shell-') && name !== CACHE_NAME)
          await caches.delete(name);
      await self.clients.claim();
      // Local design previews update atomically after every asset has downloaded.
      // Reload the app tabs together so none retain the previous bundle. Bookmarks stay local.
      if (LOCAL_PREVIEW && updating) {
        const tabs = await self.clients.matchAll({ type: 'window' });
        await Promise.allSettled(tabs.map((tab) => tab.navigate(tab.url)));
      }
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (url.pathname === '/data/conference.json') {
        try {
          return await fetch(request);
        } catch {
          const latest = await (
            await caches.open('eccv-scout-data-v1')
          ).match('/data/conference.json');
          const cached = latest || (await cache.match(url.pathname));
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('X-Scout-Offline', 'true');
            return new Response(await cached.arrayBuffer(), { headers });
          }
          return new Response('Conference data unavailable', { status: 503 });
        }
      }
      let key = url.pathname;
      const rsc =
        request.headers.get('rsc') === '1' ||
        request.headers.get('accept')?.includes('text/x-component');
      if (rsc && !key.endsWith('.rsc'))
        key = key === '/' ? '/index.rsc' : key.replace(/\/$/, '') + '.rsc';
      else if (request.mode === 'navigate' && !key.endsWith('.html'))
        key = key === '/' ? '/index.html' : key.replace(/\/$/, '') + '.html';
      const cached = await cache.match(key);
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return request.mode === 'navigate'
          ? (await cache.match('/404.html')) ||
              new Response('Page unavailable offline', { status: 503 })
          : new Response('Unavailable offline', { status: 503 });
      }
    })(),
  );
});
