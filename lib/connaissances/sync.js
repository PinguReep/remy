// Les conversations externes (29/10) : ce que tu as dit ailleurs — sessions
// Claude Code, fils de T3 Code, export ChatGPT — lu sur la tour, sans IA,
// rangé chiffré, consultable depuis l'app et le site, et relu par Rémy (modèle
// local seulement : voir usage.js).
//
// Garde-fous :
//   - lecture SEULE des sources : rien n'est jamais écrit chez Claude Code, T3
//     ou ChatGPT, et aucun de ces modules ne fait de requête réseau ;
//   - secrets masqués avant tout stockage (masquage.js), contenu chiffré
//     (chiffre.js) ;
//   - chaque source se coupe (app, ou REMY_SOURCE_<SOURCE>=off sur la tour,
//     qui l'emporte) et s'efface d'un geste ;
//   - REMY_CONNAISSANCES_PROJETS (sur la tour) limite Claude Code et T3 aux
//     projets dont le dossier contient l'un de ces mots (« essai,autre »).
//
// Allumées par défaut depuis le 29/10 (Claude Code, T3) : la demande du
// propriétaire est d'y avoir accès tout de suite. Le lot B les tenait coupées
// tant qu'aucun accord n'était donné — et aucun écran ne permettait de le
// donner : c'est pour ça qu'il n'y avait jamais accès.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { base, baseExiste, transaction, lireMeta, ecrireMeta, compacter, cheminConnaissances } from "./base.js";
import { chiffrer, dechiffrerOuNull, jetonsIndex, jetonsRecherche, idProjet, cleChemin, cles, fichierCle, motsDe, dossierCles } from "./chiffre.js";
import * as claude from "./claudeCode.js";
import * as t3 from "./t3.js";
import { conversationDe, conversationsDuFichier } from "./chatgpt.js";
import { entrees as entreesZip } from "./zip.js";
import { coffre } from "../coffre.js";
import { dossierBase } from "../store.js";
import { horodate, TZ } from "../activite.js";
import { debutJour, finJour } from "../dashboard.js";

export const SOURCE_CLAUDE = "claude-code";
export const SOURCE_T3 = "t3";
export const SOURCE_CHATGPT = "chatgpt";

export const SOURCES = {
  [SOURCE_CLAUDE]: { nom: "Claude Code", env: "REMY_SOURCE_CLAUDE_CODE", assistant: "Claude" },
  [SOURCE_T3]: { nom: "T3 Code", env: "REMY_SOURCE_T3", assistant: "Claude" },
  [SOURCE_CHATGPT]: { nom: "ChatGPT", env: "REMY_SOURCE_CHATGPT", assistant: "ChatGPT" },
};
export const estSource = (id) => Object.prototype.hasOwnProperty.call(SOURCES, id);

const envSource = (id) => process.env[SOURCES[id]?.env];

export class CleDifferente extends Error {
  constructor() {
    super("La base des conversations a été chiffrée avec une autre clé : efface-la (« Tout effacer ») puis relis tes sources. Les sessions d'origine ne sont pas touchées.");
    this.code = "CLE_DIFFERENTE";
  }
}

// --- Réglages ------------------------------------------------------------------

export function sourceActive(id = SOURCE_CLAUDE) {
  if (!estSource(id)) return false;
  if (envSource(id) === "off") return false;
  if (envSource(id) === "on") return true;
  if (!baseExiste()) return true; // par défaut : allumée
  const r = base().prepare("SELECT actif FROM sources WHERE id = ?").get(id);
  return r?.actif == null ? true : Boolean(r.actif);
}

export function reglerSource(id, actif) {
  if (!estSource(id)) throw new Error("Source inconnue");
  base()
    .prepare("INSERT INTO sources (id, actif, maj_a) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET actif = excluded.actif, maj_a = excluded.maj_a")
    .run(id, actif ? 1 : 0, Date.now());
}

const USAGE_DEFAUT = { chat: true, nuit: true };

// Ce que Rémy en fait : s'en inspirer dans ses réponses (chat), relire ceux
// du jour la nuit (nuit). REMY_CONVERSATIONS_USAGE=off coupe les deux.
export function usage() {
  const coupe = process.env.REMY_CONVERSATIONS_USAGE === "off";
  let u = { ...USAGE_DEFAUT };
  if (baseExiste()) {
    try {
      u = { ...u, ...JSON.parse(lireMeta("usage") || "{}") };
    } catch {}
  }
  return { chat: !coupe && u.chat !== false, nuit: !coupe && u.nuit !== false, forceParLaTour: coupe };
}

export function reglerUsage({ chat, nuit } = {}) {
  const u = usage();
  const suite = { chat: typeof chat === "boolean" ? chat : u.chat, nuit: typeof nuit === "boolean" ? nuit : u.nuit };
  ecrireMeta("usage", JSON.stringify(suite));
  return usage();
}

const filtresProjets = () =>
  String(process.env.REMY_CONNAISSANCES_PROJETS || "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);

export const projetRetenu = (racineNormalisee, filtres = filtresProjets()) =>
  !filtres.length || filtres.some((f) => racineNormalisee.includes(f));

// Le dossier surveillé des exports : <coffre>\Imports, ou REMY_IMPORTS_DIR.
export function dossierImports() {
  if (process.env.REMY_IMPORTS_DIR) return path.resolve(process.env.REMY_IMPORTS_DIR);
  return path.join(coffre() || dossierBase(), "Imports");
}

// Un export importé QUITTE le coffre (contre-relecture du 29/10 : tout ton
// historique ChatGPT, en clair, dans un dossier qui peut être synchronisé ou
// lu par un agent) : il part à côté de la clé, hors du coffre et de
// Documents, et s'efface au bout de REMY_IMPORTS_GARDE_JOURS (7 par défaut ;
// 0 : tout de suite).
export const dossierOriginaux = () => path.join(dossierCles(), "imports-importes");
const gardeOriginauxMs = () => {
  const j = Number(process.env.REMY_IMPORTS_GARDE_JOURS);
  return (Number.isFinite(j) && j >= 0 ? j : 7) * 86_400_000;
};

// --- La clé ----------------------------------------------------------------------

// La base appartient-elle à cette clé ? La première écriture la lie.
function verifierCle({ lier = false } = {}) {
  const k = cles();
  const controle = lireMeta("cle_controle");
  if (!controle) {
    if (lier) ecrireMeta("cle_controle", k.controle);
    return true;
  }
  if (controle !== k.controle) throw new CleDifferente();
  return true;
}

// --- Écritures communes ----------------------------------------------------------

const place = (source, conv, quoi) => `${source}:${conv}:${quoi}`;

// Les requêtes d'écriture, préparées une fois par base ouverte.
const requetes = new WeakMap();
function requete(t, sql) {
  let m = requetes.get(t);
  if (!m) requetes.set(t, (m = new Map()));
  let r = m.get(sql);
  if (!r) m.set(sql, (r = t.prepare(sql)));
  return r;
}

function ecrireMessage(t, source, conversation, m) {
  const deja = requete(t, "SELECT id, version FROM messages WHERE source = ? AND conversation = ? AND uuid = ?").get(source, conversation, m.uuid);
  // Relu sans changement à sa source (T3 : même date de mise à jour) : rien à faire.
  if (deja && m.version && deja.version === m.version) return "inchange";
  const blob = chiffrer(m.texte, place(source, conversation, `m:${m.uuid}`));
  const jetons = jetonsIndex(m.texte);
  if (deja) {
    requete(t, "UPDATE messages SET ts = ?, auteur = ?, texte = ?, taille = ?, version = ? WHERE id = ?").run(m.ts ?? null, m.auteur, blob, m.texte.length, m.version ?? null, deja.id);
    requete(t, "DELETE FROM index_mots WHERE rowid = ?").run(deja.id);
    requete(t, "INSERT INTO index_mots (rowid, jetons) VALUES (?, ?)").run(deja.id, jetons);
    return "maj";
  }
  const r = requete(t, "INSERT INTO messages (source, conversation, uuid, ts, auteur, texte, taille, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    source,
    conversation,
    m.uuid,
    m.ts ?? null,
    m.auteur,
    blob,
    m.texte.length,
    m.version ?? null,
  );
  requete(t, "INSERT INTO index_mots (rowid, jetons) VALUES (?, ?)").run(r.lastInsertRowid, jetons);
  return "nouveau";
}

// `remplacer` : faux pour un nom de repli (le dossier) qui ne doit pas
// écraser le titre donné dans T3.
function ecrireProjet(t, racineNormalisee, nom, { remplacer = true } = {}) {
  const id = idProjet(racineNormalisee);
  const existe = t.prepare("SELECT id FROM projets WHERE id = ?").get(id);
  if (!existe) {
    t.prepare("INSERT INTO projets (id, racine, nom) VALUES (?, ?, ?)").run(
      id,
      chiffrer(racineNormalisee, `projet:${id}:racine`),
      chiffrer(nom || claude.nomProjet(racineNormalisee), `projet:${id}:nom`),
    );
  } else if (nom && remplacer) {
    t.prepare("UPDATE projets SET nom = ? WHERE id = ?").run(chiffrer(nom, `projet:${id}:nom`), id);
  }
  return id;
}

const couper = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const c = t.slice(0, n);
  const i = c.lastIndexOf(" ");
  return (i > n * 0.6 ? c.slice(0, i) : c) + "…";
};

// Les champs calculés d'une conversation (dates, nombre, aperçu, titre par
// défaut), une fois ses messages écrits.
function finaliserConversation(t, source, id, { titre = null, projet = undefined, assistant = null, version = undefined } = {}) {
  const st = t
    .prepare("SELECT MIN(ts) AS debut, MAX(ts) AS fin, COUNT(*) AS n FROM messages WHERE source = ? AND conversation = ?")
    .get(source, id);
  if (!Number(st.n)) {
    t.prepare("DELETE FROM conversations WHERE source = ? AND id = ?").run(source, id);
    return false;
  }
  t.prepare(
    `INSERT INTO conversations (source, id, debut, fin, messages, maj_a) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, id) DO UPDATE SET debut = excluded.debut, fin = excluded.fin, messages = excluded.messages, maj_a = excluded.maj_a`,
  ).run(source, id, st.debut, st.fin, Number(st.n), Date.now());
  if (projet !== undefined) t.prepare("UPDATE conversations SET projet = ? WHERE source = ? AND id = ?").run(projet, source, id);
  if (assistant) t.prepare("UPDATE conversations SET assistant = ? WHERE source = ? AND id = ?").run(assistant, source, id);
  if (version !== undefined) t.prepare("UPDATE conversations SET version = ? WHERE source = ? AND id = ?").run(version, source, id);
  const c = t.prepare("SELECT titre, apercu FROM conversations WHERE source = ? AND id = ?").get(source, id);
  let apercu = null;
  if (!c.apercu || (!c.titre && !titre)) {
    const premier = t
      .prepare("SELECT uuid, texte FROM messages WHERE source = ? AND conversation = ? AND auteur IN ('utilisateur', 'colle') ORDER BY ts, id LIMIT 1")
      .get(source, id);
    apercu = premier ? dechiffrerOuNull(premier.texte, place(source, id, `m:${premier.uuid}`)) : null;
    if (apercu && !c.apercu) t.prepare("UPDATE conversations SET apercu = ? WHERE source = ? AND id = ?").run(chiffrer(couper(apercu, 200), place(source, id, "apercu")), source, id);
  }
  const titreFinal = titre || (!c.titre ? couper(apercu || "Conversation", 80) : null);
  if (titreFinal) t.prepare("UPDATE conversations SET titre = ? WHERE source = ? AND id = ?").run(chiffrer(titreFinal, place(source, id, "titre")), source, id);
  // Les dates du projet suivent celles de ses conversations.
  const p = t.prepare("SELECT projet FROM conversations WHERE source = ? AND id = ?").get(source, id)?.projet;
  if (p) {
    t.prepare(
      `UPDATE projets SET premiere = (SELECT MIN(debut) FROM conversations WHERE projet = ?), derniere = (SELECT MAX(fin) FROM conversations WHERE projet = ?) WHERE id = ?`,
    ).run(p, p, p);
  }
  return true;
}

function effacerConversation(t, source, id) {
  t.prepare("DELETE FROM messages WHERE source = ? AND conversation = ?").run(source, id);
  t.prepare("DELETE FROM conversations WHERE source = ? AND id = ?").run(source, id);
}

// Un lot d'écriture : 400 messages ou ~120 000 caractères (chiffrer et
// indexer un long message coûte : ses mots passent un par un dans HMAC).
const LOT_ECRITURE = 400;
const LOT_CARACTERES = 120_000;
const rendreLaMain = () => new Promise((r) => setImmediate(r));
function enLots(messages) {
  const lots = [];
  let lot = [];
  let taille = 0;
  for (const m of messages) {
    lot.push(m);
    taille += m.texte?.length || 0;
    if (lot.length >= LOT_ECRITURE || taille >= LOT_CARACTERES) {
      lots.push(lot);
      lot = [];
      taille = 0;
    }
  }
  if (lot.length) lots.push(lot);
  return lots;
}

// --- Claude Code -------------------------------------------------------------------

// Le curseur garde le dossier de la session (pour le filtre de projets) : il
// est rangé chiffré, comme le reste. Les compteurs (messages tapés, dialogue
// vu) servent à la règle d'exclusion et au diagnostic.
function curseurVersBase(c) {
  if (!c) return null;
  const { etat = {}, ...reste } = c;
  const { cwd, ...compteurs } = etat;
  return JSON.stringify({ ...reste, etat: { ...compteurs, entrypoint: etat.entrypoint || null, session: etat.session || null, cwd: cwd ? chiffrer(cwd, "curseur:cwd").toString("base64") : null } });
}

function curseurDepuisBase(texte) {
  if (!texte) return null;
  const c = JSON.parse(texte);
  if (c?.etat?.cwd) c.etat.cwd = dechiffrerOuNull(Buffer.from(c.etat.cwd, "base64"), "curseur:cwd");
  return c;
}

// La règle d'exclusion a changé (claudeCode.js, REGLE) : ce qui avait été
// écarté, ou lu sans rien donner, est relu une fois depuis le début — sinon
// une session écartée à tort resterait « inchangée » pour toujours (le 0 de la
// tour, le 29/10 : des curseurs posés, aucune conversation).
function migrerRegleClaude() {
  if (lireMeta("regle_claude") === String(claude.REGLE)) return 0;
  const n = base()
    .prepare(
      `UPDATE curseurs SET valeur = NULL WHERE source = ? AND (exclu IS NOT NULL OR conversation IS NULL
         OR conversation NOT IN (SELECT id FROM conversations WHERE source = ?))`,
    )
    .run(SOURCE_CLAUDE, SOURCE_CLAUDE).changes;
  ecrireMeta("regle_claude", String(claude.REGLE));
  return Number(n);
}

// Une session écartée sur une décision qui porte sur TOUTE la session (un seul
// échange ; pas de dossier) est relue en entier quand elle change.
const RELIRE_EN_ENTIER = new Set(["programme", "sans-dossier"]);
const RAISONS = { remy: "remy", programme: "programme", "hors-filtre": "horsFiltre", "sans-dossier": "sansDossier" };

// Le recensement de toutes les sessions (lues ou inchangées) : ce que le
// diagnostic dit (« 312 sessions : 280 lues, 30 d'un seul échange… »).
const recensementVide = () => ({ sessions: 0, gardees: 0, vides: 0, illisibles: 0, erreurs: 0, ecartees: { remy: 0, programme: 0, horsFiltre: 0, sansDossier: 0 }, sousAgents: 0, ailleurs: 0 });
function compter(rec, exclu, garde) {
  rec.sessions++;
  if (!exclu) return void (garde ? rec.gardees++ : rec.vides++);
  if (exclu === "vide") return void rec.vides++;
  if (exclu === "illisible") return void rec.illisibles++;
  // Une ancienne raison (« entrypoint:sdk-cli ») : un programme.
  rec.ecartees[RAISONS[exclu] || "programme"]++;
}

async function lireClaude() {
  const racines = claude.racines();
  const filtres = filtresProjets();
  const bilan = {
    fichiers: 0, lus: 0, inchanges: 0, relus: 0, exclus: 0, horsFiltre: 0, messages: 0, masques: 0, illisibles: 0, tropGrosses: 0, erreurs: 0,
    sansFichier: !racines.length, aRelire: migrerRegleClaude(), recensement: recensementVide(), ...(filtres.length ? { filtre: filtres } : {}),
  };
  const rec = bilan.recensement;
  const b = base();
  const lecture = b.prepare("SELECT valeur, exclu FROM curseurs WHERE cle = ?");
  const gardees = new Set(b.prepare("SELECT id FROM conversations WHERE source = ?").all(SOURCE_CLAUDE).map((x) => x.id));
  const noterExclu = b.prepare("UPDATE curseurs SET exclu = ?, lu_a = ? WHERE cle = ?");
  for (const racine of racines) {
    const profonds = claude.fichiersPlusProfonds(racine);
    rec.sousAgents += profonds.sousAgents;
    rec.ailleurs += profonds.autres;
    for (const fichier of claude.fichiersDeSession(racine)) {
      bilan.fichiers++;
      // Une conversation = un fichier de session (son nom est l'identifiant
      // de la session, celui que T3 Code connaît aussi).
      const session = path.basename(fichier).replace(/\.jsonl$/i, "").toLowerCase();
      try {
        const cle = cleChemin(fichier);
        const deja = lecture.get(cle);
        let curseur = curseurDepuisBase(deja?.valeur);
        let exclu0 = deja?.exclu ?? null;
        // Le filtre de projets a changé : un projet ajouté au filtre est relu
        // depuis le début ; un projet retiré sort de la base (sans relire).
        const racine0 = claude.normaliserCwd(curseur?.etat?.cwd || "");
        if (curseur && exclu0 === "hors-filtre" && racine0 && projetRetenu(racine0, filtres)) curseur = null;
        else if (curseur && !exclu0 && racine0 && !projetRetenu(racine0, filtres)) {
          transaction((t) => {
            effacerConversation(t, SOURCE_CLAUDE, session);
            noterExclu.run("hors-filtre", Date.now(), cle);
          });
          gardees.delete(session);
          exclu0 = "hors-filtre";
          bilan.horsFiltre++;
        }
        const st = fs.statSync(fichier, { bigint: true });
        if (curseur && curseur.ino === String(st.ino) && curseur.taille === Number(st.size) && curseur.offset === Number(st.size)) {
          bilan.inchanges++;
          compter(rec, exclu0, gardees.has(session));
          continue;
        }
        if (curseur && RELIRE_EN_ENTIER.has(exclu0)) curseur = null;
        const r = await claude.lireSession(fichier, curseur);
        bilan.lus++;
        bilan.illisibles += r.compte.illisibles;
        bilan.tropGrosses += r.compte.tropGrosses;
        const racineProjet = claude.normaliserCwd(r.etat.cwd || "");
        let exclu = r.exclusion;
        if (!exclu && !racineProjet) exclu = "sans-dossier";
        else if (!exclu && !projetRetenu(racineProjet, filtres)) exclu = "hors-filtre";
        // Rien de lisible dans TOUTE la session (les compteurs suivent le
        // curseur) : vide, ou d'un format que Rémy ne comprend pas.
        else if (!exclu && !r.etat.passages) exclu = r.etat.inconnus ? "illisible" : "vide";
        // Par lots, en rendant la main entre deux : une session de 4 000
        // messages ne fige plus la tour (contre-relecture du 29/10). Le curseur
        // n'avance qu'au dernier lot : une coupure entre deux fait tout relire.
        const lots = enLots(r.passages);
        if (!lots.length) lots.push([]);
        let projet = null;
        const ecrire = !exclu;
        for (let k = 0; k < lots.length; k++) {
          const dernier = k === lots.length - 1;
          transaction((t) => {
            // Relue depuis le début (réécrite, ou décision à refaire), ou
            // écartée maintenant : l'ancienne version part d'abord.
            if (k === 0 && (r.relu || !curseur || !ecrire) && gardees.has(session)) effacerConversation(t, SOURCE_CLAUDE, session);
            if (ecrire) {
              if (k === 0) projet = ecrireProjet(t, racineProjet, claude.nomLisible(r.etat.cwd), { remplacer: false });
              for (const p of lots[k]) {
                if (ecrireMessage(t, SOURCE_CLAUDE, session, p) === "nouveau") bilan.messages++;
                bilan.masques += p.masques;
              }
              // Le titre donné dans Claude Code (/rename), sinon le premier message.
              // (Les « summary » d'un fichier décrivent d'AUTRES sessions : écartés.)
              if (dernier) finaliserConversation(t, SOURCE_CLAUDE, session, { titre: r.etat.titre || null, projet, assistant: "Claude" });
            } else if (dernier && RAISONS[exclu]) {
              bilan[exclu === "hors-filtre" ? "horsFiltre" : "exclus"]++;
            }
            if (dernier) {
              t.prepare(
                `INSERT INTO curseurs (cle, source, conversation, valeur, exclu, lu_a) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(cle) DO UPDATE SET conversation = excluded.conversation, valeur = excluded.valeur, exclu = excluded.exclu, lu_a = excluded.lu_a`,
              ).run(cle, SOURCE_CLAUDE, session, curseurVersBase(r.curseur), exclu, Date.now());
            }
          });
          if (!dernier) await rendreLaMain();
        }
        if (ecrire) gardees.add(session);
        else gardees.delete(session);
        compter(rec, exclu, ecrire);
        if (r.relu) bilan.relus++;
      } catch (err) {
        if (err instanceof CleDifferente) throw err;
        bilan.erreurs++;
        rec.sessions++;
        rec.erreurs++;
        console.warn(`Conversations externes : session Claude Code illisible (${err.code || err.name})`);
      }
    }
  }
  return bilan;
}

// --- T3 Code -------------------------------------------------------------------------

async function lireT3() {
  const liste = t3.bases({ frais: true });
  const filtres = filtresProjets();
  const bilan = {
    bases: liste.length, fils: 0, messages: 0, majs: 0, masques: 0, supprimees: 0, horsFiltre: 0, liens: 0, erreurs: 0, sansFichier: !liste.length,
    // Ce que le diagnostic dit : chaque base trouvée, ses fils, et pourquoi
    // ceux qui ne sont pas montrés ne le sont pas.
    recensement: { bases: liste.length, fils: 0, gardes: 0, sansMessage: 0, horsFiltre: 0, supprimes: 0, sousAgents: 0, erreurs: 0 },
    detail: [],
    ...(filtres.length ? { filtre: filtres } : {}),
  };
  const rec = bilan.recensement;
  let derniereErreur = null;
  const vus = new Set(); // les fils de toutes les bases lues
  let toutesLues = true;
  for (const { fichier, version } of liste) {
    const ici = { chemin: montrerChemin(fichier), version, fils: 0, gardes: 0, sansMessage: 0, horsFiltre: 0, supprimes: 0, sousAgents: 0, erreur: null };
    bilan.detail.push(ici);
    try {
      const cle = cleChemin(`t3:${fichier}`);
      const deja = base().prepare("SELECT valeur FROM curseurs WHERE cle = ?").get(cle);
      const curseur = deja?.valeur ? JSON.parse(deja.valeur) : null;
      const connus = new Set(base().prepare("SELECT id FROM conversations WHERE source = ?").all(SOURCE_T3).map((x) => x.id));
      const r = await t3.lireBase(fichier, curseur, { connus });
      for (const id of r.fils.keys()) vus.add(id);
      // Les projets de T3, et ceux qu'on garde.
      const projets = new Map();
      transaction((t) => {
        for (const [id, p] of r.projets) {
          const racine = claude.normaliserCwd(p.racine || "");
          if (!racine) continue;
          projets.set(id, { retenu: projetRetenu(racine, filtres), id: ecrireProjet(t, racine, p.titre || null) });
        }
      });
      // Les messages, par lots (une première lecture de 25 000 messages ne
      // fige plus la tour). Le curseur n'avance qu'à la fin.
      const touches = new Set();
      for (const lotT3 of enLots(r.messages)) {
        transaction((t) => {
          for (const m of lotT3) {
            const fil = r.fils.get(m.conversation);
            const p = projets.get(fil?.projet);
            if (!fil || fil.supprime || (p && !p.retenu) || (!p && filtres.length)) {
              bilan.horsFiltre++;
              continue;
            }
            const etat = ecrireMessage(t, SOURCE_T3, m.conversation, m);
            // Même inchangé, le fil est revu (une coupure avant la fin d'une
            // lecture laisse des messages sans leur conversation).
            touches.add(m.conversation);
            if (etat === "inchange") continue;
            bilan[etat === "nouveau" ? "messages" : "majs"]++;
            bilan.masques += m.masques;
          }
        });
        await rendreLaMain();
      }
      transaction((t) => {
        // Les sessions Claude menées par T3.
        for (const l of r.liens) {
          t.prepare("INSERT INTO liens (natif, source, conversation) VALUES (?, ?, ?) ON CONFLICT(natif) DO UPDATE SET source = excluded.source, conversation = excluded.conversation, efface = CASE WHEN liens.conversation = excluded.conversation THEN liens.efface END").run(l.natif, SOURCE_T3, l.conversation);
          bilan.liens++;
        }
        // Les fils : titres et projets à jour, supprimés effacés.
        const connues = new Set(t.prepare("SELECT id FROM conversations WHERE source = ?").all(SOURCE_T3).map((x) => x.id));
        for (const fil of r.fils.values()) {
          const p = projets.get(fil.projet);
          const garde = !fil.supprime && !fil.sousAgent && (p ? p.retenu : !filtres.length);
          if (!garde) {
            if (connues.has(fil.id)) {
              effacerConversation(t, SOURCE_T3, fil.id);
              bilan.supprimees++;
            }
            // Effacé dans T3 : sa session Claude reste cachée (tu l'as effacée là-bas).
            if (fil.supprime) t.prepare("UPDATE liens SET efface = 1 WHERE source = ? AND conversation = ?").run(SOURCE_T3, fil.id);
            continue;
          }
          if (touches.has(fil.id) || connues.has(fil.id)) {
            if (finaliserConversation(t, SOURCE_T3, fil.id, { titre: fil.titre || null, projet: p?.id ?? null, assistant: fil.assistant })) bilan.fils++;
          }
        }
        t.prepare(
          `INSERT INTO curseurs (cle, source, valeur, lu_a) VALUES (?, ?, ?, ?)
           ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, lu_a = excluded.lu_a`,
        ).run(cle, SOURCE_T3, JSON.stringify(r.curseur), Date.now());
      });
      // Le recensement de cette base (tous ses fils, lus ou non cette fois).
      const montrees = new Set(base().prepare("SELECT id FROM conversations WHERE source = ?").all(SOURCE_T3).map((x) => x.id));
      for (const fil of r.fils.values()) {
        ici.fils++;
        const p = projets.get(fil.projet);
        if (fil.supprime) ici.supprimes++;
        else if (fil.sousAgent) ici.sousAgents++;
        else if (p ? !p.retenu : filtres.length) ici.horsFiltre++;
        else if (montrees.has(fil.id)) ici.gardes++;
        else ici.sansMessage++;
      }
      for (const k of ["fils", "gardes", "sansMessage", "horsFiltre", "supprimes", "sousAgents"]) rec[k] += ici[k];
    } catch (err) {
      if (err instanceof CleDifferente) throw err;
      bilan.erreurs++;
      rec.erreurs++;
      ici.erreur = erreurDe(SOURCE_T3, err).message;
      toutesLues = false;
      derniereErreur = err;
      console.warn(`Conversations externes : base T3 Code illisible (${err.code || err.name})`);
    }
  }
  // Un fil disparu de T3 (effacé pour de bon) disparaît ici aussi — seulement
  // quand toutes les bases ont été lues (sinon on effacerait ce qu'on n'a pas vu).
  if (toutesLues && liste.length) {
    transaction((t) => {
      for (const { id } of t.prepare("SELECT id FROM conversations WHERE source = ?").all(SOURCE_T3)) {
        if (!vus.has(id)) {
          effacerConversation(t, SOURCE_T3, id);
          t.prepare("UPDATE liens SET efface = 1 WHERE source = ? AND conversation = ?").run(SOURCE_T3, id);
          bilan.supprimees++;
        }
      }
    });
  }
  if (derniereErreur && bilan.erreurs === liste.length) throw derniereErreur;
  return bilan;
}

// --- ChatGPT ------------------------------------------------------------------------------

const sha256Fichier = async (f) => {
  const h = crypto.createHash("sha256");
  for await (const c of fs.createReadStream(f, { highWaterMark: 1 << 20 })) h.update(c);
  return h.digest("hex");
};

// Importe un export (.zip ou conversations.json). Idempotent : un fichier déjà
// importé est reconnu à son empreinte, et une conversation déjà là n'est
// réécrite que si ChatGPT l'a modifiée depuis.
export async function importerChatGPT(fichier, { octets = null } = {}) {
  return enFile(() => importerVraiment(fichier, { octets }));
}

// `exigerChatGPT` : un .zip pris dans Téléchargements doit être un vrai export
// ChatGPT — si aucune conversation n'a sa forme (l'export d'un autre
// assistant, qui a aussi un conversations.json), rien n'est noté comme importé.
async function importerVraiment(fichier, { octets, exigerChatGPT = false }) {
  verifierCle({ lier: true });
  const empreinte = await sha256Fichier(fichier);
  const taille = octets ?? fs.statSync(fichier).size;
  const deja = base().prepare("SELECT a, bilan FROM imports WHERE empreinte = ?").get(empreinte);
  if (deja) return { ok: true, deja: true, importeLe: deja.a, ...(JSON.parse(deja.bilan || "{}")), nouvelles: 0, misesAJour: 0 };
  const bilan = { conversations: 0, nouvelles: 0, misesAJour: 0, inchangees: 0, ignorees: 0, messages: 0, masques: 0, tronquees: 0 };
  const lot = [];
  let enLot = 0;
  // Une conversation : effacée si ChatGPT l'a modifiée, puis ses messages par
  // lots (une conversation de 2 000 messages ne fige pas la tour), puis ses
  // champs calculés. Coupé en route : relue au prochain import (sa version
  // n'est écrite qu'à la fin).
  const ecrireConversation = async (c) => {
    const avant = base().prepare("SELECT version FROM conversations WHERE source = ? AND id = ?").get(SOURCE_CHATGPT, c.id);
    if (avant && avant.version === c.version) {
      bilan.inchangees++;
      return;
    }
    const lots = enLots(c.messages);
    for (let k = 0; k < lots.length; k++) {
      transaction((t) => {
        if (k === 0 && avant) effacerConversation(t, SOURCE_CHATGPT, c.id);
        for (const m of lots[k]) {
          ecrireMessage(t, SOURCE_CHATGPT, c.id, m);
          bilan.messages++;
        }
        if (k === lots.length - 1) {
          // Un message sans date prend celle de la conversation (déjà fait) ;
          // la fin d'une conversation est celle de ChatGPT, pas son dernier message.
          finaliserConversation(t, SOURCE_CHATGPT, c.id, { titre: c.titre, projet: null, assistant: "ChatGPT", version: c.version });
          if (c.fin) t.prepare("UPDATE conversations SET fin = MAX(COALESCE(fin, 0), ?) WHERE source = ? AND id = ?").run(c.fin, SOURCE_CHATGPT, c.id);
        }
      });
      if (lots.length > 1) await rendreLaMain();
    }
    bilan[avant ? "misesAJour" : "nouvelles"]++;
  };
  const vider = async () => {
    for (const c of lot.splice(0)) await ecrireConversation(c);
    enLot = 0;
  };
  try {
    for await (const brut of conversationsDuFichier(fichier)) {
      bilan.conversations++;
      const { conversation, raison } = conversationDe(brut);
      if (!conversation) {
        bilan.ignorees++;
        continue;
      }
      bilan.masques += conversation.masques;
      if (conversation.tronquee) bilan.tronquees++;
      lot.push(conversation);
      enLot += conversation.messages.reduce((a, m) => a + m.texte.length, 0);
      // Par lots de 50 conversations ou ~120 000 caractères, en rendant la
      // main souvent : la tour ne se fige pas.
      if (lot.length >= 50 || enLot >= LOT_CARACTERES) await vider();
      if (bilan.conversations % 5 === 0 || !lot.length) await rendreLaMain();
    }
  } catch (err) {
    // Ce qui a été lu avant l'accroc reste (idempotent) ; l'état le dit.
    try {
      await vider();
    } catch {}
    throw Object.assign(err, { bilan: { ...bilan, partiel: true } });
  }
  await vider();
  if (!bilan.conversations) throw Object.assign(new Error("Aucune conversation dans ce fichier : est-ce bien l'export de ChatGPT (conversations.json) ?"), { code: "SANS_CONVERSATIONS" });
  if (exigerChatGPT && bilan.ignorees === bilan.conversations) throw Object.assign(new Error("Ce n'est pas un export ChatGPT."), { code: "PAS_CHATGPT" });
  base().prepare("INSERT INTO imports (empreinte, a, octets, bilan) VALUES (?, ?, ?, ?)").run(empreinte, Date.now(), taille, JSON.stringify(bilan));
  // Un import, c'est un accord : la source est allumée.
  if (!sourceActive(SOURCE_CHATGPT) && envSource(SOURCE_CHATGPT) !== "off") reglerSource(SOURCE_CHATGPT, true);
  noterLecture(SOURCE_CHATGPT, { ok: true, bilan: { ...bilan, fichier: "envoi" } });
  return { ok: true, deja: false, ...bilan };
}

// Les exports déposés dans le dossier surveillé. Ce qui compte : un .zip, un
// conversations.json (ou conversations-001.json…), ou un dossier qui en
// contient un (« Extraire tout » de Windows crée un sous-dossier). Les autres
// fichiers de l'export (user.json, message_feedback.json…) sont ignorés. Un
// fichier en cours de copie (modifié il y a moins de 10 s) attend le passage
// suivant ; importé, il quitte le coffre (dossierOriginaux) ; illisible, il
// reste, l'état dit pourquoi, et il n'est pas relu tant qu'il ne change pas.
const ANNEXES = /^((user|message_feedback|shared_conversations|model_comparisons|group_chats|sora|shopping)[\w-]*\.json|chat\.html)$/i;
const EXPORT_JSON = /^conversations(-\d+)?\.json$/i;

export function exportsDeposes(dossier = dossierImports()) {
  const sortie = [];
  let lus = [];
  try {
    lus = fs.readdirSync(dossier, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  for (const e of lus) {
    const chemin = path.join(dossier, e.name);
    if (e.isFile()) {
      if (/\.zip$/i.test(e.name) || EXPORT_JSON.test(e.name)) sortie.push({ nom: e.name, fichiers: [chemin], racine: chemin });
      continue;
    }
    if (!e.isDirectory() || e.name === "Importés" || e.name.startsWith(".")) continue;
    let dedans = [];
    try {
      dedans = fs.readdirSync(chemin, { withFileTypes: true }).filter((x) => x.isFile() && (EXPORT_JSON.test(x.name) || /\.zip$/i.test(x.name)));
    } catch {}
    if (dedans.length) sortie.push({ nom: e.name, fichiers: dedans.map((x) => path.join(chemin, x.name)), racine: chemin });
  }
  return sortie;
}

function signature(depot) {
  return depot.fichiers
    .map((f) => {
      const st = fs.statSync(f);
      return `${path.basename(f)}:${st.size}:${Math.round(st.mtimeMs)}`;
    })
    .join("|");
}

function deplacer(source, cible) {
  try {
    fs.renameSync(source, cible);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    // Autre disque (coffre sur D:, profil sur C:) : copie puis effacement.
    fs.cpSync(source, cible, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

// Les originaux importés : effacés passé leur délai. Rend ce qui reste.
export function originauxRestants({ purger = false } = {}) {
  const d = dossierOriginaux();
  let noms = [];
  try {
    noms = fs.readdirSync(d);
  } catch {
    return { fichiers: 0, octets: 0 };
  }
  let fichiers = 0;
  let octets = 0;
  for (const n of noms) {
    const f = path.join(d, n);
    try {
      const st = fs.statSync(f);
      if (purger && Date.now() - st.mtimeMs >= gardeOriginauxMs()) {
        fs.rmSync(f, { recursive: true, force: true });
        continue;
      }
      fichiers++;
      octets += st.isDirectory() ? fs.readdirSync(f).reduce((a, x) => a + (fs.statSync(path.join(f, x)).size || 0), 0) : st.size;
    } catch {}
  }
  return { fichiers, octets };
}

async function lireDossierImports() {
  const dossier = dossierImports();
  const bilan = { fichiers: 0, importes: 0, deja: 0, enAttente: 0, erreurs: 0, ignores: 0, conversations: 0, nouvelles: 0, misesAJour: 0, sansFichier: false };
  try {
    originauxRestants({ purger: true });
  } catch {}
  const depots = exportsDeposes(dossier) ?? [];
  // Le dossier Imports n'existe pas (encore) : Téléchargements se lit quand même.
  if (!fs.existsSync(dossier)) bilan.sansFichier = true;
  let echecs = {};
  try {
    echecs = JSON.parse(lireMeta("imports_echecs") || "{}");
  } catch {}
  const suite = {};
  let derniere = null;
  for (const depot of depots) {
    bilan.fichiers++;
    try {
      const sig = signature(depot);
      if (depot.fichiers.some((f) => Date.now() - fs.statSync(f).mtimeMs < 10_000)) {
        bilan.enAttente++;
        continue;
      }
      // Déjà essayé tel quel, et illisible : on ne refait pas 30 s de calcul
      // toutes les 30 min ; l'erreur reste affichée jusqu'au prochain fichier.
      if (echecs[sig]) {
        suite[sig] = echecs[sig];
        bilan.erreurs++;
        derniere = Object.assign(new Error(echecs[sig].message || "export illisible"), { code: echecs[sig].code });
        continue;
      }
      try {
        for (const f of depot.fichiers) {
          const r = await importerVraiment(f, { octets: fs.statSync(f).size });
          if (r.deja) bilan.deja++;
          else {
            bilan.importes++;
            bilan.conversations += r.conversations;
            bilan.nouvelles += r.nouvelles;
            bilan.misesAJour += r.misesAJour;
          }
        }
      } catch (err) {
        if (err instanceof CleDifferente) throw err;
        suite[sig] = { code: err.code || "erreur", message: err.message };
        throw err;
      }
      fs.mkdirSync(dossierOriginaux(), { recursive: true, mode: 0o700 });
      const cible = path.join(dossierOriginaux(), `${new Date().toISOString().slice(0, 10)}-${Date.now()}-${depot.nom}`);
      try {
        if (depot.racine === depot.fichiers[0] && EXPORT_JSON.test(depot.nom)) {
          // Un export décompressé à plat : conversations.json part avec les
          // fichiers qui l'accompagnent (user.json et son adresse, chat.html…).
          fs.mkdirSync(cible, { recursive: true });
          deplacer(depot.racine, path.join(cible, depot.nom));
          for (const n of fs.readdirSync(dossier)) if (ANNEXES.test(n)) deplacer(path.join(dossier, n), path.join(cible, n));
        } else {
          deplacer(depot.racine, cible);
        }
        fs.utimesSync(cible, new Date(), new Date()); // le délai court depuis l'import
      } catch (err) {
        console.warn(`Conversations externes : export importé mais laissé dans Imports (${err.code || err.message})`);
      }
    } catch (err) {
      if (err instanceof CleDifferente) throw err;
      bilan.erreurs++;
      derniere = err;
      if (err.bilan) Object.assign(bilan, { partiel: true, conversations: bilan.conversations + (err.bilan.conversations || 0) });
      console.warn(`Conversations externes : export illisible dans Imports (${err.code || err.name})`);
    }
  }
  try {
    ecrireMeta("imports_echecs", JSON.stringify(suite));
  } catch {}
  // Puis les exports que le navigateur a rangés dans Téléchargements.
  const t = await lireTelechargements();
  bilan.telechargements = t.bilan;
  for (const k of ["importes", "deja", "conversations", "nouvelles", "misesAJour", "erreurs"]) bilan[k] += t.bilan[k];
  if (!derniere && t.derniere) derniere = t.derniere;
  if (derniere) throw Object.assign(derniere, { bilan });
  return bilan;
}

// --- Téléchargements : l'export ChatGPT pris là où le navigateur le range ------------
//
// Demande du 29/10 (« comment on pourrait l'automatiser ? ») : ChatGPT n'a pas
// d'API de l'historique, seulement son export par mail. Rémy ne pilote aucun
// navigateur et ne se connecte ni à ChatGPT ni à la messagerie : tu demandes
// l'export, tu cliques le lien du mail, le navigateur range le .zip dans
// Téléchargements — et Rémy l'y prend, au passage suivant (30 min, la nuit, ou
// « Lire maintenant »).
//
// Garde-fous : Rémy ne regarde QUE les .zip du premier niveau, modifiés il y a
// moins de TELECHARGEMENTS_JOURS jours et pas plus gros que la limite des
// envois ; d'un .zip, il ne lit d'abord que l'annuaire central (les noms des
// entrées) — un export ChatGPT a conversations.json à sa racine —, et seulement
// alors l'ouvre. Il ne déplace, ne renomme, n'efface ni ne modifie JAMAIS un
// fichier de Téléchargements : il est à toi. Un même export n'est importé
// qu'une fois (empreinte, comme l'import d'Imports) ; un .zip déjà regardé
// n'est pas relu tant qu'il ne change pas (empreintes HMAC de son chemin, de
// sa taille et de sa date : aucun nom de fichier n'est gardé en clair).

export const TELECHARGEMENTS_JOURS = 90;
export const RAPPEL_EXPORT_JOURS = 30;
export const LIEN_EXPORT_CHATGPT = "https://chatgpt.com/#settings/DataControls";
const EXPORT_A_LA_RACINE = /^conversations(-\d+)?\.json$/i;
const maxOctetsImport = () => {
  const mo = Number(process.env.REMY_IMPORT_MAX_MO);
  return Math.round((mo > 0 ? mo : 2048) * 1024 * 1024);
};
const telechargementsCoupesParLaTour = () => String(process.env.REMY_TELECHARGEMENTS || "").trim().toLowerCase() === "off";

// Les dossiers surveillés : ~/Downloads, ou REMY_TELECHARGEMENTS (plusieurs
// dossiers séparés par « ; » ; « off » coupe la surveillance sur la tour).
export function dossiersTelechargements() {
  if (telechargementsCoupesParLaTour()) return [];
  const brut = String(process.env.REMY_TELECHARGEMENTS || "").trim();
  const liste = brut ? brut.split(/[;\n]/).map((x) => x.trim()).filter(Boolean) : [path.join(os.homedir(), "Downloads")];
  const vus = new Set();
  return liste.map((d) => path.resolve(t3.deplier(d))).filter((d) => (vus.has(d) ? false : vus.add(d)));
}

// Les réglages de l'import ChatGPT (Réglages › Sources des conversations) :
// surveiller Téléchargements, rappeler d'exporter. Allumés par défaut.
export function reglagesChatGPT() {
  let r = {};
  if (baseExiste()) {
    try {
      r = JSON.parse(lireMeta("chatgpt_reglages") || "{}") || {};
    } catch {}
  }
  const coupe = telechargementsCoupesParLaTour();
  return { telechargements: !coupe && r.telechargements !== false, rappel: r.rappel !== false, telechargementsForce: coupe };
}

export function reglerChatGPT({ telechargements, rappel } = {}) {
  let r = {};
  try {
    r = JSON.parse(lireMeta("chatgpt_reglages") || "{}") || {};
  } catch {}
  if (typeof telechargements === "boolean") r.telechargements = telechargements;
  if (typeof rappel === "boolean") r.rappel = rappel;
  ecrireMeta("chatgpt_reglages", JSON.stringify(r));
  return reglagesChatGPT();
}

// Un .zip est-il un export ChatGPT ? Seul l'annuaire central est lu (les noms
// des entrées) : rien n'est décompressé.
export function exportChatGPT(fichier) {
  try {
    return entreesZip(fichier, { annuaireMax: 32 * 1024 * 1024 }).some((e) => EXPORT_A_LA_RACINE.test(e.nom));
  } catch {
    return false;
  }
}

async function lireTelechargements() {
  const bilan = { dossiers: 0, zips: 0, exports: 0, importes: 0, deja: 0, autres: 0, tropVieux: 0, tropGros: 0, enCours: 0, erreurs: 0, conversations: 0, nouvelles: 0, misesAJour: 0 };
  if (!reglagesChatGPT().telechargements) return { bilan: { ...bilan, coupe: true }, derniere: null };
  let vus = {};
  try {
    vus = JSON.parse(lireMeta("telechargements_vus") || "{}") || {};
  } catch {}
  const suite = {};
  let derniere = null;
  const max = maxOctetsImport();
  for (const dossier of dossiersTelechargements()) {
    let entrees;
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      continue;
    }
    bilan.dossiers++;
    for (const e of entrees) {
      if (!e.isFile() || !/\.zip$/i.test(e.name)) continue;
      const fichier = path.join(dossier, e.name);
      let st;
      try {
        st = fs.statSync(fichier);
      } catch {
        continue;
      }
      bilan.zips++;
      const age = Date.now() - st.mtimeMs;
      if (age > TELECHARGEMENTS_JOURS * 86_400_000) {
        bilan.tropVieux++;
        continue;
      }
      // Encore en cours d'écriture : au passage suivant.
      if (age < 10_000) {
        bilan.enCours++;
        continue;
      }
      if (st.size > max) {
        bilan.tropGros++;
        continue;
      }
      const sig = cleChemin(`telechargement:${fichier}:${st.size}:${Math.round(st.mtimeMs)}`);
      const connu = vus[sig];
      if (connu) {
        suite[sig] = connu;
        if (connu.r === "autre") bilan.autres++;
        else if (connu.r === "erreur") {
          bilan.erreurs++;
          derniere = Object.assign(new Error(connu.message || "export illisible"), { code: connu.code });
        } else bilan.deja++;
        continue;
      }
      if (!exportChatGPT(fichier)) {
        suite[sig] = { r: "autre", a: Date.now() };
        bilan.autres++;
        continue;
      }
      bilan.exports++;
      try {
        const r = await importerVraiment(fichier, { octets: st.size, exigerChatGPT: true });
        suite[sig] = { r: r.deja ? "deja" : "importe", a: Date.now() };
        if (r.deja) bilan.deja++;
        else {
          bilan.importes++;
          bilan.conversations += r.conversations;
          bilan.nouvelles += r.nouvelles;
          bilan.misesAJour += r.misesAJour;
        }
      } catch (err) {
        if (err instanceof CleDifferente) throw err;
        if (err.code === "PAS_CHATGPT") {
          suite[sig] = { r: "autre", a: Date.now() };
          bilan.autres++;
          continue;
        }
        // Gardé tel quel : pas relu tant que le fichier ne change pas.
        suite[sig] = { r: "erreur", code: err.code || "erreur", message: err.message, a: Date.now() };
        bilan.erreurs++;
        derniere = err;
        console.warn(`Conversations externes : export illisible dans Téléchargements (${err.code || err.name})`);
      }
    }
  }
  try {
    ecrireMeta("telechargements_vus", JSON.stringify(suite));
  } catch {}
  return { bilan, derniere };
}

// --- Synchronisation -----------------------------------------------------------------

let chaine = Promise.resolve();
function enFile(fn) {
  const p = chaine.then(fn, fn);
  chaine = p.catch(() => {});
  return p;
}

// Ce qu'on dit quand ça ne va pas, et quoi faire.
export function erreurDe(source, err) {
  const code = err?.code || "erreur";
  if (code === "CLE_DIFFERENTE") return { code: "cle-differente", message: err.message, quoiFaire: "Réglages › Sources des conversations › Tout effacer, puis « Lire maintenant »." };
  if (source === SOURCE_T3) {
    if (code === "node-ancien") return { code, message: err.message, quoiFaire: "Installe Node 22.15 ou plus sur la tour, puis relance l'installeur." };
    if (code === "schema-inconnu") return { code, message: err.message, quoiFaire: "Mets T3 Code et Rémy à jour ; si ça persiste, signale-le (rien n'a été modifié chez T3)." };
    if (/BUSY|LOCKED/i.test(String(code)) || /locked|busy/i.test(String(err?.message))) return { code: "occupe", message: "T3 Code écrivait dans sa base pendant la lecture.", quoiFaire: "Rien à faire : nouvel essai à la prochaine lecture (30 min), ou « Lire maintenant »." };
    return { code: "illisible", message: `La base de T3 Code n'a pas pu être lue (${code}).`, quoiFaire: "Réessaie « Lire maintenant » ; si ça persiste, ferme et rouvre T3 Code." };
  }
  if (source === SOURCE_CHATGPT) {
    if (code === "ZIP_INVALIDE") return { code: "zip-invalide", message: err.message, quoiFaire: "Retélécharge l'export depuis le lien du mail de ChatGPT (le .zip entier), puis réessaie." };
    if (code === "JSON_INVALIDE") return { code: "json-invalide", message: err.message, quoiFaire: "Envoie le .zip d'origine plutôt qu'un conversations.json modifié." };
    if (code === "SANS_CONVERSATIONS") return { code: "sans-conversations", message: err.message, quoiFaire: "Dans ChatGPT : Réglages › Contrôle des données › Exporter, puis envoie le .zip reçu par mail." };
    return { code: "illisible", message: `Un export n'a pas pu être lu (${code}).`, quoiFaire: "Retélécharge l'export et réessaie ; il reste dans Imports en attendant." };
  }
  return { code: "illisible", message: `Les sessions n'ont pas pu être lues (${code}).`, quoiFaire: "Réessaie « Lire maintenant » ; le détail est dans le journal de la tour." };
}

function noterLecture(source, { ok, bilan = null, erreur = null, debut = Date.now() }) {
  const fin = Date.now();
  base()
    .prepare(
      `INSERT INTO sources (id, derniere_lecture, derniere_reussie, bilan, erreur) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET derniere_lecture = excluded.derniere_lecture,
         derniere_reussie = COALESCE(excluded.derniere_reussie, sources.derniere_reussie),
         bilan = COALESCE(excluded.bilan, sources.bilan), erreur = excluded.erreur`,
    )
    .run(source, fin, ok ? fin : null, bilan ? JSON.stringify(bilan) : null, erreur ? JSON.stringify(erreur) : null);
  base().prepare("INSERT INTO journal (debut, fin, source, bilan) VALUES (?, ?, ?, ?)").run(debut, fin, source, JSON.stringify({ ok, ...(bilan || {}), ...(erreur ? { erreur: erreur.code } : {}) }));
}

const LECTEURS = { [SOURCE_CLAUDE]: lireClaude, [SOURCE_T3]: lireT3, [SOURCE_CHATGPT]: lireDossierImports };

// Une lecture de toutes les sources allumées (ou de celles demandées). Une
// seconde demande pendant la première l'attend au lieu de relire.
let enCours = null;
export function synchroniser({ sources = null } = {}) {
  if (enCours && !sources) return enCours;
  const p = enFile(() => synchroniserVraiment(sources));
  if (!sources) {
    enCours = p;
    const liberer = () => {
      if (enCours === p) enCours = null;
    };
    p.then(liberer, liberer);
  }
  return p;
}

async function synchroniserVraiment(demandees) {
  const ids = (demandees || Object.keys(SOURCES)).filter((id) => estSource(id) && sourceActive(id));
  if (!ids.length) return { ok: false, raison: "source-coupee", sources: {} };
  verifierCle({ lier: true });
  const sortie = { ok: true, sources: {} };
  for (const id of ids) {
    const debut = Date.now();
    try {
      const bilan = await LECTEURS[id]();
      noterLecture(id, { ok: true, bilan, debut });
      sortie.sources[id] = { ok: true, ...bilan, duree: Date.now() - debut };
    } catch (err) {
      if (err instanceof CleDifferente) throw err;
      const erreur = erreurDe(id, err);
      noterLecture(id, { ok: false, bilan: err.bilan || null, erreur, debut });
      sortie.sources[id] = { ok: false, erreur };
      sortie.ok = false;
    }
  }
  return sortie;
}

// --- Lecture pour l'app ------------------------------------------------------------------

const MAISON = os.homedir();
const montrerChemin = (c) => (c.toLowerCase().startsWith(MAISON.toLowerCase()) ? "~" + c.slice(MAISON.length) : c);

// Où Rémy a cherché, dit utilement : chaque base trouvée (et sa sorte), un
// dossier présent mais sans base, un dossier absent ; un profil d'app absent
// n'est pas cité.
function emplacements(id) {
  if (id === SOURCE_CLAUDE) return claude.racinesCandidates().map((r) => ({ origine: r.origine, chemin: montrerChemin(path.join(r.chemin, "projects")), trouve: fs.existsSync(path.join(r.chemin, "projects")) }));
  if (id === SOURCE_T3) {
    const trouvees = t3.bases();
    const sortie = [];
    for (const r of t3.racinesCandidates()) {
      const ici = trouvees.filter((x) => x.racine === r.chemin);
      if (ici.length) {
        for (const x of ici) sortie.push({ origine: `${r.origine} · ${x.version === 2 ? "base V2" : "ancienne base"}`, chemin: montrerChemin(x.fichier), trouve: true });
        continue;
      }
      const present = fs.existsSync(r.chemin);
      if (r.profil && !present) continue;
      sortie.push({ origine: `${r.origine} · ${present ? "présent, aucune base sur 4 niveaux" : "absent"}`, chemin: montrerChemin(r.chemin), trouve: false });
    }
    return sortie;
  }
  const d = dossierImports();
  const lieux = [{ origine: "dossier surveillé", chemin: montrerChemin(d), trouve: fs.existsSync(d) }];
  if (reglagesChatGPT().telechargements) {
    for (const t of dossiersTelechargements()) lieux.push({ origine: "Téléchargements, lecture seule", chemin: montrerChemin(t), trouve: fs.existsSync(t) });
  }
  return lieux;
}

const lireJSON = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// Les conversations d'une source qui sont montrées sous une autre (Claude
// Code mené depuis T3) ne comptent pas deux fois.
// Seulement si le fil de T3 existe vraiment ici, avec des messages : sinon
// la session resterait cachée sans être montrée nulle part (contre-relecture
// du 29/10).
const VISIBLE = `NOT (c.source = '${SOURCE_CLAUDE}' AND lower(c.id) IN (SELECT l.natif FROM liens l LEFT JOIN conversations cl ON cl.source = l.source AND cl.id = l.conversation WHERE l.efface = 1 OR cl.messages > 0))`;

function messageVide(id) {
  if (id === SOURCE_CLAUDE) return { code: "introuvable", message: "Aucune session Claude Code trouvée sur la tour.", quoiFaire: "Lance Claude Code une fois sur la tour, ou indique son dossier dans remy.env (REMY_CLAUDE_DIRS), puis relance l'installeur." };
  if (id === SOURCE_T3) return { code: "introuvable", message: "Aucune base de T3 Code trouvée sur la tour.", quoiFaire: "Ouvre T3 Code une fois sur la tour ; s'il range ses données ailleurs (une autre installation, WSL), indique son dossier dans remy.env (REMY_T3_DIRS), puis relance l'installeur." };
  const dl = reglagesChatGPT().telechargements && dossiersTelechargements().length;
  return {
    code: "rien-importe",
    message: "Aucun export ChatGPT importé.",
    quoiFaire: dl
      ? "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Quand le mail arrive, clique le lien : Rémy prend le .zip dans Téléchargements. Ou envoie-le depuis l'app (Importer)."
      : "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Puis envoie le .zip reçu par mail depuis l'app (Importer), ou dépose-le dans le dossier Imports de ton coffre.",
  };
}

// --- Le diagnostic : pourquoi une source trouvée ne montre rien ------------------------
//
// Les champs de toujours (code / message / quoiFaire) : un iPhone déjà
// installé affiche `message` et `quoiFaire` tels quels, quel que soit le code.
// Les nouveaux codes (aucune-session, ecartees, hors-filtre, format-inconnu,
// sous-t3, base-vide, a-relire) ne changent donc rien pour lui.

const n = (k, un, plusieurs) => (k === 1 ? `1 ${un}` : `${k} ${plusieurs}`);
const QUOI_FAIRE_FILTRE = "Retire REMY_CONNAISSANCES_PROJETS de remy.env (ou ajoute-y un mot du dossier de tes projets), relance l'installeur, puis « Lire maintenant ».";
const QUOI_FAIRE_FORMAT = "Mets Rémy à jour (relance l'installeur) ; si ça persiste, signale-le avec ce que dit scripts\\connaissances-etat.mjs --lire. Rien n'a été modifié chez la source.";
const A_RELIRE = { code: "a-relire", message: "Trouvé sur la tour, pas encore relu depuis la mise à jour de Rémy.", quoiFaire: "« Lire maintenant » (ou attends la prochaine lecture, 30 min au plus)." };

// Ce qui a écarté les sessions de Claude Code, en clair (« 300 hors du filtre… »).
function raisonsClaude(rec, filtre) {
  const e = rec.ecartees || {};
  const p = [];
  if (e.horsFiltre) p.push(`${e.horsFiltre} hors du filtre REMY_CONNAISSANCES_PROJETS${filtre?.length ? ` (« ${filtre.join(", ")} »)` : ""}`);
  if (e.programme) p.push(`${e.programme} d'un seul échange lancée${e.programme > 1 ? "s" : ""} par un programme (claude -p)`);
  if (e.remy) p.push(`${e.remy} de Rémy lui-même`);
  if (e.sansDossier) p.push(`${e.sansDossier} sans dossier de projet`);
  if (rec.vides) p.push(`${rec.vides} sans dialogue`);
  if (rec.illisibles) p.push(`${rec.illisibles} d'un format inconnu`);
  if (rec.erreurs) p.push(`${rec.erreurs} illisible${rec.erreurs > 1 ? "s" : ""} (voir le journal de la tour)`);
  return p;
}

// Des .jsonl rangés plus profond que d'habitude, hors sous-agents : jamais lus.
const phraseAilleurs = (rec) => (rec?.ailleurs ? `${n(rec.ailleurs, "autre fichier .jsonl rangé", "autres fichiers .jsonl rangés")} plus profond que projects\\<dossier>, pas lu${rec.ailleurs > 1 ? "s" : ""}` : null);

// « 312 sessions : 280 lues, 30 d'un seul échange… » (montré sous la source).
function phraseClaude(rec, filtre, masquees) {
  if (!rec?.sessions) return rec?.ailleurs ? `Aucune session ; ${phraseAilleurs(rec)}.` : null;
  const lues = Math.max(0, (rec.gardees || 0) - masquees);
  const p = [lues ? `${lues} lue${lues > 1 ? "s" : ""}` : "aucune lue"];
  if (masquees) p.push(`${masquees} rangée${masquees > 1 ? "s" : ""} sous T3 Code`);
  const ailleurs = phraseAilleurs(rec);
  return `${n(rec.sessions, "session", "sessions")} : ${[...p, ...raisonsClaude(rec, filtre)].join(", ")}.${ailleurs ? ` Et ${ailleurs}.` : ""}`;
}

function aideClaude(bilan, masquees) {
  const rec = bilan?.recensement;
  if (!rec) return A_RELIRE;
  if (!rec.sessions && rec.ailleurs) {
    return { code: "format-inconnu", message: `Aucune session à l'endroit habituel (projects\\<dossier>\\<session>.jsonl), mais ${phraseAilleurs(rec)}.`, quoiFaire: QUOI_FAIRE_FORMAT };
  }
  if (!rec.sessions) {
    return { code: "aucune-session", message: "Le dossier des sessions Claude Code est là, mais il ne contient aucune session.", quoiFaire: "Lance Claude Code une fois sur la tour (terminal, app de bureau ou Remote Control) ; s'il range ses sessions ailleurs, indique le dossier dans remy.env (REMY_CLAUDE_DIRS), puis relance l'installeur." };
  }
  if (masquees && masquees >= (rec.gardees || 0) && rec.gardees) {
    return { code: "sous-t3", message: `${n(rec.sessions, "session trouvée", "sessions trouvées")} : celles qui sont lues ont été menées depuis T3 Code, et sont rangées sous T3 Code.`, quoiFaire: null };
  }
  const raisons = raisonsClaude(rec, bilan.filtre);
  const tout = `${n(rec.sessions, "session trouvée", "sessions trouvées")}, aucune gardée${raisons.length ? ` : ${raisons.join(", ")}` : ""}.`;
  const e = rec.ecartees || {};
  if (e.horsFiltre) return { code: "hors-filtre", message: tout, quoiFaire: QUOI_FAIRE_FILTRE };
  if (rec.illisibles && rec.illisibles + (rec.vides || 0) >= rec.sessions) return { code: "format-inconnu", message: tout, quoiFaire: QUOI_FAIRE_FORMAT };
  if (rec.erreurs && rec.erreurs >= rec.sessions) return { code: "illisible", message: tout, quoiFaire: "Réessaie « Lire maintenant » ; le détail est dans le journal de la tour." };
  return { code: "ecartees", message: tout, quoiFaire: "Rien à faire : seules les vraies conversations sont gardées — une session de plusieurs échanges, d'où qu'elle vienne, est lue." };
}

function raisonsT3(rec, filtre) {
  const p = [];
  if (rec.horsFiltre) p.push(`${rec.horsFiltre} hors du filtre REMY_CONNAISSANCES_PROJETS${filtre?.length ? ` (« ${filtre.join(", ")} »)` : ""}`);
  if (rec.supprimes) p.push(`${rec.supprimes} supprimé${rec.supprimes > 1 ? "s" : ""} dans T3`);
  if (rec.sousAgents) p.push(`${rec.sousAgents} de sous-agents`);
  if (rec.sansMessage) p.push(`${rec.sansMessage} sans message lisible`);
  if (rec.erreurs) p.push(`${n(rec.erreurs, "base illisible", "bases illisibles")}`);
  return p;
}

function phraseT3(bilan) {
  const rec = bilan?.recensement;
  if (!rec?.bases) return null;
  const p = [rec.gardes ? `${rec.gardes} lu${rec.gardes > 1 ? "s" : ""}` : "aucun lu", ...raisonsT3(rec, bilan.filtre)];
  return `${n(rec.bases, "base", "bases")}, ${n(rec.fils || 0, "fil", "fils")} : ${p.join(", ")}.`;
}

function aideT3(bilan) {
  const rec = bilan?.recensement;
  if (!rec || !rec.bases) return A_RELIRE;
  const chemins = (bilan.detail || []).map((d) => d.chemin).join(", ");
  if (!rec.fils) {
    return { code: "base-vide", message: `Base de T3 Code trouvée (${chemins}), mais sans aucun fil.`, quoiFaire: "Si tu utilises T3 Code ailleurs (une autre installation, ou dans WSL), indique son dossier dans remy.env (REMY_T3_DIRS), puis relance l'installeur." };
  }
  const raisons = raisonsT3(rec, bilan.filtre);
  const tout = `${n(rec.fils, "fil trouvé", "fils trouvés")} (${chemins}), aucun gardé${raisons.length ? ` : ${raisons.join(", ")}` : ""}.`;
  if (rec.horsFiltre) return { code: "hors-filtre", message: tout, quoiFaire: QUOI_FAIRE_FILTRE };
  if (rec.sansMessage && rec.sansMessage + (rec.supprimes || 0) + (rec.sousAgents || 0) >= rec.fils) return { code: "format-inconnu", message: tout, quoiFaire: QUOI_FAIRE_FORMAT };
  return { code: "ecartes", message: tout, quoiFaire: null };
}

export function etat() {
  const existe = baseExiste();
  let cle = null;
  let erreurCle = null;
  try {
    const k = cles({ creer: false });
    cle = { origine: k ? k.origine : "a-creer", emplacement: process.env.REMY_CONVERSATIONS_CLE ? "remy.env (REMY_CONVERSATIONS_CLE)" : montrerChemin(fichierCle()) };
    if (k && existe) {
      const controle = lireMeta("cle_controle");
      if (controle && controle !== k.controle) erreurCle = erreurDe(null, new CleDifferente());
    }
  } catch (err) {
    erreurCle = { code: "cle-illisible", message: err.message, quoiFaire: "Vérifie REMY_CONVERSATIONS_CLE dans remy.env (64 caractères hexadécimaux), ou efface le fichier conversations.cle puis « Tout effacer »." };
  }
  const b = existe ? base() : null;
  const sources = Object.entries(SOURCES).map(([id, s]) => {
    const r = b?.prepare("SELECT * FROM sources WHERE id = ?").get(id) || {};
    const compte = b
      ? b.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(c.messages), 0) AS m, MAX(c.fin) AS fin FROM conversations c WHERE c.source = ? AND ${VISIBLE}`).get(id)
      : { n: 0, m: 0, fin: null };
    const bilan = lireJSON(r.bilan);
    const erreur = lireJSON(r.erreur);
    const lieux = emplacements(id);
    const disponible = id === SOURCE_CHATGPT ? true : lieux.some((x) => x.trouve);
    // Les sessions de Claude Code menées depuis T3 : comptées, rangées sous T3.
    const masquees = b && id === SOURCE_CLAUDE ? Number(b.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE c.source = ? AND NOT (${VISIBLE})`).get(id).n) : 0;
    // Rien à montrer : ce n'est pas une panne, mais il faut dire POURQUOI
    // (source absente, rien de lu, tout écarté — et par quoi) et quoi faire.
    let aide = null;
    if (!erreur && !Number(compte.n)) {
      if (id === SOURCE_CHATGPT || !disponible) aide = messageVide(id);
      else if (r.derniere_lecture) aide = id === SOURCE_CLAUDE ? aideClaude(bilan, masquees) : aideT3(bilan);
    }
    const phrase = id === SOURCE_CLAUDE ? phraseClaude(bilan?.recensement, bilan?.filtre, masquees) : id === SOURCE_T3 ? phraseT3(bilan) : null;
    const recensement = bilan?.recensement ? { ...bilan.recensement, ...(id === SOURCE_CLAUDE ? { masquees } : {}), ...(bilan.filtre ? { filtre: bilan.filtre } : {}), phrase } : null;
    return {
      id,
      nom: s.nom,
      actif: sourceActive(id),
      forceParLaTour: ["on", "off"].includes(envSource(id)),
      disponible,
      emplacements: lieux,
      derniereLecture: r.derniere_lecture ?? null,
      derniereReussie: r.derniere_reussie ?? null,
      conversations: Number(compte.n),
      messages: Number(compte.m),
      derniereConversation: compte.fin ?? null,
      bilan,
      erreur,
      aide,
      // Ce que la dernière lecture a vu, toutes sessions confondues (lues,
      // inchangées, écartées et pourquoi), et sa phrase.
      recensement,
    };
  });
  let enAttente = 0;
  try {
    enAttente = exportsDeposes()?.length || 0;
  } catch {}
  let originaux = { fichiers: 0, octets: 0 };
  try {
    originaux = originauxRestants();
  } catch {}
  // L'export ChatGPT : Téléchargements surveillé, et la carte « Exporter
  // ChatGPT » quand le dernier import a plus de RAPPEL_EXPORT_JOURS jours (ou
  // jamais, la source allumée). Un export qui attend déjà dans Imports la fait taire.
  const reglages = reglagesChatGPT();
  const dernierImport = b ? b.prepare("SELECT MAX(a) AS a FROM imports").get().a ?? null : null;
  const aMontrer = reglages.rappel && sourceActive(SOURCE_CHATGPT) && !enAttente && (dernierImport == null || Date.now() - dernierImport > RAPPEL_EXPORT_JOURS * 86_400_000);
  return {
    sources,
    usage: usage(),
    chiffre: true,
    cle: { ...(cle || {}), erreur: erreurCle },
    imports: {
      dossier: montrerChemin(dossierImports()),
      enAttente,
      importes: b ? Number(b.prepare("SELECT COUNT(*) AS n FROM imports").get().n) : 0,
      // Les exports déjà importés, en clair, hors du coffre, jusqu'à leur effacement.
      originaux: { dossier: montrerChemin(dossierOriginaux()), fichiers: originaux.fichiers, octets: originaux.octets, gardeJours: Math.round(gardeOriginauxMs() / 86_400_000) },
    },
    chatgpt: {
      telechargements: {
        actif: reglages.telechargements,
        forceParLaTour: reglages.telechargementsForce,
        dossiers: dossiersTelechargements().map((d) => ({ chemin: montrerChemin(d), trouve: fs.existsSync(d) })),
        joursMax: TELECHARGEMENTS_JOURS,
      },
      rappel: {
        actif: reglages.rappel,
        aMontrer,
        dernierImport,
        depuisJours: dernierImport == null ? null : Math.floor((Date.now() - dernierImport) / 86_400_000),
        seuilJours: RAPPEL_EXPORT_JOURS,
        lien: LIEN_EXPORT_CHATGPT,
      },
    },
    total: {
      conversations: sources.reduce((a, s) => a + s.conversations, 0),
      messages: sources.reduce((a, s) => a + s.messages, 0),
    },
    lectureToutesLesMin: 30,
  };
}

function projetDe(b, id) {
  if (!id) return null;
  const p = b.prepare("SELECT nom FROM projets WHERE id = ?").get(id);
  return p ? { id, nom: dechiffrerOuNull(p.nom, `projet:${id}:nom`) || "Projet" } : null;
}

function resumeConversation(b, c) {
  return {
    source: c.source,
    id: c.id,
    titre: dechiffrerOuNull(c.titre, place(c.source, c.id, "titre")) || "Conversation",
    apercu: dechiffrerOuNull(c.apercu, place(c.source, c.id, "apercu")),
    assistant: c.assistant || SOURCES[c.source]?.assistant || null,
    projet: projetDe(b, c.projet),
    debut: c.debut ?? null,
    fin: c.fin ?? null,
    messages: Number(c.messages || 0),
  };
}

const bornesJour = (jour) => {
  const midi = Date.parse(`${jour}T12:00:00Z`);
  return Number.isFinite(midi) ? [debutJour(midi, TZ), finJour(midi, TZ)] : null;
};

// Les conversations, des plus récentes aux plus anciennes.
export function liste({ source = null, jour = null, projet = null, decalage = 0, limite = 30 } = {}) {
  if (!baseExiste()) return { conversations: [], suite: null, total: 0 };
  const b = base();
  const conds = [VISIBLE];
  const args = [];
  if (source) conds.push("c.source = ?"), args.push(source);
  if (projet) conds.push("c.projet = ?"), args.push(projet);
  if (jour) {
    const bornes = bornesJour(jour);
    if (bornes) {
      conds.push("EXISTS (SELECT 1 FROM messages m WHERE m.source = c.source AND m.conversation = c.id AND m.ts >= ? AND m.ts < ?)");
      args.push(...bornes);
    }
  }
  const lim = Math.max(1, Math.min(100, Number(limite) || 30));
  const dec = Math.max(0, Number(decalage) || 0);
  const ou = conds.join(" AND ");
  const total = Number(b.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE ${ou}`).get(...args).n);
  const lignes = b.prepare(`SELECT * FROM conversations c WHERE ${ou} ORDER BY c.fin DESC, c.id LIMIT ? OFFSET ?`).all(...args, lim, dec);
  return { conversations: lignes.map((c) => resumeConversation(b, c)), suite: dec + lignes.length < total ? dec + lignes.length : null, total };
}

// Les jours qui ont des conversations (pour parcourir par date).
export function jours({ source = null, nombre = 60 } = {}) {
  if (!baseExiste()) return { jours: [] };
  const depuis = Date.now() - Math.max(1, Math.min(400, Number(nombre) || 60)) * 86_400_000;
  const b = base();
  const lignes = b
    .prepare(
      `SELECT m.source, m.conversation, m.ts FROM messages m JOIN conversations c ON c.source = m.source AND c.id = m.conversation
        WHERE m.ts >= ? ${source ? "AND m.source = ?" : ""} AND ${VISIBLE}`,
    )
    .all(...(source ? [depuis, source] : [depuis]));
  const parJour = new Map();
  for (const l of lignes) {
    const j = horodate(l.ts).jour;
    if (!parJour.has(j)) parJour.set(j, new Set());
    parJour.get(j).add(`${l.source}:${l.conversation}`);
  }
  return { jours: [...parJour.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([jour, s]) => ({ jour, conversations: s.size })) };
}

// Une conversation et ses messages (par pages, dans l'ordre de leurs dates).
// La page suivante part du couple (date, identifiant) du dernier message reçu
// (`apres`) : paginer sur l'identifiant seul sautait un message quand deux
// dates se croisent (contre-relecture du 29/10). `autour` : la page qui mène
// à ce message (un résultat de recherche ouvert à sa place), avec
// `cible` et `avant` (il y a des messages plus anciens).
const AVANT_LA_CIBLE = 15;
export function lire(source, id, { apres = 0, limite = 300, autour = null } = {}) {
  if (!baseExiste()) return null;
  const b = base();
  const c = b.prepare("SELECT * FROM conversations c WHERE c.source = ? AND c.id = ?").get(source, id);
  if (!c) return null;
  const lim = Math.max(1, Math.min(1000, Number(limite) || 300));
  const repere = (mid) => b.prepare("SELECT id, COALESCE(ts, 0) AS t FROM messages WHERE source = ? AND conversation = ? AND id = ?").get(source, id, mid);
  let depuis = null; // { t, id } exclu
  let inclus = null; // { t, id } inclus
  let cible = null;
  const r = Number(autour) > 0 ? repere(Number(autour)) : null;
  if (r) {
    cible = r.id;
    const precedents = b
      .prepare(
        `SELECT id, COALESCE(ts, 0) AS t FROM messages WHERE source = ? AND conversation = ? AND (COALESCE(ts, 0) < ? OR (COALESCE(ts, 0) = ? AND id < ?))
          ORDER BY COALESCE(ts, 0) DESC, id DESC LIMIT ?`,
      )
      .all(source, id, r.t, r.t, r.id, AVANT_LA_CIBLE);
    inclus = precedents.at(-1) || r;
  } else if (Number(apres) > 0) {
    depuis = repere(Number(apres)) || null;
  }
  const lignes = inclus
    ? b
        .prepare(
          `SELECT id, uuid, ts, auteur, texte, taille FROM messages WHERE source = ? AND conversation = ? AND (COALESCE(ts, 0) > ? OR (COALESCE(ts, 0) = ? AND id >= ?))
            ORDER BY COALESCE(ts, 0), id LIMIT ?`,
        )
        .all(source, id, inclus.t, inclus.t, inclus.id, lim + 1)
    : depuis
      ? b
          .prepare(
            `SELECT id, uuid, ts, auteur, texte, taille FROM messages WHERE source = ? AND conversation = ? AND (COALESCE(ts, 0) > ? OR (COALESCE(ts, 0) = ? AND id > ?))
              ORDER BY COALESCE(ts, 0), id LIMIT ?`,
          )
          .all(source, id, depuis.t, depuis.t, depuis.id, lim + 1)
      : Number(apres) > 0
        ? // Le repère n'existe plus (relu entre deux pages) : l'ancienne façon.
          b.prepare("SELECT id, uuid, ts, auteur, texte, taille FROM messages WHERE source = ? AND conversation = ? AND id > ? ORDER BY COALESCE(ts, 0), id LIMIT ?").all(source, id, Number(apres), lim + 1)
        : b.prepare("SELECT id, uuid, ts, auteur, texte, taille FROM messages WHERE source = ? AND conversation = ? ORDER BY COALESCE(ts, 0), id LIMIT ?").all(source, id, lim + 1);
  const page = lignes.slice(0, lim);
  const avant = inclus
    ? Boolean(
        b
          .prepare("SELECT 1 FROM messages WHERE source = ? AND conversation = ? AND (COALESCE(ts, 0) < ? OR (COALESCE(ts, 0) = ? AND id < ?)) LIMIT 1")
          .get(source, id, inclus.t, inclus.t, inclus.id),
      )
    : Number(apres) > 0;
  return {
    conversation: resumeConversation(b, c),
    messages: page.map((m) => ({ id: m.id, auteur: m.auteur, ts: m.ts ?? null, texte: dechiffrerOuNull(m.texte, place(source, id, `m:${m.uuid}`)) ?? "(illisible avec la clé actuelle)" })),
    suite: lignes.length > lim ? page.at(-1).id : null,
    ...(cible ? { cible, avant } : {}),
  };
}

// Un extrait autour du premier mot trouvé.
export function extraitAutour(texte, mots, n = 220) {
  const t = String(texte || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const plat = t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let i = -1;
  for (const m of mots) {
    const k = plat.indexOf(m);
    if (k !== -1 && (i === -1 || k < i)) i = k;
  }
  if (i === -1) return couper(t, n);
  // La normalisation NFKD peut décaler les positions : on reste prudent.
  const debut = Math.max(0, Math.min(t.length - n, i - Math.round(n / 3)));
  return (debut > 0 ? "…" : "") + t.slice(debut, debut + n).trim() + (debut + n < t.length ? "…" : "");
}

// Recherche dans le dialogue : les messages qui contiennent le plus de mots
// cherchés, puis les plus récents. Sans IA, sans rien de lisible dans l'index.
export function chercher(q, { source = null, sources = null, limite = 20, depuis = null } = {}) {
  if (!baseExiste()) return [];
  const groupes = jetonsRecherche(q);
  if (!groupes.length) return [];
  const b = base();
  const scores = new Map();
  // Chaque mot pèse selon sa rareté (contre-relecture du 29/10 : « paiement »,
  // présent partout dans une boutique, ne doit pas valoir « Stripe »).
  const poids = new Map();
  const total = Math.max(1, Number(b.prepare("SELECT COUNT(*) AS n FROM messages").get().n));
  let poidsQuestion = 0;
  for (const g of groupes) {
    const req = g.jetons.map((j) => `"${j}"`).join(" OR ");
    const lignes = b.prepare("SELECT rowid AS id FROM index_mots WHERE index_mots MATCH ?").all(req);
    const idf = Math.log(1 + total / Math.max(1, lignes.length));
    poidsQuestion += idf;
    for (const r of lignes) {
      scores.set(r.id, (scores.get(r.id) || 0) + 1);
      poids.set(r.id, (poids.get(r.id) || 0) + idf);
    }
  }
  if (!scores.size) return [];
  const minimum = groupes.length >= 3 ? 2 : 1;
  const ids = [...scores.entries()].filter(([, s]) => s >= minimum).map(([id]) => id);
  if (!ids.length) return [];
  const lignes = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    lignes.push(
      ...b
        .prepare(
          `SELECT m.id, m.source, m.conversation, m.uuid, m.ts, m.auteur, m.texte, c.titre, c.projet, c.id AS cid
             FROM messages m JOIN conversations c ON c.source = m.source AND c.id = m.conversation
            WHERE m.id IN (${part.map(() => "?").join(",")}) ${source ? "AND m.source = ?" : ""} ${depuis ? "AND m.ts >= ?" : ""} AND ${VISIBLE}`,
        )
        .all(...part, ...(source ? [source] : []), ...(depuis ? [depuis] : [])),
    );
  }
  const gardees = sources?.length ? lignes.filter((l) => sources.includes(l.source)) : lignes;
  gardees.sort((a, b2) => poids.get(b2.id) - poids.get(a.id) || (b2.ts || 0) - (a.ts || 0));
  const mots = groupes.map((g) => g.mot);
  return gardees.slice(0, Math.max(1, Math.min(50, Number(limite) || 20))).map((l) => {
    const texte = dechiffrerOuNull(l.texte, place(l.source, l.conversation, `m:${l.uuid}`)) || "";
    return {
      source: l.source,
      conversation: l.conversation,
      titre: dechiffrerOuNull(l.titre, place(l.source, l.cid, "titre")) || "Conversation",
      projet: projetDe(b, l.projet),
      message: l.id,
      auteur: l.auteur,
      ts: l.ts ?? null,
      score: scores.get(l.id),
      extrait: extraitAutour(texte, mots),
      texte,
      // Pour Rémy (usage.js) : le poids des mots trouvés, et la part de la
      // question qu'ils couvrent (jamais renvoyés par la route).
      poids: poids.get(l.id),
      couverture: poidsQuestion ? poids.get(l.id) / poidsQuestion : 0,
    };
  });
}

// Les messages d'une période (la nuit relit la veille).
export function messagesEntre(debut, fin, { limite = 4000 } = {}) {
  if (!baseExiste()) return [];
  const b = base();
  const lignes = b
    .prepare(
      `SELECT m.source, m.conversation, m.uuid, m.ts, m.auteur, m.texte, c.titre, c.assistant
         FROM messages m JOIN conversations c ON c.source = m.source AND c.id = m.conversation
        WHERE m.ts >= ? AND m.ts < ? AND ${VISIBLE} ORDER BY m.ts, m.id LIMIT ?`,
    )
    .all(debut, fin, limite);
  return lignes.map((l) => ({
    source: l.source,
    conversation: l.conversation,
    titre: dechiffrerOuNull(l.titre, place(l.source, l.conversation, "titre")) || "Conversation",
    assistant: l.assistant || SOURCES[l.source]?.assistant,
    ts: l.ts,
    auteur: l.auteur,
    texte: dechiffrerOuNull(l.texte, place(l.source, l.conversation, `m:${l.uuid}`)) || "",
  }));
}

// Les noms de projets connus (pour reconnaître une question qui en parle).
export function nomsDeProjets() {
  if (!baseExiste()) return [];
  const b = base();
  return b
    .prepare("SELECT id, nom FROM projets")
    .all()
    .map((p) => dechiffrerOuNull(p.nom, `projet:${p.id}:nom`))
    .filter(Boolean);
}

// --- Effacer ----------------------------------------------------------------------------------

// Tout ce qui vient d'une source : messages, conversations, curseurs, liens,
// imports, et les résumés de nuit qui s'en servaient. La source est coupée
// (sinon la lecture suivante remettrait tout). Les originaux ne sont pas touchés.
export function purger(id) {
  if (!estSource(id)) throw new Error("Source inconnue");
  return enFile(() => {
    transaction((t) => {
      t.prepare("DELETE FROM messages WHERE source = ?").run(id);
      t.prepare("DELETE FROM conversations WHERE source = ?").run(id);
      t.prepare("DELETE FROM curseurs WHERE source = ?").run(id);
      t.prepare("DELETE FROM liens WHERE source = ?").run(id);
      // Les exports déjà vus dans Téléchargements aussi : rallumée, la source
      // reprend celui qui y est encore (comme Claude Code et T3 relisent tout).
      if (id === SOURCE_CHATGPT) {
        t.prepare("DELETE FROM imports").run();
        t.prepare("DELETE FROM meta WHERE cle = 'telechargements_vus'").run();
      }
      t.prepare("DELETE FROM digests WHERE sources IS NULL OR sources LIKE ?").run(`%"${id}"%`);
      t.prepare("DELETE FROM projets WHERE id NOT IN (SELECT DISTINCT projet FROM conversations WHERE projet IS NOT NULL)").run();
      t.prepare("UPDATE sources SET bilan = NULL, erreur = NULL, derniere_reussie = NULL WHERE id = ?").run(id);
    });
    reglerSource(id, false);
    compacter();
    return etat();
  });
}

// Tout, y compris le lien avec la clé (clé changée ou perdue). Les réglages
// des sources sont gardés.
export function toutEffacer() {
  return enFile(() => {
    transaction((t) => {
      for (const table of ["messages", "conversations", "curseurs", "liens", "imports", "digests", "projets", "journal"]) t.prepare(`DELETE FROM ${table}`).run();
      t.prepare("DELETE FROM meta WHERE cle IN ('cle_controle', 'telechargements_vus')").run();
      t.prepare("UPDATE sources SET bilan = NULL, erreur = NULL, derniere_reussie = NULL, derniere_lecture = NULL").run();
    });
    compacter();
    return etat();
  });
}

export { cheminConnaissances };
// Utile aux tests et au script de la tour : les mots d'une question.
export { motsDe };
