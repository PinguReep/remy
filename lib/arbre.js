// L'arbre des projets comme vue de ce que Rémy a compris (12/11).
//
// Un NŒUD est le pivot unique : « motion:<id> » (un projet Motion) ou
// « dossier:<id> » (un dossier de Remy, sous un projet ou à part). Chaque nœud
// a une FICHE de trois champs — pourquoi, état, où on en est — et chaque champ
// porte son origine :
//   - « deduit »  : Rémy l'a déduit de ce qu'il sait déjà, SANS IA, avec sa
//                   source en clair (« d'après 3 tâches Motion et ta priorité
//                   n°2 »). Jamais rangé : recalculé à chaque lecture, toujours
//                   montré comme une hypothèse ;
//   - « confirme » : Sam a dit « C'est ça » à une déduction (sa source est
//                   gardée avec elle) ;
//   - « ecrit »   : Sam l'a écrit ou corrigé, avec ses mots.
// Une déduction écartée (« Pas ça ») n'est plus reproposée tant qu'elle ne
// change pas. Chaque changement d'un champ s'ajoute à l'historique du nœud.
//
// Rien n'est écrit chez Motion. Tout vit dans remy.db, sur la tour — en
// clair, comme le reste de cette base : le verrou (lib/verrou.js) protège
// l'écran et l'API, pas le disque.
//
// D'où Rémy tire ses déductions : les tâches Motion ouvertes du nœud et de ses
// sous-branches (échéances, prochaine tâche, « bloquée par »), ce que Sam a
// dit d'un projet entier (« attend tel projet », « C'est fini » :
// projets-bloques-v1), les tâches cochées depuis Rémy, le mouvement dans
// Rémy (dossier, idées, rangements), les conversations rattachées, ses
// priorités confirmées (rang, et ses mots pour le pourquoi) et sa mémoire.
//
// Ce que Rémy NE SAIT PAS déduire : qu'une branche est « faite » sans que Sam
// l'ait dit (il ne voit que ce qui reste ouvert), le pourquoi d'une branche
// que ni une priorité ni sa mémoire ne nomment, ce qui avance hors de Motion
// et de Rémy (du code dans Claude Code ou T3, du papier, un coup de fil),
// l'importance d'une chose courte. Une tâche terminée ailleurs que dans Rémy
// ne laisse aucune trace ici.

import { db, transaction, lireJSON } from "./db.js";
import { reconnait, motsDe } from "./priorites.js";

export const CHAMPS = ["pourquoi", "etat", "point"];
export const ETATS = ["en_cours", "en_attente", "en_pause", "fait"];
export const ORIGINES = ["confirme", "ecrit"];
export const LIBELLES_ETAT = { en_cours: "en cours", en_attente: "en attente", en_pause: "en pause", fait: "fait" };
const MAX_TEXTE = 240;
const MAX_SOURCE = 200;
const MAX_HISTORIQUE = 40; // par nœud : au-delà, les plus anciens sortent
const JOUR = 86_400_000;
const RECENT_JOURS = 14;
const IMMOBILE_JOURS = 21;

export class ErreurArbre extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

const NOEUD = /^(dossier|motion):[A-Za-z0-9:_.\-]{1,160}$/;
export const noeudValide = (v) => typeof v === "string" && NOEUD.test(v);
function noeud(v) {
  if (!noeudValide(v)) throw new ErreurArbre(400, "nœud invalide (attendu : « dossier:<id> » ou « motion:<id> »)");
  return v;
}
/** Le nœud d'un dossier, d'après la forme de son parent (`null`, « motion:<id> » ou un id de dossier). */
export const noeudDuParent = (parent) => (!parent ? null : String(parent).startsWith("motion:") ? String(parent) : `dossier:${parent}`);
const propre = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const a = (o, cle) => Boolean(o) && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, cle);

// --- Les fiches (ce que Sam a confirmé ou écrit) --------------------------------------

function ligneVersFiche(l) {
  const f = { noeud: l.noeud, majA: l.maj_a, ecartes: lireJSON(l.ecartes, {}) || {} };
  for (const c of CHAMPS) {
    f[c] = l[c] == null ? null : { texte: l[c], origine: l[`${c}_origine`] || "ecrit", source: l[`${c}_source`] || null, a: l[`${c}_a`] || l.maj_a };
  }
  return f;
}

/** Toutes les fiches : Map nœud → fiche. */
export function lireFiches() {
  const m = new Map();
  for (const l of db().prepare("SELECT * FROM fiches_noeuds").all()) m.set(l.noeud, ligneVersFiche(l));
  return m;
}

export function lireFiche(n) {
  const l = db().prepare("SELECT * FROM fiches_noeuds WHERE noeud = ?").get(noeud(n));
  return l ? ligneVersFiche(l) : { noeud: n, majA: null, ecartes: {}, pourquoi: null, etat: null, point: null };
}

/** Une valeur envoyée pour un champ → { texte, origine, source } (ou null : effacer), sinon une erreur lisible. */
function valeurDe(champ, v) {
  if (v === null) return null;
  if (!v || typeof v !== "object") throw new ErreurArbre(400, `${champ} : attendu { texte, origine } ou null`);
  const origine = ORIGINES.includes(v.origine) ? v.origine : "ecrit";
  let texte = propre(v.texte, MAX_TEXTE);
  if (champ === "etat") {
    if (!ETATS.includes(texte)) throw new ErreurArbre(400, `état inconnu (${ETATS.join(", ")})`);
  } else if (!texte) throw new ErreurArbre(400, `${champ} vide : envoie null pour l'effacer`);
  if (/[\u0000-\u001f]/.test(texte)) texte = texte.replace(/[\u0000-\u001f]/g, " ");
  // La source n'a de sens que pour une déduction confirmée : ce que Sam écrit vient de lui.
  const source = origine === "confirme" ? propre(v.source, MAX_SOURCE) || null : null;
  return { texte, origine, source };
}

/**
 * Change une fiche. Pour chaque champ (pourquoi, etat, point) : clé absente =
 * inchangé, `null` = effacé, { texte, origine: confirme|ecrit, source? } =
 * remplacé. `ecarter: { champ, texte }` : la déduction n'est plus reproposée
 * (tant qu'elle reste la même). Chaque changement entre dans l'historique.
 */
export function ecrireFiche(n, corps = {}, { maintenant = Date.now() } = {}) {
  const id = noeud(n);
  if (!corps || typeof corps !== "object") throw new ErreurArbre(400, "Corps attendu : { pourquoi?, etat?, point?, ecarter? }");
  const changes = {};
  for (const c of CHAMPS) if (a(corps, c)) changes[c] = valeurDe(c, corps[c]);
  let ecarter = null;
  if (a(corps, "ecarter") && corps.ecarter !== null) {
    const e = corps.ecarter;
    if (!e || !CHAMPS.includes(e.champ) || !propre(e.texte, MAX_TEXTE)) throw new ErreurArbre(400, "ecarter : attendu { champ, texte }");
    ecarter = { champ: e.champ, texte: propre(e.texte, MAX_TEXTE) };
  }
  if (!Object.keys(changes).length && !ecarter) throw new ErreurArbre(400, "Rien à changer");
  transaction((d) => {
    const avant = d.prepare("SELECT * FROM fiches_noeuds WHERE noeud = ?").get(id);
    const f = avant ? ligneVersFiche(avant) : { ecartes: {}, pourquoi: null, etat: null, point: null };
    const ecartes = { ...(f.ecartes || {}) };
    if (ecarter) ecartes[ecarter.champ] = ecarter.texte;
    const hist = d.prepare("INSERT INTO historique_noeuds (noeud, champ, texte, origine, source, a) VALUES (?, ?, ?, ?, ?, ?)");
    const val = {};
    for (const c of CHAMPS) {
      const ancien = f[c];
      if (!(c in changes)) {
        val[c] = ancien ? [ancien.texte, ancien.origine, ancien.source, ancien.a] : [null, null, null, null];
        continue;
      }
      const v = changes[c];
      const memeTexte = (ancien?.texte ?? null) === (v?.texte ?? null);
      const memeOrigine = (ancien?.origine ?? null) === (v?.origine ?? null);
      if (memeTexte && memeOrigine) {
        val[c] = ancien ? [ancien.texte, ancien.origine, ancien.source, ancien.a] : [null, null, null, null];
        continue;
      }
      val[c] = v ? [v.texte, v.origine, v.source, maintenant] : [null, null, null, null];
      hist.run(id, c, v?.texte ?? null, v?.origine ?? null, v?.source ?? null, maintenant);
      // Ce que Sam confirme ou écrit n'est plus « écarté ».
      if (v && ecartes[c] && !ecarter) delete ecartes[c];
    }
    d.prepare(`INSERT INTO fiches_noeuds (noeud, pourquoi, pourquoi_origine, pourquoi_source, pourquoi_a, etat, etat_origine, etat_source, etat_a,
        point, point_origine, point_source, point_a, ecartes, maj_a) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(noeud) DO UPDATE SET pourquoi = excluded.pourquoi, pourquoi_origine = excluded.pourquoi_origine, pourquoi_source = excluded.pourquoi_source,
        pourquoi_a = excluded.pourquoi_a, etat = excluded.etat, etat_origine = excluded.etat_origine, etat_source = excluded.etat_source, etat_a = excluded.etat_a,
        point = excluded.point, point_origine = excluded.point_origine, point_source = excluded.point_source, point_a = excluded.point_a,
        ecartes = excluded.ecartes, maj_a = excluded.maj_a`)
      .run(id, ...val.pourquoi, ...val.etat, ...val.point, JSON.stringify(ecartes), maintenant);
    // Les plus anciens points sortent au-delà de 40 par nœud.
    d.prepare(`DELETE FROM historique_noeuds WHERE noeud = ? AND id NOT IN (SELECT id FROM historique_noeuds WHERE noeud = ? ORDER BY a DESC, id DESC LIMIT ?)`).run(id, id, MAX_HISTORIQUE);
  });
  return lireFiche(id);
}

/** L'historique d'un nœud, du plus récent au plus ancien. */
export function historique(n, { limite = MAX_HISTORIQUE } = {}) {
  return db()
    .prepare("SELECT champ, texte, origine, source, a FROM historique_noeuds WHERE noeud = ? ORDER BY a DESC, id DESC LIMIT ?")
    .all(noeud(n), Math.max(1, Math.min(MAX_HISTORIQUE, Number(limite) || MAX_HISTORIQUE)))
    .map((l) => ({ champ: l.champ, texte: l.texte, origine: l.origine, source: l.source, a: l.a }));
}

// --- Conversations rattachées ---------------------------------------------------------

const CONV = /^[A-Za-z0-9_.\-]{1,120}$/;

/** Rattache une conversation à un nœud (`null` : la détache). Une conversation n'a qu'un nœud. */
export function rattacherConversation(convId, n, { origine = "geste", maintenant = Date.now() } = {}) {
  if (typeof convId !== "string" || !CONV.test(convId)) throw new ErreurArbre(400, "conversation invalide");
  if (n === null || n === undefined || n === "") {
    db().prepare("DELETE FROM conversations_noeuds WHERE conversation_id = ?").run(convId);
    return { ok: true, noeud: null };
  }
  const id = noeud(n);
  db().prepare(`INSERT INTO conversations_noeuds (conversation_id, noeud, origine, maj_a) VALUES (?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET noeud = excluded.noeud, origine = excluded.origine, maj_a = excluded.maj_a`)
    .run(convId, id, origine === "en-parler" ? "en-parler" : "geste", maintenant);
  return { ok: true, noeud: id };
}

export function noeudDeConversation(convId) {
  try {
    return db().prepare("SELECT noeud FROM conversations_noeuds WHERE conversation_id = ?").get(String(convId))?.noeud || null;
  } catch {
    return null;
  }
}

/** Map nœud → [identifiants de conversation]. */
export function conversationsParNoeud() {
  const m = new Map();
  for (const l of db().prepare("SELECT conversation_id, noeud FROM conversations_noeuds ORDER BY maj_a DESC").all()) {
    m.set(l.noeud, [...(m.get(l.noeud) || []), l.conversation_id]);
  }
  return m;
}

// --- L'arbre : les nœuds connus -------------------------------------------------------

/**
 * Les nœuds dans l'ordre de l'arbre (projets Motion, puis leurs dossiers en
 * profondeur ; puis les dossiers à part), chacun avec son parent, son niveau
 * et son chemin (« Boutique › Site vitrine › Pages »). `projets` : ceux de
 * Motion ({ id, nom, statut }), `dossiers` : ceux de Remy ({ id, nom, parent, projetMotion }).
 */
export function noeudsDe({ projets = [], dossiers = [], nomsMotion = new Map() } = {}) {
  const out = [];
  const vus = new Set();
  const enfants = (parent) => dossiers.filter((d) => (d.parent || null) === parent && d.id !== "idees");
  const descendre = (parentNoeud, parentBrut, niveau, chemin) => {
    for (const d of enfants(parentBrut)) {
      const n = `dossier:${d.id}`;
      if (vus.has(n) || niveau > 30) continue;
      vus.add(n);
      const c = [...chemin, d.nom];
      out.push({ noeud: n, type: "dossier", id: d.id, nom: d.nom, parent: parentNoeud, niveau, chemin: c, projetMotion: d.projetMotion || null });
      descendre(n, d.id, niveau + 1, c);
    }
  };
  for (const p of projets) {
    const n = `motion:${p.id}`;
    vus.add(n);
    out.push({ noeud: n, type: "motion", id: String(p.id), nom: p.nom, parent: null, niveau: 0, chemin: [p.nom], statut: p.statut || null });
    descendre(n, n, 1, [p.nom]);
  }
  // Un projet Motion que la liste n'a pas rendu (Motion en panne, liste
  // tronquée) mais qui a des sous-projets : ses branches restent visibles.
  for (const d of dossiers) {
    const n = String(d.parent || "");
    if (!n.startsWith("motion:") || vus.has(n)) continue;
    vus.add(n);
    const nom = nomsMotion.get(n.slice(7)) || "Projet Motion";
    out.push({ noeud: n, type: "motion", id: n.slice(7), nom, parent: null, niveau: 0, chemin: [nom], statut: null, horsListe: true });
    descendre(n, n, 1, [nom]);
  }
  descendre(null, null, 0, []);
  return out;
}

/** Le nœud et tous ses descendants (identifiants de dossiers). */
function sousArbre(noeuds, n) {
  const ids = new Set([n]);
  for (let change = true; change; ) {
    change = false;
    for (const x of noeuds) if (x.parent && ids.has(x.parent) && !ids.has(x.noeud)) (ids.add(x.noeud), (change = true));
  }
  return ids;
}

// --- Ce que Rémy en déduit (sans IA) --------------------------------------------------

const F_JOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris", weekday: "short", day: "numeric", month: "short" });
const jourCourt = (ms) => F_JOUR.format(new Date(ms));
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const F_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.REMY_TZ || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const jourDe = (ms) => {
  const [y, m, d] = F_YMD.format(new Date(ms)).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / JOUR;
};
/** « aujourd'hui », « hier », « il y a 3 j » — en jours du calendrier (Europe/Paris), pas en tranches de 24 h. */
export function age(ms, maintenant = Date.now()) {
  const j = jourDe(maintenant) - jourDe(ms);
  return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`;
}
const guillemets = (t, max = 70) => `« ${propre(t, max)} »`;
/** « a, b et c ». */
const liste = (bouts) => (bouts.length <= 1 ? bouts.join("") : `${bouts.slice(0, -1).join(", ")} et ${bouts.at(-1)}`);

/** Les lignes de la mémoire qui nomment ce nœud, avec leur section (« Objectifs »). */
export function memoireDe(nom, texte, { max = 3 } = {}) {
  const mots = motsDe({ titre: nom });
  if (!mots.length || !texte) return [];
  const out = [];
  let section = null;
  for (const brute of String(texte).split("\n")) {
    const l = brute.trim();
    const titre = l.match(/^#{1,6}\s*(.+)$/);
    if (titre) {
      section = propre(titre[1], 60);
      continue;
    }
    const ligne = propre(l.replace(/^[-*•]\s*/, ""), MAX_TEXTE);
    if (ligne.length < 4) continue;
    if (reconnait(mots, ligne)) out.push({ texte: ligne, section });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Les faits d'un nœud, tirés du contexte déjà lu :
 *   taches     : les tâches Motion ouvertes (normalisées, annotées « bloquée par »)
 *                du nœud et de ses sous-branches ;
 *   coches     : les tâches cochées depuis Rémy ({ a, nom }) ;
 *   activite   : les dernières dates de mouvement dans Rémy (dossier, idées, rangements) ;
 *   conversations : les conversations rattachées ({ id, title, updatedAt }) ;
 *   priorite   : la priorité de Sam reliée au nœud, et son rang ;
 *   memoire    : ce que sa mémoire dit de ce nom (lignes, section).
 */
export function faitsDe(x, contexte) {
  const { noeuds = [], taches = [], rattachements = new Map(), coches = [], dossiers = [], conversations = [], liens = new Map(), priorites = [], memoire = "", marques = new Map() } = contexte;
  const branche = sousArbre(noeuds, x.noeud);
  const dossiersBranche = new Set([...branche].filter((n) => n.startsWith("dossier:")).map((n) => n.slice(8)));
  const projetId = x.type === "motion" ? x.id : null;
  const nomProjet = x.type === "motion" ? x.nom : null;
  const tachesNoeud = taches.filter((t) => {
    const ou = rattachements.get(t.id);
    if (ou) return dossiersBranche.has(ou);
    return projetId !== null && (t.projetId === projetId || (!t.projetId && t.projet && t.projet === nomProjet));
  });
  const idsRattaches = new Set([...rattachements].filter(([, d]) => dossiersBranche.has(d)).map(([t]) => t));
  const cochesNoeud = coches.filter((c) => (c.id && idsRattaches.has(c.id)) || (nomProjet && c.projet === nomProjet && !(c.id && rattachements.has(c.id))));
  const activite = dossiers.filter((d) => dossiersBranche.has(d.id)).map((d) => d.dernier || 0).filter((v) => v > 0);
  const convIds = new Set([...branche].flatMap((n) => liens.get(n) || []));
  const convs = conversations.filter((c) => convIds.has(c.id)).sort((p, q) => (q.updatedAt || 0) - (p.updatedAt || 0));
  const ouvertesNotes = dossiers.filter((d) => dossiersBranche.has(d.id)).reduce((n, d) => n + (d.ouvertes || 0), 0);
  // La priorité : reliée par l'identifiant du projet (lien sûr), sinon par ses mots (« ressemble »).
  const classees = priorites.filter((p) => p.classee === true);
  const rangDe = (p) => (p.classee === true ? classees.indexOf(p) + 1 : null);
  let priorite = null;
  const parId = projetId ? priorites.find((p) => p.projetMotion === projetId) : null;
  if (parId) priorite = { id: parId.id, titre: parId.titre, pourquoi: parId.pourquoi || "", rang: rangDe(parId), lien: "projet" };
  else {
    const parMots = priorites.find((p) => !p.projetMotion && motsDe(p).length && reconnait(motsDe(p), x.nom));
    if (parMots) priorite = { id: parMots.id, titre: parMots.titre, pourquoi: parMots.pourquoi || "", rang: rangDe(parMots), lien: "mots" };
  }
  // Ce que Sam a dit du nœud entier (projets-bloques-v1) : il attend, il est fini.
  const m = marques.get(x.noeud) || {};
  const marque = {
    bloquePar: Array.isArray(m.bloquePar) ? m.bloquePar : [],
    parentBloque: m.parentBloque || null,
    fini: m.fini === true,
    finiA: m.finiA || null,
  };
  return { taches: tachesNoeud, coches: cochesNoeud, activite, conversations: convs, ouvertesNotes, priorite, memoire: memoireDe(x.nom, memoire), statut: x.statut || null, marque };
}

const deduction = (texte, source, extra = {}) => ({ texte: propre(texte, MAX_TEXTE), source: propre(source, MAX_SOURCE), ...extra });

/** Ce que les tâches disent, en clair : « 3 tâches Motion », « dont 1 bloquée ». */
function sourceTaches(taches) {
  if (!taches.length) return null;
  const bloquees = taches.filter((t) => t.bloquee).length;
  return `${pluriel(taches.length, "tâche Motion", "tâches Motion")}${bloquees ? ` (dont ${bloquees} bloquée${bloquees > 1 ? "s" : ""})` : ""}`;
}
const sourcePriorite = (p) => (p?.rang ? `ta priorité n°${p.rang}` : p ? "ta priorité écrite (pas encore classée)" : null);

const nomsListe = (l) => liste(l.slice(0, 2).map((b) => guillemets(b.nom || "une autre tâche", 40))) + (l.length > 2 ? ` (+${l.length - 2})` : "");

/**
 * L'état : fait (seulement si Sam a dit « C'est fini »), en attente, en cours,
 * en pause. Rémy ne voit que ce qui reste ouvert : il ne conclut jamais seul
 * qu'une branche est finie.
 */
export function deduireEtat(f, { maintenant = Date.now() } = {}) {
  const ouvertes = f.taches;
  const mq = f.marque || {};
  if (mq.fini) return deduction("fait", `tu as dit « C'est fini »${mq.finiA ? ` ${age(mq.finiA, maintenant)}` : ""}`);
  if (mq.bloquePar?.length) return deduction("en_attente", `tu as dit qu'il attend ${nomsListe(mq.bloquePar)}`);
  if (mq.parentBloque) return deduction("en_attente", `son projet parent ${guillemets(mq.parentBloque.nom || "parent", 40)} attend ${nomsListe(mq.parentBloque.par || [])}`);
  const dernier = Math.max(0, ...f.coches.map((c) => c.a), ...f.activite, ...f.conversations.map((c) => c.updatedAt || 0));
  const joursCalme = dernier ? Math.floor((maintenant - dernier) / JOUR) : null;
  // Prévue depuis hier (une tâche du jour déjà passée compte encore) ou due dans la semaine.
  const bientot = ouvertes.filter((t) => !t.bloquee && ((t.debut && t.debut >= maintenant - JOUR && t.debut < maintenant + 7 * JOUR) || (t.echeance && t.echeance < maintenant + 7 * JOUR)));
  if (f.statut && /attente/i.test(f.statut)) return deduction("en_attente", `d'après le statut Motion du projet (« ${propre(f.statut, 40)} »)`);
  if (ouvertes.length && ouvertes.every((t) => t.bloquee)) {
    const b = ouvertes.find((t) => t.bloqueePar?.length);
    return deduction("en_attente", `d'après ${sourceTaches(ouvertes)} : toutes attendent${b ? ` (${guillemets(b.titre, 40)} attend ${guillemets(b.bloqueePar[0].nom || "une autre tâche", 40)})` : ""}`);
  }
  const bouts = [];
  if (bientot.length) bouts.push(`${pluriel(bientot.length, "tâche Motion", "tâches Motion")} prévue${bientot.length > 1 ? "s" : ""} ou due${bientot.length > 1 ? "s" : ""} d'ici 7 jours`);
  if (joursCalme !== null && joursCalme <= RECENT_JOURS) {
    const derniereCoche = f.coches.reduce((m, c) => (c.a > (m?.a || 0) ? c : m), null);
    bouts.push(derniereCoche && derniereCoche.a === dernier ? `une tâche cochée ${age(dernier, maintenant)}` : `du mouvement dans Rémy ${age(dernier, maintenant)}`);
  }
  if (bouts.length) return deduction("en_cours", `d'après ${liste(bouts)}`);
  if (ouvertes.length && (joursCalme === null || joursCalme >= IMMOBILE_JOURS)) {
    return deduction("en_pause", `d'après ${sourceTaches(ouvertes)} sans rien de prévu cette semaine${joursCalme !== null ? `, et rien de fait depuis ${joursCalme} jours` : ""}`);
  }
  if (!ouvertes.length && joursCalme !== null && joursCalme >= IMMOBILE_JOURS) {
    return deduction("en_pause", `aucune tâche Motion ouverte, et rien dans Rémy depuis ${joursCalme} jours`);
  }
  return null;
}

/** « Où on en est » : la dernière chose faite, ce qui bloque, la prochaine étape. */
export function deduirePoint(f, { maintenant = Date.now() } = {}) {
  const parts = [];
  const sources = [];
  const mq = f.marque || {};
  if (mq.bloquePar?.length) {
    parts.push(`Attend ${nomsListe(mq.bloquePar)}.`);
    sources.push("ce que tu as dit de ce projet (« Bloqué par… »)");
  } else if (mq.parentBloque) {
    parts.push(`Attend avec ${guillemets(mq.parentBloque.nom || "son parent", 40)}, qui attend ${nomsListe(mq.parentBloque.par || [])}.`);
    sources.push("ce que tu as dit du projet parent");
  }
  const fait = f.coches.filter((c) => c.a > maintenant - 30 * JOUR).sort((p, q) => q.a - p.a)[0];
  if (fait?.nom) {
    parts.push(`Fait : ${guillemets(fait.nom, 60)} (${age(fait.a, maintenant)}).`);
    sources.push("une tâche cochée dans Rémy");
  }
  const bloquee = f.taches.find((t) => t.bloqueePar?.length) || f.taches.find((t) => t.bloquee);
  if (bloquee) {
    parts.push(bloquee.bloqueePar?.length
      ? `${guillemets(bloquee.titre, 50)} attend ${guillemets(bloquee.bloqueePar[0].nom || "une autre tâche", 50)}.`
      : `${guillemets(bloquee.titre, 50)} est en attente${bloquee.raison ? ` (${propre(bloquee.raison, 60)})` : ""}.`);
  }
  const quand = (t) => t.debut || t.echeance || Infinity;
  const prochaine = f.taches.filter((t) => !t.bloquee).sort((p, q) => quand(p) - quand(q))[0];
  if (prochaine) {
    const date = prochaine.echeance ? ` (avant ${jourCourt(prochaine.echeance)})` : prochaine.debut ? ` (prévue ${jourCourt(prochaine.debut)})` : "";
    parts.push(`Ensuite : ${guillemets(prochaine.titre, 60)}${date}.`);
  }
  if (bloquee || prochaine) sources.push(sourceTaches(f.taches));
  if (!parts.length && f.conversations[0]) {
    const c = f.conversations[0];
    parts.push(`Dernière conversation : ${guillemets(c.title || "Sans titre", 60)} (${age(c.updatedAt, maintenant)}).`);
    // Faible : un titre de conversation ne dit pas où on en est ; il ne remplace jamais ce que Sam a écrit.
    return deduction(parts[0], "d'après la conversation rattachée (son titre seulement)", { faible: true });
  }
  if (!parts.length) return null;
  return deduction(parts.slice(0, 2).join(" "), `d'après ${liste(sources.filter(Boolean))}`);
}

/**
 * Le pourquoi : les mots de Sam pour la priorité reliée au nœud ; sinon ce que
 * sa mémoire dit de ce nom (marqué `memoire` : ne se montre que déverrouillé).
 */
export function deduirePourquoi(f) {
  const p = f.priorite;
  if (p?.pourquoi) {
    const lien = p.lien === "projet" ? "reliée à ce projet" : "dont les mots ressemblent à ce nom";
    return deduction(p.pourquoi, `tes mots pour ${sourcePriorite(p)} ${guillemets(p.titre, 50)}, ${lien}`);
  }
  const m = f.memoire[0];
  if (m) return deduction(m.texte, `ce que Rémy a retenu de toi${m.section ? ` (section ${guillemets(m.section, 40)})` : ""}`, { memoire: true });
  return null;
}

/** Les trois déductions d'un nœud (chaque champ : { texte, source } ou null). */
export function deduire(f, { maintenant = Date.now() } = {}) {
  return { pourquoi: deduirePourquoi(f), etat: deduireEtat(f, { maintenant }), point: deduirePoint(f, { maintenant }) };
}

/**
 * Ce que l'écran montre d'un nœud : pour chaque champ, la valeur tenue
 * (confirmée ou écrite) et, s'il y en a une autre, la proposition de Rémy
 * (jamais celle que Sam a écartée, ni celle qui redit la valeur tenue).
 * `avecMemoire` : faux sur les routes sans déverrouillage — une proposition
 * tirée de la mémoire n'y est que COMPTÉE (`memoireCachee`).
 */
export function vueNoeud(x, fiche, deductions, faits, { avecMemoire = false } = {}) {
  const f = fiche || { ecartes: {} };
  const champs = {};
  const propositions = {};
  let memoireCachee = 0;
  const derniers = [...faits.activite, ...faits.coches.map((c) => c.a), ...faits.conversations.map((c) => c.updatedAt || 0), faits.marque?.finiA || 0].filter((v) => v > 0);
  const dernier = derniers.length ? Math.max(...derniers) : null;
  for (const c of CHAMPS) {
    champs[c] = f[c] || null;
    const d = deductions[c];
    if (!d || !d.texte) continue;
    if (f.ecartes?.[c] === d.texte || f[c]?.texte === d.texte) continue;
    // Ce que Sam tient l'emporte : Rémy ne propose autre chose que si du
    // nouveau est arrivé APRÈS (une coche, du mouvement, une conversation), et
    // jamais pour le pourquoi (ses mots ne se périment pas).
    if (f[c] && (c === "pourquoi" || d.faible || !dernier || dernier <= (f[c].a || 0))) continue;
    if (d.memoire && !avecMemoire) {
      memoireCachee++;
      continue;
    }
    propositions[c] = { texte: d.texte, source: d.source, origine: "deduit", ...(d.memoire ? { memoire: true } : {}) };
  }
  return {
    noeud: x.noeud, type: x.type, nom: x.nom, parent: x.parent, niveau: x.niveau, chemin: x.chemin,
    ...(x.statut ? { statut: x.statut } : {}),
    fiche: champs,
    propositions,
    ...(memoireCachee ? { memoireCachee } : {}),
    priorite: faits.priorite ? { titre: faits.priorite.titre, rang: faits.priorite.rang, lien: faits.priorite.lien } : null,
    taches: faits.taches.length,
    bloquees: faits.taches.filter((t) => t.bloquee).length,
    conversations: faits.conversations.slice(0, 5).map((c) => ({ id: c.id, titre: c.title || "Sans titre", majA: c.updatedAt || null })),
    dernierMouvement: dernier,
  };
}

/** L'arbre entier tel que l'écran le montre (voir vueNoeud), dans l'ordre. */
export function arbre(contexte, { fiches = new Map(), avecMemoire = false, maintenant = Date.now() } = {}) {
  const noeuds = contexte.noeuds || noeudsDe(contexte);
  const ctx = { ...contexte, noeuds };
  return noeuds.map((x) => {
    const f = faitsDe(x, ctx);
    const v = vueNoeud(x, fiches.get(x.noeud), deduire(f, { maintenant }), f, { avecMemoire });
    if (avecMemoire) v.memoire = f.memoire;
    return v;
  });
}

/** Le texte d'un état, pour une phrase (« en attente »). */
export const libelleEtat = (e) => LIBELLES_ETAT[e] || e;
