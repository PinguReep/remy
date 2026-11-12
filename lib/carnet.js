// Le carnet de Remy (Lot 1, J1.5) : listes (courses, anniversaires…), rappels
// simples, et ce que Motion ne sait pas d'une tâche (« bloquée », D12).
//
// Tout vit dans remy.db, sur la tour. Les identifiants viennent de l'iPhone :
// chaque écriture est un « upsert » — rejouée après une coupure, elle retombe
// sur la même ligne, sans doublon. Une suppression est douce (récupérable par
// « Annuler » : réécrire la même ligne la fait revenir).

import crypto from "node:crypto";
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
// Le jour (heure de Sam) d'un instant : « 2026-11-01 ».
const jourLocal = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.REMY_TZ || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
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

// --- Ce qui déclenche un rappel, en plus de sa date (rappels-declencheurs-v1) ---
//
// - `note` : la description, sous le titre (1000 caractères).
// - `alertes` : des sonneries AVANT l'échéance — { type: "veille", minutes } (la
//   veille, à cette minute du jour : 1200 = 20:00), { type: "matin", minutes }
//   (le jour même, à cette minute du jour), { type: "avant", minutes } (tant de
//   minutes avant). Sans date, elles ne sonnent pas.
// - `lieu` : { id?, nom, lat, lon, rayon, sens } — « arrivee » ou « depart ».
//   C'est l'iPhone qui surveille (iOS, même app fermée) ; la tour garde.
// Dans une demande : clé ABSENTE = inchangé (une app d'avant, le site), clé
// présente = remplacé (null, "" ou [] : retiré).
const ALERTES_MAX = 6;
const AVANT_MAX = 14 * 24 * 60; // deux semaines, en minutes
export const TYPES_ALERTE = ["veille", "matin", "avant"];

function alertesValides(v) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new ErreurCarnet(400, "alertes invalides");
  const vues = new Set();
  const out = [];
  for (const a of v) {
    const minutes = Math.round(Number(a?.minutes));
    if (!TYPES_ALERTE.includes(a?.type) || !Number.isFinite(minutes)) throw new ErreurCarnet(400, "alerte invalide");
    const max = a.type === "avant" ? AVANT_MAX : 1439;
    const min = a.type === "avant" ? 1 : 0;
    if (minutes < min || minutes > max) throw new ErreurCarnet(400, "alerte invalide");
    const k = `${a.type}:${minutes}`;
    if (vues.has(k)) continue;
    vues.add(k);
    out.push({ type: a.type, minutes });
  }
  return out.slice(0, ALERTES_MAX);
}

function lieuValide(v) {
  if (v === null || v === undefined || v === false) return null;
  const lat = Number(v?.lat);
  const lon = Number(v?.lon);
  const nom = String(v?.nom ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (typeof v !== "object" || !nom || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !["arrivee", "depart"].includes(v.sens)) {
    throw new ErreurCarnet(400, "lieu invalide");
  }
  const rayon = Math.min(2000, Math.max(100, Math.round(Number(v.rayon)) || 150));
  return { ...(typeof v.id === "string" && ID.test(v.id) ? { id: v.id } : {}), nom, lat, lon, rayon, sens: v.sens };
}

const lireObjetJSON = (v) => {
  try {
    const o = v ? JSON.parse(v) : null;
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
};

// Les trois colonnes d'une demande : { note, alertes, lieu }, chacune
// `undefined` si la clé est absente (rien ne change).
function declencheursDe(r) {
  const a = (cle) => Object.prototype.hasOwnProperty.call(r ?? {}, cle);
  return {
    note: a("note") ? String(r.note ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 1000) : undefined,
    alertes: a("alertes") ? alertesValides(r.alertes) : undefined,
    lieu: a("lieu") ? lieuValide(r.lieu) : undefined,
  };
}
const aDesDeclencheurs = (x) => Boolean(x.note) || Boolean(x.alertes?.length) || Boolean(x.lieu);

export function lireRappels() {
  const valides = new Set(lireEtiquettes().map((e) => e.id));
  return db()
    .prepare("SELECT id, texte, quand, fait, source, etiquettes, note, alertes, lieu, cree_a FROM rappels WHERE supprime = 0 ORDER BY fait, quand IS NULL, quand, cree_a")
    .all()
    .map((r) => ({
      id: r.id, texte: r.texte, quand: r.quand, fait: Boolean(r.fait), source: r.source, creeA: r.cree_a,
      etiquettes: lireListeJSON(r.etiquettes).filter((e) => valides.has(e)),
      note: r.note || null,
      alertes: (lireObjetJSON(`{"a":${r.alertes || "[]"}}`)?.a || []).filter((a) => TYPES_ALERTE.includes(a?.type) && Number.isFinite(a?.minutes)),
      lieu: lireObjetJSON(r.lieu),
    }));
}

// Sans « etiquettes » dans la demande (app d'avant), celles déjà posées restent ;
// de même la note, les alertes et le lieu (voir declencheursDe).
function poserRappel(d, r, t) {
  const etiquettes = Array.isArray(r.etiquettes) ? JSON.stringify(r.etiquettes.filter((e) => typeof e === "string" && ID.test(e)).slice(0, 8)) : null;
  const x = declencheursDe(r);
  const idRappel = id(r.id, "rappel");
  d.prepare(`
    INSERT INTO rappels (id, texte, quand, fait, source, supprime, cree_a, maj_a, etiquettes) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET texte = excluded.texte, quand = excluded.quand, fait = excluded.fait,
      supprime = 0, maj_a = excluded.maj_a, etiquettes = COALESCE(excluded.etiquettes, rappels.etiquettes)`)
    .run(idRappel, texte(r.texte, 300, "rappel"), quandValide(r.quand), r.fait ? 1 : 0,
      r.source === "apple" ? "apple" : "remy", t, t, etiquettes);
  poserDeclencheurs(d, idRappel, x);
}

function poserDeclencheurs(d, idRappel, x) {
  if (x.note !== undefined) d.prepare("UPDATE rappels SET note = ? WHERE id = ?").run(x.note || null, idRappel);
  if (x.alertes !== undefined) d.prepare("UPDATE rappels SET alertes = ? WHERE id = ?").run(x.alertes.length ? JSON.stringify(x.alertes) : null, idRappel);
  if (x.lieu !== undefined) d.prepare("UPDATE rappels SET lieu = ? WHERE id = ?").run(x.lieu ? JSON.stringify(x.lieu) : null, idRappel);
}

/**
 * Écrit un ou plusieurs rappels (l'import des rappels Apple en envoie
 * beaucoup). Un NOUVEAU rappel identique à un rappel pas encore fait n'est pas
 * recréé : la tour rend l'existant (`dejaLa`), et lui donne la date du nouveau
 * s'il n'en avait pas — de même sa note, ses alertes et son lieu.
 */
export function ecrireRappels(rappels) {
  if (!Array.isArray(rappels) || !rappels.length) throw new ErreurCarnet(400, "Aucun rappel");
  const d = db();
  const lot = rappels.slice(0, 500);
  const connu = d.prepare("SELECT id FROM rappels WHERE id = ?");
  const nouveaux = lot.filter((r) => !connu.get(id(r?.id, "rappel")));
  const dejaLa = [];
  const dater = [];
  const completer = [];
  let retenus = lot;
  if (nouveaux.length) {
    // Clé de texte → les rappels pas faits. Même texte ET même jour (ou l'un
    // sans date) : le même rappel. Le loyer du 1er novembre et celui du
    // 1er décembre en font deux.
    const ouverts = new Map();
    for (const r of d.prepare("SELECT id, texte, quand FROM rappels WHERE supprime = 0 AND fait = 0 ORDER BY cree_a").all()) {
      const k = cleTexte(r.texte);
      if (k) ouverts.set(k, [...(ouverts.get(k) || []), r]);
    }
    const jumeau = (liste = [], q) =>
      liste.find((x) => q && x.quand && jourLocal(x.quand) === jourLocal(q)) ?? liste.find((x) => !q || !x.quand);
    const ecartes = new Set();
    for (const r of nouveaux) {
      const k = cleTexte(r.texte);
      if (r.fait || !k) continue;
      const q = quandValide(r.quand);
      const deja = jumeau(ouverts.get(k), q);
      if (deja) {
        dejaLa.push({ id: r.id, existant: deja.id, texte: texte(r.texte, 300, "rappel") });
        ecartes.add(r.id);
        if (q && !deja.quand && connu.get(deja.id)) {
          dater.push([q, deja.id]);
          deja.quand = q;
        }
        // « Acheter du pain » en arrivant à la boulangerie, redit : le lieu
        // (la note, les alertes) rejoint le rappel déjà là, sans rien écraser.
        const x = declencheursDe(r);
        if (aDesDeclencheurs(x) && connu.get(deja.id)) completer.push([deja.id, x]);
      } else ouverts.set(k, [...(ouverts.get(k) || []), { id: r.id, quand: q }]);
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
    for (const [i, x] of completer) {
      const la = d.prepare("SELECT note, alertes, lieu FROM rappels WHERE id = ?").get(i) || {};
      poserDeclencheurs(d, i, {
        note: !la.note && x.note ? x.note : undefined,
        alertes: !la.alertes && x.alertes?.length ? x.alertes : undefined,
        lieu: !la.lieu && x.lieu ? x.lieu : undefined,
      });
    }
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

// --- « Bloquée par » : une tâche qui attend qu'une autre soit finie ----------------
//
// L'API publique de Motion n'expose pas ses « blockers » (lu dans sa doc le
// 12/11 : ni champ en lecture, ni en écriture) : le lien vit dans Remy, et
// Motion continue de planifier la tâche bloquée comme si de rien n'était. Remy
// ne la propose donc JAMAIS comme « à faire maintenant », et le dit.
//
// Une tâche se débloque seule quand toutes ses bloquantes sont terminées
// (coche dans Rémy) ou ont quitté la liste Motion (finies ou supprimées
// ailleurs) — avec une trace dans l'historique. L'ancien « en attente » (avec
// sa raison en texte) reste à part : on peut attendre « le bon de commande »
// sans dépendre d'une tâche.

const MAX_BLOQUANTES = 8;
const nomCourt = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, 200) || null);

/** Les liens actifs : `par` (tâche → ses bloquantes), `debloque` (bloquante → ce qu'elle retient). */
export function blocages() {
  const par = new Map();
  const debloque = new Map();
  const lignes = db()
    .prepare("SELECT tache_id, bloquante_id, tache_nom, bloquante_nom, cree_a FROM dependances_taches WHERE levee_a IS NULL ORDER BY cree_a, rowid")
    .all();
  for (const l of lignes) {
    par.set(l.tache_id, [...(par.get(l.tache_id) || []), { id: l.bloquante_id, nom: l.bloquante_nom || null }]);
    debloque.set(l.bloquante_id, [...(debloque.get(l.bloquante_id) || []), { id: l.tache_id, nom: l.tache_nom || null }]);
  }
  return { par, debloque, liens: lignes };
}

// --- Les nœuds : un projet Motion (« motion:<id> ») ou un dossier de Remy
// (« dossier:<id> ») peut attendre, ou être attendu (projets-bloques-v1) ---
//
// La même table, le même pivot qu'ailleurs : `tache_id` ou `bloquante_id`
// valent un identifiant de tâche Motion, ou un nœud préfixé. Une tâche d'un
// nœud bloqué est bloquée elle aussi (sans un lien par tâche) ; ses
// sous-dossiers aussi. Un nœud est FINI quand Sam le dit (« C'est fini »,
// gardé comme l'activité faite : etats_taches.fait_a), ou quand une liste
// Motion lue en entier n'a plus aucune de ses tâches ouvertes alors qu'elle
// en avait (un projet tout neuf, encore vide, n'est pas « fini »).

export const estNoeud = (v) => /^(dossier|motion):/.test(String(v ?? ""));
const projetDe = (t) => {
  const p = t?.project?.id || t?.projectId;
  return p ? `motion:${p}` : null;
};

/**
 * Qui contient quoi : les dossiers (et leur parent), les tâches rangées, et
 * les projets des tâches Motion de `taches` (la liste de la tour, si elle est là).
 */
export function contexteNoeuds(taches = null) {
  const d = db();
  const parent = new Map();
  const enfants = new Map();
  const noms = new Map();
  const existe = new Set();
  const membres = new Map(); // nœud → Set de tâches directes
  const noeudsDe = new Map(); // tâche → nœuds directs
  const ajouterMembre = (n, t) => {
    if (!membres.has(n)) membres.set(n, new Set());
    membres.get(n).add(t);
    noeudsDe.set(t, [...new Set([...(noeudsDe.get(t) || []), n])]);
  };
  for (const x of d.prepare("SELECT id, nom, parent FROM dossiers WHERE supprime = 0").all()) {
    const n = `dossier:${x.id}`;
    existe.add(n);
    noms.set(n, x.nom);
    if (x.parent) {
      const p = x.parent.startsWith("motion:") ? x.parent : `dossier:${x.parent}`;
      parent.set(n, p);
      enfants.set(p, [...(enfants.get(p) || []), n]);
    }
  }
  for (const r of d.prepare("SELECT tache_id, dossier FROM rattachements").all()) ajouterMembre(`dossier:${r.dossier}`, r.tache_id);
  for (const t of Array.isArray(taches) ? taches : []) {
    const n = projetDe(t);
    if (!n || !t?.id) continue;
    existe.add(n);
    if (t.project?.name && !noms.has(n)) noms.set(n, nomCourt(t.project.name));
    ajouterMembre(n, String(t.id));
  }
  return { parent, enfants, noms, existe, membres, noeudsDe };
}

/** Les nœuds qui contiennent une tâche, ses dossiers et leurs parents compris. */
function noeudsAscendants(ctx, tache) {
  const out = [];
  const pile = [...(ctx.noeudsDe.get(tache) || [])];
  while (pile.length && out.length < 60) {
    const n = pile.pop();
    if (out.includes(n)) continue;
    out.push(n);
    const p = ctx.parent.get(n);
    if (p) pile.push(p);
  }
  return out;
}

/** Ce qui contient `x` (une tâche : ses projets et dossiers ; un nœud : ses parents), pour le choix des apps. */
export function contenantsDe(ctx, x) {
  if (!estNoeud(x)) return noeudsAscendants(ctx, x);
  const out = [];
  for (let p = ctx.parent.get(x), k = 0; p && k < 30; p = ctx.parent.get(p), k++) out.push(p);
  return out;
}

/** Les tâches d'un nœud, ses sous-dossiers compris. */
function tachesDuNoeud(ctx, noeud) {
  const vus = new Set();
  const taches = new Set();
  const pile = [noeud];
  while (pile.length && vus.size < 500) {
    const n = pile.pop();
    if (vus.has(n)) continue;
    vus.add(n);
    for (const t of ctx.membres.get(n) || []) taches.add(t);
    for (const e of ctx.enfants.get(n) || []) pile.push(e);
  }
  return taches;
}

/**
 * Le lien cible ← bloquante bouclerait-il ? Le graphe d'attente, tâches et
 * nœuds mêlés : une tâche attend ses bloquantes et le DÉBUT de ses nœuds ; le
 * début d'un nœud attend ses bloquantes et le début de son parent ; la FIN
 * d'un nœud attend son début, ses tâches et la fin de ses sous-dossiers. Le
 * lien boucle si la fin de la bloquante attend (même de loin) le début de la cible.
 */
function boucle(par, cible, bloquante, ctx = null) {
  const fin = (x) => (estNoeud(x) ? `e:${x}` : `t:${x}`);
  const debut = (x) => (estNoeud(x) ? `s:${x}` : `t:${x}`);
  const but = debut(cible);
  const vus = new Set();
  const pile = [fin(bloquante)];
  while (pile.length) {
    const v = pile.pop();
    if (v === but) return true;
    if (vus.has(v) || vus.size > 5000) continue;
    vus.add(v);
    const x = v.slice(2);
    if (v.startsWith("t:") || v.startsWith("s:")) for (const b of par.get(x) || []) pile.push(fin(b.id));
    if (!ctx) continue;
    if (v.startsWith("t:")) for (const n of ctx.noeudsDe.get(x) || []) pile.push(`s:${n}`);
    if (v.startsWith("s:") && ctx.parent.get(x)) pile.push(`s:${ctx.parent.get(x)}`);
    if (v.startsWith("e:")) {
      pile.push(`s:${x}`);
      for (const t of ctx.membres.get(x) || []) pile.push(`t:${t}`);
      for (const e of ctx.enfants.get(x) || []) pile.push(`e:${e}`);
    }
  }
  return false;
}

const nomDe = (noms, i, defaut = null) => nomCourt(noms?.get?.(i)) || defaut;

function verifierLiens(d, tache, ids, { noms, ouverts, par, ctx = null }) {
  for (const b of ids) {
    if (b === tache) throw new ErreurCarnet(400, estNoeud(b) ? "Un projet ne peut pas attendre d'être fini lui-même." : "Une tâche ne peut pas attendre d'être finie elle-même.");
    if (estNoeud(b)) {
      // Un dossier supprimé, ou un projet que la tour n'a jamais vu : rien à attendre.
      if (ctx && !ctx.existe.has(b) && !noms?.has?.(b)) throw new ErreurCarnet(404, "Ce projet n'existe plus (supprimé ou archivé) : il ne peut rien bloquer.");
    } else if (ouverts && !ouverts.has(b)) throw new ErreurCarnet(404, `« ${nomDe(noms, b, b)} » n'est plus dans Motion (finie ou supprimée) : elle ne peut pas bloquer une tâche.`);
    if (boucle(par, tache, b, ctx)) {
      throw new ErreurCarnet(409, `« ${nomDe(noms, b, "Cette tâche")} » attend déjà « ${nomDe(noms, tache, "celle-ci")} » : les deux s'attendraient l'une l'autre.`);
    }
  }
}

function poserLien(d, tache, b, { noms, origine, t, ctx = null }) {
  d.prepare(`
    INSERT INTO dependances_taches (tache_id, bloquante_id, tache_nom, bloquante_nom, origine, cree_a, levee_a, levee_raison)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(tache_id, bloquante_id) DO UPDATE SET
      tache_nom = COALESCE(excluded.tache_nom, dependances_taches.tache_nom),
      bloquante_nom = COALESCE(excluded.bloquante_nom, dependances_taches.bloquante_nom),
      origine = excluded.origine,
      cree_a = CASE WHEN dependances_taches.levee_a IS NULL THEN dependances_taches.cree_a ELSE excluded.cree_a END,
      levee_a = NULL, levee_raison = NULL`)
    .run(tache, b, nomDe(noms, tache, ctx?.noms.get(tache) ?? null), nomDe(noms, b, ctx?.noms.get(b) ?? null), origine === "chat" ? "chat" : "tap", t);
  // Un nœud attendu qui a déjà des tâches ouvertes : il sera « fini » quand il n'en aura plus.
  if (estNoeud(b) && ctx && tachesDuNoeud(ctx, b).size) d.prepare("UPDATE dependances_taches SET bloquante_vue = 1 WHERE tache_id = ? AND bloquante_id = ?").run(tache, b);
}

const lister = (tache) =>
  db().prepare("SELECT bloquante_id AS id, bloquante_nom AS nom FROM dependances_taches WHERE tache_id = ? AND levee_a IS NULL ORDER BY cree_a, rowid").all(tache);

/**
 * Remplace les bloquantes d'une tâche (« Bloquée par… » de Gérer) : [] les
 * retire toutes. `noms` : Map id → nom (la liste Motion) ; `ouverts` : Set des
 * tâches ouvertes, si la tour l'a (une tâche déjà finie ne bloque rien).
 * Refuse l'auto-blocage et les boucles (A attend B qui attend A).
 */
export function poserBlocages(idTache, ids, { noms = null, ouverts = null, origine = "tap", maintenant = Date.now(), taches = null } = {}) {
  const tache = id(idTache, "tâche");
  if (!Array.isArray(ids)) throw new ErreurCarnet(400, "bloqueePar : une liste d'identifiants");
  const voulues = [...new Set(ids.map((x) => id(x, "tâche bloquante")))];
  if (voulues.length > MAX_BLOQUANTES) throw new ErreurCarnet(400, `Pas plus de ${MAX_BLOQUANTES} tâches bloquantes pour une tâche.`);
  const d = db();
  const actuelles = new Set(lister(tache).map((l) => l.id));
  const { par } = blocages();
  par.delete(tache); // ses anciennes bloquantes ne comptent pas pour la boucle : elles sont remplacées
  // Une bloquante déjà là n'est pas revérifiée contre `ouverts` (elle peut
  // venir d'une liste Motion plus fraîche que celle de la tour).
  const ctx = contexteNoeuds(taches);
  verifierLiens(d, tache, voulues.filter((b) => !actuelles.has(b)), { noms, ouverts, par, ctx });
  verifierLiens(d, tache, voulues.filter((b) => actuelles.has(b)), { noms, ouverts: null, par, ctx });
  transaction(() => {
    for (const b of actuelles) {
      if (!voulues.includes(b)) d.prepare("UPDATE dependances_taches SET levee_a = ?, levee_raison = 'retiree' WHERE tache_id = ? AND bloquante_id = ? AND levee_a IS NULL").run(maintenant, tache, b);
    }
    for (const b of voulues) poserLien(d, tache, b, { noms, origine, t: maintenant, ctx });
  });
  return { ok: true, bloqueePar: lister(tache) };
}

/**
 * Ajoute des bloquantes sans retirer les autres (une proposition de Rémy
 * validée : « d'abord A, puis B »). Rend celles qui n'ont pas pu être posées,
 * avec la raison, au lieu d'échouer en bloc : les tâches sont déjà créées.
 */
export function ajouterBlocages(idTache, ids, { noms = null, origine = "chat", maintenant = Date.now(), taches = null } = {}) {
  const tache = id(idTache, "tâche");
  const d = db();
  const ctx = contexteNoeuds(taches);
  const posees = [];
  const refusees = [];
  for (const brut of [...new Set(ids || [])]) {
    try {
      const b = id(brut, "tâche bloquante");
      const { par } = blocages();
      if (!par.get(tache)?.some((x) => x.id === b) && (par.get(tache) || []).length >= MAX_BLOQUANTES) {
        throw new ErreurCarnet(400, `Pas plus de ${MAX_BLOQUANTES} tâches bloquantes pour une tâche.`);
      }
      verifierLiens(d, tache, [b], { noms, ouverts: null, par, ctx });
      poserLien(d, tache, b, { noms, origine, t: maintenant, ctx });
      posees.push({ id: b, nom: nomDe(noms, b) });
    } catch (err) {
      if (!(err instanceof ErreurCarnet)) throw err;
      refusees.push({ id: String(brut), nom: nomDe(noms, String(brut)), erreur: err.message });
    }
  }
  return { posees, refusees };
}

// La trace d'un déblocage, dans le journal (l'Historique la montre) : rien à
// annuler de ce côté-là — c'est la coche de la bloquante qui s'annule.
function tracerDeblocage(d, debloquees, { bloquante, t }) {
  if (!debloquees.length) return null;
  const journalId = crypto.randomUUID();
  const resume = debloquees.length === 1
    ? estNoeud(debloquees[0].id) ? `« ${debloquees[0].nom || "Un projet"} » est débloqué.` : `« ${debloquees[0].nom || "Une tâche"} » est débloquée.`
    : `${debloquees.length} débloqués (tâches ou projets).`;
  const actions = debloquees.map((x) => ({ type: "debloquer", id: x.id, nom: x.nom || "—" }));
  const results = debloquees.map((x) => ({ ok: true, type: "debloquer", id: x.id, nom: x.nom || "—", par: x.par }));
  d.prepare(`
    INSERT INTO journal (id, ts, source, origine, resume, commande_id, etat, actions, results, annulations, maj_a)
    VALUES (?, ?, 'remy', 'auto', ?, ?, 'appliquee', ?, ?, '{}', ?)`)
    .run(journalId, t, resume.slice(0, 200), bloquante ? `deblocage:${bloquante}:${t}` : null, JSON.stringify(actions), JSON.stringify(results), t);
  return journalId;
}

// Lève des liens ; rend les tâches qui n'attendent PLUS rien, avec les noms
// de ce qu'elles attendaient.
function lever(d, liens, raison, t, noms = null) {
  const toucheees = new Map();
  for (const l of liens) {
    d.prepare("UPDATE dependances_taches SET levee_a = ?, levee_raison = ? WHERE tache_id = ? AND bloquante_id = ? AND levee_a IS NULL").run(t, raison, l.tache_id, l.bloquante_id);
    const x = toucheees.get(l.tache_id) || { id: l.tache_id, nom: nomDe(noms, l.tache_id, l.tache_nom || null), par: [] };
    x.par.push(nomDe(noms, l.bloquante_id, l.bloquante_nom || "—"));
    toucheees.set(l.tache_id, x);
  }
  const restent = d.prepare("SELECT COUNT(*) AS n FROM dependances_taches WHERE tache_id = ? AND levee_a IS NULL");
  return [...toucheees.values()].filter((x) => restent.get(x.id).n === 0);
}

/**
 * Une tâche vient d'être terminée (coche dans Rémy, Motion d'accord) : ce
 * qu'elle retenait est libéré. Rend les tâches débloquées pour de bon
 * ([{ id, nom, par }]) — l'app dit « Y est débloquée ».
 */
export function bloquanteTerminee(idBloquante, { nom = null, noms = null, maintenant = Date.now() } = {}) {
  const b = id(idBloquante, "tâche");
  const d = db();
  return transaction(() => {
    if (nom) d.prepare("UPDATE dependances_taches SET bloquante_nom = ? WHERE bloquante_id = ? AND levee_a IS NULL").run(nomCourt(nom), b);
    // Finie elle-même alors qu'elle attendait : ses liens à elle n'ont plus lieu d'être.
    d.prepare("UPDATE dependances_taches SET levee_a = ?, levee_raison = 'tache_finie' WHERE tache_id = ? AND levee_a IS NULL").run(maintenant, b);
    const liens = d.prepare("SELECT * FROM dependances_taches WHERE bloquante_id = ? AND levee_a IS NULL").all(b);
    const debloquees = lever(d, liens, "terminee", maintenant, noms);
    tracerDeblocage(d, debloquees, { bloquante: b, t: maintenant });
    return debloquees.map(({ id: i, nom: n, par }) => ({ id: i, nom: n, par }));
  });
}

/**
 * « Annuler » sur la coche d'une bloquante : les liens levés par cette fin
 * reviennent (depuis `depuis`), et la trace du déblocage est marquée annulée.
 */
export function retablirBlocages(idBloquante, depuis, { maintenant = Date.now() } = {}) {
  const b = id(idBloquante, "tâche");
  const d = db();
  return transaction(() => {
    const n = d.prepare("UPDATE dependances_taches SET levee_a = NULL, levee_raison = NULL WHERE bloquante_id = ? AND levee_raison = 'terminee' AND levee_a >= ?").run(b, depuis).changes;
    d.prepare("UPDATE dependances_taches SET levee_a = NULL, levee_raison = NULL WHERE tache_id = ? AND levee_raison = 'tache_finie' AND levee_a >= ?").run(b, depuis);
    d.prepare("UPDATE journal SET annule = 1, annule_a = ?, maj_a = ? WHERE source = 'remy' AND commande_id LIKE ? AND ts >= ? AND annule = 0").run(maintenant, maintenant, `deblocage:${b}:%`, depuis);
    return n;
  });
}

/**
 * La liste Motion vient d'être relue EN ENTIER (jamais une liste tronquée ou
 * gardée d'avant) : une bloquante qui n'y est plus est finie ou supprimée
 * ailleurs — sa tâche se débloque (trace dans l'historique). Une tâche bloquée
 * qui n'y est plus perd ses liens sans bruit. Les noms suivent Motion.
 */
export function reconcilierBlocages(taches, { maintenant = Date.now() } = {}) {
  if (!Array.isArray(taches) || taches.tronquee) return [];
  const d = db();
  const liens = d.prepare("SELECT * FROM dependances_taches WHERE levee_a IS NULL").all();
  if (!liens.length) return [];
  const ouverts = new Map(taches.filter((t) => t?.id).map((t) => [String(t.id), nomCourt(t.name)]));
  // Une liste vide alors que des tâches attendent : Motion a mal répondu,
  // personne n'a fini TOUTES ses tâches d'un coup.
  if (!ouverts.size) return [];
  return transaction(() => {
    for (const l of liens) {
      const nt = ouverts.get(l.tache_id);
      const nb = ouverts.get(l.bloquante_id);
      if ((nt && nt !== l.tache_nom) || (nb && nb !== l.bloquante_nom)) {
        d.prepare("UPDATE dependances_taches SET tache_nom = COALESCE(?, tache_nom), bloquante_nom = COALESCE(?, bloquante_nom) WHERE tache_id = ? AND bloquante_id = ?").run(nt || null, nb || null, l.tache_id, l.bloquante_id);
        if (nt) l.tache_nom = nt;
        if (nb) l.bloquante_nom = nb;
      }
    }
    // Les nœuds ne sont pas des tâches : ni « disparus », ni « finis » à ce titre-là.
    const sansTache = liens.filter((l) => !estNoeud(l.tache_id) && !ouverts.has(l.tache_id));
    for (const l of sansTache) d.prepare("UPDATE dependances_taches SET levee_a = ?, levee_raison = 'tache_finie' WHERE tache_id = ? AND bloquante_id = ?").run(maintenant, l.tache_id, l.bloquante_id);
    const present = (i) => (estNoeud(i) ? true : ouverts.has(i));
    const parties = liens.filter((l) => !estNoeud(l.bloquante_id) && present(l.tache_id) && !ouverts.has(l.bloquante_id));
    const debloquees = lever(d, parties, "disparue", maintenant);
    tracerDeblocage(d, debloquees, { bloquante: null, t: maintenant });
    return [...debloquees, ...noeudsFinis(d, taches, liens.filter((l) => estNoeud(l.bloquante_id) && present(l.tache_id)), maintenant)];
  });
}

// Un nœud attendu est fini quand la liste (complète) n'a plus aucune de ses
// tâches ouvertes ET qu'on lui en a déjà vu : ce qui l'attendait se débloque.
function noeudsFinis(d, taches, liens, maintenant) {
  if (!liens.length) return [];
  const ctx = contexteNoeuds(taches);
  const finis = [];
  for (const b of new Set(liens.map((l) => l.bloquante_id))) {
    const n = tachesDuNoeud(ctx, b).size;
    const siens = liens.filter((l) => l.bloquante_id === b);
    if (n > 0) {
      d.prepare("UPDATE dependances_taches SET bloquante_vue = 1 WHERE bloquante_id = ? AND levee_a IS NULL AND bloquante_vue = 0").run(b);
      continue;
    }
    const vus = siens.filter((l) => l.bloquante_vue);
    if (!vus.length) continue;
    const libres = lever(d, vus, "terminee", maintenant, ctx.noms);
    tracerDeblocage(d, libres, { bloquante: b, t: maintenant });
    finis.push(...libres);
  }
  return finis;
}

/**
 * Après une coche dans Rémy : la liste en mémoire de la tour (qui vient de
 * perdre la tâche finie) dit si un projet attendu n'a plus rien d'ouvert.
 * Seulement si cette liste est complète.
 */
export function reconcilierNoeuds(taches, { maintenant = Date.now() } = {}) {
  if (!Array.isArray(taches) || taches.tronquee || !taches.length) return [];
  const d = db();
  const liens = d.prepare("SELECT * FROM dependances_taches WHERE levee_a IS NULL").all().filter((l) => estNoeud(l.bloquante_id));
  if (!liens.length) return [];
  return transaction(() => noeudsFinis(d, taches, liens, maintenant));
}

/**
 * Ce que Remy sait des nœuds, pour Projets : { bloquePar, debloque, fini,
 * finiA } par nœud (« dossier:<id> » ou « motion:<id> »), seulement ceux qui
 * en ont. `taches` : la liste Motion (les noms des projets).
 */
export function marquesNoeuds(taches = null, { liens = blocages(), etats = etatsTaches() } = {}) {
  const ctx = contexteNoeuds(taches);
  const nom = (x) => ({ id: x.id, nom: ctx.noms.get(x.id) || nomCourt((Array.isArray(taches) ? taches : []).find((t) => String(t.id) === x.id)?.name) || x.nom || (estNoeud(x.id) ? "un autre projet" : "une autre tâche"), ...(estNoeud(x.id) ? { noeud: true } : {}) });
  const out = new Map();
  const poser = (n, cle, v) => out.set(n, { ...(out.get(n) || {}), [cle]: v });
  for (const [n, l] of liens.par) if (estNoeud(n)) poser(n, "bloquePar", l.map(nom));
  for (const [b, l] of liens.debloque) if (estNoeud(b)) poser(b, "debloque", l.map(nom));
  for (const [i, e] of etats) if (estNoeud(i) && e.faitA) (poser(i, "fini", true), poser(i, "finiA", e.faitA));
  // Un parent bloqué bloque ses sous-dossiers : dit sur le sous-dossier.
  for (const n of ctx.existe) {
    if (out.get(n)?.bloquePar) continue;
    for (let p = ctx.parent.get(n), k = 0; p && k < 30; p = ctx.parent.get(p), k++) {
      const l = liens.par.get(p);
      if (l?.length) {
        poser(n, "parentBloque", { id: p, nom: ctx.noms.get(p) || "le projet parent", par: l.map(nom) });
        break;
      }
    }
  }
  return out;
}

const RANG_MENACE = 48 * 3600_000;
const msDe = (v) => {
  const t = typeof v === "number" ? v : Date.parse(v ?? "");
  return Number.isFinite(t) ? t : null;
};

/**
 * Pose sur les tâches BRUTES de Motion ce que Remy sait d'elles, avant tout
 * calcul (journée, briefing, menaces, semaine) :
 *   - bloquee + raison : « en attente » (état manuel) OU bloquée par une tâche ;
 *     sans raison écrite, « après « A » » (ce qu'une app d'avant affiche) ;
 *   - attente : true si l'état manuel est posé AUSSI (les nouvelles apps
 *     distinguent « Reprendre » du lien) ;
 *   - bloqueePar / debloque : [{ id, nom }] (le nom courant de Motion d'abord) ;
 *   - menaceBlocage (+ finBloquante, ms) : une phrase quand l'échéance de la tâche bloquée est
 *     menacée par ce qu'elle attend (l'échéance de la bloquante est après la
 *     sienne, ou tombe sous 48 h sans que rien ne soit fini).
 * Rien de tout ça n'existe chez Motion : aucune requête.
 */
export function annoterTaches(taches, { etats = etatsTaches(), liens = blocages(), maintenant = Date.now() } = {}) {
  if (!Array.isArray(taches)) return taches;
  if (!etats.size && !liens.par.size && !liens.debloque.size) return taches;
  const parId = new Map(taches.filter((t) => t?.id).map((t) => [String(t.id), t]));
  // Les nœuds (projets-bloques-v1) : seulement s'il y a un lien qui en parle.
  const avecNoeuds = [...liens.par.keys(), ...liens.debloque.keys()].some(estNoeud);
  const ctx = avecNoeuds ? contexteNoeuds(taches) : null;
  const lien = (x) => (estNoeud(x.id)
    ? { id: x.id, nom: ctx?.noms.get(x.id) || x.nom || "un autre projet", noeud: true }
    : { id: x.id, nom: nomCourt(parId.get(x.id)?.name) || x.nom || "une autre tâche" });
  // La fin prévue de ce qu'on attend : une tâche (son créneau, son
  // échéance), ou un projet (la plus tardive de ses tâches ouvertes).
  const finDe = (b) => {
    const ids = estNoeud(b.id) && ctx ? [...tachesDuNoeud(ctx, b.id)] : [b.id];
    return Math.max(-Infinity, ...ids.map((k) => parId.get(k)).map((bt) => Math.max(msDe(bt?.scheduledEnd) ?? -Infinity, msDe(bt?.dueDate) ?? -Infinity)));
  };
  // Un nœud bloqué (le sien, ou un parent) : { id, nom, par }.
  const projetBloque = (i) => {
    if (!ctx) return null;
    for (const n of noeudsAscendants(ctx, i)) {
      const l = liens.par.get(n);
      if (l?.length) return { id: n, nom: ctx.noms.get(n) || "son projet", par: l.map(lien) };
    }
    return null;
  };
  const out = taches.map((t) => {
    if (!t?.id) return t;
    const i = String(t.id);
    const e = etats.get(i);
    const par = (liens.par.get(i) || []).map(lien);
    const retient = (liens.debloque.get(i) || []).filter((x) => estNoeud(x.id) || parId.has(x.id) || !parId.size).map(lien);
    const pb = projetBloque(i);
    if (!e?.bloquee && !par.length && !retient.length && !pb) return t;
    const x = { ...t };
    if (retient.length) x.debloque = retient;
    if (pb) x.projetBloque = pb;
    if (e?.bloquee || par.length || pb) {
      x.bloquee = true;
      x.raison = e?.bloquee && e.raison ? e.raison
        : par.length ? `après « ${par[0].nom} »${par.length > 1 ? ` (+${par.length - 1})` : ""}`
          : pb ? `projet « ${pb.nom} » après « ${pb.par[0].nom} »` : null;
    }
    // Ce qu'elle attend, en tout : ses bloquantes, puis celles de son projet.
    const attend = [...par, ...(pb ? pb.par : [])];
    if (attend.length) {
      if (par.length) x.bloqueePar = par;
      if (e?.bloquee) x.attente = true;
      const due = msDe(t.dueDate);
      if (due !== null) {
        const pire = attend.map((b) => ({ b, fin: finDe(b) })).sort((a, c) => c.fin - a.fin)[0];
        const duree = typeof t.duration === "number" ? t.duration * 60_000 : 0;
        if (pire && Number.isFinite(pire.fin) && pire.fin > due - duree) {
          x.menaceBlocage = `Elle attend « ${pire.b.nom} », prévu${pire.b.noeud ? "" : "e"} après son échéance.`;
          x.finBloquante = pire.fin;
        } else if (due - maintenant < RANG_MENACE) {
          x.menaceBlocage = `Due bientôt, et elle attend encore « ${attend[0].nom} ».`;
          if (Number.isFinite(pire?.fin)) x.finBloquante = pire.fin;
        }
      }
    }
    return x;
  });
  if (taches.tronquee) out.tronquee = true;
  return out;
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
    // Déjà posé par annoterTaches (avec le lien « bloquée par ») : il fait foi.
    return e?.bloquee && !t.bloquee ? { ...t, bloquee: true, raison: e.raison } : t;
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
