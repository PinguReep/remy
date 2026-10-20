// Retours TestFlight 13 (15/10) : actions jusqu'à 15 s, « Motion ne répond
// pas » fréquent. Cause : notre propre consommation du quota (12 req/min) —
// chaque geste relisait toutes les pages. Ce qui est garanti ici :
//   - une liste vieillie est rendue TOUT DE SUITE, puis relue en arrière-plan ;
//   - après un geste, la liste suit la réponse de Motion, sans relecture ;
//   - une relecture de fond laisse toujours des places du quota aux gestes ;
//   - l'état dit à l'app distingue quota, panne et liste ancienne ;
//   - la liste survit à un redémarrage de la tour (gardée dans remy.db).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-fraicheur-"));
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_INSTANTANE = "on";
const m = await demarrerFauxMotion({ pageTaille: 2 });
process.env.MOTION_API_KEY = "cle-de-test";
process.env.MOTION_BASE_URL = m.url;
process.env.MOTION_CACHE_MS = "300";
process.env.MOTION_FRAIS_MIN_MS = "0";
process.env.MOTION_RELIRE_APRES_MS = "200";
process.env.MOTION_QUOTA_MIN = "100"; // le vrai (12/min) ferait attendre la minute entre deux tests
delete process.env.MOTION_WORKSPACE_ID;

const motion = await import("../lib/motion.js");
const { _vider, resume } = await import("../lib/mesures.js");
test.after(() => m.fermer());

const listes = () => m.requetes.filter((r) => r.methode === "GET" && /^\/v1\/tasks(\?|$)/.test(r.chemin)).length;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test("une liste vieillie est rendue tout de suite, puis relue en arrière-plan", async () => {
  m.ajouter({ id: "a", name: "Appeler Hugo" });
  m.ajouter({ id: "b", name: "Préparer la démo" });
  m.ajouter({ id: "c", name: "Relancer le comptable" });
  const premiere = await motion.tachesMotion({ frais: true });
  assert.deepEqual(premiere.map((t) => t.id).sort(), ["a", "b", "c"]);
  m.ajouter({ id: "d", name: "Créée dans Motion" });
  await attendre(350);
  const avant = listes();
  const t0 = Date.now();
  const vieille = await motion.tachesMotion();
  assert.ok(Date.now() - t0 < 50, "rendue sans attendre Motion");
  assert.equal(vieille.length, 3, "la liste d'avant, datée");
  await attendre(150);
  assert.ok(listes() > avant, "relue derrière");
  assert.equal((await motion.tachesMotion()).length, 4);
});

test("après un geste, la liste suit la réponse de Motion sans relire toutes les pages", async () => {
  await motion.tachesMotion({ frais: true });
  const avant = listes();
  const r = await motion.applyActions([
    { type: "terminer", id: "a", nom: "Appeler Hugo" },
    { type: "modifier", id: "b", nom: "Préparer la démo", nouveau_nom: "Préparer la démo client" },
  ]);
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  const liste = await motion.tachesMotion();
  assert.equal(listes(), avant, "aucune relecture de la liste");
  assert.ok(!liste.some((t) => t.id === "a"), "la tâche terminée a quitté la liste");
  assert.equal(liste.find((t) => t.id === "b").name, "Préparer la démo client");
  // Motion a recalculé le planning : une relecture est prévue peu après.
  await attendre(250);
  await motion.tachesMotion();
  await attendre(100);
  assert.ok(listes() > avant, "relecture prévue après l'écriture");
});

test("une relecture de fond laisse toujours des places du quota aux gestes", async () => {
  await motion.tachesMotion({ frais: true });
  await attendre(350);
  // Le quota est presque plein : la liste reste celle d'avant, l'état le dit.
  process.env.MOTION_QUOTA_MIN = String(motion.etatMotion().quota.utilise + 2);
  const avant = listes();
  await motion.tachesMotion();
  await attendre(100);
  assert.equal(listes(), avant, "pas de relecture de fond sur les dernières places");
  assert.equal(motion.etatMotion().etat, "menage");
  process.env.MOTION_QUOTA_MIN = "100";
});

test("l'état distingue le quota de Motion d'une panne, et garde la liste", async () => {
  m.pannes.push({ methode: "GET", chemin: /^\/tasks$/, code: 429, fois: 3, entetes: { "Retry-After": "1" } });
  const liste = await motion.tachesMotion({ frais: true });
  assert.ok(liste.length > 0, "la liste d'avant reste affichée");
  const e = motion.etatMotion();
  assert.equal(e.etat, "quota");
  assert.ok(e.luA > 0);
  m.pannes.length = 0;
});

test("les temps sont mesurés (liste, attente du quota, écriture)", () => {
  const r = resume();
  assert.ok(r["motion.liste"]?.n >= 1);
  assert.ok(r["motion.attente_quota"]?.n >= 1);
  assert.ok(r["motion.ecriture"]?.n >= 1);
  _vider();
});

test("la liste survit à un redémarrage de la tour (gardée dans remy.db)", async () => {
  const neuf = await import("../lib/motion.js?redemarrage");
  const liste = await neuf.tachesMotion();
  assert.ok(liste.length >= 2, "rendue depuis la base, sans attendre Motion");
  assert.ok(neuf.etatMotion().luA > 0);
});
