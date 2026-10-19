// Routes de la mémoire de projets (lot B). Toutes derrière la session : le
// dialogue de tes projets ne sort que vers ton app.

import { sendJSON, readJSON } from "../http.js";
import { requireAuth } from "../auth.js";
import * as sync from "./sync.js";

// GET /api/connaissances : la source, la dernière synchro, les projets vus.
export async function etat(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, sync.etat());
}

// PUT /api/connaissances/sources { "claude-code": true | false }
export async function reglerSources(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => null);
  const v = body?.[sync.SOURCE_CLAUDE];
  if (typeof v !== "boolean") return sendJSON(res, 400, { error: `Attendu : { "${sync.SOURCE_CLAUDE}": true | false }` });
  sync.reglerSource(sync.SOURCE_CLAUDE, v);
  console.warn(`Mémoire de projets : lecture des sessions Claude Code ${v ? "accordée" : "COUPÉE"}`);
  return sendJSON(res, 200, sync.etat());
}

// POST /api/connaissances/synchroniser : lire maintenant (sans IA).
export async function synchroniser(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sync.sourceActive()) {
    return sendJSON(res, 409, { error: "source-coupee", message: "La lecture des sessions Claude Code n'est pas accordée : active-la d'abord." });
  }
  const bilan = await sync.synchroniser();
  return sendJSON(res, 200, { bilan, etat: sync.etat() });
}

// GET /api/connaissances/chercher?q=…&projet=p-…
export async function chercher(req, res) {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url, "http://local");
  const q = String(url.searchParams.get("q") || "").slice(0, 200);
  const projet = url.searchParams.get("projet");
  if (!q.trim()) return sendJSON(res, 400, { error: "Il faut des mots à chercher (q)." });
  return sendJSON(res, 200, { resultats: sync.chercher(q, { projet: /^p-[0-9a-f]{10}$/.test(projet || "") ? projet : null }) });
}

// DELETE /api/connaissances/sources/claude-code : oublier tout ce qui en vient.
export async function purger(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (id !== sync.SOURCE_CLAUDE) return sendJSON(res, 404, { error: "Source inconnue" });
  sync.purger(id);
  console.warn("Mémoire de projets : sessions Claude Code OUBLIÉES (purge)");
  return sendJSON(res, 200, { ok: true, message: "Effacé de la base de Rémy. Tes sessions Claude Code, elles, ne sont pas touchées.", etat: sync.etat() });
}
