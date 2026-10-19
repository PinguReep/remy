// Le tableau de bord : ce que Sam voit en ouvrant Rémy.
//
// Ce module ne fait aucune entrée/sortie. Il reçoit les données brutes (tâches
// Motion, rendez-vous Google, journal des coûts, mémoire) et rend la journée
// telle qu'elle se lit : une frise horaire, ce qui est en retard, ce qui reste.
// Tout est calculé à l'heure de Sam (Europe/Paris) — sur Vercel l'horloge est
// en UTC, et une « journée » qui commence à 2 h du matin n'a aucun sens pour lui.

import { horodate, TZ } from "./activite.js";

const MIN = 60_000;
const JOUR = 24 * 60 * MIN;

// Minuit (heure de Paris) du jour qui contient `ts`. Les fuseaux ont des
// décalages en minutes entières : secondes et millisecondes sont les mêmes
// qu'en UTC, seule la minute locale compte.
export function debutJour(ts = Date.now(), tz = TZ) {
  const { jour, minute } = horodate(ts, tz);
  let c = ts - minute * MIN - (ts % MIN);
  // Un jour de changement d'heure, le décalage n'est pas le même à minuit et
  // maintenant : on recale (deux passes suffisent, un décalage bouge d'1 h).
  for (let i = 0; i < 2; i++) {
    const h = horodate(c, tz);
    if (h.jour === jour && h.minute === 0) break;
    c += h.jour === jour ? -h.minute * MIN : (24 * 60 - h.minute) * MIN;
  }
  return c;
}

// Minuit du lendemain. Pas « + 24 h » : les jours de changement d'heure font
// 23 ou 25 heures.
export function finJour(ts = Date.now(), tz = TZ) {
  return debutJour(debutJour(ts, tz) + 26 * 60 * MIN, tz);
}

const ms = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

// --- Normalisation des sources ---------------------------------------------------
// Chaque source a son vocabulaire. On le ramène à un seul, et on écarte ce qui
// ne se lit pas plutôt que d'afficher « Invalid Date ».

export function normTache(t) {
  if (!t || typeof t !== "object" || !t.id) return null;
  if (t.completed || t.status?.name === "Completed" || t.status?.isResolvedStatus) return null;
  return {
    id: String(t.id),
    titre: String(t.name || "(sans nom)").slice(0, 200),
    echeance: ms(t.dueDate),
    debut: ms(t.scheduledStart),
    fin: ms(t.scheduledEnd),
    duree: typeof t.duration === "number" ? t.duration : null,
    priorite: typeof t.priority === "string" ? t.priority.toUpperCase() : null,
    projet: t.project?.name ? String(t.project.name).slice(0, 80) : null,
  };
}

export function normEvenement(e) {
  if (!e || typeof e !== "object" || e.status === "cancelled") return null;
  const journee = Boolean(e.start?.date && !e.start?.dateTime);
  // Un événement « journée entière » porte une date sans heure : à lire comme
  // minuit LOCAL, pas minuit UTC (sinon il glisse sur la veille à Paris).
  const debut = journee ? ms(e.start.date + "T12:00:00Z") : ms(e.start?.dateTime);
  const fin = journee ? null : ms(e.end?.dateTime);
  if (debut === null) return null;
  return {
    id: String(e.id || ""),
    titre: String(e.summary || "(sans titre)").slice(0, 200),
    debut,
    fin: fin !== null && fin > debut ? fin : null,
    journee,
    jour: journee ? e.start.date : null,
    // Google rend la fin d'une journée entière EXCLUSIVE : un congé du 3 au 5
    // inclus finit le 6.
    jourFin: journee ? e.end?.date || null : null,
    lieu: e.location ? String(e.location).slice(0, 120) : null,
    // Un vrai rendez-vous (d'autres personnes) ne se modifie pas d'un geste
    // depuis l'app ; une activité à soi (« Aspirateur ») si.
    avecAutres:
      (Array.isArray(e.attendees) && e.attendees.some((a) => a && !a.self && !a.resource)) || (e.organizer ? e.organizer.self === false : false),
  };
}

// --- La journée ------------------------------------------------------------------

function etatDe(debut, fin, maintenant) {
  const f = fin ?? debut + 30 * MIN;
  if (f <= maintenant) return "passe";
  if (debut <= maintenant) return "encours";
  return "avenir";
}

// La frise du jour : rendez-vous (heure fixe, Google) et tâches (créneau
// calculé par Motion) mêlés dans l'ordre du temps. Plus, à part :
//   - les rendez-vous « journée entière » ;
//   - les tâches dues aujourd'hui que Motion n'a pas encore placées ;
//   - les tâches en retard — le chiffre total, et les plus anciennes.
export function journee({ taches = [], evenements = [], maintenant = Date.now(), tz = TZ } = {}) {
  const d0 = debutJour(maintenant, tz);
  const d1 = finJour(maintenant, tz);
  const jour = horodate(maintenant, tz).jour;
  const minuteDe = (t) => (t <= d0 ? 0 : t >= d1 ? 24 * 60 : horodate(t, tz).minute);

  const items = [];
  const toute = [];
  for (const e of evenements.map(normEvenement).filter(Boolean)) {
    if (e.journee) {
      const couvre = e.jour === jour || (e.jour < jour && e.jourFin && jour < e.jourFin);
      if (couvre) toute.push({ type: "rdv", id: e.id, titre: e.titre, lieu: e.lieu });
      continue;
    }
    const fin = e.fin ?? e.debut + 30 * MIN;
    if (fin <= d0 || e.debut >= d1) continue;
    items.push({
      type: "rdv", id: e.id, titre: e.titre, lieu: e.lieu, avecAutres: e.avecAutres,
      debut: e.debut, fin: e.fin,
      min: minuteDe(e.debut), minFin: minuteDe(fin),
      etat: etatDe(e.debut, e.fin, maintenant),
    });
  }

  const aFaire = [];
  const retard = [];
  for (const t of taches.map(normTache).filter(Boolean)) {
    const placeeAujourdhui = t.debut !== null && t.debut < d1 && (t.fin ?? t.debut) >= d0;
    if (placeeAujourdhui) {
      const fin = t.fin ?? t.debut + (t.duree || 30) * MIN;
      items.push({
        type: "tache", id: t.id, titre: t.titre, projet: t.projet, priorite: t.priorite,
        // La durée attribuée dans Motion (« 50 min restantes sur 1 h 15 ») ;
        // l'app la prolonge en valeur absolue : un envoi rejoué ne l'allonge
        // pas deux fois.
        duree: t.duree, echeance: t.echeance,
        debut: t.debut, fin,
        min: minuteDe(t.debut), minFin: minuteDe(fin),
        etat: etatDe(t.debut, fin, maintenant),
        retard: t.echeance !== null && t.echeance < maintenant - 60 * MIN,
      });
      continue;
    }
    // Une heure de grâce : une tâche due « à 17 h » n'est pas en retard à 17 h 05.
    if (t.echeance !== null && t.echeance < maintenant - 60 * MIN) retard.push(t);
    else if (t.echeance !== null && t.echeance < d1) aFaire.push(t);
  }

  items.sort((a, b) => a.debut - b.debut || (a.type === "rdv" ? -1 : 1));
  retard.sort((a, b) => a.echeance - b.echeance);
  aFaire.sort((a, b) => a.echeance - b.echeance);
  const prochain = items.find((i) => i.etat === "encours") || items.find((i) => i.etat === "avenir") || null;

  return {
    jour,
    minute: horodate(maintenant, tz).minute,
    items: items.slice(0, 40),
    toute,
    aFaire: aFaire.slice(0, 12).map(({ id, titre, echeance, projet, priorite, duree }) => ({ id, titre, echeance, projet, priorite, duree })),
    retard: {
      total: retard.length,
      items: retard.slice(0, 6).map(({ id, titre, echeance, projet, priorite, duree }) => ({ id, titre, echeance, projet, priorite, duree })),
    },
    prochain: prochain ? { type: prochain.type, titre: prochain.titre, debut: prochain.debut, etat: prochain.etat } : null,
  };
}

// --- Coûts -----------------------------------------------------------------------
// « Aujourd'hui » = depuis minuit à Paris. Le panneau des coûts prenait minuit
// du serveur (UTC) : entre minuit et 2 h, la journée de Sam démarrait la veille.
export function resumeCouts(entries = [], maintenant = Date.now(), tz = TZ) {
  const d0 = debutJour(maintenant, tz);
  const out = { aujourdhui: 0, jours7: 0, jours30: 0, appelsAujourdhui: 0 };
  for (const e of Array.isArray(entries) ? entries : []) {
    const usd = Number(e?.usd) || 0;
    const ts = Number(e?.ts) || 0;
    if (ts >= d0) {
      out.aujourdhui += usd;
      out.appelsAujourdhui += 1;
    }
    if (ts >= maintenant - 7 * JOUR) out.jours7 += usd;
    if (ts >= maintenant - 30 * JOUR) out.jours30 += usd;
  }
  for (const k of ["aujourdhui", "jours7", "jours30"]) out[k] = Math.round(out[k] * 10_000) / 10_000;
  return out;
}

// --- Mémoire ---------------------------------------------------------------------
// Un chiffre qui parle (« 1 240 mots, 6 sections sur 7 ») sans jamais envoyer le
// contenu au tableau de bord : il n'en a pas besoin.
export const SECTIONS_MEMOIRE = [
  "Identité & contexte", "Objectifs", "Préférences", "Personnes",
  "Projets en cours", "Habitudes & fonctionnement", "Hypothèses",
];

export function resumeMemoire(texte = "") {
  const t = String(texte || "");
  const mots = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  let remplies = 0;
  for (const nom of SECTIONS_MEMOIRE) {
    const re = new RegExp("^##\\s*" + nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "mi");
    const m = re.exec(t);
    if (!m) continue;
    const reste = t.slice(m.index + m[0].length);
    const fin = reste.search(/^##\s/m);
    const corps = fin === -1 ? reste : reste.slice(0, fin);
    if (corps.split("\n").some((l) => l.trim().length > 2)) remplies += 1;
  }
  return { mots, sections: remplies, totalSections: SECTIONS_MEMOIRE.length };
}
