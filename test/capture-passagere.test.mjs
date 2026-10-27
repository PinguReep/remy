// La file d'envoi de l'iPhone face à une panne passagère de Motion (25/10).
//
// Une tâche notée hors ligne part plus tard avec sa clé (idCommande). Si
// Motion est en panne ou en quota à ce moment-là, la tour le dit avec la
// `nature` de l'échec : l'iPhone la renvoie seul plus tard (au lieu de la
// garder « refusée »), et la tour la refait une fois — jamais deux tâches.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

let reponseCreation = 503;
const creees = [];
const motion = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const json = (code, v) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (u.pathname.endsWith("/workspaces")) return json(200, { workspaces: [{ id: "w1", name: "Perso" }], meta: {} });
    if (u.pathname.endsWith("/statuses")) return json(200, [{ name: "Done", isResolvedStatus: true }]);
    if (u.pathname.endsWith("/schedules")) return json(200, [{ name: "Working hours" }]);
    if (u.pathname.endsWith("/tasks") && req.method === "GET") return json(200, { tasks: [], meta: {} });
    if (u.pathname.endsWith("/tasks") && req.method === "POST") {
      if (reponseCreation !== 200) return json(reponseCreation, { message: "indisponible" });
      creees.push(JSON.parse(corps || "{}"));
      return json(200, { id: `t${creees.length}` });
    }
    json(404, { message: "introuvable" });
  });
});
await new Promise((r) => motion.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-capture-passagere-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "cle-de-test";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${motion.address().port}/v1`;
const { applyActions } = await import("../lib/motion.js");
const { appliquer } = await import("../lib/ecriture.js");
const { fermer } = await import("../lib/db.js");
test.after(() => {
  motion.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const demande = (idCommande, nom) => ({ source: "motion", actions: [{ type: "creer", nom }], idCommande, origine: "tap", executer: applyActions });

test("Motion en panne : l'échec dit sa nature (passagère), et la même clé renvoyée crée la tâche une seule fois", async () => {
  reponseCreation = 503;
  const d = demande("AAAAAAAA-0000-4000-8000-0000000000a1", "Appeler le garage");
  const r1 = await appliquer(d);
  assert.equal(r1.echecs, 1);
  assert.equal(r1.results[0].ok, false);
  assert.equal(r1.results[0].nature, "serveur", "l'iPhone y lit : ça passera, renvoie seul");
  assert.equal(creees.length, 0);

  reponseCreation = 200;
  const r2 = await appliquer(d);
  assert.equal(r2.ok, true, "renvoyée après la panne : la tour la refait");
  assert.equal(creees.length, 1);
  const r3 = await appliquer(d);
  assert.equal(r3.rejoue, true, "renvoyée encore : la même réponse, rien de refait");
  assert.equal(creees.length, 1, "jamais deux tâches");
});

test("un vrai refus de Motion dit aussi sa nature : il attendra Sam", async () => {
  reponseCreation = 400;
  const r = await appliquer(demande("AAAAAAAA-0000-4000-8000-0000000000a2", "Nom refusé"));
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[0].nature, "refus");
});
