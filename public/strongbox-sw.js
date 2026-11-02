/*
 * Strongbox's offline helper. It does one thing: keep a copy of strongbox.html,
 * so the vault opens with no signal — including as a Home Screen app on iPhone,
 * which keeps its own storage, never loads the rest of the site, and so never
 * gets the site's own service worker.
 *
 * Network first, so a fixed page reaches the phone the next time it has
 * signal. The copy answers only when the network cannot, or takes longer than
 * four seconds. It caches nothing else and sends nothing anywhere.
 */
const CACHE = "strongbox-page";
const PAGE = new URL("strongbox.html", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin + url.pathname !== PAGE) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await Promise.race([
          fetch(event.request),
          new Promise((_, reject) => setTimeout(() => reject(new Error("network too slow")), 4000)),
        ]);
        if (response.ok) await cache.put(PAGE, response.clone());
        return response;
      } catch {
        return (await cache.match(PAGE)) || Response.error();
      }
    })(),
  );
});
