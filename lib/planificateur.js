// Le planificateur « fantôme » (12/11) : Rémy calcule SON planning à partir des
// mêmes tâches que Motion, et dit pour chaque placement pourquoi. Il n'écrit
// rien (ni chez Motion, ni dans un agenda) : il sert à comparer, quelques
// semaines, avant de décider si l'on peut se passer du planificateur de Motion.
//
// Module PUR : aucune entrée/sortie, aucune horloge implicite (`maintenant` est
// un paramètre), aucun hasard. Le fuseau est un paramètre (`tz`) : le résultat
// ne dépend ni de la machine, ni de son fuseau.
//
// Une seule personne = une seule « machine ». Les règles, dans l'ordre :
//   R1 attend    une tâche bloquée par une autre (ou par un projet) ne commence
//                qu'après la fin de ce qu'elle attend ; ce qu'elle attend passe
//                donc devant elle ;
//   R2 pasAvant  la date « pas avant » (startOn de Motion) est respectée ;
//   R3 ferme     une échéance ferme est TENUE dès que c'est possible : avant
//                chaque placement, on vérifie (« la plus proche échéance
//                d'abord », sur le temps libre qui reste) que les échéances
//                fermes encore à placer tiennent toujours ; sinon, celle qui
//                ne tiendrait plus passe devant ;
//   R4 asap      ASAP dans Motion : au plus tôt ;
//   R5 priorite  une tâche d'un projet relié à une priorité CONFIRMÉE, dans
//                l'ordre du classement (n°1 avant n°2) ;
//   R6 echeance  l'échéance la plus proche d'abord (dépassée, ou dans les
//                48 h : avant les priorités) ;
//   R7 motion    la priorité de la tâche dans Motion (haute, moyenne, basse) ;
//   R8 place     ne pas bouger sans raison : une tâche garde le créneau du
//                calcul précédent tant qu'il reste libre et valable.
//
// Chaque tâche est placée au plus tôt dans le temps libre (horaires de
// travail moins l'agenda), dans l'ordre des règles. Une tâche de plus d'une
// heure peut être coupée en morceaux d'au moins 30 min.
//
// Stabilité (un petit changement ne rebat pas tout le planning) :
//   1. même entrée, même sortie (aucun hasard, tris complets) ;
//   2. à règles égales, l'ordre du calcul précédent, puis l'identifiant ;
//   3. R8 : le créneau précédent est repris s'il est encore libre, dans le
//      futur, après ce que la tâche attend, et avant son échéance ;
//   4. au plus tôt, dans l'ordre : un changement à un moment donné ne touche
//      pas ce qui est placé avant lui.
// Ce qui fait bouger une tâche malgré tout : ASAP, une échéance dépassée ou
// dans les 48 h, ou une échéance ferme qui ne tiendrait plus.
//
// Ce qu'il ne sait pas faire (dit à l'écran) : déborder des horaires pour une
// échéance ferme (Motion le fait), les pauses entre tâches, les temps de
// trajet, les tâches récurrentes, une durée absente (il ne la devine pas).

import { horodate } from "./activite.js";
import { debutJour, finJour } from "./dashboard.js";

const MIN = 60_000;
const H = 60 * MIN;

export const REGLES = Object.freeze([
  { id: "attend", nom: "Bloquée : après ce qu'elle attend" },
  { id: "pasAvant", nom: "Pas avant la date « pas avant »" },
  { id: "ferme", nom: "Échéance ferme : tenue d'abord" },
  { id: "asap", nom: "ASAP : au plus tôt" },
  { id: "priorite", nom: "Tes priorités confirmées, dans l'ordre" },
  { id: "echeance", nom: "L'échéance la plus proche d'abord" },
  { id: "motion", nom: "La priorité de la tâche dans Motion" },
  { id: "place", nom: "Ne pas bouger sans raison" },
]);

export const OPTIONS = Object.freeze({
  jours: 14, // l'horizon du calcul
  pasMin: 5, // la grille : rien de plus court que 5 min
  morceauMin: 30, // un morceau d'au moins 30 min
  decoupeDes: 60, // on ne coupe que ce qui dure plus d'une heure
  urgenceH: 48, // une échéance dans les 48 h passe avant les priorités
});

const RANG_MOTION = { ASAP: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const NOM_PRIO = { HIGH: "haute", MEDIUM: "moyenne", LOW: "basse" };
const CLES_JOURS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const HORAIRES_DEFAUT = Object.freeze(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((j) => [j, [{ start: "09:00", end: "18:00" }]])));

// --- Le temps, à l'heure de Sam ---------------------------------------------------------

const formats = new Map();
function fmt(tz, opts) {
  const k = `${tz}|${JSON.stringify(opts)}`;
  if (!formats.has(k)) formats.set(k, new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...opts }));
  return formats.get(k);
}
const heureDe = (ms, tz) => fmt(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
/** « jeu. 14 » */
export const jourDe = (ms, tz) => fmt(tz, { weekday: "short", day: "numeric" }).format(new Date(ms));
/** « aujourd'hui à 15:00 », « demain à 09:00 », « hier à 18:00 », « jeu. 14 à 18:00 ». */
export function quand(ms, maintenant, tz) {
  const j = horodate(ms, tz).jour;
  const auj = debutJour(maintenant, tz);
  if (j === horodate(auj, tz).jour) return `aujourd'hui à ${heureDe(ms, tz)}`;
  if (j === horodate(finJour(auj, tz), tz).jour) return `demain à ${heureDe(ms, tz)}`;
  if (j === horodate(auj - 12 * H, tz).jour) return `hier à ${heureDe(ms, tz)}`;
  return `${jourDe(ms, tz)} à ${heureDe(ms, tz)}`;
}
/** « jeu. 14, 09:00–10:30 » (plusieurs morceaux : le premier et leur nombre). */
export function creneauDit(morceaux, maintenant, tz) {
  if (!morceaux?.length) return "pas placée";
  const [a, b] = [morceaux[0].debut, morceaux[0].fin];
  const t = `${quand(a, maintenant, tz)}–${heureDe(b, tz)}`;
  return morceaux.length > 1 ? `${t} (+${morceaux.length - 1} morceau${morceaux.length > 2 ? "x" : ""})` : t;
}
export function dureeDite(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
}

// L'instant `minute` (depuis minuit, heure locale) du jour qui commence à `d0`.
function aLHeure(d0, minute, tz) {
  const jour = horodate(d0, tz).jour;
  let t = d0 + minute * MIN;
  for (let i = 0; i < 2; i++) {
    const h = horodate(t, tz);
    const vu = h.jour === jour ? h.minute : h.jour > jour ? h.minute + 1440 : h.minute - 1440;
    if (vu === minute) break;
    t -= (vu - minute) * MIN;
  }
  return t;
}

const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  if (v === 23 * 60 + 59) return 24 * 60; // « jusqu'à 23 h 59 » = jusqu'à minuit
  return v >= 0 && v <= 24 * 60 ? v : null;
};

// --- Les intervalles [a, b[ en millisecondes ------------------------------------------------

function reunir(xs) {
  const tries = xs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of tries) {
    const d = out[out.length - 1];
    if (d && a <= d[1]) d[1] = Math.max(d[1], b);
    else out.push([a, b]);
  }
  return out;
}
function soustraire(libres, [c, d]) {
  const out = [];
  for (const [a, b] of libres) {
    if (d <= a || c >= b) out.push([a, b]);
    else {
      if (c > a) out.push([a, c]);
      if (d < b) out.push([d, b]);
    }
  }
  return out;
}
const contenu = (libres, [c, d]) => libres.some(([a, b]) => a <= c && d <= b);

/**
 * Le temps libre de `debut` à `fin` : les horaires de travail de chaque jour
 * (à l'heure locale de `tz`, changements d'heure compris), moins les créneaux
 * pris de l'agenda. Arrondi à la grille de `pasMin`.
 */
export function tempsLibre({ debut, fin, horaires, occupe = [], tz, pasMin = OPTIONS.pasMin }) {
  const pas = pasMin * MIN;
  const plages = [];
  for (let d0 = debutJour(debut, tz); d0 < fin; d0 = finJour(d0, tz)) {
    const jour = horodate(d0, tz).jour;
    const cle = CLES_JOURS[new Date(`${jour}T12:00:00Z`).getUTCDay()];
    for (const p of Array.isArray(horaires?.[cle]) ? horaires[cle] : []) {
      const a = hm(p?.start);
      const b = hm(p?.end);
      if (a === null || b === null || b <= a) continue;
      plages.push([aLHeure(d0, a, tz), b === 1440 ? finJour(d0, tz) : aLHeure(d0, b, tz)]);
    }
  }
  let libres = reunir(plages).map(([a, b]) => [Math.max(a, debut), Math.min(b, fin)]).filter(([a, b]) => b > a);
  for (const o of occupe) {
    if (Number.isFinite(o?.debut) && Number.isFinite(o?.fin) && o.fin > o.debut) libres = soustraire(libres, [o.debut, o.fin]);
  }
  // Sur la grille : un début arrondi au pas suivant, une fin au pas précédent.
  return libres
    .map(([a, b]) => [Math.ceil(a / pas) * pas, Math.floor(b / pas) * pas])
    .filter(([a, b]) => b - a >= pas);
}

/**
 * Le placement au plus tôt d'une durée dans le temps libre, à partir de `des`.
 * Au-delà de `decoupeDes` minutes, en morceaux d'au moins `morceauMin`.
 * Rend [[a, b], …] ou null (ne rentre pas).
 */
export function auPlusTot(libres, dureeMs, des, { morceauMin = OPTIONS.morceauMin, decoupeDes = OPTIONS.decoupeDes } = {}) {
  const mMin = morceauMin * MIN;
  const coupable = dureeMs > decoupeDes * MIN && dureeMs >= 2 * mMin;
  let reste = dureeMs;
  const morceaux = [];
  for (const [a0, b] of libres) {
    if (b <= des) continue;
    const a = Math.max(a0, des);
    const dispo = b - a;
    if (!coupable) {
      if (dispo >= dureeMs) return [[a, a + dureeMs]];
      continue;
    }
    let prendre = Math.min(dispo, reste);
    if (prendre < reste) {
      if (reste - prendre < mMin) prendre = reste - mMin;
      if (prendre < mMin) continue;
    }
    morceaux.push([a, a + prendre]);
    reste -= prendre;
    if (reste <= 0) return morceaux;
  }
  return null;
}

/**
 * La vérification des échéances fermes : « la plus proche échéance d'abord »
 * sur le temps libre, chaque tâche après ce qu'elle attend, coupable à volonté.
 * Sur une seule machine, c'est la meilleure façon de tenir des échéances : si
 * cette simulation en rate une, aucun ordre ne la tient (aux morceaux minimum
 * près). `garde` : [{ id, duree (ms), des, echeance, apres: [id], racine, entier, morceauMin (ms) }].
 * `entier` : la tâche ne se coupe pas (comme au placement, jusqu'à une heure) :
 * elle ne part que dans un trou assez grand ; sinon une autre prête qui y tient
 * prend le trou. Un morceau d'une tâche coupable fait au moins `morceauMin`.
 * Rend { ok: true } ou { ok: false, racine, id, manque (ms) }.
 */
export function tenables(libres, garde) {
  if (!garde.length) return { ok: true };
  const restant = new Map(garde.map((g) => [g.id, g.duree]));
  const tard = new Map(); // le travail fait après l'échéance
  const fini = new Set();
  // Ce qui manque, en temps de travail : ce qui reste à faire une fois l'échéance passée.
  const echec = (g) => ({ ok: false, id: g.id, racine: g.racine ?? g.id, manque: Math.max(MIN, (tard.get(g.id) || 0) + restant.get(g.id)) });
  let i = 0;
  let t = libres[0]?.[0] ?? Infinity;
  for (let garde_ = 0; garde_ < 100_000 && fini.size < garde.length; garde_++) {
    if (i >= libres.length) {
      const reste = garde.filter((g) => !fini.has(g.id)).sort((a, b) => a.echeance - b.echeance || cmpTexte(a.id, b.id))[0];
      return echec(reste);
    }
    const [, b] = libres[i];
    if (t >= b) {
      i++;
      t = Math.max(t, libres[i]?.[0] ?? Infinity);
      continue;
    }
    const prets = garde.filter((g) => !fini.has(g.id) && g.des <= t && g.apres.every((x) => fini.has(x)));
    const avenir = garde.filter((g) => !fini.has(g.id) && g.des > t).map((g) => g.des);
    if (!prets.length) {
      const prochain = avenir.length ? Math.min(...avenir) : Infinity;
      if (!Number.isFinite(prochain)) {
        // Plus rien ne peut partir (attente circulaire, ou ce qu'elles attendent est hors de la garde).
        const reste = garde.filter((g) => !fini.has(g.id)).sort((a, c) => a.echeance - c.echeance || cmpTexte(a.id, c.id))[0];
        return echec(reste);
      }
      t = Math.max(t, prochain);
      while (i < libres.length && libres[i][1] <= t) i++;
      if (i < libres.length) t = Math.max(t, libres[i][0]);
      continue;
    }
    // La plus proche échéance d'abord, parmi celles qui tiennent dans ce trou.
    const place = b - t;
    const g = prets.sort((x, y) => x.echeance - y.echeance || cmpTexte(x.id, y.id))
      .find((x) => (x.entier ? restant.get(x.id) === x.duree && place >= x.duree : place >= Math.min(x.morceauMin || 0, restant.get(x.id))));
    if (!g) {
      // Rien ne tient dans ce qui reste du trou : on passe au suivant.
      i++;
      t = Math.max(t, libres[i]?.[0] ?? Infinity);
      continue;
    }
    const suivant = g.entier ? [] : avenir.filter((d) => d > t);
    const fin = Math.min(b, t + restant.get(g.id), suivant.length ? Math.min(...suivant) : Infinity);
    restant.set(g.id, restant.get(g.id) - (fin - t));
    if (fin > g.echeance) tard.set(g.id, (tard.get(g.id) || 0) + (fin - Math.max(t, g.echeance)));
    t = fin;
    if (restant.get(g.id) <= 0) {
      fini.add(g.id);
      if (t > g.echeance) return echec(g);
    }
  }
  return { ok: true };
}

const cmpTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- Les entrées -------------------------------------------------------------------------

const ms = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Une tâche telle que le planificateur la lit (tolérant : ce qui ne se lit pas est écarté). */
export function normaliser(t) {
  if (!t || typeof t !== "object" || t.id === undefined || t.id === null || t.id === "") return null;
  const duree = typeof t.duree === "number" && Number.isFinite(t.duree) && t.duree > 0 ? Math.round(t.duree) : null;
  const type = String(t.echeanceType || "").toLowerCase();
  // « Aucune » (deadlineType NONE de Motion) : la date n'est pas une échéance.
  const sansEcheance = type === "aucune" || type === "none";
  const prio = typeof t.priorite === "string" ? t.priorite.toUpperCase() : null;
  const pasAvant = typeof t.pasAvant === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.pasAvant) ? t.pasAvant : null;
  const bloqueePar = (Array.isArray(t.bloqueePar) ? t.bloqueePar : [])
    .filter((b) => b && b.id !== undefined && b.id !== null)
    .map((b) => ({ id: String(b.id), nom: String(b.nom || "une autre tâche"), type: b.type === "projet" ? "projet" : "tache" }));
  return {
    id: String(t.id),
    titre: String(t.titre || "(sans nom)").slice(0, 200),
    duree,
    rappel: t.rappel === true,
    echeance: sansEcheance ? null : ms(t.echeance),
    ferme: type === "ferme" || type === "hard",
    pasAvant,
    priorite: prio in RANG_MOTION ? prio : null,
    projetId: t.projetId === undefined || t.projetId === null || t.projetId === "" ? null : String(t.projetId),
    projet: t.projet ? String(t.projet).slice(0, 80) : null,
    bloqueePar,
    enAttente: t.enAttente ? String(t.enAttente === true ? "" : t.enAttente).slice(0, 200) : null,
  };
}

/**
 * Les tâches Motion (brutes, annotées par le carnet : bloqueePar, bloquee,
 * raison, attente) en entrées du planificateur, et le planning de Motion
 * (scheduledStart/End, ses morceaux s'il les donne).
 */
export function depuisMotion(brutes) {
  const taches = [];
  const motion = [];
  for (const t of Array.isArray(brutes) ? brutes : []) {
    if (!t?.id || t.completed || t.status?.isResolvedStatus) continue;
    const duree = typeof t.duration === "number" ? t.duration : null;
    const debut = ms(t.scheduledStart);
    const fin = ms(t.scheduledEnd);
    const startOn = typeof t.startOn === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(t.startOn.trim())?.[1] || null : null;
    // « En attente » à la main (sans tâche attendue) : l'état gardé dans Remy.
    const attenteMain = t.bloquee === true && (!Array.isArray(t.bloqueePar) || !t.bloqueePar.length || t.attente === true);
    const entree = {
      id: String(t.id),
      titre: String(t.name || "(sans nom)").slice(0, 200),
      duree,
      rappel: t.duration === "REMINDER",
      echeance: t.dueDate || null,
      echeanceType: String(t.deadlineType || "SOFT").toUpperCase() === "HARD" ? "ferme" : String(t.deadlineType || "").toUpperCase() === "NONE" ? "aucune" : "souple",
      pasAvant: startOn,
      priorite: t.priority || null,
      projetId: t.project?.id ?? t.projectId ?? null,
      projet: t.project?.name || null,
      // « motion:<id> » : un projet Motion attendu (ses tâches ouvertes) ; « dossier:<id> » :
      // un dossier de Remy, que la liste Motion ne connaît pas (ignoré ici).
      bloqueePar: (Array.isArray(t.bloqueePar) ? t.bloqueePar : []).map((b) => {
        const id = String(b?.id ?? "");
        if (b?.type === "projet" || id.startsWith("motion:")) return { id: id.replace(/^motion:/, ""), nom: b?.nom, type: "projet" };
        return id.startsWith("dossier:") ? null : { id, nom: b?.nom, type: "tache" };
      }).filter(Boolean),
      enAttente: attenteMain ? t.raison || true : null,
    };
    taches.push(entree);
    const morceaux = Array.isArray(t.chunks) && t.chunks.length
      ? t.chunks.map((c) => ({ debut: ms(c.scheduledStart), fin: ms(c.scheduledEnd) })).filter((c) => c.debut !== null && c.fin !== null && c.fin > c.debut).sort((a, b) => a.debut - b.debut)
      : debut !== null ? [{ debut, fin: fin !== null && fin > debut ? fin : debut + (duree || 30) * MIN }] : [];
    motion.push({ id: entree.id, titre: entree.titre, morceaux, debut: morceaux[0]?.debut ?? null, fin: morceaux.at(-1)?.fin ?? null });
  }
  return { taches, motion };
}

// --- Le calcul ---------------------------------------------------------------------------

const debutDuJour = (iso, tz) => debutJour(Date.parse(`${iso}T12:00:00Z`), tz);

/**
 * Le planning de Rémy. Entrées :
 *   maintenant (ms, obligatoire), tz,
 *   taches : [{ id, titre, duree (min), echeance, echeanceType (ferme | souple),
 *             pasAvant (AAAA-MM-JJ), priorite (ASAP | HIGH | MEDIUM | LOW),
 *             projetId, projet, bloqueePar: [{ id, nom, type: tache | projet }],
 *             enAttente (raison) }],
 *   priorites : le classement CONFIRMÉ, dans l'ordre : [{ titre, projetId }],
 *   horaires : { monday: [{ start: "09:00", end: "18:00" }], … } (null : 9 h-18 h en semaine, dit),
 *   occupe : [{ debut, fin }] (l'agenda),
 *   precedent : { placements: [{ id, duree, morceaux: [{ debut, fin }] }] } (le calcul d'avant),
 *   options : voir OPTIONS.
 * Rend { placements, nonPlaces, ordre, horizon, horairesSupposes, regles }.
 */
export function planifier({ maintenant, tz = "Europe/Paris", taches = [], priorites = [], horaires = null, occupe = [], precedent = null, options = {} } = {}) {
  if (!Number.isFinite(maintenant)) throw new TypeError("planifier : `maintenant` est obligatoire (ms)");
  const o = { ...OPTIONS, ...options };
  const pas = o.pasMin * MIN;
  const depart = Math.ceil(maintenant / pas) * pas;
  let fin = debutJour(maintenant, tz);
  for (let k = 0; k < o.jours; k++) fin = finJour(fin, tz);
  const horairesSupposes = !horaires || typeof horaires !== "object" || !Object.values(horaires).some((v) => Array.isArray(v) && v.length);
  let libre = tempsLibre({ debut: depart, fin, horaires: horairesSupposes ? HORAIRES_DEFAUT : horaires, occupe, tz, pasMin: o.pasMin });

  // Les tâches, sans doublon (le premier exemplaire d'un identifiant compte).
  const vues = new Set();
  const liste = [];
  for (const brute of Array.isArray(taches) ? taches : []) {
    const t = normaliser(brute);
    if (!t || vues.has(t.id)) continue;
    vues.add(t.id);
    liste.push(t);
  }
  const parId = new Map(liste.map((t) => [t.id, t]));
  const parProjet = new Map();
  for (const t of liste) if (t.projetId) parProjet.set(t.projetId, [...(parProjet.get(t.projetId) || []), t.id]);

  // Le classement confirmé : projet → { rang, titre } (la mieux classée si deux visent le même projet).
  const rangs = new Map();
  (Array.isArray(priorites) ? priorites : []).forEach((p, i) => {
    const id = p?.projetId ?? p?.projetMotion;
    if (id !== undefined && id !== null && id !== "" && !rangs.has(String(id))) rangs.set(String(id), { rang: i + 1, titre: String(p.titre || "") });
  });

  // Ce que chaque tâche attend, ramené à des tâches de la liste (un projet = ses tâches ouvertes).
  // Ce qui n'est plus dans la liste (finie ailleurs) ne retient plus rien.
  const attend = new Map();
  for (const t of liste) {
    const ids = new Set();
    for (const b of t.bloqueePar) {
      if (b.type === "projet") for (const x of parProjet.get(b.id) || []) { if (x !== t.id) ids.add(x); }
      else if (parId.has(b.id) && b.id !== t.id) ids.add(b.id);
    }
    attend.set(t.id, [...ids].sort(cmpTexte));
  }
  const nomDe = (id) => parId.get(id)?.titre || "une autre tâche";
  // Attente circulaire (le carnet l'empêche ; une liste abîmée pourrait la créer) : le lien est ignoré.
  for (const t of liste) {
    const vu = new Set();
    const pile = [...attend.get(t.id)];
    while (pile.length) {
      const x = pile.pop();
      if (x === t.id) {
        attend.set(t.id, []);
        break;
      }
      if (vu.has(x)) continue;
      vu.add(x);
      pile.push(...(attend.get(x) || []));
    }
  }
  const dependants = new Map(liste.map((t) => [t.id, []]));
  for (const t of liste) for (const b of attend.get(t.id)) dependants.get(b).push(t.id);

  // Les anciennes places (R8).
  const anciennes = new Map();
  for (const p of Array.isArray(precedent?.placements) ? precedent.placements : []) {
    const m = (Array.isArray(p?.morceaux) ? p.morceaux : []).map((x) => [ms(x?.debut), ms(x?.fin)]).filter(([a, b]) => a !== null && b !== null && b > a);
    if (p?.id !== undefined && m.length) anciennes.set(String(p.id), { morceaux: m.sort((a, b) => a[0] - b[0]), duree: Number(p.duree) || null, debut: m[0][0] });
  }

  // --- Ce qui ne se place pas du tout ---
  const nonPlaces = new Map();
  const nonPlacer = (t, genre, raison) => nonPlaces.set(t.id, { id: t.id, titre: t.titre, genre, raison });
  for (const t of liste) {
    if (t.enAttente !== null) nonPlacer(t, "attente", t.enAttente ? `Tu l'as mise en attente : « ${t.enAttente} ».` : "Tu l'as mise en attente.");
    else if (t.rappel) nonPlacer(t, "rappel", "Un rappel, pas un créneau : elle n'occupe pas de temps.");
    else if (!t.duree) nonPlacer(t, "sans-duree", "Sans durée, Rémy ne sait pas quelle place lui faire (Motion non plus).");
  }
  // Ce qui attend une tâche qu'on ne peut pas placer attend, lui aussi.
  for (let tour = 0; tour < liste.length; tour++) {
    let change = false;
    for (const t of liste) {
      if (nonPlaces.has(t.id)) continue;
      const b = attend.get(t.id).find((x) => nonPlaces.has(x));
      if (b) {
        nonPlacer(t, "attend", `Elle attend « ${nomDe(b)} », que Rémy ne peut pas placer.`);
        change = true;
      }
    }
    if (!change) break;
  }
  const aPlacer = liste.filter((t) => !nonPlaces.has(t.id));
  const pasAvantMs = (t) => (t.pasAvant ? debutDuJour(t.pasAvant, tz) : null);
  const desBase = (t) => Math.max(depart, pasAvantMs(t) ?? -Infinity);

  // --- Les places prises ---
  const places = new Map(); // id → { morceaux, ... }
  const finDe = (id) => places.get(id)?.morceaux.at(-1)[1] ?? null;
  // Le plus tôt possible : après ce qu'elle attend. `essai` : une place à l'essai ({ id, fin }).
  const desDe = (t, essai = null) => Math.max(desBase(t), ...attend.get(t.id).map((b) => (essai && b === essai.id ? essai.fin : finDe(b) ?? -Infinity)));

  // --- La garde des échéances fermes ---
  const horizonFin = fin;
  const intenables = new Map(); // id → manque (ms)
  function garde(sauf = null, finSauf = null) {
    const racines = aPlacer.filter((t) => t.ferme && t.echeance !== null && t.echeance <= horizonFin && !places.has(t.id) && !intenables.has(t.id) && t.id !== sauf);
    const echeances = new Map();
    const racineDe = new Map();
    const visiter = (id, e, racine) => {
      if (places.has(id) || id === sauf || nonPlaces.has(id)) return;
      const t = parId.get(id);
      if (!echeances.has(id) || e < echeances.get(id)) {
        echeances.set(id, e);
        racineDe.set(id, racine);
        for (const b of attend.get(id)) visiter(b, e - t.duree * MIN, racine);
      }
    };
    for (const r of racines.sort((a, b) => a.echeance - b.echeance || cmpTexte(a.id, b.id))) visiter(r.id, r.echeance, r.id);
    return [...echeances.keys()].sort(cmpTexte).map((id) => {
      const t = parId.get(id);
      return {
        id, duree: t.duree * MIN, echeance: echeances.get(id), racine: racineDe.get(id),
        des: desDe(t, sauf ? { id: sauf, fin: finSauf } : null), apres: attend.get(id).filter((b) => echeances.has(b)),
        entier: !(t.duree > o.decoupeDes && t.duree >= 2 * o.morceauMin), morceauMin: o.morceauMin * MIN,
      };
    });
  }
  // Au départ : celles qui ne tiennent pas, même placées en premier.
  for (let k = 0; k < liste.length; k++) {
    const v = tenables(libre, garde());
    if (v.ok) break;
    intenables.set(v.racine, v.manque);
  }

  // --- L'ordre des règles ---
  const urgence = maintenant + o.urgenceH * H;
  const cle = (t) => {
    const rang = t.projetId && rangs.has(t.projetId) ? rangs.get(t.projetId).rang : Infinity;
    const e = t.echeance ?? Infinity;
    const p = t.priorite ? RANG_MOTION[t.priorite] : 2.5;
    let groupe;
    if (t.priorite === "ASAP") groupe = 0;
    else if (t.echeance !== null && (t.echeance <= urgence || intenables.has(t.id))) groupe = 1;
    else if (rang < Infinity) groupe = 2;
    else if (t.echeance !== null) groupe = 3;
    else groupe = 4;
    const avant = anciennes.get(t.id)?.debut ?? Infinity;
    const suite = groupe === 2 ? [rang, e, p] : groupe === 4 ? [p, e, rang] : [e, rang, p];
    return { groupe, rang, e, p, valeurs: [groupe, ...suite, avant] };
  };
  const cles = new Map(aPlacer.map((t) => [t.id, cle(t)]));
  const comparer = (a, b) => {
    const x = cles.get(a.id).valeurs;
    const y = cles.get(b.id).valeurs;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return cmpTexte(a.id, b.id);
  };
  const ordre = [...aPlacer].sort(comparer);

  // --- Le placement ---
  const infos = new Map(); // id → { devant: [id], pour: id, gardee, promue }
  const info = (id) => {
    if (!infos.has(id)) infos.set(id, { devant: [], pour: null, gardee: false, promue: false });
    return infos.get(id);
  };
  const enCours = new Set();

  // L'ancienne place, si elle vaut encore : même durée, après ce qu'elle attend et
  // après « pas avant », toujours libre, avant l'échéance. Commencée avant
  // maintenant et pas finie : « en cours », on garde la suite (Rémy ne sait pas
  // qu'elle est commencée, mais la déplacer rebattrait tout ce qui suit).
  // Rend { garder (la place affichée), prendre (ce qui est encore à venir) } ou null.
  function ancienneValable(t, des) {
    const a = anciennes.get(t.id);
    if (!a || (a.duree && a.duree !== t.duree)) return null;
    const total = a.morceaux.reduce((s, [x, y]) => s + (y - x), 0);
    if (total !== t.duree * MIN) return null;
    if (a.morceaux.at(-1)[1] <= depart) return null; // passée : à replacer
    const prendre = a.morceaux.filter(([, y]) => y > depart).map(([x, y]) => [Math.max(x, depart), y]);
    if (prendre[0][0] < des && !(a.morceaux[0][0] < depart && des <= depart)) return null;
    if (!prendre.every((m) => contenu(libre, m))) return null;
    if (t.echeance !== null && a.morceaux.at(-1)[1] > t.echeance) return null;
    return { garder: a.morceaux, prendre, enCours: a.morceaux[0][0] < depart };
  }

  function placer(t, { pour = null } = {}) {
    if (places.has(t.id) || nonPlaces.has(t.id) || enCours.has(t.id)) return;
    enCours.add(t.id);
    if (pour && !info(t.id).pour) info(t.id).pour = pour;
    // R1 : ce qu'elle attend d'abord.
    for (const b of attend.get(t.id)) placer(parId.get(b), { pour: t.id });
    const bloquante = attend.get(t.id).find((b) => !places.has(b));
    if (bloquante) {
      enCours.delete(t.id);
      return nonPlacer(t, "attend", `Elle attend « ${nomDe(bloquante)} », qui ne rentre pas dans les ${o.jours} jours.`);
    }
    const dureeMs = t.duree * MIN;
    // R4 ASAP, et une échéance dépassée ou toute proche : au plus tôt, l'ancienne place n'est pas gardée.
    const groupe = cles.get(t.id).groupe;
    for (let essai = 0; essai <= liste.length; essai++) {
      const des = desDe(t);
      // ASAP : toujours au plus tôt. Les autres gardent une place qui vaut encore (R8).
      const ancienne = groupe >= 1 ? ancienneValable(t, des) : null;
      const m = ancienne ? ancienne.prendre : auPlusTot(libre, dureeMs, des, o);
      if (!m) {
        enCours.delete(t.id);
        const fermee = t.ferme && t.echeance !== null;
        return nonPlacer(t, "ne-rentre-pas", fermee
          ? `Elle ne rentre pas dans tes horaires d'ici son échéance ferme : il faudrait déborder (Motion le fait, Rémy ne le fait pas).`
          : `Elle ne rentre pas dans tes horaires des ${o.jours} jours qui viennent.`);
      }
      let essaiLibre = libre;
      for (const x of m) essaiLibre = soustraire(essaiLibre, x);
      const v = tenables(essaiLibre, garde(t.id, m.at(-1)[1]));
      if (v.ok) {
        libre = essaiLibre;
        places.set(t.id, { morceaux: ancienne ? ancienne.garder : m });
        if (ancienne) info(t.id).gardee = true;
        if (ancienne?.enCours) info(t.id).enCours = true;
        enCours.delete(t.id);
        return;
      }
      // R3 : une échéance ferme ne tiendrait plus après celle-ci : elle passe devant.
      const h = parId.get(v.racine);
      if (!h || places.has(h.id) || nonPlaces.has(h.id) || enCours.has(h.id)) {
        intenables.set(v.racine, v.manque);
        continue;
      }
      info(h.id).promue = true;
      info(h.id).devant.push(t.id);
      placer(h);
      if (!places.has(h.id)) intenables.set(h.id, v.manque);
    }
    enCours.delete(t.id);
    nonPlacer(t, "ne-rentre-pas", "Rémy n'a pas trouvé de place qui tienne les échéances fermes.");
  }
  for (const t of ordre) placer(t);

  // --- Les raisons ---
  const placements = [];
  for (const t of liste) {
    const p = places.get(t.id);
    if (!p) continue;
    const morceaux = p.morceaux.map(([a, b]) => ({ debut: a, fin: b }));
    const debut = morceaux[0].debut;
    const finT = morceaux.at(-1).fin;
    const i = info(t.id);
    const k = cles.get(t.id);
    const faits = [];
    const dit = (regle, texte, force) => faits.push({ regle, texte, force });
    // R1 : après ce qu'elle attend (la dernière à finir).
    const attendues = attend.get(t.id).filter((b) => places.has(b)).sort((a, b) => finDe(b) - finDe(a) || cmpTexte(a, b));
    if (attendues.length) {
      const b = attendues[0];
      const colle = finDe(b) >= debut - 2 * H;
      dit("attend", attendues.length > 1 ? `Après « ${nomDe(b)} » et ${attendues.length - 1} autre${attendues.length > 2 ? "s" : ""} : elle les attend.` : `Après « ${nomDe(b)} » : elle l'attend.`, colle ? 1 : 6);
    }
    if (i.pour && places.has(i.pour)) dit("attend", `Avant « ${nomDe(i.pour)} », qui l'attend.`, 2);
    // R2 : pas avant.
    const pa = pasAvantMs(t);
    if (pa !== null && pa > depart) dit("pasAvant", `Pas avant ${jourDe(pa, tz)} : la date « pas avant » de Motion.`, debut - pa < 24 * H ? 3 : 9);
    // R3 : échéance ferme.
    if (t.ferme && t.echeance !== null) {
      if (intenables.has(t.id) && finT > t.echeance) dit("ferme", `Échéance ferme ${quand(t.echeance, maintenant, tz)} : même au plus tôt, elle ne tient pas dans tes horaires (il manque ${dureeDite(intenables.get(t.id) / MIN)}).`, 0);
      else if (i.promue && i.devant.length) dit("ferme", `Avant « ${nomDe(i.devant[0])} » : son échéance est ferme (${quand(t.echeance, maintenant, tz)}), et elle ne tiendrait plus après.`, 1);
      else if (k.groupe !== 1) dit("ferme", `Échéance ferme ${quand(t.echeance, maintenant, tz)} : tenue.`, 7);
    }
    if (k.groupe === 0) dit("asap", "Marquée ASAP dans Motion : au plus tôt.", 4);
    if (k.groupe === 1 && t.echeance !== null) {
      if (t.echeance < maintenant) dit("echeance", `En retard depuis ${quand(t.echeance, maintenant, tz)} : à rattraper d'abord.`, 4);
      else dit(t.ferme ? "ferme" : "echeance", `${t.ferme ? "Échéance ferme" : "Due"} ${quand(t.echeance, maintenant, tz)} : dans moins de 48 h, elle passe devant.`, 5);
    }
    if (k.rang < Infinity) {
      const r = rangs.get(t.projetId);
      dit("priorite", `Sert ta priorité n°${r.rang}${r.titre ? ` (« ${r.titre} »)` : ""}.`, 5);
    }
    if (k.groupe === 3 && !t.ferme) dit("echeance", `Échéance ${quand(t.echeance, maintenant, tz)}.`, 7);
    const debloque = (dependants.get(t.id) || []).filter((x) => places.has(x) && x !== i.pour);
    if (debloque.length) dit("attend", `Débloque « ${nomDe(debloque[0])} »${debloque.length > 1 ? ` et ${debloque.length - 1} autre${debloque.length > 2 ? "s" : ""}` : ""}.`, 9);
    if (t.priorite && t.priorite !== "ASAP" && NOM_PRIO[t.priorite]) dit("motion", `Priorité ${NOM_PRIO[t.priorite]} dans Motion.`, t.priorite === "HIGH" ? 7 : 10);
    if (i.enCours) dit("place", "Déjà commencée d'après le calcul d'avant : laissée où elle est.", 3.5);
    else if (i.gardee) dit("place", "Gardée à sa place : rien ne l'oblige à bouger.", 6.5);
    faits.sort((a, b) => a.force - b.force);
    const tenue = t.echeance === null ? null : finT <= t.echeance;
    const raison = faits[0]?.texte || "Rien ne la presse : le premier créneau libre après le reste.";
    placements.push({
      id: t.id, titre: t.titre, projet: t.projet, projetId: t.projetId, duree: t.duree,
      debut, fin: finT, morceaux,
      echeance: t.echeance, ferme: t.ferme, tenue,
      regle: faits[0]?.regle || "rien",
      raison,
      details: faits.slice(1).map((f) => f.texte).filter((x) => x !== raison),
      ...(tenue === false ? { alerte: `Finit ${quand(finT, maintenant, tz)}, après son échéance (${quand(t.echeance, maintenant, tz)}).` } : {}),
      ...(i.gardee ? { gardee: true } : {}),
      ...(i.enCours ? { enCours: true } : {}),
      ...(morceaux.length > 1 ? { enMorceaux: morceaux.length } : {}),
    });
  }
  placements.sort((a, b) => a.debut - b.debut || cmpTexte(a.id, b.id));
  return {
    calculeA: maintenant,
    horizon: { debut: depart, fin },
    horairesSupposes,
    regles: REGLES,
    ordre: ordre.map((t) => t.id),
    cles: Object.fromEntries([...cles].map(([id, c]) => [id, { groupe: c.groupe, rang: Number.isFinite(c.rang) ? c.rang : null }])),
    placements,
    nonPlaces: liste.filter((t) => nonPlaces.has(t.id)).map((t) => nonPlaces.get(t.id)),
    attentes: Object.fromEntries([...attend].filter(([, v]) => v.length)),
    promues: Object.fromEntries([...infos].filter(([, v]) => v.promue && v.devant.length).map(([id, v]) => [id, v.devant])),
  };
}

// --- La comparaison avec Motion -------------------------------------------------------------

const GRAVITE = { bloquee: 0, ferme: 1, echeance: 2, ordre: 3 };
const minuscule = (t) => String(t).charAt(0).toLowerCase() + String(t).slice(1).replace(/\.$/, "");

/** Rémy met `a` avant `b` : la règle qui les départage, en mots (null : rien ne les départage). */
function departage(a, b, plan, taches, rangs, maintenant, tz, places) {
  const ta = taches.get(a);
  const tb = taches.get(b);
  // b attend a (même de loin).
  const attentes = plan.attentes || {};
  const pile = [...(attentes[b] || [])];
  const vu = new Set();
  while (pile.length) {
    const x = pile.pop();
    if (x === a) return { regle: "attend", rang: 0, texte: `« ${tb.titre} » attend « ${ta.titre} »` };
    if (vu.has(x)) continue;
    vu.add(x);
    pile.push(...(attentes[x] || []));
  }
  if ((plan.promues?.[a] || []).includes(b)) return { regle: "ferme", rang: 1, texte: `« ${ta.titre} » a une échéance ferme (${quand(ta.echeance, maintenant, tz)}) qui ne tiendrait plus après` };
  const ka = plan.cles[a];
  const kb = plan.cles[b];
  if (!ka || !kb) return null;
  if (ka.groupe < kb.groupe) {
    if (ka.groupe === 0) return { regle: "asap", rang: 3, texte: `« ${ta.titre} » est marquée ASAP` };
    if (ka.groupe === 1) return { regle: "echeance", rang: 4, texte: ta.echeance < maintenant ? `« ${ta.titre} » est en retard (due ${quand(ta.echeance, maintenant, tz)})` : `« ${ta.titre} » est due ${quand(ta.echeance, maintenant, tz)}, bien avant` };
    if (ka.groupe === 2) return { regle: "priorite", rang: 5, texte: `« ${ta.titre} » sert ta priorité n°${ka.rang}${rangs.get(ka.rang) ? ` (« ${rangs.get(ka.rang)} »)` : ""}, pas « ${tb.titre} »` };
    if (ka.groupe === 3) return { regle: "echeance", rang: 6, texte: `« ${ta.titre} » a une échéance (${quand(ta.echeance, maintenant, tz)}), « ${tb.titre} » non` };
    return null;
  }
  if (ka.groupe > kb.groupe) {
    // Rémy fait a d'abord alors que b passe avant dans ses règles : b ne pouvait pas encore commencer.
    const pa = places.get(a)?.debut;
    if (tb.pasAvant && pa !== undefined && debutDuJour(tb.pasAvant, tz) > pa) return { regle: "pasAvant", rang: 2, texte: `« ${tb.titre} » ne peut pas commencer avant ${jourDe(debutDuJour(tb.pasAvant, tz), tz)} (sa date « pas avant »)` };
    const c = (attentes[b] || []).find((x) => places.get(x)?.fin > pa);
    if (c) return { regle: "attend", rang: 0, texte: `« ${tb.titre} » attend « ${taches.get(c)?.titre || "une autre tâche"} », pas encore finie` };
    return null;
  }
  const g = ka.groupe;
  if (g === 2 && ka.rang !== kb.rang) return { regle: "priorite", rang: 5, texte: `« ${ta.titre} » sert ta priorité n°${ka.rang}, « ${tb.titre} » la n°${kb.rang}` };
  if ((g === 1 || g === 3 || g === 2) && ta.echeance !== null && (tb.echeance === null || ta.echeance < tb.echeance) && (tb.echeance === null || tb.echeance - ta.echeance >= H)) {
    return { regle: "echeance", rang: 6, texte: tb.echeance === null ? `« ${ta.titre} » a une échéance (${quand(ta.echeance, maintenant, tz)}), « ${tb.titre} » non` : `« ${ta.titre} » est due avant (${quand(ta.echeance, maintenant, tz)}, contre ${quand(tb.echeance, maintenant, tz)})` };
  }
  const pa = ta.priorite ? RANG_MOTION[ta.priorite] : 2.5;
  const pb = tb.priorite ? RANG_MOTION[tb.priorite] : 2.5;
  if (pa < pb && NOM_PRIO[ta.priorite]) return { regle: "motion", rang: 7, texte: `« ${ta.titre} » a une priorité plus haute dans Motion (${NOM_PRIO[ta.priorite]}${NOM_PRIO[tb.priorite] ? ` contre ${NOM_PRIO[tb.priorite]}` : ""})` };
  return null;
}

/**
 * Les écarts qui comptent entre le planning de Rémy (`plan`, de planifier) et
 * celui de Motion (`motion`, de depuisMotion), chacun avec une ligne de pourquoi :
 *   bloquee  Motion place une tâche avant ce qu'elle attend (ou mise en attente) ;
 *   ferme    une échéance ferme tenue par l'un, pas par l'autre ;
 *   echeance une échéance souple, idem (dans l'horizon) ;
 *   ordre    deux tâches dans l'ordre inverse, quand une règle de Rémy les départage.
 * `taches` : les entrées du planificateur (pour les noms, échéances, attentes).
 * Chaque écart a un identifiant stable (même écart, même identifiant au calcul suivant).
 */
export function comparer({ plan, motion = [], taches = [], priorites = [], maintenant, tz = "Europe/Paris", maxOrdre = 5 } = {}) {
  const t = new Map(taches.map(normaliser).filter(Boolean).map((x) => [x.id, x]));
  const r = new Map(plan.placements.map((p) => [p.id, p]));
  const m = new Map(motion.filter((x) => x?.id).map((x) => [String(x.id), x]));
  const np = new Map(plan.nonPlaces.map((x) => [x.id, x]));
  const rangs = new Map((priorites || []).map((p, i) => [i + 1, String(p?.titre || "")]));
  const ecarts = [];
  const vuesMotion = (id) => m.get(id)?.morceaux || [];
  const motionDit = (id) => creneauDit(vuesMotion(id), maintenant, tz);
  const remyDit = (id) => (r.has(id) ? creneauDit(r.get(id).morceaux, maintenant, tz) : "pas placée");
  const nom = (id) => t.get(id)?.titre || m.get(id)?.titre || "une tâche";

  // 1. Bloquée, et pourtant placée par Motion.
  const signalees = new Set();
  for (const x of t.values()) {
    const mx = m.get(x.id);
    if (!mx?.debut) continue;
    if (x.enAttente !== null) {
      ecarts.push({
        id: `bloquee:${x.id}`, genre: "bloquee", taches: [x.id], titre: x.titre,
        pourquoi: `Tu l'as mise en attente${x.enAttente ? ` (« ${x.enAttente} »)` : ""} : Rémy ne la place pas, Motion la place quand même ${quand(mx.debut, maintenant, tz)}.`,
        remy: "pas placée : en attente", motion: motionDit(x.id),
      });
      signalees.add(x.id);
      continue;
    }
    const attendues = (plan.attentes?.[x.id] || []).filter((b) => {
      const mb = m.get(b);
      return !mb?.fin || mb.fin > mx.debut;
    });
    if (!attendues.length) continue;
    const b = attendues[0];
    const mb = m.get(b);
    ecarts.push({
      id: `bloquee:${x.id}`, genre: "bloquee", taches: [x.id, b], titre: x.titre,
      pourquoi: `Elle attend « ${nom(b)} » : Motion la place ${quand(mx.debut, maintenant, tz)}, ${mb?.debut ? `avant que « ${nom(b)} » soit finie (${quand(mb.fin, maintenant, tz)})` : `alors que « ${nom(b)} » n'est pas placée`}. Rémy la met après.`,
      remy: r.has(x.id) ? remyDit(x.id) : `pas placée : ${np.get(x.id)?.raison || "elle attend"}`, motion: motionDit(x.id),
    });
    signalees.add(x.id);
  }

  // 2 et 3. Les échéances tenues par l'un et pas par l'autre.
  for (const x of t.values()) {
    if (x.echeance === null || x.echeance < maintenant || x.echeance > plan.horizon.fin || signalees.has(x.id)) continue;
    const rx = r.get(x.id);
    const mx = m.get(x.id);
    const tientR = Boolean(rx && rx.fin <= x.echeance);
    const tientM = Boolean(mx?.fin && mx.fin <= x.echeance);
    if (tientR === tientM) continue;
    const genre = x.ferme ? "ferme" : "echeance";
    const qualif = x.ferme ? "ferme" : "souple";
    const pourquoi = tientR
      ? `Échéance ${qualif} ${quand(x.echeance, maintenant, tz)} : Rémy la tient (finie ${quand(rx.fin, maintenant, tz)}), Motion non (${mx?.debut ? `finie ${quand(mx.fin, maintenant, tz)}` : "pas placée"}).`
      : `Échéance ${qualif} ${quand(x.echeance, maintenant, tz)} : Motion la tient, Rémy non (${rx ? `il la finit ${quand(rx.fin, maintenant, tz)}` : `il ne la place pas : ${minuscule(np.get(x.id)?.raison || "pas de place")}`}).`;
    ecarts.push({ id: `${genre}:${x.id}`, genre, taches: [x.id], titre: x.titre, pourquoi, remy: remyDit(x.id), motion: motionDit(x.id), gagnant: tientR ? "remy" : "motion" });
  }

  // 4. L'ordre : deux tâches à venir, placées par les deux, dans l'ordre inverse.
  const communes = [...r.values()].filter((p) => m.get(p.id)?.debut && m.get(p.id).debut >= maintenant - 30 * MIN && t.has(p.id));
  const paires = [];
  for (const a of communes) {
    for (const b of communes) {
      if (a.id === b.id || !(a.debut < b.debut)) continue;
      const ma = m.get(a.id).debut;
      const mb = m.get(b.id).debut;
      if (!(mb < ma)) continue;
      const d = departage(a.id, b.id, plan, t, rangs, maintenant, tz, r);
      if (!d) continue;
      if (d.regle === "attend" && signalees.has(b.id)) continue;
      paires.push({ a, b, d });
    }
  }
  paires.sort((x, y) => x.d.rang - y.d.rang || x.a.debut - y.a.debut || cmpTexte(x.a.id, y.a.id) || cmpTexte(x.b.id, y.b.id));
  const prises = new Set();
  let n = 0;
  for (const { a, b, d } of paires) {
    if (n >= maxOrdre) break;
    if (prises.has(a.id) || prises.has(b.id)) continue;
    prises.add(a.id);
    prises.add(b.id);
    n++;
    ecarts.push({
      id: `ordre:${a.id}:${b.id}`, genre: "ordre", taches: [a.id, b.id], titre: `${a.titre} / ${b.titre}`,
      pourquoi: `Rémy fait « ${a.titre} » avant « ${b.titre} » : ${d.texte}. Motion fait l'inverse.`,
      remy: `${remyDit(a.id)}, puis « ${b.titre} » ${remyDit(b.id)}`,
      motion: `« ${b.titre} » ${motionDit(b.id)}, puis ${motionDit(a.id)}`,
      regle: d.regle,
    });
  }
  ecarts.sort((x, y) => GRAVITE[x.genre] - GRAVITE[y.genre]);
  return ecarts;
}
