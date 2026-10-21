/* Service worker: offline fallback and caching of public pages and build assets. Rules live in sw-policy.js. */
importScripts("/sw-policy.js");

const { PAGES_CACHE, STATIC_CACHE, OFFLINE_URL, MAX_PAGES, MAX_STATIC, classify, isCacheable } = self.SwPolicy;

self.addEventListener("install", (event) => {
  // The new worker waits until the page asks it to take over, so a visitor is never switched mid-task.
  event.waitUntil(caches.open(PAGES_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => ![PAGES_CACHE, STATIC_CACHE].includes(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (event.data === "CLEAR_CACHES") {
    // Called on sign-out so nothing stays on a shared device.
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))));
  }
});

self.addEventListener("fetch", (event) => {
  const kind = classify({ url: event.request.url, method: event.request.method, mode: event.request.mode }, self.location.origin);

  if (kind === "static") {
    event.respondWith(cacheFirst(event.request));
  } else if (kind === "page") {
    event.respondWith(networkFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (isCacheable(response, "static")) {
    await cache.put(request, response.clone());
    await trim(cache, MAX_STATIC);
  }

  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheable(response, "page")) {
      await cache.put(request, response.clone());
      await trim(cache, MAX_PAGES);
    }

    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

/** Oldest entries go first; the offline fallback is never evicted. */
async function trim(cache, max) {
  const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname !== OFFLINE_URL);
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}
