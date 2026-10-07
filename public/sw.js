const CACHE_NAME = "hiking-earth-v025-client";
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/icon-512-maskable.png", "/route-guide-original.png", "/terrain/0/0/0.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
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
        if (response.ok) await (await caches.open(CACHE_NAME)).put(cacheKey, response.clone());
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
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  })));
});
