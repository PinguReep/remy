// Injecté par la coquille dans chaque page de ses deux fenêtres (fenetres.rs,
// SCRIPT_CONTROLE). Sur une page de la tour, il dit à la coquille comment la
// page s'est chargée : le statut HTTP de la navigation (Chromium/WebView2 le
// donne, WebKit non : 0) et si la page est vide. Une réponse 5xx (Tailscale
// Serve répond 502 tant que Rémy ne tourne pas) ou une page vide ramène la
// fenêtre sur sa page embarquée (« Rémy ne répond pas encore », Réessayer).
// Le site n'a rien à faire pour ça ; une page qui ne se signale pas du tout
// (chargement bloqué, page d'erreur du navigateur) est rattrapée au bout de
// 20 s par la coquille.
(() => {
  "use strict";
  try {
    if (window.top !== window) return;
    const protocole = location.protocol;
    if (protocole !== "https:" && protocole !== "http:") return;
    if (location.hostname === "tauri.localhost" || location.hostname === "ipc.localhost") return;
  } catch (_) {
    return;
  }
  let fait = false;
  const signaler = () => {
    if (fait) return;
    fait = true;
    try {
      let statut = 0;
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav && typeof nav.responseStatus === "number") statut = nav.responseStatus;
      const corps = document.body;
      const vide = !corps || (corps.children.length === 0 && !(corps.textContent || "").trim());
      const ipc = window.__TAURI_INTERNALS__;
      if (!ipc || typeof ipc.invoke !== "function") return;
      Promise.resolve(ipc.invoke("bureau_page_chargee", { statut, vide })).catch(() => {});
    } catch (_) {
      /* jamais d'erreur dans la page du site */
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", signaler, { once: true });
  else signaler();
})();
