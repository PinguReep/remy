// P2/P3 (retours TestFlight 13, MVP) : étiquettes des rappels, sous-projets
// dans Remy, historique lisible, analyses par GLM local (capture à plusieurs
// intentions, classement des rappels). Base temporaire, faux GLM, aucune
// donnée réelle.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
let reponse = null; // contenu que le faux GLM rendra
const recus = [];
const glm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "GLM-test" }] }));
    recus.push(JSON.parse(corps || "{}"));
    res.end(JSON.stringify({ choices: [{ message: { content: reponse }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
});
await new Promise((r) => glm.listen(0, r));

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-organisation-"));
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "MOTION_API_KEY", "VERCEL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = racine;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
const dbm = await import("../lib/db.js");
const c = await import("../lib/carnet.js");
const a = await import("../lib/analyses.js");
const { historique, origineHumaine } = await import("../lib/historique.js");
test.after(() => {
  dbm.fermer();
  glm.close();
  fs.rmSync(racine, { recursive: true, force: true });
});

test("étiquettes : posées sur un rappel, gardées si une app d'avant le réécrit, retirées si supprimées", () => {
  c.ecrireEtiquette("sante", { nom: "Santé", ordre: 0 });
  c.ecrireEtiquette("voiture", { nom: "Voiture", ordre: 1 });
  c.ecrireRappels([{ id: "r1", texte: "Contrôle technique", quand: Date.now() + 86_400_000, etiquettes: ["voiture"] }]);
  assert.deepEqual(c.lireRappels()[0].etiquettes, ["voiture"]);
  c.ecrireRappels([{ id: "r1", texte: "Contrôle technique de la Twingo", quand: Date.now() + 86_400_000 }]); // sans « etiquettes »
  assert.deepEqual(c.lireRappels()[0].etiquettes, ["voiture"], "une app d'avant n'efface pas les étiquettes");
  c.supprimerEtiquette("voiture");
  assert.deepEqual(c.lireRappels()[0].etiquettes, [], "une étiquette supprimée disparaît des rappels");
  assert.deepEqual(c.lireEtiquettes().map((e) => e.nom), ["Santé"]);
});

test("sous-projets : arborescence sous un projet Motion, notes, tâche rangée, pas de boucle, suppression du sous-arbre", () => {
  c.ecrireDossier("d-recep", { nom: "Boutique de bougies", parent: "motion:p1" });
  c.ecrireDossier("d-tts", { nom: "Comparer les fournisseurs TTS/STT", parent: "d-recep" });
  c.ecrireDossier("d-eleven", { nom: "Étudier ElevenLabs", parent: "d-tts" });
  c.ecrireNotes("d-eleven", [{ id: "n1", texte: "Tester la voix « Antoine »" }]);
  c.rattacher("t42", "d-tts");
  const ds = c.lireDossiers();
  assert.equal(ds.find((d) => d.id === "d-eleven").parent, "d-tts");
  assert.deepEqual(ds.find((d) => d.id === "d-eleven").notes.map((n) => n.texte), ["Tester la voix « Antoine »"]);
  assert.deepEqual(ds.find((d) => d.id === "d-tts").taches, ["t42"]);
  assert.throws(() => c.ecrireDossier("d-recep", { nom: "Boutique de bougies", parent: "d-eleven" }), /lui-même/);
  assert.equal(c.supprimerDossier("d-tts").supprimes, 2, "le sous-projet et ce qu'il contient");
  assert.deepEqual(c.lireDossiers().map((d) => d.id), ["d-recep"]);
  // Annuler : réécrire la ligne la fait revenir.
  c.ecrireDossier("d-tts", { nom: "Comparer les fournisseurs TTS/STT", parent: "d-recep" });
  assert.equal(c.lireDossiers().length, 2);
});

test("l'heure de Paris est lue juste (été comme hiver), une date seule tombe à 9:00", () => {
  const ete = a.quandDe("2026-07-03T19:00");
  assert.equal(new Date(ete.ms).toISOString(), "2026-07-03T17:00:00.000Z");
  assert.equal(ete.heureConnue, true);
  const hiver = a.quandDe("2026-12-03T19:00");
  assert.equal(new Date(hiver.ms).toISOString(), "2026-12-03T18:00:00.000Z");
  const jour = a.quandDe("2026-10-17");
  assert.equal(jour.heureConnue, false);
  assert.equal(new Date(jour.ms).toISOString(), "2026-10-17T07:00:00.000Z");
  assert.equal(a.quandDe("jeudi"), null);
});

test("capture à plusieurs intentions : éléments séparés, rien d'inventé, question si l'heure manque", async () => {
  reponse = JSON.stringify({
    elements: [
      { nature: "rendez-vous", titre: "Soirée chez Yanis", quand: "2026-10-22", dureeMin: null, question: null },
      { nature: "contrainte", titre: "Disponibilité limitée samedi", quand: "2026-10-24" },
      { nature: "rendez-vous", titre: "Studio à La Roseraie", quand: "2026-10-25T14:00", dureeMin: 120 },
      { nature: "tache", titre: "Faire la lessive", quand: "2026-10-25", dureeMin: null, etiquettes: ["Santé", "Inconnue"] },
      { nature: "liste", titre: "Courses", liste: "Courses", articles: ["tomates", "lait"] },
      { nature: "inconnue", titre: "ignoré" },
    ],
  });
  const r = await a.analyserCapture("Soirée chez Yanis jeudi, dispo limitée samedi, deux heures de studio dimanche à La Roseraie, la lessive avant, et tomates, lait", {
    etiquettes: c.lireEtiquettes(),
    listes: [{ nom: "Courses" }],
  });
  assert.deepEqual(r.elements.map((e) => e.nature), ["rendez-vous", "contrainte", "rendez-vous", "tache", "liste"]);
  assert.equal(r.elements[0].question, "À quelle heure ?", "un rendez-vous sans heure ne devient pas un créneau");
  assert.equal(r.elements[0].heureConnue, false);
  assert.equal(r.elements[2].dureeMin, 120);
  assert.equal(r.elements[2].heureConnue, true);
  assert.deepEqual(r.elements[3].etiquettes, ["sante"], "les noms d'étiquettes deviennent des identifiants connus");
  assert.deepEqual(r.elements[4].articles, ["tomates", "lait"]);
  const envoye = recus.at(-1);
  assert.equal(envoye.response_format?.type, "json_schema");
  assert.match(envoye.messages[1].content, /"etiquettes":\["Santé"\]/);
});

test("capture : GLM absent → erreur claire (503), la capture reste simple", async () => {
  const url = process.env.REMY_GLM_URL;
  delete process.env.REMY_GLM_URL;
  await assert.rejects(() => a.analyserCapture("Appeler Hugo"), (e) => e.statut === 503 && /pas configuré/.test(e.message));
  process.env.REMY_GLM_URL = url;
});

test("rappels : propositions de GLM (étiquettes connues, actions valides seulement), rien n'est modifié", async () => {
  c.ecrireRappels([{ id: "r2", texte: "Préparer la déclaration d'impôts", quand: null }, { id: "r3", texte: "Anniversaire de Nina" }]);
  reponse = JSON.stringify({
    propositions: [
      { id: "r1", etiquettes: ["Santé"], action: "garder" },
      { id: "r2", etiquettes: ["Administratif"], action: "tache" },
      { id: "r3", etiquettes: [], action: "supprimer" },
      { id: "inconnu", action: "garder" },
    ],
  });
  const avant = JSON.stringify(c.lireRappels());
  const r = await a.analyserRappels(c.lireRappels(), c.lireEtiquettes());
  assert.deepEqual(r.propositions.map((p) => [p.id, p.action]), [["r1", "garder"], ["r2", "tache"]]);
  assert.deepEqual(r.propositions[1].etiquettes, [], "« Administratif » n'existe pas encore : ignorée");
  assert.equal(JSON.stringify(c.lireRappels()), avant, "aucun rappel touché");
});

test("retenir : GLM propose les infos à cocher (local seulement), rien n'est écrit", async () => {
  reponse = JSON.stringify({ elements: [
    { texte: "Sam veut lancer la démo jeudi", section: "Projets en cours" },
    { texte: "On lui a suggéré de facturer à l'usage", section: "Objectifs" },
  ] });
  recus.length = 0;
  const r = await a.extraireInfos("Je veux lancer la démo jeudi. ChatGPT m'a conseillé de facturer à l'usage, je ne sais pas encore.", { source: "chatgpt", memoire: "## Objectifs\n- démo" });
  assert.deepEqual(r.elements.map((e) => e.section), ["Projets en cours", "Objectifs"]);
  const envoye = JSON.stringify(recus.at(-1));
  assert.match(envoye, /Tu ne retiens RIEN/);
  assert.match(envoye, /matiere_externe/, "le texte collé est encadré comme matière");
  await assert.rejects(() => a.extraireInfos("court"), (e) => e.statut === 400);
  const url = process.env.REMY_GLM_URL;
  delete process.env.REMY_GLM_URL;
  await assert.rejects(() => a.extraireInfos("Un texte assez long pour être retenu par Rémy, vraiment."), (e) => e.statut === 503 && /tout retenir tel quel/.test(e.message));
  process.env.REMY_GLM_URL = url;
});

test("historique : le journal relu pour un humain, avec l'origine et l'avant → après", () => {
  const t = Date.now();
  const d = dbm.db();
  d.prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, maj_a) VALUES (?, ?, 'motion', ?, ?, 'appliquee', '[]', ?, '{}', ?)")
    .run("j1", t, "tap · iPhone de Sam", "Replanifié depuis l'app",
      JSON.stringify([{ ok: true, type: "modifier", nom: "Relancer le comptable", annulable: "restaurer", avant: { name: "Relancer le comptable", dueDate: "2026-10-15T21:59:00Z" }, apres: { name: "Relancer le comptable", dueDate: "2026-10-16T21:59:00Z" } }]), t);
  d.prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, maj_a, annule) VALUES (?, ?, 'agenda', ?, ?, 'appliquee', '[]', ?, '{}', ?, 1)")
    .run("j2", t - 1000, "capture · iPhone de Sam", "Décalée",
      JSON.stringify([{ ok: true, type: "modifier", titre: "Aspirateur", annulable: "restaurer", avant: { summary: "Aspirateur", start: { dateTime: "2026-10-15T17:30:00Z" }, end: { dateTime: "2026-10-15T18:00:00Z" } }, apres: { summary: "Aspirateur", start: "2026-10-15T18:30:00Z", end: "2026-10-15T19:00:00Z" } }]), t);
  const [e1, e2] = historique();
  assert.equal(e1.origine, "Toi (iPhone de Sam)");
  assert.equal(e1.elements[0].action, "Replanifiée");
  assert.match(e1.elements[0].changements[0], /^échéance : .* → .*/);
  assert.equal(e1.annulable, true);
  assert.equal(e2.elements[0].action, "Décalé");
  assert.deepEqual(e2.elements[0].changements, ["heure : 19:30 → 20:30"]);
  assert.equal(e2.annulable, false, "déjà annulée");
  assert.equal(e2.origine, "Capture (iPhone de Sam)");
  assert.equal(origineHumaine("chat"), "Rémy, dans une conversation");
});
