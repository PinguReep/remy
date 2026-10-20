// Le modèle local suit ce que les Sparks chargent (20/10 : GLM-5.3 → DeepSeek),
// sauf choix fait dans l'app (Réglages › Modèle) — tant qu'il est encore servi.
// Et une réflexion renvoyée en clair par le serveur ne s'affiche jamais.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
const avertis = [];
console.warn = (...a) => avertis.push(a.join(" "));

let servis = [{ id: "DeepSeek-V4.1-Flash-1017", max_model_len: 1048576 }];
let enLigne = false; // le faux serveur rend la réflexion dans le texte, close par </think>
let eteint = false;
const recus = [];
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (eteint) {
      res.writeHead(502);
      return res.end();
    }
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: servis }));
    }
    const corps = JSON.parse(b || "{}");
    recus.push(corps);
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "Titre" }, finish_reason: "stop" }], usage: {} }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const morceaux = enLigne ? ["Il me demande l'heure. Je ", "réponds simplement.</think>", "\n\nIl est ", "midi."] : ["Il est ", "midi."];
    for (const m of morceaux) res.write(`data: ${JSON.stringify(delta({ content: m }))}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-modeles-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_GLM_CONTEXTE"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_GLM_MODEL = "GLM-5.3-Flash-EXL3"; // l'ancien réglage de la tour, plus servi
process.env.REMY_BROWSE = "off";
process.env.REMY_PRENOM = "Sam";

const g = await import("../lib/glm.js");
const { glmProvider } = await import("../lib/providers.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => {
  remy.close();
  glm.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const envoyer = (m, chemin, corps) =>
  fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
const reponse = async (opts = {}) => {
  let vu = "";
  const r = await glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "Quelle heure ?" }], onText: (t) => (vu += t), ...opts });
  return { r, vu };
};

test("libellés : sans chemin ni quantification", () => {
  assert.equal(g.libelleModele("zai-org/GLM-5.3-FP8"), "GLM-5.3");
  assert.equal(g.libelleModele("GLM-5.3-Flash-EXL3"), "GLM-5.3-Flash");
  assert.equal(g.libelleModele("DeepSeek-V4.1-Flash-1017"), "DeepSeek-V4.1-Flash-1017");
  assert.equal(g.libelleModele("Qwen3-235B-A22B-AWQ"), "Qwen3-235B-A22B");
});

test("les Sparks ont changé de modèle : Rémy suit, même si la tour nomme encore l'ancien", async () => {
  recus.length = 0;
  const { r, vu } = await reponse();
  assert.equal(recus[0].model, "DeepSeek-V4.1-Flash-1017", "le modèle servi, pas l'ancien REMY_GLM_MODEL");
  assert.equal(r.model, "DeepSeek-V4.1-Flash-1017");
  assert.equal(vu, "Il est midi.");
  // La réflexion est demandée sous ses deux noms (GLM : enable_thinking, DeepSeek : thinking).
  assert.equal(recus[0].chat_template_kwargs.thinking, true);
  assert.equal(recus[0].chat_template_kwargs.enable_thinking, true);
  assert.ok(avertis.some((a) => /GLM-5.3-Flash-EXL3.*n'est plus servi/.test(a)), "la tour le note dans son journal");
  assert.equal(g.modeleGlm(), "DeepSeek-V4.1-Flash-1017", "la jauge affichera le bon modèle");
});

test("réflexion rendue en clair par le serveur : jamais montrée, ni gardée", async () => {
  enLigne = true;
  g.oublierReflexionEnClair();
  const etapes = [];
  const { r, vu } = await reponse({ onTool: (i) => etapes.push(i.type) });
  assert.equal(vu, "Il est midi.", "seule la réponse s'affiche");
  assert.equal(r.text, "Il est midi.");
  assert.ok(etapes.includes("reflexion"), "la barre d'étapes voit qu'il réfléchit");
  // Sans réflexion demandée, le texte coule tout de suite (rien à attendre).
  enLigne = false;
  const sans = await reponse({ reflexion: false });
  assert.equal(sans.vu, "Il est midi.");
  assert.equal(recus.at(-1).chat_template_kwargs.thinking, false);
});

test("Réglages › Modèle : la liste des Sparks, un choix vérifié, retour à l'automatique", async () => {
  servis = [{ id: "DeepSeek-V4.1-Flash-1017", max_model_len: 1048576 }, { id: "zai-org/GLM-5.3-FP8", max_model_len: 131072 }];
  const v = await (await envoyer("GET", "/api/modeles")).json();
  assert.equal(v.joignable, true);
  assert.equal(v.actif.id, "DeepSeek-V4.1-Flash-1017");
  assert.equal(v.actif.source, "auto");
  assert.equal(v.choisi, null);
  assert.deepEqual(v.servis.map((m) => m.libelle), ["DeepSeek-V4.1-Flash-1017", "GLM-5.3"]);
  assert.equal(v.servis[0].fenetre, 1048576);

  // Un modèle que les Sparks ne servent pas : refusé, avec la raison.
  const non = await envoyer("PUT", "/api/modeles", { id: "Llama-inexistant" });
  assert.equal(non.status, 409);
  assert.match((await non.json()).error, /ne servent pas/);
  assert.equal((await envoyer("PUT", "/api/modeles", { id: 42 })).status, 400);

  const choisi = await (await envoyer("PUT", "/api/modeles", { id: "zai-org/GLM-5.3-FP8" })).json();
  assert.equal(choisi.choisi, "zai-org/GLM-5.3-FP8");
  assert.equal(choisi.actif.source, "choisi");
  recus.length = 0;
  await reponse();
  assert.equal(recus[0].model, "zai-org/GLM-5.3-FP8", "la conversation suivante part sur le modèle choisi");

  // Les Sparks déchargent le modèle choisi : Rémy reprend celui qu'elles servent.
  servis = [{ id: "DeepSeek-V4.1-Flash-1017" }];
  const apres = await (await envoyer("GET", "/api/modeles")).json();
  assert.equal(apres.choisi, "zai-org/GLM-5.3-FP8", "le choix reste noté…");
  assert.equal(apres.actif.id, "DeepSeek-V4.1-Flash-1017", "…mais Rémy prend ce qui est servi");
  assert.equal(apres.actif.source, "auto");

  const auto = await (await envoyer("PUT", "/api/modeles", { id: null })).json();
  assert.equal(auto.choisi, null);
});

test("Sparks éteintes : on ne peut pas choisir à l'aveugle", async () => {
  eteint = true;
  const r = await envoyer("PUT", "/api/modeles", { id: "DeepSeek-V4.1-Flash-1017" });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /Sparks ne répondent pas/);
  const v = await (await envoyer("GET", "/api/modeles")).json();
  assert.equal(v.joignable, false);
  eteint = false;
  const cap = await (await fetch(`${base}/api/version`)).json();
  assert.ok(cap.capacites.includes("modeles-v1"));
});
