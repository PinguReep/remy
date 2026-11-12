// Les projets bloqués (projets-bloques-v1, 12/11) : un projet Motion
// (« motion:<id> ») ou un dossier de Remy (« dossier:<id> ») peut attendre une
// tâche ou un autre projet — « Carrosserie » ne commence que quand « Garage »
// est fini.
//   - le modèle : la même table que les tâches, pas de boucle en mêlant tâches
//     et projets (une tâche fait partie de son projet, un dossier de son parent) ;
//   - toutes les tâches d'un projet bloqué (et de ses sous-dossiers) sont
//     bloquées, sans un lien par tâche, et on dit par quoi ; échéance menacée ;
//   - « fini » : plus aucune tâche ouverte dans une liste Motion lue en entier
//     (alors qu'on lui en a vu), ou « C'est fini » dit par Sam ;
//   - l'outil motion_proposer : l'action « attendre », validée par Sam.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};

const motion = await demarrerFauxMotion();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-projets-bloques-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "MOTION_WRITE", "REMY_MOTION_HORAIRE", "GOOGLE_CLIENT_ID"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;
process.env.MOTION_FRAIS_MIN_MS = "0";

const store = await import("../lib/store.js");
const { routeApi } = await import("../lib/routes.js");
const { db, fermer } = await import("../lib/db.js");
const carnet = await import("../lib/carnet.js");
const { tachesMotion } = await import("../lib/motion.js");
const { journee } = await import("../lib/dashboard.js");
const { situation } = await import("../lib/conseil.js");
const { menacees } = await import("../lib/rituel.js");
const { page: pageHistorique } = await import("../lib/historique.js");
const { dependancesProposees } = await import("../lib/providers.js");
const { CAPACITES } = await import("../lib/version.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(async () => {
  remy.close();
  await motion.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const appel = async (methode, p, b) => {
  const r = await fetch(base + p, { method: methode, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const vider = () => db().exec("DELETE FROM dependances_taches; DELETE FROM etats_taches; DELETE FROM journal; DELETE FROM dossiers; DELETE FROM rattachements;");
const H = 3600_000;
const GARAGE = { id: "pg", name: "Garage" };
const CARROSSERIE = { id: "pc", name: "Carrosserie" };

// Le garage (deux tâches), la carrosserie (une tâche, et un sous-dossier « Peinture » avec une tâche rangée).
function demo(maintenant = Date.now()) {
  motion.taches.clear();
  motion.ajouter({ id: "g1", name: "Récupérer la voiture au garage", project: GARAGE, dueDate: new Date(maintenant + 4 * 24 * H).toISOString() });
  motion.ajouter({ id: "g2", name: "Payer le garage", project: GARAGE });
  motion.ajouter({ id: "c1", name: "Porter la voiture chez le carrossier", project: CARROSSERIE, dueDate: new Date(maintenant + 2 * 24 * H).toISOString(), priority: "ASAP" });
  motion.ajouter({ id: "c2", name: "Choisir la teinte", project: CARROSSERIE });
  carnet.ecrireDossier("peinture", { nom: "Peinture", parent: "motion:pc" });
  carnet.rattacher("c2", "peinture");
  return [...motion.taches.values()];
}

test("capacité annoncée, migration 12 posée", () => {
  assert.ok(CAPACITES.includes("projets-bloques-v1"));
  assert.ok(db().prepare("PRAGMA table_info(dependances_taches)").all().some((c) => c.name === "bloquante_vue"));
});

test("un projet bloqué : toutes ses tâches (sous-dossiers compris) sont bloquées, sans un lien par tâche", () => {
  vider();
  const taches = demo();
  carnet.poserBlocages("motion:pc", ["motion:pg"], { taches });
  assert.equal(carnet.blocages().liens.length, 1, "un seul lien");
  const t = carnet.annoterTaches(taches);
  const c1 = t.find((x) => x.id === "c1");
  assert.equal(c1.bloquee, true);
  assert.deepEqual(c1.projetBloque, { id: "motion:pc", nom: "Carrosserie", par: [{ id: "motion:pg", nom: "Garage", noeud: true }] });
  assert.equal(c1.raison, "projet « Carrosserie » après « Garage »", "ce qu'une app d'avant affiche");
  assert.equal(c1.bloqueePar, undefined);
  assert.equal(t.find((x) => x.id === "c2").projetBloque?.id, "motion:pc", "le sous-dossier Peinture suit son parent");
  assert.equal(t.find((x) => x.id === "g1").bloquee, undefined);
  assert.match(c1.menaceBlocage, /Elle attend « Garage », prévu après son échéance/, "le garage finit après l'échéance du carrossier");
});

test("un dossier bloqué par une tâche ; une tâche bloquée par un projet", () => {
  vider();
  const taches = demo();
  carnet.poserBlocages("dossier:peinture", ["g1"], { taches });
  carnet.poserBlocages("c1", ["motion:pg"], { taches });
  const t = carnet.annoterTaches(taches);
  assert.equal(t.find((x) => x.id === "c2").projetBloque.nom, "Peinture");
  assert.deepEqual(t.find((x) => x.id === "c1").bloqueePar, [{ id: "motion:pg", nom: "Garage", noeud: true }]);
  assert.deepEqual(t.find((x) => x.id === "g1").debloque.map((x) => x.id), ["dossier:peinture"]);
});

test("pas de boucle, tâches et projets mêlés", () => {
  vider();
  const taches = demo();
  carnet.poserBlocages("motion:pc", ["motion:pg"], { taches });
  const refus = (cible, b, motif) => assert.throws(() => carnet.poserBlocages(cible, [b], { taches }), (e) => e.statut === 409 && motif.test(e.message), `${cible} ← ${b}`);
  refus("motion:pg", "motion:pc", /s'attendraient/);
  refus("motion:pg", "g1", /s'attendraient/); // le garage attendrait sa propre tâche
  refus("dossier:peinture", "motion:pc", /s'attendraient/); // une branche attendrait son projet
  refus("motion:pc", "dossier:peinture", /s'attendraient/); // le projet attendrait déjà sa branche… pour commencer
  refus("g2", "c1", /s'attendraient/); // c1 attend déjà tout le garage
  assert.throws(() => carnet.poserBlocages("motion:pc", ["motion:pc"], { taches }), /lui-même/);
  assert.throws(() => carnet.poserBlocages("motion:pc", ["dossier:fantome"], { taches }), (e) => e.statut === 404);
  carnet.poserBlocages("c1", ["g2"], { taches }); // dans le bon sens : rien ne boucle
});

test("fini = plus aucune tâche ouverte dans une liste lue en entier (après en avoir vu) ; un projet vide n'est pas fini", () => {
  vider();
  const taches = demo();
  carnet.poserBlocages("motion:pc", ["motion:pg"], { taches });
  carnet.poserBlocages("dossier:peinture", ["motion:vide"], { taches, noms: new Map([["motion:vide", "Projet tout neuf"]]) });
  const tronquee = taches.filter((x) => x.project?.id !== "pg");
  tronquee.tronquee = true;
  assert.deepEqual(carnet.reconcilierBlocages(tronquee), [], "tronquée : rien");
  const d = carnet.reconcilierBlocages(taches.filter((x) => x.project?.id !== "pg"));
  assert.deepEqual(d.map((x) => x.id), ["motion:pc"], "le garage n'a plus rien d'ouvert");
  assert.equal(carnet.blocages().par.get("dossier:peinture")?.length, 1, "un projet jamais vu avec des tâches ne se dit pas fini");
  const e = pageHistorique({ limite: 3 }).entrees[0];
  assert.equal(e.resume, "« Carrosserie » est débloqué.");
  assert.equal(e.elements[0].action, "Débloqué");
});

test("HTTP : « C'est fini » sur un projet le dit débloqué ; le rouvrir rétablit", async () => {
  vider();
  demo();
  await tachesMotion({ frais: true });
  let r = await appel("PUT", "/api/taches/motion%3Apc/etat", { bloqueePar: ["motion:pg"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.bloqueePar, [{ id: "motion:pg", nom: "Garage", noeud: true }]);
  r = await appel("PUT", "/api/taches/motion%3Apg/etat", { bloqueePar: ["motion:pc"] });
  assert.equal(r.status, 409);
  const dep = (await appel("GET", "/api/dependances")).body;
  assert.ok(dep.noeuds.some((n) => n.id === "motion:pg" && n.genre === "projet"));
  assert.ok(dep.noeuds.some((n) => n.id === "dossier:peinture" && n.genre === "dossier"));
  const projets = (await appel("GET", "/api/projets")).body.projets;
  assert.deepEqual(projets.find((p) => p.id === "pc").bloquePar, [{ id: "motion:pg", nom: "Garage", noeud: true }]);
  assert.equal(projets.find((p) => p.id === "pg").debloque[0].id, "motion:pc");
  const dossiers = (await appel("GET", "/api/dossiers")).body.dossiers;
  assert.equal(dossiers.find((x) => x.id === "peinture").parentBloque.id, "motion:pc", "la branche dit que son projet attend");
  const dash = (await appel("GET", "/api/dashboard")).body;
  const c1 = [...dash.journee.items, ...dash.journee.aFaire, ...dash.journee.retard.items].find((x) => x.id === "c1");
  void c1; // sans créneau ni échéance du jour, c1 n'est pas dans la journée : l'annotation est testée plus haut
  r = await appel("PUT", "/api/taches/motion%3Apg/etat", { fait: true });
  assert.deepEqual(r.body.debloquees, [{ id: "motion:pc", nom: "Carrosserie" }]);
  assert.equal(carnet.blocages().par.size, 0);
  assert.equal((await appel("GET", "/api/projets")).body.projets.find((p) => p.id === "pg").fini, true);
  r = await appel("PUT", "/api/taches/motion%3Apg/etat", { fait: false });
  assert.equal(r.status, 200);
  assert.equal(carnet.blocages().par.get("motion:pc")?.length, 1, "rouvert : la carrosserie attend de nouveau");
});

test("HTTP : cocher la dernière tâche du garage débloque la carrosserie ; Annuler la remet en attente", async () => {
  vider();
  demo();
  motion.taches.delete("g2");
  await tachesMotion({ frais: true });
  carnet.poserBlocages("motion:pc", ["motion:pg"], { taches: [...motion.taches.values()] });
  const r = await appel("POST", "/api/motion/apply", { actions: [{ type: "terminer", id: "g1", nom: "Récupérer la voiture au garage" }], idCommande: "coche-g1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.results[0].debloquees, [{ id: "motion:pc", nom: "Carrosserie" }]);
  assert.equal(carnet.blocages().par.size, 0);
  const u = await appel("POST", "/api/motion/undo", { id: r.body.ledgerId });
  assert.equal(u.status, 200);
  assert.equal(carnet.blocages().par.get("motion:pc")?.length, 1);
});

test("conseil et menaces : jamais proposée, et on dit ce qu'attend son projet", () => {
  vider();
  const maintenant = Date.parse("2026-11-12T08:00:00Z");
  const taches = demo(maintenant);
  taches.find((t) => t.id === "c1").dueDate = new Date(maintenant + 5 * H).toISOString();
  taches.find((t) => t.id === "c1").scheduledStart = new Date(maintenant + 2 * H).toISOString();
  taches.find((t) => t.id === "c1").scheduledEnd = new Date(maintenant + 3 * H).toISOString();
  carnet.poserBlocages("motion:pc", ["motion:pg"], { taches });
  const t = carnet.annoterTaches(taches, { maintenant });
  const j = journee({ taches: t, maintenant });
  const s = situation(j, { maintenant });
  assert.ok(!s.prochainesTaches.some((x) => /carrossier/.test(x.titre)));
  assert.ok(s.bloquees.some((x) => /carrossier \(son projet « Carrosserie » attend « Garage »/.test(x)), s.bloquees.join(" | "));
  const m = menacees({ taches: t, maintenant }).find((x) => x.id === "c1");
  assert.equal(m.raison, "bloquee");
  assert.equal(m.projetBloque.nom, "Carrosserie");
});

// --- L'outil : « le projet B après le projet A » ---------------------------------------

const noeuds = async () => new Map([["motion:pg", "Garage"], ["motion:pc", "Carrosserie"], ["dossier:peinture", "Peinture"], ["dossier:x1", "Doublon"], ["dossier:x2", "Doublon"]]);
const essai = (actions) => dependancesProposees(actions, { nomDe: async (i) => (i === "g1" ? "Récupérer la voiture au garage" : null), noeuds });

test("outil : attendre — par nom ou identifiant, la carte dit « après »", async () => {
  const r = await essai([{ type: "attendre", cible: "Carrosserie", bloquee_par: ["Garage"] }]);
  assert.deepEqual(r.actions, [{ type: "attendre", cible: "motion:pc", cible_nom: "Carrosserie", nom: "Carrosserie", attend_ids: ["motion:pg"], noms_ids: { "motion:pg": "Garage" }, apres: ["Garage"] }]);
  const t = await essai([{ type: "attendre", cible: "dossier:peinture", bloquee_par: ["g1"] }]);
  assert.deepEqual(t.actions[0].attend_ids, ["g1"]);
  // Une création qui attend un projet, et un projet qui attend une création.
  const m = await essai([
    { type: "creer", nom: "Récupérer le devis", ref: "devis" },
    { type: "attendre", cible: "motion:pc", bloquee_par: ["devis"] },
    { type: "creer", nom: "Vernir", bloquee_par: ["motion:pc"] },
  ]);
  assert.equal(m.actions[0].ref, "devis", "citée : la ref reste");
  assert.deepEqual(m.actions[1].bloquee_par, ["devis"]);
  assert.deepEqual(m.actions[2].attend_ids, ["motion:pc"]);
});

test("outil : refuse cible absente, inconnue, ambiguë, sans attente, et l'auto-attente", async () => {
  assert.match((await essai([{ type: "attendre", bloquee_par: ["Garage"] }])).erreur, /cible/);
  assert.match((await essai([{ type: "attendre", cible: "motion:inconnu", bloquee_par: ["Garage"] }])).erreur, /n'existe pas/);
  assert.match((await essai([{ type: "attendre", cible: "Doublon", bloquee_par: ["Garage"] }])).erreur, /plusieurs projets ou dossiers/);
  assert.match((await essai([{ type: "attendre", cible: "Garage" }])).erreur, /dis ce qu'il attend/);
  assert.match((await essai([{ type: "attendre", cible: "Garage", bloquee_par: ["motion:pg"] }])).erreur, /lui-même/);
  assert.match((await essai([{ type: "attendre", cible: "Garage", bloquee_par: ["Projet imaginaire"] }])).erreur, /ni un ref/);
});

test("validée par Sam : le projet attend ; une étape décochée ne lie à rien ; Annuler le retire", async () => {
  vider();
  demo();
  await tachesMotion({ frais: true });
  const { actions } = await dependancesProposees([
    { type: "creer", nom: "Récupérer le devis du carrossier", ref: "devis" },
    { type: "attendre", cible: "motion:pc", bloquee_par: ["devis", "motion:pg"] },
  ], { noeuds });
  const conv = (id) => store.putConversation({
    id, title: "t", createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ role: "user", content: "x" }, { role: "assistant", content: "je propose", proposal: { id: `p-${id}`, source: "motion", resume: "r", actions, statut: "en_attente" } }],
  });
  assert.equal(carnet.blocages().liens.length, 0, "rien avant le « Oui »");
  await conv("pb1");
  const r = await appel("POST", "/api/motion/apply", { convId: "pb1", propositionId: "p-pb1", confirmer: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const devis = r.body.results[0].taskId;
  assert.equal(r.body.results[1].type, "attendre");
  assert.deepEqual(r.body.results[1].bloqueePar.map((x) => x.id).sort(), [devis, "motion:pg"].sort());
  assert.equal(carnet.blocages().par.get("motion:pc").length, 2);
  const u = await appel("POST", "/api/motion/undo", { id: r.body.ledgerId });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(carnet.blocages().par.get("motion:pc"), undefined, "le lien de la proposition est retiré");
  vider();
  demo();
  await tachesMotion({ frais: true });
  await conv("pb2");
  const p = await appel("POST", "/api/motion/apply", { convId: "pb2", propositionId: "p-pb2", confirmer: true, rangs: [1] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.results[0].bloqueePar.map((x) => x.id), ["motion:pg"]);
  assert.deepEqual(p.body.results[0].liensRates, [{ ref: "devis", erreur: "écartée de la proposition, ou pas créée" }]);
});
