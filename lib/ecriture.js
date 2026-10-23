// La chaîne d'écriture (Lot 0, J0.7) : UN SEUL chemin pour tout ce qui modifie
// Motion ou l'agenda — proposition du chat, coche, replanification, annulation.
//
//   commande (id = clé d'idempotence)
//     → déjà faite ? on rend le MÊME résultat, sans nouvel effet
//     → journal ouvert AVANT l'effet (« en cours »)
//     → une seule écriture à la fois par système (Motion, agenda)
//     → résultat par action, journal et état de la proposition complétés
//
// Ce que ça corrige (audit du 13/10, prouvé par sonde) : la double
// application, l'annulation qui ne restaurait rien, l'annulation partielle
// marquée définitive, le journal d'agenda accepté par /motion/undo, le
// doublon par création simultanée, « Non merci » jamais enregistré.
//
// Le modèle ne passe JAMAIS par ici de lui-même : une proposition n'est
// écrite que sur un geste de Sam (route authentifiée, même origine).

import crypto from "node:crypto";
import { db, transaction, lireJSON } from "./db.js";
import * as store from "./store.js";
import { copierConversation } from "./coffre.js";
import { applyActions, annulerResultatMotion, espaceParDefaut, motionEnabled } from "./motion.js";
import { appliquerAgenda, annulerResultatAgenda } from "./google.js";
import { creerRegle } from "./regles.js";
import { PRENOM } from "./profil.js";

export class ErreurEcriture extends Error {
  constructor(statut, code, message) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

const NOMS = { motion: "Motion", agenda: "l'agenda", regle: "une règle de Rémy" };

// --- Une écriture à la fois par système externe ----------------------------------
const files = new Map();
function enFile(systeme, fn) {
  const precedente = files.get(systeme) || Promise.resolve();
  const tour = precedente.catch(() => {}).then(fn);
  files.set(systeme, tour.catch(() => {}));
  return tour;
}

// Commandes en train de s'exécuter dans CE processus (même id → même promesse).
const enCours = new Map();

// --- Lecture --------------------------------------------------------------------

function lireCommande(id) {
  const r = db().prepare("SELECT * FROM commandes WHERE id = ?").get(id);
  return r ? { ...r, resultat: lireJSON(r.resultat) } : null;
}

export function lireJournal(id) {
  const r = db().prepare("SELECT * FROM journal WHERE id = ?").get(String(id || ""));
  if (!r) return null;
  return { ...r, actions: lireJSON(r.actions, []), results: lireJSON(r.results, []), annulations: lireJSON(r.annulations, {}), annule: Boolean(r.annule) };
}

export function listerJournal(limite = 200) {
  return db()
    .prepare("SELECT id, ts, source, origine, resume, etat, annule, annule_a FROM journal ORDER BY ts DESC LIMIT ?")
    .all(limite)
    .map((r) => ({ ...r, annule: Boolean(r.annule), annuleAt: r.annule_a || undefined }));
}

function lireProposition(id) {
  const r = db().prepare("SELECT * FROM propositions WHERE id = ?").get(String(id || ""));
  return r ? { ...r, bilan: lireJSON(r.bilan), annulation_ratee: lireJSON(r.annulation_ratee), annulee: Boolean(r.annulee) } : null;
}

// L'identifiant d'une proposition : celui que le chat lui a donné, ou, pour
// les plus anciennes qui n'en ont pas, sa place dans la conversation (sans
// caractère réservé : il voyage dans l'URL du refus).
export const idProposition = (proposal, convId, index) => proposal?.id || `ancienne-${convId}-${index}`;

// --- État des propositions, superposé à la conversation ---------------------------

// La conversation garde une COPIE de l'état d'une proposition ; c'est la base
// qui fait foi (une réponse en cours réécrivait la conversation entière et
// effaçait un « appliqué » posé entre-temps). Formes gardées compatibles avec
// les builds déjà installés : statut en_attente | applique | refuse | echec,
// plus `annulee` et `annulationRatee`.
export function etatsPropositions(conv) {
  if (!conv?.messages?.length) return conv;
  try {
    conv.messages.forEach((m, i) => {
      if (!m?.proposal) return;
      const p = m.proposal;
      p.id = idProposition(p, conv.id, i); // les clients en ont besoin pour « Non merci »
      // Ajustée par Sam avant de dire oui (18/10) : c'est cette version qui
      // s'affiche et qui sera appliquée ; l'originale reste dans la conversation.
      const ajust = lireAjustement(p.id);
      if (ajust) {
        p.actionsOrigine = p.actions;
        p.actions = ajust.actions;
        p.ajustee = true;
      }
      const row = lireProposition(p.id);
      if (row) {
        p.statut = row.statut;
        if (row.journal_id) p.ledgerId = row.journal_id;
        if (row.bilan) p.bilan = row.bilan;
        p.annulee = row.annulee || undefined;
        p.annulationRatee = row.annulation_ratee?.length ? row.annulation_ratee : undefined;
      } else if (p.ledgerId) {
        // Appliquée avant le Lot 0 : le journal dit si elle a été annulée depuis.
        const j = db().prepare("SELECT annule FROM journal WHERE id = ?").get(p.ledgerId);
        if (j?.annule) p.annulee = true;
      }
    });
  } catch (err) {
    console.warn("État des propositions illisible (base SQLite) :", err.message);
  }
  return conv;
}

// Une écriture coupée par un arrêt de la tour : notée « échouée » (avec la
// raison), pour qu'elle puisse être rejouée ou constatée, jamais bloquée.
const INTERROMPUE = "interrompue par un redémarrage de la tour";
function marquerInterrompue(c) {
  if (!c?.id) return;
  transaction((d) => {
    d.prepare("UPDATE commandes SET etat = 'echouee', resultat = ?, maj_a = ? WHERE id = ? AND etat = 'en_cours'").run(JSON.stringify({ error: INTERROMPUE }), Date.now(), c.id);
    if (c.journal_id) {
      d.prepare("UPDATE journal SET etat = 'echouee', erreur = ?, maj_a = ? WHERE id = ? AND etat = 'en_cours'").run(INTERROMPUE, Date.now(), c.journal_id);
    }
  });
  console.warn(`Écriture ${c.id} ${INTERROMPUE} : notée échouée`);
}

// La copie Obsidian de la conversation montre l'état des propositions : elle
// est réécrite après chaque changement d'état (l'état vit dans SQLite, la
// conversation JSON n'est plus réécrite pour ça). Sans effet hors de la tour.
function rafraichirCopie(convId) {
  if (!convId) return;
  store
    .getConversation(convId)
    .then((c) => c && copierConversation(etatsPropositions(c)))
    .catch((err) => console.warn("Copie Obsidian non rafraîchie :", err.message));
}

// --- Appliquer ---------------------------------------------------------------------

function bilanDe(source, results) {
  if (source === "agenda") {
    return {
      faits: results.filter((r) => r.ok).map((r) => `${r.titre}${r.quand ? ` (${r.quand})` : ""}`),
      echoues: results.filter((r) => !r.ok).map((r) => ({ nom: r.titre, erreur: r.erreur })),
    };
  }
  return {
    faits: results.filter((r) => r.ok).map((r) => r.nom),
    echoues: results.filter((r) => !r.ok).map((r) => ({ nom: r.nom, erreur: r.erreur })),
    espace: results.find((r) => r.ok && r.espace)?.espace || null,
  };
}

const STATUT = { appliquee: "applique", appliquee_partiellement: "applique", echouee: "echec" };

function poserProposition(d, { id, convId, source, statut, journalId = null, bilan = null }) {
  d.prepare(`
    INSERT INTO propositions (id, conv_id, source, statut, journal_id, bilan, annulee, annulation_ratee, maj_a)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET statut = excluded.statut, journal_id = excluded.journal_id,
      bilan = excluded.bilan, annulee = 0, annulation_ratee = NULL, maj_a = excluded.maj_a`).run(
    id, convId || null, source, statut, journalId, bilan ? JSON.stringify(bilan) : null, Date.now(),
  );
}

// `valider(actions)` : contrôle propre à la source (arbitrage tâche/RDV…),
// rend un message d'erreur ou null. `executer(actions)` : l'écriture réelle.
export async function appliquer({ source, actions, resume = "", convId = null, index = null, propositionId = null, idCommande = null, origine = "chat", valider = null, executer = null }) {
  if (!["motion", "agenda"].includes(source)) throw new ErreurEcriture(400, "source", "Source inconnue");

  // 1. Une proposition du chat ? Ses actions sont lues dans la conversation
  //    STOCKÉE, jamais dans la requête.
  let prop = null;
  if (convId) {
    const conv = await store.getConversation(convId);
    const msgs = conv?.messages || [];
    let i = propositionId ? msgs.findIndex((m, k) => m?.proposal && idProposition(m.proposal, convId, k) === propositionId) : -1;
    if (i < 0 && Number.isInteger(index) && msgs[index]?.proposal) i = index;
    if (i >= 0) prop = { ...msgs[i].proposal, id: idProposition(msgs[i].proposal, convId, i) };
  }
  if (prop && (prop.source || "motion") !== source) {
    throw new ErreurEcriture(400, "source", `Cette proposition concerne ${NOMS[prop.source || "motion"] || "autre chose"}, pas ${NOMS[source]}.`);
  }
  // Ajustée par Sam avant validation : la version ajustée, enregistrée sur la
  // tour (jamais celle de la requête).
  const ajust = prop ? lireAjustement(prop.id) : null;
  const aEcrire = prop ? (ajust ? ajust.actions : prop.actions || []) : Array.isArray(actions) ? actions : [];
  if (prop && ajust && !aEcrire.length) throw new ErreurEcriture(409, "convertie", "Tout a été rangé en rappels : il n'y a plus rien à envoyer.");
  if (!aEcrire.length) throw new ErreurEcriture(400, "vide", "Aucune action à appliquer");
  const refus = valider?.(aEcrire);
  if (refus) throw new ErreurEcriture(400, "arbitrage", refus);

  const etatProp = prop ? lireProposition(prop.id) : null;
  if (etatProp?.statut === "refuse") {
    throw new ErreurEcriture(409, "refusee", "Tu as refusé cette proposition : rien n'a été modifié.");
  }
  // Appliquée avant le Lot 0 (l'état ne vit alors que dans la conversation) :
  // une carte restée ouverte ailleurs ne la refait pas.
  if (prop && !etatProp && prop.statut === "applique") {
    return { ok: true, results: [], ledgerId: prop.ledgerId || null, echecs: 0, etat: "appliquee", rejoue: true };
  }

  // 2. La clé d'idempotence. Une proposition n'a qu'UNE clé, quel que soit
  //    l'appareil qui tape : deux taps (web + iPhone, ou nouvel essai après une
  //    coupure) ne font qu'une écriture.
  const id = prop ? `prop:${prop.id}` : String(idCommande || "").slice(0, 100) || `cmd:${crypto.randomUUID()}`;

  // --- Rien d'asynchrone entre ces lignes : c'est ce qui rend la clé sûre. ---
  if (enCours.has(id)) return { ...(await enCours.get(id)), rejoue: true };
  const deja = lireCommande(id);
  // « en cours » en base mais dans aucune exécution de ce processus : la tour
  // a redémarré pendant l'écriture. Notée interrompue, puis rejouée : les
  // modifications et les coches sont sans effet en double, et une création
  // déjà faite est retrouvée par son nom (anti-doublon) au lieu d'être refaite.
  const reprise = deja?.etat === "en_cours" || deja?.resultat?.error === INTERROMPUE;
  if (deja?.etat === "en_cours") marquerInterrompue(deja);
  else if (deja && deja.etat !== "echouee" && deja.resultat) {
    // Déjà faite… puis annulée : la rejouer n'est pas la refaire en silence.
    const j = deja.journal_id ? lireJournal(deja.journal_id) : null;
    if (j?.annule || j?.etat === "annulation_partielle") {
      throw new ErreurEcriture(409, "annulee", "Cette proposition a été annulée : pour la refaire, redemande-la à Rémy.");
    }
    return { ...deja.resultat, rejoue: true };
  }

  const promesse = (async () => {
    const journalId = crypto.randomUUID();
    const maintenant = Date.now();
    transaction((d) => {
      d.prepare(`
        INSERT INTO commandes (id, source, origine, proposition_id, etat, journal_id, resultat, cree_a, maj_a)
        VALUES (?, ?, ?, ?, 'en_cours', ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET etat = 'en_cours', journal_id = excluded.journal_id, resultat = NULL, maj_a = excluded.maj_a`).run(
        id, source, origine, prop?.id || null, journalId, maintenant, maintenant,
      );
      d.prepare(`
        INSERT INTO journal (id, ts, source, origine, resume, commande_id, proposition_id, conv_id, etat, actions, results, annulations, maj_a)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_cours', ?, '[]', '{}', ?)`).run(
        journalId, maintenant, source, origine, String(prop?.resume ?? resume ?? "").slice(0, 200), id, prop?.id || null, convId || null,
        JSON.stringify(aEcrire), maintenant,
      );
    });

    let results;
    try {
      results = await enFile(source, () => executer(aEcrire));
      // Reprise après un redémarrage : ce que l'anti-doublon retrouve a
      // vraisemblablement été créé par l'écriture coupée. C'est fait — mais
      // pas annulable : Rémy ne peut pas prouver que c'est lui qui l'a créé.
      if (reprise) {
        results = results.map((r) =>
          r?.doublon ? { ok: true, type: r.type, nom: r.nom, titre: r.titre, dejaLa: true, note: "déjà là (écrit avant le redémarrage)" } : r,
        );
      }
    } catch (err) {
      transaction((d) => {
        d.prepare("UPDATE journal SET etat = 'echouee', erreur = ?, maj_a = ? WHERE id = ?").run(err.message, Date.now(), journalId);
        d.prepare("UPDATE commandes SET etat = 'echouee', resultat = ?, maj_a = ? WHERE id = ?").run(JSON.stringify({ error: err.message }), Date.now(), id);
        if (prop) poserProposition(d, { id: prop.id, convId, source, statut: "echec", journalId, bilan: { faits: [], echoues: [{ nom: "—", erreur: err.message }] } });
      });
      throw new ErreurEcriture(502, source, err.message);
    }

    const ok = results.filter((r) => r.ok).length;
    const etat = ok === results.length ? "appliquee" : ok ? "appliquee_partiellement" : "echouee";
    const bilan = bilanDe(source, results);
    const resultat = { ok: ok === results.length, results, ledgerId: journalId, echecs: results.length - ok, etat };
    try {
      transaction((d) => {
        d.prepare("UPDATE journal SET etat = ?, results = ?, maj_a = ? WHERE id = ?").run(etat, JSON.stringify(results), Date.now(), journalId);
        d.prepare("UPDATE commandes SET etat = ?, resultat = ?, maj_a = ? WHERE id = ?").run(etat, JSON.stringify(resultat), Date.now(), id);
        if (prop) poserProposition(d, { id: prop.id, convId, source, statut: STATUT[etat], journalId, bilan });
      });
    } catch (err) {
      // L'écriture a eu lieu, sa trace non : surtout ne pas dire « pas fait ».
      console.error(`Écriture ${id} faite mais non enregistrée :`, err.message);
      throw new ErreurEcriture(
        500,
        "incertaine",
        ok
          ? `C'est fait dans ${NOMS[source]}, mais Rémy n'a pas pu l'enregistrer (base de la tour) : vérifie dans ${NOMS[source]} avant de réessayer.`
          : `Rien n'a été fait dans ${NOMS[source]}, et Rémy n'a pas pu l'enregistrer (base de la tour).`,
      );
    }
    rafraichirCopie(convId);
    return resultat;
  })();

  enCours.set(id, promesse);
  try {
    return await promesse;
  } finally {
    enCours.delete(id);
  }
}

// --- Annuler -------------------------------------------------------------------------

// Défait ce qui reste à défaire d'une entrée du journal. Une annulation
// partielle se REPREND (au lieu d'un 409 définitif) ; une tâche modifiée dans
// Motion depuis n'est jamais écrasée (conflit dit, rien n'est touché).
export async function annuler({ source, journalId }) {
  const e = lireJournal(journalId);
  if (!e) throw new ErreurEcriture(404, "introuvable", "Entrée de journal introuvable");
  if (e.source !== source) {
    throw new ErreurEcriture(400, "source", `Ce changement a été fait dans ${NOMS[e.source] || e.source} : il s'annule de ce côté-là.`);
  }
  if (e.etat === "en_cours") {
    if (enCours.has(e.commande_id)) throw new ErreurEcriture(409, "en_cours", "Cette écriture n'est pas terminée : réessaie dans un instant.");
    // Interrompue par un redémarrage : Rémy ne sait pas ce qui a été écrit.
    marquerInterrompue(lireCommande(e.commande_id) || { id: e.commande_id, journal_id: e.id });
    throw new ErreurEcriture(409, "interrompue", `Cette écriture a été interrompue par un redémarrage de la tour : Rémy ne sait pas ce qui a été fait. Vérifie dans ${NOMS[source]}.`);
  }
  if (e.etat === "echouee") throw new ErreurEcriture(409, "rien", "Rien n'a été fait : il n'y a rien à annuler.");
  if (e.annule) throw new ErreurEcriture(409, "deja", "Déjà annulé");

  const cle = `annuler:${e.id}`;
  if (enCours.has(cle)) return enCours.get(cle);

  const promesse = (async () => {
    const annulations = { ...e.annulations };
    const restants = e.results
      .map((r, i) => i)
      .filter((i) => e.results[i]?.ok && e.results[i]?.annulable && annulations[i]?.ok !== true)
      .reverse();

    const faits = await enFile(source, async () => {
      const out = [];
      const espace = source === "motion" && motionEnabled() ? await espaceParDefaut().catch(() => null) : null;
      for (const i of restants) {
        const u = source === "agenda" ? await annulerResultatAgenda(e.results[i]) : await annulerResultatMotion(e.results[i], espace);
        out.push({ index: i, ...u });
      }
      return out;
    });

    const results = e.results.map((r) => ({ ...r }));
    for (const u of faits) {
      annulations[u.index] = { ok: u.ok, erreur: u.erreur || null, quoi: u.quoi || u.refait || null, conflit: u.conflit || undefined };
      // Un événement supprimé puis recréé a un NOUVEL identifiant : le journal suit.
      if (u.ok && u.eventId) results[u.index].eventIdRecree = u.eventId;
    }
    const aDefaire = results.map((r, i) => i).filter((i) => results[i]?.ok && results[i]?.annulable);
    const complet = aDefaire.every((i) => annulations[i]?.ok === true);
    const ratees = aDefaire
      .filter((i) => annulations[i] && annulations[i].ok !== true)
      .map((i) => ({ nom: results[i].nom || results[i].titre, erreur: annulations[i].erreur }));

    transaction((d) => {
      d.prepare("UPDATE journal SET annulations = ?, results = ?, annule = ?, annule_a = ?, etat = ?, maj_a = ? WHERE id = ?").run(
        JSON.stringify(annulations), JSON.stringify(results), complet ? 1 : 0, complet ? Date.now() : null,
        complet ? "annulee" : "annulation_partielle", Date.now(), e.id,
      );
      if (e.proposition_id) {
        d.prepare("UPDATE propositions SET annulee = ?, annulation_ratee = ?, maj_a = ? WHERE id = ?").run(
          complet ? 1 : 0, ratees.length ? JSON.stringify(ratees) : null, Date.now(), e.proposition_id,
        );
      }
    });

    rafraichirCopie(e.conv_id);
    return {
      ok: complet,
      complet,
      restants: ratees.length,
      undone: faits.map((u) => ({ ok: u.ok, nom: u.nom, titre: u.titre, erreur: u.erreur, quoi: u.quoi || u.refait, conflit: u.conflit })),
    };
  })();

  enCours.set(cle, promesse);
  try {
    return await promesse;
  } finally {
    enCours.delete(cle);
  }
}

// --- Refuser -----------------------------------------------------------------------------

// « Non merci » est ENREGISTRÉ : la proposition ne revient pas au rechargement,
// et Rémy sait que Sam l'a refusée.
// --- Ajuster une proposition avant de dire oui (Sam, 18/10) ---------------------
// Seuls quelques champs bougent (nom, échéance, durée, priorité, catégorie,
// heure d'un rendez-vous) ; une action « créer » peut être rangée en rappel par
// l'iPhone (elle sort alors de la proposition). Le type et la cible d'une
// action ne changent jamais : rien ne peut s'y glisser.

export function lireAjustement(propositionId) {
  const r = db().prepare("SELECT actions, convertis FROM ajustements WHERE proposition_id = ?").get(propositionId);
  if (!r) return null;
  try {
    const actions = JSON.parse(r.actions);
    return Array.isArray(actions) ? { actions, convertis: r.convertis } : null;
  } catch {
    return null;
  }
}

const AJUSTABLES = {
  creer: ["nom", "titre", "echeance", "debut", "fin", "duree", "priorite", "etiquettes"],
  modifier: ["nouveau_nom", "nouveau_titre", "echeance", "debut", "fin", "duree", "priorite", "etiquettes"],
};
const PRIORITES = ["ASAP", "HIGH", "MEDIUM", "LOW"];

function champAjuste(cle, v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (["nom", "titre", "nouveau_nom", "nouveau_titre"].includes(cle)) return String(v).replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
  if (["echeance", "debut", "fin"].includes(cle)) return Number.isFinite(Date.parse(v)) ? String(v).slice(0, 40) : undefined;
  if (cle === "duree") {
    const n = Number(v);
    return Number.isFinite(n) && n >= 5 && n <= 24 * 60 ? Math.round(n) : undefined;
  }
  if (cle === "priorite") return PRIORITES.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : undefined;
  if (cle === "etiquettes") return Array.isArray(v) ? v.filter((e) => typeof e === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(e)).slice(0, 8) : undefined;
  return undefined;
}

export async function ajuster({ convId, propositionId, actions = [], convertis = [] }) {
  const conv = await store.getConversation(convId);
  const msgs = conv?.messages || [];
  const i = msgs.findIndex((m, k) => m?.proposal && idProposition(m.proposal, convId, k) === propositionId);
  if (i < 0) throw new ErreurEcriture(404, "introuvable", "Proposition introuvable dans cette conversation");
  const p = msgs[i].proposal;
  const etat = lireProposition(propositionId);
  if (etat?.statut === "applique" || (!etat && p.statut === "applique")) throw new ErreurEcriture(409, "appliquee", "Déjà appliquée : utilise « Annuler » pour revenir en arrière.");
  if (etat?.statut === "refuse") throw new ErreurEcriture(409, "refusee", "Tu as refusé cette proposition.");
  if (etat?.statut === "converti") throw new ErreurEcriture(409, "convertie", "Déjà rangée en rappels.");
  if (enCours.has(`prop:${propositionId}`)) throw new ErreurEcriture(409, "en_cours", "Application en cours : attends la fin.");
  // Chaque action garde son rang dans l'originale (« rang ») : les ajustements
  // s'ajoutent les uns aux autres, et une action rangée en rappel ne revient pas.
  const origine = (p.actions || []).map((o, k) => ({ ...o, rang: k }));
  const base = lireAjustement(propositionId)?.actions || origine;
  const parRang = new Map(origine.map((o) => [o.rang, o]));
  const ranges = new Set((Array.isArray(convertis) ? convertis : [])
    .filter((k) => Number.isInteger(k) && parRang.get(k)?.type === "creer"));
  const voulues = new Map((Array.isArray(actions) ? actions : []).filter((a) => Number.isInteger(a?.rang)).map((a) => [a.rang, a]));
  const resultat = [];
  base.forEach((b) => {
    const o = parRang.get(b.rang);
    if (!o || ranges.has(b.rang)) return;
    const a = voulues.get(b.rang);
    // Le type et la cible viennent TOUJOURS de l'originale.
    const n = { ...b, type: o.type, id: o.id, nom: b.nom ?? o.nom };
    if (o.id === undefined) delete n.id;
    if (a) {
      for (const c of AJUSTABLES[o.type] || []) {
        if (!(c in a)) continue;
        const v = champAjuste(c, a[c]);
        if (v === undefined) {
          // Le nom d'une création ne s'efface pas ; le reste peut être vidé.
          if (!["nom", "titre"].includes(c)) delete n[c];
        } else n[c] = v;
      }
    }
    resultat.push(n);
  });
  const t = Date.now();
  transaction((d) => {
    d.prepare(`INSERT INTO ajustements (proposition_id, actions, convertis, maj_a) VALUES (?, ?, ?, ?)
      ON CONFLICT(proposition_id) DO UPDATE SET actions = excluded.actions, convertis = excluded.convertis, maj_a = excluded.maj_a`)
      .run(propositionId, JSON.stringify(resultat), ranges.size, t);
    if (!resultat.length) poserProposition(d, { id: propositionId, convId, source: p.source || "motion", statut: "converti" });
  });
  rafraichirCopie(convId);
  return { ok: true, actions: resultat, statut: resultat.length ? "en_attente" : "converti" };
}

// Une règle de Rémy proposée dans le chat (19/10), validée par Sam : lue dans
// la conversation STOCKÉE (jamais dans la requête), créée une seule fois.
export async function validerRegle({ convId, propositionId }) {
  const conv = await store.getConversation(convId);
  const msgs = conv?.messages || [];
  const i = msgs.findIndex((m, k) => m?.proposal && idProposition(m.proposal, convId, k) === propositionId);
  if (i < 0) throw new ErreurEcriture(404, "introuvable", "Proposition introuvable dans cette conversation");
  const p = msgs[i].proposal;
  if (p.source !== "regle") throw new ErreurEcriture(400, "source", "Cette proposition n'est pas une règle.");
  const etat = lireProposition(propositionId);
  if (etat?.statut === "refuse") throw new ErreurEcriture(409, "refusee", "Tu as refusé cette règle : rien n'a été créé.");
  if (etat?.statut === "applique") return { ok: true, statut: "applique", regles: etat.bilan?.regles || [], rejoue: true };
  const creees = [];
  for (const a of (p.actions || []).filter((x) => x?.type === "regle")) {
    try {
      creees.push(creerRegle(a, { convId }));
    } catch (err) {
      throw new ErreurEcriture(400, "regle", err.message);
    }
  }
  if (!creees.length) throw new ErreurEcriture(400, "vide", "Aucune règle à créer.");
  const bilan = { faits: creees.map((r) => r.nom), regles: creees.map((r) => r.id) };
  transaction((d) => poserProposition(d, { id: propositionId, convId, source: "regle", statut: "applique", bilan }));
  rafraichirCopie(convId);
  console.warn(`Règles de Rémy : « ${creees.map((r) => r.nom).join(" », « ")} » créée(s) par ${PRENOM}`);
  return { ok: true, statut: "applique", regles: creees, bilan };
}

export async function refuser({ convId, propositionId }) {
  const conv = await store.getConversation(convId);
  const msgs = conv?.messages || [];
  const i = msgs.findIndex((m, k) => m?.proposal && idProposition(m.proposal, convId, k) === propositionId);
  if (i < 0) throw new ErreurEcriture(404, "introuvable", "Proposition introuvable dans cette conversation");
  const p = msgs[i].proposal;
  const etat = lireProposition(propositionId);
  if (etat?.statut === "applique" || (!etat && p.statut === "applique")) {
    throw new ErreurEcriture(409, "appliquee", "Déjà appliquée : utilise « Annuler » pour revenir en arrière.");
  }
  if (enCours.has(`prop:${propositionId}`)) throw new ErreurEcriture(409, "en_cours", "Application en cours : attends la fin.");
  transaction((d) => poserProposition(d, { id: propositionId, convId, source: p.source || "motion", statut: "refuse" }));
  rafraichirCopie(convId);
  return { ok: true, statut: "refuse" };
}
