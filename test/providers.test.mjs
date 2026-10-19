// `complete()` face à un vrai serveur HTTP qui parle comme l'API Anthropic.
// C'est ici que la panne de production s'était logée : une réponse composée
// UNIQUEMENT d'un bloc `thinking` traversait le filtre `type === "text"` et
// ressortait en chaîne vide, sans que rien ne dise pourquoi.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Un faux serveur Anthropic : il note le corps reçu et rend ce qu'on lui dit.
let reponse = { content: [], stop_reason: "end_turn", model: "faux", usage: {} };
let recu = null;
const serveur = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    recu = JSON.parse(body || "{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", ...reponse }));
  });
});
await new Promise((r) => serveur.listen(0, r));

process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${serveur.address().port}`;
process.env.REMY_PROVIDER = "api";

const { getProvider } = await import("../lib/providers.js");
const provider = getProvider();

test.after(() => serveur.close());

const bloc = (type, valeur) => (type === "text" ? { type, text: valeur } : { type, thinking: valeur });

test("sans options, la requête reste celle d'avant", async () => {
  reponse = { content: [bloc("text", "ok")], stop_reason: "end_turn", model: "m", usage: {} };
  const r = await provider.complete({ system: "s", prompt: "p", model: "claude-sonnet-5" });
  assert.equal(recu.thinking, undefined);
  assert.equal(recu.output_config, undefined);
  assert.equal(recu.model, "claude-sonnet-5");
  assert.equal(r.text, "ok");
});

test("le schéma et l'effort partent bien dans output_config", async () => {
  const schema = { type: "object", properties: {}, additionalProperties: false };
  reponse = { content: [bloc("text", "{}")], stop_reason: "end_turn", model: "m", usage: {} };
  await provider.complete({ system: "s", prompt: "p", schema, effort: "medium", maxTokens: 12000 });
  assert.deepEqual(recu.output_config, { effort: "medium", format: { type: "json_schema", schema } });
  assert.equal(recu.max_tokens, 12000);
});

test("la réflexion coupée part bien dans la requête", async () => {
  reponse = { content: [bloc("text", "{}")], stop_reason: "end_turn", model: "m", usage: {} };
  await provider.complete({ system: "s", prompt: "p", thinking: { type: "disabled" }, effort: "low" });
  assert.deepEqual(recu.thinking, { type: "disabled" });
  assert.deepEqual(recu.output_config, { effort: "low" });
});

test("RÉGRESSION : une réponse 100 % réflexion est signalée, pas silencieuse", async () => {
  reponse = { content: [bloc("thinking", "…")], stop_reason: "max_tokens", model: "m", usage: {} };
  const r = await provider.complete({ system: "s", prompt: "p" });
  assert.equal(r.text, "");
  // Sans ces deux-là, impossible de distinguer un refus d'une coupure : c'est
  // exactement ce qui a fait diagnostiquer la panne deux fois à côté.
  assert.equal(r.stopReason, "max_tokens");
  assert.deepEqual(r.blocs, ["thinking"]);
});

test("réflexion puis texte : seul le texte est rendu", async () => {
  reponse = {
    content: [bloc("thinking", "je réfléchis"), bloc("text", '{"tete":[]}')],
    stop_reason: "end_turn",
    model: "m",
    usage: { input_tokens: 5, output_tokens: 7 },
  };
  const r = await provider.complete({ system: "s", prompt: "p" });
  assert.equal(r.text, '{"tete":[]}');
  assert.deepEqual(r.blocs, ["thinking", "text"]);
  assert.equal(r.usage.output_tokens, 7);
});

test("un refus ne rend pas de texte", async () => {
  reponse = { content: [bloc("text", "je préfère ne pas")], stop_reason: "refusal", model: "m", usage: {} };
  const r = await provider.complete({ system: "s", prompt: "p" });
  assert.equal(r.text, "");
  assert.equal(r.stopReason, "refusal");
});
