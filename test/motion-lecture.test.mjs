// Lecture complète de Motion (outil motion_lister) et routeur : les deux
// manques du tri Motion du 09/10/2026.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const jour = 86_400_000;
const taches = [
  { id: "a", name: "Payer l'assurance", dueDate: new Date(Date.now() - 3 * jour).toISOString(), status: { name: "Todo" } },
  { id: "b", name: "Douche", dueDate: new Date(Date.now() + 2 * 3600_000).toISOString(), status: { name: "Todo" } },
  ...Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, name: `Idée ${i}`, status: { name: "Todo" }, project: { name: "Musique" } })),
];
const serveur = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ tasks: taches, meta: {} }));
});
await new Promise((r) => serveur.listen(0, r));
process.env.MOTION_API_KEY = "cle";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;

const { listerTaches, nomDeTache } = await import("../lib/motion.js");
const { demandeComplexe } = await import("../lib/chat.js");
test.after(() => serveur.close());

test("toutes les tâches se lisent, par pages de 100", async () => {
  const p1 = await listerTaches();
  assert.equal(p1.total, 47);
  assert.equal(p1.pages, 1);
  assert.equal(p1.taches.length, 47);
});

test("filtres et recherche", async () => {
  assert.deepEqual((await listerTaches({ filtre: "retard" })).taches.map((t) => t.id), ["a"]);
  assert.deepEqual((await listerTaches({ filtre: "aujourdhui" })).taches.map((t) => t.id), ["b"]);
  assert.equal((await listerTaches({ recherche: "musique" })).total, 45);
});

test("le nom d'une tâche se retrouve par son identifiant", async () => {
  assert.equal(await nomDeTache("b"), "Douche");
  assert.equal(await nomDeTache("inconnue"), null);
});

test("RÉGRESSION : une demande longue ou structurée n'est jamais un réflexe", () => {
  assert.equal(demandeComplexe("Salut, ça va ?"), false);
  assert.equal(demandeComplexe("Horaire Tâche\n12h00 Commandes\n12h05 Poubelles\n12h20 Machine"), true);
  assert.equal(demandeComplexe("x".repeat(300)), true);
});
