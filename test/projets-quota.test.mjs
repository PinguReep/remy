// La liste des projets et le quota de Motion (12 requêtes par minute), compté
// au plus juste : connaître les espaces ne coûte rien, un seul espace coûte une
// requête comme avant, et plusieurs espaces ne prennent jamais les places
// gardées pour les gestes de Sam. Faux Motion local, aucune donnée réelle.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let taches = [{ id: "a", name: "Retouche des photos", project: { id: "p1", name: "Album « Été »" }, status: { name: "Todo" }, workspace: { id: "w1" } }];
const parEspace = { w1: [{ id: "p1", name: "Album « Été »" }], w2: [{ id: "p2", name: "Sites vitrines" }], w3: [{ id: "p3", name: "Voyage à Porto" }] };
const demandes = [];
const serveur = http.createServer((req, res) => {
  const u = new URL(req.url, "http://faux");
  demandes.push(u.pathname + u.search);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (u.pathname === "/v1/workspaces") return res.end(JSON.stringify({ workspaces: [{ id: "w1", name: "Perso" }, { id: "w2", name: "Travail" }, { id: "w3", name: "Voyages" }], meta: {} }));
  if (u.pathname === "/v1/statuses") return res.end(JSON.stringify([{ name: "Todo" }, { name: "Completed", isResolvedStatus: true }]));
  if (u.pathname === "/v1/projects") return res.end(JSON.stringify({ projects: parEspace[u.searchParams.get("workspaceId")] || [], meta: {} }));
  res.end(JSON.stringify({ tasks: taches, meta: {} }));
});
await new Promise((r) => serveur.listen(0, r));
process.env.MOTION_API_KEY = "cle";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
process.env.MOTION_WORKSPACE_ID = "w1";
delete process.env.MOTION_QUOTA_MIN;
const { projetsMotion, motionGetAll, tachesMotion, espaceParDefaut } = await import("../lib/motion.js");
test.after(() => serveur.close());

const MIN = 60_000;
const hors = (d) => d.filter((x) => !x.startsWith("/v1/tasks"));
const noms = (r) => r.projets.map((p) => p.nom).sort();

test("un seul espace : une requête pour les projets, comme avant, même quota serré", async () => {
  // Sept requêtes parties dans la minute : il reste cinq places.
  for (let i = 0; i < 7; i++) await motionGetAll("/tasks", "tasks");
  demandes.length = 0;
  const r = await projetsMotion();
  assert.deepEqual(hors(demandes), ["/v1/projects?workspaceId=w1"], "ni liste des espaces, ni requête de plus");
  assert.deepEqual(noms(r), ["Album « Été »"]);
});

test("plusieurs espaces, quota serré : les projets attendent ; de la place : lus espace par espace", async (t) => {
  // Onze minutes plus tard (la liste des projets a vieilli), une tâche vit dans un deuxième espace.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 11 * MIN });
  taches = [...taches, { id: "b", name: "Prospection zone nord", projectId: "p2", status: { name: "Todo" }, workspace: { id: "w2" } }];
  await tachesMotion({ frais: true });
  for (let i = 0; i < 6; i++) await motionGetAll("/tasks", "tasks"); // sept requêtes dans la minute
  demandes.length = 0;
  let r = await projetsMotion();
  assert.deepEqual(hors(demandes), [], "cinq places libres : moins que la réserve des gestes plus deux espaces");
  assert.deepEqual(noms(r), ["Album « Été »"], "la dernière liste connue reste");

  t.mock.timers.setTime(Date.now() + 2 * MIN);
  demandes.length = 0;
  r = await projetsMotion();
  assert.deepEqual(hors(demandes), ["/v1/projects?workspaceId=w1", "/v1/projects?workspaceId=w2"]);
  assert.deepEqual(noms(r), ["Album « Été »", "Sites vitrines"], "le projet rattaché par identifiant retrouve son nom");
});

test("un espace sans tâche ouverte est couvert dès que la tour a lu la liste des espaces (première écriture)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * MIN });
  await espaceParDefaut(); // ce que fait la première écriture : lire les espaces
  demandes.length = 0;
  const r = await projetsMotion();
  assert.deepEqual(hors(demandes), ["/v1/projects?workspaceId=w1", "/v1/projects?workspaceId=w2", "/v1/projects?workspaceId=w3"]);
  assert.ok(noms(r).includes("Voyage à Porto"), "le projet de l'espace sans tâche apparaît");
});
