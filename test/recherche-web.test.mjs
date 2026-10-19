// Recherche web et D21 (V8, décision de Sam du 14/10/2026) :
//   - une question qui demande le web ne part JAMAIS toute seule chez Claude :
//     Rémy demande l'autorisation (carte, ou « oui » / « non ») ;
//   - autorisée, seule la QUESTION part — ni la mémoire, ni la conversation,
//     ni le planning — sauf réglage « Envoi de contexte au cloud » ;
//   - refusée, coupée dans les réglages, ou en conversation privée : GLM
//     répond seul, sans le web, et le dit ;
//   - une demande à laquelle on n'a pas répondu expire à la question suivante.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {}; // le lanceur de tests lit la sortie standard

// --- Faux GLM : le routeur dit « web », le reste répond en local. ----------------------
const glmFlux = []; // corps des réponses en flux (ce que GLM a reçu)
const glm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "glm" }] }));
    }
    const b = JSON.parse(corps || "{}");
    if (!b.stream) {
      const routeur = String(b.messages?.[0]?.content || "").startsWith("Tu es le routeur");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: routeur ? "web" : "NO_UPDATE" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }
    glmFlux.push(b);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Réponse locale, sans le web." }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

// --- Faux Claude (API Anthropic) : enregistre ce qui lui arrive. --------------------------
const claude = [];
const anthropic = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const b = JSON.parse(corps || "{}");
    claude.push(b);
    if (!b.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: b.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Ouvert jusqu'à 19 h (source : site du magasin)." } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev("message_stop", {});
    res.end();
  });
});
await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-web-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_SECOURS_CLOUD", "REMY_WEB_SEARCH"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_BROWSE = "off";

const store = await import("../lib/store.js");
const { routeApi } = await import("../lib/routes.js");
const { PROMPT_RECHERCHE } = await import("../lib/chat.js");
const { fermer } = await import("../lib/db.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(() => {
  remy.close();
  glm.close();
  anthropic.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = (methode, chemin, corps) =>
  fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });

// Le flux SSE, lu en entier : [{ nom, data }].
async function flux(chemin, corps) {
  const r = await json("POST", chemin, corps);
  const texte = await r.text();
  return texte
    .split("\n\n")
    .filter(Boolean)
    .map((bloc) => {
      const nom = bloc.match(/^event: (.+)$/m)?.[1];
      const data = bloc.match(/^data: (.+)$/m)?.[1];
      return { nom, data: data ? JSON.parse(data) : null };
    })
    .filter((e) => e.nom);
}

async function nouveauFil({ prive = false } = {}) {
  const c = await (await json("POST", "/api/conversations", prive ? { prive: true } : {})).json();
  return c.id;
}

const SECRET_MEMOIRE = "Sam-a-un-rendez-vous-secret";
await store.putMemory(`## Identité\n- ${SECRET_MEMOIRE} [déclaré]`);

test("une question qui demande le web : rien ne part, Rémy demande l'autorisation", async () => {
  claude.length = 0;
  const id = await nouveauFil();
  const ev = await flux(`/api/conversations/${id}/messages`, { text: "Le magasin de la rue Oberkampf est ouvert ce soir ?" });
  const demande = ev.find((e) => e.nom === "autorisation")?.data;
  assert.ok(demande, "une demande d'autorisation");
  assert.equal(demande.contexte, false);
  assert.equal(ev.find((e) => e.nom === "done").data.stop_reason, "autorisation");
  assert.match(ev.find((e) => e.nom === "done").data.text, /seule ta question partirait/);
  assert.equal(claude.length, 0, "aucun appel à Claude avant l'accord");
  const conv = await (await json("GET", `/api/conversations/${id}`)).json();
  assert.equal(conv.messages.at(-1).autorisation.statut, "en_attente");
});

test("accordée : SEULE la question part chez Claude — ni mémoire, ni conversation", async () => {
  claude.length = 0;
  const id = await nouveauFil();
  await flux(`/api/conversations/${id}/messages`, { text: "Je t'ai parlé du dossier SECRET-HISTOIRE hier." });
  const ev1 = await flux(`/api/conversations/${id}/messages`, { text: "Quel temps fera-t-il demain à Lyon ?" });
  const demande = ev1.find((e) => e.nom === "autorisation").data;
  claude.length = 0;
  const ev2 = await flux(`/api/conversations/${id}/autorisations/${demande.id}`, { accord: true });
  assert.match(ev2.find((e) => e.nom === "done").data.text, /19 h/);
  const envoye = claude.filter((b) => b.stream);
  assert.equal(envoye.length, 1, "un seul appel, celui de la recherche");
  const tout = JSON.stringify(envoye[0]);
  assert.ok(!tout.includes(SECRET_MEMOIRE), "la mémoire ne part pas");
  assert.ok(!tout.includes("SECRET-HISTOIRE"), "la conversation ne part pas");
  assert.deepEqual(envoye[0].messages.map((m) => m.role), ["user"]);
  assert.match(JSON.stringify(envoye[0].messages[0]), /Quel temps fera-t-il demain à Lyon/);
  assert.ok(tout.includes(PROMPT_RECHERCHE.slice(0, 40)));
  const conv = await (await json("GET", `/api/conversations/${id}`)).json();
  const a = conv.messages.find((m) => m.autorisation?.id === demande.id).autorisation;
  assert.equal(a.statut, "acceptee");
  assert.match(conv.messages.at(-1).content, /19 h/);
  // Journalisé à part dans les coûts.
  const couts = await store.listCostEntries();
  assert.ok(couts.some((c) => c.kind === "recherche web" && /\[question seule\]/.test(c.label)));
  // Une seconde réponse à la même demande : refusée.
  assert.equal((await json("POST", `/api/conversations/${id}/autorisations/${demande.id}`, { accord: true })).status, 409);
});

test("refusée : GLM répond seul, sans le web, et rien ne part", async () => {
  const id = await nouveauFil();
  const demande = (await flux(`/api/conversations/${id}/messages`, { text: "Le cours du bitcoin maintenant ?" })).find((e) => e.nom === "autorisation").data;
  claude.length = 0;
  glmFlux.length = 0;
  const ev = await flux(`/api/conversations/${id}/autorisations/${demande.id}`, { accord: false });
  assert.match(ev.find((e) => e.nom === "done").data.text, /sans le web/);
  assert.equal(claude.length, 0);
  assert.match(JSON.stringify(glmFlux[0].messages[0]), /préféré que tu ne cherches pas sur le web/);
});

test("« oui » tapé dans le fil vaut accord (l'app déjà installée n'a pas les boutons) ; une autre question fait expirer la demande", async () => {
  const id = await nouveauFil();
  await flux(`/api/conversations/${id}/messages`, { text: "Les horaires de la piscine Valmont ?" });
  claude.length = 0;
  const ev = await flux(`/api/conversations/${id}/messages`, { text: "oui" });
  assert.match(ev.find((e) => e.nom === "done").data.text, /19 h/);
  assert.equal(claude.filter((b) => b.stream).length, 1);
  assert.match(JSON.stringify(claude.find((b) => b.stream).messages), /piscine Valmont/, "la question d'origine, pas « oui »");

  const demande = (await flux(`/api/conversations/${id}/messages`, { text: "Et le prix de l'entrée ?" })).find((e) => e.nom === "autorisation").data;
  claude.length = 0;
  await flux(`/api/conversations/${id}/messages`, { text: "Laisse tomber, parle-moi plutôt de ma semaine." });
  assert.equal(claude.length, 0, "une nouvelle question n'est pas un accord");
  const r = await json("POST", `/api/conversations/${id}/autorisations/${demande.id}`, { accord: true });
  assert.equal(r.status, 409);
  assert.match((await r.json()).message, /expiré/);
});

test("« Envoi de contexte au cloud » activé : la carte le dit, et le contexte part", async () => {
  assert.equal((await json("PUT", "/api/reglages", { contexteCloud: true })).status, 200);
  try {
    const id = await nouveauFil();
    const demande = (await flux(`/api/conversations/${id}/messages`, { text: "Les actualités du jour sur la Fed ?" })).find((e) => e.nom === "autorisation").data;
    assert.equal(demande.contexte, true);
    claude.length = 0;
    await flux(`/api/conversations/${id}/autorisations/${demande.id}`, { accord: true });
    assert.ok(JSON.stringify(claude.find((b) => b.stream)).includes(SECRET_MEMOIRE), "avec contexte : la mémoire part, comme annoncé");
  } finally {
    await json("PUT", "/api/reglages", { contexteCloud: false });
  }
});

test("recherche web coupée dans les réglages, ou conversation privée : ni demande ni envoi", async () => {
  await json("PUT", "/api/reglages", { rechercheWeb: false });
  try {
    claude.length = 0;
    glmFlux.length = 0;
    const id = await nouveauFil();
    const ev = await flux(`/api/conversations/${id}/messages`, { text: "La météo de demain ?" });
    assert.ok(!ev.some((e) => e.nom === "autorisation"));
    assert.equal(claude.length, 0);
    assert.match(JSON.stringify(glmFlux[0].messages[0]), /Recherche web coupée par Sam/);
  } finally {
    await json("PUT", "/api/reglages", { rechercheWeb: true });
  }
  claude.length = 0;
  glmFlux.length = 0;
  const prive = await nouveauFil({ prive: true });
  const ev = await flux(`/api/conversations/${prive}/messages`, { text: "La météo de demain ?" });
  assert.ok(!ev.some((e) => e.nom === "autorisation"), "en privé, Rémy ne propose même pas");
  assert.equal(claude.length, 0);
  assert.match(JSON.stringify(glmFlux[0].messages[0]), /Conversation privée : pas de recherche web/);
});

test("réglages : valeurs lues et validées", async () => {
  const v = await (await json("GET", "/api/reglages")).json();
  assert.equal(v.rechercheWeb, true);
  assert.equal(v.contexteCloud, false, "par défaut, rien du contexte ne part");
  assert.equal(v.secoursCloud, false);
  assert.equal((await json("PUT", "/api/reglages", { contexteCloud: "oui" })).status, 400);
});

test("un refus tapé n'est jamais pris pour un accord (« ok, ne cherche pas », « oui mais pas maintenant »)", async () => {
  const { lireAccordWeb } = await import("../lib/chat.js");
  for (const t of ["Ok, ne cherche pas", "cherche pas", "d'accord pour ne pas chercher", "ok non merci", "oui mais pas maintenant", "oui non", "merci", "oui mais regarde demain"]) {
    assert.notEqual(lireAccordWeb(t), true, t);
  }
  for (const t of ["oui", "Oui !", "ok vas-y", "oui, cherche stp", "d'accord"]) assert.equal(lireAccordWeb(t), true, t);
  for (const t of ["non", "non merci", "pas besoin", "Ok, ne cherche pas"]) assert.equal(lireAccordWeb(t), false, t);

  const id = await nouveauFil();
  await flux(`/api/conversations/${id}/messages`, { text: "Les horaires du musée d'Orsay ?" });
  claude.length = 0;
  glmFlux.length = 0;
  await flux(`/api/conversations/${id}/messages`, { text: "Ok, ne cherche pas" });
  assert.equal(claude.length, 0, "rien ne part chez Claude");
  assert.match(JSON.stringify(glmFlux[0].messages[0]), /préféré que tu ne cherches pas sur le web/);
});

test("l'accord porte sur ce que la carte a montré : un réglage changé entre-temps n'élargit rien", async () => {
  const id = await nouveauFil();
  const demande = (await flux(`/api/conversations/${id}/messages`, { text: "Le programme du cinéma ce soir ?" })).find((e) => e.nom === "autorisation").data;
  assert.equal(demande.contexte, false, "la carte a dit : la question seule");
  await json("PUT", "/api/reglages", { contexteCloud: true }); // changé depuis un autre appareil
  try {
    claude.length = 0;
    await flux(`/api/conversations/${id}/autorisations/${demande.id}`, { accord: true });
    const envoye = claude.find((b) => b.stream);
    assert.ok(envoye);
    assert.ok(!JSON.stringify(envoye).includes(SECRET_MEMOIRE), "toujours la question seule");
    assert.deepEqual(envoye.messages.map((m) => m.role), ["user"]);
  } finally {
    await json("PUT", "/api/reglages", { contexteCloud: false });
  }
});

test("outils web : seulement pour une recherche autorisée ; jamais la liste Motion en « question seule »", async () => {
  const { getProvider, _outilsClient } = await import("../lib/providers.js");
  claude.length = 0;
  const p = getProvider();
  await p.stream({ system: [{ type: "text", text: "x" }], messages: [{ role: "user", content: "q" }], onText() {} });
  const sansAccord = claude.at(-1);
  assert.equal((sansAccord.tools || []).some((t) => /web_(search|fetch)/.test(t.name)), false, "secours, refus, tâches : pas de web");
  await p.stream({ system: [{ type: "text", text: "x" }], messages: [{ role: "user", content: "q" }], onText() {}, web: true });
  assert.ok(claude.at(-1).tools.some((t) => t.name === "web_search"), "recherche autorisée : web");
  process.env.MOTION_API_KEY = "faux-pour-ce-test";
  try {
    const noms = (o) => _outilsClient(false, o).map((t) => t.name);
    assert.ok(noms({}).includes("motion_lister"));
    assert.equal(noms({ lectureMotion: false }).includes("motion_lister"), false);
  } finally {
    delete process.env.MOTION_API_KEY;
  }
});
