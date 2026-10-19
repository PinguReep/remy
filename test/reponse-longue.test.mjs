// Une très longue demande (19/10 : ~8 min de dictée) : GLM réfléchissait
// jusqu'à la coupure sèche des 5 min, et Sam n'avait rien — avec « le modèle
// local ne répond pas », alors qu'il tournait. Désormais : au budget, une
// réflexion qui n'a rien écrit est arrêtée et Rémy conclut à partir de ses
// notes ; coupée en pleine écriture, la réponse est gardée et dite ; et
// l'erreur, s'il en reste une, dit la vérité.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
let scenario = "reflexion";
const requetes = [];
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", async () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3" }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }));
    }
    requetes.push(corps);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let ferme = false;
    res.on("close", () => (ferme = true));
    const ecrire = (d) => !ferme && res.write(`data: ${JSON.stringify(d)}\n\n`);
    const pense = corps.chat_template_kwargs?.enable_thinking;
    // Chaque scénario écrit pendant 8 s au plus, sauf si Rémy coupe avant.
    for (let i = 0; i < 80 && !ferme; i++) {
      if (scenario === "reflexion" && !pense) break; // la conclusion part tout de suite
      if (scenario === "reflexion") ecrire(delta({ reasoning_content: "je pense au rasage avant chaque sortie " }));
      else if (scenario === "ecriture") ecrire(delta({ content: "mot " }));
      else ecrire(delta({})); // « muet » : rien de visible, jamais
      await new Promise((r) => setTimeout(r, 100));
    }
    if (ferme) return;
    if (scenario === "reflexion") ecrire(delta({ content: "Voilà l'essentiel." }));
    ecrire(delta({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-longue-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";
process.env.REMY_BUDGET_MS = "600";
process.env.REMY_MARGE_MS = "900";

const { routeApi } = await import("../lib/routes.js");
const { verifierGlm } = await import("../lib/glm.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const evenements = (brut) => brut.split("\n\n").filter(Boolean).map((b) => ({ nom: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || "null") }));
async function demander(texte) {
  const c = await (await post("/api/conversations", {})).json();
  const evts = evenements(await (await post(`/api/conversations/${c.id}/messages`, { text: texte })).text());
  return { c, evts };
}

test("une réflexion qui dépasse le budget est arrêtée, et Rémy conclut à partir de ses notes", async () => {
  scenario = "reflexion";
  requetes.length = 0;
  const { evts } = await demander("Une très longue dictée…");
  const done = evts.find((e) => e.nom === "done");
  assert.ok(done, JSON.stringify(evts.find((e) => e.nom === "error")));
  assert.equal(done.data.text, "Voilà l'essentiel.");
  const budget = evts.find((e) => e.nom === "status" && e.data.cle === "budget");
  assert.match(budget.data.text, /Réflexion trop longue/);
  assert.equal(requetes.length, 2);
  const conclusion = requetes[1];
  assert.equal(conclusion.chat_template_kwargs.enable_thinking, false, "plus de réflexion pour conclure");
  assert.equal(conclusion.tools, undefined, "plus d'outil");
  const [notes, relance] = conclusion.messages.slice(-2);
  assert.equal(notes.role, "assistant");
  assert.match(notes.content, /rasage avant chaque sortie/, "ses notes lui sont rendues");
  assert.match(relance.content, /Réponds MAINTENANT/);
  assert.equal(done.data.mesures.estime, true, "la réflexion coupée n'a pas été comptée par le modèle");
});

test("coupée en pleine écriture : la réponse est gardée, et dite", async () => {
  scenario = "ecriture";
  const { c, evts } = await demander("Raconte-moi tout.");
  const done = evts.find((e) => e.nom === "done");
  assert.ok(done, JSON.stringify(evts.find((e) => e.nom === "error")));
  assert.match(done.data.text, /^mot mot /);
  assert.match(done.data.text, /\*\(coupée : réponse trop longue\)\*$/);
  const conv = await (await fetch(`${base}/api/conversations/${c.id}`)).json();
  assert.equal(conv.messages.at(-1).content, done.data.text, "enregistrée, pas perdue");
});

test("rien d'écrit à l'échéance : une erreur qui dit la vérité, et GLM n'est pas déclaré en panne", async () => {
  scenario = "muet";
  const { c, evts } = await demander("Encore ?");
  const err = evts.find((e) => e.nom === "error");
  assert.ok(err, "une erreur");
  assert.match(err.data.message, /sans finir sa réponse/);
  assert.match(err.data.message, /Le modèle local tourne bien/);
  assert.doesNotMatch(err.data.message, /ne répond pas/);
  const v = await verifierGlm();
  assert.equal(v.ok, true, JSON.stringify(v));
  const conv = await (await fetch(`${base}/api/conversations/${c.id}`)).json();
  assert.equal(conv.messages.at(-1)?.role, undefined, "la question est retirée : « Réessayer » la renvoie proprement");
  // Un code à transmettre, et un incident sans contenu sur la tour.
  assert.match(err.data.code, /^R-[2-9A-HJKMNP-Z]{5}$/);
  const inc = await (await fetch(`${base}/api/incidents/${err.data.code}`)).json();
  assert.equal(inc.code, err.data.code);
  assert.equal(inc.type, "chat");
  assert.equal(inc.conversation, c.id);
  assert.equal(inc.erreur.nature, "delai");
  assert.equal(inc.questionCaracteres, "Encore ?".length);
  assert.equal(inc.fournisseur, "glm");
  assert.ok(inc.etapes.some((e) => e.cle === "modele"));
  assert.ok(inc.dureeMs >= 1000);
  assert.doesNotMatch(JSON.stringify(inc), /Encore \?/, "jamais le texte de la question");
  const liste = await (await fetch(`${base}/api/incidents`)).json();
  assert.equal(liste.incidents[0].code, err.data.code, "le plus récent d'abord");
  assert.equal((await fetch(`${base}/api/incidents/R-00000`)).status, 400, "forme refusée");
  assert.equal((await fetch(`${base}/api/incidents/R-22222`)).status, 404);
});

test("une erreur de route a aussi son code, sans la requête (qui peut porter ce que Sam cherchait)", async () => {
  const { noterIncident, lireIncident } = await import("../lib/incidents.js");
  const code = noterIncident({ type: "route", route: "GET /api/x", erreur: Object.assign(new Error("boum ".repeat(100)), { status: 500 }) });
  const e = lireIncident(code.toLowerCase());
  assert.equal(e.erreur.statut, 500);
  assert.ok(e.erreur.message.length <= 300, "message technique borné");
});
