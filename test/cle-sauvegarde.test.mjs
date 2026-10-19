// La clé des sauvegardes : créée une seule fois, jamais affichée, jamais
// remplacée ; la copie de Sam se vérifie sans rien montrer.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { empreinteCle } from "../lib/sauvegarde.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "cle-sauvegarde.mjs");
const D = fs.mkdtempSync(path.join(os.tmpdir(), "remy-cle-"));
const env = path.join(D, "remy.env");
test.after(() => fs.rmSync(D, { recursive: true, force: true }));

const lancer = (args, entree = "\n") => {
  const r = spawnSync(process.execPath, [script, "--fichier", env, ...args], { input: entree, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, sortie: r.stdout + r.stderr };
};
const cleDe = () => (fs.readFileSync(env, "utf8").match(/^REMY_SAUVEGARDE_CLE=(.*)$/m) || [])[1];

test("création : une clé valide dans remy.env, jamais affichée, le reste du fichier intact", () => {
  fs.writeFileSync(env, "MOTION_API_KEY=secret-motion\nREMY_SAUVEGARDE_CLE=\nAUTRE=1\n");
  const r = lancer(["--creer"]);
  const cle = cleDe();
  assert.match(cle, /^[0-9a-f]{64}$/);
  assert.equal(r.sortie.includes(cle), false, "la clé ne s'affiche jamais");
  assert.match(r.sortie, new RegExp(empreinteCle(cle)));
  const texte = fs.readFileSync(env, "utf8");
  assert.match(texte, /^MOTION_API_KEY=secret-motion$/m);
  assert.match(texte, /^AUTRE=1$/m);
});

test("une clé existante n'est jamais remplacée", () => {
  const avant = cleDe();
  const r = lancer(["--creer"]);
  assert.equal(r.code, 0);
  assert.match(r.sortie, /n'est JAMAIS remplacée/);
  assert.equal(cleDe(), avant);
  assert.equal(r.sortie.includes(avant), false);
});

test("vérifier la copie de Sam : identique ou différente, sans rien montrer", () => {
  const cle = cleDe();
  const bon = lancer(["--verifier"], `${cle.toUpperCase()}\n`);
  assert.equal(bon.code, 0);
  assert.match(bon.sortie, /Identique/);
  const faux = lancer(["--verifier"], `${"0".repeat(64)}\n`);
  assert.equal(faux.code, 1);
  assert.match(faux.sortie, /DIFFÉRENTE/);
  for (const r of [bon, faux]) assert.equal(r.sortie.includes(cle), false);
});

test("empreinte : 12 caractères, la même que celle de la bibliothèque", () => {
  const r = lancer(["--empreinte"]);
  assert.match(r.sortie, /\b[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}\b/);
  assert.match(r.sortie, new RegExp(empreinteCle(cleDe())));
});
