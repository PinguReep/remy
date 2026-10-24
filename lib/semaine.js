// Demain et les 7 jours (24/10) : ce que Sam voit d'un coup d'œil, sans
// demander à Rémy.
//
// Aucune IA, aucune entrée/sortie : la tour lit Motion (sa liste en cache, qui
// porte déjà les créneaux des jours suivants), ses horaires (relus toutes les
// 10 min au plus) et l'agenda (UNE requête pour toute la période), puis ce
// module découpe jour par jour, à l'heure de Sam. Par jour :
//   - la frise (rendez-vous et tâches placées), comme la journée ;
//   - les rendez-vous « journée entière » ;
//   - les échéances du jour, placées à temps ou non ;
//   - la charge : heures de tâches placées contre heures disponibles (les
//     horaires Motion, moins les rendez-vous) ;
//   - ce qui déborde : une tâche que Motion place après son échéance.

import { horodate, TZ } from "./activite.js";
import { debutJour, finJour, normTache, normEvenement } from "./dashboard.js";

const MIN = 60_000;
export const JOURS_DEFAUT = 7;
export const JOURS_MAX = 14;
const ITEMS_MAX = 40;

// Les clés des horaires Motion, dans l'ordre de getUTCDay() (0 = dimanche).
const CLES_JOURS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
};

// Les plages de travail d'un jour (« 2026-10-26 ») en minutes depuis minuit :
// [[540, 1080]]. null : horaires inconnus (pas de charge « disponible »).
export function plagesDuJour(horaires, jour) {
  if (!horaires || typeof horaires !== "object") return null;
  const cle = CLES_JOURS[new Date(`${jour}T12:00:00Z`).getUTCDay()];
  const brut = horaires[cle];
  if (!Array.isArray(brut)) return [];
  const plages = [];
  for (const p of brut) {
    const debut = hm(p?.start);
    let fin = hm(p?.end);
    if (debut === null || fin === null) continue;
    if (fin === 23 * 60 + 59) fin = 24 * 60; // « jusqu'à 23 h 59 » = jusqu'à minuit
    if (fin > debut) plages.push([debut, fin]);
  }
  return plages;
}

// Réunion d'intervalles [a, b] (minutes) : deux rendez-vous qui se
// chevauchent ne comptent qu'une fois.
function reunir(intervalles) {
  const tries = intervalles.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of tries) {
    const der = out[out.length - 1];
    if (der && a <= der[1]) der[1] = Math.max(der[1], b);
    else out.push([a, b]);
  }
  return out;
}

const longueur = (intervalles) => intervalles.reduce((s, [a, b]) => s + (b - a), 0);

function intersection(xs, ys) {
  const out = [];
  for (const [a, b] of xs) {
    for (const [c, d] of ys) {
      const debut = Math.max(a, c);
      const fin = Math.min(b, d);
      if (fin > debut) out.push([debut, fin]);
    }
  }
  return out;
}

function etatDe(debut, fin, maintenant) {
  const f = fin ?? debut + 30 * MIN;
  if (f <= maintenant) return "passe";
  if (debut <= maintenant) return "encours";
  return "avenir";
}

const resumeTache = ({ id, titre, echeance, projet, priorite, duree }) => ({ id, titre, echeance, projet, priorite, duree });

// Les `n` jours à partir d'aujourd'hui (heure de Sam).
export function semaine({ taches = [], evenements = [], horaires = null, maintenant = Date.now(), jours = JOURS_DEFAUT, tz = TZ } = {}) {
  const n = Math.max(1, Math.min(JOURS_MAX, Math.floor(Number(jours)) || JOURS_DEFAUT));
  const ts = taches.map(normTache).filter(Boolean);
  const evs = evenements.map(normEvenement).filter(Boolean);

  const out = [];
  let d0 = debutJour(maintenant, tz);
  for (let k = 0; k < n; k++) {
    const d1 = finJour(d0, tz);
    const jour = horodate(d0, tz).jour;
    // Minutes depuis minuit, bornées au jour (un jour de changement d'heure
    // fait 23 ou 25 h : on compte en temps réel écoulé).
    const minuteDe = (t) => Math.round((Math.min(Math.max(t, d0), d1) - d0) / MIN);

    const items = [];
    const toute = [];
    const occupe = [];
    for (const e of evs) {
      if (e.journee) {
        const couvre = e.jour === jour || (e.jour < jour && e.jourFin && jour < e.jourFin);
        if (couvre) toute.push({ type: "rdv", id: e.id, titre: e.titre, lieu: e.lieu });
        continue;
      }
      const fin = e.fin ?? e.debut + 30 * MIN;
      if (fin <= d0 || e.debut >= d1) continue;
      occupe.push([minuteDe(e.debut), minuteDe(fin)]);
      items.push({
        type: "rdv", id: e.id, titre: e.titre, lieu: e.lieu, avecAutres: e.avecAutres,
        debut: e.debut, fin: e.fin,
        min: minuteDe(e.debut), minFin: minuteDe(fin),
        etat: etatDe(e.debut, e.fin, maintenant),
      });
    }

    let minutesTaches = 0;
    const echeances = [];
    const deborde = [];
    for (const t of ts) {
      const fin = t.debut !== null ? t.fin ?? t.debut + (t.duree || 30) * MIN : null;
      // Finie pile à minuit : elle n'est pas du lendemain.
      const placee = t.debut !== null && t.debut < d1 && (fin > d0 || t.debut >= d0);
      if (placee) {
        // Une tâche découpée par Motion peut s'étaler sur plusieurs jours :
        // chaque jour compte sa part de la durée, au prorata de l'étalement
        // (la somme fait la durée, pas la durée à chaque jour).
        const part = Math.max(0, (Math.min(fin, d1) - Math.max(t.debut, d0)) / MIN);
        const etale = Math.max(1, (fin - t.debut) / MIN);
        minutesTaches += Math.round(t.duree ? t.duree * Math.min(1, part / etale) : part);
        const apres = t.echeance !== null && fin > t.echeance;
        items.push({
          type: "tache", id: t.id, titre: t.titre, projet: t.projet, priorite: t.priorite,
          duree: t.duree, echeance: t.echeance,
          debut: t.debut, fin,
          min: minuteDe(t.debut), minFin: minuteDe(fin),
          etat: etatDe(t.debut, fin, maintenant),
          retard: t.echeance !== null && t.echeance < maintenant - 60 * MIN,
          ...(apres ? { apresEcheance: true } : {}),
        });
        // Placée après son échéance (et pas déjà en retard : ça, l'accueil le dit).
        if (apres && t.echeance >= maintenant - 60 * MIN) deborde.push({ ...resumeTache(t), fin });
      }
      if (t.echeance !== null && t.echeance >= d0 && t.echeance < d1) {
        echeances.push({
          ...resumeTache(t),
          placee: t.debut !== null,
          // Motion la finit après l'échéance, ou ne l'a pas placée du tout.
          menacee: t.debut === null || (fin !== null && fin > t.echeance),
        });
      }
    }

    const plages = plagesDuJour(horaires, jour);
    const rdv = reunir(occupe);
    const travail = plages ? longueur(reunir(plages)) : null;
    const disponible = plages ? Math.max(0, travail - longueur(intersection(reunir(plages), rdv))) : null;

    items.sort((a, b) => a.debut - b.debut || (a.type === "rdv" ? -1 : 1));
    echeances.sort((a, b) => a.echeance - b.echeance);
    deborde.sort((a, b) => a.echeance - b.echeance);
    out.push({
      jour,
      debut: d0,
      fin: d1,
      items: items.slice(0, ITEMS_MAX),
      toute,
      echeances: echeances.slice(0, 12),
      deborde: deborde.slice(0, 8),
      charge: {
        taches: minutesTaches,
        rdv: longueur(rdv),
        travail,
        disponible,
      },
    });
    d0 = d1;
  }
  return { maintenant, aujourdhui: out[0].jour, jours: out };
}
