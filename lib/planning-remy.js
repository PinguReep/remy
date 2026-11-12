// « Le planning de Rémy, à côté de celui de Motion » (12/11, planning-remy-v1).
//
// GET  /api/planning-remy            le planning fantôme, celui de Motion, les écarts
// POST /api/planning-remy/jugements  { ecart, verdict: "remy" | "motion" | null }
//
// Lecture seule pour le monde extérieur : RIEN n'est écrit chez Motion ni dans
// un agenda. Aucune requête Motion de plus : la liste des tâches et les
// horaires viennent du cache de la tour (tachesConnues, horairesConnus) ;
// l'agenda est lu comme la vue de la semaine (cache court). Aucune IA.
// Calcul à l'ouverture seulement : rien ne tourne en fond. Coupable dans les
// Réglages (circuit « planificateur »).
//
// Sur la tour, un seul fichier (planning-remy.json, dans la base) : le dernier
// planning calculé (pour la stabilité : une tâche garde sa place tant que rien
// ne l'oblige à bouger) et les jugements de Sam, datés — c'est ce qui dira,
// dans quelques semaines, si l'on peut se passer du planificateur de Motion.

import fs from "node:fs";
import path from "node:path";
import { planifier, depuisMotion, comparer, OPTIONS } from "./planificateur.js";
import { motionEnabled, tachesConnues, horairesConnus, motionLuA } from "./motion.js";
import { agendaJournee } from "./google.js";
import { annoterTaches } from "./carnet.js";
import { lirePriorites } from "./priorites.js";
import { circuitActif } from "./jobs.js";
import { dossierBase } from "./store.js";
import { ecrireAtomique } from "./coffre.js";
import { debutJour, finJour } from "./dashboard.js";
import { TZ } from "./activite.js";
import { sendJSON, readJSON, sameOrigin } from "./http.js";
import { requireAuth } from "./auth.js";

const MAX_JUGEMENTS = 2000;
const MAX_PLACEMENTS_GARDES = 600;

export const LIMITES = [
  "Il ne déborde pas de tes horaires pour tenir une échéance ferme (Motion le fait).",
  "Pas de pauses entre les tâches, ni de temps de trajet, ni de tâches récurrentes.",
  "Une tâche sans durée n'est pas placée : il ne devine pas sa durée.",
  "Les rendez-vous « toute la journée » et ceux marqués « disponible » ne bloquent rien.",
];

// --- Le fichier de la tour ----------------------------------------------------------------

const fichier = () => path.join(dossierBase(), "planning-remy.json");

class FichierIllisible extends Error {}

function lireFichier() {
  let brut;
  try {
    brut = fs.readFileSync(fichier(), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { precedent: null, jugements: {} };
    throw new FichierIllisible(err.code || err.message);
  }
  try {
    const v = JSON.parse(brut);
    return {
      precedent: v?.precedent && Array.isArray(v.precedent.placements) ? v.precedent : null,
      jugements: v?.jugements && typeof v.jugements === "object" && !Array.isArray(v.jugements) ? v.jugements : {},
    };
  } catch {
    throw new FichierIllisible("JSON invalide");
  }
}

function ecrireFichier(contenu) {
  ecrireAtomique(fichier(), JSON.stringify({ version: 1, ...contenu }, null, 1));
}

/** Le compteur : combien de fois « Rémy a raison », « Motion a raison », depuis quand. */
export function compteJugements(jugements) {
  const liste = Object.values(jugements || {}).filter((j) => j && (j.verdict === "remy" || j.verdict === "motion"));
  const parGenre = {};
  for (const j of liste) {
    const g = typeof j.genre === "string" ? j.genre : "autre";
    parGenre[g] ||= { remy: 0, motion: 0 };
    parGenre[g][j.verdict]++;
  }
  return {
    remy: liste.filter((j) => j.verdict === "remy").length,
    motion: liste.filter((j) => j.verdict === "motion").length,
    total: liste.length,
    depuis: liste.length ? Math.min(...liste.map((j) => Number(j.a) || Infinity)) : null,
    parGenre,
  };
}

// --- GET ----------------------------------------------------------------------------------

const delai = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("délai dépassé")), ms); })]).finally(() => clearTimeout(t));
};

/** Les rendez-vous qui prennent du temps : pas annulés, pas « disponible », pas « toute la journée ». */
export function creneauxPris(evenements) {
  const out = [];
  for (const e of Array.isArray(evenements) ? evenements : []) {
    if (!e || e.status === "cancelled" || e.transparency === "transparent") continue;
    if (!e.start?.dateTime || !e.end?.dateTime) continue;
    const debut = Date.parse(e.start.dateTime);
    const fin = Date.parse(e.end.dateTime);
    if (Number.isFinite(debut) && Number.isFinite(fin) && fin > debut) out.push({ debut, fin });
  }
  return out;
}

/** Le classement CONFIRMÉ (seules les priorités `classee`), dans l'ordre, avec leur projet Motion. */
function prioritesConfirmees() {
  try {
    return (lirePriorites().priorites || []).filter((p) => p?.classee === true).map((p) => ({ titre: p.titre, projetId: p.projetMotion || null }));
  } catch (err) {
    console.warn("Planning de Rémy : priorités illisibles —", err.message);
    return [];
  }
}

export async function getPlanningRemy(req, res) {
  if (!requireAuth(req, res)) return;
  if (!(await circuitActif("planificateur"))) return sendJSON(res, 200, { etat: "coupe" });
  if (!motionEnabled()) return sendJSON(res, 200, { etat: "sans-motion" });
  const brutes = tachesConnues();
  if (!Array.isArray(brutes)) return sendJSON(res, 200, { etat: "attente", luA: null });
  const maintenant = Date.now();
  const tz = TZ;
  let annotees = brutes;
  try {
    annotees = annoterTaches(brutes, { maintenant });
  } catch (err) {
    console.warn("Planning de Rémy : dépendances illisibles —", err.message);
  }
  const { taches, motion } = depuisMotion(annotees);
  const horaires = horairesConnus();

  // L'agenda, comme la vue de la semaine (Google, pas Motion) : son absence n'empêche rien, elle se dit.
  const d0 = debutJour(maintenant, tz);
  let d1 = d0;
  for (let k = 0; k < OPTIONS.jours; k++) d1 = finJour(d1, tz);
  let agenda = "ok";
  let evenements = [];
  try {
    const r = await delai(agendaJournee(d0, d1), 8000);
    if (r === null) agenda = "absent";
    else evenements = r;
  } catch (err) {
    agenda = "erreur";
    console.warn("Planning de Rémy : agenda illisible —", err.message);
  }

  let stocke = { precedent: null, jugements: {} };
  let fichierLisible = true;
  try {
    stocke = lireFichier();
  } catch (err) {
    fichierLisible = false;
    console.warn("Planning de Rémy : planning-remy.json illisible —", err.message);
  }
  const priorites = prioritesConfirmees();
  const plan = planifier({ maintenant, tz, taches, priorites, horaires: horaires?.plages || null, occupe: creneauxPris(evenements), precedent: stocke.precedent });
  const ecarts = comparer({ plan, motion, taches, priorites, maintenant, tz }).map((e) => {
    const j = stocke.jugements[e.id];
    return j && (j.verdict === "remy" || j.verdict === "motion") ? { ...e, jugement: { verdict: j.verdict, a: j.a } } : e;
  });

  // Le planning gardé pour la prochaine ouverture (stabilité). Jamais par-dessus un fichier illisible.
  if (fichierLisible) {
    try {
      ecrireFichier({
        precedent: { calculeA: maintenant, placements: plan.placements.slice(0, MAX_PLACEMENTS_GARDES).map((p) => ({ id: p.id, duree: p.duree, morceaux: p.morceaux })) },
        jugements: stocke.jugements,
      });
    } catch (err) {
      console.warn("Planning de Rémy : planning non gardé —", err.message);
    }
  }

  const motionPlacees = motion.filter((m) => m.debut !== null && m.fin !== null && m.fin > plan.horizon.debut - 60 * 60_000 && m.debut < plan.horizon.fin);
  return sendJSON(res, 200, {
    etat: "ok",
    calculeA: maintenant,
    motionLuA: motionLuA() || null,
    incomplet: Boolean(brutes.tronquee),
    horaires: horaires?.nom || null,
    horairesSupposes: plan.horairesSupposes,
    agenda,
    horizon: plan.horizon,
    resume: { taches: taches.length, placeesRemy: plan.placements.length, placeesMotion: motionPlacees.length, ecarts: ecarts.length },
    ecarts,
    remy: { placements: plan.placements, nonPlaces: plan.nonPlaces },
    motion: { placements: motionPlacees },
    regles: plan.regles,
    limites: LIMITES,
    jugements: { ...compteJugements(stocke.jugements), lisibles: fichierLisible },
  });
}

// --- POST : un jugement --------------------------------------------------------------------

const GENRES = new Set(["bloquee", "ferme", "echeance", "ordre"]);

export async function postJugement(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  if (!(await circuitActif("planificateur"))) return sendJSON(res, 409, { error: "coupe", message: "Le planning de Rémy est coupé dans les Réglages : rien n'est gardé." });
  const body = await readJSON(req, 20_000).catch(() => null);
  const ecart = typeof body?.ecart === "string" ? body.ecart.trim() : "";
  const verdict = body?.verdict;
  if (!/^(bloquee|ferme|echeance|ordre):[^\s]{1,200}$/.test(ecart) || ecart.length > 240 || !(verdict === "remy" || verdict === "motion" || verdict === null)) {
    return sendJSON(res, 400, { error: "Attendu : { ecart: « genre:identifiant », verdict: \"remy\" | \"motion\" | null }" });
  }
  let stocke;
  try {
    stocke = lireFichier();
  } catch (err) {
    // On n'écrase jamais des jugements qu'on ne sait pas relire.
    return sendJSON(res, 503, { error: "illisible", message: "Les jugements gardés sur la tour sont illisibles : rien n'a été écrasé. Regarde Réglages › Diagnostic." });
  }
  const genre = ecart.split(":")[0];
  const jugements = { ...stocke.jugements };
  if (verdict === null) delete jugements[ecart];
  else {
    jugements[ecart] = {
      verdict,
      a: Date.now(),
      genre: GENRES.has(genre) ? genre : "autre",
      resume: typeof body.resume === "string" ? body.resume.replace(/\s+/g, " ").trim().slice(0, 300) : null,
    };
    // Les plus anciens partent d'abord si la liste devient très longue.
    const cles = Object.keys(jugements);
    if (cles.length > MAX_JUGEMENTS) {
      cles.sort((x, y) => (jugements[x].a || 0) - (jugements[y].a || 0)).slice(0, cles.length - MAX_JUGEMENTS).forEach((k) => delete jugements[k]);
    }
  }
  try {
    ecrireFichier({ precedent: stocke.precedent, jugements });
  } catch (err) {
    console.error("Planning de Rémy : jugement non gardé —", err.message);
    return sendJSON(res, 500, { error: "Jugement non gardé — réessaie." });
  }
  return sendJSON(res, 200, { ok: true, ecart, jugement: verdict === null ? null : { verdict, a: jugements[ecart].a }, compte: compteJugements(jugements) });
}
