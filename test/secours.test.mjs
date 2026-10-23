// Secours cloud coupé par défaut (D21, décision de Sam du 14/10/2026).
//
// Le cerveau est local (GLM branché) mais GLM ne répond pas :
//   - par défaut, RIEN ne part chez Claude : la réponse dit pourquoi ;
//   - Sam l'active (réglage de l'app) : Claude prend le relais, signalé ;
//   - une conversation privée n'a jamais de secours, même activé ;
//   - les tâches de fond (réflexion, capture, analyse) suivent la même règle ;
//   - la dictée ne part pas dans le cloud sans TRANSCRIPTION_CLOUD=on.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Le serveur journalise sur la sortie standard, que le lanceur de tests de Node
// utilise aussi pour ses messages : un mélange rend parfois le flux illisible
// (« Unable to deserialize cloned data », vu en CI). Les journaux de ces tests
// ne servent à rien ici.
console.log = () => {};

// --- Faux Claude (API Anthropic) : compte les appels, répond « Secours ». ------------------
let appelsClaude = 0;
const anthropic = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    appelsClaude++;
    const b = JSON.parse(corps || "{}");
    if (!b.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "raisonnement" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: b.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Secours" } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev("message_stop", {});
    res.end();
  });
});
await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));

// GLM « branché » mais éteint : un port fermé.
const ferme = http.createServer();
await new Promise((r) => ferme.listen(0, "127.0.0.1", r));
const portFerme = ferme.address().port;
await new Promise((r) => ferme.close(r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-secours-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_SECOURS_CLOUD", "DICTEE_LOCALE_URL", "TRANSCRIPTION_CLOUD"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${portFerme}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_BROWSE = "off";
process.env.OPENAI_API_KEY = "cle-de-test"; // une clé cloud de dictée existe…

const { routeApi } = await import("../lib/routes.js");
const { fournisseurDeFond, SECOURS_COUPE, PRIVE_DE_FOND } = await import("../lib/providers.js");
const { transcribeProvider } = await import("../lib/transcribe.js");

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
  anthropic.close();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const envoyerJSON = (methode, chemin, corps) =>
  fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });

async function echanger(texte, { prive = false } = {}) {
  const c = await (await envoyerJSON("POST", "/api/conversations", prive ? { prive: true } : {})).json();
  assert.equal(Boolean(c.prive), prive);
  const r = await envoyerJSON("POST", `/api/conversations/${c.id}/messages`, { text: texte });
  const brut = await r.text();
  return brut
    .split("\n\n")
    .filter(Boolean)
    .map((b) => ({ nom: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || "null") }));
}

const reglage = async (valeur) => (await envoyerJSON("PUT", "/api/reglages", { secoursCloud: valeur })).json();

test("par défaut : GLM éteint → rien ne part chez Claude, et la réponse dit pourquoi", async () => {
  appelsClaude = 0;
  const lu = await (await fetch(`${base}/api/reglages`)).json();
  assert.equal(lu.secoursCloud, false);
  const ev = await echanger("Bonjour");
  const erreur = ev.find((e) => e.nom === "error");
  assert.ok(erreur, "un événement d'erreur");
  assert.equal(erreur.data.message, SECOURS_COUPE);
  assert.equal(appelsClaude, 0);
});

test("secours activé dans les réglages : Claude prend le relais, signalé « dégradé »", async () => {
  appelsClaude = 0;
  assert.equal((await reglage(true)).secoursCloud, true);
  const ev = await echanger("Bonjour");
  const done = ev.find((e) => e.nom === "done");
  assert.ok(done, JSON.stringify(ev.find((e) => e.nom === "error")));
  assert.equal(done.data.tier, "dégradé");
  assert.ok(appelsClaude >= 1);
  await reglage(false);
});

test("conversation privée : jamais de secours, même activé", async () => {
  await reglage(true);
  appelsClaude = 0;
  const ev = await echanger("Un secret", { prive: true });
  assert.match(ev.find((e) => e.nom === "error")?.data.message || "", /Conversation privée/);
  assert.equal(appelsClaude, 0);
  await reglage(false);
});

test("tâches de fond (nuit, capture, analyse) : même règle", async () => {
  appelsClaude = 0;
  await assert.rejects(fournisseurDeFond().complete({ system: "s", prompt: "p", maxTokens: 10 }), { message: SECOURS_COUPE });
  assert.equal(appelsClaude, 0);
  process.env.REMY_SECOURS_CLOUD = "on"; // posé exprès sur la tour
  try {
    const f = fournisseurDeFond();
    await f.complete({ system: "s", prompt: "p", maxTokens: 10 });
    assert.equal(appelsClaude, 1);
    // Forcé par la tour : l'app le montre, et ne peut pas le couper.
    const lu = await (await fetch(`${base}/api/reglages`)).json();
    assert.equal(lu.secoursCloudForceParLaTour, true);
    assert.equal(lu.secoursCloud, true);
  } finally {
    delete process.env.REMY_SECOURS_CLOUD;
  }
});

test("capture, GLM éteint et secours coupé : le texte est gardé pour la nuit, et la raison est dite", async () => {
  appelsClaude = 0;
  const r = await envoyerJSON("POST", "/api/capture", { texte: "Une idée de projet à creuser cette semaine, avec assez de matière.", source: "note" });
  assert.equal(r.status, 200);
  const corps = await r.json();
  assert.equal(corps.memoire, false);
  assert.match(corps.message, /secours Claude est coupé/);
  assert.equal(appelsClaude, 0);
  const gardees = await (await fetch(`${base}/api/capture`)).json();
  assert.ok(JSON.stringify(gardees).includes("Une idée de projet"), "le texte n'est pas perdu");
});

test("capture différée (Siri) : réponse immédiate, texte gardé ensuite", async () => {
  appelsClaude = 0;
  const r = await envoyerJSON("POST", "/api/capture", { texte: "Rappeler le garage", source: "siri", differe: true });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, differe: true });
  // L'absorption continue sur la tour : GLM éteint, le texte est gardé pour la nuit.
  let gardees = "";
  for (let i = 0; i < 50 && !gardees.includes("Rappeler le garage"); i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    gardees = JSON.stringify(await (await fetch(`${base}/api/capture`)).json());
  }
  assert.ok(gardees.includes("Rappeler le garage"), "le texte n'est pas perdu");
  assert.equal(appelsClaude, 0);
});

test("réglage : valeur invalide refusée, autre origine refusée", async () => {
  assert.equal((await envoyerJSON("PUT", "/api/reglages", { secoursCloud: "oui" })).status, 400);
  const r = await fetch(`${base}/api/reglages`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://ailleurs.example" }, body: JSON.stringify({ secoursCloud: true }) });
  assert.equal(r.status, 403);
  assert.equal((await (await fetch(`${base}/api/reglages`)).json()).secoursCloud, false);
});

test("dictée : pas de cloud quand le cerveau est local, sauf TRANSCRIPTION_CLOUD=on", async () => {
  assert.equal(transcribeProvider(), null);
  const r = await fetch(`${base}/api/transcribe?type=audio/mp4&dur=1`, { method: "POST", body: Buffer.alloc(2000) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /ne part pas dans le cloud/);
  process.env.TRANSCRIPTION_CLOUD = "on";
  try {
    assert.equal(transcribeProvider()?.name, "openai");
  } finally {
    delete process.env.TRANSCRIPTION_CLOUD;
  }
  process.env.DICTEE_LOCALE_URL = "http://127.0.0.1:8771/v1";
  try {
    assert.equal(transcribeProvider()?.name, "dictee-locale");
  } finally {
    delete process.env.DICTEE_LOCALE_URL;
  }
});

test("tâche de fond avec matière privée (imports) : jamais Claude, même secours activé", async () => {
  process.env.REMY_SECOURS_CLOUD = "on";
  try {
    appelsClaude = 0;
    await assert.rejects(fournisseurDeFond().complete({ prive: true, system: "s", prompt: "p", maxTokens: 10 }), { message: PRIVE_DE_FOND });
    assert.equal(appelsClaude, 0, "rien n'est parti chez Claude");
    // La même tâche sans matière privée, elle, a bien droit au secours.
    await fournisseurDeFond().complete({ system: "s", prompt: "p", maxTokens: 10 });
    assert.equal(appelsClaude, 1);
  } finally {
    delete process.env.REMY_SECOURS_CLOUD;
  }
});
