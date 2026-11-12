// « Le planning de Rémy, à côté de celui de Motion » par la tour
// (lib/planning-remy.js, planning-remy-v1). Ce qui est garanti ici :
//   - RIEN n'est écrit chez Motion ni dans l'agenda, et AUCUNE requête Motion
//     de plus : la liste et les horaires viennent du cache de la tour ;
//   - avant la première lecture de Motion, l'écran le dit (pas un faux planning) ;
//   - les écarts qui comptent, chacun avec sa raison : la tâche bloquée que
//     Motion place quand même, l'échéance ferme qu'il rate ;
//   - les jugements de Sam (« Rémy a raison » / « Motion a raison ») gardés sur
//     la tour, datés, comptés, retirables ; jamais écrasés si le fichier est
//     illisible ;
//   - coupé dans les Réglages : rien n'est calculé ni gardé ;
//   - sans session, ou d'une autre origine : refusé.
// Données fictives (Sam, la boutique de bougies).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};
console.warn = () => {};

const H = 3600_000;
const M = 60_000;
const iso = (ms) => new Date(ms).toISOString();

const google = http.createServer((req, res) => {
  const u = new URL(req.url, "http://g");
  res.setHeader("Content-Type", "application/json");
  google.requetes.push(`${req.method} ${u.pathname}`);
  if (u.pathname === "/token") return res.end(JSON.stringify({ access_token: "faux", expires_in: 3600 }));
  if (/\/events$/.test(u.pathname)) return res.end(JSON.stringify({ items: google.items }));
  res.statusCode = 404;
  res.end("{}");
});
google.requetes = [];
google.items = [];
await new Promise((r) => google.listen(0, "127.0.0.1", r));

const tous = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// Toute la journée, tous les jours : le test ne dépend pas de l'heure à laquelle il tourne.
const motion = await demarrerFauxMotion({ horaires: Object.fromEntries(tous.map((j) => [j, [{ start: "00:00", end: "23:59" }]])) });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-planning-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "REMY_MOTION_HORAIRE", "REMY_CIRCUIT_PLANIFICATEUR"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_API_URL = `http://127.0.0.1:${google.address().port}`;
process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;

const store = await import("../lib/store.js");
await store.putGoogleToken({ refresh_token: "faux", access_token: "faux", expire_a: Date.now() + 3600_000 });
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const carnet = await import("../lib/carnet.js");
const { CAPACITES } = await import("../lib/version.js");
const { CIRCUITS } = await import("../lib/jobs.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const lire = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const juger = async (corps, entetes = {}) => {
  const r = await fetch(`${base}/api/planning-remy/jugements`, { method: "POST", headers: { "Content-Type": "application/json", ...entetes }, body: typeof corps === "string" ? corps : JSON.stringify(corps) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const lecturesMotion = () => motion.requetes.filter((r) => r.methode === "GET").length;
const ecrituresMotion = () => motion.requetes.filter((r) => r.methode !== "GET").length;
const fichier = path.join(dossier, "planning-remy.json");

test.after(async () => {
  remy.close();
  google.close();
  await motion.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test("la capacité et le circuit existent", () => {
  assert.ok(CAPACITES.includes("planning-remy-v1"));
  assert.ok(CIRCUITS.planificateur);
});

test("avant la première lecture de Motion : « attente », et aucune requête vers Motion", async () => {
  const r = await lire("/api/planning-remy");
  assert.equal(r.status, 200);
  assert.equal(r.body.etat, "attente");
  assert.equal(motion.requetes.length, 0);
});

test("le planning de Rémy et celui de Motion, les écarts, sans requête Motion de plus et sans rien écrire", async () => {
  const dans = (h, m = 0) => Math.ceil(Date.now() / (5 * M)) * 5 * M + h * H + m * M;
  // Les photos d'abord, la newsletter ensuite : Motion place la newsletter AVANT.
  motion.ajouter({ id: "photos", name: "Tri des photos de l'été", duration: 60, scheduledStart: iso(dans(5)), scheduledEnd: iso(dans(6)) });
  motion.ajouter({ id: "news", name: "Écrire la newsletter d'automne", duration: 60, scheduledStart: iso(dans(1)), scheduledEnd: iso(dans(2)) });
  // Échéance ferme dans 3 h : Motion la place dans 10 h.
  const banque = motion.ajouter({ id: "banque", name: "Envoyer le dossier à la banque", duration: 30, dueDate: iso(dans(3)), priority: "HIGH", scheduledStart: iso(dans(10)), scheduledEnd: iso(dans(10, 30)) });
  banque.deadlineType = "HARD";
  delete motion.ajouter({ id: "facture", name: "Préparer la facture Ondine", dueDate: iso(dans(30)) }).duration; // sans durée
  carnet.poserBlocages("news", ["photos"], { noms: new Map([["news", "Écrire la newsletter d'automne"], ["photos", "Tri des photos de l'été"]]) });
  google.items = [{ id: "g1", summary: "Podologue", start: { dateTime: iso(dans(0, 30)) }, end: { dateTime: iso(dans(0, 45)) } }];

  // L'accueil lit Motion (tâches et horaires) : c'est ce cache qui sert.
  assert.equal((await lire("/api/semaine")).status, 200);
  const avant = lecturesMotion();
  const r = await lire("/api/planning-remy");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.etat, "ok");
  assert.equal(lecturesMotion(), avant, "aucune requête Motion de plus");
  assert.equal(ecrituresMotion(), 0, "rien d'écrit chez Motion");
  assert.ok(!google.requetes.some((x) => !x.startsWith("GET") && !x.endsWith("/token")), "rien d'écrit dans l'agenda");
  assert.equal(b.horairesSupposes, false);
  assert.equal(b.agenda, "ok");
  assert.equal(b.resume.taches, 4);

  const bloquee = b.ecarts.find((e) => e.id === "bloquee:news");
  assert.ok(bloquee, JSON.stringify(b.ecarts));
  assert.match(bloquee.pourquoi, /^Elle attend « Tri des photos de l'été » : Motion la place .+, avant que « Tri des photos de l'été » soit finie .+\. Rémy la met après\.$/);
  const ferme = b.ecarts.find((e) => e.id === "ferme:banque");
  assert.ok(ferme, JSON.stringify(b.ecarts));
  assert.equal(ferme.gagnant, "remy");
  assert.deepEqual(b.ecarts.slice(0, 2).map((e) => e.genre), ["bloquee", "ferme"], "les plus graves d'abord");

  const news = b.remy.placements.find((p) => p.id === "news");
  const photos = b.remy.placements.find((p) => p.id === "photos");
  assert.ok(news.debut >= photos.fin);
  assert.equal(news.raison, "Après « Tri des photos de l'été » : elle l'attend.");
  // Le rendez-vous est respecté.
  for (const p of b.remy.placements) for (const m of p.morceaux) assert.ok(m.fin <= dans(0, 30) || m.debut >= dans(0, 45), `${p.id} chevauche le rendez-vous`);
  assert.deepEqual(b.remy.nonPlaces.map((x) => [x.id, x.genre]), [["facture", "sans-duree"]]);
  assert.ok(b.motion.placements.some((p) => p.id === "news"));
  assert.ok(b.limites.length >= 3);
  assert.deepEqual(b.jugements, { remy: 0, motion: 0, total: 0, depuis: null, parGenre: {}, lisibles: true });

  // Le planning est gardé pour la prochaine ouverture (stabilité).
  const garde = JSON.parse(fs.readFileSync(fichier, "utf8"));
  assert.equal(garde.precedent.placements.length, b.remy.placements.length);
  const r2 = await lire("/api/planning-remy");
  assert.deepEqual(r2.body.remy.placements.map((p) => [p.id, p.debut]), b.remy.placements.map((p) => [p.id, p.debut]));
  assert.ok(r2.body.remy.placements.some((p) => p.gardee), "rouvert : les tâches gardent leur place");
  assert.deepEqual(r2.body.ecarts.map((e) => e.id), b.ecarts.map((e) => e.id), "les écarts gardent leur identifiant");
});

test("les jugements : gardés sur la tour, datés, comptés, retirables", async () => {
  const j1 = await juger({ ecart: "bloquee:news", verdict: "remy", resume: "Écrire la newsletter d'automne" });
  assert.equal(j1.status, 200, JSON.stringify(j1.body));
  assert.equal(j1.body.jugement.verdict, "remy");
  assert.ok(Math.abs(j1.body.jugement.a - Date.now()) < 5000);
  const j2 = await juger({ ecart: "ferme:banque", verdict: "motion" });
  assert.deepEqual([j2.body.compte.remy, j2.body.compte.motion, j2.body.compte.total], [1, 1, 2]);
  assert.deepEqual(j2.body.compte.parGenre, { bloquee: { remy: 1, motion: 0 }, ferme: { remy: 0, motion: 1 } });
  // Changer d'avis remplace.
  const j3 = await juger({ ecart: "ferme:banque", verdict: "remy" });
  assert.deepEqual([j3.body.compte.remy, j3.body.compte.motion], [2, 0]);
  const r = await lire("/api/planning-remy");
  assert.equal(r.body.ecarts.find((e) => e.id === "bloquee:news").jugement.verdict, "remy");
  assert.equal(r.body.jugements.total, 2);
  // Retirer (« Annuler »).
  const j4 = await juger({ ecart: "ferme:banque", verdict: null });
  assert.equal(j4.body.jugement, null);
  assert.equal(j4.body.compte.total, 1);
  const garde = JSON.parse(fs.readFileSync(fichier, "utf8"));
  assert.equal(garde.jugements["bloquee:news"].resume, "Écrire la newsletter d'automne");
  assert.equal(ecrituresMotion(), 0);
});

test("les jugements refusent ce qui ne se lit pas, une autre origine, et l'absence de session", async () => {
  for (const corps of [{}, { ecart: "bloquee:news", verdict: "peut-être" }, { ecart: "n'importe quoi", verdict: "remy" }, { ecart: `ordre:${"x".repeat(300)}`, verdict: "remy" }, "pas du json"]) {
    assert.equal((await juger(corps)).status, 400, JSON.stringify(corps));
  }
  assert.equal((await juger({ ecart: "bloquee:news", verdict: "motion" }, { Origin: "https://ailleurs.exemple" })).status, 403);
  process.env.APP_PASSWORD = "secret-de-test";
  try {
    assert.equal((await lire("/api/planning-remy")).status, 401);
    assert.equal((await juger({ ecart: "bloquee:news", verdict: "motion" })).status, 401);
  } finally {
    delete process.env.APP_PASSWORD;
  }
});

test("un fichier illisible n'est jamais écrasé : le planning s'affiche, un jugement est refusé", async () => {
  const sain = fs.readFileSync(fichier, "utf8");
  fs.writeFileSync(fichier, "{ abîmé");
  try {
    const r = await lire("/api/planning-remy");
    assert.equal(r.status, 200);
    assert.equal(r.body.etat, "ok");
    assert.equal(r.body.jugements.lisibles, false);
    assert.equal((await juger({ ecart: "bloquee:news", verdict: "motion" })).status, 503);
    assert.equal(fs.readFileSync(fichier, "utf8"), "{ abîmé", "rien n'a été écrasé");
  } finally {
    fs.writeFileSync(fichier, sain);
  }
});

test("coupé dans les Réglages : rien n'est calculé ni gardé", async () => {
  await store.putReglages({ circuits: { planificateur: false } });
  try {
    const avant = fs.readFileSync(fichier, "utf8");
    const r = await lire("/api/planning-remy");
    assert.deepEqual(r.body, { etat: "coupe" });
    assert.equal((await juger({ ecart: "bloquee:news", verdict: "motion" })).status, 409);
    assert.equal(fs.readFileSync(fichier, "utf8"), avant);
    const reglages = await lire("/api/reglages");
    assert.equal(reglages.body.circuits.planificateur.actif, false);
  } finally {
    await store.putReglages({ circuits: { planificateur: true } });
  }
  assert.equal((await lire("/api/planning-remy")).body.etat, "ok");
});
