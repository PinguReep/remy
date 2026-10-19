// La base SQLite de Rémy (Lot 0, J0.6) : `<base>/remy.db`.
//
// Pourquoi SQLite (décision D1 du plan technique) : des transactions, une clé
// unique qui rend une écriture idempotente, une sauvegarde à chaud cohérente
// (VACUUM INTO) — ce que des fichiers JSON réécrits en entier ne donnent pas.
// `node:sqlite` est intégré à Node (≥ 22.13) : aucune dépendance de plus.
//
// Ici vivent les nouveautés du Lot 0 : la chaîne d'écriture (commandes,
// journal, état des propositions), les jobs et les appareils. Les données
// historiques (conversations, mémoire…) restent dans leurs fichiers JSON tant
// que leur bascule n'a pas été validée par Sam (plan, §6).
//
// Tout accès passe par ce module : si `node:sqlite` change, on ne change qu'ici.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dossierBase } from "./store.js";

const require = createRequire(import.meta.url);

export class BaseSqliteIndisponible extends Error {
  constructor(cause) {
    super(`Base SQLite indisponible (${cause}) : Node 22.13 ou plus est nécessaire (node --version).`);
    this.code = "SQLITE_INDISPONIBLE";
  }
}

// Migrations numérotées, en avant seulement. Une migration publiée ne se
// modifie jamais : on en ajoute une.
export const MIGRATIONS = [
  {
    version: 1,
    nom: "socle du Lot 0 : écriture, journal, jobs, appareils",
    sql: `
      CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);

      -- Une commande = une intention d'écrire, identifiée par son id (clé
      -- d'idempotence) : la rejouer rend le même résultat, jamais deux effets.
      CREATE TABLE IF NOT EXISTS commandes (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,              -- motion | agenda
        origine TEXT,                      -- chat | tap | annulation | …
        proposition_id TEXT,
        etat TEXT NOT NULL,                -- en_cours | appliquee | appliquee_partiellement | echouee
        journal_id TEXT,
        resultat TEXT,                     -- JSON rendu au client
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );

      -- Le journal des écritures : ouvert AVANT l'effet, complété après.
      CREATE TABLE IF NOT EXISTS journal (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        origine TEXT,
        resume TEXT,
        commande_id TEXT,
        proposition_id TEXT,
        conv_id TEXT,
        etat TEXT NOT NULL,                -- en_cours | appliquee | appliquee_partiellement | echouee | annulee | annulation_partielle
        actions TEXT,                      -- JSON
        results TEXT,                      -- JSON : un résultat par action (avant, après, id…)
        annulations TEXT,                  -- JSON : { index: {ok, erreur, quoi} }
        annule INTEGER NOT NULL DEFAULT 0,
        annule_a INTEGER,
        erreur TEXT,
        maj_a INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS journal_ts ON journal(ts DESC);

      -- L'état d'une proposition de Rémy, qui FAIT FOI : la conversation n'en
      -- garde qu'une copie, qu'une réponse en cours pouvait écraser.
      CREATE TABLE IF NOT EXISTS propositions (
        id TEXT PRIMARY KEY,
        conv_id TEXT,
        source TEXT,
        statut TEXT NOT NULL,              -- en_attente | applique | refuse | echec
        journal_id TEXT,
        bilan TEXT,                        -- JSON
        annulee INTEGER NOT NULL DEFAULT 0,
        annulation_ratee TEXT,             -- JSON [{nom, erreur}]
        maj_a INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        circuit TEXT NOT NULL,
        cle TEXT,
        priorite INTEGER NOT NULL DEFAULT 5,
        etat TEXT NOT NULL,                -- attente | en_cours | fait | abandonne | perime
        entree TEXT,
        resultat TEXT,
        erreur TEXT,
        tentatives INTEGER NOT NULL DEFAULT 0,
        max_tentatives INTEGER NOT NULL DEFAULT 5,
        delai_max_ms INTEGER NOT NULL DEFAULT 600000,
        prochain_essai_a INTEGER NOT NULL,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_cle ON jobs(cle) WHERE cle IS NOT NULL;
      CREATE INDEX IF NOT EXISTS jobs_a_faire ON jobs(etat, prochain_essai_a);

      CREATE TABLE IF NOT EXISTS appareils (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        empreinte TEXT NOT NULL UNIQUE,    -- SHA-256 du jeton : le jeton lui-même n'est jamais gardé
        cree_a INTEGER NOT NULL,
        vu_a INTEGER,
        revoque_a INTEGER
      );
    `,
  },
  {
    version: 2,
    nom: "Lot 1 : listes, rappels, état des tâches (bloquée)",
    sql: `
      -- Les identifiants viennent de l'iPhone : une écriture rejouée après une
      -- coupure retombe sur la même ligne (upsert), jamais en double.
      CREATE TABLE IF NOT EXISTS listes (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        ordre INTEGER NOT NULL DEFAULT 0,
        supprimee INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS elements_liste (
        id TEXT PRIMARY KEY,
        liste_id TEXT NOT NULL,
        texte TEXT NOT NULL,
        fait INTEGER NOT NULL DEFAULT 0,
        ordre INTEGER NOT NULL DEFAULT 0,
        supprime INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS elements_par_liste ON elements_liste(liste_id, ordre);

      CREATE TABLE IF NOT EXISTS rappels (
        id TEXT PRIMARY KEY,
        texte TEXT NOT NULL,
        quand INTEGER,                     -- ms ; NULL : sans date
        fait INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'remy', -- remy | apple (importé)
        supprime INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );

      -- Ce que Motion ne sait pas d'une tâche (D12) : vit dans Remy.
      CREATE TABLE IF NOT EXISTS etats_taches (
        tache_id TEXT PRIMARY KEY,
        bloquee INTEGER NOT NULL DEFAULT 0,
        raison TEXT,
        depuis INTEGER,
        maj_a INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    nom: "Lot 1 : instantanés (Motion, conseil), tâche commencée, activité faite",
    sql: `
      -- La dernière liste lue d'un service lent ou limité (Motion : 12 req/min),
      -- gardée telle quelle avec son heure : après une coupure ou un
      -- redémarrage, Sam voit ses tâches tout de suite, datées.
      CREATE TABLE IF NOT EXISTS instantanes (
        cle TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        lu_a INTEGER NOT NULL
      );
      -- « Commencer maintenant » (l'API Motion ne sait pas avancer une tâche)
      -- et « c'est fait » pour une activité de l'agenda : vivent dans Remy.
      ALTER TABLE etats_taches ADD COLUMN commencee_a INTEGER;
      ALTER TABLE etats_taches ADD COLUMN fait_a INTEGER;
    `,
  },
  {
    version: 4,
    nom: "Lot 1 : étiquettes des rappels, sous-projets et notes (dans Remy)",
    sql: `
      -- Les étiquettes de Sam (Santé, Voiture…) : libres, renommables.
      CREATE TABLE IF NOT EXISTS etiquettes (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        ordre INTEGER NOT NULL DEFAULT 0,
        supprimee INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      ALTER TABLE rappels ADD COLUMN etiquettes TEXT; -- JSON : identifiants d'étiquettes

      -- Sous-projets, catégories, dossiers : l'API Motion n'a pas de hiérarchie.
      -- parent : NULL (racine), « motion:<id> » (sous un projet Motion) ou un dossier.
      CREATE TABLE IF NOT EXISTS dossiers (
        id TEXT PRIMARY KEY,
        nom TEXT NOT NULL,
        parent TEXT,
        projet_motion TEXT,
        ordre INTEGER NOT NULL DEFAULT 0,
        supprime INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      -- Les idées et notes d'un dossier : sans agenda, sans Motion.
      CREATE TABLE IF NOT EXISTS notes_dossier (
        id TEXT PRIMARY KEY,
        dossier TEXT NOT NULL,
        texte TEXT NOT NULL,
        fait INTEGER NOT NULL DEFAULT 0,
        supprime INTEGER NOT NULL DEFAULT 0,
        cree_a INTEGER NOT NULL,
        maj_a INTEGER NOT NULL
      );
      -- Une tâche Motion rangée dans un sous-projet de Remy.
      CREATE TABLE IF NOT EXISTS rattachements (
        tache_id TEXT PRIMARY KEY,
        dossier TEXT NOT NULL,
        maj_a INTEGER NOT NULL
      );
    `,
  },
  {
    version: 5,
    nom: "Lot 1 : propositions ajustées avant validation, catégories des tâches",
    sql: `
      -- Sam ajuste une proposition de Rémy (date, durée, catégorie…) avant de
      -- dire oui : la version ajustée est celle qui sera appliquée. La
      -- conversation garde l'originale.
      CREATE TABLE IF NOT EXISTS ajustements (
        proposition_id TEXT PRIMARY KEY,
        actions TEXT NOT NULL,             -- JSON : les actions ajustées
        convertis INTEGER NOT NULL DEFAULT 0,
        maj_a INTEGER NOT NULL
      );
      -- La catégorie d'une tâche Motion (mêmes étiquettes que les rappels) :
      -- gardée dans Remy, comme les sous-projets.
      CREATE TABLE IF NOT EXISTS categories_taches (
        tache_id TEXT PRIMARY KEY,
        etiquettes TEXT NOT NULL,          -- JSON : identifiants d'étiquettes
        maj_a INTEGER NOT NULL
      );
    `,
  },
];

let ouverte = null;
let cheminOuvert = null;

export const cheminBase = () => path.join(dossierBase(), "remy.db");

function chargerSqlite() {
  try {
    return require("node:sqlite");
  } catch (err) {
    throw new BaseSqliteIndisponible(err.code || err.message);
  }
}

// La base, ouverte une fois et migrée. Une erreur ici est grave et DITE : la
// chaîne d'écriture refuse d'écrire sans journal.
export function db() {
  const chemin = cheminBase();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermer(); // une autre base était ouverte (changement de coffre) : jamais deux poignées
  const { DatabaseSync } = chargerSqlite();
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const existait = fs.existsSync(chemin);
  const base = new DatabaseSync(chemin);
  try {
    base.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    migrer(base, chemin, existait);
  } catch (err) {
    // Une migration ratée ne garde pas le fichier ouvert (verrouillé sous
    // Windows : ni restauration ni nouvel essai ne seraient possibles).
    try {
      base.close();
    } catch {}
    throw err;
  }
  ouverte = base;
  cheminOuvert = chemin;
  return base;
}

export function versionSchema(base = db()) {
  try {
    const v = base.prepare("SELECT valeur FROM meta WHERE cle = 'schema'").get();
    return v ? Number(v.valeur) : 0;
  } catch {
    return 0;
  }
}

function migrer(base, chemin, existait) {
  const actuelle = versionSchema(base);
  const aFaire = MIGRATIONS.filter((m) => m.version > actuelle);
  if (!aFaire.length) return;
  // Une base qui a déjà vécu est copiée AVANT de changer de forme : un retour
  // arrière reste possible même si une migration se passe mal.
  if (existait && actuelle > 0) {
    const dossier = path.join(path.dirname(chemin), "migrations");
    fs.mkdirSync(dossier, { recursive: true });
    const copie = path.join(dossier, `remy-avant-v${aFaire[0].version}-${Date.now()}.db`);
    base.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`);
    // Les 3 dernières suffisent : les sauvegardes complètes gardent le reste.
    const copies = fs.readdirSync(dossier).filter((n) => n.startsWith("remy-avant-v")).sort((a, b) => fs.statSync(path.join(dossier, b)).mtimeMs - fs.statSync(path.join(dossier, a)).mtimeMs);
    for (const n of copies.slice(3)) fs.rmSync(path.join(dossier, n), { force: true });
  }
  for (const m of aFaire) {
    base.exec("BEGIN IMMEDIATE");
    try {
      base.exec(m.sql);
      base.prepare("INSERT INTO meta (cle, valeur) VALUES ('schema', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(String(m.version));
      base.exec("COMMIT");
    } catch (err) {
      base.exec("ROLLBACK");
      throw new Error(`Migration ${m.version} (« ${m.nom} ») échouée : ${err.message}`);
    }
  }
  importerAncienJournal(base);
}

// Le journal d'avant le Lot 0 (ledger.json) entre dans la base, une fois et
// sans doublon (même id = ignoré). Le fichier reste en place, en archive.
function importerAncienJournal(base) {
  const fichier = path.join(dossierBase(), "ledger.json");
  let liste;
  try {
    liste = JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch {
    return;
  }
  if (!Array.isArray(liste)) return;
  const ins = base.prepare(`
    INSERT OR IGNORE INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, annule, annule_a, maj_a)
    VALUES (?, ?, ?, 'avant-lot-0', ?, ?, ?, ?, '{}', ?, ?, ?)`);
  for (const e of liste) {
    if (!e?.id) continue;
    const ok = (e.results || []).filter((r) => r.ok).length;
    const etat = e.annule ? "annulee" : ok === (e.results || []).length ? "appliquee" : ok ? "appliquee_partiellement" : "echouee";
    ins.run(
      String(e.id),
      Number(e.ts) || Date.now(),
      e.source === "agenda" ? "agenda" : "motion",
      String(e.resume || ""),
      etat,
      JSON.stringify(e.actions || []),
      JSON.stringify(e.results || []),
      e.annule ? 1 : 0,
      e.annuleAt || null,
      Date.now(),
    );
  }
}

// Une transaction courte : tout ou rien.
export function transaction(fn) {
  const base = db();
  base.exec("BEGIN IMMEDIATE");
  try {
    const r = fn(base);
    base.exec("COMMIT");
    return r;
  } catch (err) {
    base.exec("ROLLBACK");
    throw err;
  }
}

// Copie cohérente de la base, même pendant qu'elle travaille (sauvegardes).
export function copieAChaud(destination) {
  const base = db();
  fs.rmSync(destination, { force: true });
  base.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  return destination;
}

export function fermer() {
  if (ouverte) {
    try {
      ouverte.close();
    } catch {}
  }
  ouverte = null;
  cheminOuvert = null;
}

// JSON en colonne : lu sans jamais planter sur une valeur vide.
export const lireJSON = (v, defaut = null) => {
  if (v === null || v === undefined || v === "") return defaut;
  try {
    return JSON.parse(v);
  } catch {
    return defaut;
  }
};
