// Prévol de la tour : il bloque sans copie hors de la tour, fait une vraie
// sauvegarde « avant-lot0 », la restaure à l'essai (le Spark re-téléchargé),
// et ne modifie RIEN dans la base ni le coffre.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const D = fs.mkdtempSync(path.join(os.tmpdir(), "remy-prevol-"));
const coffre = path.join(D, "Rémy");
const base = path.join(coffre, ".remy");
const spark = path.join(D, "spark");
fs.mkdirSync(base, { recursive: true });
fs.mkdirSync(path.join(spark, "sauvegardes"), { recursive: true });
fs.writeFileSync(path.join(coffre, "Mémoire de Rémy.md"), "# Mémoire\nfictive\n");
fs.writeFileSync(path.join(base, "conversations.json"), JSON.stringify({ conversations: [] }));
fs.writeFileSync(path.join(D, "spark_ed25519"), "fausse clé");
fs.writeFileSync(path.join(D, "hotes"), "faux");
test.after(() => fs.rmSync(D, { recursive: true, force: true }));

const empreinteArbre = (dossier) => {
  const h = crypto.createHash("sha256");
  const visiter = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      h.update(p);
      if (e.isDirectory()) visiter(p);
      else h.update(fs.readFileSync(p));
    }
  };
  visiter(dossier);
  return h.digest("hex");
};

const lancer = (env) => {
  const tout = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, REMY_VAULT: coffre, REMY_SAUVEGARDE_CLE: crypto.randomBytes(32).toString("hex"), REMY_SAUVEGARDES: path.join(D, "locale"), PORT: "1", ...env };
  for (const [k, v] of Object.entries(tout)) if (v === undefined) delete tout[k];
  const r = spawnSync(process.execPath, [path.join(ici, "..", "scripts", "prevol.mjs")], { env: tout, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, sortie: r.stdout + r.stderr };
};

test("sans destination hors de la tour : bloquant, et aucune sauvegarde d'essai", () => {
  const r = lancer({});
  assert.equal(r.code, 1);
  assert.match(r.sortie, /Aucune destination HORS de la tour/);
  assert.match(r.sortie, /pas lancée tant qu'il reste un ❌/);
});

test("sans clé : bloquant, avec la commande pour la créer", () => {
  const r = lancer({ REMY_SAUVEGARDE_CLE: undefined });
  assert.equal(r.code, 1);
  assert.match(r.sortie, /cle-sauvegarde\.mjs --creer/);
});

test("avec le Spark : sauvegarde « avant-lot0 », restaurée à l'essai, base et coffre intacts", () => {
  const avant = empreinteArbre(coffre);
  const r = lancer({
    REMY_SAUVEGARDES_SPARK: "remy-sauvegarde@spark-1:/sauvegardes",
    REMY_SFTP_BIN: path.join(ici, "outils", "faux-sftp.mjs"),
    REMY_SPARK_CLE_SSH: path.join(D, "spark_ed25519"),
    REMY_SPARK_HOTES_CONNUS: path.join(D, "hotes"),
    FAUX_SFTP_RACINE: spark,
  });
  assert.equal(r.code, 0, r.sortie);
  assert.match(r.sortie, /Spark spark-1 joignable/);
  assert.match(r.sortie, /Copie locale relue et restaurée à l'essai : 2\/2/);
  assert.match(r.sortie, /Copie spark relue et restaurée à l'essai : 2\/2/);
  assert.ok(fs.readdirSync(path.join(spark, "sauvegardes")).some((n) => /-avant-lot0\.remy-sauvegarde$/.test(n)));
  assert.equal(empreinteArbre(coffre), avant, "rien n'a changé dans le coffre ni la base");
  assert.equal(fs.existsSync(path.join(base, "remy.db")), false, "pas de base SQLite créée");
  assert.equal(fs.existsSync(path.join(base, "sauvegardes-etat.json")), false, "pas d'état noté dans la base");
});

test("Spark injoignable : bloquant, rien n'est sauvegardé", () => {
  const r = lancer({
    REMY_SAUVEGARDES_SPARK: "remy-sauvegarde@spark-1:/sauvegardes",
    REMY_SFTP_BIN: path.join(ici, "outils", "faux-sftp.mjs"),
    REMY_SPARK_CLE_SSH: path.join(D, "spark_ed25519"),
    REMY_SPARK_HOTES_CONNUS: path.join(D, "hotes"),
    FAUX_SFTP_RACINE: spark,
    FAUX_SFTP_PANNE: "injoignable",
  });
  assert.equal(r.code, 1);
  assert.match(r.sortie, /Spark : Spark injoignable/);
});
