// L'activité du PC (24/10) : ActivityWatch lu sur la tour, temps ACTIF seulement
// (fenêtre ∩ présent), des totaux par jour et par application, jamais un titre,
// 90 jours puis effacé, et ce que Rémy en sait ne part qu'au modèle local.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
const avertissements = [];
console.warn = (...a) => avertissements.push(a.join(" "));

// Un faux modèle local qui garde la consigne reçue.
const consignes = [];
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3" }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }));
    }
    consignes.push(corps.messages[0].content);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(delta({ content: "D'accord." }))}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

// Un faux Claude qui garde la consigne reçue (elle ne doit jamais contenir l'activité).
const consignesClaude = [];
const anthropic = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const b = JSON.parse(corps || "{}");
    consignesClaude.push(JSON.stringify(b.system || ""));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", { message: { id: "m", type: "message", role: "assistant", content: [], model: b.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Oui." } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev("message_stop", {});
    res.end();
  });
});
await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));

// Un faux ActivityWatch (API REST /api/0), comme celui de la tour.
const aw = { eteint: false, hote: "tour-essai", fenetres: [], absences: [], web: [], requetes: 0 };
const serveurAW = http.createServer((req, res) => {
  aw.requetes++;
  if (aw.eteint) return req.socket.destroy();
  const u = new URL(req.url, "http://aw");
  const json = (code, v) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(v));
  };
  if (u.pathname === "/api/0/info") return json(200, { hostname: aw.hote, version: "v0.13.2", testing: false });
  if (u.pathname === "/api/0/buckets/") {
    const seau = (id, type) => ({ id, type, hostname: aw.hote, client: id.split("_")[0], created: "2026-01-01T00:00:00Z" });
    return json(200, {
      [`aw-watcher-window_${aw.hote}`]: seau(`aw-watcher-window_${aw.hote}`, "currentwindow"),
      [`aw-watcher-afk_${aw.hote}`]: seau(`aw-watcher-afk_${aw.hote}`, "afkstatus"),
      [`aw-watcher-web-chrome_${aw.hote}`]: seau(`aw-watcher-web-chrome_${aw.hote}`, "web.tab.current"),
    });
  }
  const m = u.pathname.match(/^\/api\/0\/buckets\/([^/]+)\/events$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const liste = id.startsWith("aw-watcher-window") ? aw.fenetres : id.startsWith("aw-watcher-afk") ? aw.absences : aw.web;
    const a = Date.parse(u.searchParams.get("start"));
    const b = Date.parse(u.searchParams.get("end"));
    // Comme ActivityWatch : les événements qui touchent l'intervalle, entiers, le plus récent d'abord.
    return json(
      200,
      liste.filter((e) => Date.parse(e.timestamp) + e.duration * 1000 >= a && Date.parse(e.timestamp) <= b).sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp)),
    );
  }
  json(404, { message: "inconnu" });
});
await new Promise((r) => serveurAW.listen(0, "127.0.0.1", r));

const ferme = http.createServer();
await new Promise((r) => ferme.listen(0, "127.0.0.1", r));
const portFerme = ferme.address().port;
await new Promise((r) => ferme.close(r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-activite-pc-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "REMY_CERVEAU", "REMY_ACTIVITE_PC", "REMY_ACTIVITE_PC_JOURS", "REMY_ACTIVITE_EXCLURE", "REMY_ACTIVITE_CATEGORIES"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_ACTIVITYWATCH_URL = `http://127.0.0.1:${serveurAW.address().port}`;
process.env.REMY_BROWSE = "off";
process.env.REMY_PRENOM = "Sam";
// La journée d'essai (de 6 h à 2 h en arrière) doit tomber « aujourd'hui »
// quelle que soit l'heure : un fuseau où il est 14 h.
{
  const h = ((14 - new Date().getUTCHours() + 36) % 24) - 12;
  process.env.REMY_TZ = h === 0 ? "Etc/UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}

const pc = await import("../lib/activite-pc.js");
const jobs = await import("../lib/jobs.js");
const { enregistrerActivitePC } = await import("../lib/planif.js");
const { routeApi } = await import("../lib/routes.js");
const { db, fermer, cheminBase } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => {
  remy.close();
  glm.close();
  anthropic.close();
  serveurAW.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const envoyer = (m, chemin, corps) => fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
const lire = async () => (await fetch(`${base}/api/activite-pc`)).json();
async function discuter(texte) {
  const c = await (await envoyer("POST", "/api/conversations", {})).json();
  await (await envoyer("POST", `/api/conversations/${c.id}/messages`, { text: texte })).text();
}

// Une journée fictive, de T0 (6 h en arrière) à T0 + 4 h.
const MIN = 60_000;
const H = 60 * MIN;
const T0 = Math.floor((Date.now() - 6 * H) / MIN) * MIN;
let n = 0;
const ev = (debut, fin, data) => ({ id: ++n, timestamp: new Date(debut).toISOString(), duration: (fin - debut) / 1000, data });
// Présent de T0 à T0+2h, absent de T0+1h50 à T0+2h30 (l'absence est datée en
// arrière : les deux se chevauchent 10 min, l'absence l'emporte), présent ensuite.
aw.absences = [
  ev(T0, T0 + 2 * H, { status: "not-afk" }),
  ev(T0 + 110 * MIN, T0 + 150 * MIN, { status: "afk" }),
  ev(T0 + 150 * MIN, T0 + 4 * H, { status: "not-afk" }),
];
// Les titres sont privés : ils ne doivent jamais apparaître nulle part.
aw.fenetres = [
  ev(T0, T0 + 90 * MIN, { app: "Code.exe", title: "projet-secret-zorglub.js — Code" }),
  ev(T0 + 80 * MIN, T0 + 95 * MIN, { app: "Code.exe", title: "projet-secret-zorglub.js — Code" }), // un guetteur qui bégaie
  ev(T0 + 90 * MIN, T0 + 160 * MIN, { app: "chrome.exe", title: "Banque Fictive — mon compte courant" }),
  ev(T0 + 160 * MIN, T0 + 180 * MIN, { app: "Discord.exe", title: "#salon-prive — Discord" }),
  ev(T0 + 180 * MIN, T0 + 4 * H, { app: "Code.exe", title: "notes-intimes.md — Code" }),
];
aw.web = [
  ev(T0 + 90 * MIN, T0 + 160 * MIN, { url: "https://www.banque-fictive.example/compte/123?session=abc", title: "Banque Fictive — mon compte courant", incognito: false }),
  ev(T0 + 155 * MIN, T0 + 160 * MIN, { url: "https://cache.example/rien", title: "Onglet privé", incognito: true }),
];
// Code 90 + 60 min, Chrome 20 + 10 min (le reste est absent), Discord 20 min.
const ATTENDU = { code: 150 * 60, chrome: 30 * 60, discord: 20 * 60 };
const SECRETS = ["zorglub", "Banque Fictive", "compte courant", "/compte", "session=abc", "salon-prive", "notes-intimes", "cache.example"];

test("le calcul : fenêtre ∩ présent, l'absence l'emporte, aucun double compte, aucun titre", () => {
  const r = pc.calculer({ fenetres: aw.fenetres, absences: aw.absences, web: aw.web }, T0 - H, T0 + 5 * H);
  assert.deepEqual(Object.fromEntries(r.applis), ATTENDU);
  assert.deepEqual(Object.fromEntries(r.domaines), { "banque-fictive.example": 30 * 60 }, "le domaine seul, et seulement quand le navigateur est devant Sam");
  const brut = JSON.stringify([...r.applis, ...r.domaines]);
  for (const s of SECRETS) assert.ok(!brut.includes(s), s);
  // Une tranche coupe les événements à ses bords : deux moitiés font le tout.
  const avant = pc.calculer({ fenetres: aw.fenetres, absences: aw.absences }, T0 - H, T0 + 100 * MIN);
  const apres = pc.calculer({ fenetres: aw.fenetres, absences: aw.absences }, T0 + 100 * MIN, T0 + 5 * H);
  assert.equal(avant.applis.get("code") + apres.applis.get("code"), ATTENDU.code);
  assert.equal(avant.applis.get("chrome") + apres.applis.get("chrome"), ATTENDU.chrome);
  // Une application exclue garde sa place au premier plan, sans être comptée.
  const sans = pc.calculer({ fenetres: aw.fenetres, absences: aw.absences }, T0 - H, T0 + 5 * H, { exclues: new Set(["discord"]) });
  assert.equal(sans.applis.has("discord"), false);
  assert.equal(sans.applis.get("code"), ATTENDU.code);
  // Sans guetteur d'absence : rien n'est compté (pas de temps « actif » supposé).
  assert.equal(pc.calculer({ fenetres: aw.fenetres, absences: [] }, T0 - H, T0 + 5 * H).applis.size, 0);
  assert.equal(pc.domaineDe("file:///C:/Users/sam/x.txt"), null);
  assert.equal(pc.categorieDe("Code.exe"), "developpement");
  assert.equal(pc.categorieDe("UnJeu-Win64-Shipping.exe"), "jeux");
  assert.equal(pc.categorieDe("inconnue.exe"), "autre");
  assert.equal(pc.dureeLisible(190 * 60), "3 h 10");
  assert.equal(pc.dureeLisible(65 * 60), "1 h 05");
  assert.equal(pc.dureeLisible(45 * 60), "45 min");
});

test("coupée par défaut : ActivityWatch n'est même pas interrogé, Rémy ne sait rien", async () => {
  const v = await lire();
  assert.equal(v.actif, false);
  assert.equal(v.aujourdhui.total, 0);
  assert.equal((await pc.collecter()).saute, "coupé");
  await discuter("Je fais quoi ?");
  assert.doesNotMatch(consignes.at(-1), /Activité du PC/);
  assert.equal(aw.requetes, 0);
  const v2 = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v2.capacites.includes("activite-pc-v1"));
});

test("relevés successifs, coupure d'ActivityWatch, reprise : chaque seconde comptée une fois", async () => {
  // Allumée (sans relevé) ; premier relevé au milieu de la journée d'essai.
  pc.regler({ actif: true }, T0 + 105 * MIN);
  const r1 = await pc.collecter({ maintenant: T0 + 105 * MIN });
  assert.ok(r1.tranches >= 1, JSON.stringify(r1));
  assert.equal(pc.vue().aujourdhui.total, 100 * 60, "jusqu'à 5 min avant le relevé : Code 90 min + Chrome 10 min");
  // ActivityWatch s'éteint : état clair, aucune erreur, un seul avertissement.
  aw.eteint = true;
  avertissements.length = 0;
  assert.equal((await pc.collecter({ maintenant: T0 + 3 * H })).saute, "ActivityWatch injoignable");
  assert.equal((await pc.collecter({ maintenant: T0 + 3 * H + 20 * MIN })).saute, "ActivityWatch injoignable");
  assert.equal(avertissements.filter((a) => /injoignable/.test(a)).length, 1, "dit une fois, pas à chaque relevé");
  const coupe = await lire();
  assert.equal(coupe.activitywatch.joignable, false);
  assert.match(coupe.activitywatch.message, /installe-le/);
  assert.equal(coupe.aujourdhui.total, 100 * 60, "rien de perdu, rien d'inventé");
  // De retour : la suite est relue depuis le dernier relevé.
  aw.eteint = false;
  const r3 = await (await envoyer("POST", "/api/activite-pc/collecte")).json();
  assert.equal(r3.activitywatch.joignable, true);
  assert.equal(r3.activitywatch.version, "v0.13.2");
  assert.equal(r3.aujourdhui.total, ATTENDU.code + ATTENDU.chrome + ATTENDU.discord);
  assert.deepEqual(r3.aujourdhui.categories.map((c) => [c.id, c.secondes]), [["developpement", 9000], ["navigateur", 1800], ["communication", 1200]]);
  assert.deepEqual(r3.aujourdhui.applis.map((a) => a.libelle), ["VS Code", "Chrome", "Discord"]);
  assert.deepEqual(r3.aujourdhui.domaines, [{ nom: "banque-fictive.example", secondes: 1800 }]);
  assert.equal(r3.semaine.total, r3.aujourdhui.total);
  assert.equal(r3.semaine.parJour.length, 7);
  // Relever encore n'ajoute rien.
  await pc.collecter();
  assert.equal(pc.vue().aujourdhui.total, ATTENDU.code + ATTENDU.chrome + ATTENDU.discord);
});

test("les titres ne sont jamais stockés : ni dans la base, ni dans la réponse", async () => {
  const v = JSON.stringify(await lire());
  for (const s of SECRETS) assert.ok(!v.includes(s), `réponse : ${s}`);
  db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  for (const f of [cheminBase(), `${cheminBase()}-wal`]) {
    if (!fs.existsSync(f)) continue;
    const brut = fs.readFileSync(f).toString("latin1");
    for (const s of SECRETS) assert.ok(!brut.includes(s), `${path.basename(f)} : ${s}`);
  }
});

test("la note pour le modèle local, jamais pour Claude", async () => {
  const note = pc.noteActivitePC();
  assert.match(note, /Sur le PC aujourd'hui : développement 2 h 30, navigateur 30 min, communication 20 min \(surtout VS Code, Chrome, Discord\)/);
  assert.match(note, /repères, pas des preuves/);
  await discuter("J'en suis où ?");
  assert.match(consignes.at(-1), /# Activité du PC de Sam/);
  // Claude (modèle fixé sur la tour) : la consigne part sans l'activité.
  process.env.REMY_MODEL = "claude-sonnet-5";
  try {
    const avant = consignesClaude.length;
    await discuter("Et maintenant ?");
    assert.ok(consignesClaude.length > avant, "Claude a bien été appelé");
    for (const c of consignesClaude.slice(avant)) assert.doesNotMatch(c, /Activité du PC|ActivityWatch|VS Code/);
  } finally {
    delete process.env.REMY_MODEL;
  }
});

test("exclusions (de l'app et de la tour) et catégories réglables", async () => {
  const r = await (await envoyer("PUT", "/api/activite-pc", { exclusions: ["Discord.exe"], categories: { chrome: "bureautique" } })).json();
  assert.deepEqual(r.exclusions, ["discord"]);
  assert.equal(r.aujourdhui.applis.some((a) => a.nom === "discord"), false);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM activite_pc WHERE nom = 'discord'").get().n, 0, "ce qui était compté s'efface");
  assert.equal(r.aujourdhui.categories.find((c) => c.id === "bureautique").secondes, 1800);
  // Retirée de la liste : elle compte de nouveau, pour la suite seulement.
  const r2 = await (await envoyer("PUT", "/api/activite-pc", { exclusions: [], categories: { chrome: null } })).json();
  assert.deepEqual(r2.exclusions, []);
  assert.equal(r2.aujourdhui.categories.find((c) => c.id === "navigateur").secondes, 1800);
  process.env.REMY_ACTIVITE_EXCLURE = "code.exe";
  try {
    const v = await lire();
    assert.deepEqual(v.exclusionsTour, ["code"]);
    assert.equal(v.aujourdhui.applis.some((a) => a.nom === "code"), false);
  } finally {
    delete process.env.REMY_ACTIVITE_EXCLURE;
  }
  assert.equal((await envoyer("PUT", "/api/activite-pc", { categories: { chrome: "cuisine" } })).status, 400);
  assert.equal((await envoyer("PUT", "/api/activite-pc", { actif: "oui" })).status, 400);
  assert.equal((await envoyer("PUT", "/api/activite-pc", {})).status, 400);
});

test("le relevé passe par le moteur de jobs", async () => {
  enregistrerActivitePC();
  jobs.planifier("activite-pc-releve", { cle: "activite-pc-releve:essai" });
  const faits = await jobs.passer();
  const j = faits.find((f) => f.type === "activite-pc-releve");
  assert.equal(j?.etat, "fait", JSON.stringify(faits));
});

test("la semaine et les 7 jours d'avant, par catégorie (pour une analyse hebdomadaire, sans IA)", async () => {
  const il_y_a_10_jours = pc.jourDe(Date.now() - 10 * 86_400_000);
  db().prepare("INSERT INTO activite_pc (jour, type, nom, secondes) VALUES (?, 'app', 'steam', 7200), (?, 'app', 'code', 3600)").run(il_y_a_10_jours, il_y_a_10_jours);
  const b = pc.bilanSemaine();
  // (Discord a été exclu plus haut : son temps déjà compté s'est effacé.)
  assert.equal(b.semaine.total, ATTENDU.code + ATTENDU.chrome, "la semaine ne compte pas les 7 jours d'avant");
  assert.equal(b.precedente.total, 3 * 3600);
  assert.deepEqual(b.precedente.categories.map((c) => [c.id, c.secondes]), [["jeux", 7200], ["developpement", 3600]]);
  const v = await lire();
  assert.equal(v.semainePrecedente.total, 3 * 3600);
  assert.match(pc.noteActivitePC(), /Ces 7 jours : développement 2 h 30, navigateur 30 min \(les 7 jours d'avant : 3 h au total\)/);
  db().prepare("DELETE FROM activite_pc WHERE jour = ?").run(il_y_a_10_jours);
});

test("au-delà de 90 jours, tout s'efface ; « tout effacer » ne relit pas le passé", async () => {
  const vieux = pc.jourDe(Date.now() - 91 * 86_400_000);
  db().prepare("INSERT INTO activite_pc (jour, type, nom, secondes) VALUES (?, 'app', 'code', 3600)").run(vieux);
  assert.equal(pc.purger(), 1);
  assert.ok(pc.vue().aujourdhui.total > 0, "le récent reste");
  const v = await (await envoyer("DELETE", "/api/activite-pc")).json();
  assert.equal(v.aujourdhui.total, 0);
  assert.equal(v.actif, true, "effacer ne coupe pas");
  await pc.collecter();
  assert.equal(pc.vue().aujourdhui.total, 0, "ActivityWatch n'est pas relu en arrière");
});

test("ActivityWatch absent (rien sur le port) : un état clair, aucune erreur", async () => {
  process.env.REMY_ACTIVITYWATCH_URL = `http://127.0.0.1:${portFerme}`;
  try {
    const r = await (await envoyer("POST", "/api/activite-pc/collecte")).json();
    assert.equal(r.releve.saute, "ActivityWatch injoignable");
    assert.equal(r.activitywatch.joignable, false);
    assert.match(r.activitywatch.message, /aw-qt/);
  } finally {
    process.env.REMY_ACTIVITYWATCH_URL = `http://127.0.0.1:${serveurAW.address().port}`;
  }
});

test("coupée sur la tour (REMY_ACTIVITE_PC=off) : rien ne se lit, rien ne s'allume", async () => {
  db().prepare("INSERT INTO activite_pc (jour, type, nom, secondes) VALUES (?, 'app', 'code', 3600)").run(pc.jourDe(Date.now()));
  process.env.REMY_ACTIVITE_PC = "off";
  try {
    assert.equal((await envoyer("PUT", "/api/activite-pc", { actif: true })).status, 409);
    assert.equal((await pc.collecter()).saute, "coupé sur la tour");
    assert.equal(pc.noteActivitePC(), null);
    const v = await lire();
    assert.equal(v.actif, false);
    assert.equal(v.coupeParLaTour, true);
  } finally {
    delete process.env.REMY_ACTIVITE_PC;
  }
  // Coupée depuis l'app, puis rallumée : le trou reste vide.
  const c = await (await envoyer("PUT", "/api/activite-pc", { actif: false })).json();
  assert.equal(c.actif, false);
  assert.equal(pc.noteActivitePC(), null);
});
