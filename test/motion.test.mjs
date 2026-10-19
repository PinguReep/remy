// Lecture de Motion face à un faux serveur qui pagine comme le vrai
// (`meta.nextCursor`). La panne du 08/10/2026 : Rémy ne lisait que la première
// page, et les tâches créées récemment dans Motion n'apparaissaient jamais.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let pages = {}; // curseur ("" = première page) → réponse
let statut = 200;
const vus = [];
const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  vus.push(url.pathname + url.search);
  if (statut !== 200) {
    res.writeHead(statut, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ message: "non", statusCode: statut }));
  }
  const corps = pages[url.searchParams.get("cursor") || ""] || { tasks: [], meta: {} };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corps));
});
await new Promise((r) => serveur.listen(0, r));

process.env.MOTION_API_KEY = "cle-de-test";
process.env.MOTION_BASE_URL = `http://127.0.0.1:${serveur.address().port}/v1`;
process.env.MOTION_FRAIS_MIN_MS = "0";

const { tachesMotion, verifierMotion } = await import("../lib/motion.js");

test.after(() => serveur.close());

const tache = (id, extra = {}) => ({ id, name: `Tâche ${id}`, completed: false, status: { name: "Todo" }, ...extra });

test("RÉGRESSION : toutes les pages sont lues, pas seulement la première", async () => {
  pages = {
    "": { tasks: [tache("a"), tache("b")], meta: { nextCursor: "p2", pageSize: 2 } },
    p2: { tasks: [tache("c"), tache("d", { status: { name: "Done", isResolvedStatus: true } })], meta: { nextCursor: "p3" } },
    p3: { tasks: [tache("e")], meta: {} },
  };
  vus.length = 0;
  const liste = await tachesMotion({ frais: true });
  assert.deepEqual(liste.map((t) => t.id), ["a", "b", "c", "e"]); // « d » est résolue
  assert.deepEqual(vus, ["/v1/tasks", "/v1/tasks?cursor=p2", "/v1/tasks?cursor=p3"]);
});

test("dans la minute, la liste vient du cache (quota Motion de 12 req/min)", async () => {
  vus.length = 0;
  await tachesMotion();
  assert.equal(vus.length, 0);
});

test("« frais » relit Motion même dans la minute", async () => {
  pages = { "": { tasks: [tache("z")], meta: {} } };
  vus.length = 0;
  const liste = await tachesMotion({ frais: true });
  assert.deepEqual(liste.map((t) => t.id), ["z"]);
  assert.equal(vus.length, 1);
});

test("Motion en panne : la dernière liste lue est gardée plutôt qu'un écran vide", async () => {
  statut = 429;
  const liste = await tachesMotion({ frais: true });
  assert.deepEqual(liste.map((t) => t.id), ["z"]);
  statut = 200;
});

test("la santé dit qu'une clé refusée est refusée", async () => {
  statut = 401;
  assert.match(await verifierMotion(), /REFUSÉE/);
  statut = 200;
});
