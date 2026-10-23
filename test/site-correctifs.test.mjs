// Correctifs du site (24/10), relevés par la piste « parcours » : le coût
// affiché sous une réponse du modèle local, la carte de règle prise pour une
// proposition Motion, la file du quota Motion invisible, la capture courte.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

// Un faux modèle local au nom inconnu de la grille tarifaire (« DeepSeek-… »),
// qui dit son usage : c'est lui qu'on facturait au prix d'Opus.
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "DeepSeek-V4.1-Flash-1017", max_model_len: 131072 }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ model: "DeepSeek-V4.1-Flash-1017", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 9000, completion_tokens: 300 } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ model: "DeepSeek-V4.1-Flash-1017", ...delta({ content: "Tu as deux rendez-vous cet après-midi." }) })}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9000, completion_tokens: 300 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_CERVEAU"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const store = await import("../lib/store.js");
const { appliquer } = await import("../lib/ecriture.js");
const { estimerFile, etatFileMotion } = await import("../lib/motion.js");
const { corrigerCoutsLocaux, modeleFacture } = await import("../lib/pricing.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fermer(); fs.rmSync(dossier, { recursive: true, force: true }); });

const envoyer = (m, chemin, corps) => fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
const evenements = (brut) => brut.split("\n\n").filter(Boolean).map((b) => ({ nom: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || "null") }));

test("RÉGRESSION : une réponse du modèle local coûte 0 $, sous le message comme dans le panneau", async () => {
  const c = await (await envoyer("POST", "/api/conversations")).json();
  const evts = evenements(await (await envoyer("POST", `/api/conversations/${c.id}/messages`, { text: "Qu'est-ce que j'ai cet après-midi ?" })).text());
  const fin = evts.find((e) => e.nom === "done")?.data;
  assert.ok(fin, JSON.stringify(evts.map((e) => e.nom)));
  assert.equal(fin.usd, 0, `coût affiché : ${fin.usd} $ pour ${fin.model}`);
  const lue = await (await envoyer("GET", `/api/conversations/${c.id}`)).json();
  assert.equal(lue.messages.at(-1).role, "assistant");
  assert.equal(lue.messages.at(-1).usd, 0, "enregistré à 0 $ aussi");
});

test("les réponses locales déjà enregistrées avec un prix d'Opus s'affichent à 0 $ ; Claude garde le sien", async () => {
  await store.putConversation({ id: "c-couts", title: "x", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "user", content: "a" },
    { role: "assistant", content: "b", model: "DeepSeek-V4.1-Flash-1017", tier: "reflexe", usd: 0.0512 },
    { role: "user", content: "c" },
    { role: "assistant", content: "d", model: "zai-org/GLM-5.3", tier: "raisonnement", usd: 0.03 },
    { role: "user", content: "e" },
    { role: "assistant", content: "f", model: "claude-sonnet-5", tier: "dégradé", usd: 0.0123 },
  ] });
  const lue = await (await envoyer("GET", "/api/conversations/c-couts")).json();
  assert.deepEqual(lue.messages.filter((m) => m.role === "assistant").map((m) => m.usd), [0, 0, 0.0123]);
  assert.equal(modeleFacture("claude-haiku-4-5"), true);
  assert.equal(modeleFacture("GLM-5.3"), false);
  assert.equal(corrigerCoutsLocaux(null), null, "rien à corriger : pas d'erreur");
});

test("RÉGRESSION : une règle appliquée comme Motion dit « une règle de Rémy », jamais « undefined »", async () => {
  await store.putConversation({ id: "c-regle", title: "x", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "user", content: "Avant chaque sortie, rappelle-moi de me raser." },
    { role: "assistant", content: "Je te propose cette règle.", proposal: { id: "p-regle", source: "regle", resume: "", statut: "en_attente",
      actions: [{ type: "regle", nom: "Rasage avant une sortie", mots: ["sortie"], tache: { nom: "Rasage", duree: 15, priorite: "MEDIUM" }, avantMin: 180, description: "Avant un événement « sortie » : « Rasage » (15 min), au plus tard 3 h avant." }] } },
  ] });
  await assert.rejects(
    appliquer({ source: "motion", convId: "c-regle", propositionId: "p-regle", executer: async () => [] }),
    (err) => {
      assert.equal(err.message, "Cette proposition concerne une règle de Rémy, pas Motion.");
      return true;
    },
  );
  // La route que la carte « Nouvelle règle » du site appelle.
  const r = await envoyer("POST", "/api/conversations/c-regle/propositions/p-regle/regle", {});
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.statut, "applique");
  const lue = await (await envoyer("GET", "/api/conversations/c-regle")).json();
  assert.equal(lue.messages[1].proposal.statut, "applique", "la carte se redessine « Règle créée » au rechargement");
});

test("la file du quota Motion : combien de requêtes attendent, et pour combien de temps", () => {
  const t = 1_000_000;
  // Fenêtre libre : pas d'attente.
  assert.deepEqual(estimerFile({ appels: [t - 5_000], enAttente: 0, quota: 12, maintenant: t }), { quota: 12, enAttente: 0, attenteMs: 0, pause429: 0 });
  // 12 requêtes depuis 40 s (une toutes les 2 s), 1 en file : elle part quand
  // la plus ancienne sort de la fenêtre, dans 20 s.
  const pleine = Array.from({ length: 12 }, (_, i) => t - 40_000 + i * 2_000);
  assert.equal(estimerFile({ appels: pleine, enAttente: 1, quota: 12, maintenant: t }).attenteMs, 20_000);
  // 3 en file : la troisième attend la sortie de la troisième plus ancienne.
  assert.equal(estimerFile({ appels: pleine, enAttente: 3, quota: 12, maintenant: t }).attenteMs, 24_000);
  // 13 en file au-delà d'une fenêtre pleine : la 13e attend une minute de plus.
  assert.equal(estimerFile({ appels: pleine, enAttente: 13, quota: 12, maintenant: t }).attenteMs, 80_000);
  // Les requêtes de plus d'une minute ne comptent plus.
  assert.equal(estimerFile({ appels: [t - 61_000, t - 70_000], enAttente: 1, quota: 2, maintenant: t }).attenteMs, 0);
  // Motion a répondu 429 : la pause annoncée l'emporte.
  const p = estimerFile({ appels: [], enAttente: 1, quota: 12, pause429: t + 15_000, maintenant: t });
  assert.equal(p.pause429, 15_000);
  assert.equal(p.attenteMs, 15_000);
  assert.deepEqual(Object.keys(etatFileMotion()).sort(), ["attenteMs", "enAttente", "pause429", "quota"]);
});

test("GET /api/motion/file répond sans appeler Motion", async () => {
  const r = await envoyer("GET", "/api/motion/file");
  assert.equal(r.status, 200);
  const f = await r.json();
  assert.equal(f.enAttente, 0);
  assert.equal(f.attenteMs, 0);
  assert.equal(typeof f.quota, "number");
});

test("/api/setup dit le cerveau : le site n'annonce pas « quelques centimes » pour un appel local", async () => {
  const d = await (await envoyer("GET", "/api/setup")).json();
  assert.equal(d.cerveau, "local");
});

test("capture courte « Retenir » : la note choisie par Sam passe le seuil des 30 caractères", async () => {
  const { nettoyerCapture, texteChoisi } = await import("../lib/capture.js");
  assert.ok(nettoyerCapture("Piles AAA").raison, "le texte brut court reste refusé");
  const { capture } = nettoyerCapture(texteChoisi(["Piles AAA"], "note"), { choisi: true });
  assert.ok(capture, "la même note, choisie, est acceptée");
  assert.match(capture.texte, /- Piles AAA/);
});
