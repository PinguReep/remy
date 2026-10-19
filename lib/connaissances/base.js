// La base de la mémoire de projets : `<base>/connaissances.db`, séparée de
// remy.db (elle peut grossir, se purger et se reconstruire sans toucher à la
// chaîne d'écriture ni à la mémoire personnelle).
//
// Lot B : les sources et leurs curseurs, les projets vus, les conversations
// et le dialogue masqué (passages), avec un index plein texte (FTS5, sans
// accents). Lot C y ajoutera les connaissances extraites et leurs preuves.

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
      -- L'accord par source (faux par défaut) et ses réglages.
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,            -- claude-code
        actif INTEGER NOT NULL DEFAULT 0,
        maj_a INTEGER
      );
      -- Un fichier de session lu : où en est la lecture.
      CREATE TABLE IF NOT EXISTS fichiers (
        chemin TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        session TEXT,
        projet TEXT,
        curseur TEXT,                   -- JSON { ino, offset, taille, empreinte, etat }
        exclu TEXT,                     -- raison, ou NULL
        lu_a INTEGER
      );
      CREATE TABLE IF NOT EXISTS projets (
        id TEXT PRIMARY KEY,            -- p-xxxxxxxxxx (empreinte du dossier)
        racine TEXT NOT NULL,           -- dossier normalisé (reste sur la tour)
        nom TEXT NOT NULL,
        premiere INTEGER,
        derniere INTEGER
      );
      CREATE TABLE IF NOT EXISTS conversations (
        moteur TEXT NOT NULL,
        id TEXT NOT NULL,               -- sessionId
        projet TEXT,
        premiere INTEGER,
        derniere INTEGER,
        PRIMARY KEY (moteur, id)
      );
      CREATE TABLE IF NOT EXISTS passages (
        id INTEGER PRIMARY KEY,
        moteur TEXT NOT NULL,
        session TEXT NOT NULL,
        uuid TEXT NOT NULL,
        parent TEXT,
        projet TEXT,
        ts INTEGER,
        auteur TEXT NOT NULL,           -- utilisateur | colle | assistant | resume
        texte TEXT NOT NULL,            -- masqué
        UNIQUE (moteur, session, uuid)
      );
      CREATE INDEX IF NOT EXISTS passages_projet ON passages (projet, ts);
      CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
        texte, content='passages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
        INSERT INTO passages_fts (rowid, texte) VALUES (new.id, new.texte);
      END;
      CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
        INSERT INTO passages_fts (passages_fts, rowid, texte) VALUES ('delete', old.id, old.texte);
      END;
      -- Chaque synchronisation : quand, combien, et pourquoi elle a échoué.
      CREATE TABLE IF NOT EXISTS journal_sync (
        id INTEGER PRIMARY KEY,
        debut INTEGER NOT NULL,
        fin INTEGER,
        source TEXT NOT NULL,
        bilan TEXT                      -- JSON (compteurs, jamais de contenu)
      );
    `,
  },
];

let ouverte = null;
let cheminOuvert = null;

export const cheminConnaissances = () => path.join(dossierBase(), "connaissances.db");

export function base() {
  const chemin = cheminConnaissances();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermer();
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const b = new DatabaseSync(chemin);
  try {
    b.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
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
    }
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

// Une requête plein texte sûre : chaque mot devient un terme entre guillemets
// (aucune syntaxe FTS5 venue de l'utilisateur), préfixe autorisé.
export function requeteFts(q) {
  const mots = String(q || "")
    .normalize("NFC")
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((m) => m.length >= 2)
    .slice(0, 12);
  return mots.map((m) => `"${m.replace(/"/g, "")}"*`).join(" ");
}
