// « À trancher » et la revue du dimanche (24/10) : une lecture qui rassemble
// ce qui s'empile, « Plus tard » daté, un refus qui se rouvre, la semaine par
// domaine sans IA, et ce que la nuit a déjà écrit.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-a-trancher-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_GLM_URL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;

const tri = await import("../lib/a-trancher.js");
const store = await import("../lib/store.js");
const carnet = await import("../lib/carnet.js");
const { routeApi } = await import("../lib/routes.js");
const { db, fermer } = await import("../lib/db.js");
const { CAPACITES } = await import("../lib/version.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fermer(); fs.rmSync(dossier, { recursive: true, force: true }); });
const envoyer = (m, chemin, corps) => fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });

const JOUR = 86_400_000;
const maintenant = Date.now();
const vieillir = (table, id, jours) => db().prepare(`UPDATE ${table} SET cree_a = ? WHERE id = ?`).run(maintenant - jours * JOUR, id);

async function semer() {
  // Une carte en attente dans un fil oublié, une refusée, une appliquée.
  await store.putConversation({ id: "c-vieux", title: "Ranger le garage", createdAt: maintenant - 20 * JOUR, updatedAt: maintenant - 20 * JOUR, messages: [
    { role: "user", content: "Range le garage samedi" },
    { role: "assistant", content: "Je te propose ça.", proposal: { id: "p-garage", source: "motion", resume: "Ranger le garage samedi", actions: [{ type: "creer", nom: "Ranger le garage" }], statut: "en_attente" } },
    { role: "user", content: "Et la cave ?" },
    { role: "assistant", content: "Aussi.", proposal: { id: "p-cave", source: "motion", resume: "Ranger la cave", actions: [{ type: "creer", nom: "Ranger la cave" }], statut: "en_attente" } },
  ] });
  db().prepare("INSERT INTO propositions (id, conv_id, source, statut, maj_a) VALUES ('p-cave', 'c-vieux', 'motion', 'refuse', ?)").run(maintenant);
  // Un fil d'un seul échange, ancien ; un récent ; un épinglé.
  await store.putConversation({ id: "c-seul", title: "Idée de cadeau pour Léa", createdAt: maintenant - 30 * JOUR, updatedAt: maintenant - 30 * JOUR, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] });
  await store.putConversation({ id: "c-recent", title: "Hier", createdAt: maintenant - JOUR, updatedAt: maintenant - JOUR, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] });
  await store.putConversation({ id: "c-epingle", title: "Le fil du jour", pinned: true, createdAt: maintenant - 40 * JOUR, updatedAt: maintenant - 40 * JOUR, messages: [] });
  // Rappels : sans date ancien, sans date récent, en double, fait.
  carnet.ecrireRappels([
    { id: "r-ancien", texte: "Changer les essuie-glaces" },
    { id: "r-recent", texte: "Acheter des ampoules" },
    { id: "r-1", texte: "Appeler le garage" },
    { id: "r-2", texte: "appeler  le Garage.", quand: maintenant + JOUR },
    { id: "r-fait", texte: "Payer la cantine", fait: true },
  ]);
  vieillir("rappels", "r-ancien", 10);
  vieillir("rappels", "r-1", 9);
  // Une liste avec des articles pris.
  carnet.ecrireListe("l-courses", { nom: "Courses" });
  carnet.ecrireElements("l-courses", [{ id: "e1", texte: "Tomates", fait: true }, { id: "e2", texte: "Lait", fait: true }, { id: "e3", texte: "Œufs" }]);
  // Une idée non triée.
  carnet.ecrireDossier("idees", { nom: "Idées" });
  carnet.ecrireNotes("idees", [{ id: "n1", texte: "Un atelier bougies pour la boutique" }, { id: "n2", texte: "Déjà relue", fait: true }]);
}

test("la tour annonce la capacité", () => {
  assert.ok(CAPACITES.includes("a-trancher-v1"));
});

test("À trancher rassemble ce qui s'empile, groupé, sans ce qui est réglé", async () => {
  await semer();
  const r = await (await envoyer("GET", "/api/a-trancher")).json();
  const g = Object.fromEntries(r.groupes.map((x) => [x.id, x]));
  assert.deepEqual(g.cartes.lignes.map((l) => l.propositionId), ["p-garage"], "la refusée n'attend plus");
  assert.equal(g.cartes.lignes[0].convId, "c-vieux");
  assert.equal(g.cartes.lignes[0].source, "motion");
  assert.deepEqual(g.doublons.lignes.map((l) => [l.rappelId, l.doublons]), [["r-2", ["r-1"]]], "on garde celui qui a une date");
  assert.deepEqual(g.rappels.lignes.map((l) => l.rappelId), ["r-ancien"], "un rappel récent a le temps d'être rangé");
  assert.equal(g.articles.lignes[0].texte, "Courses : 2 articles pris");
  assert.equal(g.articles.lignes[0].listeId, "l-courses");
  assert.deepEqual(g.idees.lignes.map((l) => l.noteId), ["n1"]);
  assert.deepEqual(g.fils.lignes.map((l) => l.convId), ["c-seul"], "ni le récent ni l'épinglé");
  assert.equal(r.total, 6);
  assert.deepEqual(r.retards, [], "sans Motion, pas de retard inventé");
});

test("« Plus tard » écarte une ligne pour une semaine, et s'annule", async () => {
  const rep = await (await envoyer("POST", "/api/a-trancher/reports", { cle: "fil:c-seul" })).json();
  assert.equal(rep.ok, true);
  assert.ok(Math.abs(rep.jusqua - (Date.now() + 7 * JOUR)) < 5000);
  let r = await (await envoyer("GET", "/api/a-trancher")).json();
  assert.equal(r.groupes.find((g) => g.id === "fils"), undefined);
  assert.equal(r.reportes, 1);
  // Échu, il revient tout seul.
  assert.deepEqual(Object.keys(tri.reports(Date.now() + 8 * JOUR)), []);
  assert.equal((await envoyer("DELETE", "/api/a-trancher/reports/fil%3Ac-seul")).status, 200);
  r = await (await envoyer("GET", "/api/a-trancher")).json();
  assert.equal(r.groupes.find((g) => g.id === "fils").total, 1);
  assert.equal((await envoyer("POST", "/api/a-trancher/reports", { cle: "n'importe quoi" })).status, 400);
});

test("« Non » se rouvre (Annuler) ; une carte jamais refusée ne se rouvre pas", async () => {
  assert.equal((await envoyer("POST", "/api/conversations/c-vieux/propositions/p-garage/refus")).status, 200);
  let r = await (await envoyer("GET", "/api/a-trancher")).json();
  assert.equal(r.groupes.find((g) => g.id === "cartes"), undefined);
  assert.equal((await envoyer("POST", "/api/a-trancher/rouvrir", { propositionId: "p-garage" })).status, 200);
  r = await (await envoyer("GET", "/api/a-trancher")).json();
  assert.deepEqual(r.groupes.find((g) => g.id === "cartes").lignes.map((l) => l.propositionId), ["p-garage"]);
  assert.equal((await envoyer("POST", "/api/a-trancher/rouvrir", { propositionId: "p-garage" })).status, 409);
});

test("les gestes du carnet font sortir leurs lignes (fusion, articles retirés)", async () => {
  carnet.supprimerRappel("r-1");
  carnet.supprimerElement("l-courses", "e1");
  carnet.supprimerElement("l-courses", "e2");
  const r = await (await envoyer("GET", "/api/a-trancher")).json();
  assert.equal(r.groupes.find((g) => g.id === "doublons"), undefined);
  assert.equal(r.groupes.find((g) => g.id === "articles"), undefined);
});

test("la revue : la semaine par domaine, ce que la nuit a écrit, trois décisions", async () => {
  const j = (id, ts, results, etat = "appliquee", annule = 0) =>
    db().prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, annule, maj_a) VALUES (?, ?, 'motion', 'app', '', ?, '[]', ?, '{}', ?, ?)")
      .run(id, ts, etat, JSON.stringify(results), annule, ts);
  j("j1", maintenant - 2 * JOUR, [{ ok: true, type: "terminer", nom: "Écrire la fiche produit", projet: "Boutique", avant: { duration: 45 } }]);
  j("j2", maintenant - JOUR, [{ ok: true, type: "terminer", nom: "Photos des bougies", projet: "Boutique", avant: { duration: 30 } }, { ok: true, type: "creer", nom: "Autre" }]);
  j("j3", maintenant - 3 * JOUR, [{ ok: true, type: "terminer", nom: "Arroser", avant: { duration: 10 } }]);
  j("j4", maintenant - JOUR, [{ ok: true, type: "terminer", nom: "Annulée", projet: "Boutique", avant: { duration: 60 } }], "annulee", 1);
  j("j5", maintenant - 10 * JOUR, [{ ok: true, type: "terminer", nom: "Trop vieille", projet: "Boutique", avant: { duration: 60 } }]);
  await store.putBriefing("- Tu avances mieux le matin (70 %)\n- Question douce : la boutique avant le site ?");
  const r = await (await envoyer("GET", "/api/revue")).json();
  assert.deepEqual(r.domaines.map((d) => [d.nom, d.faites, d.minutes]), [["Boutique", 2, 75], ["Sans projet", 1, 10]]);
  assert.deepEqual(r.faites.map((f) => f.nom), ["Photos des bougies", "Écrire la fiche produit", "Arroser"]);
  assert.equal(r.rappelsFaits, 1);
  assert.deepEqual(r.appris, ["Tu avances mieux le matin (70 %)"], "seulement les hypothèses déjà écrites");
  assert.equal(typeof r.aTrancher, "number");
  assert.deepEqual(r.decisions.liste, []);

  const d = await (await envoyer("PUT", "/api/revue/decisions", { decisions: ["  Finir la boutique ", "", "Sport mardi et jeudi", "Une de trop", "Encore une"] })).json();
  assert.deepEqual(d.liste, ["Finir la boutique", "Sport mardi et jeudi", "Une de trop"], "trois au plus, propres");
  assert.equal((await envoyer("PUT", "/api/revue/decisions", { decisions: "x" })).status, 400);
});

test("la semaine commence le lundi ; décidées un dimanche, elles valent pour la suivante", () => {
  const dimanche = new Date(2026, 9, 25, 18, 0).getTime(); // dimanche 25 oct. 2026
  const lundi = new Date(2026, 9, 19, 0, 0).getTime();
  assert.equal(tri.debutSemaine(dimanche), lundi);
  const d = tri.ecrireDecisions(["Finir la boutique"], dimanche);
  assert.equal(d.semaine, new Date(2026, 9, 26, 0, 0).getTime());
  assert.deepEqual(tri.decisions(new Date(2026, 9, 27, 9).getTime()).liste, ["Finir la boutique"]);
  assert.deepEqual(tri.decisions(new Date(2026, 10, 3, 9).getTime()).liste, [], "la semaine d'après repart à zéro");
});

test("réduire : casse, accents et ponctuation ne comptent pas", () => {
  assert.equal(tri.reduire("Appeler  le Garage."), tri.reduire("appeler le garage"));
  assert.equal(tri.reduire("Élagage"), "elagage");
});
