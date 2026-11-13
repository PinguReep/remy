// L'arbre des projets comme vue de ce que Rémy a compris (12/11, arbre-v1,
// verrou-v1) — données FICTIVES (Sam, Léa, Hugo ; « Assistant », « Maison »,
// « Boutique ») :
//   - les déductions sans IA (état, où on en est, pourquoi) et leur source ;
//   - les fiches : clé absente = inchangé, origine gardée, « Pas ça » qui
//     n'est plus reproposé, historique borné ;
//   - ce qui vient de la mémoire n'apparaît que déverrouillé ;
//   - le verrou : chaque route protégée refuse sans ressaisie, y compris les
//     chemins imbriqués ; la fenêtre est liée à la session, expire, se
//     referme à la demande ; les essais du mot de passe sont limités ;
//   - le résumé par le modèle local : un geste, coupable, journalisé, jamais
//     ailleurs qu'au modèle local.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

let reponseGlm = "Le formulaire marche, il reste à brancher la dictée.";
const recusGlm = [];
const glm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "local-test" }] }));
    recusGlm.push(JSON.parse(corps || "{}"));
    res.end(JSON.stringify({ choices: [{ message: { content: reponseGlm }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 12 } }));
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-arbre-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "VERCEL", "APP_PASSWORD_HASH", "TRUST_PROXY", "MOTION_API_KEY", "ANTHROPIC_API_KEY", "REMY_VERROU_MIN"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.APP_PASSWORD = "mot-de-passe-de-test";
process.env.SESSION_SECRET = "secret-de-test";
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;

const A = await import("../lib/arbre.js");
const V = await import("../lib/verrou.js");
const carnet = await import("../lib/carnet.js");
const store = await import("../lib/store.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");

const srv = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

test.after(() => {
  srv.close();
  glm.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const appel = async (methode, chemin, { corps, jeton, cookie, entetes = {} } = {}) => {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: { ...(corps ? { "Content-Type": "application/json" } : {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...entetes },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: r.status, corps: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
const connexion = async (extra = {}) => appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", ...extra } });
const remettreEssais = async () => {
  await store.counterReset("remy:bf:verrou:127.0.0.1");
  await store.counterReset("remy:bf:global");
  await store.counterReset("remy:bf:ip:127.0.0.1");
};

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 10, 12, 10, 0);

// --- Les déductions (pures) -------------------------------------------------------------

const noeuds = A.noeudsDe({
  projets: [{ id: "p1", nom: "Boutique", statut: "En cours" }],
  dossiers: [
    { id: "d-assistant", nom: "Assistant", parent: null },
    { id: "d-fonction", nom: "Fonctionnalité", parent: "d-assistant" },
    { id: "d-interface", nom: "Interface", parent: "d-fonction" },
    { id: "d-vitrine", nom: "Site vitrine", parent: "motion:p1" },
    { id: "idees", nom: "Idées", parent: null },
  ],
});

test("l'arbre : projets Motion puis dossiers, trois niveaux, chemins complets ; « Idées » n'est pas une branche", () => {
  assert.deepEqual(noeuds.map((x) => [x.noeud, x.niveau, x.chemin.join(" › ")]), [
    ["motion:p1", 0, "Boutique"],
    ["dossier:d-vitrine", 1, "Boutique › Site vitrine"],
    ["dossier:d-assistant", 0, "Assistant"],
    ["dossier:d-fonction", 1, "Assistant › Fonctionnalité"],
    ["dossier:d-interface", 2, "Assistant › Fonctionnalité › Interface"],
  ]);
  assert.equal(noeuds.find((x) => x.noeud === "dossier:d-interface").parent, "dossier:d-fonction");
  assert.equal(A.noeudDuParent("motion:p1"), "motion:p1");
  assert.equal(A.noeudDuParent("d-fonction"), "dossier:d-fonction");
});

const taches = [
  { id: "t1", titre: "Finaliser la démo", projetId: "p1", echeance: T0 + 2 * JOUR, debut: T0 + 3600_000 },
  { id: "t2", titre: "Relire le contrat de Hugo", projetId: "p1", bloquee: true, bloqueePar: [{ id: "t1", nom: "Finaliser la démo" }] },
  { id: "t3", titre: "Brancher la dictée", projetId: "p9" },
];
const ctxBase = {
  noeuds, taches, rattachements: new Map([["t3", "d-interface"]]),
  coches: [{ a: T0 - 2 * JOUR, nom: "Écrire la fiche produit", id: "t0", projet: "Boutique" }],
  dossiers: [{ id: "d-interface", dernier: T0 - 40 * JOUR, ouvertes: 1 }],
  conversations: [{ id: "c1", title: "Le formulaire de dictée", updatedAt: T0 - 3 * JOUR }],
  liens: new Map([["dossier:d-interface", ["c1"]]]),
  priorites: [
    { id: "p-a", titre: "Lancer la boutique", pourquoi: "C'est mon revenu de l'an prochain", projetMotion: "p1", classee: true },
    { id: "p-b", titre: "Un assistant qui comprend", pourquoi: "", mots: ["assistant"], classee: true },
  ],
  memoire: "## Objectifs\n- Un assistant qui parle sans toucher l'écran\n\n## Projets en cours\n- Boutique de bougies\n- L'interface doit tenir au pouce",
};
const faits = (n) => A.faitsDe(noeuds.find((x) => x.noeud === n), ctxBase);

test("déductions d'un projet Motion : en cours (et pourquoi), où on en est, pourquoi tiré des mots de Sam pour sa priorité n°1", () => {
  const f = faits("motion:p1");
  assert.equal(f.taches.length, 2, "les tâches du projet ; pas celle rangée dans un autre dossier");
  const d = A.deduire(f, { maintenant: T0 });
  assert.equal(d.etat.texte, "en_cours");
  assert.match(d.etat.source, /^d'après 1 tâche Motion prévue ou due d'ici 7 jours et une tâche cochée il y a 2 j$/);
  assert.equal(d.point.texte, "Fait : « Écrire la fiche produit » (il y a 2 j). « Relire le contrat de Hugo » attend « Finaliser la démo ».");
  assert.match(d.point.source, /une tâche cochée dans Rémy et 2 tâches Motion \(dont 1 bloquée\)/);
  assert.equal(d.pourquoi.texte, "C'est mon revenu de l'an prochain");
  assert.match(d.pourquoi.source, /ta priorité n°1 « Lancer la boutique », reliée à ce projet/);
  assert.equal(d.pourquoi.memoire, undefined, "les mots de Sam pour une priorité ne sont pas sa mémoire");
});

test("déductions d'une branche profonde : en pause sans mouvement, la conversation rattachée, le pourquoi venu de la mémoire (marqué)", () => {
  const f = faits("dossier:d-interface");
  assert.deepEqual(f.taches.map((t) => t.id), ["t3"], "la tâche rangée ici");
  const d = A.deduire(f, { maintenant: T0 });
  assert.equal(d.etat.texte, "en_cours", "la conversation rattachée d'il y a 3 jours est un mouvement");
  assert.match(d.point.texte, /^Ensuite : « Brancher la dictée »\.$/);
  assert.equal(d.pourquoi.texte, "L'interface doit tenir au pouce");
  assert.equal(d.pourquoi.memoire, true);
  assert.match(d.pourquoi.source, /section « Projets en cours »/);
  // Plus tard, sans rien de nouveau : en pause, et la source dit depuis quand.
  const tard = A.deduireEtat(f, { maintenant: T0 + 30 * JOUR });
  assert.equal(tard.texte, "en_pause");
  assert.match(tard.source, /rien de fait depuis 33 jours/);
});

test("déductions : ce que Sam a dit du projet entier (« attend… », « C'est fini ») passe avant les tâches, avec sa source", () => {
  const base = { taches: [{ id: "x", titre: "Poser la cuisine", echeance: T0 + JOUR }], coches: [], activite: [], conversations: [], priorite: null, memoire: [], statut: null };
  const attend = { ...base, marque: { bloquePar: [{ id: "motion:p2", nom: "Maison", noeud: true }], parentBloque: null, fini: false } };
  assert.deepEqual(A.deduireEtat(attend, { maintenant: T0 }), { texte: "en_attente", source: "tu as dit qu'il attend « Maison »" });
  assert.match(A.deduirePoint(attend, { maintenant: T0 }).texte, /^Attend « Maison »\. Ensuite : « Poser la cuisine »/);
  const parent = { ...base, marque: { bloquePar: [], parentBloque: { id: "dossier:d-a", nom: "Assistant", par: [{ nom: "Boutique" }] }, fini: false } };
  assert.match(A.deduireEtat(parent, { maintenant: T0 }).source, /son projet parent « Assistant » attend « Boutique »/);
  const fini = { ...base, marque: { bloquePar: [], parentBloque: null, fini: true, finiA: T0 - 2 * JOUR } };
  assert.deepEqual(A.deduireEtat(fini, { maintenant: T0 }), { texte: "fait", source: "tu as dit « C'est fini » il y a 2 j" });
  // Sans un mot de Sam, Rémy ne conclut jamais « fait ».
  assert.notEqual(A.deduireEtat({ ...base, taches: [] }, { maintenant: T0 })?.texte, "fait");
  // Un sous-projet d'un projet Motion que la liste n'a pas rendu reste dans l'arbre.
  const n = A.noeudsDe({ projets: [], dossiers: [{ id: "d-x", nom: "Pages", parent: "motion:p7" }], nomsMotion: new Map([["p7", "Boutique"]]) });
  assert.deepEqual(n.map((x) => x.chemin.join(" › ")), ["Boutique", "Boutique › Pages"]);
  assert.equal(n[0].horsListe, true);
});

test("le mot de passe est comparé à temps constant, longueur comprise", async () => {
  const src = fs.readFileSync(new URL("../lib/auth.js", import.meta.url), "utf8");
  const corps = src.slice(src.indexOf("export function verifyPassword"), src.indexOf("function secret()"));
  assert.doesNotMatch(corps, /a\.length === b\.length/, "pas de comparaison des longueurs avant");
  assert.match(corps, /timingSafeEqual/);
  const { verifyPassword } = await import("../lib/auth.js");
  for (const essai of ["", "m", "mot-de-passe-de-tes", "mot-de-passe-de-test!", "x".repeat(5000)]) assert.equal(verifyPassword(essai), false, JSON.stringify(essai.slice(0, 20)));
  assert.equal(verifyPassword("mot-de-passe-de-test"), true);
  assert.match(fs.readFileSync(new URL("../lib/verrou.js", import.meta.url), "utf8"), /verifyPassword\(/, "le verrou passe par la même vérification");
});

test("déductions : toutes les tâches bloquées → en attente ; statut Motion « En attente » ; rien à dire → aucune déduction (pas d'invention)", () => {
  const f = { taches: [{ id: "x", titre: "Poser la cuisine", bloquee: true, bloqueePar: [{ id: "y", nom: "Recevoir le devis" }] }], coches: [], activite: [], conversations: [], priorite: null, memoire: [], statut: null };
  const e = A.deduireEtat(f, { maintenant: T0 });
  assert.equal(e.texte, "en_attente");
  assert.match(e.source, /toutes attendent \(« Poser la cuisine » attend « Recevoir le devis »\)/);
  assert.equal(A.deduireEtat({ ...f, taches: [], statut: "En attente" }).texte, "en_attente");
  const vide = { taches: [], coches: [], activite: [], conversations: [], priorite: null, memoire: [], statut: null };
  assert.deepEqual(A.deduire(vide, { maintenant: T0 }), { pourquoi: null, etat: null, point: null });
  assert.equal(A.deduireEtat({ ...vide, taches: [{ id: "z", titre: "Z" }] }, { maintenant: T0 })?.texte, "en_pause", "des tâches, rien de prévu ni de fait : en pause");
  assert.deepEqual(A.memoireDe("Maison", "## Personnes\n- Léa\n- Hugo"), []);
});

// --- Les fiches -------------------------------------------------------------------------

test("fiche : « C'est ça » garde la source, une correction est écrite par Sam, clé absente = inchangé, null = effacé, tout entre dans l'historique", () => {
  const n = "motion:p1";
  A.ecrireFiche(n, { etat: { texte: "en_cours", origine: "confirme", source: "d'après 2 tâches Motion" } }, { maintenant: T0 });
  A.ecrireFiche(n, { point: { texte: "La démo est prête, reste le contrat", origine: "ecrit", source: "ignorée" } }, { maintenant: T0 + 1000 });
  const f = A.lireFiche(n);
  assert.deepEqual(f.etat, { texte: "en_cours", origine: "confirme", source: "d'après 2 tâches Motion", a: T0 });
  assert.deepEqual(f.point, { texte: "La démo est prête, reste le contrat", origine: "ecrit", source: null, a: T0 + 1000 }, "ce que Sam écrit n'a pas de source");
  A.ecrireFiche(n, { pourquoi: { texte: "Mon revenu", origine: "ecrit" } }, { maintenant: T0 + 2000 });
  assert.equal(A.lireFiche(n).etat.texte, "en_cours", "clé absente : inchangé");
  A.ecrireFiche(n, { pourquoi: null }, { maintenant: T0 + 3000 });
  assert.equal(A.lireFiche(n).pourquoi, null);
  assert.deepEqual(A.historique(n).map((h) => [h.champ, h.texte, h.origine]), [
    ["pourquoi", null, null], ["pourquoi", "Mon revenu", "ecrit"], ["point", "La démo est prête, reste le contrat", "ecrit"], ["etat", "en_cours", "confirme"],
  ]);
  // Réécrire la même valeur n'ajoute rien à l'historique.
  A.ecrireFiche(n, { etat: { texte: "en_cours", origine: "confirme", source: "autre" } }, { maintenant: T0 + 4000 });
  assert.equal(A.historique(n).length, 4);
  assert.throws(() => A.ecrireFiche(n, { etat: { texte: "termine" } }), /état inconnu/);
  assert.throws(() => A.ecrireFiche("p1", { etat: null }), /nœud invalide/);
  assert.throws(() => A.ecrireFiche(n, {}), /Rien à changer/);
});

test("fiche : « Pas ça » n'est plus reproposé tant que la déduction ne change pas ; l'historique garde 40 points au plus", () => {
  const x = noeuds.find((y) => y.noeud === "dossier:d-interface");
  const f = A.faitsDe(x, ctxBase);
  const d = A.deduire(f, { maintenant: T0 });
  A.ecrireFiche(x.noeud, { ecarter: { champ: "point", texte: d.point.texte } });
  const v = A.vueNoeud(x, A.lireFiche(x.noeud), d, f, { avecMemoire: false });
  assert.equal(v.propositions.point, undefined, "écartée");
  assert.equal(v.propositions.etat.origine, "deduit");
  assert.equal(v.propositions.pourquoi, undefined, "tirée de la mémoire : cachée sans déverrouillage…");
  assert.equal(v.memoireCachee, 1, "… mais comptée");
  const ouvert = A.vueNoeud(x, A.lireFiche(x.noeud), d, f, { avecMemoire: true });
  assert.equal(ouvert.propositions.pourquoi.memoire, true);
  // Une autre déduction (la prochaine étape a changé) : reproposée.
  const d2 = { ...d, point: { texte: "Ensuite : « Tester au pouce ».", source: "d'après 1 tâche Motion" } };
  assert.equal(A.vueNoeud(x, A.lireFiche(x.noeud), d2, f).propositions.point.texte, "Ensuite : « Tester au pouce ».");
  // Ce que Sam confirme ne se repropose pas non plus.
  A.ecrireFiche(x.noeud, { etat: { texte: d.etat.texte, origine: "confirme", source: d.etat.source } }, { maintenant: T0 - 1 });
  assert.equal(A.vueNoeud(x, A.lireFiche(x.noeud), d, f).propositions.etat, undefined);
  for (let i = 0; i < 45; i++) A.ecrireFiche(x.noeud, { point: { texte: `Point ${i}`, origine: "ecrit" } }, { maintenant: T0 + i });
  const h = A.historique(x.noeud);
  assert.equal(h.length, 40);
  assert.equal(h[0].texte, "Point 44");
});

test("conversations rattachées : une seule branche par conversation, détachable", () => {
  A.rattacherConversation("c-a", "dossier:d-interface");
  A.rattacherConversation("c-a", "motion:p1");
  assert.equal(A.noeudDeConversation("c-a"), "motion:p1");
  assert.deepEqual(A.conversationsParNoeud().get("motion:p1"), ["c-a"]);
  A.rattacherConversation("c-a", null);
  assert.equal(A.noeudDeConversation("c-a"), null);
  assert.throws(() => A.rattacherConversation("c-a", "nimporte"), /nœud invalide/);
});

// --- Les routes et le verrou ------------------------------------------------------------

// Ce que le verrou garde : ce que la mémoire de Rémy dit de Sam (et l'export, qui la contient).
const PROTEGEES = [["GET", "/api/compris"], ["GET", "/api/memory"], ["PUT", "/api/memory"], ["GET", "/api/export"]];
// Les mêmes, écrits autrement (barre finale, segment en plus, majuscules, encodage) : jamais servis sans déverrouillage.
const VARIANTES = [["GET", "/api/compris/"], ["GET", "/api/compris/x"], ["GET", "/api/compris/x/y"], ["GET", "/api/memory/"], ["GET", "/api/memory/x"], ["GET", "/api//compris"], ["GET", "/api/%63ompris"], ["GET", "/api/COMPRIS"], ["GET", "/api/compris?x=1"], ["PUT", "/api/memory/"]];

test("verrou : chaque route protégée refuse (423) une session sans ressaisie récente, chemins imbriqués compris ; l'arbre, lui, reste ouvert", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  for (const [m, chemin] of PROTEGEES) {
    const r = await appel(m, chemin, { cookie, corps: m === "PUT" ? { text: "## Préférences\n- rien" } : undefined });
    assert.equal(r.status, 423, `${m} ${chemin}`);
    assert.equal(r.corps.error, "verrou");
  }
  for (const [m, chemin] of VARIANTES) {
    const r = await appel(m, chemin, { cookie, corps: m === "PUT" ? { text: "x" } : undefined });
    assert.ok(r.status === 423 || r.status === 404, `${m} ${chemin} : ${r.status} (jamais servi verrouillé)`);
    assert.ok(!JSON.stringify(r.corps || {}).includes("Préférences"), `${m} ${chemin} ne rend rien de la mémoire`);
  }
  // Sans session : 401 avant même le verrou.
  assert.equal((await appel("GET", "/api/compris")).status, 401);
  // L'historique d'une fiche est ouvert, comme la fiche (l'écran Projets s'en sert).
  assert.equal((await appel("GET", "/api/noeuds/motion%3Ap1/historique", { cookie })).status, 200);
  // Ce dont l'app a besoin en permanence reste ouvert.
  carnet.ecrireDossier("d-assistant", { nom: "Assistant", parent: null });
  carnet.ecrireDossier("d-fonction", { nom: "Fonctionnalité", parent: "d-assistant" });
  carnet.ecrireDossier("d-interface", { nom: "Interface", parent: "d-fonction" });
  const arbre = await appel("GET", "/api/noeuds", { cookie });
  assert.equal(arbre.status, 200);
  assert.deepEqual(arbre.corps.noeuds.map((x) => x.chemin.join(" › ")), ["Assistant", "Assistant › Fonctionnalité", "Assistant › Fonctionnalité › Interface"]);
  assert.deepEqual(arbre.corps.verrou, { disponible: true, verrouille: true, jusqua: null, dureeMin: 10 });
  const ecrit = await appel("PUT", "/api/noeuds/dossier%3Ad-interface/fiche", { cookie, corps: { pourquoi: { texte: "Tenir au pouce", origine: "ecrit" } } });
  assert.equal(ecrit.status, 200, "PUT imbriqué /api/noeuds/:noeud/fiche");
  assert.equal(ecrit.corps.fiche.pourquoi.texte, "Tenir au pouce");
  assert.equal((await appel("PUT", "/api/noeuds/pas-un-noeud/fiche", { cookie, corps: { pourquoi: null } })).status, 400);
  assert.equal((await appel("GET", "/api/verrou", { cookie })).corps.verrouille, true);
});

test("verrou : le bon mot de passe ouvre 10 min pour CETTE session ; un cookie transplanté ne sert à rien ; « Reverrouiller » referme côté tour", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  const faux = await appel("POST", "/api/verrou", { cookie, corps: { password: "pas-le-bon" } });
  assert.equal(faux.status, 401);
  assert.match(faux.corps.message, /4 essais restants/);
  const ok = await appel("POST", "/api/verrou", { cookie, corps: { password: "mot-de-passe-de-test" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.corps.verrouille, false);
  assert.ok(ok.corps.jusqua > Date.now() + 9 * 60_000 && ok.corps.jusqua <= Date.now() + 10 * 60_000);
  assert.equal(ok.corps.deverrou, undefined, "le site a son cookie HttpOnly, pas de jeton lisible");
  const ouvert = `${cookie}; ${ok.cookie}`;
  for (const [m, chemin] of PROTEGEES.filter(([m]) => m === "GET")) assert.equal((await appel(m, chemin, { cookie: ouvert })).status, 200, `${m} ${chemin}`);
  const compris = (await appel("GET", "/api/compris", { cookie: ouvert })).corps;
  assert.ok(Array.isArray(compris.noeuds) && compris.noeuds.every((x) => Array.isArray(x.historique)));
  assert.equal(compris.noeuds.find((x) => x.noeud === "dossier:d-interface").historique[0].texte, "Tenir au pouce");
  // Une autre session (un autre navigateur) avec le même cookie de déverrouillage : refusé.
  const autre = await connexion();
  assert.equal((await appel("GET", "/api/compris", { cookie: `${autre.cookie}; ${ok.cookie}` })).status, 423);
  // Un cookie de déverrouillage trafiqué : refusé.
  const [payload, sig] = ok.cookie.split("=")[1].split(".");
  const triche = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), exp: Date.now() + 3600_000 })).toString("base64url");
  assert.equal((await appel("GET", "/api/compris", { cookie: `${cookie}; remy_deverrou=${triche}.${sig}` })).status, 423);
  // L'expiration, vérifiée par la tour.
  const req = { headers: { cookie: ouvert } };
  assert.ok(V.fenetreDe(req));
  assert.equal(V.fenetreDe(req, Date.now() + 10 * 60_000 + 1), null, "au-delà de 10 minutes : verrouillé");
  // Reverrouiller : la tour oublie la fenêtre, même si le cookie revenait.
  const ferme = await appel("DELETE", "/api/verrou", { cookie: ouvert });
  assert.equal(ferme.status, 200);
  assert.equal(ferme.corps.verrouille, true);
  assert.equal((await appel("GET", "/api/compris", { cookie: ouvert })).status, 423);
});

test("verrou : se déconnecter reverrouille ; une app par jeton lit encore la mémoire (elle ne sait pas déverrouiller), pas « Ce que Rémy a compris »", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  const ok = await appel("POST", "/api/verrou", { cookie, corps: { password: "mot-de-passe-de-test" } });
  await appel("POST", "/api/logout", { cookie: `${cookie}; ${ok.cookie}` });
  assert.equal((await appel("GET", "/api/compris", { cookie: `${cookie}; ${ok.cookie}` })).status, 423, "la session revenue : verrouillée");
  const { corps } = await connexion({ appareil: "iPhone de Sam" });
  assert.equal((await appel("GET", "/api/memory", { jeton: corps.jeton })).status, 200, "appareil exempté pour la mémoire (limite dite)");
  assert.equal((await appel("GET", "/api/compris", { jeton: corps.jeton })).status, 423);
  // L'app peut déverrouiller par l'en-tête X-Remy-Deverrou (portage iPhone à venir).
  const v = await appel("POST", "/api/verrou", { jeton: corps.jeton, corps: { password: "mot-de-passe-de-test" } });
  assert.ok(v.corps.deverrou);
  assert.equal((await appel("GET", "/api/compris", { jeton: corps.jeton, entetes: { "X-Remy-Deverrou": v.corps.deverrou } })).status, 200);
});

test("verrou : 5 essais faux par quart d'heure, puis refus même avec le bon mot de passe", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  for (let i = 0; i < 5; i++) assert.equal((await appel("POST", "/api/verrou", { cookie, corps: { password: `faux-${i}` } })).status, 401);
  const bloque = await appel("POST", "/api/verrou", { cookie, corps: { password: "mot-de-passe-de-test" } });
  assert.equal(bloque.status, 429);
  assert.match(bloque.corps.message, /15 minutes/);
  assert.equal((await appel("GET", "/api/compris", { cookie })).status, 423);
  // En même temps : comptés avant d'être vérifiés, pas plus de 5 ne passent.
  await remettreEssais();
  const lot = await Promise.all(Array.from({ length: 12 }, () => appel("POST", "/api/verrou", { cookie, corps: { password: "faux" } })));
  assert.equal(lot.filter((r) => r.status === 401).length, 5);
  assert.equal(lot.filter((r) => r.status === 429).length, 7);
  await remettreEssais();
});

test("verrou : sans mot de passe sur la tour, pas de verrou — et l'état le dit au lieu de le simuler", () => {
  const mdp = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  try {
    const e = V.etatVerrou({ headers: {} });
    assert.equal(e.disponible, false);
    assert.match(e.raison, /pas de verrou/);
  } finally {
    process.env.APP_PASSWORD = mdp;
  }
});

test("conversations : née de « En parler à Rémy » sur une branche, elle y est rattachée ; « Rattacher à… » ; supprimée, le lien part", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  const c = await appel("POST", "/api/conversations", { cookie, corps: { noeud: "dossier:d-interface" } });
  assert.equal(c.status, 201);
  assert.equal(c.corps.noeud, "dossier:d-interface");
  assert.equal((await appel("GET", `/api/conversations/${c.corps.id}`, { cookie })).corps.noeud, "dossier:d-interface");
  const sans = await appel("POST", "/api/conversations", { cookie, corps: {} });
  assert.equal((await appel("GET", `/api/conversations/${sans.corps.id}`, { cookie })).corps.noeud, undefined, "clé absente : rien ne change pour les anciens clients");
  const r = await appel("PUT", `/api/conversations/${sans.corps.id}/noeud`, { cookie, corps: { noeud: "dossier:d-fonction" } });
  assert.equal(r.status, 200, "PUT imbriqué /api/conversations/:id/noeud");
  assert.equal((await appel("GET", `/api/conversations/${sans.corps.id}`, { cookie })).corps.noeud, "dossier:d-fonction");
  assert.equal((await appel("PUT", `/api/conversations/${sans.corps.id}/noeud`, { cookie, corps: {} })).status, 400);
  assert.equal((await appel("PUT", "/api/conversations/inconnue/noeud", { cookie, corps: { noeud: null } })).status, 404);
  const arbre = (await appel("GET", "/api/noeuds", { cookie })).corps;
  assert.deepEqual(arbre.noeuds.find((x) => x.noeud === "dossier:d-interface").conversations.map((x) => x.id), [c.corps.id]);
  assert.equal(arbre.noeuds.find((x) => x.noeud === "dossier:d-fonction").conversations.length, 2, "une branche voit les conversations de ses sous-branches");
  await appel("DELETE", `/api/conversations/${c.corps.id}`, { cookie });
  assert.equal(A.noeudDeConversation(c.corps.id), null);
});

test("résumé par le modèle local : à la demande, journalisé (kind « arbre »), coupable, jamais sans le modèle local", async () => {
  await remettreEssais();
  const { cookie } = await connexion();
  const conv = await appel("POST", "/api/conversations", { cookie, corps: { noeud: "dossier:d-interface" } });
  const c = await store.getConversation(conv.corps.id);
  c.title = "Le formulaire de dictée";
  c.messages = [{ role: "user", content: "Le formulaire marche ?" }, { role: "assistant", content: "Oui, la dictée reste à brancher." }];
  await store.putConversation(c);
  const chemin = "/api/noeuds/dossier%3Ad-interface/resume-local";
  const r = await appel("POST", chemin, { cookie, corps: { conversation: c.id } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corps.proposition, { champ: "point", texte: "Le formulaire marche, il reste à brancher la dictée.", origine: "deduit", source: "résumé par le modèle local de la conversation « Le formulaire de dictée »" });
  assert.equal(recusGlm.length, 1, "une requête, au modèle local");
  assert.match(recusGlm[0].messages[1].content, /Sam : Le formulaire marche \?/);
  assert.ok((await store.listCostEntries()).some((e) => e.kind === "arbre" && e.local === true && e.usd === 0));
  assert.equal(A.lireFiche("dossier:d-interface").point?.texte === r.corps.proposition.texte, false, "rien n'est rangé avant « C'est ça »");
  // Une conversation qui n'est pas rattachée à ce nœud : refusé.
  assert.equal((await appel("POST", "/api/noeuds/motion%3Ap1/resume-local", { cookie, corps: { conversation: c.id } })).status, 400);
  // « Rien de clair » : pas de proposition inventée.
  reponseGlm = "Rien de clair.";
  assert.equal((await appel("POST", chemin, { cookie, corps: { conversation: c.id } })).corps.proposition, null);
  // Coupé dans les réglages : refusé, aucun appel.
  await appel("PUT", "/api/reglages", { cookie, corps: { circuits: { arbre: false } } });
  const avant = recusGlm.length;
  const coupe = await appel("POST", chemin, { cookie, corps: { conversation: c.id } });
  assert.equal(coupe.status, 403);
  assert.match(coupe.corps.message, /Coupé/);
  await appel("PUT", "/api/reglages", { cookie, corps: { circuits: { arbre: true } } });
  // Sans modèle local configuré : rien, et surtout pas le cloud.
  const url = process.env.REMY_GLM_URL;
  delete process.env.REMY_GLM_URL;
  process.env.ANTHROPIC_API_KEY = "ne-doit-pas-servir";
  try {
    const sans = await appel("POST", chemin, { cookie, corps: { conversation: c.id } });
    assert.equal(sans.status, 503);
    assert.match(sans.corps.message, /rien n'est envoyé ailleurs/);
  } finally {
    process.env.REMY_GLM_URL = url;
    delete process.env.ANTHROPIC_API_KEY;
  }
  assert.equal(recusGlm.length, avant);
});
