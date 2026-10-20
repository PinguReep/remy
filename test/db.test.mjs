// Base SQLite (Lot 0, J0.6) :
//   - créée et migrée au premier accès (schéma versionné) ;
//   - l'ancien journal (ledger.json) y entre une fois, sans doublon ;
//   - une base qui a vécu est copiée AVANT une nouvelle migration ;
//   - une transaction ratée ne laisse rien ;
//   - les sauvegardes emportent une copie cohérente de la base, jamais ses
//     fichiers en cours d'écriture (WAL).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-db-"));
const coffre = path.join(racine, "coffre");
const base = path.join(coffre, ".remy");
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_DATA_DIR", "MOTION_API_KEY", "VERCEL"]) delete process.env[v];
process.env.REMY_VAULT = coffre;
process.env.REMY_SAUVEGARDES = path.join(racine, "sauvegardes");
const CLE = crypto.randomBytes(32).toString("hex");
process.env.REMY_SAUVEGARDE_CLE = CLE;

// Un ancien journal, d'avant le Lot 0.
fs.mkdirSync(base, { recursive: true });
fs.writeFileSync(
  path.join(base, "ledger.json"),
  JSON.stringify([
    { id: "l1", ts: 1000, source: "motion", resume: "Créer A", actions: [{ type: "creer", nom: "A" }], results: [{ ok: true, type: "creer", nom: "A", taskId: "t1" }] },
    { id: "l2", ts: 2000, source: "agenda", resume: "RDV", actions: [], results: [{ ok: true, titre: "Dentiste", eventId: "e1" }], annule: true, annuleAt: 3000 },
  ]),
);

const dbm = await import("../lib/db.js");
const sv = await import("../lib/sauvegarde.js");

test.after(() => {
  dbm.fermer();
  fs.rmSync(racine, { recursive: true, force: true });
});

const DERNIERE = dbm.MIGRATIONS.at(-1).version;

test("créée et migrée au premier accès ; l'ancien journal importé une fois", () => {
  const d = dbm.db();
  assert.equal(dbm.versionSchema(d), DERNIERE);
  const lignes = d.prepare("SELECT id, source, etat, annule FROM journal ORDER BY ts").all();
  assert.deepEqual(lignes.map((l) => [l.id, l.source, l.etat, l.annule]), [
    ["l1", "motion", "appliquee", 0],
    ["l2", "agenda", "annulee", 1],
  ]);
  // Réouverte : rien n'est importé deux fois.
  dbm.fermer();
  assert.equal(dbm.db().prepare("SELECT COUNT(*) AS n FROM journal").get().n, 2);
  // Le fichier d'origine reste en place, en archive.
  assert.ok(fs.existsSync(path.join(base, "ledger.json")));
});

test("une base qui a vécu est copiée avant une nouvelle migration", () => {
  const v = DERNIERE + 1;
  dbm.MIGRATIONS.push({ version: v, nom: "essai", sql: "CREATE TABLE essai (x INTEGER);" });
  try {
    dbm.fermer();
    const d = dbm.db();
    assert.equal(dbm.versionSchema(d), v);
    const copies = fs.readdirSync(path.join(base, "migrations"));
    assert.equal(copies.length, 1);
    assert.match(copies[0], new RegExp(`^remy-avant-v${v}-\\d+\\.db$`));
  } finally {
    dbm.MIGRATIONS.pop();
  }
});

test("une migration qui échoue ne laisse rien à moitié", () => {
  const v = DERNIERE + 2;
  dbm.MIGRATIONS.push({ version: v, nom: "cassée", sql: "CREATE TABLE ok3 (x INTEGER); CREATE TABLE ok3 (x INTEGER);" });
  try {
    dbm.fermer();
    assert.throws(() => dbm.db(), new RegExp(`Migration ${v} .* échouée`));
    dbm.fermer();
  } finally {
    dbm.MIGRATIONS.pop();
  }
  const d = dbm.db();
  assert.equal(dbm.versionSchema(d), DERNIERE + 1);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ok3'").get().n, 0);
});

test("transaction : tout ou rien", () => {
  assert.throws(() =>
    dbm.transaction((d) => {
      d.prepare("INSERT INTO meta (cle, valeur) VALUES ('t1', 'x')").run();
      throw new Error("boum");
    }),
  );
  assert.equal(dbm.db().prepare("SELECT COUNT(*) AS n FROM meta WHERE cle = 't1'").get().n, 0);
});

test("sauvegarde : une copie cohérente de la base, jamais ses fichiers en cours d'écriture", async () => {
  dbm.db().prepare("INSERT INTO meta (cle, valeur) VALUES ('preuve', 'sauvegardee')").run();
  const r = await sv.sauvegarderRemy({ raison: "test" });
  assert.equal(r.copies[0].ok, true);
  const { fichiers } = sv.lireArchive(fs.readFileSync(r.copies[0].fichier), { cle: Buffer.from(CLE, "hex") });
  const chemins = fichiers.map((f) => f.chemin);
  assert.ok(chemins.includes("base/remy.db"));
  assert.ok(!chemins.some((c) => c.endsWith("-wal") || c.endsWith("-shm")));
  // La copie restaurée s'ouvre et contient la donnée.
  const vers = path.join(racine, "restauree");
  sv.restaurerFichiers(fichiers, { vers });
  const { DatabaseSync } = await import("node:sqlite");
  const copie = new DatabaseSync(path.join(vers, "base", "remy.db"));
  assert.equal(copie.prepare("SELECT valeur FROM meta WHERE cle = 'preuve'").get().valeur, "sauvegardee");
  copie.close();
});
