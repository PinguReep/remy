// Demain et les 7 jours, sans IA : le port de Semaine.swift (ChargeJour,
// JourSemaine, SemaineModel.etat) et des calculs de la vue « À l'échelle »
// (JourneeEtendue.heures, dansLeJour, Couloirs). La tour lit Motion et
// l'agenda pour les jours qui viennent (GET /api/semaine) ; le site dit la
// charge en mots, avec les mêmes chiffres que l'iPhone.
// Module pur : importé par le site et par les tests node (test/site-semaine.test.mjs
// reprend les cas de SemaineTests.swift).
import { heure, duree, finEffective, estRendezVous, dureeTotale, jourISO, jourCourtSemaine, jourTitre, depuis } from "./journee.js";

// --- La charge d'un jour (ChargeJour) : heures de tâches contre heures libres, en minutes ---

/** Libre (rien de placé), léger, chargé (80 % du disponible ou plus), débordé (plus que le disponible). Sans horaires, ou un jour sans horaires de travail : au-delà de 8 h. */
export function niveauCharge(c) {
  const taches = c?.taches ?? 0;
  if (taches <= 0) return "libre";
  const d = c.disponible;
  if (d == null || c.travail === 0) return taches > 8 * 60 ? "charge" : "leger";
  if (taches > d) return "deborde";
  return taches >= d * 0.8 ? "charge" : "leger";
}

/** Entre 0 et 1 : la part du disponible déjà prise (1 si ça déborde). */
export function remplissage(c) {
  const taches = c?.taches ?? 0;
  const d = c?.disponible;
  if (d == null || c.travail === 0) return Math.min(1, taches / (8 * 60));
  if (d <= 0) return taches > 0 ? 1 : 0;
  return Math.min(1, taches / d);
}

/** « 4 h 30 prévues sur 7 h libres », « 2 h prévues », « Rien de prévu », « Pas d'horaires de travail ». */
export function phraseCharge(c) {
  const taches = c?.taches ?? 0;
  const prevu = taches > 0 ? `${duree(taches)} prévue${taches >= 120 ? "s" : ""}` : "Rien de prévu";
  const d = c?.disponible;
  if (d == null) return prevu;
  if (d === 0) return taches > 0 ? `${prevu}, hors horaires` : "Pas d'horaires de travail";
  return `${prevu} sur ${duree(d)} libre${d >= 120 ? "s" : ""}`;
}

/** La charge d'un jour, ou celle de ses tâches si la tour ne l'a pas donnée. */
export const chargeDe = (j) => j?.charge ?? { taches: (j?.items || []).filter((e) => !estRendezVous(e)).reduce((n, e) => n + dureeTotale(e), 0), rdv: 0 };

// --- Un jour de la semaine (JourSemaine) ---
export const rendezVousDe = (j) => (j?.items || []).filter(estRendezVous);
export const tachesDe = (j) => (j?.items || []).filter((e) => !estRendezVous(e));
/** « Lun 26 » */
export const titreCourtJour = (j) => jourCourtSemaine(j.debut);
/** « Lundi 26 octobre » */
export const titreLongJour = (j) => jourTitre(j.debut);
/** Rien du tout ce jour-là. */
export const estVide = (j) => !(j?.items || []).length && !(j?.toute || []).length && !(j?.echeances || []).length;

/** Ce qui mérite un signe : échéance menacée ou tâche placée après son échéance (la même ne compte qu'une fois). */
export function nombreMenaces(j) {
  const ids = new Set((j?.deborde || []).map((t) => t.id));
  return (j?.deborde || []).length + (j?.echeances || []).filter((t) => t.menacee === true && !ids.has(t.id)).length;
}

/** Les menacées d'un jour (CarteJour) : ses échéances que Motion tient mal, puis les tâches placées après leur échéance, due un autre jour. */
export function menaceesDuJour(j) {
  const echeances = j?.echeances || [];
  const ids = new Set(echeances.map((t) => t.id));
  const horsJour = (j?.deborde || []).filter((t) => !ids.has(t.id)).map((t) => ({ id: t.id, titre: t.titre, echeance: t.echeance ?? null, projet: t.projet ?? null, duree: t.duree ?? null, placee: true, menacee: true }));
  return [...echeances.filter((t) => t.menacee === true), ...horsJour];
}

/** En tête d'un jour à l'échelle (ResumeJour) : les échéances menacées ou pas sur la frise. */
export function aSignaler(j) {
  const ids = new Set((j?.items || []).map((e) => e.id));
  return (j?.echeances || []).filter((t) => t.menacee === true || !ids.has(t.id));
}

/** « échéance 18:00 · pas encore placée par Motion » / « · Motion la place après » (LigneEcheance). */
export function detailEcheance(t) {
  const h = t.echeance != null ? `échéance ${heure(t.echeance)}` : "échéance";
  if (t.placee !== true) return `${h} · pas encore placée par Motion`;
  if (t.menacee === true) return `${h} · Motion la place après`;
  return h;
}

/** Le résumé d'une carte : « 2 h prévues sur 6 h libres · 3 échéances ». */
export function resumeJour(j) {
  const bits = [phraseCharge(chargeDe(j))];
  const n = (j?.echeances || []).length;
  if (n > 0) bits.push(`${n} échéance${n > 1 ? "s" : ""}`);
  return bits.join(" · ");
}

/** « 09:00 Podologue · 12:30 Visite de l'atelier » (les rendez-vous fixes, cadenas). */
export const ligneRendezVous = (j) => rendezVousDe(j).map((e) => `${heure(e.debut)} ${e.titre}`).join(" · ");

/** La journée de ce jour telle que « Gérer » la lit (l'impact d'une prolongation avec les bons voisins). */
export function journeeDuJour(j) {
  return {
    jour: j.jour,
    items: j.items || [],
    toute: j.toute || [],
    aFaire: (j.echeances || []).filter((t) => t.placee !== true).map((t) => ({ id: t.id, titre: t.titre, echeance: t.echeance ?? null, projet: t.projet ?? null, priorite: t.priorite ?? null, bloquee: t.bloquee, raison: t.raison, duree: t.duree ?? null })),
  };
}

// --- La semaine telle qu'elle s'affiche (SemaineModel) ---

/** Les jours à afficher, à partir d'aujourd'hui, sans les tâches cochées d'ici. */
export function joursAffiches(s, maintenant = Date.now(), cochees = new Set()) {
  const auj = jourISO(maintenant);
  return (s?.jours || []).filter((j) => j && typeof j.jour === "string" && j.jour >= auj && typeof j.debut === "number").map((j) => {
    if (!cochees.size) return j;
    return {
      ...j,
      items: (j.items || []).filter((e) => !(e.type === "tache" && cochees.has(e.id))),
      echeances: (j.echeances || []).filter((t) => !cochees.has(t.id)),
      deborde: (j.deborde || []).filter((t) => !cochees.has(t.id)),
    };
  });
}

/** « 2026-10-30 » quand on est le 29 (heure de la machine). */
export function demainISO(maintenant = Date.now()) {
  const d = new Date(maintenant);
  return jourISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

/** Minuit (heure de la machine) du jour « 2026-11-20 », ou null si ce n'est pas un vrai jour (« 2026-13-45 »). */
export function debutJourISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return jourISO(d) === iso ? d.getTime() : null;
}

/**
 * Un jour demandé par son adresse (#/aujourdhui/echelle/2026-11-20, un lien
 * ouvert le lendemain…) face aux jours lus : « lu » (dans la liste), « attente »
 * (les jours ne sont pas encore lus : on ne sait rien), « passe » (avant
 * aujourd'hui) ou « hors » (au-delà de ce que la tour a lu). Seul « lu » permet
 * de dire « rien de prévu ».
 */
export function situerJour(iso, jours, { lus = true, maintenant = Date.now() } = {}) {
  if ((jours || []).some((j) => j.jour === iso)) return "lu";
  if (!lus) return "attente";
  return iso < jourISO(maintenant) ? "passe" : "hors";
}

/** Le bandeau de la vue : vue gardée, tour injoignable, mise à jour (null : rien à dire). */
export function etatVue({ misAJour = null, erreur = null, chargement = false } = {}, maintenant = Date.now()) {
  if (misAJour == null) return null;
  const vue = `Vue ${depuis(misAJour, maintenant)}`;
  if (erreur && (erreur.nature === "reseau" || erreur.nature === "delai")) return `${vue} : la tour ne répond pas. Tailscale est-il actif ?`;
  if (erreur) return `${vue} : ${String(erreur.message || erreur).replace(/[.\s]+$/, "")}.`;
  if (chargement) return `${vue}, mise à jour…`;
  return null;
}

/** Les notes sous les 7 jours : horaires inconnus, une source qui n'a pas répondu. */
export function notesSemaine(s) {
  const notes = [];
  if (s && s.horaires == null) notes.push({ texte: "Heures libres inconnues : Motion n'a pas transmis d'horaires de travail. Les heures prévues restent justes.", alerte: false });
  const manque = [s?.sources?.motion === "erreur" ? "Motion" : null, s?.sources?.agenda === "erreur" ? "l'agenda" : null].filter(Boolean);
  if (manque.length) notes.push({ texte: `${manque.join(" et ")} n'a pas répondu : ces jours peuvent être incomplets. Rafraîchis pour réessayer.`, alerte: true });
  return notes;
}

export const VIDES = {
  aujourdhui: "Rien à heure fixe aujourd'hui.",
  demain: "Rien de prévu demain : ni rendez-vous, ni tâche placée par Motion.",
  jour: "Rien de prévu ce jour-là : ni rendez-vous, ni tâche placée par Motion.",
  frise: "Rien à heure fixe ce jour-là.",
  semaine: "Rien de prévu sur les 7 prochains jours : ni rendez-vous, ni tâche placée par Motion.",
  pasAJour: "Demain et les 7 jours arrivent avec la mise à jour de ta tour (scripts/installer-tour.ps1).",
  reseau: "La tour ne répond pas : Tailscale est-il actif ? Rien n'est gardé ici pour ces jours-là.",
  passe: "Ce jour est passé : « À l'échelle » montre aujourd'hui et les 7 prochains jours.",
  hors: "Ce jour n'est pas dans les 7 prochains jours : Rémy ne l'a pas encore lu.",
};

// --- La frise à l'échelle (JourneeEtendue) ---

const minuteDuJour = (ms) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** De la première heure utile à la dernière (8 h – 22 h au moins) ; fini à minuit (ou après) : jusqu'au bout. */
export function heuresFrise(items, jour = null) {
  if (!items.length) return [8, 22];
  const debuts = items.map((e) => Math.floor(minuteDuJour(e.debut) / 60));
  const fins = items.map((e) => (jour && finEffective(e) >= jour[1] ? 24 : Math.floor((minuteDuJour(finEffective(e)) + 59) / 60)));
  return [Math.max(0, Math.min(8, ...debuts)), Math.min(24, Math.max(22, ...fins))];
}

/** Le bout d'un élément qui tombe dans ce jour (une tâche étalée sur plusieurs jours est coupée). */
export function dansLeJour(e, [debut, fin]) {
  const d = Math.min(Math.max(e.debut, debut), fin);
  return { ...e, debut: d, fin: Math.max(d, Math.min(finEffective(e), fin)) };
}

/** Deux éléments qui se chevauchent sont posés côte à côte (Couloirs) : la place de chacun par sa clé type:id. */
export function couloirs(items) {
  const tries = [...items].sort((a, b) => a.debut - b.debut || finEffective(b) - finEffective(a));
  const places = new Map();
  let groupe = [];
  let fins = [];
  let finGroupe = -Infinity;
  const clore = () => {
    const total = Math.max(1, fins.length);
    for (const g of groupe) places.set(g.cle, { index: g.couloir, total });
    groupe = [];
    fins = [];
  };
  for (const e of tries) {
    if (e.debut >= finGroupe) clore();
    const cle = `${e.type}:${e.id}`;
    const libre = fins.findIndex((f) => f <= e.debut);
    if (libre >= 0) {
      fins[libre] = finEffective(e);
      groupe.push({ cle, couloir: libre });
    } else {
      fins.push(finEffective(e));
      groupe.push({ cle, couloir: fins.length - 1 });
    }
    finGroupe = Math.max(finGroupe, finEffective(e));
  }
  clore();
  return places;
}

/** Les bornes d'un jour, de minuit à minuit (heure de la machine). */
export function bornesJour(ms) {
  const d = new Date(ms);
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const d1 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return [d0, d1];
}
