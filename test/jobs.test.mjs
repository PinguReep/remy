// Moteur de jobs (Lot 0, J0.9) :
//   - un job échoué est repris (plus tard), puis abandonné — jamais noté « fait » ;
//   - deux demandes identiques ne font qu'un job ;
//   - la charge vers les Sparks est plafonnée pour le fond, jamais pour Sam ;
//   - un interrupteur coupé empêche le job, sans le compter comme échec ;
//   - la nuit est rattrapée après un arrêt, et une réflexion vide n'est pas « faite » ;
//   - les cerveaux locaux coûtent 0 $ et passent par la garde.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-jobs-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "VERCEL", "REMY_SAUVEGARDE_CLE", "REMY_CIRCUIT_NUIT", "REMY_SPARKS_MAX"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_REFLEXION_HEURE = "0"; // toujours « l'heure » : le test ne dépend pas de l'horloge
console.log = () => {}; // le lanceur de tests lit la sortie standard

const jobs = await import("../lib/jobs.js");
const planif = await import("../lib/planif.js");
const store = await import("../lib/store.js");
const { db, fermer } = await import("../lib/db.js");
const { cerveauLocal, estLocal } = await import("../lib/cerveau.js");
const { logCost } = await import("../lib/chat.js");

test.after(() => {
  fermer(); // sous Windows, une base ouverte ne se supprime pas
  fs.rmSync(dossier, { recursive: true, force: true });
});

const vider = () => db().prepare("DELETE FROM jobs").run();
const echeanceMaintenant = (type) => db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE type = ?").run(type);

test("un job échoué est repris plus tard, de plus en plus espacé, puis abandonné", async () => {
  vider();
  let essais = 0;
  jobs.enregistrer("fragile", { circuit: "syntheses", maxTentatives: 3, async executer() { essais++; throw new Error(`panne ${essais}`); } });
  const { id } = jobs.planifier("fragile");
  await jobs.passer();
  let j = jobs.lireJob(id);
  assert.equal(j.etat, "attente");
  assert.equal(j.tentatives, 1);
  assert.ok(j.prochain_essai_a > Date.now() + 5 * 60_000, "pas de nouvel essai dans la foulée");
  await jobs.passer(); // pas encore l'heure
  assert.equal(essais, 1);
  echeanceMaintenant("fragile");
  await jobs.passer();
  echeanceMaintenant("fragile");
  await jobs.passer();
  j = jobs.lireJob(id);
  assert.equal(j.etat, "abandonne");
  assert.equal(essais, 3);
  assert.match(j.erreur, /panne 3/);
  assert.ok(jobs.etatJobs().problemes.some((p) => p.type === "fragile" && p.etat === "abandonne"), "visible dans /api/health");
  // L'espacement : 10 min, 20, 40… plafonné à 2 h.
  assert.deepEqual([1, 2, 3, 9].map((n) => jobs.attenteAvantEssai(n) / 60_000), [10, 20, 40, 120]);
});

test("un job qui réussit après un échec est « fait », avec son résultat", async () => {
  vider();
  let n = 0;
  jobs.enregistrer("capricieux", { circuit: "syntheses", async executer() { if (++n === 1) throw new Error("une fois"); return { ok: n }; } });
  const { id } = jobs.planifier("capricieux");
  await jobs.passer();
  echeanceMaintenant("capricieux");
  await jobs.passer();
  const j = jobs.lireJob(id);
  assert.equal(j.etat, "fait");
  assert.deepEqual(j.resultat, { ok: 2 });
  assert.equal(j.erreur, null);
});

test("un job qui fait tomber la tour n'est pas relancé à chaque démarrage", async () => {
  vider();
  let n = 0;
  jobs.enregistrer("explosif", { circuit: "syntheses", maxTentatives: 2, async executer() { n++; } });
  const { id } = jobs.planifier("explosif");
  // Deux démarrages coupés en plein travail : les essais sont épuisés.
  db().prepare("UPDATE jobs SET etat = 'en_cours', tentatives = 2 WHERE id = ?").run(id);
  jobs.reprendreInterrompus();
  await jobs.passer();
  assert.equal(n, 0);
  assert.equal(jobs.lireJob(id).etat, "abandonne");
});

test("hors délai : pas de second lancement tant que le premier tourne ; fini après coup, il est « fait »", async () => {
  vider();
  let lancements = 0;
  jobs.enregistrer("lent", { circuit: "syntheses", delaiMaxMs: 40, async executer() { lancements++; await new Promise((r) => setTimeout(r, 250)); return { fini: true }; } });
  const { id } = jobs.planifier("lent");
  await jobs.passer();
  assert.equal(jobs.lireJob(id).etat, "attente");
  assert.match(jobs.lireJob(id).erreur, /délai maximal/);
  echeanceMaintenant("lent");
  await jobs.passer(); // le premier tourne encore : pas de second
  assert.equal(lancements, 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(jobs.lireJob(id).etat, "fait");
  assert.deepEqual(jobs.lireJob(id).resultat, { fini: true });
});

test("réglages illisibles : un circuit reste coupé plutôt que de se rallumer", async () => {
  const f = path.join(dossier, "reglages.json");
  const avant = fs.existsSync(f) ? fs.readFileSync(f) : null;
  fs.writeFileSync(f, "{ abîmé");
  try {
    assert.equal(await jobs.circuitActif("nuit"), false);
  } finally {
    if (avant) fs.writeFileSync(f, avant);
    else fs.rmSync(f, { force: true });
  }
});

test("deux demandes identiques ne font qu'un job (la priorité la plus haute l'emporte)", async () => {
  vider();
  let n = 0;
  jobs.enregistrer("synthese", { circuit: "syntheses", priorite: 5, async executer() { n++; } });
  const a = jobs.planifier("synthese", { cle: "synthese:2026-10-14" });
  const b = jobs.planifier("synthese", { cle: "synthese:2026-10-14", priorite: 1 });
  assert.equal(b.id, a.id);
  assert.equal(b.fusionne, true);
  assert.equal(jobs.lireJob(a.id).priorite, 1);
  await jobs.passer();
  // Redemandé une fois fait : toujours pas de second.
  assert.equal(jobs.planifier("synthese", { cle: "synthese:2026-10-14" }).fusionne, true);
  await jobs.passer();
  assert.equal(n, 1);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'synthese'").get().n, 1);
});

test("garde de charge : le fond plafonné, Sam jamais derrière un job, les Sparks saturées diffèrent le fond", async () => {
  jobs._reinitialiserCharge();
  process.env.REMY_SPARKS_MAX = "1";
  try {
    let simultanes = 0;
    let pic = 0;
    const inferer = (ms) =>
      jobs.inference(async () => {
        pic = Math.max(pic, ++simultanes);
        await new Promise((r) => setTimeout(r, ms));
        simultanes--;
        return "ok";
      });
    vider();
    jobs.enregistrer("lourd", { circuit: "strategie", async executer() { return inferer(80); } });
    jobs.planifier("lourd");
    jobs.planifier("lourd");
    // Deux jobs, chacun dans son passage (en parallèle) : jamais deux inférences de fond ensemble.
    await Promise.all([jobs.passer({ limite: 1 }), jobs.passer({ limite: 1 })]);
    assert.equal(pic, 1);

    // Un job occupe la seule place : le tap de Sam passe quand même, sans
    // attendre la fin du job (vérifié par l'ordre des événements, pas par un
    // chronomètre — les machines de CI sont lentes).
    pic = 0;
    simultanes = 0;
    let finJob = null;
    let jobEnCours = false;
    jobs.enregistrer("long", {
      circuit: "strategie",
      async executer() {
        jobEnCours = true;
        return inferer(1500).then((r) => ((finJob = Date.now()), r));
      },
    });
    jobs.planifier("long");
    const passe = jobs.passer({ limite: 1 });
    while (!jobEnCours) await new Promise((r) => setTimeout(r, 5));
    await inferer(10); // hors job = un tap
    assert.equal(finJob, null, "le tap est passé pendant que le job occupait la place");
    await passe;

    // Sparks saturées (429) : le fond attend la fin de la surcharge, le tap non.
    const finSurcharge = Date.now() + 250;
    jobs.signalerSurcharge(250, "test");
    let debutTap = null;
    await jobs.inference(async () => (debutTap = Date.now()));
    assert.ok(debutTap < finSurcharge, "tap servi pendant la surcharge");
    let debutFond = null;
    jobs.enregistrer("differe", { circuit: "strategie", async executer() { return jobs.inference(async () => (debutFond = Date.now())); } });
    jobs.planifier("differe");
    await jobs.passer({ limite: 1 });
    assert.ok(debutFond >= finSurcharge, `le fond a attendu la fin de la surcharge (${debutFond - finSurcharge} ms)`);
  } finally {
    delete process.env.REMY_SPARKS_MAX;
    jobs._reinitialiserCharge();
  }
});

test("un interrupteur coupé empêche le job, sans le compter comme échec ; rallumé, il part", async () => {
  vider();
  let n = 0;
  jobs.enregistrer("nocturne", { circuit: "nuit", async executer() { n++; } });
  await store.putReglages({ circuits: { nuit: false } });
  const { id } = jobs.planifier("nocturne");
  await jobs.passer();
  assert.equal(n, 0);
  assert.equal(jobs.lireJob(id).etat, "attente");
  assert.equal(jobs.lireJob(id).tentatives, 0);
  assert.equal((await jobs.etatCircuits()).nuit.actif, false);
  // La tour peut forcer, dans un sens ou dans l'autre.
  process.env.REMY_CIRCUIT_NUIT = "on";
  assert.equal(await jobs.circuitActif("nuit"), true);
  delete process.env.REMY_CIRCUIT_NUIT;
  await store.putReglages({ circuits: { nuit: true } });
  await jobs.passer();
  assert.equal(n, 1);
});

test("la nuit : rattrapée après un arrêt, et une réflexion vide n'est pas notée « faite » (défaut n°16)", async () => {
  vider();
  fs.rmSync(path.join(dossier, "planif.json"), { force: true });
  const retours = [{ ok: false, erreur: "réponse vide" }, { ok: true }];
  let appels = 0;
  planif.enregistrerNuit({ reflechir: async () => retours[appels++] });
  await planif.tick();
  assert.equal(appels, 1);
  const j = db().prepare("SELECT * FROM jobs WHERE type = 'reflexion-nuit'").get();
  assert.equal(j.etat, "attente", "pas « faite »");
  assert.match(j.erreur, /réponse vide/);
  // Coupée en pleine réflexion (arrêt de la tour) : reprise au démarrage.
  db().prepare("UPDATE jobs SET etat = 'en_cours', prochain_essai_a = 0 WHERE id = ?").run(j.id);
  assert.equal(jobs.reprendreInterrompus(), 1);
  await planif.tick();
  assert.equal(appels, 2);
  assert.equal(jobs.lireJob(j.id).etat, "fait");
  await planif.tick(); // une seule par nuit
  assert.equal(appels, 2);
  const trace = JSON.parse(fs.readFileSync(path.join(dossier, "planif.json"), "utf8"));
  assert.match(trace.reflexion, /^\d{4}-\d{2}-\d{2}$/);
});

test("une nuit manquée n'est pas rejouée en retard : elle est périmée par la suivante", async () => {
  vider();
  let n = 0;
  jobs.enregistrer("reflexion-nuit", { circuit: "nuit", async executer() { n++; } });
  await store.putReglages({ circuits: { nuit: false } });
  jobs.planifier("reflexion-nuit", { cle: "reflexion-nuit:2026-10-12" });
  jobs.perimer("reflexion-nuit", "reflexion-nuit:2026-10-13");
  jobs.planifier("reflexion-nuit", { cle: "reflexion-nuit:2026-10-13" });
  await store.putReglages({ circuits: { nuit: true } });
  await jobs.passer();
  assert.equal(n, 1);
  assert.equal(jobs.jobParCle("reflexion-nuit:2026-10-12").etat, "perime");
  assert.equal(jobs.jobParCle("reflexion-nuit:2026-10-13").etat, "fait");
});

test("réglages : les circuits se coupent d'un geste, valeur invalide refusée", async () => {
  const { routeApi } = await import("../lib/routes.js");
  const srv = http.createServer(async (req, res) => {
    if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/api/reglages`;
  const put = (b) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  try {
    const r = await put({ circuits: { strategie: false } });
    assert.equal(r.status, 200);
    const v = await r.json();
    assert.equal(v.circuits.strategie.actif, false);
    assert.equal(v.circuits.nuit.actif, true);
    assert.equal((await put({ circuits: { inconnu: false } })).status, 400);
    assert.equal((await put({ circuits: { nuit: "non" } })).status, 400);
    assert.equal((await put({})).status, 400);
    await put({ circuits: { strategie: true } });
  } finally {
    srv.close();
  }
});

test("cerveaux locaux (Hermès, Qwen) : 0 $, via la garde, JSON validé, 429 = Sparks saturées", async () => {
  let quatreCentVingtNeuf = false;
  const relais = http.createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      if (quatreCentVingtNeuf) return res.writeHead(429).end("{}");
      const b = JSON.parse(corps);
      const contenu = b.response_format ? JSON.stringify({ priorite: "santé" }) : "<think>…</think>Réponse de Hermès";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: contenu } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }));
    });
  });
  await new Promise((r) => relais.listen(0, "127.0.0.1", r));
  try {
    const hermes = cerveauLocal({ nom: "hermes", url: `http://127.0.0.1:${relais.address().port}/v1`, modele: "hermes-4" });
    assert.equal(hermes.local, true);
    const t = await hermes.completer({ system: "s", prompt: "p" });
    assert.equal(t.text, "Réponse de Hermès");
    const a = await hermes.analyser({ prompt: "p", schema: { type: "object" } });
    assert.deepEqual(a.valeur, { priorite: "santé" });
    // Le panneau des coûts : 0 $, quel que soit le nom du modèle.
    assert.equal(estLocal("hermes"), true);
    await logCost("strategie", "hermes", "hermes-4", t.usage, "r1", "test");
    await logCost("nuit", "glm", "zai-org/GLM-5.3-FP8", t.usage, "r2", "test");
    const couts = await store.listCostEntries();
    assert.deepEqual(couts.slice(0, 2).map((c) => c.usd), [0, 0]);
    // Saturé : l'erreur le dit, et le fond est différé.
    jobs._reinitialiserCharge();
    quatreCentVingtNeuf = true;
    await assert.rejects(hermes.completer({ prompt: "p" }), /occupé/);
    assert.ok(jobs.etatCharge().surcharge, "fond différé");
  } finally {
    jobs._reinitialiserCharge();
    relais.close();
  }
});
