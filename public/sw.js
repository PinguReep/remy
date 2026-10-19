// Service worker de Rémy — réseau d'abord, cache statique en secours hors-ligne.
// Invariant (hérité de remy-os) : les réponses /api/ ne sont JAMAIS mises en cache,
// ce sont des données personnelles.

const CACHE = "remy-v2";
const STATIC_ASSETS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/fonts/inter-latin.woff2", "/fonts/jbmono-latin.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return; // ressources d'ailleurs : laisser le navigateur gérer
  if (url.pathname.startsWith("/api/")) return; // jamais de cache pour les données personnelles

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || Response.error()))
  );
});
