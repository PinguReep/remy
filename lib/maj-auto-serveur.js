// Mise à jour automatique, côté serveur (12/11) : ce que la tâche planifiée
// demande à Rémy avant de l'arrêter (« travailles-tu ? »), et ce que
// Réglages montre (activée, en pause, la dernière mise à jour).
//
// GET  /api/maj-auto        → vueMajAuto + { occupation }
// PUT  /api/maj-auto        { pause: true | false } → la même vue
//
// La pause vit dans un fichier (%USERPROFILE%\.remy\maj-auto\pause.json) :
// la tâche le lit même quand Rémy ne répond pas. Rien de personnel n'y est
// écrit, et rien n'y vient de remy.env.

import { requireAuth, estAutorise } from "./auth.js";
import { sendJSON, readJSON, sameOrigin } from "./http.js";
import { generationsEnCours } from "./arret.js";
import { jobsEnCours, etatCharge } from "./jobs.js";
import { dossierMaj, fichiers, lireJSON, ecrireJSON, journaliser, vueMajAuto } from "./maj-auto.js";

// Les écritures en cours (POST, PUT, PATCH, DELETE) : un envoi de fichier, une
// capture, une action dans Motion. Une lecture ne compte pas (l'app en fait
// sans cesse, et une lecture coupée se refait d'elle-même). Seulement celles
// d'une session valide : un appareil inconnu qui enverrait des corps sans fin
// (POST /api/login lit le sien avant de juger) ne retient pas les mises à jour.
let ecritures = 0;
export function suivreRequete(req, res) {
  const m = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(m)) return;
  let autorise = false;
  try {
    autorise = estAutorise(req);
  } catch {}
  if (!autorise) return;
  ecritures++;
  let fini = false;
  const terminer = () => {
    if (fini) return;
    fini = true;
    ecritures--;
  };
  res.once?.("close", terminer);
  res.once?.("finish", terminer);
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Rémy travaille-t-il ? Une réponse qui s'écrit, un job de fond (sauvegarde,
// réflexion de la nuit, commerces…), un appel au modèle, une écriture.
export function occupation({ exclure = null } = {}) {
  const raisons = [];
  const g = generationsEnCours();
  if (g) raisons.push(pluriel(g, "réponse en cours", "réponses en cours"));
  const j = jobsEnCours();
  if (j.length) raisons.push(`travail de fond : ${[...new Set(j)].join(", ")}`);
  const c = etatCharge();
  const appels = c.taps + c.fond;
  if (appels) raisons.push(pluriel(appels, "appel au modèle en cours", "appels au modèle en cours"));
  if (c.enAttente) raisons.push(pluriel(c.enAttente, "travail de fond en attente du modèle", "travaux de fond en attente du modèle"));
  const e = ecritures - (exclure ? 1 : 0);
  if (e > 0) raisons.push(pluriel(e, "écriture en cours", "écritures en cours"));
  return { occupe: raisons.length > 0, raisons };
}

export function vue(env = process.env) {
  const F = fichiers(dossierMaj(env));
  return vueMajAuto({ tache: lireJSON(F.tache), pause: lireJSON(F.pause), etat: lireJSON(F.etat), env });
}

export async function getMajAuto(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, { ...vue(), occupation: occupation() });
}

export async function putMajAuto(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => null);
  if (!body || typeof body.pause !== "boolean") return sendJSON(res, 400, { error: "Attendu : { pause: true | false }" });
  const F = fichiers(dossierMaj());
  try {
    ecrireJSON(F.pause, body.pause ? { pause: true, depuis: new Date().toISOString(), par: "app" } : { pause: false, depuis: new Date().toISOString(), par: "app" });
    journaliser(F.journal, body.pause ? "Mise en pause depuis l'app." : "Reprise depuis l'app.");
  } catch (err) {
    console.error("Mise à jour automatique : pause non enregistrée —", err.message);
    return sendJSON(res, 500, { error: "pause_non_enregistree", message: "La tour n'a pas pu enregistrer ce réglage : réessaie dans un instant." });
  }
  console.warn(`Mise à jour automatique ${body.pause ? "mise en pause" : "reprise"} depuis l'app`);
  return sendJSON(res, 200, { ...vue(), occupation: occupation({ exclure: true }) });
}
