// Le verrou de « Ce que Rémy a compris » (12/11) : une ré-authentification
// RÉCENTE, vérifiée par la tour sur chaque route concernée — pas un voile dans
// l'interface.
//
//   - POST /api/verrou { password } : le mot de passe de Rémy, ressaisi. Juste,
//     il ouvre une fenêtre courte (10 min, REMY_VERROU_MIN entre 1 et 60),
//     liée à LA session qui l'a demandée (le cookie de session, ou l'appareil
//     du jeton) : copier le cookie de déverrouillage dans une autre session ne
//     sert à rien. Les essais sont comptés AVANT d'être vérifiés : 5 par
//     adresse et par quart d'heure, et ils entrent dans le compteur global
//     de la connexion (une attaque répartie bute sur la même limite).
//   - DELETE /api/verrou : reverrouille tout de suite (la fenêtre est
//     oubliée par la tour, le cookie effacé).
//   - Une fenêtre vit en MÉMOIRE de la tour : un redémarrage reverrouille tout.
//
// Ce que le verrou NE protège PAS : le disque (remy.db et le coffre de la
// tour ne sont pas chiffrés au repos par ce verrou), une session déjà
// déverrouillée pendant ses 10 minutes, ce que Rémy dit de toi dans une
// conversation (sa mémoire reste dans ses réponses), les fiches de l'arbre
// (elles servent à l'écran Projets en permanence). Sans mot de passe sur la
// tour (développement local), il n'y a PAS de verrou, et l'écran le dit.

import crypto from "node:crypto";
import { sendJSON, readJSON, getIP, sameOrigin } from "./http.js";
import { authConfigured, verifyPassword } from "./auth.js";
import { counterIncr, counterReset } from "./store.js";

const COOKIE = "remy_deverrou";
const SESSION = "remy_session";
const ENTETE = "x-remy-deverrou";
const MAX_ESSAIS_IP = 5;
const FENETRE_ESSAIS_SEC = 15 * 60;
const MAX_ESSAIS_GLOBAL = 50; // le même compteur que la connexion (lib/auth.js)
const GLOBAL_SEC = 60 * 60;

export const dureeMs = () => {
  const n = Number(process.env.REMY_VERROU_MIN);
  return (Number.isFinite(n) && n >= 1 && n <= 60 ? n : 10) * 60_000;
};

// Les fenêtres ouvertes : identifiant → { exp, lien }. En mémoire seulement.
const fenetres = new Map();
const purger = (maintenant = Date.now()) => {
  for (const [id, f] of fenetres) if (f.exp <= maintenant) fenetres.delete(id);
};

function secret() {
  const s = process.env.SESSION_SECRET || process.env.APP_PASSWORD_HASH || process.env.APP_PASSWORD || "dev-only";
  return crypto.createHash("sha256").update("remy-deverrou:" + s).digest();
}
const signer = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// La session à laquelle une fenêtre est liée : l'appareil (jeton), sinon le cookie de session.
function lienDe(req) {
  if (req.appareil?.id) return `appareil:${req.appareil.id}`;
  const s = cookies(req)[SESSION];
  return s ? `session:${crypto.createHash("sha256").update(s).digest("base64url").slice(0, 32)}` : null;
}

const sansVerrou = () => !authConfigured();

/** La fenêtre de cette requête, si elle est ouverte : { id, exp } ou null. */
export function fenetreDe(req, maintenant = Date.now()) {
  const brut = String(req.headers[ENTETE] || cookies(req)[COOKIE] || "");
  const [payload, sig] = brut.split(".");
  if (!payload || !sig) return null;
  const attendu = signer(payload);
  const x = Buffer.from(sig);
  const y = Buffer.from(attendu);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  purger(maintenant);
  const f = fenetres.get(String(data?.id || ""));
  if (!f || f.exp <= maintenant || data.exp !== f.exp) return null;
  const lien = lienDe(req);
  if (!lien || lien !== f.lien) return null;
  return { id: data.id, exp: f.exp };
}

/** Ce que l'écran affiche : verrouillé ou non, jusqu'à quand. */
export function etatVerrou(req, maintenant = Date.now()) {
  if (sansVerrou()) return { disponible: false, verrouille: false, raison: "Aucun mot de passe n'est posé sur cette tour : il n'y a pas de verrou (mode développement)." };
  const f = fenetreDe(req, maintenant);
  return { disponible: true, verrouille: !f, jusqua: f?.exp || null, dureeMin: Math.round(dureeMs() / 60_000) };
}

/**
 * Le garde à appeler APRÈS requireAuth, au début de chaque route protégée.
 * Renvoie true si la fenêtre est ouverte ; sinon répond 423 et renvoie false.
 * `appareilExempte` : un appareil connecté par jeton (l'app iPhone, qui ne sait
 * pas encore déverrouiller) passe — pour les routes qu'elle lit déjà.
 */
export function exigerDeverrouillage(req, res, { appareilExempte = false } = {}) {
  if (sansVerrou()) return true;
  if (appareilExempte && req.appareil) return true;
  if (fenetreDe(req)) return true;
  sendJSON(res, 423, { error: "verrou", message: "Verrouillé : ressaisis le mot de passe de Rémy pour voir ce qu'il a compris." });
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST /api/verrou { password } — à appeler après requireAuth. */
export async function deverrouiller(req, res) {
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "origin" });
  if (sansVerrou()) return sendJSON(res, 200, etatVerrou(req));
  const lien = lienDe(req);
  if (!lien) return sendJSON(res, 401, { error: "auth", message: "Reconnecte-toi d'abord." });
  const body = await readJSON(req).catch(() => ({}));
  const ip = getIP(req);
  const cle = `remy:bf:verrou:${ip}`;
  const [essais, global] = await Promise.all([counterIncr(cle, FENETRE_ESSAIS_SEC), counterIncr("remy:bf:global", GLOBAL_SEC)]);
  if (essais > MAX_ESSAIS_IP || global > MAX_ESSAIS_GLOBAL) {
    return sendJSON(res, 429, { error: "locked", message: "Trop d'essais : réessaie dans 15 minutes." });
  }
  await sleep(250 + Math.random() * 400);
  if (!verifyPassword(String(body?.password || ""))) {
    console.warn(`Déverrouillage refusé depuis ${ip} (${essais}/${MAX_ESSAIS_IP})`);
    return sendJSON(res, 401, { error: "bad_password", message: `Mot de passe incorrect (${Math.max(0, MAX_ESSAIS_IP - essais)} essai${MAX_ESSAIS_IP - essais > 1 ? "s" : ""} restant${MAX_ESSAIS_IP - essais > 1 ? "s" : ""}).` });
  }
  await counterReset(cle);
  purger();
  const id = crypto.randomBytes(18).toString("base64url");
  const exp = Date.now() + dureeMs();
  fenetres.set(id, { exp, lien });
  const payload = Buffer.from(JSON.stringify({ id, exp, v: 1 })).toString("base64url");
  const jeton = `${payload}.${signer(payload)}`;
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${jeton}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.round(dureeMs() / 1000)}${secure}`);
  // Une app (jeton d'appareil) n'a pas ce cookie : elle renverra l'en-tête X-Remy-Deverrou.
  return sendJSON(res, 200, { disponible: true, verrouille: false, jusqua: exp, dureeMin: Math.round(dureeMs() / 60_000), ...(req.appareil ? { deverrou: jeton } : {}) });
}

/** DELETE /api/verrou — reverrouille : la tour oublie la fenêtre, le cookie s'efface. */
export function reverrouiller(req, res) {
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "origin" });
  const f = fenetreDe(req);
  if (f) fenetres.delete(f.id);
  // Toutes les fenêtres de cette session (deux onglets) : « Reverrouiller » veut dire tout.
  const lien = lienDe(req);
  if (lien) for (const [id, x] of fenetres) if (x.lien === lien) fenetres.delete(id);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  return sendJSON(res, 200, etatVerrou(req));
}

/** À la déconnexion : la tour oublie les fenêtres de cette session. */
export function oublierSession(req) {
  const lien = lienDe(req);
  if (lien) for (const [id, x] of fenetres) if (x.lien === lien) fenetres.delete(id);
}

export function _toutReverrouiller() {
  fenetres.clear();
}
