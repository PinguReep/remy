// Les priorités déclarées de Sam (nuit du 24/10) : 3 à 5 choses qui comptent,
// chacune avec son « pourquoi ». Sans elles, le conseil du moment et la nuit
// paraphrasent Motion ; avec elles, Rémy peut dire « tu m'avais dit que la
// musique comptait, et rien n'a bougé depuis 12 jours ».
//
//   - Stockées sur la tour (remy.db, instantané « priorites »), VERSIONNÉES :
//     chaque enregistrement ajoute une version, aucune n'est jamais écrasée.
//     Un enregistrement fait depuis une version périmée (un autre appareil a
//     changé la liste entre-temps) est refusé (409), pas fusionné en silence.
//   - « Négligé depuis N jours » est CALCULÉ, sans IA : la dernière trace
//     d'activité qui reprend les mots de la priorité (écriture validée dans
//     Motion ou l'agenda, rappel fait, note d'un dossier, titre d'une
//     conversation). Sans trace, on compte depuis le jour où Sam l'a déclarée.

import crypto from "node:crypto";
import { db } from "./db.js";
import * as instantanes from "./instantanes.js";
import { listConversations } from "./store.js";
import { normaliser } from "./regles.js";
import { PRENOM } from "./profil.js";

const CLE = "priorites";
export const MAX_PRIORITES = 5;
const MAX_VERSIONS = 200;
export const SEUIL_NEGLIGE_JOURS = 7;
const FENETRE_JOURS = 90; // au-delà, une trace ne compte plus
const JOUR = 86_400_000;

export class ErreurPriorites extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

// Des mots qui ne disent rien d'un domaine (« Finir le projet » → « projet » non plus).
const VIDES = new Set(
  "avec dans pour sans plus moins tout tous toute toutes faire finir avancer prendre temps chaque autre autres entre vers chez cette celui celle leur leurs notre votre mieux bien vraiment projet projets semaine mois jour".split(" "),
);

const propre = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Ce que l'app envoie → une liste propre (1 à 5), ou une erreur lisible. */
export function nettoyerPriorites(entree) {
  if (!Array.isArray(entree)) return { erreur: "Attendu : { priorites: [{ titre, pourquoi }] }" };
  const vues = new Set();
  const priorites = [];
  for (const p of entree) {
    const titre = propre(p?.titre, 80);
    if (!titre) continue;
    const cle = normaliser(titre);
    if (vues.has(cle)) continue;
    vues.add(cle);
    const id = typeof p?.id === "string" && /^[A-Za-z0-9_.\-]{1,60}$/.test(p.id) ? p.id : `p-${crypto.randomUUID().slice(0, 8)}`;
    const mots = [...new Set((Array.isArray(p?.mots) ? p.mots : []).map((m) => propre(m, 40)).filter((m) => normaliser(m).length >= 3))].slice(0, 8);
    priorites.push({ id, titre, pourquoi: propre(p?.pourquoi, 240), mots });
  }
  if (priorites.length > MAX_PRIORITES) return { erreur: `${MAX_PRIORITES} priorités au plus : au-delà, plus rien n'est prioritaire.` };
  return { priorites };
}

function lireVersions() {
  const v = instantanes.lire(CLE)?.valeur;
  return Array.isArray(v?.versions) ? v.versions : [];
}

/** La liste en vigueur (la dernière version), avec la date de déclaration de chacune. */
export function lirePriorites() {
  const versions = lireVersions();
  const courante = versions.at(-1) || null;
  // Déclarée quand : la première version où elle apparaît (même identifiant).
  const declareeA = (id) => versions.find((v) => v.priorites.some((p) => p.id === id))?.a ?? courante?.a ?? null;
  return {
    version: courante?.version || 0,
    majA: courante?.a || null,
    priorites: (courante?.priorites || []).map((p) => ({ ...p, declareeA: declareeA(p.id) })),
    versions: versions.length,
  };
}

/** Les versions passées, de la plus récente à la plus ancienne (titres seulement). */
export function historiquePriorites(limite = 20) {
  return lireVersions()
    .slice(-limite)
    .reverse()
    .map((v) => ({ version: v.version, a: v.a, titres: v.priorites.map((p) => p.titre), appareil: v.appareil || null }));
}

/**
 * Ajoute une version. `base` : la version que l'appareil avait sous les yeux —
 * si une autre a été posée depuis, refus (409) : rien n'est écrasé.
 */
export function enregistrerPriorites(entree, { base, appareil = null, maintenant = Date.now() } = {}) {
  const { priorites, erreur } = nettoyerPriorites(entree);
  if (erreur) throw new ErreurPriorites(400, erreur);
  const versions = lireVersions();
  const actuelle = versions.at(-1)?.version || 0;
  if (!Number.isInteger(base) || base !== actuelle) {
    throw new ErreurPriorites(409, "Tes priorités ont changé ailleurs entre-temps : recharge-les avant d'enregistrer.");
  }
  const memes = JSON.stringify(versions.at(-1)?.priorites || []) === JSON.stringify(priorites);
  if (memes) return { ...lirePriorites(), inchange: true };
  const suivante = { version: actuelle + 1, a: maintenant, appareil: appareil ? propre(appareil, 60) : null, priorites };
  // Les plus anciennes versions sortent au-delà de 200 (des mois d'usage) ;
  // la première reste, elle date chaque priorité.
  const garde = versions.length >= MAX_VERSIONS ? [versions[0], ...versions.slice(-(MAX_VERSIONS - 2))] : versions;
  if (!instantanes.ecrire(CLE, { versions: [...garde, suivante] }, maintenant)) {
    throw new ErreurPriorites(503, "La base de la tour n'a pas pu enregistrer tes priorités : réessaie, ou regarde Réglages › Diagnostic.");
  }
  cache = null;
  return lirePriorites();
}

// --- Négligé depuis N jours (sans IA) -------------------------------------------

// Un mot entier, au pluriel près (« boutiques » reconnaît « boutique »).
const racine = (m) => (m.length > 3 ? m.replace(/[sx]$/, "") : m);
const forme = (t) => ` ${normaliser(t).split(" ").filter(Boolean).map(racine).join(" ")} `;
export function reconnait(mots, texte) {
  const t = forme(texte);
  return mots.some((m) => {
    const n = forme(m).trim();
    return n.length >= 2 && t.includes(` ${n} `);
  });
}

/** Les mots qui reconnaissent une priorité : ceux de Sam, sinon ceux du titre. */
export function motsDe(p) {
  if (p?.mots?.length) return p.mots;
  return [...new Set(normaliser(p?.titre).split(" ").filter((m) => m.length >= 4 && !VIDES.has(m)))];
}

const lireJSON = (v) => {
  try {
    return JSON.parse(v || "null");
  } catch {
    return null;
  }
};

/** Les traces d'activité datées (de quoi elles parlent, quand), plus récentes d'abord. */
export async function traces({ maintenant = Date.now() } = {}) {
  const depuis = maintenant - FENETRE_JOURS * JOUR;
  const t = [];
  try {
    const d = db();
    for (const r of d.prepare("SELECT ts, source, resume, actions FROM journal WHERE ts >= ? AND annule = 0 AND etat IN ('appliquee', 'appliquee_partiellement') ORDER BY ts DESC LIMIT 400").all(depuis)) {
      const noms = (lireJSON(r.actions) || []).map((a) => a?.nom || a?.titre || a?.nouveau_nom).filter(Boolean);
      for (const n of noms.length ? noms : [r.resume]) t.push({ a: r.ts, texte: String(n || ""), quoi: r.source === "agenda" ? "rendez-vous" : "tâche" });
    }
    for (const r of d.prepare("SELECT texte, maj_a FROM rappels WHERE fait = 1 AND supprime = 0 AND maj_a >= ? ORDER BY maj_a DESC LIMIT 300").all(depuis)) {
      t.push({ a: r.maj_a, texte: r.texte, quoi: "rappel fait" });
    }
    for (const r of d.prepare("SELECT n.texte, n.maj_a, d.nom FROM notes_dossier n JOIN dossiers d ON d.id = n.dossier WHERE n.supprime = 0 AND n.maj_a >= ? ORDER BY n.maj_a DESC LIMIT 300").all(depuis)) {
      t.push({ a: r.maj_a, texte: `${r.nom} ${r.texte}`, quoi: `note du dossier « ${r.nom} »` });
    }
  } catch (err) {
    console.warn("Traces d'activité illisibles (base de la tour) :", err.message);
  }
  try {
    for (const c of await listConversations()) {
      if (c.systeme || !c.title || !(c.updatedAt >= depuis)) continue;
      t.push({ a: c.updatedAt, texte: c.title, quoi: "conversation" });
    }
  } catch (err) {
    console.warn("Conversations illisibles pour les priorités :", err.message);
  }
  return t.sort((x, y) => y.a - x.a);
}

const jourCourt = (ms) => new Intl.DateTimeFormat("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris", day: "numeric", month: "short" }).format(new Date(ms));

/** Pour chaque priorité : sa dernière trace et depuis combien de jours rien n'a bougé. */
export function negligence(priorites, lesTraces, { maintenant = Date.now() } = {}) {
  return (priorites || []).map((p) => {
    const mots = motsDe(p);
    const vue = mots.length ? lesTraces.find((x) => reconnait(mots, x.texte)) : null;
    const depuis = Math.max(vue?.a || 0, p.declareeA || 0) || null;
    const joursSans = depuis ? Math.max(0, Math.floor((maintenant - depuis) / JOUR)) : null;
    return {
      id: p.id,
      titre: p.titre,
      derniereActivite: vue ? { a: vue.a, quoi: vue.quoi, texte: propre(vue.texte, 120) } : null,
      joursSans,
      neglige: joursSans !== null && joursSans >= SEUIL_NEGLIGE_JOURS,
      // Ce que Rémy a le droit d'en dire : un fait daté, jamais une supposition.
      constat:
        joursSans === null || joursSans < SEUIL_NEGLIGE_JOURS
          ? null
          : vue
            ? `rien depuis ${joursSans} jours (dernière trace : ${vue.quoi} « ${propre(vue.texte, 60)} », le ${jourCourt(vue.a)})`
            : `aucune trace depuis qu'elle est déclarée, il y a ${joursSans} jours`,
    };
  });
}

// Les dossiers de Rémy (projets et domaines rangés dans le carnet) avec des
// idées encore ouvertes mais aucun mouvement depuis 14 jours : la nuit peut
// le relever. Sans IA, et seulement ce qui a encore quelque chose d'ouvert.
const SEUIL_DOSSIER_JOURS = 14;
export function dossiersSansMouvement({ maintenant = Date.now() } = {}) {
  try {
    return db()
      .prepare(`SELECT d.nom, MAX(d.maj_a, COALESCE(MAX(n.maj_a), 0)) AS dernier,
          SUM(CASE WHEN n.fait = 0 AND n.supprime = 0 THEN 1 ELSE 0 END) AS ouvertes
        FROM dossiers d LEFT JOIN notes_dossier n ON n.dossier = d.id
        WHERE d.supprime = 0 GROUP BY d.id`)
      .all()
      .filter((r) => r.ouvertes > 0 && maintenant - r.dernier >= SEUIL_DOSSIER_JOURS * JOUR)
      .map((r) => ({ nom: r.nom, joursSans: Math.floor((maintenant - r.dernier) / JOUR), ouvertes: r.ouvertes }))
      .sort((a, b) => b.joursSans - a.joursSans)
      .slice(0, 5);
  } catch (err) {
    console.warn("Dossiers illisibles (base de la tour) :", err.message);
    return [];
  }
}

/** Le bloc des dossiers immobiles pour la nuit (texte), vide s'il n'y en a pas. */
export function texteDossiers(liste) {
  if (!liste?.length) return "";
  return `Dossiers de ${PRENOM} sans mouvement (constat calculé, idées encore ouvertes) :\n${liste
    .map((d) => `- « ${d.nom} » : rien depuis ${d.joursSans} jours, ${d.ouvertes} idée${d.ouvertes > 1 ? "s" : ""} ouverte${d.ouvertes > 1 ? "s" : ""}`)
    .join("\n")}`;
}

// Le conseil se recalcule souvent : les traces se relisent au plus toutes les 10 min.
let cache = null;
const CACHE_MS = 10 * 60_000;

/** Ce que le conseil et la nuit reçoivent ; null s'il n'y a pas de priorités. */
export async function contextePriorites({ maintenant = Date.now() } = {}) {
  const lu = lirePriorites();
  if (!lu.priorites.length) return null;
  if (cache && cache.version === lu.version && maintenant - cache.a < CACHE_MS) return cache.valeur;
  const n = negligence(lu.priorites, await traces({ maintenant }), { maintenant });
  const valeur = {
    version: lu.version,
    majA: lu.majA,
    priorites: lu.priorites.map((p, k) => ({
      titre: p.titre,
      pourquoi: p.pourquoi || undefined,
      negligeeDepuisJours: n[k].neglige ? n[k].joursSans : undefined,
      constat: n[k].constat || undefined,
    })),
    detail: n,
  };
  cache = { version: lu.version, a: maintenant, valeur };
  return valeur;
}

/** Le bloc de la réflexion de nuit (texte), vide sans priorités. */
export function textePriorites(ctx) {
  if (!ctx?.priorites?.length) return "";
  const lignes = ctx.priorites.map(
    (p) => `- ${p.titre}${p.pourquoi ? ` — pourquoi : « ${p.pourquoi} »` : ""}${p.constat ? ` — NÉGLIGÉE : ${p.constat}` : ""}`,
  );
  return `Priorités déclarées par ${PRENOM} (ses mots, version ${ctx.version} du ${jourCourt(ctx.majA)}) — « négligée » est un constat calculé sur ses traces d'activité, pas une supposition :\n${lignes.join("\n")}`;
}

export function _viderCache() {
  cache = null;
}
