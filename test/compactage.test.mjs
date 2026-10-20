// Compacter une longue conversation (19/10) : son début est résumé par GLM,
// en local ; Rémy relit le résumé puis les derniers messages en entier ; rien
// n'est effacé. À la demande, ou tout seul après une réponse qui a rempli
// 70 % du contexte (circuit « compactage », coupable).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
let promptJetons = 2000;
const flux = []; // corps des requêtes de réponse (stream)
const resumes = []; // corps des demandes de résumé
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3-Flash-EXL3", max_model_len: 131072 }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      const resume = String(corps.messages?.[0]?.content || "").startsWith("Tu résumes");
      if (resume) resumes.push(corps);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        choices: [{ message: { content: resume ? `## Ce qui a été dit\n- résumé n°${resumes.length}` : "{}" } }],
        usage: { prompt_tokens: 900, completion_tokens: 40 },
      }));
    }
    flux.push(corps);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(delta({ content: "D'accord." }))}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: promptJetons, completion_tokens: 4 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-compactage-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_GLM_CONTEXTE", "REMY_CIRCUIT_COMPACTAGE"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const store = await import("../lib/store.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const lire = async (id) => (await fetch(`${base}/api/conversations/${id}`)).json();

// Un fil de `n` échanges déjà écrits (questions « Q0 », « Q1 »…).
async function fil(n) {
  const c = await (await post("/api/conversations", {})).json();
  const conv = await store.getConversation(c.id);
  for (let i = 0; i < n; i++) {
    conv.messages.push({ role: "user", content: `Q${i} : une question assez longue sur le projet numéro ${i}.` });
    conv.messages.push({ role: "assistant", content: `R${i} : la réponse de Rémy au point ${i}.` });
  }
  await store.putConversation(conv);
  return c.id;
}

test("à la demande : le début est résumé, la fin gardée, rien n'est effacé — puis Rémy relit le résumé", async () => {
  const id = await fil(5); // 10 messages
  const r = await (await post(`/api/conversations/${id}/compacter`, {})).json();
  assert.equal(r.compacte, true, JSON.stringify(r));
  assert.equal(r.compactage.jusqua, 4, "avant les 6 derniers, sur un message de Sam");
  assert.match(r.compactage.resume, /résumé n°1/);
  const conv = await lire(id);
  assert.equal(conv.messages.length, 10, "rien n'est effacé");
  assert.equal(conv.compactage.jusqua, 4);
  // Le résumé est fait par GLM, sans réflexion, à partir des 4 premiers messages.
  const demande = resumes.at(-1);
  assert.match(demande.messages[1].content, /Q0/);
  assert.match(demande.messages[1].content, /R1/);
  assert.doesNotMatch(demande.messages[1].content, /Q2/);
  // Le message suivant : le résumé dans la consigne, et seulement la suite du fil.
  flux.length = 0;
  const brut = await (await post(`/api/conversations/${id}/messages`, { text: "Et maintenant ?" })).text();
  assert.match(brut, /event: done/);
  const envoye = flux.at(-1).messages;
  assert.match(envoye[0].content, /Plus tôt dans cette conversation \(résumé\)/);
  assert.match(envoye[0].content, /résumé n°1/);
  const textes = envoye.slice(1).map((m) => m.content).join("\n");
  assert.doesNotMatch(textes, /Q0|Q1|R0|R1/, "le début n'est plus relu en entier");
  assert.match(textes, /Q2/);
  assert.match(textes, /Et maintenant \?/);
  // Le coût est journalisé, avec son « kind ».
  const couts = JSON.stringify(await (await fetch(`${base}/api/costs`)).json());
  assert.match(couts, /compaction/);
});

test("rien à résumer : un fil court n'est pas compacté", async () => {
  const id = await fil(2);
  const r = await (await post(`/api/conversations/${id}/compacter`, {})).json();
  assert.equal(r.compacte, false);
  assert.equal(r.raison, "rien-a-resumer");
});

test("tout seul, après une réponse qui a rempli 70 % du contexte — sauf circuit coupé", async () => {
  promptJetons = 100_000; // sur 131 072 : 76 %
  try {
    process.env.REMY_CIRCUIT_COMPACTAGE = "off";
    const coupe = await fil(5);
    await (await post(`/api/conversations/${coupe}/messages`, { text: "Suite ?" })).text();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await lire(coupe)).compactage, undefined, "circuit coupé : rien");

    delete process.env.REMY_CIRCUIT_COMPACTAGE;
    const id = await fil(5);
    await (await post(`/api/conversations/${id}/messages`, { text: "Suite ?" })).text();
    let conv;
    for (let i = 0; i < 40; i++) {
      conv = await lire(id);
      if (conv.compactage) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(conv.compactage, "compacté après la réponse");
    assert.equal(conv.compactage.jusqua, 6, "12 messages : on garde les 6 derniers");
    assert.equal(conv.messages.length, 12);
  } finally {
    promptJetons = 2000;
    delete process.env.REMY_CIRCUIT_COMPACTAGE;
  }
});
