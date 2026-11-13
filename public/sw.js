/* Build template: Vite injects the content version and exact production asset URLs.
 * The service worker only stores the static application shell. Personal data and
 * documents live in IndexedDB, never in this HTTP cache. */
const CACHE_PREFIX = "tempo-shell-";
const CACHE_NAME = "__TEMPO_CACHE_NAME__";
const PRECACHE_URLS = /* __TEMPO_PRECACHE__ */ [];
const APP_SHELL = "__TEMPO_APP_SHELL__";
const STATIC_PATHS = new Set(PRECACHE_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(
        PRECACHE_URLS.map(
          (path) =>
            new Request(new URL(path, self.location.origin), {
              cache: "reload",
              credentials: "same-origin",
            }),
        ),
      ),
    ),
  );
  // An update activates when the previous app's tabs have closed. This keeps
  // already-open pages and their hashed assets on the same application version.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Subscription URLs must reach the server, even when opened as a navigation.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(APP_SHELL);
        if (shell) return shell;
        return fetch(request);
      })(),
    );
    return;
  }

  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.pathname);
      return cached || fetch(request);
    })(),
  );
});
