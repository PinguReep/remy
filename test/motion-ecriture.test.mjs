// Écriture Motion face à un faux serveur qui se comporte comme le vrai depuis
// octobre 2026 : PATCH /tasks/:id refuse `workspaceId` (« property workspaceId
// should not exist »). Cocher une tâche depuis l'iPhone échouait (08/10/2026).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const patchs = [];
let statutT1 = "Todo";
const crees = [];
const serveur = http.createServer((req, res) => {
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
    if (u.pathname.endsWith("/schedules")) return json(200, [{ name: "Footing" }, { name: "Working hours" }]);
    if (u.pathname.endsWith("/tasks") && req.method === "POST") {
      crees.push(JSON.parse(corps || "{}"));
      return json(200, { id: "t9" });
    }
    if (u.pathname.endsWith("/tasks") && req.method === "GET") return json(200, { tasks: [], meta: {} });
    if (u.pathname.endsWith("/tasks/t1") && req.method === "GET") {
      return json(200, {
        id: "t1",
        name: "Appeler le garagiste",
        status: { name: statutT1 },
        workspace: { id: "w2", statuses: [{ name: "Todo" }, { name: "Terminé", isResolvedStatus: true }] },
      });
    }
    if (u.pathname.endsWith("/tasks/t1") && req.method === "PATCH") {
      const b = JSON.parse(corps || "{}");
      patchs.push(b);
      if ("workspaceId" in b) {
        return json(400, { message: ["property workspaceId should not exist"], error: "Bad Request", statusCode: 400 });
      }
      if (b.status) statutT1 = b.status; // comme le vrai Motion : le statut reste
      return json(200, { id: "t1", ...b });
    }
    json(404, { message: "introuvable" });
  });
});
await new Promise((r) => serveur.listen(0, r));

process.env.MOTION_API_KEY = "cle-de-test";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
const { applyActions, undoResults } = await import("../lib/motion.js");

test.after(() => serveur.close());

test("RÉGRESSION : terminer une tâche n'envoie plus workspaceId, avec le statut fini de SON espace", async () => {
  patchs.length = 0;
  const [r] = await applyActions([{ type: "terminer", id: "t1", nom: "Appeler le garagiste" }]);
  assert.equal(r.ok, true, r.erreur);
  assert.deepEqual(patchs, [{ name: "Appeler le garagiste", status: "Terminé" }]);
});

test("l'annulation restaure sans workspaceId non plus", async () => {
  patchs.length = 0;
  statutT1 = "Todo";
  const [r] = await applyActions([{ type: "terminer", id: "t1", nom: "Appeler le garagiste" }]);
  const [u] = await undoResults([r]);
  assert.equal(u.ok, true, u.erreur);
  assert.equal(patchs.length, 2);
  assert.ok(!("workspaceId" in patchs[1]));
  assert.equal(patchs[1].status, "Todo");
});

test("RÉGRESSION : une tâche créée part dans un horaire qui existe chez Sam (« Working hours »)", async () => {
  crees.length = 0;
  const [r] = await applyActions([{ type: "creer", nom: "Appeler le garage", duree: "15" }]);
  assert.equal(r.ok, true, r.erreur);
  assert.equal(crees[0].autoScheduled.schedule, "Working hours");
});
