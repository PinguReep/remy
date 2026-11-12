// Les dépendances entre tâches (taches-dependances-v1, 12/11) : « faire
// réparer la voiture au garage », PUIS « la porter chez le carrossier ».
//   - le modèle : bloquée par une ou plusieurs tâches, ni boucle ni
//     auto-blocage, l'ancien « en attente » reste à part ;
//   - le déblocage seul : coche dans Rémy (avec « Annuler » qui rétablit), ou
//     bloquante disparue d'une liste Motion lue EN ENTIER — trace dans
//     l'historique ;
//   - partout où Rémy choisit quoi faire : jamais proposée, et on dit par quoi
//     elle est bloquée ; une échéance menacée par le blocage est signalée ;
//   - l'outil motion_proposer : « d'abord A, puis B » en une proposition,
//     validée par Sam, liens posés avec les vrais identifiants Motion.
// L'API publique de Motion n'expose pas ses « blockers » : tout vit dans Remy.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};

const motion = await demarrerFauxMotion();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-dependances-"));
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
const { briefingMatin, menacees, bilanSoir } = await import("../lib/rituel.js");
const { page: pageHistorique } = await import("../lib/historique.js");
const { _executerOutil, dependancesProposees } = await import("../lib/providers.js");
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
const vider = () => db().exec("DELETE FROM dependances_taches; DELETE FROM etats_taches; DELETE FROM journal;");
const H = 3600_000;

test("capacité annoncée, migration 11 posée", () => {
  assert.ok(CAPACITES.includes("taches-dependances-v1"));
  assert.ok(db().prepare("SELECT name FROM sqlite_master WHERE name = 'dependances_taches'").get());
});

test("modèle : une ou plusieurs bloquantes, remplacées en bloc ; [] les retire", () => {
  vider();
  const noms = new Map([["a", "Réparer la voiture au garage"], ["b", "Porter la voiture chez le carrossier"], ["c", "Récupérer le devis"]]);
  const r = carnet.poserBlocages("b", ["a", "c", "a"], { noms });
  assert.deepEqual(r.bloqueePar.map((x) => x.id), ["a", "c"], "sans doublon");
  assert.equal(r.bloqueePar[0].nom, "Réparer la voiture au garage");
  const { par, debloque } = carnet.blocages();
  assert.equal(par.get("b").length, 2);
  assert.deepEqual(debloque.get("a").map((x) => x.id), ["b"]);
  assert.deepEqual(carnet.poserBlocages("b", ["c"]).bloqueePar.map((x) => x.id), ["c"]);
  assert.deepEqual(carnet.poserBlocages("b", []).bloqueePar, []);
  assert.equal(carnet.blocages().par.size, 0);
});

test("modèle : refuse l'auto-blocage, les boucles (même lointaines) et une bloquante déjà finie", () => {
  vider();
  assert.throws(() => carnet.poserBlocages("a", ["a"]), (e) => e.statut === 400 && /elle-même/.test(e.message));
  carnet.poserBlocages("b", ["a"]);
  carnet.poserBlocages("c", ["b"]);
  assert.throws(() => carnet.poserBlocages("a", ["c"], { noms: new Map([["c", "Vernir"], ["a", "Poncer"]]) }), (e) => e.statut === 409 && /« Vernir » attend déjà « Poncer »/.test(e.message));
  assert.throws(() => carnet.poserBlocages("d", ["z"], { ouverts: new Set(["d", "a"]) }), (e) => e.statut === 404 && /plus dans Motion/.test(e.message));
  assert.throws(() => carnet.poserBlocages("d", Array.from({ length: 9 }, (_, i) => `x${i}`)), /Pas plus de 8/);
  assert.throws(() => carnet.poserBlocages("d", "a"), /liste/);
});

test("« en attente » (raison en texte) et « bloquée par » vivent à part", () => {
  vider();
  carnet.marquerTache("b", { bloquee: true, raison: "le bon de commande" });
  carnet.poserBlocages("b", ["a"], { noms: new Map([["a", "Garage"]]) });
  carnet.marquerTache("b", { commencee: false }); // une app d'avant : rien d'autre ne bouge
  assert.equal(carnet.blocages().par.get("b").length, 1);
  assert.equal(carnet.etatsTaches().get("b").raison, "le bon de commande");
  carnet.poserBlocages("b", []);
  assert.equal(carnet.etatsTaches().get("b").bloquee, true, "retirer le lien ne reprend pas l'attente");
});

const brutes = (maintenant) => [
  { id: "a", name: "Réparer la voiture au garage", dueDate: new Date(maintenant + 5 * 24 * H).toISOString(), duration: 60, scheduledStart: new Date(maintenant + H).toISOString(), scheduledEnd: new Date(maintenant + 2 * H).toISOString() },
  { id: "b", name: "Porter la voiture chez le carrossier", dueDate: new Date(maintenant + 3 * H).toISOString(), duration: 30, scheduledStart: new Date(maintenant + 2.5 * H).toISOString(), scheduledEnd: new Date(maintenant + 3 * H).toISOString(), priority: "ASAP" },
  { id: "c", name: "Appeler Léa", dueDate: new Date(maintenant + 4 * H).toISOString(), duration: 15 },
];

test("annoter : bloquée par X, débloque Y, raison lisible par une app d'avant, échéance menacée", () => {
  vider();
  const maintenant = Date.parse("2026-11-12T08:00:00Z");
  carnet.poserBlocages("b", ["a"], { noms: new Map([["a", "Vieux nom"]]) });
  const t = carnet.annoterTaches(brutes(maintenant), { maintenant });
  const b = t.find((x) => x.id === "b");
  assert.equal(b.bloquee, true);
  assert.deepEqual(b.bloqueePar, [{ id: "a", nom: "Réparer la voiture au garage" }], "le nom courant de Motion");
  assert.equal(b.raison, "après « Réparer la voiture au garage »");
  assert.equal(b.attente, undefined);
  assert.match(b.menaceBlocage, /attend « Réparer la voiture au garage », prévue après son échéance/);
  assert.deepEqual(t.find((x) => x.id === "a").debloque, [{ id: "b", nom: "Porter la voiture chez le carrossier" }]);
  assert.equal(t.find((x) => x.id === "c").bloquee, undefined);
  carnet.marquerTache("b", { bloquee: true, raison: "le bon de commande" });
  const b2 = carnet.annoterTaches(brutes(maintenant), { maintenant }).find((x) => x.id === "b");
  assert.equal(b2.raison, "le bon de commande");
  assert.equal(b2.attente, true);
});

test("partout où Rémy choisit : journée, conseil, briefing, bilan, menaces", () => {
  vider();
  const maintenant = Date.parse("2026-11-12T08:00:00Z");
  carnet.poserBlocages("b", ["a"]);
  const t = carnet.annoterTaches(brutes(maintenant), { maintenant });
  const j = carnet.avecEtats(journee({ taches: t, maintenant }), carnet.etatsTaches(), maintenant);
  const b = j.items.find((x) => x.id === "b");
  assert.equal(b.bloquee, true);
  assert.equal(b.bloqueePar[0].nom, "Réparer la voiture au garage");
  assert.equal(b.finBloquante, undefined, "calcul interne, pas pour les apps");
  assert.equal(j.items.find((x) => x.id === "a").debloque[0].id, "b");
  const s = situation(j, { maintenant });
  assert.ok(!s.prochainesTaches.some((x) => x.titre.includes("carrossier")), "jamais proposée");
  assert.ok(s.bloquees.some((x) => /carrossier \(attend « Réparer la voiture au garage » — échéance menacée\)/.test(x)), s.bloquees.join(" | "));
  const matin = briefingMatin({ taches: t, pour: maintenant, maintenant });
  assert.doesNotMatch(matin.compte, /carrossier/, "la tâche ASAP bloquée n'est pas « ce qui compte »");
  const m = menacees({ taches: t, maintenant }).find((x) => x.id === "b");
  assert.equal(m.raison, "bloquee");
  assert.match(m.phrase, /attend « Réparer la voiture au garage »/);
  assert.equal(m.action.type, "repousser", "l'échéance peut passer après celle de la bloquante");
  assert.ok(m.action.echeance > Date.parse(brutes(maintenant)[0].dueDate));
  assert.match(matin.menace, /Menacée : « Porter la voiture chez le carrossier »/);
  assert.ok(!bilanSoir({ taches: t, maintenant: maintenant + 10 * H }).reste.some((x) => x.id === "b"));
});

test("fin de la bloquante (coche) : débloquée, trace dans l'historique ; « Annuler » rétablit", () => {
  vider();
  carnet.poserBlocages("b", ["a"], { noms: new Map([["a", "Garage"], ["b", "Carrossier"]]) });
  carnet.poserBlocages("d", ["a", "c"], { noms: new Map([["d", "Vernir"]]) });
  const t0 = Date.now();
  const d = carnet.bloquanteTerminee("a", { nom: "Garage", maintenant: t0 });
  assert.deepEqual(d.map((x) => x.id), ["b"], "d attend encore c");
  assert.deepEqual(d[0].par, ["Garage"]);
  assert.equal(carnet.blocages().par.get("d").length, 1);
  const e = pageHistorique({ limite: 5 }).entrees[0];
  assert.equal(e.source, "remy");
  assert.equal(e.origine, "Automatisation");
  assert.equal(e.resume, "« Carrossier » est débloquée.");
  assert.deepEqual(e.elements[0], { objet: "Carrossier", action: "Débloquée", changements: ["n'attend plus « Garage »"], erreur: null });
  assert.equal(e.annulable, false);
  assert.equal(carnet.retablirBlocages("a", t0), 2);
  assert.equal(carnet.blocages().par.get("b").length, 1);
  assert.equal(pageHistorique({ limite: 5 }).entrees[0].annule, true, "la trace du déblocage suit l'annulation");
});

test("liste Motion lue EN ENTIER : une bloquante disparue débloque ; tronquée ou vide, rien", () => {
  vider();
  carnet.poserBlocages("b", ["a"]);
  carnet.poserBlocages("x", ["b"]);
  const tronquee = [{ id: "b", name: "Carrossier" }];
  tronquee.tronquee = true;
  assert.deepEqual(carnet.reconcilierBlocages(tronquee), []);
  assert.deepEqual(carnet.reconcilierBlocages([]), []);
  assert.equal(carnet.blocages().par.size, 2);
  const d = carnet.reconcilierBlocages([{ id: "b", name: "Carrossier (nouveau nom)" }, { id: "z", name: "Autre" }]);
  assert.deepEqual(d.map((x) => x.id), ["b"]);
  assert.equal(d[0].nom, "Carrossier (nouveau nom)");
  assert.equal(carnet.blocages().par.size, 0, "x a disparu de Motion : ses liens partent sans bruit");
  assert.equal(pageHistorique({ limite: 5 }).entrees.length, 1, "une seule trace : celle de b");
});

test("HTTP : « Bloquée par… » de Gérer, une app d'avant ne touche à rien, la liste des choix", async () => {
  vider();
  motion.taches.clear();
  motion.ajouter({ id: "g1", name: "Réparer la voiture au garage" });
  motion.ajouter({ id: "g2", name: "Porter la voiture chez le carrossier" });
  await tachesMotion({ frais: true });
  let r = await appel("PUT", "/api/taches/g2/etat", { bloqueePar: ["g1"] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.bloqueePar, [{ id: "g1", nom: "Réparer la voiture au garage" }]);
  r = await appel("PUT", "/api/taches/g2/etat", { bloquee: true, raison: "le bon" });
  assert.equal(r.status, 200);
  assert.equal(r.body.bloqueePar, undefined, "clé absente : inchangé");
  assert.equal(carnet.blocages().par.get("g2").length, 1);
  r = await appel("PUT", "/api/taches/g1/etat", { bloqueePar: ["g2"] });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /s'attendraient l'une l'autre/);
  r = await appel("PUT", "/api/taches/g1/etat", { bloqueePar: ["fantome"] });
  assert.equal(r.status, 404);
  r = await appel("GET", "/api/dependances");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.liens.map((l) => [l.tache.id, l.bloquante.id, l.bloquante.nom]), [["g2", "g1", "Réparer la voiture au garage"]]);
  assert.deepEqual(r.body.taches.map((t) => t.id).sort(), ["g1", "g2"]);
  const dash = (await appel("GET", "/api/dashboard")).body;
  const tous = [...(dash.journee.items || []), ...(dash.journee.aFaire || [])];
  void tous; // sans échéance ni créneau, elles ne sont pas dans la journée : la liste de Gérer les porte
});

test("HTTP : terminer la bloquante dans Rémy dit « débloquée » ; Annuler la remet en attente", async () => {
  vider();
  motion.taches.clear();
  motion.ajouter({ id: "h1", name: "Réparer la voiture au garage" });
  motion.ajouter({ id: "h2", name: "Porter la voiture chez le carrossier" });
  await tachesMotion({ frais: true });
  carnet.poserBlocages("h2", ["h1"]);
  const r = await appel("POST", "/api/motion/apply", { actions: [{ type: "terminer", id: "h1", nom: "Réparer la voiture au garage" }], idCommande: "coche-h1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results[0].debloquees, [{ id: "h2", nom: "Porter la voiture chez le carrossier" }]);
  assert.equal(carnet.blocages().par.size, 0);
  const u = await appel("POST", "/api/motion/undo", { id: r.body.ledgerId });
  assert.equal(u.status, 200);
  assert.equal(carnet.blocages().par.get("h2")?.length, 1, "la coche annulée : h2 attend de nouveau");
});

test("HTTP : une relecture de Motion débloque ce dont la bloquante a été finie dans Motion même", async () => {
  vider();
  motion.taches.clear();
  motion.ajouter({ id: "k1", name: "Garage" });
  motion.ajouter({ id: "k2", name: "Carrossier" });
  await tachesMotion({ frais: true });
  carnet.poserBlocages("k2", ["k1"]);
  motion.taches.get("k1").completed = true;
  await tachesMotion({ frais: true });
  assert.equal(carnet.blocages().par.size, 0);
  assert.equal(pageHistorique({ limite: 3 }).entrees[0].elements[0].action, "Débloquée");
});

// --- L'outil motion_proposer : le contrat -----------------------------------------

test("outil : « d'abord A, puis B » — refs, noms ramenés aux refs, la carte dit « après »", async () => {
  const vues = [];
  const r = await _executerOutil("motion_proposer", {
    resume: "La voiture : garage puis carrossier",
    actions: [
      { type: "creer", nom: "Réparer la voiture au garage", ref: "garage", duree: "60" },
      { type: "creer", nom: "Porter la voiture chez le carrossier", bloquee_par: ["garage"] },
      { type: "creer", nom: "Payer le carrossier", bloquee_par: ["Porter la voiture chez le carrossier"] },
    ],
  }, (i) => vues.push(i), {});
  assert.equal(r.statut, "proposition_affichee");
  const [a, b, c] = vues[0].actions;
  assert.equal(a.ref, "garage");
  assert.deepEqual(b.bloquee_par, ["garage"]);
  assert.deepEqual(b.apres, ["Réparer la voiture au garage"]);
  assert.deepEqual(c.bloquee_par, [b.ref], "le nom exact d'une création vaut sa ref");
  assert.deepEqual(c.apres, ["Porter la voiture chez le carrossier"]);
});

test("outil : refuse boucle, auto-blocage, bloquante inconnue ; ignore ref/bloquee_par hors création", async () => {
  const essai = (actions) => dependancesProposees(actions, { nomDe: async (i) => (i === "m1" ? "Tâche déjà là" : null) });
  assert.match((await essai([{ type: "creer", nom: "A", ref: "a", bloquee_par: ["b"] }, { type: "creer", nom: "B", ref: "b", bloquee_par: ["a"] }])).erreur, /en boucle/);
  assert.match((await essai([{ type: "creer", nom: "A", ref: "a", bloquee_par: ["a"] }])).erreur, /elle-même/);
  assert.match((await essai([{ type: "creer", nom: "A", bloquee_par: ["inconnue"] }])).erreur, /ni un ref de cette proposition ni une tâche Motion ouverte/);
  assert.match((await essai([{ type: "creer", nom: "A", ref: "x" }, { type: "creer", nom: "B", ref: "x" }, { type: "creer", nom: "C", bloquee_par: ["x"] }])).erreur, /même ref/);
  assert.match((await essai([{ type: "creer", nom: "A", ref: "pas bon !" }])).erreur, /invalide/);
  const ok = await essai([{ type: "creer", nom: "A", bloquee_par: ["m1"] }, { type: "terminer", id: "m2", nom: "X", ref: "r", bloquee_par: ["m1"] }]);
  assert.deepEqual(ok.actions[0].attend_ids, ["m1"], "une tâche déjà dans Motion, rangée à part");
  assert.equal(ok.actions[0].bloquee_par, undefined);
  assert.deepEqual(ok.actions[0].apres, ["Tâche déjà là"]);
  assert.deepEqual(Object.keys(ok.actions[1]).sort(), ["id", "nom", "type"]);
  const sans = await essai([{ type: "creer", nom: "Seule", ref: "seule" }]);
  assert.deepEqual(sans.actions, [{ type: "creer", nom: "Seule" }], "une ref que personne ne cite disparaît");
});

test("validée par Sam : les liens prennent les vrais identifiants ; une étape décochée ne lie à rien", async () => {
  vider();
  motion.taches.clear();
  await tachesMotion({ frais: true });
  const { actions } = await dependancesProposees([
    { type: "creer", nom: "Réparer la voiture au garage", ref: "garage" },
    { type: "creer", nom: "Porter la voiture chez le carrossier", ref: "carrossier", bloquee_par: ["garage"] },
    { type: "creer", nom: "Payer le carrossier", bloquee_par: ["carrossier", "garage"] },
  ]);
  const conv = (id) => store.putConversation({
    id, title: "t", createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ role: "user", content: "x" }, { role: "assistant", content: "je propose", proposal: { id: `p-${id}`, source: "motion", resume: "r", actions, statut: "en_attente" } }],
  });
  await conv("dep1");
  const r = await appel("POST", "/api/motion/apply", { convId: "dep1", propositionId: "p-dep1", confirmer: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ids = r.body.results.map((x) => x.taskId);
  assert.ok(ids.every(Boolean));
  assert.deepEqual(r.body.results[1].bloqueePar, [{ id: ids[0], nom: "Réparer la voiture au garage" }]);
  assert.deepEqual(carnet.blocages().par.get(ids[2]).map((x) => x.id), [ids[1], ids[0]]);
  // Rien n'est créé sans le geste de Sam : avant le POST, aucune tâche.
  vider();
  motion.taches.clear();
  await tachesMotion({ frais: true });
  await conv("dep2");
  const p = await appel("POST", "/api/motion/apply", { convId: "dep2", propositionId: "p-dep2", confirmer: true, rangs: [1, 2] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.results.length, 2);
  assert.deepEqual(p.body.results[0].liensRates, [{ ref: "garage", erreur: "écartée de la proposition" }]);
  assert.equal(p.body.results[0].bloqueePar, undefined, "le garage décoché : pas de lien vers rien");
  assert.deepEqual(carnet.blocages().par.get(p.body.results[1].taskId).map((x) => x.id), [p.body.results[0].taskId]);
});
