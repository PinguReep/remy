// La jauge du chat (19/10) : la vitesse d'écriture de Rémy en jetons par
// seconde (en direct, puis exacte à la fin) et la place prise par la
// conversation dans le contexte du modèle. Des compteurs, jamais de contenu.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

const { compteurDebit, contexteDe, fenetreDeclaree, oublierRapport, rapportAppris } = await import("../lib/debit.js");

test("le débit compte le temps d'écriture seulement, et une mise à jour par seconde", () => {
  oublierRapport();
  let t = 0;
  const envois = [];
  const c = compteurDebit((d) => envois.push(d), { maintenant: () => t });
  t = 2000; // 2 s de lecture du contexte avant le premier jeton : pas comptées
  for (let i = 0; i < 30; i++) {
    c.morceau("abcdefghijklmnop"); // 16 caractères ≈ 5 jetons
    t += 100;
  }
  // 3 s d'écriture (dernier morceau à 2,9 s) → 2 mises à jour : à 1 s et à 2 s
  assert.equal(envois.length, 2);
  assert.ok(envois.every((e) => e.tps > 40 && e.tps < 60), JSON.stringify(envois));
  c.finTour(150); // le modèle dit : 150 jetons
  const b = c.bilan();
  assert.equal(b.jetons, 150);
  assert.equal(b.decodeMs, 3000);
  assert.equal(b.tps, 50);
  assert.equal(b.premierMs, 2000);
  assert.equal(b.estime, undefined);
  // 480 caractères pour 150 jetons : le rapport appris bouge vers 3,2
  assert.ok(Math.abs(rapportAppris() - 3.2) < 0.01);
});

test("plusieurs tours (outils) : le temps des outils n'est pas compté", () => {
  let t = 0;
  const c = compteurDebit(() => {}, { maintenant: () => t });
  c.morceau("x".repeat(100));
  t += 1000;
  c.finTour(40);
  t += 5000; // l'outil travaille
  c.morceau("y".repeat(100));
  t += 1000;
  c.finTour(60);
  const b = c.bilan();
  assert.equal(b.jetons, 100);
  assert.equal(b.decodeMs, 2000);
  assert.equal(b.tps, 50);
});

test("sans compte du modèle, l'estimation est dite", () => {
  oublierRapport();
  let t = 0;
  const c = compteurDebit(() => {}, { maintenant: () => t });
  c.morceau("z".repeat(320));
  t += 2000;
  c.finTour(null);
  const b = c.bilan();
  assert.equal(b.jetons, 100);
  assert.equal(b.estime, true);
  assert.equal(compteurDebit(() => {}).bilan(), null, "rien écrit : pas de mesure");
});

test("le contexte : entrée + sortie, réparti selon la part de chaque bloc", () => {
  const c = contexteDe({ entree: 10_000, sortie: 500, cars: { systeme: 30_000, conversation: 9_000, outils: 1_000 } });
  assert.equal(c.utilise, 10_500);
  assert.deepEqual(c.repartition, { systeme: 7500, conversation: 2250, outils: 250, reponse: 500 });
  assert.equal(contexteDe({ entree: 0, sortie: 10, cars: {} }), null, "le modèle n'a rien dit : pas de chiffre inventé");
});

test("la taille du contexte déclarée par les serveurs courants", () => {
  assert.equal(fenetreDeclaree({ id: "m", max_model_len: 131072 }), 131072); // vLLM, SGLang
  assert.equal(fenetreDeclaree({ id: "m", parameters: { max_seq_len: 65536 } }), 65536); // TabbyAPI
  assert.equal(fenetreDeclaree({ id: "m", meta: { n_ctx_train: 202752 } }), 202752); // llama.cpp
  assert.equal(fenetreDeclaree({ id: "m" }), null);
  assert.equal(fenetreDeclaree({ id: "m", context_length: "12" }), null, "aberrant");
});

// --- De bout en bout : un faux modèle local, lent, qui dit son usage. --------
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", async () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3-Flash-EXL3", max_model_len: 131072 }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (let i = 0; i < 13; i++) {
      res.write(`data: ${JSON.stringify(delta(i < 5 ? { reasoning_content: "je pense " } : { content: "mot " }))}\n\n`);
      await pause(100);
    }
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4200, completion_tokens: 26 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-jauge-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_GLM_CONTEXTE"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const { oublierFenetre } = await import("../lib/glm.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const evenements = (brut) => brut.split("\n\n").filter(Boolean).map((b) => ({ nom: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || "null") }));

test("une réponse dit son débit en direct, puis ses mesures exactes, gardées avec le message", async () => {
  oublierFenetre();
  const c = await (await post("/api/conversations", {})).json();
  const evts = evenements(await (await post(`/api/conversations/${c.id}/messages`, { text: "Un conseil ?" })).text());
  const done = evts.find((e) => e.nom === "done");
  assert.ok(done, JSON.stringify(evts.find((e) => e.nom === "error")));
  const debits = evts.filter((e) => e.nom === "debit").map((e) => e.data);
  assert.ok(debits.length >= 1, "au moins une mise à jour pendant 1,3 s d'écriture");
  assert.ok(debits.every((d) => d.tps > 0 && Number.isInteger(d.jetons)));
  const m = done.data.mesures;
  assert.equal(m.jetons, 26, "le compte du modèle, réflexion comprise");
  assert.ok(m.tps > 10 && m.tps < 40, `≈ 26 jetons en 1,2 s : ${m.tps}`);
  assert.equal(m.contexte, 4226);
  assert.equal(m.fenetre, 131072);
  assert.equal(m.fenetreSource, "modele");
  assert.equal(m.modele, "GLM-5.3-Flash-EXL3", "le modèle servi");
  assert.equal(m.machine, "DGX Spark", "la machine qui le sert (REMY_GLM_MACHINE sinon)");
  const r = m.repartition;
  assert.equal(r.systeme + r.conversation + r.outils, 4200);
  assert.ok(r.systeme > r.conversation, "la consigne (mémoire, planning) pèse plus que « Un conseil ? »");
  assert.equal(r.reponse, 26);
  // Rechargée plus tard : la mesure est toujours là, sans aucun texte en plus.
  const conv = await (await fetch(`${base}/api/conversations/${c.id}`)).json();
  assert.deepEqual(conv.messages.at(-1).mesures, m);
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("jauge-v1"));
});

test("la taille réglée sur la tour l'emporte sur celle du modèle", async () => {
  process.env.REMY_GLM_CONTEXTE = "65536";
  try {
    const c = await (await post("/api/conversations", {})).json();
    const evts = evenements(await (await post(`/api/conversations/${c.id}/messages`, { text: "Et demain ?" })).text());
    const m = evts.find((e) => e.nom === "done").data.mesures;
    assert.equal(m.fenetre, 65536);
    assert.equal(m.fenetreSource, "reglage");
  } finally {
    delete process.env.REMY_GLM_CONTEXTE;
  }
});
