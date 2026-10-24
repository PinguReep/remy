// Le rendez-vous quotidien (MVP du 24/10) : Rémy vient à Sam deux fois par
// jour, sans nouvel appel IA.
//
//   - le briefing du matin : trois lignes (ce qui compte, pourquoi, ce qui est
//     menacé), calculées ici à partir de la journée, des échéances, de la boîte
//     de la nuit ;
//   - le bilan du soir : ce qui est fait, ce qui a glissé, ce qui reste (à
//     pousser à demain d'un geste, par la chaîne d'écriture) ;
//   - le signal « menacée » : une échéance qui ne tient plus, vue AVANT qu'elle
//     soit en retard.
//
// Tout est déterministe : les mêmes données donnent les mêmes phrases. Ce
// module ne fait aucune entrée/sortie (les handlers lui passent les données).

import { horodate, TZ } from "./activite.js";
import { debutJour, finJour, journee, normTache } from "./dashboard.js";

const MIN = 60_000;
const H = 60 * MIN;
// La journée « utile » s'arrête là pour compter le temps libre : au-delà, une
// tâche due ce soir n'a plus de place raisonnable.
const FIN_JOURNEE_MIN = 21 * 60;
const DUREE_DEFAUT = 30;
const RANG = { ASAP: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PRIO = { ASAP: "urgente", HIGH: "importante", MEDIUM: "normale", LOW: "basse" };

const fmt = (opts, tz) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...opts });
const heure = (ms, tz = TZ) => fmt({ hour: "2-digit", minute: "2-digit" }, tz).format(new Date(ms));
export const jourLong = (ms, tz = TZ) => fmt({ weekday: "long", day: "numeric", month: "long" }, tz).format(new Date(ms));

/** « aujourd'hui », « demain », « hier », « lundi 26 ». */
export function jourRelatif(ms, maintenant, tz = TZ) {
  const j = horodate(ms, tz).jour;
  if (j === horodate(maintenant, tz).jour) return "aujourd'hui";
  if (j === horodate(debutJour(maintenant, tz) + 30 * H, tz).jour) return "demain";
  if (j === horodate(debutJour(maintenant, tz) - 6 * H, tz).jour) return "hier";
  return fmt({ weekday: "long", day: "numeric" }, tz).format(new Date(ms));
}

/** « aujourd'hui 17:00 », « demain 10:00 », « lundi 26 à 10:00 ». */
export function quand(ms, maintenant, tz = TZ) {
  const jr = jourRelatif(ms, maintenant, tz);
  return ["aujourd'hui", "demain", "hier"].includes(jr) ? `${jr} ${heure(ms, tz)}` : `${jr} à ${heure(ms, tz)}`;
}

/** « 1 h 20 », « 45 min ». */
export function duree(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

// Le temps libre d'ici la fin de la journée utile : ce qui n'est pris ni par un
// rendez-vous, ni par une tâche déjà placée (les chevauchements comptent une fois).
export function tempsLibre(j, maintenant, tz = TZ) {
  const d0 = debutJour(maintenant, tz);
  const fin = Math.min(finJour(maintenant, tz), d0 + FIN_JOURNEE_MIN * MIN);
  if (fin <= maintenant) return 0;
  const pris = (j?.items || [])
    .filter((e) => typeof e.debut === "number")
    .map((e) => [Math.max(maintenant, e.debut), Math.min(fin, e.fin ?? e.debut + DUREE_DEFAUT * MIN)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let occupe = 0;
  let curseur = maintenant;
  for (const [a, b] of pris) {
    const debut = Math.max(a, curseur);
    if (b > debut) occupe += b - debut;
    curseur = Math.max(curseur, b);
  }
  return Math.max(0, Math.round((fin - maintenant - occupe) / MIN));
}

/**
 * Les tâches dont l'échéance ne tient plus, avant qu'elles soient en retard :
 *   - « apres-echeance » : Motion l'a placée après son échéance ;
 *   - « sans-creneau » : due sous 24 h, et aucun créneau prévu ;
 *   - « capacite » : due aujourd'hui sans créneau, et le temps libre restant ne
 *     suffit pas pour tout faire (les plus lointaines débordent).
 * Chacune porte l'action utile : « repousser » (l'échéance, d'un geste
 * annulable) ou « caser » (demander à Rémy, message préparé, jamais envoyé seul).
 */
export function menacees({ taches = [], j = null, maintenant = Date.now(), tz = TZ, max = 5 } = {}) {
  const grace = maintenant - H; // déjà en retard : c'est la liste « en retard »
  const d1 = finJour(maintenant, tz);
  const out = [];
  const sansCreneau = [];
  const demain18 = (ms) => debutJour(debutJour(ms, tz) + 30 * H, tz) + 18 * H;
  for (const t of (Array.isArray(taches) ? taches : []).map(normTache).filter(Boolean)) {
    if (t.echeance === null || t.echeance <= grace) continue;
    if (t.debut !== null && t.fin !== null && t.fin > t.echeance + 5 * MIN) {
      // La nouvelle échéance couvre le créneau (18 h au plus tôt ce jour-là).
      const nouvelle = Math.max(t.fin, debutJour(t.fin, tz) + 18 * H);
      const jr = jourRelatif(nouvelle, maintenant, tz);
      out.push({
        id: t.id, titre: t.titre, echeance: t.echeance, priorite: t.priorite, projet: t.projet,
        raison: "apres-echeance",
        phrase: `Planifiée ${quand(t.debut, maintenant, tz)}, après son échéance (${quand(t.echeance, maintenant, tz)}).`,
        action: { type: "repousser", libelle: `Repousser l'échéance à ${jr === "aujourd'hui" ? heure(nouvelle, tz) : jr}`, echeance: nouvelle },
      });
      continue;
    }
    if (t.debut === null && t.echeance <= maintenant + 24 * H) sansCreneau.push(t);
  }
  // Le temps libre ne compte que pour ce qui est dû aujourd'hui.
  sansCreneau.sort((a, b) => a.echeance - b.echeance || (RANG[a.priorite] ?? 2) - (RANG[b.priorite] ?? 2));
  let libre = j ? tempsLibre(j, maintenant, tz) : null;
  let besoin = 0;
  for (const t of sansCreneau) {
    const aujourdhui = t.echeance < d1;
    const min = t.duree || DUREE_DEFAUT;
    besoin += aujourdhui ? min : 0;
    const deborde = aujourdhui && libre !== null && besoin > libre;
    out.push({
      id: t.id, titre: t.titre, echeance: t.echeance, priorite: t.priorite, projet: t.projet,
      raison: deborde ? "capacite" : "sans-creneau",
      phrase: deborde
        ? `Due ${quand(t.echeance, maintenant, tz)} : il te reste ${duree(libre)} de libre pour ${duree(besoin)} à faire.`
        : `Due ${quand(t.echeance, maintenant, tz)}, aucun créneau prévu.`,
      action: deborde
        ? { type: "repousser", libelle: "Repousser à demain", echeance: demain18(maintenant) }
        : { type: "caser", libelle: "Demander à Rémy de la caser" },
    });
  }
  out.sort((a, b) => a.echeance - b.echeance);
  return out.slice(0, max);
}

// --- Le briefing du matin ------------------------------------------------------------

// Ce qui compte le plus ce jour-là : une tâche due ce jour (la plus prioritaire,
// puis la plus proche), sinon le premier rendez-vous avec d'autres, sinon la
// tâche placée la plus prioritaire.
function choisir(j, menaces) {
  const taches = [
    ...(j?.items || []).filter((e) => e.type === "tache"),
    ...(j?.aFaire || []),
  ].filter((t) => t.bloquee !== true);
  const fin = j?._fin ?? Infinity;
  const dues = taches.filter((t) => typeof t.echeance === "number" && t.echeance < fin);
  const parRang = (a, b) => (RANG[a.priorite] ?? 2) - (RANG[b.priorite] ?? 2) || (a.echeance ?? Infinity) - (b.echeance ?? Infinity);
  const tache = dues.sort(parRang)[0];
  const rdvs = (j?.items || []).filter((e) => e.type === "rdv");
  const avecAutres = rdvs.find((e) => e.avecAutres);
  if (tache && (RANG[tache.priorite] ?? 2) <= 1) return { genre: "tache", e: tache };
  if (avecAutres && !tache) return { genre: "rdv", e: avecAutres };
  if (tache) return { genre: "tache", e: tache };
  if (avecAutres) return { genre: "rdv", e: avecAutres };
  const placee = taches.sort(parRang)[0];
  if (placee) return { genre: "tache", e: placee };
  if (rdvs[0]) return { genre: "rdv", e: rdvs[0] };
  if (menaces[0]) return { genre: "tache", e: menaces[0] };
  return null;
}

const coupe = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// « Motion n'a pas répondu », « Motion et ton agenda n'ont pas répondu ».
const muets = (manque) => `${majuscule(manque.join(" et "))} n'${manque.length > 1 ? "ont" : "a"} pas répondu`;

/**
 * Les trois lignes du matin pour le jour qui contient `pour` (ms) :
 * `{ pour, jour, titre, compte, pourquoi, menace, resume, sujets }`.
 * `sujets` : les sujets encore ouverts de la réflexion de nuit.
 */
export function briefingMatin({ taches = [], evenements = [], pour = Date.now(), maintenant = Date.now(), sujets = [], manque = [], tz = TZ } = {}) {
  // Le jour vu depuis son début (pour demain) ou depuis maintenant (aujourd'hui).
  const d0 = debutJour(pour, tz);
  const vu = Math.max(d0 + MIN, Math.min(maintenant, finJour(pour, tz) - MIN));
  const j = journee({ taches, evenements, maintenant: vu, tz });
  j._fin = finJour(pour, tz);
  const menaces = menacees({ taches, j, maintenant: vu, tz });
  const rdvs = j.items.filter((e) => e.type === "rdv" && e.etat !== "passe");
  const tachesJour = j.items.filter((e) => e.type === "tache" && e.etat !== "passe");
  const planifie = tachesJour.reduce((s, e) => s + Math.round(((e.fin ?? e.debut + DUREE_DEFAUT * MIN) - e.debut) / MIN), 0);
  const c = choisir(j, menaces);

  let compte;
  const raisons = [];
  // Une source muette : on ne prétend pas que la journée est libre.
  const avertissement = manque.length
    ? `${muets(manque)} : ce briefing peut être incomplet.`
    : null;
  if (!c) {
    compte = avertissement ? "Rien de lisible pour l'instant." : "Journée libre : aucun rendez-vous ni échéance.";
  } else if (c.genre === "rdv") {
    compte = `Ce qui compte : « ${coupe(c.e.titre, 70)} » à ${heure(c.e.debut, tz)}.`;
    raisons.push(c.e.avecAutres ? "un rendez-vous avec d'autres, qui ne se déplace pas" : "un rendez-vous fixe");
  } else {
    const avant = typeof c.e.echeance === "number" && c.e.echeance < j._fin ? `, avant ${heure(c.e.echeance, tz)}` : "";
    compte = `Ce qui compte : « ${coupe(c.e.titre, 70)} »${avant}.`;
    if (PRIO[c.e.priorite] && (RANG[c.e.priorite] ?? 2) <= 1) raisons.push(`priorité ${PRIO[c.e.priorite]}`);
    if (avant) raisons.push("échéance ce jour-là");
    if (c.e.projet) raisons.push(`projet ${coupe(c.e.projet, 40)}`);
  }
  if (rdvs.length) raisons.push(`${rdvs.length} rendez-vous fixe${rdvs.length > 1 ? "s" : ""} (premier à ${heure(rdvs[0].debut, tz)})`);
  const ouverts = (sujets || []).filter((s) => s && s.etat !== "traite" && s.etat !== "ignore");
  if (ouverts.length) raisons.push(`cette nuit, Rémy a noté : « ${coupe(String(ouverts[0].texte || ""), 80)} »`);
  const pourquoi = raisons.length ? `Pourquoi : ${raisons.slice(0, 3).join(" ; ")}.` : "Pourquoi : rien d'autre n'est fixé ce jour-là.";

  let menace;
  if (menaces.length) {
    const m = menaces[0];
    const autres = menaces.length > 1 ? ` (et ${menaces.length - 1} autre${menaces.length > 2 ? "s" : ""})` : "";
    const phrase = m.phrase.replace(/\.$/, "");
    menace = `Menacée : « ${coupe(m.titre, 60)} » — ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}${autres}.`;
  } else if (j.retard.total) {
    menace = `Rien de menacé ; ${j.retard.total} tâche${j.retard.total > 1 ? "s" : ""} en retard attend${j.retard.total > 1 ? "ent" : ""} une décision.`;
  } else {
    menace = "Rien de menacé : la journée tient.";
  }

  const morceaux = [];
  if (rdvs.length) morceaux.push(`${rdvs.length} rendez-vous`);
  if (tachesJour.length) morceaux.push(`${tachesJour.length} tâche${tachesJour.length > 1 ? "s" : ""} (${duree(planifie)})`);
  if (j.aFaire.length) morceaux.push(`${j.aFaire.length} sans créneau`);
  return {
    pour: j.jour,
    jour: jourLong(d0 + 12 * H, tz),
    titre: `Ta journée — ${jourLong(d0 + 12 * H, tz)}`,
    compte,
    pourquoi,
    menace,
    resume: morceaux.join(" · ") || "Rien de prévu.",
    menacees: menaces,
    sujets: ouverts.length,
    avertissement,
  };
}

// --- Le bilan du soir --------------------------------------------------------------

/**
 * `faits` : les titres terminés aujourd'hui (journal des écritures).
 * Rend `{ jour, fait, glisse, reste, phrase }`. `reste` : ce qui peut partir à
 * demain d'un geste, chacun avec sa nouvelle échéance (`versDemain`).
 */
export function bilanSoir({ taches = [], evenements = [], faits = [], maintenant = Date.now(), manque = [], tz = TZ } = {}) {
  const j = journee({ taches, evenements, maintenant, tz });
  const d1 = finJour(maintenant, tz);
  const demain0 = d1;
  // La même heure demain (bornée à 9 h–20 h), 18 h sans heure d'origine.
  const versDemain = (ech) => {
    if (typeof ech !== "number") return demain0 + 18 * H;
    const m = Math.min(20 * 60, Math.max(9 * 60, horodate(ech, tz).minute));
    return debutJour(demain0 + 12 * H, tz) + m * MIN;
  };
  const glisse = j.items
    .filter((e) => e.type === "tache" && e.etat === "passe")
    .map((e) => ({ id: e.id, titre: e.titre }));
  const vus = new Set();
  const reste = [];
  const ajouter = (t) => {
    if (!t || vus.has(t.id) || t.bloquee === true) return;
    vus.add(t.id);
    reste.push({ id: t.id, titre: t.titre, echeance: t.echeance ?? null, versDemain: versDemain(t.echeance) });
  };
  for (const e of j.items) if (e.type === "tache" && typeof e.echeance === "number" && e.echeance < d1) ajouter(e);
  for (const t of j.aFaire) ajouter(t);
  for (const t of j.retard.items) ajouter(t);
  const fait = [...new Set(faits.map((f) => String(f || "").trim()).filter(Boolean))].slice(0, 12);
  let phrase;
  if (!fait.length && !reste.length) phrase = "Journée sans échéance : rien à pousser.";
  else if (!reste.length) phrase = `${fait.length} fait${fait.length > 1 ? "s" : ""}, rien ne reste : bravo.`;
  else phrase = `${fait.length} fait${fait.length > 1 ? "s" : ""}, ${reste.length} reste${reste.length > 1 ? "nt" : ""} pour aujourd'hui.`;
  const avertissement = manque.length ? `${muets(manque)} : la liste peut être incomplète.` : null;
  return { jour: j.jour, fait, glisse: glisse.slice(0, 8), reste: reste.slice(0, 12), phrase, avertissement };
}

/** Les titres terminés depuis `depuis` dans le journal des écritures (lignes brutes). */
export function faitsDepuis(lignes = [], depuis = 0) {
  const lire = (v) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : v || [];
    } catch {
      return [];
    }
  };
  const out = [];
  for (const l of lignes) {
    if (!l || l.annule || Number(l.ts) < depuis) continue;
    const actions = lire(l.actions);
    const results = lire(l.results);
    actions.forEach((a, i) => {
      if (a?.type === "terminer" && results?.[i]?.ok !== false) out.push(a.nom || a.titre || results?.[i]?.nom);
    });
  }
  return out.filter(Boolean);
}

/** Le texte rangé pour la nuit : les faits du jour et la ligne de Sam. */
export function texteBilan({ bilan, ressenti = "" }) {
  const l = [`Bilan du soir (${bilan.jour}).`];
  if (bilan.fait.length) l.push(`Fait : ${bilan.fait.join(", ")}.`);
  if (bilan.glisse.length) l.push(`A glissé : ${bilan.glisse.map((g) => g.titre).join(", ")}.`);
  if (bilan.reste.length) l.push(`Restait : ${bilan.reste.map((g) => g.titre).join(", ")}.`);
  const r = String(ressenti || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (r) l.push(`Comment ça s'est passé : ${r}`);
  return l.join("\n");
}
