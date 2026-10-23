// Le carnet de Remy (Lot 1, J1.5) : listes (courses, anniversaires…), rappels
// simples, et ce que Motion ne sait pas d'une tâche (« bloquée », D12).
//
// Tout vit dans remy.db, sur la tour. Les identifiants viennent de l'iPhone :
// chaque écriture est un « upsert » — rejouée après une coupure, elle retombe
// sur la même ligne, sans doublon. Une suppression est douce (récupérable par
// « Annuler » : réécrire la même ligne la fait revenir).

import { db, transaction } from "./db.js";

const MAX_LISTES = 100;
// Les plafonds ne comptent que ce qui reste à faire : un article pris ou un
// rappel fait ne bloque jamais une coche ni un ajout (J+30 : 405 pris → 409).
const MAX_ELEMENTS = 500;
const MAX_RAPPELS = 2000;
// Purge douce (récupérable) : les pris de plus de 7 jours, les rappels faits
// de plus de 30 jours.
export const PRIS_GARDES_JOURS = 7;
export const FAITS_GARDES_JOURS = 30;
const MAX_ETIQUETTES = 40;
const MAX_DOSSIERS = 300;
const MAX_NOTES = 500;

export class ErreurCarnet extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

// Des identifiants simples (UUID de l'iPhone, « apple:… » pour un import).
const ID = /^[A-Za-z0-9:_.\-]{1,160}$/;
function id(v, quoi = "identifiant") {
  if (typeof v !== "string" || !ID.test(v)) throw new ErreurCarnet(400, `${quoi} invalide`);
  return v;
}
function texte(v, max, quoi) {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t) throw new ErreurCarnet(400, `${quoi} vide`);
  return t.slice(0, max);
}
// « Payer le LOYER ! » et « payer le loyer » : la même chose (doublons à l'entrée).
export const cleTexte = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const entier = (v, defaut = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : defaut);
const quandValide = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

// --- Listes ------------------------------------------------------------------

export function lireListes() {
  const d = db();
  const listes = d.prepare("SELECT id, nom, ordre, maj_a FROM listes WHERE supprimee = 0 ORDER BY ordre, cree_a").all();
  const elements = d.prepare("SELECT id, liste_id, texte, fait, ordre, maj_a FROM elements_liste WHERE supprime = 0 ORDER BY ordre, cree_a").all();
  const par = new Map(listes.map((l) => [l.id, []]));
  for (const e of elements) par.get(e.liste_id)?.push({ id: e.id, texte: e.texte, fait: Boolean(e.fait), ordre: e.ordre });
  return listes.map((l) => ({ id: l.id, nom: l.nom, ordre: l.ordre, majA: l.maj_a, elements: par.get(l.id) || [] }));
}

export function ecrireListe(idListe, corps = {}) {
  const i = id(idListe, "liste");
  const d = db();
  const existe = d.prepare("SELECT id FROM listes WHERE id = ?").get(i);
  if (!existe) {
    const n = d.prepare("SELECT COUNT(*) AS n FROM listes WHERE supprimee = 0").get().n;
    if (n >= MAX_LISTES) throw new ErreurCarnet(409, `Pas plus de ${MAX_LISTES} listes.`);
  }
  const t = Date.now();
  d.prepare(`
    INSERT INTO listes (id, nom, ordre, supprimee, cree_a, maj_a) VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, ordre = excluded.ordre, supprimee = 0, maj_a = excluded.maj_a`)
    .run(i, texte(corps.nom, 80, "nom de liste"), entier(corps.ordre), t, t);
  return { ok: true, id: i };
}

export function supprimerListe(idListe) {
  const i = id(idListe, "liste");
  db().prepare("UPDATE listes SET supprimee = 1, maj_a = ? WHERE id = ?").run(Date.now(), i);
  return { ok: true };
}

function listeExiste(i) {
  if (!db().prepare("SELECT id FROM listes WHERE id = ? AND supprimee = 0").get(i)) {
    throw new ErreurCarnet(404, "Cette liste n'existe plus.");
  }
}

// Sans ordre donné, un article garde sa place (cocher ne le déplace pas) ; un
// nouveau va à la fin.
function poserElement(d, listeId, e, t, rang = 0) {
  const ordre = e.ordre === undefined || e.ordre === null ? null : entier(e.ordre);
  d.prepare(`
    INSERT INTO elements_liste (id, liste_id, texte, fait, ordre, supprime, cree_a, maj_a) VALUES (?, ?, ?, ?, COALESCE(?, ?), 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET liste_id = excluded.liste_id, texte = excluded.texte, fait = excluded.fait,
      ordre = COALESCE(?, elements_liste.ordre), supprime = 0, maj_a = excluded.maj_a`)
    .run(id(e.id, "élément"), listeId, texte(e.texte, 300, "article"), e.fait ? 1 : 0, ordre, (t % 1_000_000_000) + rang, t, t, ordre);
}

/**
 * Un ou plusieurs articles (« tomates, lait, œufs ») : tout ou rien. Un NOUVEL
 * article déjà dans la liste et pas encore pris n'est pas recréé : la tour
 * rend l'existant (`dejaLa` : { id envoyé, existant, texte }).
 */
export function ecrireElements(idListe, elements) {
  const i = id(idListe, "liste");
  if (!Array.isArray(elements) || !elements.length) throw new ErreurCarnet(400, "Aucun article");
  listeExiste(i);
  const d = db();
  const lot = elements.slice(0, 100);
  const connu = d.prepare("SELECT id FROM elements_liste WHERE id = ?");
  const nouveaux = lot.filter((e) => !connu.get(id(e?.id, "élément")));
  const dejaLa = [];
  let retenus = lot;
  if (nouveaux.length) {
    const ouverts = new Map();
    for (const e of d.prepare("SELECT id, texte FROM elements_liste WHERE liste_id = ? AND supprime = 0 AND fait = 0").all(i)) {
      const k = cleTexte(e.texte);
      if (k && !ouverts.has(k)) ouverts.set(k, e.id);
    }
    const ecartes = new Set();
    for (const e of nouveaux) {
      const k = cleTexte(e.texte);
      if (e.fait || !k) continue;
      if (ouverts.has(k)) {
        dejaLa.push({ id: e.id, existant: ouverts.get(k), texte: texte(e.texte, 300, "article") });
        ecartes.add(e.id);
      } else ouverts.set(k, e.id);
    }
    retenus = lot.filter((e) => !ecartes.has(e.id));
    const ajoutes = nouveaux.filter((e) => !ecartes.has(e.id) && !e.fait).length;
    if (ajoutes) {
      const compter = () => d.prepare("SELECT COUNT(*) AS n FROM elements_liste WHERE liste_id = ? AND supprime = 0 AND fait = 0").get(i).n;
      if (compter() + ajoutes > MAX_ELEMENTS) {
        throw new ErreurCarnet(409, `Pas plus de ${MAX_ELEMENTS} articles à prendre dans une liste : coche ou retire ceux qui ne servent plus.`);
      }
    }
  }
  const t = Date.now();
  transaction(() => {
    retenus.forEach((e, rang) => poserElement(d, i, e, t, rang));
    // Une liste qui grossit se range seule : les pris anciens s'effacent (doux).
    if (nouveaux.length) purgerPris(d, i, t);
  });
  return { ok: true, dejaLa };
}

function purgerPris(d, listeId, t) {
  return d
    .prepare(`UPDATE elements_liste SET supprime = 1, maj_a = ? WHERE supprime = 0 AND fait = 1 AND maj_a < ?${listeId ? " AND liste_id = ?" : ""}`)
    .run(...[t, t - PRIS_GARDES_JOURS * 86_400_000, ...(listeId ? [listeId] : [])]).changes;
}

/** « Retirer les pris » en une requête (au lieu d'un DELETE par article). */
export function retirerElements(idListe, ids) {
  const i = id(idListe, "liste");
  if (!Array.isArray(ids) || !ids.length) throw new ErreurCarnet(400, "Aucun article");
  const lot = [...new Set(ids.slice(0, 1000).map((x) => id(x, "élément")))];
  const d = db();
  const t = Date.now();
  let retires = 0;
  transaction(() => {
    const st = d.prepare("UPDATE elements_liste SET supprime = 1, maj_a = ? WHERE id = ? AND liste_id = ? AND supprime = 0");
    for (const e of lot) retires += st.run(t, e, i).changes;
  });
  return { ok: true, retires };
}

/** Le ménage de la nuit : pris de plus de 7 jours, rappels faits de plus de 30 jours (suppression douce). */
export function purgerCarnet(maintenant = Date.now()) {
  const d = db();
  let pris = 0;
  let faits = 0;
  transaction(() => {
    pris = purgerPris(d, null, maintenant);
    faits = purgerFaits(d, maintenant);
  });
  return { pris, faits };
}

function purgerFaits(d, t) {
  return d.prepare("UPDATE rappels SET supprime = 1, maj_a = ? WHERE supprime = 0 AND fait = 1 AND maj_a < ?")
    .run(t, t - FAITS_GARDES_JOURS * 86_400_000).changes;
}

export function supprimerElement(idListe, idElement) {
  const i = id(idListe, "liste");
  db().prepare("UPDATE elements_liste SET supprime = 1, maj_a = ? WHERE id = ? AND liste_id = ?").run(Date.now(), id(idElement, "élément"), i);
  return { ok: true };
}

// --- Rappels -----------------------------------------------------------------

const lireListeJSON = (v) => {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export function lireRappels() {
  const valides = new Set(lireEtiquettes().map((e) => e.id));
  return db()
    .prepare("SELECT id, texte, quand, fait, source, etiquettes, cree_a FROM rappels WHERE supprime = 0 ORDER BY fait, quand IS NULL, quand, cree_a")
    .all()
    .map((r) => ({
      id: r.id, texte: r.texte, quand: r.quand, fait: Boolean(r.fait), source: r.source, creeA: r.cree_a,
      etiquettes: lireListeJSON(r.etiquettes).filter((e) => valides.has(e)),
    }));
}

// Sans « etiquettes » dans la demande (app d'avant), celles déjà posées restent.
function poserRappel(d, r, t) {
  const etiquettes = Array.isArray(r.etiquettes) ? JSON.stringify(r.etiquettes.filter((e) => typeof e === "string" && ID.test(e)).slice(0, 8)) : null;
  d.prepare(`
    INSERT INTO rappels (id, texte, quand, fait, source, supprime, cree_a, maj_a, etiquettes) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET texte = excluded.texte, quand = excluded.quand, fait = excluded.fait,
      supprime = 0, maj_a = excluded.maj_a, etiquettes = COALESCE(excluded.etiquettes, rappels.etiquettes)`)
    .run(id(r.id, "rappel"), texte(r.texte, 300, "rappel"), quandValide(r.quand), r.fait ? 1 : 0,
      r.source === "apple" ? "apple" : "remy", t, t, etiquettes);
}

/**
 * Écrit un ou plusieurs rappels (l'import des rappels Apple en envoie
 * beaucoup). Un NOUVEAU rappel identique à un rappel pas encore fait n'est pas
 * recréé : la tour rend l'existant (`dejaLa`), et lui donne la date du nouveau
 * s'il n'en avait pas.
 */
export function ecrireRappels(rappels) {
  if (!Array.isArray(rappels) || !rappels.length) throw new ErreurCarnet(400, "Aucun rappel");
  const d = db();
  const lot = rappels.slice(0, 500);
  const connu = d.prepare("SELECT id FROM rappels WHERE id = ?");
  const nouveaux = lot.filter((r) => !connu.get(id(r?.id, "rappel")));
  const dejaLa = [];
  const dater = [];
  let retenus = lot;
  if (nouveaux.length) {
    const ouverts = new Map();
    for (const r of d.prepare("SELECT id, texte, quand FROM rappels WHERE supprime = 0 AND fait = 0 ORDER BY cree_a").all()) {
      const k = cleTexte(r.texte);
      if (k && !ouverts.has(k)) ouverts.set(k, r);
    }
    const ecartes = new Set();
    for (const r of nouveaux) {
      const k = cleTexte(r.texte);
      if (r.fait || !k) continue;
      const deja = ouverts.get(k);
      if (deja) {
        dejaLa.push({ id: r.id, existant: deja.id, texte: texte(r.texte, 300, "rappel") });
        ecartes.add(r.id);
        const q = quandValide(r.quand);
        if (q && !deja.quand && connu.get(deja.id)) dater.push([q, deja.id]);
      } else ouverts.set(k, { id: r.id, quand: quandValide(r.quand) });
    }
    retenus = lot.filter((r) => !ecartes.has(r.id));
    const ajoutes = nouveaux.filter((r) => !ecartes.has(r.id) && !r.fait).length;
    if (ajoutes) {
      const n = d.prepare("SELECT COUNT(*) AS n FROM rappels WHERE supprime = 0 AND fait = 0").get().n;
      if (n + ajoutes > MAX_RAPPELS) throw new ErreurCarnet(409, `Pas plus de ${MAX_RAPPELS} rappels à faire : coche ou retire ceux qui ne servent plus.`);
    }
  }
  const t = Date.now();
  transaction(() => {
    for (const r of retenus) poserRappel(d, r, t);
    for (const [q, i] of dater) d.prepare("UPDATE rappels SET quand = ?, maj_a = ? WHERE id = ? AND quand IS NULL").run(q, t, i);
    if (nouveaux.length) purgerFaits(d, t);
  });
  return { ok: true, nombre: lot.length, dejaLa };
}

export function supprimerRappel(idRappel) {
  db().prepare("UPDATE rappels SET supprime = 1, maj_a = ? WHERE id = ?").run(Date.now(), id(idRappel, "rappel"));
  return { ok: true };
}

// --- État des tâches (ce que Motion ne sait pas) ------------------------------

export function etatsTaches() {
  const m = new Map();
  const lignes = db()
    .prepare("SELECT tache_id, bloquee, raison, depuis, commencee_a, fait_a FROM etats_taches WHERE bloquee = 1 OR commencee_a IS NOT NULL OR fait_a IS NOT NULL")
    .all();
  for (const e of lignes) {
    m.set(e.tache_id, {
      bloquee: Boolean(e.bloquee),
      raison: e.raison || null,
      depuis: e.depuis || null,
      commenceeA: e.commencee_a || null,
      faitA: e.fait_a || null,
    });
  }
  return m;
}

/**
 * Ce que Motion ou l'agenda ne savent pas, gardé dans Remy. Seuls les champs
 * envoyés changent :
 *   - bloquee (+ raison) : « en attente de… », jamais proposée ;
 *   - commencee : true ou l'heure (ms) — « commencer maintenant » (l'API
 *     Motion ne sait pas avancer une tâche) ; false l'annule ;
 *   - fait : une activité de l'agenda faite (« rdv:<id> »).
 */
export function marquerTache(idTache, corps = {}) {
  const i = id(idTache, "tâche");
  const t = Date.now();
  const d = db();
  const avant = d.prepare("SELECT * FROM etats_taches WHERE tache_id = ?").get(i) || {};
  let bloquee = avant.bloquee ? 1 : 0;
  let raison = avant.raison ?? null;
  let depuis = avant.depuis ?? null;
  if ("bloquee" in corps) {
    bloquee = corps.bloquee ? 1 : 0;
    raison = bloquee && corps.raison ? String(corps.raison).replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
    depuis = bloquee ? (avant.bloquee ? avant.depuis : t) : null;
  }
  let commencee = avant.commencee_a ?? null;
  if ("commencee" in corps) {
    const v = Number(corps.commencee);
    // L'heure du geste sur l'iPhone (un renvoi après coupure ne la décale
    // pas), bornée aux 12 dernières heures.
    commencee = corps.commencee ? (Number.isFinite(v) && v > t - 12 * 3600_000 && v <= t + 60_000 ? Math.min(v, t) : t) : null;
  }
  let fait = avant.fait_a ?? null;
  if ("fait" in corps) fait = corps.fait ? avant.fait_a || t : null;
  d.prepare(`
    INSERT INTO etats_taches (tache_id, bloquee, raison, depuis, commencee_a, fait_a, maj_a) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tache_id) DO UPDATE SET bloquee = excluded.bloquee, raison = excluded.raison, depuis = excluded.depuis,
      commencee_a = excluded.commencee_a, fait_a = excluded.fait_a, maj_a = excluded.maj_a`)
    .run(i, bloquee, raison, depuis, commencee, fait, t);
  return { ok: true, bloquee: Boolean(bloquee), raison, commenceeA: commencee, faitA: fait };
}

/**
 * La journée avec ce que Remy garde : « bloquée », « commencée » (la tâche
 * devient l'élément en cours à l'heure du geste, pour sa durée), « faite »
 * pour une activité de l'agenda.
 */
export function avecEtats(j, etats = etatsTaches(), maintenant = Date.now()) {
  if (!etats.size) return j;
  const debutJour = maintenant - 12 * 3600_000;
  const poser = (t) => {
    if (!t) return t;
    if (t.type === "rdv") {
      const e = etats.get(`rdv:${t.id}`);
      return e?.faitA ? { ...t, fait: true } : t;
    }
    const e = etats.get(t.id);
    return e?.bloquee ? { ...t, bloquee: true, raison: e.raison } : t;
  };
  const commencee = (t) => {
    const e = t && t.type !== "rdv" && etats.get(t.id);
    return e?.commenceeA && e.commenceeA >= debutJour ? e.commenceeA : null;
  };
  const enItem = (t, depuis) => {
    const duree = t.duree || 30;
    const fin = depuis + duree * 60_000;
    return { ...t, type: "tache", debut: depuis, fin, duree, commencee: true, etat: fin > maintenant ? "encours" : "passe" };
  };
  let replacees = false;
  const items = (j.items || []).map(poser).map((t) => {
    const c = commencee(t);
    if (!c) return t;
    replacees = true;
    return enItem(t, c);
  });
  const sortir = (liste) => (liste || []).map(poser).filter((t) => {
    const c = commencee({ ...t, type: "tache" });
    if (c) {
      items.push(enItem(t, c));
      replacees = true;
    }
    return !c;
  });
  const aFaire = sortir(j.aFaire);
  const retardItems = j.retard ? sortir(j.retard.items) : null;
  if (replacees) items.sort((a, b) => a.debut - b.debut || (a.type === "rdv" ? -1 : 1));
  return {
    ...j,
    items,
    aFaire,
    retard: j.retard ? { ...j.retard, items: retardItems, total: Math.max(0, j.retard.total - ((j.retard.items || []).length - retardItems.length)) } : j.retard,
  };
}

// --- Catégories des tâches (mêmes étiquettes que les rappels, Sam 18/10) ---------
// Gardées dans Remy, comme les sous-projets : Motion n'en sait rien.

export function categoriesTaches() {
  const valides = new Set(lireEtiquettes().map((e) => e.id));
  const m = new Map();
  for (const r of db().prepare("SELECT tache_id, etiquettes FROM categories_taches").all()) {
    const ids = lireListeJSON(r.etiquettes).filter((e) => valides.has(e));
    if (ids.length) m.set(r.tache_id, ids);
  }
  return m;
}

export function categoriserTache(idTache, etiquettes) {
  const t = id(idTache, "tâche");
  const ids = [...new Set((Array.isArray(etiquettes) ? etiquettes : []).filter((e) => typeof e === "string" && ID.test(e)))].slice(0, 8);
  if (!ids.length) {
    db().prepare("DELETE FROM categories_taches WHERE tache_id = ?").run(t);
    return { ok: true, etiquettes: [] };
  }
  db().prepare(`INSERT INTO categories_taches (tache_id, etiquettes, maj_a) VALUES (?, ?, ?)
    ON CONFLICT(tache_id) DO UPDATE SET etiquettes = excluded.etiquettes, maj_a = excluded.maj_a`).run(t, JSON.stringify(ids), Date.now());
  return { ok: true, etiquettes: ids };
}

/** La journée avec la catégorie de chaque tâche (les rendez-vous n'en ont pas). */
export function avecCategories(j, cats = categoriesTaches()) {
  if (!j || !cats.size) return j;
  const poser = (t) => (t && t.type !== "rdv" && cats.has(t.id) ? { ...t, etiquettes: cats.get(t.id) } : t);
  return {
    ...j,
    items: (j.items || []).map(poser),
    aFaire: (j.aFaire || []).map(poser),
    retard: j.retard ? { ...j.retard, items: (j.retard.items || []).map(poser) } : j.retard,
  };
}

// --- Étiquettes des rappels (Santé, Voiture…) ----------------------------------------

export function lireEtiquettes() {
  return db()
    .prepare("SELECT id, nom, ordre FROM etiquettes WHERE supprimee = 0 ORDER BY ordre, cree_a")
    .all()
    .map((e) => ({ id: e.id, nom: e.nom, ordre: e.ordre }));
}

export function ecrireEtiquette(idEtiquette, corps = {}) {
  const i = id(idEtiquette, "étiquette");
  const d = db();
  if (!d.prepare("SELECT id FROM etiquettes WHERE id = ?").get(i)) {
    const n = d.prepare("SELECT COUNT(*) AS n FROM etiquettes WHERE supprimee = 0").get().n;
    if (n >= MAX_ETIQUETTES) throw new ErreurCarnet(409, `Pas plus de ${MAX_ETIQUETTES} étiquettes.`);
  }
  const t = Date.now();
  d.prepare(`
    INSERT INTO etiquettes (id, nom, ordre, supprimee, cree_a, maj_a) VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, ordre = excluded.ordre, supprimee = 0, maj_a = excluded.maj_a`)
    .run(i, texte(corps.nom, 40, "nom d'étiquette"), entier(corps.ordre), t, t);
  return { ok: true, id: i };
}

export function supprimerEtiquette(idEtiquette) {
  db().prepare("UPDATE etiquettes SET supprimee = 1, maj_a = ? WHERE id = ?").run(Date.now(), id(idEtiquette, "étiquette"));
  return { ok: true };
}

// --- Dossiers : sous-projets, catégories, idées (l'API Motion n'a pas de hiérarchie) ---

const PARENT = /^(motion:)?[A-Za-z0-9:_.\-]{1,160}$/;

export function lireDossiers() {
  const d = db();
  const dossiers = d.prepare("SELECT id, nom, parent, projet_motion, ordre FROM dossiers WHERE supprime = 0 ORDER BY ordre, cree_a").all();
  const notes = d.prepare("SELECT id, dossier, texte, fait FROM notes_dossier WHERE supprime = 0 ORDER BY fait, cree_a").all();
  const ratt = d.prepare("SELECT tache_id, dossier FROM rattachements").all();
  const parDossier = new Map(dossiers.map((x) => [x.id, { notes: [], taches: [] }]));
  for (const n of notes) parDossier.get(n.dossier)?.notes.push({ id: n.id, texte: n.texte, fait: Boolean(n.fait) });
  for (const r of ratt) parDossier.get(r.dossier)?.taches.push(r.tache_id);
  return dossiers.map((x) => ({
    id: x.id, nom: x.nom, parent: x.parent || null, projetMotion: x.projet_motion || null, ordre: x.ordre,
    notes: parDossier.get(x.id).notes, taches: parDossier.get(x.id).taches,
  }));
}

export function ecrireDossier(idDossier, corps = {}, { projetMotion = null } = {}) {
  const i = id(idDossier, "dossier");
  const parent = corps.parent === null || corps.parent === undefined || corps.parent === "" ? null : String(corps.parent);
  if (parent !== null && (!PARENT.test(parent) || parent === i)) throw new ErreurCarnet(400, "parent invalide");
  const d = db();
  const existe = d.prepare("SELECT id, projet_motion FROM dossiers WHERE id = ?").get(i);
  if (!existe) {
    const n = d.prepare("SELECT COUNT(*) AS n FROM dossiers WHERE supprime = 0").get().n;
    if (n >= MAX_DOSSIERS) throw new ErreurCarnet(409, `Pas plus de ${MAX_DOSSIERS} dossiers.`);
  }
  // Pas de boucle : un dossier ne se range pas sous l'un de ses descendants.
  if (parent && !parent.startsWith("motion:")) {
    const parents = new Map(d.prepare("SELECT id, parent FROM dossiers WHERE supprime = 0").all().map((x) => [x.id, x.parent]));
    for (let p = parent, n = 0; p && n < 50; p = parents.get(p), n++) if (p === i) throw new ErreurCarnet(400, "Un dossier ne peut pas se ranger dans lui-même.");
  }
  const t = Date.now();
  d.prepare(`
    INSERT INTO dossiers (id, nom, parent, projet_motion, ordre, supprime, cree_a, maj_a) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, parent = excluded.parent,
      projet_motion = COALESCE(dossiers.projet_motion, excluded.projet_motion), ordre = excluded.ordre, supprime = 0, maj_a = excluded.maj_a`)
    .run(i, texte(corps.nom, 120, "nom"), parent, projetMotion, entier(corps.ordre), t, t);
  return { ok: true, id: i };
}

export function projetMotionDu(idDossier) {
  return db().prepare("SELECT projet_motion FROM dossiers WHERE id = ?").get(id(idDossier, "dossier"))?.projet_motion || null;
}

/** Supprime un dossier et ce qu'il contient (récupérable : réécrire la ligne). */
export function supprimerDossier(idDossier) {
  const i = id(idDossier, "dossier");
  const d = db();
  const tous = d.prepare("SELECT id, parent FROM dossiers WHERE supprime = 0").all();
  const aSupprimer = new Set([i]);
  for (let change = true; change; ) {
    change = false;
    for (const x of tous) if (!aSupprimer.has(x.id) && aSupprimer.has(x.parent)) (aSupprimer.add(x.id), (change = true));
  }
  const t = Date.now();
  transaction(() => {
    for (const x of aSupprimer) {
      d.prepare("UPDATE dossiers SET supprime = 1, maj_a = ? WHERE id = ?").run(t, x);
      d.prepare("DELETE FROM rattachements WHERE dossier = ?").run(x);
    }
  });
  return { ok: true, supprimes: aSupprimer.size };
}

export function ecrireNotes(idDossier, notes) {
  const i = id(idDossier, "dossier");
  if (!Array.isArray(notes) || !notes.length) throw new ErreurCarnet(400, "Aucune note");
  const d = db();
  if (!d.prepare("SELECT id FROM dossiers WHERE id = ? AND supprime = 0").get(i)) throw new ErreurCarnet(404, "Ce dossier n'existe plus.");
  const n = d.prepare("SELECT COUNT(*) AS n FROM notes_dossier WHERE dossier = ? AND supprime = 0").get(i).n;
  if (n + notes.length > MAX_NOTES) throw new ErreurCarnet(409, `Pas plus de ${MAX_NOTES} notes par dossier.`);
  const t = Date.now();
  transaction(() => {
    for (const x of notes.slice(0, 100)) {
      d.prepare(`
        INSERT INTO notes_dossier (id, dossier, texte, fait, supprime, cree_a, maj_a) VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET dossier = excluded.dossier, texte = excluded.texte, fait = excluded.fait, supprime = 0, maj_a = excluded.maj_a`)
        .run(id(x.id, "note"), i, texte(x.texte, 500, "note"), x.fait ? 1 : 0, t, t);
    }
  });
  return { ok: true };
}

export function supprimerNote(idDossier, idNote) {
  db().prepare("UPDATE notes_dossier SET supprime = 1, maj_a = ? WHERE id = ? AND dossier = ?").run(Date.now(), id(idNote, "note"), id(idDossier, "dossier"));
  return { ok: true };
}

/** Range une tâche Motion dans un sous-projet (dossier null : la sortir). */
export function rattacher(idTache, idDossier) {
  const t = id(idTache, "tâche");
  if (!idDossier) {
    db().prepare("DELETE FROM rattachements WHERE tache_id = ?").run(t);
    return { ok: true };
  }
  const dos = id(idDossier, "dossier");
  if (!db().prepare("SELECT id FROM dossiers WHERE id = ? AND supprime = 0").get(dos)) throw new ErreurCarnet(404, "Ce dossier n'existe plus.");
  db().prepare(`INSERT INTO rattachements (tache_id, dossier, maj_a) VALUES (?, ?, ?)
    ON CONFLICT(tache_id) DO UPDATE SET dossier = excluded.dossier, maj_a = excluded.maj_a`).run(t, dos, Date.now());
  return { ok: true };
}
