// La file d'envoi de l'iPhone (capture-idempotente-v1, 25/10).
//
// Une capture « Retenir » notée sans réseau attend sur l'iPhone, puis part au
// retour de la tour avec son identifiant. Une coupure pendant l'envoi la fait
// renvoyer : la tour doit rendre la même réponse, sans la retenir deux fois
// ni rappeler le modèle (un appel = du temps des Sparks, et une mémoire
// réécrite deux fois). Sans identifiant, rien ne change.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

// Faux modèle local : compte les distillations, et prend son temps (un
// renvoi peut arriver pendant que la première absorbe encore).
let distillations = 0;
let attente = 0;
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", async () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "glm" }] }));
    distillations++;
    if (attente) await new Promise((r) => setTimeout(r, attente));
    const memoire = "## Identité & contexte\n- Sam, essai.\n## Projets en cours\n- Un studio à Porto [déclaré]";
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ memoire, ajouts: ["Sam veut un studio à Porto"] }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }));
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-capture-file-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH",
  "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

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

const capturer = (corps) => fetch(`${base}/api/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const TEXTE = "J'aimerais un petit studio à Porto pour écrire l'hiver prochain, au calme.";
const gardees = async (bout) => {
  const liste = await (await fetch(`${base}/api/capture`)).json();
  return JSON.stringify(liste).split(bout).length - 1;
};

test("/api/version annonce la capacité", async () => {
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("capture-idempotente-v1"));
});

test("renvoyée avec le même identifiant : même réponse, retenue une seule fois", async () => {
  distillations = 0;
  const id = "3F2A9C1E-0B4D-4C7A-9E21-7D5B1A2C3D4E";
  const r1 = await capturer({ texte: TEXTE, source: "note", idCapture: id });
  assert.equal(r1.status, 200);
  const c1 = await r1.json();
  assert.deepEqual(c1.ajouts, ["Sam veut un studio à Porto"]);
  assert.equal(c1.rejoue, undefined);
  const r2 = await capturer({ texte: TEXTE, source: "note", idCapture: id });
  assert.equal(r2.status, 200);
  const c2 = await r2.json();
  assert.equal(c2.rejoue, true, "la tour dit qu'elle l'avait déjà");
  assert.deepEqual(c2.ajouts, c1.ajouts, "la même réponse");
  assert.equal(distillations, 1, "le modèle n'est appelé qu'une fois");
  assert.equal(await gardees("studio à Porto pour écrire"), 1, "la capture n'est gardée qu'une fois");
});

test("deux envois simultanés du même identifiant : une seule absorption", async () => {
  distillations = 0;
  attente = 300;
  try {
    const id = "A1B2C3D4-0000-4000-8000-000000000001";
    const texte = "Une seconde idée assez longue pour être retenue : un atelier de bougies le samedi.";
    const [r1, r2] = await Promise.all([capturer({ texte, source: "note", idCapture: id }), capturer({ texte, source: "note", idCapture: id })]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const corps = [await r1.json(), await r2.json()];
    assert.equal(corps.filter((c) => c.rejoue).length, 1, "l'un des deux attend l'autre");
    assert.equal(distillations, 1);
    assert.equal(await gardees("un atelier de bougies le samedi"), 1);
  } finally {
    attente = 0;
  }
});

test("sans identifiant (ancienne app, site) : rien ne change", async () => {
  distillations = 0;
  const texte = "Une troisième idée sans identifiant, pour vérifier l'ancien chemin de la capture.";
  await capturer({ texte, source: "note" });
  await capturer({ texte, source: "note" });
  assert.equal(distillations, 2);
  assert.equal(await gardees("sans identifiant, pour vérifier"), 2);
});

test("un identifiant bizarre est ignoré : la capture part comme avant", async () => {
  distillations = 0;
  const texte = "Une quatrième idée avec un identifiant farfelu qui ne doit rien casser du tout.";
  const r = await capturer({ texte, source: "note", idCapture: "../../etc/passwd" });
  assert.equal(r.status, 200);
  assert.equal(distillations, 1);
});

test("une capture différée (Siri) renvoyée : la tour ne l'absorbe qu'une fois", async () => {
  distillations = 0;
  const id = "D1FFE2E0-0000-4000-8000-000000000002";
  const corps = { texte: "Rappeler le garage pour le pneu", source: "siri", differe: true, idCapture: id };
  const r1 = await capturer(corps);
  assert.equal(r1.status, 202);
  const r2 = await capturer(corps);
  assert.equal(r2.status, 202);
  assert.equal((await r2.json()).rejoue, true);
  for (let i = 0; i < 50 && (await gardees("Rappeler le garage pour le pneu")) < 1; i++) await new Promise((ok) => setTimeout(ok, 50));
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(distillations, 1);
  assert.equal(await gardees("Rappeler le garage pour le pneu"), 1);
});

test("une capture refusée (trop courte) n'est pas retenue comme reçue : corrigée, elle passe", async () => {
  const id = "C0FFEE00-0000-4000-8000-000000000003";
  const r1 = await capturer({ texte: "court", source: "note", idCapture: id });
  assert.equal(r1.status, 400);
  const r2 = await capturer({ texte: "Un texte enfin assez long pour que Rémy en tire quelque chose d'utile.", source: "note", idCapture: id });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).rejoue, undefined);
});
