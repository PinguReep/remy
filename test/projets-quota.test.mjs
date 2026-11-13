// La liste des projets est un plus : elle ne prend jamais les dernières places
// du quota de Motion (12 requêtes par minute), gardées pour les gestes de Sam.
// Faux Motion local, aucune donnée réelle.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const taches = [{ id: "a", name: "Retouche des photos", project: { id: "p1", name: "Album « Été »" }, status: { name: "Todo" } }];
const demandes = [];
const serveur = http.createServer((req, res) => {
  const u = new URL(req.url, "http://faux");
  demandes.push(u.pathname + u.search);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (u.pathname === "/v1/workspaces") return res.end(JSON.stringify({ workspaces: [{ id: "w1", name: "Perso" }], meta: {} }));
  if (u.pathname === "/v1/projects") return res.end(JSON.stringify({ projects: [{ id: "p9", name: "Voyage à Porto" }], meta: {} }));
  res.end(JSON.stringify({ tasks: taches, meta: {} }));
});
await new Promise((r) => serveur.listen(0, r));
process.env.MOTION_API_KEY = "cle";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
delete process.env.MOTION_QUOTA_MIN;
const { projetsMotion, motionGetAll } = await import("../lib/motion.js");
test.after(() => serveur.close());

test("quota serré : pas de requête pour les projets, les tâches passent", async () => {
  // Sept requêtes parties dans la minute : il reste cinq places, moins que la réserve des gestes plus la liste.
  for (let i = 0; i < 7; i++) await motionGetAll("/tasks", "tasks");
  demandes.length = 0;
  const r = await projetsMotion();
  assert.deepEqual(demandes, ["/v1/tasks"], "seules les tâches sont lues");
  assert.deepEqual(r.projets.map((p) => p.nom), ["Album « Été »"], "les projets portés par une tâche restent visibles");
});

test("de la place : les projets sont lus, espace par espace", async (t) => {
  // La même minute ne se vide pas pendant un test : l'horloge avance d'une minute.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 61_000 });
  demandes.length = 0;
  const r = await projetsMotion();
  assert.deepEqual(demandes.filter((d) => !d.startsWith("/v1/tasks")), ["/v1/workspaces", "/v1/projects?workspaceId=w1"]);
  assert.ok(r.projets.some((p) => p.nom === "Voyage à Porto"), "un projet sans tâche revient avec la liste");
});
