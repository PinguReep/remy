// La lecture du texte d'une image sur la tour (12/11, lib/ocr.js) : l'OCR de
// Windows par PowerShell 5.1, injectable pour les tests. Sous Linux : la raison
// est dite, rien n'échoue. Sous Windows (CI, ocr-windows.yml) : l'OCR réel est
// essayé ; un runner sans langue de reconnaissance le CONSTATE et passe.
// Ce fichier tourne seul (node --test test/ocr.test.mjs), sans dépendance.

import test from "node:test";
import assert from "node:assert/strict";

const ocr = await import("../lib/ocr.js");
const { pngMot } = await import("../lib/fichiers-essai.js");

test("le script PowerShell évite le piège du dépôt et ne laisse aucun fichier", () => {
  const s = ocr.SCRIPT_OCR;
  assert.doesNotMatch(s, /2>\s*\$null/, "pas de « 2>$null » en mode Stop");
  assert.doesNotMatch(s, /TempPath|GetTempFileName|Out-File|Set-Content|StorageFile|New-Item/i, "aucun fichier écrit");
  assert.match(s, /\[Console\]::In\.ReadToEnd\(\)/, "l'image arrive par l'entrée standard");
  assert.match(s, /IAsyncOperation`1/);
  assert.match(s, /-join "`n"/);
  // Assez court pour -EncodedCommand (32 767 caractères de ligne de commande).
  assert.ok(Buffer.from(s, "utf16le").toString("base64").length < 30_000);
});

test("injecté, coupé, essai : chacun dit ce qu'il a fait", async () => {
  ocr.reglerOcr(async () => ({ texte: "Bonjour", moteur: "faux" }));
  assert.deepEqual(await ocr.lireImage(Buffer.alloc(4), "png"), { texte: "Bonjour", moteur: "faux" });
  ocr.reglerOcr(async () => ({ raison: "rien ici" }));
  assert.equal(await ocr.lireImage(Buffer.alloc(4), "png"), null);
  assert.deepEqual(await ocr.lireImageDetail(Buffer.alloc(4), "png"), { raison: "rien ici" });
  ocr.reglerOcr(async () => {
    throw new Error("boum");
  });
  assert.match((await ocr.lireImageDetail(Buffer.alloc(4), "png")).raison, /a échoué/);
  ocr.reglerOcr(null);
  const avant = { o: process.env.REMY_OCR, e: process.env.REMY_ENV };
  try {
    process.env.REMY_OCR = "off";
    assert.match((await ocr.lireImageDetail(Buffer.alloc(4), "png")).raison, /coupée/);
    process.env.REMY_OCR = "essai";
    process.env.REMY_ENV = "production";
    const r = await ocr.lireImageDetail(Buffer.alloc(4), "png");
    assert.notEqual(r.moteur, "essai", "le faux moteur n'existe que sur une tour de test");
    process.env.REMY_ENV = "test";
    assert.deepEqual(await ocr.lireImageDetail(Buffer.alloc(4), "png"), { texte: ocr.TEXTE_ESSAI, moteur: "essai" });
  } finally {
    for (const [k, v] of [["REMY_OCR", avant.o], ["REMY_ENV", avant.e]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("sur cette machine : l'OCR réel, ou la raison de son absence", { timeout: 60_000 }, async () => {
  ocr.reglerOcr(null);
  const r = await ocr.lireImageDetail(pngMot("REMY 42"), "png");
  if (process.platform !== "win32") {
    assert.match(r.raison, /OCR de Windows seulement/);
    return;
  }
  if (r.raison) {
    // Runner sans langue de reconnaissance ni OCR : constaté, pas une erreur.
    console.log(`OCR de Windows absent ici : ${r.raison}`);
    assert.equal(typeof r.raison, "string");
    return;
  }
  console.log(`OCR de Windows : « ${r.texte} » (${r.moteur})`);
  assert.equal(typeof r.texte, "string");
  assert.match(r.moteur, /^OCR de Windows/);
});
