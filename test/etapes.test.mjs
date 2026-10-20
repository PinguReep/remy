// La petite barre du chat (19/10) : pendant qu'il répond, Rémy dit ce qu'il
// fait (contexte, modèle, réflexion, écriture), avec le temps écoulé, et un
// extrait de sa réflexion au plus toutes les 1,5 s — lisible à l'œil nu.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

const { extraitPensee, suiviReflexion, suiviEtapes } = await import("../lib/etapes.js");

test("l'extrait de réflexion tient sur une ligne et finit sur la pensée en cours", () => {
  assert.equal(extraitPensee("  Je regarde\nle planning  "), "Je regarde le planning");
  const long = "mot ".repeat(80) + "donc je propose demain matin";
  const e = extraitPensee(long);
  assert.ok(e.length <= 141, e.length);
  assert.ok(e.startsWith("…"));
  assert.ok(e.endsWith("donc je propose demain matin"));
});

test("la réflexion n'est montrée qu'une fois toutes les 1,5 s, quel que soit le débit", () => {
  let t = 0;
  const vus = [];
  const suivre = suiviReflexion((x) => vus.push(x), () => t);
  for (let i = 0; i < 40; i++) {
    suivre(`morceau${i} `);
    t += 100; // dix morceaux par seconde
  }
  // 4 s de réflexion : 0 ; 1,5 ; 3,0 → 3 mises à jour, pas 40.
  assert.equal(vus.length, 3);
  assert.match(vus.at(-1), /morceau30/);
});

test("chaque étape porte sa clé et le temps écoulé", () => {
  let t = 1000;
  const evts = [];
  const etape = suiviEtapes((nom, d) => evts.push([nom, d]), () => t);
  etape("contexte", "Rémy relit…");
  t += 250;
  etape("reflexion", "Rémy réfléchit…", "je compare deux créneaux");
  assert.deepEqual(evts, [
    ["status", { text: "Rémy relit…", cle: "contexte", t: 0 }],
    ["status", { text: "Rémy réfléchit…", cle: "reflexion", t: 250, detail: "je compare deux créneaux" }],
  ]);
  assert.equal(etape.courante(), "reflexion");
});

// --- De bout en bout : un faux modèle local qui réfléchit, puis écrit. --------
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
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
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const m of ["Il ", "demande ", "un ", "conseil."]) res.write(`data: ${JSON.stringify(delta({ reasoning_content: m }))}\n\n`);
    for (const m of ["Bon", "jour"]) res.write(`data: ${JSON.stringify(delta({ content: m }))}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-etapes-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

test("une réponse dit ses étapes dans l'ordre, sans répéter « écrit » à chaque mot", async () => {
  const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  const c = await (await post("/api/conversations", {})).json();
  const brut = await (await post(`/api/conversations/${c.id}/messages`, { text: "Un conseil ?" })).text();
  const evts = brut.split("\n\n").filter(Boolean).map((b) => ({ nom: b.match(/^event: (.+)$/m)?.[1], data: JSON.parse(b.match(/^data: (.+)$/m)?.[1] || "null") }));
  assert.ok(evts.some((e) => e.nom === "done"), JSON.stringify(evts.find((e) => e.nom === "error")));
  const etapes = evts.filter((e) => e.nom === "status").map((e) => e.data);
  const cles = etapes.map((e) => e.cle);
  assert.deepEqual(cles, ["contexte", "choix", "modele", "reflexion", "ecrit"]);
  assert.ok(etapes.every((e) => typeof e.text === "string" && e.text.length > 0), "les anciennes apps lisent text");
  assert.ok(etapes.every((e, i) => i === 0 || e.t >= etapes[i - 1].t), "le temps avance");
  assert.equal(etapes.find((e) => e.cle === "reflexion").detail, "Il");
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("etapes-v1"));
});
