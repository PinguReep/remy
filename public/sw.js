// Service worker de Rémy — réseau d'abord, cache statique en secours hors ligne.
// Invariant (hérité de remy-os) : les réponses /api/ ne sont JAMAIS mises en
// cache, ce sont des données personnelles. Le site (public/app/) est fait de
// modules : ils sont tous gardés, pour que la page s'ouvre tour éteinte et que
// « Noter » mette en file ce qui partira au retour.

const CACHE = "remy-v6";
const STATIC_ASSETS = [
  "/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png",
  "/fonts/inter-latin.woff2", "/fonts/jbmono-latin.woff2", "/fonts/source-serif-4-latin-400.woff2", "/fonts/source-serif-4-latin-600.woff2",
  "/app/atelier.css", "/app/main.js", "/app/api.js", "/app/ui.js", "/app/bureau.js", "/app/file-envoi.js", "/app/palette.js", "/app/couleurs.js",
  "/app/analyse/dates.js", "/app/analyse/genre.js", "/app/analyse/motion.js", "/app/analyse/privee.js", "/app/analyse/conversations.js",
  "/app/vues/aujourdhui.js", "/app/vues/gerer.js", "/app/vues/remy.js", "/app/vues/noter.js", "/app/vues/projets.js", "/app/vues/rappels.js",
  "/app/vues/reglages.js", "/app/vues/conversations-externes.js", "/app/vues/connexion.js",
  "/app/menu.js", "/app/usage.js", "/app/nouveautes.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // Un fichier manquant ne bloque pas l'installation (allSettled, pas addAll).
      .then((c) => Promise.allSettled(STATIC_ASSETS.map((u) => c.add(new Request(u, { cache: "reload" })))))
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
      // « /?fenetre=noter » est servi par « / » : ignoreSearch.
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || Response.error()))
  );
});
