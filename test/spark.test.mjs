// Copie des sauvegardes sur un Spark par SFTP (destination hors de la tour, en
// attendant le disque externe). Un faux `sftp` joue le Spark dans un dossier
// local. Ce que ces tests tiennent :
//   - l'archive part chiffrée, sous un nom provisoire, est relue et déchiffrée ;
//   - la clé ne part jamais ; l'empreinte du Spark est exigée, pas de mot de passe ;
//   - Spark éteint, empreinte inconnue, place insuffisante, copie abîmée : la
//     copie locale est faite et l'échec est dit, rien n'est écrit à moitié ;
//   - la rétention du Spark suit celle de la tour et ne touche qu'aux archives ;
//   - une copie sur la tour (même disque, ou « Spark » = la tour) n'est pas
//     une copie externe, et l'état de santé le dit ;
//   - on restaure depuis le Spark.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

console.log = () => {};

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-spark-"));
const coffre = path.join(racine, "Rémy");
const base = path.join(coffre, ".remy");
const spark = path.join(racine, "spark");
const dossierSpark = path.join(spark, "sauvegardes");
const trace = path.join(racine, "trace-sftp.jsonl");
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_DATA_DIR", "MOTION_API_KEY", "VERCEL", "REMY_SAUVEGARDES_EXTERNE"]) delete process.env[v];
const CLE = crypto.randomBytes(32).toString("hex");
Object.assign(process.env, {
  REMY_VAULT: coffre,
  REMY_SAUVEGARDE_CLE: CLE,
  REMY_SFTP_BIN: path.join(ici, "outils", "faux-sftp.mjs"),
  REMY_SPARK_CLE_SSH: path.join(racine, "spark_ed25519"),
  REMY_SPARK_HOTES_CONNUS: path.join(racine, "spark_hotes_connus"),
  FAUX_SFTP_RACINE: spark,
  FAUX_SFTP_TRACE: trace,
});

const sv = await import("../lib/sauvegarde.js");
const sftp = await import("../lib/sftp.js");
const cle = Buffer.from(CLE, "hex");
const CIBLE = "remy-sauvegarde@spark-1:/sauvegardes";

fs.mkdirSync(base, { recursive: true });
fs.mkdirSync(dossierSpark, { recursive: true });
fs.writeFileSync(path.join(coffre, "Mémoire de Rémy.md"), "# Mémoire\n\nSam nage le mardi.\n");
fs.writeFileSync(path.join(base, "reglages.json"), JSON.stringify({ secoursCloud: false }));

const panne = (p) => (p ? (process.env.FAUX_SFTP_PANNE = p) : delete process.env.FAUX_SFTP_PANNE);
let tic = 0;
const sauvegarder = (destinations, autres = {}) =>
  sv.sauvegarder({ base, coffre, cle, destinations, maintenant: new Date(Date.now() + ++tic * 1000), ...autres });
const surLeSpark = () => fs.readdirSync(dossierSpark).sort();

test.after(() => fs.rmSync(racine, { recursive: true, force: true }));

test("copie sur le Spark : envoyée chiffrée, relue, déchiffrée ; options SSH strictes", async () => {
  fs.rmSync(trace, { force: true });
  const r = await sauvegarder([{ nom: "locale", dossier: path.join(racine, "locale") }, { nom: "spark", distant: CIBLE }]);
  const s = r.copies.find((c) => c.nom === "spark");
  assert.equal(s.ok, true, s.erreur);
  assert.equal(s.horsTour, true);
  assert.match(s.libre, /To|Go/);
  assert.deepEqual(surLeSpark(), [r.nom], "pas de .part qui traîne");
  const lu = sv.lireArchive(fs.readFileSync(path.join(dossierSpark, r.nom)), { cle });
  assert.ok(lu.fichiers.some((f) => f.chemin === "coffre/Mémoire de Rémy.md"));
  // Sans la clé, le Spark ne lit rien.
  assert.throws(() => sv.lireArchive(fs.readFileSync(path.join(dossierSpark, r.nom)), {}), /REMY_SAUVEGARDE_CLE absente/);
  const appels = fs.readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const { args } of appels) {
    const o = args.join(" ");
    assert.match(o, /BatchMode=yes/);
    assert.match(o, /StrictHostKeyChecking=yes/);
    assert.match(o, /PasswordAuthentication=no/);
    assert.match(o, /IdentitiesOnly=yes/);
    assert.ok(args.includes(`UserKnownHostsFile=${process.env.REMY_SPARK_HOTES_CONNUS}`));
    assert.ok(args.includes(process.env.REMY_SPARK_CLE_SSH));
    assert.equal(args.at(-1), "remy-sauvegarde@spark-1");
    assert.ok(!o.includes(CLE), "la clé de chiffrement ne part jamais");
  }
});

test("la clé de chiffrement n'est dans aucun fichier du Spark", () => {
  for (const n of surLeSpark()) {
    const buf = fs.readFileSync(path.join(dossierSpark, n));
    assert.equal(buf.includes(Buffer.from(CLE)), false);
    assert.equal(buf.includes(cle), false);
  }
});

test("Spark éteint : la copie locale est faite et l'échec est dit", async () => {
  panne("injoignable");
  try {
    const avant = surLeSpark();
    const r = await sauvegarder([{ nom: "locale", dossier: path.join(racine, "locale") }, { nom: "spark", distant: CIBLE }]);
    assert.equal(r.copies[0].ok, true);
    assert.equal(r.copies[1].ok, false);
    assert.match(r.copies[1].erreur, /Spark injoignable/);
    assert.deepEqual(surLeSpark(), avant);
  } finally {
    panne(null);
  }
});

test("empreinte du Spark inconnue ou changée : rien n'est envoyé, et c'est dit", async () => {
  panne("empreinte");
  try {
    const r = await sauvegarder([{ nom: "spark", distant: CIBLE }]);
    assert.match(r.copies[0].erreur, /empreinte du Spark inconnue ou CHANGÉE/);
  } finally {
    panne(null);
  }
  panne("cle");
  try {
    const r = await sauvegarder([{ nom: "spark", distant: CIBLE }]);
    assert.match(r.copies[0].erreur, /refuse la clé SSH/);
  } finally {
    panne(null);
  }
});

test("place insuffisante sur le Spark : rien n'est envoyé", async () => {
  process.env.FAUX_SFTP_LIBRE = "1000"; // ~1 Mo
  try {
    const avant = surLeSpark();
    const r = await sauvegarder([{ nom: "spark", distant: CIBLE }]);
    assert.match(r.copies[0].erreur, /place insuffisante sur le Spark/);
    assert.deepEqual(surLeSpark(), avant);
  } finally {
    delete process.env.FAUX_SFTP_LIBRE;
  }
});

test("copie abîmée en route : l'échec est dit", async () => {
  process.env.FAUX_SFTP_ABIMER = "1";
  try {
    const r = await sauvegarder([{ nom: "spark", distant: CIBLE }]);
    assert.equal(r.copies[0].ok, false);
    assert.match(r.copies[0].erreur, /ne correspond pas/);
    assert.equal(surLeSpark().includes(r.nom), false, "la copie abîmée ne reste pas sur le Spark");
  } finally {
    delete process.env.FAUX_SFTP_ABIMER;
  }
});

test("rétention sur le Spark : mêmes règles que la tour, rien d'autre n'est touché", async () => {
  const fin = new Date(Date.now() + 3_600_000); // jamais le même nom qu'une archive des tests précédents
  for (let j = 60; j >= 1; j--) {
    const d = new Date(fin.getTime() - j * 86_400_000);
    d.setHours(3, 0, 0);
    fs.writeFileSync(path.join(dossierSpark, sv.nomArchive(d, "nuit")), "ancienne");
  }
  fs.writeFileSync(path.join(dossierSpark, "a-garder.txt"), "pas une archive de Rémy");
  const avant = surLeSpark();
  const r = await sv.sauvegarder({ base, coffre, cle, destinations: [{ nom: "spark", distant: CIBLE }], maintenant: fin });
  assert.equal(r.copies[0].ok, true, r.copies[0].erreur);
  const apres = surLeSpark();
  const attendues = sv.aGarder([...avant, r.nom].filter((n) => sv.lireNom(n)), fin);
  assert.deepEqual(apres.filter((n) => n.endsWith(sv.EXTENSION)).sort(), [...attendues].sort());
  assert.ok(apres.includes("a-garder.txt"));
  assert.ok(r.copies[0].supprimees > 0);
});

test("une copie sur la tour n'est pas une copie externe", async () => {
  // Dossier « externe » sur le même disque que la base.
  const r = await sauvegarder([{ nom: "externe", dossier: path.join(racine, "faux-externe") }]);
  assert.equal(r.copies[0].ok, false);
  assert.match(r.copies[0].erreur, /même disque que la base/);
  // Un « Spark » qui est la tour elle-même.
  for (const hote of ["localhost", "127.0.0.1", os.hostname()]) {
    const r2 = await sauvegarder([{ nom: "spark", distant: `remy@${hote}:/sauvegardes` }]);
    assert.match(r2.copies[0].erreur, /la tour elle-même/);
  }
  // Un vrai disque à part (volume différent) passe.
  fs.mkdirSync(path.join(racine, "usb"), { recursive: true });
  const r3 = await sauvegarder([{ nom: "externe", dossier: path.join(racine, "usb", "Remy") }], {
    volume: (p) => (p.includes(`${path.sep}usb`) ? "usb" : "tour"),
  });
  assert.equal(r3.copies[0].ok, true, r3.copies[0].erreur);
});

test("état de santé : sans copie hors de la tour, c'est une alerte", () => {
  const maintenant = Date.now();
  const seule = sv.resumeEtat({ at: maintenant, nom: "x", copies: [{ nom: "locale", ok: true }] }, maintenant);
  assert.match(seule, /^⚠️/);
  assert.match(seule, /aucune copie hors de la tour/);
  const avecSpark = sv.resumeEtat({ at: maintenant, nom: "x", copies: [{ nom: "locale", ok: true }, { nom: "spark", ok: true, horsTour: true, libre: "812 Go" }] }, maintenant);
  assert.match(avecSpark, /^✅/);
  assert.match(avecSpark, /812 Go libres/);
  const sparkRate = sv.resumeEtat({ at: maintenant, nom: "x", copies: [{ nom: "locale", ok: true }, { nom: "spark", ok: false, erreur: "Spark injoignable" }] }, maintenant);
  assert.match(sparkRate, /^⚠️.*Spark injoignable.*aucune copie hors de la tour/);
});

test("adresse du Spark : forme stricte, rien d'injectable dans les commandes", () => {
  assert.deepEqual(sftp.lireCible("remy-sauvegarde@spark-1:/sauvegardes"), { utilisateur: "remy-sauvegarde", hote: "spark-1", port: 22, dossier: "/sauvegardes" });
  assert.equal(sftp.lireCible("remy@192.168.1.51:2222:/s/").port, 2222);
  for (const faux of ["spark-1:/s", "remy@spark-1:s", "remy@spark-1:/s\nrm *", 'remy@spark-1:/s"x', "remy@spark-1:/../etc", "remy@-oProxyCommand=x:/s"]) {
    assert.throws(() => sftp.lireCible(faux), /REMY_SAUVEGARDES_SPARK/, faux);
  }
});

test("restauration depuis le Spark : la plus récente, vérifiée avec la clé", async () => {
  const r = await sauvegarder([{ nom: "spark", distant: CIBLE }]);
  assert.equal(r.copies[0].ok, true);
  const env = { ...process.env, REMY_SAUVEGARDES: path.join(racine, "locale-script"), REMY_SAUVEGARDES_SPARK: CIBLE };
  const sortie = execFileSync(process.execPath, [path.join(ici, "..", "scripts", "restaurer.mjs"), "--depuis-spark", "--verifier"], { env, encoding: "utf8" });
  assert.match(sortie, /Récupérée depuis le Spark/);
  assert.match(sortie, /Archive valide/);
  assert.ok(fs.existsSync(path.join(racine, "locale-script", "depuis-spark", path.basename(surLeSpark().filter((n) => n.endsWith(sv.EXTENSION)).sort().at(-1)))));
});

test("avant une mise à jour : sans copie hors de la tour, l'installeur s'arrête", () => {
  const script = path.join(ici, "..", "scripts", "sauvegarder.mjs");
  const env = { ...process.env, REMY_SAUVEGARDES: path.join(racine, "locale-maj") };
  delete env.REMY_SAUVEGARDES_SPARK;
  const sans = spawnSync(process.execPath, [script, "--raison", "avant-maj", "--exiger-hors-tour"], { env, encoding: "utf8" });
  assert.equal(sans.status, 1);
  assert.match(sans.stdout, /Aucune copie hors de la tour/);
  const avec = spawnSync(process.execPath, [script, "--raison", "avant-maj", "--exiger-hors-tour"], { env: { ...env, REMY_SAUVEGARDES_SPARK: CIBLE }, encoding: "utf8" });
  assert.equal(avec.status, 0, avec.stdout + avec.stderr);
  assert.match(avec.stdout, /✅ spark/);
});

test("rétention : un fichier déposé à la main n'est jamais effacé ; les « .part » abandonnés le sont", async () => {
  const fin = new Date(Date.now() + 7_200_000);
  const vieux = new Date(fin.getTime() - 3 * 86_400_000);
  fs.writeFileSync(path.join(dossierSpark, "copie-manuelle-de-sam.remy-sauvegarde"), "à garder");
  fs.writeFileSync(path.join(dossierSpark, `${sv.nomArchive(vieux, "nuit")}.part`), "envoi coupé");
  fs.writeFileSync(path.join(dossierSpark, `${sv.nomArchive(fin, "recent")}.part`), "envoi en cours");
  const r = await sv.sauvegarder({ base, coffre, cle, destinations: [{ nom: "spark", distant: CIBLE }], maintenant: fin });
  assert.equal(r.copies[0].ok, true, r.copies[0].erreur);
  const apres = surLeSpark();
  assert.ok(apres.includes("copie-manuelle-de-sam.remy-sauvegarde"));
  assert.equal(apres.includes(`${sv.nomArchive(vieux, "nuit")}.part`), false);
  assert.ok(apres.includes(`${sv.nomArchive(fin, "recent")}.part`), "un envoi récent n'est pas coupé");
});

test("jamais d'archive en clair vers le Spark", async () => {
  const r = await sv.sauvegarder({ base, coffre, cle: null, sansChiffrement: true, destinations: [{ nom: "spark", distant: CIBLE }] });
  assert.equal(r.copies[0].ok, false);
  assert.match(r.copies[0].erreur, /sans chiffrement/);
});
