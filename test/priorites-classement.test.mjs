// « Ce qui compte » devient un classement (12/11) : l'ordre de la liste est le
// rang (la n°1 passe devant la n°2), et chaque priorité peut être reliée à un
// projet Motion par son identifiant (priorites-v2). Ce qui est garanti ici :
//   - l'app iPhone d'avant (elle écrit sans le lien et ne sait pas réordonner)
//     n'efface aucun lien et n'est pas refusée : clé absente = inchangé, en se
//     raccrochant à l'identifiant de chaque priorité ;
//   - le versionnement et le 409 restent ceux d'avant ;
//   - Motion donne l'identifiant du projet, le type d'échéance et la date
//     « pas avant » de chaque tâche, sans rien casser quand il ne les donne pas ;
//   - le prompt annonce le vrai nombre de sessions de « Faire connaissance ».
// Données fictives.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-classement-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = "http://127.0.0.1:9/v1";

const priorites = await import("../lib/priorites.js");
const { normTache, journee } = await import("../lib/dashboard.js");
const { semaine } = await import("../lib/semaine.js");
const { CAPACITES } = await import("../lib/version.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");

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
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const envoyer = async (m, chemin, corps) => {
  const r = await fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json", Origin: base }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json() };
};

// Exactement ce qu'envoie l'app iPhone d'avant (ClientAPI.enregistrerPriorites) :
// id, titre, pourquoi et mots s'ils existent, rien d'autre.
const commeIphoneV1 = (liste) => liste.map((p) => ({ id: p.id, titre: p.titre, ...(p.pourquoi ? { pourquoi: p.pourquoi } : {}), ...(p.mots?.length ? { mots: p.mots } : {}) }));

test("la tour annonce priorites-v2 (et garde priorites-v1)", () => {
  assert.ok(CAPACITES.includes("priorites-v2"));
  assert.ok(CAPACITES.includes("priorites-v1"), "l'iPhone d'avant montre toujours « Ce qui compte »");
});

test("classement : l'ordre envoyé est gardé, le lien Motion aussi, par identifiant", async () => {
  let r = await envoyer("PUT", "/api/priorites", {
    base: 0,
    priorites: [
      { id: "p-boutique", titre: "Lancer la boutique de bougies", pourquoi: "Mon revenu de l'an prochain", projetMotion: "p1", projetNom: "Boutiques" },
      { id: "p-musique", titre: "La musique", mots: ["guitare"], projetMotion: "p4", projetNom: "Musique" },
      { id: "p-proches", titre: "Voir Léa et Hugo", projetMotion: null },
    ],
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.version, 1);
  assert.deepEqual(r.corps.priorites.map((p) => p.id), ["p-boutique", "p-musique", "p-proches"]);
  assert.equal(r.corps.priorites[0].projetMotion, "p1");
  assert.equal(r.corps.priorites[0].projetNom, "Boutiques");
  assert.equal("projetMotion" in r.corps.priorites[2], false, "sans lien : pas de clé du tout");

  // Monter la musique en n°1 (le site) : une version de plus, dans le nouvel ordre.
  const lu = r.corps.priorites;
  r = await envoyer("PUT", "/api/priorites", { base: 1, priorites: [lu[1], lu[0], lu[2]] });
  assert.equal(r.corps.version, 2);
  assert.deepEqual(r.corps.priorites.map((p) => p.id), ["p-musique", "p-boutique", "p-proches"]);
  assert.equal(r.corps.priorites[0].projetMotion, "p4", "le lien suit la priorité, pas sa place");
});

test("l'iPhone d'avant écrit sans le lien : rien n'est effacé, rien n'est refusé, l'ordre reste", async () => {
  const avant = (await envoyer("GET", "/api/priorites")).corps;
  assert.equal(avant.version, 2);
  // Il relit, change un pourquoi, ajoute une priorité à la fin, renvoie sans `projetMotion`.
  const liste = commeIphoneV1(avant.priorites);
  liste[1].pourquoi = "Mon revenu de l'an prochain, et mon indépendance";
  liste.push({ id: "p-sommeil", titre: "Dormir avant minuit" });
  const r = await envoyer("PUT", "/api/priorites", { base: avant.version, priorites: liste });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.version, 3);
  const par = Object.fromEntries(r.corps.priorites.map((p) => [p.id, p]));
  assert.equal(par["p-musique"].projetMotion, "p4", "lien gardé");
  assert.equal(par["p-boutique"].projetMotion, "p1", "lien gardé");
  assert.equal(par["p-boutique"].projetNom, "Boutiques");
  assert.equal(par["p-boutique"].pourquoi, "Mon revenu de l'an prochain, et mon indépendance", "sa modification passe");
  assert.equal("projetMotion" in par["p-sommeil"], false, "la nouvelle n'a pas de lien");
  assert.deepEqual(r.corps.priorites.map((p) => p.id), ["p-musique", "p-boutique", "p-proches", "p-sommeil"], "le classement n'a pas bougé");

  // Renvoyer la même liste, sans le lien : aucune version vide de sens.
  const meme = await envoyer("PUT", "/api/priorites", { base: 3, priorites: commeIphoneV1(r.corps.priorites) });
  assert.equal(meme.corps.version, 3);
  assert.equal(priorites.lirePriorites().priorites.find((p) => p.id === "p-musique").projetMotion, "p4");

  // L'iPhone retire une priorité : elle part, les liens des autres restent.
  const sans = commeIphoneV1(r.corps.priorites).filter((p) => p.id !== "p-proches");
  const r2 = await envoyer("PUT", "/api/priorites", { base: 3, priorites: sans });
  assert.equal(r2.corps.version, 4);
  assert.deepEqual(r2.corps.priorites.map((p) => [p.id, p.projetMotion ?? null]), [["p-musique", "p4"], ["p-boutique", "p1"], ["p-sommeil", null]]);
});

test("le site retire un lien (null) ; le 409 d'une base périmée reste, sans rien écraser", async () => {
  const lu = (await envoyer("GET", "/api/priorites")).corps;
  const r = await envoyer("PUT", "/api/priorites", { base: lu.version, priorites: lu.priorites.map((p) => (p.id === "p-boutique" ? { ...p, projetMotion: null, projetNom: null } : p)) });
  assert.equal(r.corps.version, lu.version + 1);
  const boutique = r.corps.priorites.find((p) => p.id === "p-boutique");
  assert.equal("projetMotion" in boutique, false);
  assert.equal("projetNom" in boutique, false);

  const perimee = await envoyer("PUT", "/api/priorites", { base: lu.version, priorites: commeIphoneV1(lu.priorites) });
  assert.equal(perimee.statut, 409, "une autre version est passée entre-temps");
  assert.equal(priorites.lirePriorites().version, lu.version + 1);
  assert.equal((await envoyer("PUT", "/api/priorites", { priorites: [] })).statut, 409, "sans base : refusé, comme avant");
});

test("le classement : les priorités confirmées, datées ; l'iPhone d'avant ne le défait pas et garde les pistes écartées", async () => {
  let lu = (await envoyer("GET", "/api/priorites")).corps;
  assert.equal(lu.classeA, null, "jusqu'ici, l'ordre n'était qu'un ordre de saisie");
  assert.ok(lu.priorites.every((p) => !("classee" in p)));
  // Le site : « C'est ça » sur les deux premières, la troisième reste écrite mais pas classée ; une piste écartée.
  const envoi = lu.priorites.map((p, k) => ({ ...p, confirmee: k < 2 }));
  let r = await envoyer("PUT", "/api/priorites", { base: lu.version, priorites: envoi, ecartees: ["motion:p9", "motion:p9", ""] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(r.corps.classeA >= lu.majA, "daté");
  assert.deepEqual(r.corps.priorites.map((p) => p.classee === true), [true, true, false]);
  assert.deepEqual(r.corps.ecartees, ["motion:p9"]);
  const date = r.corps.classeA;
  // L'iPhone d'avant ajoute une priorité (sans confirmee ni ecartees) : rien ne se perd, la nouvelle n'est pas classée.
  r = await envoyer("PUT", "/api/priorites", { base: r.corps.version, priorites: [...commeIphoneV1(r.corps.priorites), { id: "p-lire", titre: "Lire le soir" }] });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.classeA, date, "le classement n'a pas changé : sa date non plus");
  assert.deepEqual(r.corps.priorites.map((p) => p.classee === true), [true, true, false, false]);
  assert.deepEqual(r.corps.ecartees, ["motion:p9"]);
  // Renvoyer la même liste depuis l'iPhone : aucune version vide.
  const v = r.corps.version;
  r = await envoyer("PUT", "/api/priorites", { base: v, priorites: commeIphoneV1(r.corps.priorites) });
  assert.equal(r.corps.version, v);
  // Un nouvel ordre confirmé (la n°2 passe devant) : une nouvelle version, une nouvelle date.
  const [a, b, ...reste] = r.corps.priorites;
  r = await envoyer("PUT", "/api/priorites", { base: v, priorites: [b, a, ...reste].map((p) => ({ ...p, confirmee: p.classee === true })) });
  assert.equal(r.corps.version, v + 1);
  assert.equal(r.corps.priorites[0].id, b.id);
  assert.ok(r.corps.classeA >= date);
  assert.deepEqual(r.corps.ecartees, ["motion:p9"], "ecartees absente : inchangée");
  // Tout déconfirmer : plus de classement.
  r = await envoyer("PUT", "/api/priorites", { base: v + 1, priorites: r.corps.priorites.map((p) => ({ ...p, confirmee: false })) });
  assert.equal(r.corps.classeA, null);
  r = await envoyer("PUT", "/api/priorites", { base: v + 2, priorites: r.corps.priorites.map((p, k) => ({ ...p, confirmee: k < 3 })) });
  assert.ok(r.corps.classeA);
});

test("GET /api/priorites/proposition : sans Motion, ce qui est déjà classé n'est pas reproposé", async () => {
  const r = await envoyer("GET", "/api/priorites/proposition");
  assert.equal(r.statut, 200);
  assert.equal(r.corps.motion, "off");
  assert.ok(r.corps.classeA, "le classement est confirmé");
  // Classées : la musique, la boutique, les proches ; reste « Lire le soir », écrite mais pas classée.
  assert.deepEqual(r.corps.candidats.map((c) => c.titre), ["Lire le soir"], "ce qui est classé n'est pas reproposé");
  assert.equal(r.corps.candidats[0].declaree.id, "p-lire");
  assert.ok(r.corps.sources.some((s) => s.id === "motion"));
  assert.match(r.corps.limites, /ailleurs/);
});

test("un lien illisible (vide, caractères de contrôle) vaut « pas de lien »", () => {
  const { priorites: p } = priorites.nettoyerPriorites([
    { id: "a", titre: "Un", projetMotion: "   " },
    { id: "b", titre: "Deux", projetMotion: "p\u0007x" },
    { id: "c", titre: "Trois", projetMotion: "p9", projetNom: "  Album  « Été » " },
    { id: "d", titre: "Quatre" },
  ]);
  assert.equal(p[0].projetMotion, null);
  assert.equal(p[1].projetMotion, null);
  assert.equal(p[2].projetMotion, "p9");
  assert.equal(p[2].projetNom, "Album « Été »");
  assert.equal("projetMotion" in p[3], false, "absente : rien à dire, l'ancien lien sera repris");
});

// --- Ce que Motion dit de chaque tâche -------------------------------------------

test("normTache garde l'identifiant du projet, le type d'échéance et la date « pas avant », s'ils existent", () => {
  const t = normTache({ id: "t1", name: "Préparer la maquette", project: { id: "p3", name: "Site vitrine" }, deadlineType: "hard", startOn: "2026-11-12", dueDate: "2026-11-13T09:00:00Z" });
  assert.equal(t.projetId, "p3");
  assert.equal(t.projet, "Site vitrine");
  assert.equal(t.deadlineType, "HARD");
  assert.equal(t.startOn, "2026-11-12");
  // Un startOn en date-heure : la date seule.
  assert.equal(normTache({ id: "t2", name: "x", startOn: "2026-11-14T00:00:00.000Z" }).startOn, "2026-11-14");
  // Le projet par projectId seul (certaines réponses de Motion).
  assert.equal(normTache({ id: "t3", name: "x", projectId: "p8" }).projetId, "p8");
  // Rien de tout ça, ou illisible : aucune clé en plus (la forme d'avant).
  const nue = normTache({ id: "t4", name: "x", deadlineType: "PEUT-ÊTRE", startOn: "bientôt", project: { name: "Sans id" } });
  assert.deepEqual(Object.keys(nue).sort(), ["debut", "duree", "echeance", "fin", "id", "priorite", "projet", "titre"]);
});

test("la journée et la semaine transmettent ces faits sur chaque tâche (absents = absents)", () => {
  const maintenant = Date.parse("2026-11-12T09:47:00Z");
  const taches = [
    { id: "t1", name: "Maquette", project: { id: "p3", name: "Site vitrine" }, deadlineType: "HARD", startOn: "2026-11-12", scheduledStart: "2026-11-12T13:00:00Z", scheduledEnd: "2026-11-12T14:00:00Z", dueDate: "2026-11-12T17:00:00Z", duration: 60 },
    { id: "t2", name: "Sans rien", scheduledStart: "2026-11-13T08:00:00Z", scheduledEnd: "2026-11-13T08:30:00Z", dueDate: "2026-11-13T09:00:00Z", duration: 30 },
  ];
  const j = journee({ taches, maintenant });
  const t1 = j.items.find((e) => e.id === "t1");
  assert.equal(t1.projetId, "p3");
  assert.equal(t1.deadlineType, "HARD");
  const s = semaine({ taches, maintenant, jours: 2 });
  const [auj, dem] = s.jours;
  assert.equal(auj.items[0].projetId, "p3");
  assert.equal(auj.items[0].startOn, "2026-11-12");
  assert.equal(auj.echeances[0].deadlineType, "HARD", "les échéances aussi");
  assert.equal("projetId" in dem.items[0], false);
  assert.equal("deadlineType" in dem.echeances[0], false);
});

// --- « Faire connaissance » -----------------------------------------------------

test("le prompt annonce le vrai nombre de sessions de « Faire connaissance »", async () => {
  const { SESSIONS } = await import("../lib/onboarding.js");
  const { SYSTEM_PROMPT } = await import("../lib/chat.js");
  assert.equal(SESSIONS.length, 8);
  assert.match(SYSTEM_PROMPT, new RegExp(`l'onboarding, ${SESSIONS.length} sessions courtes`));
  for (let k = 1; k <= SESSIONS.length; k++) assert.match(SYSTEM_PROMPT, new RegExp(`(—|·) ${k}\\. `), `session ${k} décrite`);
  assert.doesNotMatch(SYSTEM_PROMPT, new RegExp(`· ${SESSIONS.length + 1}\\. `));
});
