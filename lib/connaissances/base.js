// La base des conversations externes : `<base>/connaissances.db`, séparée de
// remy.db (elle peut grossir, se purger et se reconstruire sans toucher à la
// chaîne d'écriture ni à la mémoire personnelle).
//
// v1 (lot B, 19/10) : les passages des sessions Claude Code, EN CLAIR, avec un
// index plein texte lisible.
// v2 (29/10) : trois sources (Claude Code, T3 Code, ChatGPT), tout le contenu
// chiffré (lib/connaissances/chiffre.js) et un index d'empreintes. Passer en
// v2 efface les tables de la v1 (puis VACUUM, pour que leurs pages en clair
// quittent le disque) : les sessions d'origine sont relues.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dossierBase } from "../store.js";

const require = createRequire(import.meta.url);

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);
    `,
  },
  {
    version: 2,
    vacuum: true,
    sql: `
      DROP TRIGGER IF EXISTS passages_ai;
      DROP TRIGGER IF EXISTS passages_ad;
      DROP TABLE IF EXISTS passages_fts;
      DROP TABLE IF EXISTS passages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS projets;
      DROP TABLE IF EXISTS fichiers;
      DROP TABLE IF EXISTS journal_sync;
      DROP TABLE IF EXISTS sources;

      -- Une source : son réglage (NULL = par défaut), sa dernière lecture et
      -- son erreur (JSON { code, message, quoiFaire }), jamais de contenu.
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        actif INTEGER,
        maj_a INTEGER,
        derniere_lecture INTEGER,
        derniere_reussie INTEGER,
        bilan TEXT,
        erreur TEXT
      );
      -- Où en est la lecture de chaque fichier ou base (clé : empreinte du chemin).
      CREATE TABLE curseurs (
        cle TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        conversation TEXT,
        valeur TEXT,
        exclu TEXT,
        lu_a INTEGER
      );
      CREATE TABLE projets (
        id TEXT PRIMARY KEY,
        racine BLOB,
        nom BLOB,
        premiere INTEGER,
        derniere INTEGER
      );
      CREATE TABLE conversations (
        source TEXT NOT NULL,
        id TEXT NOT NULL,
        projet TEXT,
        titre BLOB,
        apercu BLOB,
        assistant TEXT,
        debut INTEGER,
        fin INTEGER,
        messages INTEGER NOT NULL DEFAULT 0,
        version TEXT,
        maj_a INTEGER,
        PRIMARY KEY (source, id)
      );
      CREATE INDEX conversations_fin ON conversations (fin);
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        conversation TEXT NOT NULL,
        uuid TEXT NOT NULL,
        ts INTEGER,
        auteur TEXT NOT NULL,
        texte BLOB NOT NULL,
        taille INTEGER NOT NULL DEFAULT 0,
        UNIQUE (source, conversation, uuid)
      );
      CREATE INDEX messages_conv ON messages (source, conversation, ts);
      CREATE INDEX messages_ts ON messages (ts);
      -- Les empreintes des mots de chaque message (sans positions).
      CREATE VIRTUAL TABLE index_mots USING fts5(jetons, content='', contentless_delete=1, detail=none);
      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM index_mots WHERE rowid = old.id;
      END;
      -- Une session Claude Code menée depuis T3 Code : elle n'apparaît qu'une
      -- fois, sous T3 (natif = identifiant de session Claude, en minuscules).
      CREATE TABLE liens (
        natif TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        conversation TEXT NOT NULL
      );
      -- Les exports ChatGPT déjà importés (empreinte du fichier).
      CREATE TABLE imports (
        empreinte TEXT PRIMARY KEY,
        a INTEGER NOT NULL,
        octets INTEGER,
        bilan TEXT
      );
      -- Ce que la nuit a tiré des conversations d'un jour (chiffré).
      CREATE TABLE digests (
        jour TEXT PRIMARY KEY,
        cree_a INTEGER NOT NULL,
        sources TEXT,
        contenu BLOB NOT NULL
      );
      -- Chaque lecture : quand, quelle source, combien (jamais de contenu).
      CREATE TABLE journal (
        id INTEGER PRIMARY KEY,
        debut INTEGER NOT NULL,
        fin INTEGER,
        source TEXT NOT NULL,
        bilan TEXT
      );
    `,
  },
  {
    // v3 (contre-relecture du 29/10) : la version d'un message à sa source
    // (date de mise à jour chez T3) — un message relu sans changement n'est
    // ni rechiffré ni réindexé ; et un lien vers un fil de T3 que tu as
    // effacé (sa session Claude reste alors cachée, comme tu l'as voulu).
    version: 3,
    sql: `ALTER TABLE messages ADD COLUMN version TEXT;
          ALTER TABLE liens ADD COLUMN efface INTEGER;`,
  },
];

export const VERSION_SCHEMA = MIGRATIONS.at(-1).version;

let ouverte = null;
let cheminOuvert = null;

export const cheminConnaissances = () => path.join(dossierBase(), "connaissances.db");
export const baseExiste = () => fs.existsSync(cheminConnaissances());

export function base() {
  const chemin = cheminConnaissances();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermer();
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const b = new DatabaseSync(chemin);
  let vider = false;
  try {
    // secure_delete : une ligne effacée est mise à zéro sur le disque.
    b.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON;");
    b.exec("CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);");
    const v = Number(b.prepare("SELECT valeur FROM meta WHERE cle = 'schema'").get()?.valeur || 0);
    for (const m of MIGRATIONS.filter((x) => x.version > v)) {
      b.exec("BEGIN");
      try {
        b.exec(m.sql);
        b.prepare("INSERT INTO meta (cle, valeur) VALUES ('schema', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(String(m.version));
        b.exec("COMMIT");
      } catch (err) {
        b.exec("ROLLBACK");
        throw err;
      }
      if (m.vacuum && v > 0) vider = true;
    }
    if (vider) b.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (err) {
    try {
      b.close();
    } catch {}
    throw err;
  }
  ouverte = b;
  cheminOuvert = chemin;
  return b;
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

export function transaction(fn) {
  const b = base();
  b.exec("BEGIN");
  try {
    const r = fn(b);
    b.exec("COMMIT");
    return r;
  } catch (err) {
    b.exec("ROLLBACK");
    throw err;
  }
}

export function lireMeta(cle) {
  return base().prepare("SELECT valeur FROM meta WHERE cle = ?").get(cle)?.valeur ?? null;
}

export function ecrireMeta(cle, valeur) {
  base()
    .prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
    .run(cle, valeur == null ? null : String(valeur));
}

// Après une purge : les pages libérées repartent du fichier.
export function compacter() {
  try {
    base().exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (err) {
    console.warn(`Conversations externes : compactage de la base remis à plus tard (${err.code || err.message})`);
  }
}
