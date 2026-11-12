// Le travail de fond cède la place (règle du 12/11, CLAUDE.md, lib/priorite.js) :
//   - le classement (demandé / attendu / fond) vit à un seul endroit, et chaque
//     job de la tour y est ;
//   - une demande de Sam passe devant le fond qui utilise le modèle local :
//     mesuré contre un faux modèle lent à une seule place ;
//   - le fond ne commence aucun appel pendant une demande, reprend après, sans
//     rien perdre ni rien faire deux fois, et son délai ne compte pas la pause ;
//   - une mise à jour n'attend plus le fond (sauf une sauvegarde qui écrit) ;
//     arrêté net en pause, il laisse la base cohérente et reprend sans compter
//     d'essai (vrai processus tué) ;
//   - Réglages › Diagnostic le dit, sans bruit.
// Tout est fictif ; aucune attente longue (délais de quelques centaines de ms).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fauxModeleLent } from "./outils/faux-modele-lent.mjs";
import { travailEssai } from "./outils/fond-travail.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-fond-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "VERCEL", "REMY_SAUVEGARDE_CLE", "REMY_SPARKS_MAX", "REMY_CIRCUIT_NUIT", "REMY_CIRCUIT_SYNTHESES"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// Le fond : 900 ms de calcul ; Sam : 20 ms. Une seule place.
const modele = await fauxModeleLent({ duree: (t) => (/FOND/.test(t) ? 900 : 20) });
process.env.REMY_GLM_URL = modele.url;
process.env.REMY_GLM_TOKEN = "jeton-essai";

const prio = await import("../lib/priorite.js");
const jobs = await import("../lib/jobs.js");
const planif = await import("../lib/planif.js");
const { glmProvider } = await import("../lib/providers.js");
const serveurMaj = await import("../lib/maj-auto-serveur.js");
const { db, fermer } = await import("../lib/db.js");

test.after(async () => {
  await modele.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, maxMs = 5_000, quoi = "condition") {
  const fin = Date.now() + maxMs;
  while (!cond()) {
    if (Date.now() > fin) throw new Error(`jamais vu : ${quoi}`);
    await attendre(5);
  }
}
const remiseAZero = () => {
  db().prepare("DELETE FROM jobs").run();
  prio._reinitialiser();
  jobs._reinitialiserCharge();
  modele.etat.recus.length = modele.etat.coupes.length = modele.etat.servis.length = 0;
  delete process.env.REMY_FOND_REPIT_MS;
  process.env.REMY_FOND_REPIT_MS = "0";
};
const fichierEssai = (nom) => path.join(dossier, `${nom}.txt`);
const etapes = (f) => (fs.existsSync(`${f}.etapes`) ? fs.readFileSync(`${f}.etapes`, "utf8").trim().split("\n") : []);

test("classement : un seul endroit ; chaque job de la tour y est ; le fond qui appelle le modèle est interruptible", async () => {
  // Les jobs que la tour enregistre vraiment (server.js → demarrerPlanificateur).
  planif.enregistrerNuit({ reflechir: async () => ({ ok: true }), faireSauvegarde: async () => ({ nom: "x", copies: [] }) });
  planif.enregistrerConnaissances({ fournisseur: { name: "glm", complete: async () => ({ text: "{}" }) }, noterCout: async () => {} });
  planif.enregistrerRegles();
  planif.enregistrerLieux();
  planif.enregistrerActivitePC();
  (await import("../lib/commerces-maj.js")).enregistrerCommerces();
  const types = jobs.typesDeJobs();
  assert.ok(types.length >= 10);
  for (const t of types) assert.ok(prio.TRAVAUX[t], `le job « ${t} » est classé dans lib/priorite.js`);
  for (const t of ["conseil", "compactage"]) assert.equal(prio.TRAVAUX[t].categorie, "fond", `${t} (hors job) est du fond`);
  for (const [id, t] of Object.entries(prio.TRAVAUX)) {
    assert.ok(prio.CATEGORIES[t.categorie], `${id} : catégorie connue`);
    assert.ok(t.nom && t.coupure, `${id} : un nom et ce qui se passe à l'interruption`);
    if (t.categorie === "fond" && t.modele) assert.equal(t.interruptible, true, `${id} : fond avec le modèle → interruptible`);
    if (t.categorie !== "fond") assert.ok(!t.interruptible, `${id} : une demande n'est jamais coupée par le fond`);
  }
  assert.equal(prio.TRAVAUX["reflexion-nuit"].nom, "Réflexion de nuit");
  assert.equal(prio.TRAVAUX["sauvegarde-nuit"].interruptible, undefined, "la sauvegarde ne se coupe pas au milieu");
  assert.equal(prio.classement("inconnu").categorie, "fond", "dans le doute, il cède");
  // Ce qu'une requête de l'app demande.
  const n = prio.natureRequete;
  assert.equal(n("GET", "/api/conversations"), null, "une lecture ne fait rien céder");
  assert.equal(n("POST", "/api/conversations/abc/messages"), "question");
  assert.equal(n("POST", "/api/conversations/abc/pieces"), "piece");
  assert.equal(n("POST", "/api/transcribe"), "dictee");
  assert.equal(n("POST", "/api/dictee/correction"), "dictee");
  assert.equal(n("POST", "/api/capture"), "capture");
  assert.equal(n("POST", "/api/capture/image?x=1"), "capture");
  assert.equal(n("PUT", "/api/memory"), "ecriture");
  assert.equal(n("POST", "/api/activite/ping"), "passive", "le signe de vie ne fait pas céder le fond");
  assert.equal(n("POST", "/api/lieux/evenements"), "passive");
  assert.equal(n("POST", "/api/maj-auto/ceder"), null, "la mise à jour ne s'attend pas elle-même");
  assert.equal(n("PUT", "/api/maj-auto"), null);
});

test("une question passe devant la réflexion de nuit : mesurée contre un faux modèle lent à une seule place", async (t) => {
  remiseAZero();
  const f = fichierEssai("mesure");
  jobs.enregistrer("reflexion-nuit", { circuit: "syntheses", executer: travailEssai(glmProvider, f) });
  const { id } = jobs.planifier("reflexion-nuit", { cle: "reflexion-nuit:2026-11-12", entree: { jour: "2026-11-12" } });
  const passe = jobs.passer({ limite: 1 });
  await modele.enCalcul(/FOND/);

  const t0 = Date.now();
  const fin = prio.debutDemande("question");
  assert.equal(prio.etatFond().travaux[0]?.nom, "Réflexion de nuit");
  const r = await glmProvider.complete({ system: "Essai", prompt: "Quelle bougie pour la vitrine ?" });
  const attente = Date.now() - t0;
  t.diagnostic(`réponse à Sam en ${attente} ms, pendant un travail de fond de 900 ms`);
  assert.match(r.text, /vitrine/);
  assert.ok(attente < 450, `Sam n'a pas attendu la fin du fond (${attente} ms)`);
  assert.equal(modele.etat.coupes.length, 1, "l'appel de fond a été coupé (connexion fermée)");
  assert.match(modele.etat.coupes[0], /FOND/);
  await jusqua(() => prio.etatFond().travaux[0]?.etat === "pause", 2_000, "fond en pause");
  assert.equal(prio.etatFond().ligne, "Réflexion de nuit en pause : tu viens de poser une question");
  fin();

  const [res] = await passe;
  assert.equal(res.etat, "fait");
  const j = jobs.lireJob(id);
  assert.equal(j.tentatives, 1, "céder n'est pas un échec");
  assert.equal(j.erreur, null);
  assert.deepEqual(etapes(f), ["lecture", "ecrit"], "rien fait deux fois : une lecture, une écriture");
  assert.match(fs.readFileSync(f, "utf8"), /^2026-11-12 : Réponse à « FOND/);
  assert.equal(modele.etat.recus.filter((x) => /FOND/.test(x)).length, 2, "l'appel coupé a été refait en entier");
  assert.equal(prio.etatFond().ligne, "Rien en fond en ce moment.");

  // Témoin : le même fond NON interruptible (un appel qui ignore le signal) —
  // la question attend alors derrière lui : le faux modèle n'a bien qu'une place.
  remiseAZero();
  jobs.enregistrer("temoin", {
    circuit: "syntheses",
    executer: () => jobs.inference(() => fetch(`${modele.url}/chat/completions`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "FOND témoin" }] }) }).then((x) => x.json())),
  });
  jobs.planifier("temoin");
  const passeTemoin = jobs.passer({ limite: 1 });
  await modele.enCalcul(/FOND/);
  const t1 = Date.now();
  await glmProvider.complete({ system: "Essai", prompt: "Et maintenant ?" });
  const attenteTemoin = Date.now() - t1;
  t.diagnostic(`témoin non interruptible : réponse en ${attenteTemoin} ms`);
  assert.ok(attenteTemoin >= 450, `sans interruption, Sam aurait attendu (${attenteTemoin} ms)`);
  await passeTemoin;
});

test("pendant une demande, le fond ne commence rien ; il repart après le répit, sans rien perdre", async () => {
  remiseAZero();
  process.env.REMY_FOND_REPIT_MS = "200";
  // Un job dû pendant une dictée : il ne commence pas (au passage suivant).
  let n = 0;
  jobs.enregistrer("lieux-purge", { circuit: "socle", async executer() { n++; return { effaces: 0 }; } });
  const fin = prio.debutDemande("dictee");
  jobs.planifier("lieux-purge", { cle: "lieux-purge:essai" });
  assert.deepEqual(await jobs.passer(), [], "aucun job ne commence pendant une demande");
  assert.equal(n, 0);
  assert.equal(jobs.jobParCle("lieux-purge:essai").etat, "attente", "il attend, rien n'est compté");

  // Un job déjà parti, qui arrive à son appel au modèle pendant la dictée : en pause.
  let ouvrir;
  const porte = new Promise((r) => (ouvrir = r));
  const f = fichierEssai("repit");
  const travail = travailEssai(glmProvider, f);
  jobs.enregistrer("conversations-nuit", { circuit: "syntheses", async executer(e) { await porte; return travail(e); } });
  fin(); // (le temps de le lancer)
  process.env.REMY_FOND_REPIT_MS = "0";
  const { id } = jobs.planifier("conversations-nuit", { cle: "conversations-nuit:essai", entree: { jour: "2026-11-11" }, priorite: 0 });
  const passe = jobs.passer({ limite: 1 });
  await jusqua(() => prio.travauxDeFond().length === 1, 2_000, "job parti");
  process.env.REMY_FOND_REPIT_MS = "200";
  const fin2 = prio.debutDemande("dictee");
  ouvrir();
  await jusqua(() => prio.etatFond().travaux[0]?.etat === "pause", 2_000, "pause");
  assert.equal(prio.etatFond().ligne, "Relecture de nuit des conversations d'ailleurs en pause : tu viens de dicter");
  await attendre(80);
  assert.equal(modele.etat.recus.length, 0, "aucun appel au modèle pendant la dictée");
  fin2();
  const finDemande = Date.now();
  await attendre(60);
  assert.equal(modele.etat.recus.length, 0, "ni pendant le répit");
  assert.equal(prio.etatFond().travaux[0]?.etat, "pause");
  assert.equal(prio.fondDoitCeder()?.enCours, false, "le répit, pas une demande");
  const [res] = await passe;
  assert.equal(res.etat, "fait");
  assert.ok(Date.now() - finDemande >= 200, "reparti après le répit");
  assert.deepEqual(etapes(f), ["lecture", "ecrit"]);
  assert.equal(jobs.lireJob(id).tentatives, 1);
  // Le job laissé en attente part au passage suivant.
  await attendre(220);
  await jobs.passer();
  assert.equal(n, 1);
});

test("le délai maximal d'un job ne compte pas le temps passé en pause", async () => {
  remiseAZero();
  jobs.enregistrer("compactage-essai", { circuit: "syntheses", delaiMaxMs: 120, async executer() { return jobs.inference(async () => "ok"); } });
  const fin = prio.debutDemande("question");
  jobs.planifier("compactage-essai", { cle: "c:1" });
  // (passer ne commence rien pendant une demande : on lance le job avant.)
  fin();
  const passe = jobs.passer({ limite: 1 });
  const fin2 = prio.debutDemande("question"); // arrive avant son appel au modèle
  await attendre(400); // plus de trois fois son délai, en pause
  fin2();
  const [res] = await passe;
  assert.equal(res.etat, "fait", `pas « délai dépassé » (${res.erreur || ""})`);
});

test("une mise à jour n'attend plus le fond : pause entre deux étapes, reprise sans essai compté ; une sauvegarde qui écrit la retient", async () => {
  remiseAZero();
  const f = fichierEssai("maj");
  jobs.enregistrer("reflexion-nuit", { circuit: "syntheses", executer: travailEssai(glmProvider, f) });
  let finirSauvegarde;
  const sauvegarde = new Promise((r) => (finirSauvegarde = r));
  jobs.enregistrer("sauvegarde-nuit", { circuit: "socle", priorite: 1, async executer() { await sauvegarde; return { nom: "essai" }; } });
  const { id } = jobs.planifier("reflexion-nuit", { cle: "reflexion-nuit:maj", entree: { jour: "2026-11-10" }, priorite: 0 });
  const passeReflexion = jobs.passer({ limite: 1 });
  await modele.enCalcul(/FOND/);
  jobs.planifier("sauvegarde-nuit", { cle: "sauvegarde-nuit:maj", entree: { jour: "2026-11-10" } });
  const passeSauvegarde = jobs.passer({ limite: 1 });
  await jusqua(() => prio.travauxDeFond().length === 2, 2_000, "deux travaux de fond");

  // Avant : la réflexion en plein calcul « cède à la mise à jour ».
  assert.match(serveurMaj.occupation().raisons.join(" "), /Réflexion de nuit : appel au modèle en cours \(cède à la mise à jour\)/);
  assert.equal(await jobs.cederPourMiseAJour({ reposMs: 2_000 }), true, "l'appel en vol est revenu en pause");
  let o = serveurMaj.occupation();
  assert.deepEqual(o.raisons, ["travail de fond : Sauvegarde de la nuit en cours (ne se coupe pas au milieu)"], "seule la sauvegarde qui écrit retient");
  assert.equal(jobs.lireJob(id).erreur, jobs.MARQUE_PAUSE_MAJ, "pause notée dans la file");
  assert.equal(prio.etatFond().ligne, "Réflexion de nuit en pause : une mise à jour s'installe · Sauvegarde de la nuit en cours");
  assert.equal(modele.etat.coupes.length, 1);
  // Un job dû ne commence pas pendant le bail.
  jobs.enregistrer("carnet-purge", { circuit: "socle", async executer() { return {}; } });
  jobs.planifier("carnet-purge", { cle: "carnet-purge:maj" });
  assert.deepEqual(await jobs.passer(), []);

  finirSauvegarde();
  await passeSauvegarde;
  o = serveurMaj.occupation();
  assert.equal(o.occupe, false, `plus rien ne retient : ${o.raisons.join(", ")}`);

  // La mise à jour n'a pas eu lieu (DELETE /api/maj-auto/ceder) : la réflexion reprend, finit une fois.
  assert.equal(prio.reprendreApresMiseAJour(), true);
  const [res] = await passeReflexion;
  assert.equal(res.etat, "fait");
  const j = jobs.lireJob(id);
  assert.equal(j.erreur, null);
  assert.equal(j.tentatives, 1);
  assert.deepEqual(etapes(f), ["lecture", "ecrit"]);
});

test("arrêtée net en pause (vrai processus tué, comme l'installeur arrête node) : base cohérente, reprise sans essai compté, rien fait deux fois", async () => {
  remiseAZero();
  const f = fichierEssai("tue");
  const enfant = fork(path.join(ICI, "outils", "fond-enfant.mjs"), [], {
    env: { ...process.env, FICHIER_ESSAI: f },
    execArgv: ["--no-warnings"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const messages = [];
  enfant.on("message", (m) => messages.push(m));
  try {
    await jusqua(() => messages.includes("pret"), 10_000, "enfant prêt");
    await modele.enCalcul(/FOND/, 10_000);
    enfant.send("ceder");
    await jusqua(() => messages.some((m) => m?.occupation), 10_000, "réponse de l'enfant");
    const r = messages.find((m) => m?.occupation);
    assert.equal(r.repos, true);
    assert.equal(r.occupation.occupe, false, `la mise à jour peut arrêter Rémy : ${r.occupation.raisons.join(", ")}`);
    assert.equal(r.job.etat, "en_cours");
    assert.equal(r.job.erreur, jobs.MARQUE_PAUSE_MAJ);
  } finally {
    enfant.kill("SIGKILL");
    await new Promise((res) => (enfant.exitCode !== null || enfant.signalCode ? res() : enfant.once("exit", res)));
  }
  assert.equal(fs.existsSync(f), false, "rien d'écrit à moitié");
  assert.equal(fs.existsSync(`${f}.tmp`), false);
  assert.deepEqual(etapes(f), ["lecture"]);

  // Le redémarrage (même base) : repris sans compter l'essai, puis fait une fois.
  assert.equal(jobs.reprendreInterrompus(), 1);
  const j = jobs.jobParCle("essai-coupe:2026-11-12");
  assert.equal(j.etat, "attente");
  assert.equal(j.tentatives, 0, "la pause pour la mise à jour n'est pas un essai");
  assert.equal(j.erreur, null, "pas une alerte dans /api/health");
  jobs.enregistrer("essai-coupe", { circuit: "syntheses", maxTentatives: 2, executer: travailEssai(glmProvider, f) });
  const [res] = await jobs.passer({ limite: 1 });
  assert.equal(res.etat, "fait");
  assert.deepEqual(etapes(f), ["lecture", "lecture", "ecrit"], "la lecture se refait (idempotente), l'écriture une seule fois");
  assert.match(fs.readFileSync(f, "utf8"), /^2026-11-12 : Réponse à « FOND/);
  assert.equal(jobs.lireJob(j.id).tentatives, 1);
});

test("un travail attendu retient la mise à jour, même en pause ; il cède quand même à une demande", () => {
  remiseAZero();
  const ctx = prio.debutFond("briefing-matin");
  assert.equal(ctx.fond, true, "il cède à une demande de Sam");
  ctx.etat = "pause";
  assert.deepEqual(serveurMaj.occupation().raisons, ["travail de fond : Briefing du matin (attendu)"]);
  prio.finFond(ctx);
  assert.equal(serveurMaj.occupation().occupe, false);
});

test("un arrêt ordinaire (pas une mise à jour) compte toujours son essai", () => {
  remiseAZero();
  jobs.enregistrer("ordinaire", { circuit: "syntheses", async executer() {} });
  const { id } = jobs.planifier("ordinaire");
  db().prepare("UPDATE jobs SET etat = 'en_cours', tentatives = 1 WHERE id = ?").run(id);
  jobs.reprendreInterrompus();
  const j = jobs.lireJob(id);
  assert.equal(j.tentatives, 1);
  assert.match(j.erreur, /interrompu par un arrêt/);
});

test("conseil précalculé et compactage automatique : du fond qui cède ; demandés d'un tap, ils sont promus (jamais d'attente sur soi-même)", async () => {
  remiseAZero();
  const conseil = await import("../lib/conseil.js");
  const { compacter } = await import("../lib/compactage.js");
  const store = await import("../lib/store.js");
  conseil._vider();

  const fin = prio.debutDemande("question");
  const auto = conseil.lancer("maintenant", { jour: "2026-11-12" }, "cle-essai", { auto: true });
  await jusqua(() => prio.etatFond().travaux.some((x) => x.travail === "conseil" && x.etat === "pause"), 2_000, "conseil en pause");
  assert.match(prio.etatFond().ligne, /^Conseil précalculé en pause : tu viens de poser une question/);
  assert.equal(modele.etat.recus.length, 0);
  // « Un autre conseil » pendant que la question court : promu, il part.
  conseil.lancer("maintenant", { jour: "2026-11-12" }, "cle-essai", { auto: false });
  await Promise.race([auto, attendre(2_000).then(() => assert.fail("le conseil promu n'est pas parti"))]);
  assert.equal(modele.etat.recus.length, 1);

  const messages = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Message ${i} sur la vitrine de la boutique de bougies` }));
  await store.putConversation({ id: "conv-essai-fond", title: "Vitrine", messages, createdAt: 1, updatedAt: 1 });
  const fond = compacter("conv-essai-fond", { fond: true });
  await jusqua(() => prio.etatFond().travaux.some((x) => x.travail === "compactage" && x.etat === "pause"), 2_000, "compactage en pause");
  // Sam appuie sur « compacter » dans la jauge (une demande en cours) : promu, pas d'attente sur lui-même.
  const demande = compacter("conv-essai-fond");
  assert.equal(demande, fond, "le même travail");
  const r = await Promise.race([demande, attendre(3_000).then(() => "bloqué")]);
  assert.notEqual(r, "bloqué");
  assert.equal(r.compacte, true);
  fin();
});

test("routes : POST /api/maj-auto/ceder (jeton de la tâche) met le fond en pause ; DELETE le relance ; GET /api/fond le dit", async () => {
  remiseAZero();
  const { routeApi } = await import("../lib/routes.js");
  const M = await import("../lib/maj-auto.js");
  const remy = http.createServer(async (req, res) => {
    if (!(await routeApi(req, res))) {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise((r) => remy.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${remy.address().port}`;
  process.env.APP_PASSWORD = "mot-de-passe-de-test";
  const { makeSessionToken } = await import("../lib/auth.js");
  const session = { Cookie: `remy_session=${makeSessionToken()}` };
  try {
    const client = M.clientRemy({ url: base, env: process.env, pauseMs: 1 });
    assert.deepEqual(await client.ceder(), { joignable: true, occupe: false, raisons: [] });
    assert.ok(prio.bailMiseAJour(), "le fond est tenu en pause");
    let v = await (await fetch(`${base}/api/fond`, { headers: session })).json();
    assert.equal(v.ligne, "Rien en fond en ce moment (le fond attend : une mise à jour s'installe).");
    assert.equal(v.cede.nature, "maj");
    assert.equal(await client.reprendre(), true);
    assert.equal(prio.bailMiseAJour(), null);
    v = await (await fetch(`${base}/api/fond`, { headers: session })).json();
    assert.equal(v.ligne, "Rien en fond en ce moment.");
    assert.equal((await fetch(`${base}/api/fond`)).status, 401, "jamais sans session");
    assert.equal((await fetch(`${base}/api/fond`, { headers: { Cookie: `remy_session=${M.jetonSession(process.env)}` } })).status, 401, "le jeton de la tâche n'ouvre pas /api/fond");
    // Retenu seulement par une demande de Sam : le bail est levé (ses demandes font déjà céder le fond).
    const fin = prio.debutDemande("question");
    const o = await client.ceder();
    assert.equal(o.occupe, true);
    assert.deepEqual(o.raisons, ["1 écriture en cours"]);
    assert.equal(prio.bailMiseAJour(), null);
    fin();
    // Une tour d'avant (sans /ceder) : l'occupation d'avant.
    const vieux = M.clientRemy({ url: base, env: process.env, fetch: async (u, o2) => (String(u).endsWith("/ceder") ? new Response("{}", { status: 404 }) : fetch(u, o2)) });
    assert.equal((await vieux.ceder()).occupe, false);
    const { CAPACITES } = await import("../lib/version.js");
    assert.ok(CAPACITES.includes("fond-cede-v1"));
  } finally {
    delete process.env.APP_PASSWORD;
    prio.reprendreApresMiseAJour();
    remy.close();
  }
});
