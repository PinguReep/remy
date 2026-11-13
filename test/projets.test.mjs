// Onglet Projets de l'app (Lot 1) : les projets ouverts de Motion et leurs
// tâches, en lecture seule. Faux Motion local, aucune donnée réelle.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const H = 3600_000;
const maintenant = Date.UTC(2026, 9, 15, 8, 40);
const iso = (ms) => new Date(ms).toISOString();
const taches = [
  { id: "a", name: "Retouche des photos", project: { id: "p1", name: "Album « Été »" }, dueDate: iso(maintenant + 8 * H), status: { name: "Todo" } },
  { id: "b", name: "Écrire le couplet", project: { id: "p1", name: "Album « Été »" }, status: { name: "Todo" } },
  { id: "c", name: "Prospection zone nord", projectId: "p2", dueDate: iso(maintenant + 5 * H), status: { name: "Todo" } },
  { id: "d", name: "Relancer le comptable", project: { name: "Admin" }, dueDate: iso(maintenant - 48 * H), status: { name: "Todo" } },
  { id: "e", name: "Trier la boîte mail", dueDate: iso(maintenant + H), status: { name: "Todo" } },
];
const projets = [
  { id: "p1", name: "Album « Été »", status: { name: "En cours" } },
  { id: "p2", name: "Sites vitrines" },
  { id: "p3", name: "Voyage à Porto" },
  { id: "p4", name: "Ancien projet", status: { name: "Fini", isResolvedStatus: true } },
];
// Comme le vrai Motion : les projets se lisent espace par espace, et `GET /projects`
// sans espace est refusé (400 « Validation failed », vu en production).
const parEspace = { w1: projets.slice(0, 2), w2: projets.slice(2) };
const demandes = [];
const serveur = http.createServer((req, res) => {
  const u = new URL(req.url, "http://faux");
  demandes.push(u.pathname + u.search);
  const repondre = (code, v) => (res.writeHead(code, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
  if (u.pathname === "/v1/workspaces") return repondre(200, { workspaces: [{ id: "w1", name: "Perso" }, { id: "w2", name: "Travail" }], meta: {} });
  if (u.pathname === "/v1/projects") {
    const espace = u.searchParams.get("workspaceId");
    if (!espace) return repondre(400, { message: "Validation failed", error: "Bad Request", statusCode: 400 });
    return repondre(200, { projects: parEspace[espace] || [], meta: {} });
  }
  repondre(200, { tasks: taches, meta: {} });
});
await new Promise((r) => serveur.listen(0, r));
process.env.MOTION_API_KEY = "cle";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
const { projetsMotion } = await import("../lib/motion.js");
test.after(() => serveur.close());

test("les projets ouverts, leurs tâches et la plus proche échéance", async () => {
  const r = await projetsMotion({ maintenant });
  assert.deepEqual(r.projets.map((p) => p.nom), ["Admin", "Sites vitrines", "Album « Été »", "Voyage à Porto"]);
  const ep = r.projets.find((p) => p.id === "p1");
  assert.equal(ep.taches, 2);
  assert.equal(ep.statut, "En cours");
  assert.equal(ep.prochaine.titre, "Retouche des photos", "la tâche datée passe avant celle sans échéance");
  assert.equal(r.projets.find((p) => p.id === "p2").prochaine.titre, "Prospection zone nord", "rattachée par projectId");
  assert.equal(r.projets.find((p) => p.nom === "Admin").enRetard, 1, "projet absent de la liste mais porté par une tâche");
  assert.equal(r.projets.find((p) => p.id === "p3").taches, 0, "un projet sans tâche reste visible");
  assert.ok(!r.projets.some((p) => p.id === "p4"), "un projet terminé n'apparaît pas");
  assert.equal(r.sansProjet, 1);
  assert.deepEqual(
    demandes.filter((d) => d.startsWith("/v1/projects")),
    ["/v1/projects?workspaceId=w1", "/v1/projects?workspaceId=w2"],
    "les projets sont demandés espace par espace, jamais sans espace",
  );
});
