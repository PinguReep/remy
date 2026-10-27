// Le conseil du moment (retours TestFlight 13) : GLM local, calculé en
// arrière-plan, gardé tant que la situation ne change pas, jamais attendu,
// jamais envoyé au cloud ; les tâches bloquées ne sont pas proposées.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
let reponses = []; // contenus JSON que GLM rendra, dans l'ordre
let panne = false;
const recus = [];
const glm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(panne ? 503 : 200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-test" }] }));
    }
    recus.push(JSON.parse(corps || "{}"));
    if (panne) {
      res.writeHead(503);
      return res.end("{}");
    }
    const contenu = reponses.shift() ?? JSON.stringify({ conseil: "Termine la démo avant le déjeuner.", pourquoi: ["La démo est due à 17:00"], tache: "Finaliser la démo" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: contenu }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
});
await new Promise((r) => glm.listen(0, r));
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-conseil-"));
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_CONSEIL_AUTO_MS = "0";
delete process.env.ANTHROPIC_API_KEY;

const conseil = await import("../lib/conseil.js");
const store = await import("../lib/store.js");
test.after(() => glm.close());

const H = 3600_000;
const maintenant = Date.UTC(2026, 9, 15, 8, 40); // 10:40 à Paris
const journee = () => ({
  items: [
    { type: "tache", id: "t1", titre: "Finaliser la démo", debut: maintenant - 20 * 60_000, fin: maintenant + 40 * 60_000, duree: 60, priorite: "HIGH" },
    { type: "rdv", id: "e1", titre: "Déjeuner avec Léa", lieu: "Chez Paulette", debut: maintenant + 1.5 * H, fin: maintenant + 2.5 * H },
    { type: "tache", id: "t2", titre: "Préparer la facture", debut: maintenant + 3 * H, fin: maintenant + 3.5 * H, bloquee: true, raison: "devis" },
  ],
  aFaire: [
    { id: "a1", titre: "Prendre une douche" },
    { id: "a2", titre: "Relancer le comptable", priorite: "ASAP", bloquee: true },
  ],
  retard: { total: 1, items: [{ id: "r1", titre: "Envoyer le devis tennis" }] },
});
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test("la situation résume la journée sans proposer ce qui est bloqué", () => {
  const s = conseil.situation(journee(), { maintenant, rappels: [{ texte: "Payer le loyer", quand: maintenant + H }] });
  assert.equal(s.heure, "10:40");
  assert.equal(s.enCours.titre, "Finaliser la démo");
  assert.equal(s.enCours.resteMin, 40);
  assert.equal(s.prochainsFixes[0].titre, "Déjeuner avec Léa");
  assert.equal(s.libreAvantProchainFixeMin, 50, "de la fin de la tâche au déjeuner");
  assert.deepEqual(s.aFaireAujourdhui.map((t) => t.titre), ["Prendre une douche"]);
  assert.deepEqual(s.prochainesTaches, [], "la tâche bloquée n'est pas proposée");
  assert.deepEqual(s.bloquees.sort(), ["Préparer la facture", "Relancer le comptable"]);
  assert.equal(s.rappelsDuJour[0].heure, "11:40");
});

test("même situation, même clé ; un changement de journée ou de tranche de 20 min la change", () => {
  const s = conseil.situation(journee(), { maintenant });
  const k = conseil.cleSituation(s, maintenant);
  assert.equal(conseil.cleSituation(conseil.situation(journee(), { maintenant: maintenant + 60_000 }), maintenant + 60_000), conseil.cleSituation(conseil.situation(journee(), { maintenant: maintenant + 60_000 }), maintenant + 60_000));
  const autre = journee();
  autre.aFaire.push({ id: "a3", titre: "Appeler Hugo" });
  assert.notEqual(conseil.cleSituation(conseil.situation(autre, { maintenant }), maintenant), k);
  assert.notEqual(conseil.cleSituation(s, maintenant + 25 * 60_000), k);
});

test("la réponse de GLM est lue même entourée de texte, et refusée si vide", () => {
  assert.deepEqual(conseil.lireReponse('Voici : {"conseil":" Souffle  cinq minutes. ","pourquoi":["Tu enchaînes depuis 8 h"],"tache":null}'), {
    texte: "Souffle cinq minutes.",
    pourquoi: ["Tu enchaînes depuis 8 h"],
    tache: null,
    priorite: null,
  });
  assert.equal(conseil.lireReponse('{"conseil":""}'), null);
  assert.equal(conseil.lireReponse("pas du JSON"), null);
});

test("jamais attendu : le premier appel rend tout de suite, GLM calcule derrière, puis le conseil est gardé", async () => {
  const avant = recus.length;
  const t0 = Date.now();
  const premier = await conseil.conseilPour("maintenant", journee(), { maintenant });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(premier.conseil, null);
  assert.equal(premier.enCours, true);
  await attendre(200);
  const ensuite = await conseil.conseilPour("maintenant", journee(), { maintenant });
  assert.equal(ensuite.conseil.texte, "Termine la démo avant le déjeuner.");
  assert.equal(ensuite.conseil.source, "glm");
  assert.equal(ensuite.aJour, true);
  assert.equal(recus.length, avant + 1, "un seul calcul pour la même situation");
  // Ce qui part à GLM : la journée résumée, pas de tâche bloquée proposée.
  const envoye = recus.at(-1).messages[1].content;
  assert.match(envoye, /Déjeuner avec Léa/);
  assert.match(envoye, /bloquees/);
  assert.equal(recus.at(-1).response_format?.type, "json_schema");
});

test("« un autre conseil » recalcule en demandant autre chose", async () => {
  reponses.push(JSON.stringify({ conseil: "Prépare le trajet chez Paulette.", pourquoi: ["Déjeuner à 12:10"], tache: null }));
  const r = await conseil.renouveler("maintenant", journee(), { maintenant });
  assert.equal(r.enCours, true);
  await attendre(200);
  const g = await conseil.conseilPour("maintenant", journee(), { maintenant });
  assert.equal(g.conseil.texte, "Prépare le trajet chez Paulette.");
  assert.match(recus.at(-1).messages[1].content, /Propose autre chose que : « Termine la démo/);
});

test("circuit coupé dans les Réglages : aucun appel, et c'est dit", async () => {
  await store.putReglages({ circuits: { conseil: false } });
  const avant = recus.length;
  const r = await conseil.conseilPour("priorites", journee(), { maintenant });
  await attendre(100);
  assert.equal(r.disponible, false);
  assert.match(r.raison, /coupé dans les Réglages/);
  assert.equal(recus.length, avant);
  await store.putReglages({ circuits: { conseil: true } });
});

test("GLM en panne : le dernier conseil reste affiché et la raison est dite", async () => {
  panne = true;
  const autre = journee();
  autre.aFaire.push({ id: "a4", titre: "Nouvelle tâche" });
  await conseil.conseilPour("maintenant", autre, { maintenant });
  await attendre(200);
  const r = await conseil.conseilPour("maintenant", autre, { maintenant, relancer: false });
  assert.equal(r.conseil.texte, "Prépare le trajet chez Paulette.", "le dernier conseil reste affiché, daté");
  assert.equal(r.aJour, false);
  assert.match(r.raison, /GLM n'a pas pu réfléchir/);
  panne = false;
});
