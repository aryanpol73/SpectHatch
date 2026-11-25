import { locate, operate, initialState } from './__spechatch/model.mjs';

// Replaced once at build time with the digest and the exact public asset paths.
const release = __SPECHATCH_RELEASE__;
const base = self.registration.scope;
const scopePath = new URL(base).pathname;
const cachePrefix = 'spechatch/' + encodeURIComponent(base) + '/';
const cacheName = cachePrefix + release.id;
const localURL = (file) => new URL(file, base).href;
const publicFiles = new Set(release.files.map(localURL));
let settings;
let database;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(
        release.files.map(
          (file) => new Request(localURL(file), { cache: 'reload', credentials: 'omit' }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter(
        (name) => name.startsWith(cachePrefix) && name !== cacheName,
      );
      await Promise.all(old.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});
async function asset(url) {
  const response = await (await caches.open(cacheName)).match(url);
  if (!response) throw Error('Asset cache unavailable. Reopen this demo online.');
  return response;
}
function config() {
  settings ??= asset(localURL('__spechatch/contract.json'))
    .then(async (response) => ({
      contract: await response.json(),
      audit: response.headers.get('X-SpecHatch-Audit') === '1',
    }))
    .catch((error) => {
      settings = undefined;
      throw error;
    });
  return settings;
}

function db() {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(cacheName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('resources');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  }).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

async function runOperation(contract, match, request, url) {
  const method = request.method;
  if (!match || match.kind === 'read') {
    return operate(match, method, url.searchParams, null, match && contract.seed.reads[match.path]);
  }
  let body;
  if (method === 'POST' || method === 'PATCH') {
    try {
      body = await request.json();
    } catch {
      return { status: 400, body: { error: 'Expected JSON in request body.' } };
    }
  }
  const connection = await db();
  return new Promise((resolve, reject) => {
    // Read and update in one transaction. Concurrent tabs cannot overwrite another write.
    const tx = connection.transaction('resources', method === 'GET' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('resources');
    const read = store.get(match.path);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || Error('Local transaction aborted.'));
    read.onsuccess = () => {
      const state =
        read.result ?? initialState(match.resource, contract.seed.resources[match.path]);
      result = operate(match, method, url.searchParams, body, state);
      if (result.next) store.put(result.next, match.path);
    };
  });
}

async function audit(kind, method, path, status) {
  if (!(await config()).audit) return;
  await fetch(localURL('__spechatch/audit'), {
    method: 'POST',
    body: JSON.stringify({ kind, method, path, status }),
    credentials: 'omit',
  });
}
async function notifyUnsupported(clientId) {
  if (!clientId) return;
  const client = await self.clients.get(clientId);
  client?.postMessage({ type: 'spechatch:unavailable' });
}
async function respond(request, clientId) {
  const url = new URL(request.url);
  const same = url.origin === self.location.origin;
  const relative =
    same && url.pathname.startsWith(scopePath)
      ? '/' + url.pathname.slice(scopePath.length)
      : url.pathname;
  const { contract } = await config();
  const apiPath = [url.pathname, relative].find(
    (p) => p === contract.apiPrefix || p.startsWith(contract.apiPrefix + '/'),
  );
  if (same && apiPath) {
    const match = locate(contract, apiPath);
    const result = await runOperation(contract, match, request, url);
    // Do not send query values, IDs, request bodies or headers to the local verifier.
    const route = match ? match.path + (match.id != null ? '/:id' : '') : url.pathname;
    await audit(result.unsupported ? 'miss' : 'route', request.method, route, result.status);
    if (result.unsupported) await notifyUnsupported(clientId);
    if (result.status === 204) return new Response(null, { status: 204 });
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (same && request.mode === 'navigate' && (relative === '/' || relative === '/index.html')) {
    return asset(localURL('spechatch-app.html'));
  }
  if (same && request.method === 'GET' && relative === '/__spechatch/receipt.json') {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) await cache.put(request.url, response.clone());
      return response;
    } catch {
      return (await cache.match(request.url)) || Response.error();
    }
  }
  const canonical = url.origin + url.pathname;
  if (same && request.method === 'GET' && publicFiles.has(canonical)) return asset(canonical);
  await audit('miss', request.method, same ? url.pathname : url.origin, 501);
  await notifyUnsupported(clientId);
  return Response.json({ error: 'Outside this static demo.' }, { status: 501 });
}
self.addEventListener('fetch', (event) => {
  if (!/^https?:/.test(event.request.url)) return;
  event.respondWith(
    respond(event.request, event.clientId).catch((error) =>
      Response.json({ error: String(error.message) }, { status: 503 }),
    ),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'spechatch:policy') {
    event.waitUntil(audit('miss', 'CSP', String(event.data.directive), 403));
    return;
  }
  if (event.data?.type !== 'spechatch:reset' || !event.ports[0]) return;
  event.waitUntil(
    (async () => {
      try {
        const conn = await db();
        await new Promise((resolve, reject) => {
          const tx = conn.transaction('resources', 'readwrite');
          tx.objectStore('resources').clear();
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
        event.ports[0].postMessage({ ok: true });
      } catch {
        event.ports[0].postMessage({ ok: false });
      }
    })(),
  );
});
