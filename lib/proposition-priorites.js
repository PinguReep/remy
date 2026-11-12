// « Ce que Rémy a compris » (12/11) : une PROPOSITION de classement de ce qui
// compte pour Sam, calculée par la tour sans IA, à partir de ce qu'elle sait
// déjà. Sam ne saisit plus ses priorités : il confirme, corrige (↑ ↓) ou
// écarte. Tant qu'il n'a pas confirmé, c'est une hypothèse : rien d'autre
// (conseil, nuit, « Prochaines heures ») ne s'en sert comme d'un fait.
//
// Module pur : il reçoit un contexte déjà lu (tâches Motion normalisées,
// projets, dossiers et leurs notes, tâches cochées dans Rémy, priorités
// déclarées) et rend des candidats classés, chacun avec ses INDICES lisibles
// (« 6 h planifiées sur les 14 prochains jours », « échéance ferme jeu 14 »,
// « rien dans Rémy depuis 12 jours »). La lecture vit dans handlers.js.
//
// Ce que ces indices NE voient PAS : ce qui avance hors de Motion et de Rémy
// (du code dans Claude Code ou T3, du papier, un coup de fil), l'importance
// qui ne se mesure pas en heures (une tâche courte mais décisive), un projet
// qui n'a pas de projet Motion. D'où `LIMITES`, affiché à l'écran.
//
// Les SOURCES d'indices sont une liste : un lot suivant y ajoute le modèle
// local (mémoire et conversations, en local seulement) ou l'état des fils T3
// Code. Chaque source est une fonction pure du contexte ; ce qui demande une
// lecture lente ou une IA est préparé dans le contexte avant l'appel, jamais
// ici, et jamais à l'ouverture d'un écran sans circuit coupable.

import { normaliser } from "./regles.js";
import { reconnait, motsDe } from "./priorites.js";

const MIN = 60_000;
const JOUR = 86_400_000;
export const HORIZON_JOURS = 14;
export const MAX_CANDIDATS = 8;
export const LIMITES = "Rémy ne voit que Motion et ce qui passe par lui : ce qui avance ailleurs (du code dans Claude Code ou T3, du papier, un coup de fil) n'y apparaît pas, ni l'importance d'une chose courte.";

const F_JOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris", weekday: "short", day: "numeric", month: "short" });
const jourCourt = (ms) => F_JOUR.format(new Date(ms));
const heures = (min) => {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
};
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** Un indice : ce qu'il dit, d'où il vient, ce qu'il pèse dans la proposition. */
const indice = (source, texte, points = 0) => ({ source, texte, points });

// --- Les sources ----------------------------------------------------------------

/** Motion : le temps planifié, les échéances proches, les tâches ouvertes, par projet. */
function indicesMotion({ taches = [], projets = null, maintenant = Date.now() }) {
  const fin = maintenant + HORIZON_JOURS * JOUR;
  const par = new Map();
  const noms = new Map((projets || []).map((p) => [String(p.id), p.nom]));
  for (const t of taches) {
    if (!t?.projetId) continue;
    const c = par.get(t.projetId) || { minutes: 0, ouvertes: 0, fermes: [], proches: 0, retard: 0, nom: noms.get(t.projetId) || t.projet || null };
    c.ouvertes++;
    if (typeof t.debut === "number" && t.debut >= maintenant - 60 * MIN && t.debut < fin) {
      const span = t.fin && t.fin > t.debut ? (t.fin - t.debut) / MIN : 0;
      c.minutes += typeof t.duree === "number" && t.duree > 0 ? t.duree : span;
    }
    if (typeof t.echeance === "number") {
      if (t.echeance < maintenant - 60 * MIN) c.retard++;
      else if (t.deadlineType === "HARD" && t.echeance < fin) c.fermes.push(t.echeance);
      else if (t.deadlineType !== "NONE" && t.echeance < maintenant + 7 * JOUR) c.proches++;
    }
    par.set(t.projetId, c);
  }
  // Un projet Motion ouvert sans aucune tâche : il existe, mais rien ne le porte.
  for (const p of projets || []) if (!par.has(String(p.id))) par.set(String(p.id), { minutes: 0, ouvertes: 0, fermes: [], proches: 0, retard: 0, nom: p.nom });
  const out = [];
  for (const [id, c] of par) {
    const ind = [];
    if (c.minutes >= 15) ind.push(indice("motion", `${heures(c.minutes)} planifiées sur les ${HORIZON_JOURS} prochains jours`, Math.min(20, c.minutes / 60)));
    if (c.fermes.length) {
      const premiere = Math.min(...c.fermes);
      ind.push(indice("motion", c.fermes.length > 1 ? `${c.fermes.length} échéances fermes, la première ${jourCourt(premiere)}` : `Échéance ferme ${jourCourt(premiere)}`, 6 + Math.min(4, c.fermes.length - 1)));
    }
    if (c.proches) ind.push(indice("motion", `${pluriel(c.proches, "échéance", "échéances")} d'ici 7 jours`, Math.min(6, 2 * c.proches)));
    if (c.retard) ind.push(indice("motion", `${pluriel(c.retard, "tâche en retard", "tâches en retard")}`, Math.min(3, c.retard)));
    if (c.ouvertes) ind.push(indice("motion", `${pluriel(c.ouvertes, "tâche ouverte", "tâches ouvertes")}`, Math.min(5, c.ouvertes * 0.5)));
    else ind.push(indice("motion", "Aucune tâche ouverte dans Motion", 0));
    out.push({ cle: `motion:${id}`, titre: c.nom || "Projet Motion", projetMotion: id, projetNom: c.nom || null, indices: ind });
  }
  return out;
}

/**
 * Rémy : ce qui a bougé ici pour ce projet — ses dossiers (rangés sous lui ou
 * reliés à lui) et leurs idées, les tâches rangées dedans, les tâches cochées
 * depuis Rémy. Les rappels ne sont rattachés à aucun projet : ils n'en disent
 * rien (pas de devinette par les mots).
 */
function indicesCarnet({ dossiers = [], coches = [], projets = null, taches = [], maintenant = Date.now() }) {
  const ids = new Set([...(projets || []).map((p) => String(p.id)), ...taches.map((t) => t?.projetId).filter(Boolean)]);
  const nomDe = new Map([...(projets || []).map((p) => [String(p.id), p.nom]), ...taches.filter((t) => t?.projetId && t.projet).map((t) => [t.projetId, t.projet])]);
  const out = [];
  for (const id of ids) {
    // Les dossiers du projet, et leurs sous-dossiers (un niveau suffit : c'est ce que l'arbre de Rémy permet).
    const racines = dossiers.filter((d) => d.parent === `motion:${id}` || d.projetMotion === id);
    const sous = dossiers.filter((d) => racines.some((r) => d.parent === r.id));
    const siens = [...racines, ...sous];
    const nom = nomDe.get(id);
    const dates = [...siens.map((d) => d.dernier || 0), ...coches.filter((c) => c.projet && nom && c.projet === nom).map((c) => c.a)].filter((x) => x > 0);
    const ouvertes = siens.reduce((n, d) => n + (d.ouvertes || 0), 0);
    const ind = [];
    if (dates.length) {
      const jours = Math.floor((maintenant - Math.max(...dates)) / JOUR);
      if (jours <= 7) ind.push(indice("carnet", jours === 0 ? "Avancé dans Rémy aujourd'hui" : jours === 1 ? "Avancé dans Rémy hier" : `Avancé dans Rémy il y a ${jours} jours`, 3));
      else if (jours >= 14) ind.push(indice("carnet", `Rien dans Rémy depuis ${jours} jours`, 0));
    }
    if (ouvertes) ind.push(indice("carnet", `${pluriel(ouvertes, "idée ouverte", "idées ouvertes")} dans ses dossiers`, Math.min(2, ouvertes * 0.5)));
    if (ind.length) out.push({ cle: `motion:${id}`, indices: ind });
  }
  return out;
}

/**
 * Ce que Sam a déjà écrit lui-même : une priorité reliée à un projet le
 * renforce ; une priorité dont les mots ressemblent au nom d'un projet le
 * renforce aussi, en le disant (« ressemble ») ; les autres sont des
 * candidates à part entière.
 */
function indicesDeclarees({ declarees = [], projets = null, taches = [] }) {
  const projetsConnus = [...new Map([...(projets || []).map((p) => [String(p.id), p.nom]), ...taches.filter((t) => t?.projetId && t.projet).map((t) => [t.projetId, t.projet])]).entries()];
  const out = [];
  for (const p of declarees) {
    if (!p?.id || !p.titre) continue;
    const base = { declaree: { id: p.id, titre: p.titre, pourquoi: p.pourquoi || "", mots: p.mots || [] } };
    if (p.projetMotion) {
      out.push({ cle: `motion:${p.projetMotion}`, titre: p.titre, projetMotion: p.projetMotion, projetNom: p.projetNom || null, ...base, indices: [indice("declarees", `Tu l'as écrite toi-même : « ${p.titre} »`, 8)] });
      continue;
    }
    const mots = motsDe(p);
    const proche = mots.length ? projetsConnus.find(([, nom]) => nom && reconnait(mots, nom)) : null;
    if (proche) {
      out.push({ cle: `motion:${proche[0]}`, titre: p.titre, projetMotion: proche[0], projetNom: proche[1], ...base, indices: [indice("declarees", `Tu as écrit « ${p.titre} », qui ressemble à ce projet`, 8)] });
    } else {
      out.push({ cle: `declaree:${p.id}`, titre: p.titre, projetMotion: null, projetNom: null, ...base, indices: [indice("declarees", "Tu l'as écrite toi-même, sans projet Motion", 8)] });
    }
  }
  return out;
}

/**
 * Les sources d'indices, dans l'ordre où leurs indices s'affichent. Une
 * source : { id, nom, indices(contexte) → [{ cle, titre?, projetMotion?,
 * projetNom?, declaree?, indices: [{ source, texte, points }] }] }.
 * À venir (lot suivant) : « memoire » (le modèle local lisant la mémoire et
 * les conversations, préparé de nuit), « t3 » (l'état des fils T3 Code).
 */
export const SOURCES_INDICES = [
  { id: "declarees", nom: "Ce que tu as écrit", indices: indicesDeclarees },
  { id: "motion", nom: "Motion", indices: indicesMotion },
  { id: "carnet", nom: "Rémy (dossiers, idées, tâches cochées)", indices: indicesCarnet },
];

/**
 * La proposition : les candidats fusionnés (une clé = un projet Motion, ou
 * une priorité écrite sans projet), classés par le poids de leurs indices.
 * `ecartees` : les clés que Sam a dites « pas une priorité » ; `classees` :
 * ce qui est déjà dans son classement confirmé (identifiants de priorités et
 * de projets Motion) — ni les unes ni les autres ne sont reproposées.
 */
export function proposerClassement(contexte = {}, sources = SOURCES_INDICES) {
  const ecartees = new Set(contexte.ecartees || []);
  const classeesIds = new Set(contexte.classees?.priorites || []);
  const classeesProjets = new Set(contexte.classees?.projets || []);
  const par = new Map();
  for (const s of sources) {
    let liste = [];
    try {
      liste = s.indices(contexte) || [];
    } catch (err) {
      // Une source qui casse n'enlève que ses indices.
      console.warn(`Proposition de priorités : la source « ${s.id} » a échoué :`, err?.message);
      continue;
    }
    for (const c of liste) {
      if (!c?.cle) continue;
      const deja = par.get(c.cle) || { cle: c.cle, titre: null, projetMotion: null, projetNom: null, declaree: null, indices: [] };
      // Les mots de Sam l'emportent sur le nom du projet.
      if (c.declaree && !deja.declaree) {
        deja.declaree = c.declaree;
        deja.titre = c.titre || deja.titre;
      } else if (!deja.titre && c.titre) deja.titre = c.titre;
      if (c.projetMotion && !deja.projetMotion) deja.projetMotion = c.projetMotion;
      if (c.projetNom && !deja.projetNom) deja.projetNom = c.projetNom;
      deja.indices.push(...(c.indices || []));
      par.set(c.cle, deja);
    }
  }
  const candidats = [...par.values()]
    .filter((c) => !ecartees.has(c.cle))
    .filter((c) => !(c.declaree && classeesIds.has(c.declaree.id)) && !(c.projetMotion && classeesProjets.has(c.projetMotion)))
    .map((c) => ({ ...c, titre: c.titre || c.projetNom || "Sans nom", score: Math.round(c.indices.reduce((n, i) => n + (i.points || 0), 0) * 10) / 10 }))
    // Rien qui pèse (un projet vide, sans trace) : ce n'est pas une piste.
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score || normaliser(a.titre).localeCompare(normaliser(b.titre), "fr"))
    .slice(0, MAX_CANDIDATS)
    .map((c) => ({ ...c, indices: c.indices.filter((i) => i.texte).map(({ source, texte }) => ({ source, texte })) }));
  return { candidats, sources: sources.map(({ id, nom }) => ({ id, nom })), limites: LIMITES };
}
