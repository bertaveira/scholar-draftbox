import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
void test('service worker installs full shell, navigates offline, serves saved data and removes only old shell caches', async () => {
  const handlers = new Map(),
    stores = new Map();
  const precache = [
    '/',
    '/saved',
    '/suggestions',
    '/session/session-1',
    '/session/session-1.rsc',
    '/404.html',
    '/data/conference.json',
    '/data/recommendations/current.json',
    '/data/recommendations/versions/version/manifest.json',
    '/data/recommendations/versions/version/neighbors.json',
    '/_next/app.js',
  ];
  let claimed = false,
    skipped = false,
    navigated = false;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        addAll: async (urls) => {
          for (const url of urls) entries.set(url, new Response(url));
        },
        match: async (url) => entries.get(url)?.clone(),
      };
    },
  };
  const context = {
    CACHE_NAME: 'eccv-scout-shell-new',
    PRECACHE: precache,
    self: {
      location: { origin: 'http://localhost:3000', hostname: 'localhost' },
      skipWaiting: async () => {
        skipped = true;
      },
      addEventListener: (n, fn) => handlers.set(n, fn),
      clients: {
        matchAll: async () => [
          {
            url: 'http://localhost:3000/saved',
            navigate: async () => {
              navigated = true;
            },
          },
        ],
        claim: async () => {
          claimed = true;
        },
      },
    },
    caches,
    fetch: async () => {
      throw Error('offline');
    },
    URL,
    Response,
    Headers,
  };
  vm.runInNewContext(
    readFileSync('scripts/service-worker.js', 'utf8'),
    context,
  );
  /** @type {Promise<unknown>} */ let pending = Promise.resolve();
  handlers.get('install')({
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;
  assert.equal(stores.get('eccv-scout-shell-new').size, precache.length);
  stores.set('eccv-scout-shell-old', new Map());
  stores.set(
    'eccv-scout-data-v1',
    new Map([['/data/conference.json', new Response('validated-latest')]]),
  );
  handlers.get('activate')({
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;
  assert.equal(claimed, true);
  assert.equal(skipped, true);
  assert.equal(navigated, true);
  assert.equal(stores.has('eccv-scout-shell-old'), false);
  assert.equal(stores.has('eccv-scout-data-v1'), true);
  async function get(path, mode = 'navigate', headers = {}) {
    let response;
    handlers.get('fetch')({
      request: {
        method: 'GET',
        url: 'http://localhost:3000' + path,
        mode,
        headers: new Headers(headers),
      },
      respondWith: (p) => {
        response = p;
      },
    });
    return response;
  }
  assert.equal(await (await get('/saved')).text(), '/saved');
  assert.equal(await (await get('/saved/')).text(), '/saved');
  assert.equal(await (await get('/suggestions')).text(), '/suggestions');
  assert.equal(
    await (await get('/session/session-1?all=1')).text(),
    '/session/session-1',
  );
  assert.equal(
    await (await get('/session/session-1')).text(),
    '/session/session-1',
  );
  assert.equal(
    await (
      await get('/session/session-1?_rsc=abc', 'cors', { rsc: '1' })
    ).text(),
    '/session/session-1.rsc',
  );
  assert.equal(
    await (await get('/_next/app.js', 'cors')).text(),
    '/_next/app.js',
  );
  assert.equal(
    await (await get('/data/recommendations/current.json', 'cors')).text(),
    '/data/recommendations/current.json',
  );
  assert.equal(
    await (
      await get('/data/recommendations/versions/version/neighbors.json', 'cors')
    ).text(),
    '/data/recommendations/versions/version/neighbors.json',
  );
  const response = await get('/data/conference.json', 'cors');
  assert.equal(await response.text(), 'validated-latest');
  assert.equal(response.headers.get('X-Scout-Offline'), 'true');
  assert.equal(await (await get('/unknown')).text(), '/404.html');
});
