// Versions et compatibilité app ↔ serveur (Lot 0, J0.4).
//
// L'app se met à jour par TestFlight, la tour par son installeur : les deux
// peuvent se décaler. /api/version dit ce que ce serveur sait faire ; l'app
// envoie son numéro de build (X-Remy-App) à chaque requête, ce qui permet au
// serveur de refuser proprement une app trop ancienne (REMY_APP_MIN) au lieu
// de lui renvoyer des réponses qu'elle ne sait plus lire.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Version de l'API : monte quand une route change de forme de façon
// incompatible (les anciennes restent servies tant qu'un build les utilise).
export const API_VERSION = 1;

// Ce que ce serveur sait faire, pour que l'app cache ce qu'il ne connaît pas
// encore (un serveur pas encore mis à jour), au lieu d'échouer.
export const CAPACITES = ["version", "reglages", "secours-cloud", "sauvegardes", "base-illisible", "propositions-v1", "circuits", "appareils", "autorisations", "projets-v1", "duree-taches", "listes-v1", "rappels-v1", "taches-etat-v1", "motion-etat-v1", "mesures-v1", "conseil-v1", "taches-etat-v2", "agenda-gestes-v1", "etiquettes-v1", "dossiers-v1", "historique-v1", "analyse-capture-v1", "analyse-rappels-v1", "non-lus-v1", "retenir-choix-v1", "propositions-ajustables-v1", "categories-taches-v1", "dictee-correction-v1", "etapes-v1", "connaissances-v1", "jauge-v1", "compactage-v1", "regles-v1", "lieux-v1", "modeles-v1", "capture-siri-v1", "partage-v1", "activite-pc-v1", "carnet-lot-v1", "historique-v2", "deja-la-v1", "propositions-perimees-v1", "propositions-partielles-v1", "rituel-v1", "semaine-v1", "a-trancher-v1", "priorites-v1", "carnet-outils-v1", "propositions-attente-v1"];

let cache = null;

export function versionServeur() {
  if (cache) return cache;
  let version = "?";
  try {
    version = JSON.parse(fs.readFileSync(path.join(racine, "package.json"), "utf8")).version || "?";
  } catch {}
  cache = { serveur: version, commit: commitInstalle() };
  return cache;
}

// Le commit installé, lu dans .git sans lancer git (la copie de la tour est un
// clone détaché : HEAD contient directement l'empreinte).
export function commitInstalle(dossier = racine) {
  try {
    const head = fs.readFileSync(path.join(dossier, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head.slice(0, 7);
    const ref = head.match(/^ref: (.+)$/)?.[1];
    if (!ref) return null;
    try {
      return fs.readFileSync(path.join(dossier, ".git", ref), "utf8").trim().slice(0, 7);
    } catch {
      const packed = fs.readFileSync(path.join(dossier, ".git", "packed-refs"), "utf8");
      const ligne = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
      return ligne ? ligne.slice(0, 7) : null;
    }
  } catch {
    return null;
  }
}

export const appMin = () => Number(process.env.REMY_APP_MIN || 0);

// Le build de l'app qui appelle (X-Remy-App), ou null (le site, un script).
// Les builds d'avant le Lot 0 n'envoient pas X-Remy-App : leur build se lit
// dans l'en-tête User-Agent que iOS pose seul (« Remy/9 CFNetwork/… »), pour
// que REMY_APP_MIN puisse aussi les écarter proprement.
export function buildApp(req) {
  const v = req.headers["x-remy-app"];
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (Number.isFinite(n) && n > 0) return n;
  const ua = String(req.headers["user-agent"] || "").match(/^Remy\/(\d+) CFNetwork\//);
  return ua ? Number(ua[1]) : null;
}

let dernierBuild = null;
export const dernierBuildVu = () => dernierBuild;

// null si l'app peut continuer ; sinon la réponse à rendre (426).
export function controlerApp(req) {
  const b = buildApp(req);
  if (b) dernierBuild = { build: b, at: Date.now() };
  if (b && appMin() && b < appMin()) {
    return {
      error: "app_trop_ancienne",
      message: `Cette version de l'app (build ${b}) est trop ancienne pour le serveur : installe la dernière depuis TestFlight (build ${appMin()} ou plus).`,
    };
  }
  return null;
}

export function infosVersion() {
  return { api: API_VERSION, ...versionServeur(), appMin: appMin() || null, capacites: CAPACITES };
}
