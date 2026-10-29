// La base des commerces (lib/commerces.js) se remet à jour toute seule (29/10 :
// « pas besoin d'actualiser tous les jours, fais un truc raisonnable ») :
//
//   - au plus une fois par mois : quand le dernier import a 30 jours
//     (REMY_COMMERCES_JOURS), ou que son format est dépassé par le code ;
//   - la nuit, entre 1 h et 3 h (REMY_COMMERCES_HEURE), avant la sauvegarde et
//     la réflexion ; sans IA ;
//   - seulement si une base existe déjà : le premier import reste un geste
//     (scripts/commerces-importer.mjs, docs/tour.md) ; REMY_COMMERCES_AUTO=off
//     coupe la mise à jour automatique, REMY_LIEUX=off aussi ;
//   - le même importeur, dans un processus à part : la mémoire du serveur n'est
//     pas touchée, et un import interrompu garde l'ancienne base. Ce qui part :
//     les numéros de département, vers Overpass — comme à la main ;
//   - un échec est repris dans la nuit (30 min, puis 1 h ; 3 essais), puis la
//     nuit suivante. La date du dernier import et le dernier échec sont dans
//     /api/health (« commerces ») et dans la vue des lieux de l'app.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { etatCommerces, fermerCommerces } from "./commerces.js";
import * as jobs from "./jobs.js";

const JOURS = () => Number(process.env.REMY_COMMERCES_JOURS) || 30;
const HEURE = () => Number(process.env.REMY_COMMERCES_HEURE ?? 1);
const DELAI_MS = () => Number(process.env.REMY_COMMERCES_DELAI_MS) || 75 * 60_000;
const IMPORTEUR = fileURLToPath(new URL("../scripts/commerces-importer.mjs", import.meta.url));
const TZ = () => process.env.REMY_TZ || "Europe/Paris";

export const commercesAuto = () => process.env.REMY_COMMERCES_AUTO !== "off" && process.env.REMY_LIEUX !== "off";

// Les départements à réimporter : ceux de remy.env, sinon ceux de la base.
function departements(e) {
  const env = String(process.env.REMY_GEO_DEPARTEMENTS || "")
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
  return env.length ? env : e.departements || [];
}

// La prochaine mise à jour (ms) : 30 jours après le dernier import.
const prochaine = (e) => (e.importeA ? e.importeA + JOURS() * 86_400_000 : null);

// À demander maintenant ? { departements } ou null. `heure` : celle de Paris.
export function commercesADemander({ heure, maintenant = Date.now() } = {}) {
  if (!commercesAuto() || !(heure >= HEURE() && heure < HEURE() + 2)) return null;
  const e = etatCommerces();
  if (!e.commerces) return null; // pas de base : le premier import est un geste
  const deps = departements(e);
  if (!deps.length) return null;
  const due = e.aRefaire || !e.importeA || maintenant >= prochaine(e);
  return due ? { departements: deps } : null;
}

// L'importeur, dans un processus à part. Rend { code, sortie, erreurs }.
function importer(deps) {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, ["--no-warnings", IMPORTEUR, "--departements", deps.join(",")], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: DELAI_MS(),
      windowsHide: true,
    });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (x) => (sortie = (sortie + x).slice(-4000)));
    enfant.stderr.on("data", (x) => (erreurs = (erreurs + x).slice(-4000)));
    enfant.on("error", (err) => resolve({ code: -1, sortie, erreurs: err.message }));
    enfant.on("close", (code, signal) => resolve({ code: code ?? -1, signal, sortie, erreurs }));
  });
}

export function enregistrerCommerces() {
  jobs.enregistrer("commerces-maj", {
    circuit: "socle",
    priorite: 9,
    maxTentatives: 3,
    attenteBaseMs: 30 * 60_000,
    delaiMaxMs: DELAI_MS() + 5 * 60_000,
    async executer({ departements: deps } = {}) {
      const liste = deps?.length ? deps : departements(etatCommerces());
      if (!liste.length) return { saute: "aucun département connu" };
      console.log(`Commerces : mise à jour mensuelle (${liste.join(", ")}), depuis OpenStreetMap`);
      fermerCommerces(); // l'importeur remplace la base : le serveur la rouvrira
      const r = await importer(liste);
      fermerCommerces();
      if (r.code !== 0) {
        const pourquoi = (r.erreurs.trim().split("\n").filter(Boolean).pop() || (r.signal ? `arrêté (${r.signal}) après ${Math.round(DELAI_MS() / 60_000)} min` : `code ${r.code}`))
          .replace(/^Import interrompu : /, "")
          .replace(/ — l'ancienne base.*$/, "")
          .slice(0, 300);
        throw new Error(pourquoi);
      }
      const e = etatCommerces();
      console.log(`Commerces : base à jour — ${e.commerces} commerces (${e.departements.join(", ")})`);
      return { commerces: e.commerces, departements: e.departements };
    },
  });
}

const date = (ms) => new Date(ms).toLocaleDateString("fr-FR", { timeZone: TZ(), day: "2-digit", month: "2-digit", year: "numeric" });
const heureDe = (ms) => new Date(ms).toLocaleString("fr-FR", { timeZone: TZ(), day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ");
// « le 29/10 à 01:20 »

// Ce que l'app et /api/health montrent : la dernière mise à jour, la
// prochaine, et le dernier échec s'il est plus récent que la base.
export function etatMajCommerces(e = etatCommerces()) {
  let dernier = null;
  try {
    dernier = jobs.dernierJob("commerces-maj");
  } catch {}
  const echec =
    dernier?.erreur && ["attente", "abandonne"].includes(dernier.etat) && (!e.importeA || dernier.maj_a > e.importeA)
      ? { a: new Date(dernier.maj_a).toISOString(), erreur: dernier.erreur, reprise: dernier.etat === "attente" ? new Date(dernier.prochain_essai_a).toISOString() : null }
      : null;
  return {
    auto: commercesAuto(),
    derniere: e.importeA ? new Date(e.importeA).toISOString() : null,
    prochaine: e.commerces && commercesAuto() ? new Date(e.aRefaire ? Date.now() : prochaine(e) ?? Date.now()).toISOString() : null,
    enCours: dernier?.etat === "en_cours",
    echec,
  };
}

// La ligne de /api/health.
export function resumeCommerces() {
  const e = etatCommerces();
  if (!e.commerces) return "— pas encore de base (une fois : scripts/commerces-importer.mjs, voir docs/tour.md)";
  const m = etatMajCommerces(e);
  const base = `${e.commerces.toLocaleString("fr-FR")} commerce${e.commerces > 1 ? "s" : ""} (${e.departements.join(", ") || "?"})${m.derniere ? `, mis à jour le ${date(Date.parse(m.derniere))}` : ""}`;
  const suite = m.enCours
    ? "mise à jour en cours"
    : !m.auto
      ? "mise à jour automatique coupée (REMY_COMMERCES_AUTO=off ou REMY_LIEUX=off)"
      : e.aRefaire
        ? "format dépassé : refaite la nuit prochaine"
        : `prochaine mise à jour automatique la nuit après le ${date(Date.parse(m.prochaine))}`;
  if (m.echec) {
    return `⚠️ ${base} ; dernière tentative le ${heureDe(Date.parse(m.echec.a))} échouée (${m.echec.erreur})${m.echec.reprise ? ` — nouvel essai le ${heureDe(Date.parse(m.echec.reprise))}` : " — nouvel essai la nuit prochaine"}`;
  }
  return `${e.aRefaire ? "⚠️" : "✅"} ${base} ; ${suite}`;
}
