// Fonction Vercel unique pour toute l'API (le plan Hobby limite à 12 fonctions
// par déploiement). Le routage vit dans lib/routes.js, partagé avec server.js.
//
// Toutes les requêtes /api/* arrivent ici via la réécriture de vercel.json :
// un fichier attrape-tout ([...slug].js) ne matche qu'un seul segment en
// runtime vanilla, ce qui rendait /api/conversations/{id} introuvable (404
// plateforme). La réécriture ajoute ?__path=<chemin> pour reconstruire l'URL
// d'origine quel que soit le comportement de Vercel.

import { routeApi } from "../lib/routes.js";
import { sendJSON } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://local");
    const p = u.searchParams.get("__path");
    if (p) {
      u.searchParams.delete("__path");
      const qs = u.searchParams.toString();
      req.url = "/api/" + p.replace(/^\/+/, "") + (qs ? "?" + qs : "");
    }
    const handled = await routeApi(req, res);
    if (!handled) return sendJSON(res, 404, { error: "Route inconnue" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return sendJSON(res, 500, { error: "Erreur serveur" });
  }
}
