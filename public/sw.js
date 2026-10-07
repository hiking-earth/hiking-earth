const CACHE_NAME = "hiking-earth-v025-client";
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/icon-512-maskable.png", "/route-guide-original.png", "/terrain/0/0/0.png"];

// Bounded optional cache; installer and user-created files have separate budgets.
const CACHE_BUDGET = 96 * 1024 * 1024, ENTRY_BUDGET = 8 * 1024 * 1024, ENTRY_COUNT = 256;
let cacheWrites = Promise.resolve();
async function boundedCopy(response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > ENTRY_BUDGET) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const headers = new Headers(response.headers); headers.set('x-he-cache-bytes', String(bytes));
  headers.delete('content-encoding'); headers.delete('content-length');
  return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers });
}
function boundedPut(request, response) {
  const operation = cacheWrites.then(async () => {
    const copy = await boundedCopy(response); if (!copy) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(request); await cache.put(request, copy);
    const keys = await cache.keys(); let total = 0; const entries = [];
    for (const key of keys) {
      const cached = await cache.match(key);
      const size = Number(cached?.headers.get('x-he-cache-bytes'));
      const bytes = Number.isFinite(size) && size > 0 ? size : (await cached?.clone().arrayBuffer())?.byteLength || 0;
      total += bytes; entries.push({ key, bytes });
    }
    let count = entries.length;
    for (const entry of entries) {
      if (total <= CACHE_BUDGET && count <= ENTRY_COUNT) break;
      const path = new URL(entry.key.url).pathname;
      if (APP_SHELL.includes(path)) continue;
      await cache.delete(entry.key); total -= entry.bytes; count--;
    }
  });
  cacheWrites = operation.catch(() => {}); return operation.catch(() => {});
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("hiking-earth-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vinext/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(boundedPut(request, copy));
      }
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/"))));
    return;
  }

  // Route manifests are mutable pointers to immutable, content-addressed pages.
  // Always try the network first so a data-only catalog release is visible even
  // when the app shell itself has not changed; retain the last good manifest offline.
  if (url.pathname.startsWith("/route-catalog/") && url.pathname.endsWith("/manifest.json")) {
    const cacheKey = new Request(request.url, { method: "GET" });
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) await boundedPut(cacheKey, response.clone());
        else if (response.status >= 500) return (await caches.match(cacheKey)) || response;
        return response;
      } catch {
        return (await caches.match(cacheKey)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(boundedPut(request, copy));
    }
    return response;
  })));
});
