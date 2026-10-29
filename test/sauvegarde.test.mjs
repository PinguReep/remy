// Sauvegardes (Lot 0, J0.1). Ce que ces tests tiennent :
//   - aller-retour : coffre + base → archive chiffrée → effacement → restauration,
//     et chaque fichier revient à l'octet près (empreintes identiques) ;
//   - une mauvaise clé, une archive tronquée ou modifiée d'un octet : refus clair,
//     et RIEN n'est écrit ;
//   - pas de sauvegarde en clair sans le demander explicitement ;
//   - une restauration ne remplit jamais un dossier qui n'est pas vide ;
//   - rétention : 14 jours, 8 semaines, 12 mois, les « avant-… » 90 jours ;
//   - un disque externe débranché : la copie locale est faite ET l'échec est dit ;
//   - le script de restauration vérifie, puis restaure dans un dossier neuf ;
//   - l'export (migration) emporte la mémoire corrigée dans Obsidian.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Le serveur journalise sur la sortie standard, que le lanceur de tests de Node
// utilise aussi pour ses messages : un mélange rend parfois le flux illisible
// (« Unable to deserialize cloned data », vu en CI). Les journaux de ces tests
// ne servent à rien ici.
console.log = () => {};

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-sauvegarde-"));
const coffre = path.join(racine, "Rémy");
const base = path.join(coffre, ".remy");
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_DATA_DIR", "MOTION_API_KEY", "VERCEL"]) delete process.env[v];
process.env.REMY_VAULT = coffre;
const CLE = crypto.randomBytes(32).toString("hex");
process.env.REMY_SAUVEGARDE_CLE = CLE;

const sv = await import("../lib/sauvegarde.js");
const store = await import("../lib/store.js");
const cle = Buffer.from(CLE, "hex");

test.after(() => fs.rmSync(racine, { recursive: true, force: true }));

function empreintes(dossier) {
  const out = {};
  const visiter = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visiter(p);
      else out[path.relative(dossier, p).split(path.sep).join("/")] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  visiter(dossier);
  return out;
}

function remplirCoffre() {
  fs.mkdirSync(path.join(coffre, "Conversations"), { recursive: true });
  fs.mkdirSync(path.join(coffre, ".obsidian"), { recursive: true });
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(coffre, "Mémoire de Rémy.md"), "# Mémoire de Rémy\n\n## Identité\n- Sam, musique [déclaré]\n");
  fs.writeFileSync(path.join(coffre, "Conversations", "Garage (abcdef12).md"), "Bonjour — accents : é à ç ✓\n");
  fs.writeFileSync(path.join(coffre, ".obsidian", "app.json"), "{}");
  fs.writeFileSync(path.join(base, "conversations.json"), JSON.stringify({ conversations: [{ id: "c1", title: "Garage" }] }));
  fs.writeFileSync(path.join(base, "ledger.json"), "[]");
  fs.writeFileSync(path.join(base, "binaire.bin"), crypto.randomBytes(4096));
}

test("aller-retour : tout revient à l'octet près, la base n'est pas comptée deux fois", async () => {
  remplirCoffre();
  const avant = empreintes(coffre);
  const locale = path.join(racine, "sauvegardes");
  const r = await sv.sauvegarder({ base, coffre, destinations: [{ nom: "locale", dossier: locale }], raison: "test", cle, instantaneMotion: async () => [{ id: "t1", name: "Payer la facture" }] });
  assert.equal(r.copies[0].ok, true);
  assert.equal(r.motion, "1 tâches");
  assert.equal(r.fichiers, 7); // 3 coffre + 3 base + motion
  const archive = fs.readFileSync(r.copies[0].fichier);
  // Chiffrée : aucun contenu lisible dans le fichier.
  assert.equal(archive.includes(Buffer.from("Sam")), false);

  fs.rmSync(coffre, { recursive: true, force: true });
  const vers = path.join(racine, "restauree");
  const { fichiers } = sv.lireArchive(archive, { cle });
  sv.restaurerFichiers(fichiers, { vers });
  const restaure = { ...prefixer(empreintes(path.join(vers, "coffre")), ""), ...prefixer(empreintes(path.join(vers, "base")), ".remy/") };
  assert.deepEqual(restaure, avant);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(vers, "motion", "taches.json"), "utf8")), [{ id: "t1", name: "Payer la facture" }]);
});

function prefixer(obj, p) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [p + k, v]));
}

test("mauvaise clé, archive tronquée ou modifiée d'un octet : refus clair", async () => {
  remplirCoffre();
  const archive = sv.creerArchive(sv.collecter({ base, coffre }), { cle });
  assert.throws(() => sv.lireArchive(archive, { cle: crypto.randomBytes(32) }), /mauvaise clé, ou archive modifiée/);
  assert.throws(() => sv.lireArchive(archive.subarray(0, archive.length - 10), { cle }), /mauvaise clé, ou archive modifiée ou tronquée/);
  const modifiee = Buffer.from(archive);
  modifiee[modifiee.length - 1] ^= 1;
  assert.throws(() => sv.lireArchive(modifiee, { cle }), /ARCHIVE|modifiée/);
  assert.throws(() => sv.lireArchive(archive, {}), /REMY_SAUVEGARDE_CLE absente/);
  assert.throws(() => sv.lireArchive(Buffer.from("n'importe quoi"), { cle }), /pas une sauvegarde de Rémy/);
});

test("pas de sauvegarde en clair sans le demander", async () => {
  await assert.rejects(
    sv.sauvegarder({ base, coffre, destinations: [{ nom: "locale", dossier: path.join(racine, "x") }], cle: null }),
    /REMY_SAUVEGARDE_CLE absente/,
  );
});

test("une restauration ne remplit jamais un dossier qui n'est pas vide", () => {
  remplirCoffre();
  const { fichiers } = sv.lireArchive(sv.creerArchive(sv.collecter({ base, coffre }), { cle }), { cle });
  const occupe = path.join(racine, "occupe");
  fs.mkdirSync(occupe, { recursive: true });
  fs.writeFileSync(path.join(occupe, "a-moi.txt"), "à garder");
  assert.throws(() => sv.restaurerFichiers(fichiers, { vers: occupe }), /n'est pas vide/);
  assert.deepEqual(fs.readdirSync(occupe), ["a-moi.txt"]);
});

test("une archive en clair déposée dans le dossier n'est pas restaurée quand une clé existe", () => {
  const forgee = sv.creerArchive([{ chemin: "coffre/.obsidian/plugins/piege/main.js", contenu: Buffer.from("alert(1)") }], { sansChiffrement: true });
  assert.throws(() => sv.lireArchive(forgee, { cle }), /NON chiffrée.*refusée/);
  assert.equal(sv.lireArchive(forgee, { cle, accepterClair: true }).fichiers.length, 1);
  assert.equal(sv.lireArchive(forgee, {}).fichiers.length, 1); // sans clé du tout (tests) : lisible
});

test("une archive qui tente d'écrire hors de son dossier est refusée", () => {
  const piege = sv.creerArchive([{ chemin: "coffre/../../evade.txt", contenu: Buffer.from("x") }], { cle });
  assert.throws(() => sv.lireArchive(piege, { cle }), /chemin refusé/);
});

test("disque externe débranché : la copie locale est faite et l'échec est dit", async () => {
  remplirCoffre();
  const locale = path.join(racine, "locale-ext");
  const externe = path.join(racine, "lecteur-absent", "Remy");
  const r = await sv.sauvegarder({
    base,
    coffre,
    cle,
    destinations: [{ nom: "locale", dossier: locale }, { nom: "externe", dossier: externe }],
  });
  assert.equal(r.copies[0].ok, true);
  assert.equal(r.copies[1].ok, false);
  assert.match(r.copies[1].erreur, /disque débranché/);
  assert.equal(fs.existsSync(externe), false); // rien recréé sur le disque de la tour
  // Lecteur présent, dossier pas encore créé : créé au premier passage.
  fs.mkdirSync(path.dirname(externe), { recursive: true });
  // (Le dossier de test est sur le même disque que la base : on dit lequel
  // est « le disque externe », sinon la copie serait refusée à raison.)
  const volume = (p) => (p.includes("lecteur-absent") ? "usb" : "tour");
  const r2 = await sv.sauvegarder({ base, coffre, cle, destinations: [{ nom: "externe", dossier: externe }], maintenant: new Date(Date.now() + 1000), volume });
  assert.equal(r2.copies[0].ok, true);
});

test("rétention sur 400 jours : 14 jours, 8 semaines, 12 mois, « avant-… » 90 jours", () => {
  const fin = new Date(2027, 9, 14, 12, 0, 0);
  const noms = [];
  for (let j = 400; j >= 0; j--) {
    const d = new Date(fin.getTime() - j * 86_400_000);
    d.setHours(3, 0, 0);
    noms.push(sv.nomArchive(d, "nuit"));
  }
  const avantMaj = new Date(fin.getTime() - 30 * 86_400_000);
  const vieilleAvantMaj = new Date(fin.getTime() - 120 * 86_400_000);
  noms.push(sv.nomArchive(avantMaj, "avant-maj"), sv.nomArchive(vieilleAvantMaj, "avant-maj"));
  const garder = sv.aGarder(noms, fin);
  const nuits = [...garder].filter((n) => n.includes("-nuit"));
  // Les 14 derniers jours sont tous là.
  for (let j = 0; j < 14; j++) {
    const d = new Date(fin.getTime() - j * 86_400_000);
    d.setHours(3, 0, 0);
    assert.ok(garder.has(sv.nomArchive(d, "nuit")), `jour -${j}`);
  }
  // Pas plus de 14 + 8 + 12 nuits (souvent moins : elles se recouvrent).
  assert.ok(nuits.length <= 34 && nuits.length >= 22, `${nuits.length} nuits gardées`);
  // La plus ancienne gardée a au plus ~12 mois.
  const plusAncienne = Math.min(...nuits.map((n) => sv.lireNom(n).date.getTime()));
  assert.ok(fin - plusAncienne <= 366 * 86_400_000);
  assert.ok(garder.has(sv.nomArchive(avantMaj, "avant-maj")));
  assert.equal(garder.has(sv.nomArchive(vieilleAvantMaj, "avant-maj")), false); // « avant-… » de plus de 90 jours
});

test("purge : ne touche qu'aux sauvegardes de Rémy, garde ce que la rétention garde", () => {
  const d = path.join(racine, "purge");
  fs.mkdirSync(d, { recursive: true });
  const fin = new Date(2027, 0, 31, 12);
  for (let j = 0; j < 40; j++) fs.writeFileSync(path.join(d, sv.nomArchive(new Date(fin.getTime() - j * 86_400_000), "nuit")), "x");
  fs.writeFileSync(path.join(d, "note-de-sam.txt"), "à garder");
  const supprimes = sv.purger(d, fin);
  assert.ok(supprimes.length > 0);
  assert.ok(fs.existsSync(path.join(d, "note-de-sam.txt")));
  assert.equal(fs.readdirSync(d).filter((n) => n.endsWith(sv.EXTENSION)).length, sv.aGarder(fs.readdirSync(d), fin).size);
});

test("scripts : sauvegarder puis restaurer --verifier puis dans un dossier neuf", () => {
  remplirCoffre();
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const env = { ...process.env, REMY_VAULT: coffre, REMY_SAUVEGARDES: path.join(racine, "par-script"), REMY_SAUVEGARDE_CLE: CLE };
  delete env.REMY_SAUVEGARDES_EXTERNE;
  const sortie = execFileSync(process.execPath, [path.join(ici, "..", "scripts", "sauvegarder.mjs"), "--raison", "avant-maj"], { env, encoding: "utf8" });
  assert.match(sortie, /✅ locale/);
  const archive = path.join(racine, "par-script", fs.readdirSync(path.join(racine, "par-script")).find((n) => n.endsWith(sv.EXTENSION)));
  const verif = execFileSync(process.execPath, [path.join(ici, "..", "scripts", "restaurer.mjs"), archive, "--verifier"], { env, encoding: "utf8" });
  assert.match(verif, /Archive valide/);
  const vers = path.join(racine, "neuf");
  const rest = execFileSync(process.execPath, [path.join(ici, "..", "scripts", "restaurer.mjs"), archive, "--vers", vers], { env, encoding: "utf8" });
  assert.match(rest, /rien d'autre n'a été touché/);
  assert.ok(fs.existsSync(path.join(vers, "coffre", "Mémoire de Rémy.md")));
  // L'état est noté pour /api/health — et une copie sur la tour seule n'est
  // pas une sauvegarde : alerte.
  const etat = sv.lireEtat(base);
  assert.match(sv.resumeEtat(etat), /^⚠️ dernière .*aucune copie hors de la tour/);
  assert.match(sortie, /Aucune copie hors de la tour/);
});

test("restauration en place : état actuel sauvegardé d'abord, base mise de côté, notes ajoutées gardées", () => {
  remplirCoffre();
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const dossierSv = path.join(racine, "en-place");
  const env = { ...process.env, REMY_VAULT: coffre, REMY_SAUVEGARDES: dossierSv, REMY_SAUVEGARDE_CLE: CLE, PORT: "1" };
  delete env.REMY_SAUVEGARDES_EXTERNE;
  execFileSync(process.execPath, [path.join(ici, "..", "scripts", "sauvegarder.mjs")], { env, encoding: "utf8" });
  const archive = path.join(dossierSv, fs.readdirSync(dossierSv).find((n) => n.endsWith(sv.EXTENSION)));
  // Après la sauvegarde : la base change, une note est ajoutée au coffre.
  fs.writeFileSync(path.join(base, "conversations.json"), JSON.stringify({ conversations: [] }));
  fs.writeFileSync(path.join(coffre, "Note de Sam.md"), "à garder");
  const sortie = execFileSync(process.execPath, [path.join(ici, "..", "scripts", "restaurer.mjs"), archive, "--remplacer"], { env, encoding: "utf8" });
  assert.match(sortie, /Sauvegarde de l'état actuel : remy-.*-avant-restauration/);
  assert.match(sortie, /Base actuelle mise de côté/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, "conversations.json"), "utf8")).conversations.length, 1);
  assert.equal(fs.readFileSync(path.join(coffre, "Note de Sam.md"), "utf8"), "à garder");
  assert.ok(fs.readdirSync(coffre).some((n) => n.startsWith(".remy.avant-restauration-")));
});

test("export de migration : la mémoire corrigée dans Obsidian part avec", async () => {
  await store.putMemory("## Identité\n- Sam [déclaré]");
  const f = path.join(coffre, "Mémoire de Rémy.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Sam [déclaré]", "Sam, corrigé dans Obsidian [déclaré]"));
  const e = await store.exporterTout();
  assert.match(e.memoire.text, /corrigé dans Obsidian/);
});

test("la nuit : une sauvegarde par jour, notée seulement si la copie locale est bonne", async () => {
  process.env.REMY_SAUVEGARDE_HEURE = "0";
  process.env.REMY_REFLEXION_HEURE = "99"; // la réflexion n'est pas l'objet de ce test
  const planif = await import("../lib/planif.js");
  const { db, fermer } = await import("../lib/db.js");
  const appels = [];
  let ok = false;
  const faire = async ({ raison }) => {
    appels.push(raison);
    return { nom: "x", copies: [{ nom: "locale", ok }] };
  };
  planif.enregistrerNuit({ faireSauvegarde: faire });
  await planif.tick(); // copie ratée : pas notée…
  await planif.tick(); // …et pas relancée aussitôt : la reprise est espacée
  assert.deepEqual(appels, ["nuit"]);
  db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE type = 'sauvegarde-nuit'").run(); // le délai passe
  ok = true;
  await planif.tick();
  await planif.tick(); // déjà faite aujourd'hui
  assert.deepEqual(appels, ["nuit", "nuit"]);
  // Sans clé, jamais de sauvegarde (en clair ou pas).
  delete process.env.REMY_SAUVEGARDE_CLE;
  fs.rmSync(path.join(base, "planif.json"), { force: true });
  db().prepare("DELETE FROM jobs").run();
  await planif.tick();
  assert.equal(appels.length, 2);
  process.env.REMY_SAUVEGARDE_CLE = CLE;
  fermer(); // sous Windows, une base ouverte ne se supprime pas
});

test("une base mise de côté par une restauration n'alourdit pas les sauvegardes suivantes", () => {
  const n = sv.collecter({ base, coffre }).filter((f) => f.chemin.includes("avant-restauration")).length;
  assert.equal(n, 0);
});


test("les exports ChatGPT déposés pour Rémy ne partent pas dans les sauvegardes (lourds, en clair, déjà chiffrés dans la base)", async () => {
  remplirCoffre();
  const imports = path.join(coffre, "Imports");
  fs.mkdirSync(path.join(imports, "Importés"), { recursive: true });
  fs.writeFileSync(path.join(imports, "Importés", "export-chatgpt.zip"), "export ChatGPT fictif déjà lu");
  fs.writeFileSync(path.join(imports, "en-attente.zip"), "export ChatGPT fictif en attente");
  fs.mkdirSync(path.join(base, "imports-en-cours"), { recursive: true });
  fs.writeFileSync(path.join(base, "imports-en-cours", "envoi.tmp"), "envoi depuis l'iPhone en cours");
  const avant = { ...process.env };
  process.env.REMY_SAUVEGARDES = path.join(racine, "sans-imports");
  delete process.env.REMY_SAUVEGARDES_EXTERNE;
  delete process.env.REMY_SAUVEGARDES_SPARK;
  delete process.env.REMY_IMPORTS_DIR;
  try {
    const r = await sv.sauvegarderRemy({ raison: "test" });
    assert.equal(r.copies[0].ok, true);
    const { manifeste } = sv.lireArchive(fs.readFileSync(r.copies[0].fichier), { cle });
    const chemins = manifeste.fichiers.map((f) => f.chemin);
    assert.ok(chemins.includes("coffre/Mémoire de Rémy.md"), "le reste du coffre part");
    assert.deepEqual(chemins.filter((c) => /Imports|imports-en-cours/.test(c)), []);
  } finally {
    for (const k of ["REMY_SAUVEGARDES", "REMY_SAUVEGARDES_EXTERNE", "REMY_SAUVEGARDES_SPARK", "REMY_IMPORTS_DIR"]) {
      if (avant[k] === undefined) delete process.env[k];
      else process.env[k] = avant[k];
    }
    fs.rmSync(imports, { recursive: true, force: true });
    fs.rmSync(path.join(base, "imports-en-cours"), { recursive: true, force: true });
    (await import("../lib/db.js")).fermer();
  }
});
