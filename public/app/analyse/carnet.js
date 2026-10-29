// Le carnet sans l'écran (port de Carnet.swift, Organisation.swift,
// Ergonomie.swift, EtiquettesVues.swift et des vues de Projets de l'iPhone) :
// rappels à traiter, filtre par étiquettes, groupes de rappels, « Plus tard »,
// tuiles des listes, arborescence des dossiers, projets Motion, historique.
// Module pur : rien ici ne touche à la page (testé sous node).
import { extraire, sansFormule } from "./dates.js";
import { texte as texteCapture } from "./genre.js";

const fmt = (opts) => new Intl.DateTimeFormat("fr-FR", opts);
const F_HEURE = fmt({ hour: "2-digit", minute: "2-digit" });
const F_JOUR_SEMAINE_COURT = fmt({ weekday: "short", day: "numeric", month: "short" });
const F_JOUR_COURT = fmt({ day: "numeric", month: "short" });
const F_JOUR_LONG = fmt({ weekday: "long", day: "numeric", month: "long" });
const F_ENTIER = new Intl.NumberFormat("fr-FR");
const s = (n) => (n > 1 ? "s" : "");
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// --- Rappels ---

/** « aujourd'hui 18:00 », « demain 09:00 », « jeu. 22 oct. 09:00 » (CarnetModel.quand). */
export function quandRappel(ms, maintenant = new Date()) {
  const d = new Date(ms);
  const m = new Date(maintenant);
  const ecart = Math.round((debutJour(d) - debutJour(m)) / 86400000);
  const annee = d.getFullYear() === m.getFullYear() ? "" : ` ${d.getFullYear()}`;
  const jour = ecart === 0 ? "aujourd'hui" : ecart === 1 ? "demain" : ecart === -1 ? "hier" : F_JOUR_SEMAINE_COURT.format(d) + annee;
  return `${jour} ${F_HEURE.format(d)}`;
}

/** Au quart d'heure SUPÉRIEUR, jamais moins que l'écart annoncé (Decaler.arrondi). */
export function arrondiQuart(d) {
  const t = new Date(Math.floor(new Date(d).getTime() / 1000) * 1000);
  const reste = (t.getMinutes() % 15) * 60 + t.getSeconds();
  return reste === 0 ? t : new Date(t.getTime() + (15 * 60 - reste) * 1000);
}

/** Reporter un rappel : dans 1 h, ce soir 19:00 (avant 18 h), demain 9:00, lundi 9:00 quand lundi n'est pas demain (Decaler.rappel). */
export function choixRappel(maintenant = new Date()) {
  const m = new Date(maintenant);
  const a = (hh, mi, j) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + j, hh, mi);
  const choix = [{ id: "plus-60", libelle: "Dans 1 h", date: arrondiQuart(new Date(m.getTime() + 3600e3)) }];
  if (m.getHours() * 60 + m.getMinutes() < 18 * 60) choix.push({ id: "ce-soir", libelle: "Ce soir 19:00", date: a(19, 0, 0) });
  choix.push({ id: "demain", libelle: "Demain 9:00", date: a(9, 0, 1) });
  const lundi = (1 - m.getDay() + 7) % 7 || 7;
  if (lundi > 1) choix.push({ id: "lundi", libelle: "Lundi 9:00", date: a(9, 0, lundi) });
  return choix;
}

/** Le geste rapide « Plus tard » : +1 h, au quart d'heure (le premier choix de Decaler.rappel). */
export const plusTard = (maintenant = new Date()) => choixRappel(maintenant)[0].date;

/** À faire, datés d'abord (les plus proches en tête), puis sans date ; les faits à la fin (CarnetModel.trier). */
export function trierRappels(rappels) {
  return [...(rappels || [])].sort((a, b) => {
    if (Boolean(a.fait) !== Boolean(b.fait)) return a.fait ? 1 : -1;
    const qa = typeof a.quand === "number" ? a.quand : null;
    const qb = typeof b.quand === "number" ? b.quand : null;
    if (qa != null && qb != null) return qa - qb;
    if (qa != null) return -1;
    if (qb != null) return 1;
    return a.texte < b.texte ? -1 : a.texte > b.texte ? 1 : 0;
  });
}

const idsDe = (etiquettes) => new Set([...(etiquettes || [])].map((e) => (typeof e === "string" ? e : e?.id)).filter(Boolean));

/**
 * Les rappels à traiter (CarnetModel.aTraiter, Sam, 18/10) : pas faits, sans
 * date, ou sans aucune des étiquettes du compte quand il en a. `etiquettes` :
 * les étiquettes du compte (objets ou identifiants).
 */
export function aTraiter(rappels, etiquettes) {
  const ids = idsDe(etiquettes);
  return trierRappels((rappels || []).filter((r) => r && !r.fait && !r.supprime
    && (typeof r.quand !== "number" || (ids.size > 0 && !(r.etiquettes || []).some((e) => ids.has(e))))));
}

// --- Le filtre par étiquettes (FiltreRappels) ---

export const CLE_FILTRE = "filtreRappels";
export const SANS_ETIQUETTE = "_sans";
/** « a,b » → { a, b } (les morceaux vides sont sautés). */
export const lireFiltre = (brut) => new Set(String(brut || "").split(",").filter(Boolean));
/** { b, a } → « a,b » (trié : la même clé quel que soit l'ordre des coches). */
export const ecrireFiltre = (filtre) => [...(filtre || [])].sort().join(",");
/** Filtre vide : tout ; sans étiquette : si « Sans étiquette » est coché ; sinon au moins une étiquette cochée. */
export function garderRappel(r, filtre) {
  if (!filtre || !filtre.size) return true;
  const e = r?.etiquettes || [];
  if (!e.length) return filtre.has(SANS_ETIQUETTE);
  return e.some((x) => filtre.has(x));
}
/** Le pied de la feuille « Filtrer les rappels ». */
export const piedFiltre = (filtre) => (filtre?.size ? "Seuls les rappels de ces étiquettes s'affichent." : "Tout est affiché. Coche une ou plusieurs étiquettes pour ne voir qu'elles.");
/** Le bouton : « Filtrer » ou « Filtré (n) », et ce qu'il dit à un lecteur d'écran. */
export const boutonFiltreTextes = (n) => (n > 0 ? { libelle: `Filtré (${n})`, etiquette: `Filtre des rappels, ${n} choix` } : { libelle: "Filtrer", etiquette: "Filtrer les rappels" });
/** « Aucun rappel du jour avec ces étiquettes (2 masqués). » */
export const phraseMasques = (n, { duJour = true } = {}) => `Aucun rappel${duJour ? " du jour" : ""} avec ces étiquettes (${n} masqué${s(n)}).`;

/**
 * Les groupes de Projets › Rappels (RappelsView) : En retard, Aujourd'hui,
 * Plus tard, Sans date, Faits ; un groupe vide n'est pas rendu.
 */
export function groupesRappels(rappels, maintenant = Date.now()) {
  const m = new Date(maintenant);
  const t = m.getTime();
  const fin = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 1).getTime();
  const tous = trierRappels((rappels || []).filter((r) => r && !r.supprime));
  const date = (r) => typeof r.quand === "number";
  return [
    { id: "retard", titre: "En retard", danger: true, rappels: tous.filter((r) => !r.fait && date(r) && r.quand < t) },
    { id: "aujourdhui", titre: "Aujourd'hui", rappels: tous.filter((r) => !r.fait && date(r) && r.quand >= t && r.quand < fin) },
    { id: "plus-tard", titre: "Plus tard", rappels: tous.filter((r) => !r.fait && date(r) && r.quand >= fin) },
    { id: "sans-date", titre: "Sans date", rappels: tous.filter((r) => !r.fait && !date(r)) },
    { id: "faits", titre: "Faits", rappels: tous.filter((r) => r.fait) },
  ].filter((g) => g.rappels.length);
}

/** Les étiquettes d'un rappel, dans l'ordre du compte ; une étiquette supprimée disparaît (OrganisationModel.noms). */
export function nomsEtiquettes(ids, etiquettes) {
  const voulues = new Set(ids || []);
  return voulues.size ? (etiquettes || []).filter((e) => voulues.has(e.id)).map((e) => e.nom) : [];
}
/** Les identifiants cochés, dans l'ordre des étiquettes du compte (les inconnus partent). */
export const dansLOrdre = (coches, etiquettes) => (etiquettes || []).map((e) => e.id).filter((id) => coches.has(id));

/**
 * Le texte d'un nouveau rappel (NouveauRappel) : la date lue part du texte
 * seulement si elle était au bout, et seulement si Sam n'a pas réglé le
 * sélecteur lui-même ; la façon de le demander part toujours.
 */
export function texteNouveauRappel(brut, { dateTouchee = false, maintenant = new Date() } = {}) {
  const lue = dateTouchee ? null : extraire(String(brut || ""), maintenant);
  return (lue ? texteCapture(brut, lue, "rappel") : sansFormule(String(brut || ""))).slice(0, 300);
}

// --- Le tri des rappels (OnboardingRappels) ---

/** Les catégories proposées au premier tri (des exemples, pas une liste figée). */
export const CATEGORIES_PROPOSEES = ["Personnel", "Professionnel", "Santé", "Voiture", "Administratif", "Famille et amis", "Anniversaire"];
export const PIED_CATEGORIES = "Ce sont des exemples : garde, renomme, supprime ou ajoute ce qui te parle. Une catégorie dit le domaine d'un rappel (Santé, Voiture…), pas s'il est daté.";
export const PIED_TRI = "Un rappel est rangé quand il a une date et une catégorie. Garder (rappel ou to-do), en faire une tâche Motion, ou ne rien changer : rien ne part avant « Valider ».";

/** Une date à régler : demain 9 h. */
export const parDefautTri = (maintenant = new Date()) => {
  const m = new Date(maintenant);
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() + 1, 9, 0);
};

const cleNom = (n) => String(n || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
/**
 * Ce que l'étape 1 écrit (validerCategories) : les étiquettes retirées, les
 * renommées (leur ordre reste), les nouvelles (à la suite) ; une nouvelle qui
 * porte le nom d'une autre n'est pas recréée. `lignes` : { etiquette?, idNouveau, nom }.
 */
export function planCategories(lignes, etiquettes) {
  // Une ligne nouvelle déjà écrite (un essai à moitié passé) est retrouvée par son identifiant.
  const ref = (l) => l.etiquette || l.idNouveau;
  const existe = (l) => (etiquettes || []).find((x) => x.id === ref(l));
  const gardees = (lignes || []).map((l) => ({ ...l, nom: String(l.nom || "").trim().slice(0, 40) })).filter((l) => l.nom);
  const ids = new Set(gardees.map(ref).filter(Boolean));
  const supprimer = (etiquettes || []).filter((e) => !ids.has(e.id)).map((e) => e.id);
  const ecrire = [];
  const noms = new Set();
  let ordre = Math.max(-1, ...(etiquettes || []).map((e) => e.ordre ?? -1));
  for (const l of gardees) {
    const e = existe(l);
    if (e) {
      noms.add(cleNom(l.nom));
      if (e.nom !== l.nom) ecrire.push({ id: e.id, nom: l.nom, ordre: e.ordre ?? 0 });
    }
  }
  for (const l of gardees) {
    if (existe(l)) continue;
    if (noms.has(cleNom(l.nom))) continue;
    noms.add(cleNom(l.nom));
    // Un essai repris garde le rang choisi la première fois (`l.ordre`).
    const rang = l.ordre ?? ++ordre;
    ordre = Math.max(ordre, rang);
    ecrire.push({ id: l.idNouveau, nom: l.nom, ordre: rang });
  }
  return { supprimer, ecrire, nombre: noms.size };
}

/** « Valider ces 7 catégories » (une seule : « Valider cette catégorie »). */
export const libelleValiderCategories = (n) => (n === 1 ? "Valider cette catégorie" : `Valider ces ${n} catégories`);
/** « 2 rappels deviendront des tâches que Motion planifiera ; le rappel est alors retiré. » */
export const detailConversion = (n) => `${n} rappel${s(n)} deviendr${n > 1 ? "ont" : "a"} des tâches que Motion planifiera ; le rappel est alors retiré.`;

/**
 * La proposition du modèle local appliquée aux lignes que Sam n'a pas
 * touchées : l'action, et les étiquettes en plus des siennes.
 */
export function appliquerPropositions(choix, propositions, { touchees = new Set(), ids = null } = {}) {
  const suite = { ...choix };
  for (const p of propositions || []) {
    if (!p?.id || touchees.has(p.id) || (ids && !ids.includes(p.id))) continue;
    const c = suite[p.id] || { action: "garder", etiquettes: [], quand: null };
    suite[p.id] = { ...c, action: ["garder", "tache", "rien"].includes(p.action) ? p.action : c.action, etiquettes: [...new Set([...(c.etiquettes || []), ...(p.etiquettes || [])])] };
  }
  return suite;
}

/**
 * Ce que « Valider » écrit (OnboardingRappels.appliquer) : les rangés (date
 * ou étiquettes changées, une écriture chacun) et les rappels à convertir en
 * tâches Motion (avec la date réglée ici comme échéance). « Rien » : rien.
 */
export function planTri(aTrier, choix, etiquettes) {
  const existantes = (etiquettes || []).map((e) => e.id);
  const ranges = [];
  const convertir = [];
  for (const r of aTrier || []) {
    const c = choix?.[r.id];
    if (!c || c.action === "rien") continue;
    const quand = typeof c.quand === "number" ? c.quand : null;
    if (c.action === "tache") {
      convertir.push({ ...r, quand, etiquettes: existantes.filter((id) => (c.etiquettes || []).includes(id)) });
      continue;
    }
    const ids = existantes.filter((id) => (c.etiquettes || []).includes(id));
    const avant = r.etiquettes || [];
    if (ids.join(",") !== avant.join(",") || quand !== (typeof r.quand === "number" ? r.quand : null)) ranges.push({ ...r, quand, etiquettes: ids });
  }
  return { ranges, convertir };
}

/** « 3 rappels rangés, 1 devenu tâche Motion (pas fait : « X » : quota) ; encore 2 à traiter. » */
export function phraseBilanTri({ ranges = 0, convertis = null, echecs = [], restent = 0 } = {}) {
  let p = `${ranges} rappel${s(ranges)} rangé${s(ranges)}`;
  if (convertis != null) {
    p += `, ${convertis} devenu${s(convertis)} tâche${s(convertis)} Motion`;
    if (echecs.length) p += ` (pas fait : ${echecs.join(" ; ")})`;
  }
  if (restent > 0) p += ` ; encore ${restent} à traiter`;
  return `${p}.`;
}

/** L'action Motion d'un rappel qui devient tâche (AppModel.convertirEnTaches). */
export function actionTache(r, isoLocal) {
  const action = { type: "creer", nom: String(r.texte || "").slice(0, 200) };
  if (typeof r.quand === "number" && isoLocal) action.echeance = isoLocal(new Date(r.quand));
  if (r.etiquettes?.length) action.etiquettes = r.etiquettes;
  return action;
}

/** Le sort de chaque ligne d'une écriture Motion : fait, déjà là, ou l'échec dit (ecrireTaches). */
export function etatsLot(reponse, n) {
  const res = reponse?.results || [];
  const dejaLa = (x) => x?.dejaLa === true || (x?.ok === false && /existe déjà dans Motion|déjà dans ton agenda/.test(x?.erreur || ""));
  const toutDejaLa = reponse?.etat === "deja_la" || (res.length > 0 && res.every(dejaLa));
  return Array.from({ length: n }, (_, k) => {
    const x = res[k];
    if (x) return dejaLa(x) ? { etat: "dejaLa" } : x.ok === true ? { etat: "fait" } : { etat: "echec", erreur: x.erreur || "refusé par Motion" };
    if (toutDejaLa) return { etat: "dejaLa" };
    return reponse?.ok !== false && reponse?.etat !== "echouee" ? { etat: "fait" } : { etat: "echec", erreur: "refusé par Motion" };
  });
}

/** Un tableau en lots de `n` (6 tâches Motion par écriture, 100 articles par envoi). */
export function lots(tableau, n) {
  const out = [];
  for (let i = 0; i < (tableau || []).length; i += n) out.push(tableau.slice(i, i + n));
  return out;
}

// --- Les listes ---

/** 0 : automatique (1→1, 2→2, 3→3, 4→2, 5 et plus→3) ; sinon 1, 2 ou 3 par ligne (DispositionListes). */
export function colonnesListes(choix, nombre) {
  if ([1, 2, 3].includes(Number(choix))) return Number(choix);
  if (nombre <= 1) return 1;
  if (nombre === 2) return 2;
  if (nombre === 3) return 3;
  if (nombre === 4) return 2;
  return 3;
}
export const DISPOSITIONS = [[0, "Automatique"], [1, "Une par ligne"], [2, "Deux par ligne"], [3, "Trois par ligne"]];
export const CLE_DISPOSITION = "dispositionListes";

/** L'icône devinée du nom d'une liste, sinon une liste (TuileListe.symbole). */
export function iconeListe(nom) {
  const n = String(nom || "").toLowerCase();
  if (n.includes("course") || n.includes("magasin") || n.includes("supermarch")) return "chariot";
  if (n.includes("pharma") || n.includes("santé")) return "trousse";
  if (n.includes("anniv") || n.includes("cadeau")) return "cadeau";
  if (n.includes("film") || n.includes("série") || n.includes("livre")) return "livre";
  if (n.includes("voyage") || n.includes("valise")) return "valise";
  return "liste";
}

/** « vide », « tout est pris », « 3 à prendre ». */
export function resteListe(l) {
  const e = l?.elements || [];
  if (!e.length) return "vide";
  const n = e.filter((x) => !x.fait).length;
  return n === 0 ? "tout est pris" : `${n} à prendre`;
}

/** « Déjà dans ta liste : « lait », « œufs ». » */
export const phraseDejaListe = (textes) => `Déjà dans ta liste : ${textes.map((t) => `« ${t} »`).join(", ")}.`;
/** « 2 articles cochés retirés. » */
export const phraseCochesRetires = (n) => `${n} article${s(n)} coché${s(n)} retiré${s(n)}.`;

// --- Dossiers (sous-projets, catégories, idées) ---

/** Les enfants d'un nœud, par ordre puis par nom (OrganisationModel.enfants). */
export function enfants(dossiers, parent) {
  return (dossiers || []).filter((d) => (d.parent ?? null) === (parent ?? null))
    .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || String(a.nom).localeCompare(String(b.nom), "fr"));
}

/** Un dossier et tous ses descendants (parent après parent, jusqu'au point fixe). */
export function descendants(dossiers, id) {
  const ids = new Set([id]);
  for (let change = true; change; ) {
    change = false;
    for (const d of dossiers || []) if (!ids.has(d.id) && d.parent != null && ids.has(d.parent)) (ids.add(d.id), (change = true));
  }
  return ids;
}

/** Ce que « Annuler » réécrit après une suppression : le dossier et ses descendants, parents d'abord, avec notes et tâches. */
export function aRestaurer(dossiers, id) {
  const ids = descendants(dossiers, id);
  const out = [];
  const vus = new Set();
  const file = (dossiers || []).filter((d) => d.id === id);
  while (file.length) {
    const d = file.shift();
    if (vus.has(d.id)) continue;
    vus.add(d.id);
    out.push({ ...d, notes: [...(d.notes || [])], taches: [...(d.taches || [])] });
    file.push(...(dossiers || []).filter((x) => x.parent === d.id && ids.has(x.id)));
  }
  return out;
}

/** La racine d'un nœud (« motion:<id> » ou un dossier sans parent), pour savoir où ranger ses tâches. */
export function racineDe(dossiers, id) {
  let courant = id;
  for (let garde = 0; garde < 30; garde++) {
    const d = (dossiers || []).find((x) => x.id === courant);
    if (!d?.parent) break;
    courant = d.parent;
  }
  return courant;
}

/** Où ranger une tâche : tous les sous-dossiers du projet racine, en largeur (NoeudView.rangements). */
export function rangements(dossiers, id) {
  const r = [];
  const file = [racineDe(dossiers, id)];
  const vus = new Set();
  while (file.length) {
    const x = file.shift();
    if (vus.has(x)) continue;
    vus.add(x);
    const e = enfants(dossiers, x);
    r.push(...e);
    file.push(...e.map((d) => d.id));
  }
  return r;
}

/** « 2 sous-projets · 1 tâche · 3 idées » (les idées : notes pas encore relues) ; vide si rien. */
export function metaDossier(d, dossiers) {
  const sous = enfants(dossiers, d.id).length;
  const taches = (d.taches || []).length;
  const notes = (d.notes || []).filter((n) => !n.fait).length;
  return [sous ? `${sous} sous-projet${s(sous)}` : null, taches ? `${taches} tâche${s(taches)}` : null, notes ? `${notes} idée${s(notes)}` : null].filter(Boolean).join(" · ");
}

/** Notes → bloc-notes ; lié à Motion → pile ; Idées → ampoule ; sinon dossier. */
export const iconeDossier = (d) => (d?.id === "notes" ? "blocnotes" : d?.id === "idees" ? "ampoule" : d?.projetMotion ? "pile" : "dossier");

/** « Aussi dans Motion… » : un dossier racine, pas encore lié, ni « Notes » ni « Idées ». */
export const peutAllerDansMotion = (d) => Boolean(d && (d.parent ?? null) === null && !d.projetMotion && d.id !== "notes" && d.id !== "idees");

/** Le message d'un refus de Motion, sans le dire deux fois. */
export function phraseRefusMotion(message) {
  const m = String(message || "erreur").replace(/\.$/, "");
  return /^Motion n'a pas créé le projet/.test(m) ? `${m}.` : `Motion n'a pas créé le projet : ${m}.`;
}

/** Les tâches d'un projet Motion qui ne sont rangées dans aucun sous-dossier. */
export function tachesHorsSousProjets(projet, dossiers) {
  const rangees = new Set((dossiers || []).flatMap((d) => d.taches || []));
  return (projet?.liste || []).filter((t) => !rangees.has(t.id));
}

export const TACHE_INCONNUE = "Tâche Motion (terminée ou hors liste)";
/** Les tâches rangées dans un dossier, titre retrouvé dans les projets (puis la journée), sinon « Tâche Motion (terminée ou hors liste) ». */
export function tachesRangees(d, projets, journee = []) {
  const connues = new Map();
  for (const p of projets || []) for (const t of p.liste || []) if (!connues.has(t.id)) connues.set(t.id, { ...t, projet: p.nom });
  for (const t of journee || []) if (t?.id && t.type !== "rdv" && !connues.has(t.id)) connues.set(t.id, t);
  return (d?.taches || []).map((id) => connues.get(id) || { id, titre: TACHE_INCONNUE, inconnue: true });
}

/** « avant le 27 oct. · 45 min ». */
export function metaTache(t, duree) {
  return [typeof t?.echeance === "number" ? `avant le ${F_JOUR_COURT.format(new Date(t.echeance))}` : null, t?.duree ? duree(t.duree) : null].filter(Boolean).join(" · ");
}

// --- Les projets Motion ---

/** « 5 tâches · prochaine : Envoyer les visuels (27 oct.) », « aucune tâche ouverte » (LigneProjet.detail). */
export function detailProjet(p) {
  const n = Number(p?.taches) || 0;
  const bits = [n === 0 ? "aucune tâche ouverte" : `${n} tâche${s(n)}`];
  if (p?.prochaine?.titre) bits.push(`prochaine : ${p.prochaine.titre}${typeof p.prochaine.echeance === "number" ? ` (${F_JOUR_COURT.format(new Date(p.prochaine.echeance))})` : ""}`);
  return bits.join(" · ");
}
export const phraseRetard = (n) => (n > 1 ? `${n} en retard` : "1 en retard");
export const phraseSansProjet = (n) => `${n} tâche${s(n)} sans projet dans Motion.`;
/** La question préparée (jamais envoyée seule) pour « En parler à Rémy ». */
export const questionProjet = (nom) => `Où en est le projet « ${nom} » ? Propose-moi les prochaines étapes.`;

/** « 37 mots · 6 sections remplies sur 7 », ou l'invitation sans données (CarteMemoire.resume). */
export function resumeMemoire(m) {
  if (!m || typeof m.mots !== "number") return "Lire et corriger sa mémoire";
  const x = s(m.sections);
  return `${F_ENTIER.format(m.mots)} mots · ${m.sections} section${x} remplie${x} sur ${m.totalSections}`;
}

// --- L'historique des actions ---

export const FILTRES_HISTORIQUE = [{ id: "tout", titre: "Tout" }, { id: "echouee", titre: "Échouées" }, { id: "annulee", titre: "Annulées" }, { id: "deja_la", titre: "Déjà là" }];
/** /api/historique?limite=80[&avant=…][&filtre=…] (HistoriqueModel.pageHistorique). */
export function cheminHistorique({ filtre = "tout", avant = null, limite = 80 } = {}) {
  let q = `limite=${limite}`;
  if (avant != null) q += `&avant=${Math.trunc(Number(avant))}`;
  if (filtre && filtre !== "tout") q += `&filtre=${encodeURIComponent(filtre)}`;
  return `/api/historique?${q}`;
}
/** Les entrées par jour, dans l'ordre reçu (« Jeudi 29 octobre »). */
export function groupesHistorique(entrees) {
  const jours = [];
  for (const e of entrees || []) {
    const t = F_JOUR_LONG.format(new Date(e.ts));
    const titre = t.charAt(0).toUpperCase() + t.slice(1);
    if (jours.length && jours[jours.length - 1].titre === titre) jours[jours.length - 1].entrees.push(e);
    else jours.push({ titre, entrees: [e] });
  }
  return jours;
}
/** Ajoute une page sous les autres, sans doublon. */
export const ajouterPage = (entrees, page) => {
  const connus = new Set((entrees || []).map((e) => e.id));
  return [...(entrees || []), ...(page || []).filter((e) => !connus.has(e.id))];
};
export const ouAnnuler = (source) => (source === "agenda" ? "ton agenda" : "Motion");
export const detailAnnulation = (source) => `Rémy remet ${ouAnnuler(source)} comme avant, si personne n'y a touché depuis.`;
export const phraseAnnulation = (source, ok) => (ok === false ? `Pas tout à fait annulé : vérifie dans ${ouAnnuler(source)}.` : "Annulé.");
export function videHistorique(filtre) {
  const f = FILTRES_HISTORIQUE.find((x) => x.id === filtre);
  return !f || f.id === "tout" ? "Rien encore : chaque geste qui change Motion ou ton agenda s'inscrira ici." : `Rien dans « ${f.titre} ».`;
}
