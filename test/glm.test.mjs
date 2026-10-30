// Le cerveau local (GLM-5.3 des Sparks) face à un faux serveur qui parle comme
// tensorfold : flux SSE OpenAI, réflexion à part, appels d'outils découpés en
// morceaux. Et les garde-fous qui protègent la mémoire de Sam.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let script = []; // une liste de tours ; chaque tour = liste d'événements SSE (ou { status })
let recus = [];
const serveur = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3-Flash-EXL3" }] }));
    }
    const b = JSON.parse(body || "{}");
    recus.push({ corps: b, auth: req.headers.authorization });
    const tour = script.shift() || [];
    if (tour.status) {
      res.writeHead(tour.status, { "Content-Type": "application/json" });
      return res.end(tour.corps || "{}");
    }
    if (!b.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(tour));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const e of tour) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => serveur.listen(0, r));

process.env.REMY_GLM_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
process.env.REMY_GLM_TOKEN = "jeton-de-test";
process.env.MOTION_API_KEY = "cle"; // l'outil motion_proposer est proposé au modèle

const { glmProvider, GlmError, verifierGlm } = await import("../lib/providers.js");
const { memoireCredible } = await import("../lib/chat.js");
const { _oublierFormatsRefuses } = await import("../lib/glm.js");

test.after(() => serveur.close());

const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });

test("texte en flux, réflexion signalée mais jamais montrée, jeton envoyé", async () => {
  script = [[delta({ reasoning_content: "Je pense…" }), delta({ content: "Bon" }), delta({ content: "jour" }, "stop"), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }]];
  recus = [];
  let vu = "";
  const signaux = [];
  const r = await glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "salut" }], onText: (t) => (vu += t), onTool: (i) => signaux.push(i.type) });
  assert.equal(vu, "Bonjour");
  assert.equal(r.text, "Bonjour");
  assert.equal(r.model, "GLM-5.3-Flash", "le libellé suit le modèle servi");
  assert.deepEqual(r.usage.input_tokens, 12);
  assert.deepEqual(signaux, ["reflexion"]);
  assert.equal(recus[0].auth, "Bearer jeton-de-test");
  assert.equal(recus[0].corps.chat_template_kwargs.enable_thinking, true);
});

test("un appel d'outil découpé en morceaux devient une proposition, et le texte suivant ne se colle pas", async () => {
  const args = JSON.stringify({ resume: "Ajout", actions: [{ type: "creer", nom: "Banque" }, { type: "supprimer", nom: "x" }] });
  script = [
    [
      delta({ content: "Je te propose ça." }),
      delta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "motion_", arguments: args.slice(0, 20) } }] }),
      delta({ tool_calls: [{ index: 0, function: { name: "proposer", arguments: args.slice(20) } }] }, "tool_calls"),
    ],
    [delta({ content: "Valide d'un tap." }, "stop")],
  ];
  recus = [];
  let propositions = [];
  let vu = "";
  const r = await glmProvider.stream({
    system: "sys",
    messages: [{ role: "user", content: "crée Banque" }],
    onText: (t) => (vu += t),
    onTool: (i) => i.type === "motion" && propositions.push(i),
  });
  assert.equal(propositions.length, 1);
  // « supprimer » n'est pas un verbe Motion : filtré par le code, pas par le modèle.
  assert.deepEqual(propositions[0].actions.map((a) => a.type), ["creer"]);
  assert.equal(vu, "Je te propose ça.\n\nValide d'un tap.");
  assert.equal(r.text, vu);
  // Le second tour renvoie au modèle le résultat de l'outil.
  const second = recus[1].corps.messages;
  assert.equal(second.at(-1).role, "tool");
  assert.equal(second.at(-1).tool_call_id, "call_1");
  assert.match(second.at(-1).content, /proposition_affichee/);
});

test("jeton refusé : erreur explicite, marquée « avant texte » (Claude peut reprendre)", async () => {
  script = [{ status: 401 }];
  await assert.rejects(
    glmProvider.stream({ system: "s", messages: [{ role: "user", content: "x" }], onText: () => {} }),
    (err) => err instanceof GlmError && err.avantTexte && /jeton du relais refusé/.test(err.message),
  );
});

test("complete() coupe la réflexion et retire un <think> resté en clair", async () => {
  script = [{ choices: [{ message: { content: "<think>hmm</think>reflexe" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }];
  recus = [];
  const r = await glmProvider.complete({ system: "s", prompt: "p", maxTokens: 10 });
  assert.equal(r.text, "reflexe");
  assert.equal(recus[0].corps.chat_template_kwargs.enable_thinking, false);
});

// Le moteur qui sert DeepSeek-V4.1-Flash (29/10) refuse response_format en 400 :
// le conseil, les captures et la nuit tombaient tous en erreur.
const REFUS_FORMAT = JSON.stringify({ error: { message: "structured output (response_format and the guided_* fields) is not supported by this engine yet", type: "invalid_request_error" } });
const reponse = (contenu) => ({ choices: [{ message: { content: contenu }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } });

test("format imposé refusé : le schéma passe dans la consigne, et le refus est retenu", async () => {
  _oublierFormatsRefuses();
  const schema = { type: "object", properties: { texte: { type: "string" } }, required: ["texte"] };
  script = [{ status: 400, corps: REFUS_FORMAT }, reponse('{"texte":"Fais la banque"}'), reponse('{"texte":"Pause"}')];
  recus = [];
  const r = await glmProvider.complete({ system: "Tu conseilles Sam.", prompt: "Situation", schema });
  assert.equal(r.text, '{"texte":"Fais la banque"}');
  assert.equal(recus.length, 2, "un seul nouvel essai");
  assert.ok(recus[0].corps.response_format, "d'abord le format imposé");
  assert.equal(recus[1].corps.response_format, undefined, "puis sans");
  const consigne = recus[1].corps.messages[0].content;
  assert.match(consigne, /^Tu conseilles Sam\./);
  assert.match(consigne, /objet JSON valide/);
  assert.ok(consigne.includes(JSON.stringify(schema)), "le schéma est dit en clair");
  // L'appel suivant ne repaie pas le 400.
  const r2 = await glmProvider.complete({ system: "s", prompt: "p", schema });
  assert.equal(r2.text, '{"texte":"Pause"}');
  assert.equal(recus.length, 3);
  assert.equal(recus[2].corps.response_format, undefined);
  // Sans schéma, rien ne change.
  script = [reponse("ok")];
  await glmProvider.complete({ system: "s", prompt: "p" });
  assert.equal(recus[3].corps.messages[0].content, "s");
  _oublierFormatsRefuses();
});

test("une autre erreur du modèle se lit en clair, jamais en JSON brut", async () => {
  script = [{ status: 400, corps: JSON.stringify({ error: { message: "max_tokens is too large", type: "invalid_request_error" } }) }];
  await assert.rejects(glmProvider.complete({ system: "s", prompt: "p" }), (err) => {
    assert.match(err.message, /réponse 400 \(max_tokens is too large\)/);
    assert.doesNotMatch(err.message, /[{}"]/);
    return true;
  });
});

test("la santé dit joignable avec l'identifiant servi", async () => {
  const v = await verifierGlm({ maxAgeMs: 0 });
  assert.equal(v.ok, true);
  assert.match(v.verdict, /GLM-5.3-Flash-EXL3/);
});

test("mémoire : une réécriture coupée ou amputée n'écrase jamais l'ancienne", () => {
  const avant = "## A\n- a\n## B\n- b\n## C\n- c\n## D\n- d\n" + "x".repeat(2000);
  assert.equal(memoireCredible(avant, avant + "\n- nouveau", "end_turn"), true);
  assert.equal(memoireCredible(avant, avant, "max_tokens"), false);
  assert.equal(memoireCredible(avant, "## A\n- a", "end_turn"), false);
  assert.equal(memoireCredible("", "## Identité\n- Sam", "end_turn"), true);
});
