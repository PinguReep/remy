// Mise à jour automatique, côté serveur (12/11) : ce que la tâche planifiée
// demande à Rémy avant de l'arrêter (« travailles-tu ? »), et ce que
// Réglages montre (activée, en pause, la dernière mise à jour).
//
// GET  /api/maj-auto        → vueMajAuto + { occupation }
// PUT  /api/maj-auto        { pause: true | false } → la même vue
// POST /api/maj-auto/ceder  → le fond se met en pause ; { occupation }
// DELETE /api/maj-auto/ceder → il reprend (la mise à jour n'a pas eu lieu)
// GET  /api/fond            → ce que Rémy fait en fond (Réglages › Diagnostic)
//
// La pause vit dans un fichier (%USERPROFILE%\.remy\maj-auto\pause.json) :
// la tâche le lit même quand Rémy ne répond pas. Rien de personnel n'y est
// écrit, et rien n'y vient de remy.env.

import { requireAuth, estAutorise } from "./auth.js";
import { sendJSON, readJSON, sameOrigin } from "./http.js";
import { generationsEnCours } from "./arret.js";
import { etatCharge, cederPourMiseAJour } from "./jobs.js";
import * as prio from "./priorite.js";
import { dossierMaj, fichiers, lireJSON, ecrireJSON, journaliser, vueMajAuto } from "./maj-auto.js";

// Les écritures en cours (POST, PUT, PATCH, DELETE) : un envoi de fichier, une
// capture, une action dans Motion, une question. Une lecture ne compte pas
// (l'app en fait sans cesse, et une lecture coupée se refait d'elle-même).
// Seulement celles d'une session valide : un appareil inconnu qui enverrait
// des corps sans fin (POST /api/login lit le sien avant de juger) ne retient
// pas les mises à jour. Depuis le 12/11, c'est aussi ce qui fait céder le
// fond (lib/priorite.js) : une demande de Sam passe devant.
export function suivreRequete(req, res) {
  if (!prio.natureRequete(req?.method, req?.url)) return;
  let autorise = false;
  try {
    autorise = estAutorise(req);
  } catch {}
  if (!autorise) return;
  prio.suivreRequete(req, res);
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Ce qui retient une mise à jour (12/11 : « le travail de fond cède la
// place ») : ce qui est DEMANDÉ (une réponse qui s'écrit, un appel au modèle
// pour Sam, une écriture en cours) ou ATTENDU, et le fond qui ne se coupe pas
// au milieu (une sauvegarde qui écrit, un import). PAS le fond en pause entre
// deux étapes (réflexion de nuit, conseil, compactage…) : arrêté là, il ne
// perd rien et reprend au redémarrage.
export function occupation() {
  const raisons = [];
  const g = generationsEnCours();
  if (g) raisons.push(pluriel(g, "réponse en cours", "réponses en cours"));
  const c = etatCharge();
  if (c.taps) raisons.push(pluriel(c.taps, "appel au modèle en cours", "appels au modèle en cours"));
  const e = prio.demandesEnCours().filter((d) => d.nature !== "modele").length;
  if (e > 0) raisons.push(pluriel(e, "écriture en cours", "écritures en cours"));
  const f = prio.fondQuiRetient();
  if (f.length) raisons.push(`travail de fond : ${[...new Set(f)].join(", ")}`);
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
  return sendJSON(res, 200, { ...vue(), occupation: occupation() });
}

// POST /api/maj-auto/ceder : la tâche de mise à jour va peut-être installer.
// Le fond se met en pause (bail de 20 min ; aucun job ne commence, les appels
// au modèle de fond en vol sont coupés et reviendront), puis l'occupation
// dit ce qui retient VRAIMENT. Retenu seulement par des demandes de Sam : le
// bail est levé (ses demandes font déjà céder le fond, et il repartira après).
// DELETE : la mise à jour n'a pas eu lieu, le fond reprend.
export async function cederMajAuto(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  if (String(req.method).toUpperCase() === "DELETE") {
    return sendJSON(res, 200, { repris: prio.reprendreApresMiseAJour(), occupation: occupation() });
  }
  await cederPourMiseAJour({ reposMs: Number(process.env.REMY_MAJ_REPOS_MS) || 3_000 });
  const o = occupation();
  const parLeFond = prio.fondQuiRetient().length > 0;
  if (o.occupe && !parLeFond) prio.reprendreApresMiseAJour();
  return sendJSON(res, 200, { occupation: o, fond: prio.etatFond(), bail: prio.bailMiseAJour() });
}

// GET /api/fond : ce que Rémy fait en fond en ce moment, et s'il est en pause
// (Réglages › Diagnostic, capacité « fond-cede-v1 »).
export async function getFond(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, prio.etatFond());
}
