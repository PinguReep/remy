// Mise à jour automatique de la tour (12/11) : la règle (contrôles, jamais en
// arrière, pas pendant que Rémy travaille, retour automatique et refus), le
// verrou, le journal sans secret, les routes /api/maj-auto, et un essai de
// bout en bout (vrai git, faux GitHub, faux Rémy, faux installeur).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-maj-auto-test-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MAJ_AUTO"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "donnees");
process.env.REMY_MAJ_DIR = path.join(dossier, "maj");
process.env.SESSION_SECRET = "secret-de-test";
console.warn = () => {};

const M = await import("../lib/maj-auto.js");
const { fauxGitHub, run } = await import("./outils/faux-github.mjs");
const { essaiComplet } = await import("./outils/essai-maj-auto.mjs");

test.after(() => fs.rmSync(dossier, { recursive: true, force: true }));

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const T = Date.parse("2026-11-12T12:00:00Z");

test("le dépôt : la même adresse, écrite de toutes les façons", () => {
  for (const u of ["https://github.com/PinguReep/remy", "https://github.com/PinguReep/remy.git", "git@github.com:PinguReep/remy.git", "https://jeton@github.com/pingureep/remy/", "github.com/PinguReep/remy"]) {
    assert.equal(M.normaliserDepot(u), "github.com/pingureep/remy", u);
  }
  assert.notEqual(M.normaliserDepot("https://github.com/quelquun/remy"), M.normaliserDepot(M.DEPOT_ATTENDU));
  assert.deepEqual(M.depotGitHub(M.DEPOT_ATTENDU), { proprietaire: "pingureep", nom: "remy" });
  assert.deepEqual(M.depotGitHub("/tmp/x/proprio/remy-essai.git"), { proprietaire: "proprio", nom: "remy-essai" });
});

test("contrôles : Serveur doit avoir réussi, tout le reste terminé et sans échec", () => {
  const ev = (runs, o = {}) => M.evaluerControles(runs, { sha: B, dateCommit: new Date(T - 600_000).toISOString(), maintenant: T, ...o });
  assert.equal(ev([run(B)]).verdict, "ok");
  const bureau = { nom: "Bureau Windows — installateur", chemin: ".github/workflows/bureau-windows.yml", numero: 7 };
  assert.equal(ev([run(B), run(B, { ...bureau, conclusion: "skipped" })]).verdict, "ok", "un job sauté ne bloque pas");
  assert.equal(ev([run(B), run(B, { ...bureau, statut: "in_progress" })]).verdict, "attente");
  assert.equal(ev([run(B, { statut: "queued" })]).verdict, "attente");
  const echec = ev([run(B), run(B, { ...bureau, conclusion: "failure" })]);
  assert.equal(echec.verdict, "echec");
  assert.match(echec.raison, /Bureau Windows — installateur \(failure\)/);
  assert.equal(ev([run(B, { conclusion: "cancelled" })]).verdict, "echec", "annulé n'est pas réussi");
  assert.equal(ev([run(B, { conclusion: "skipped" })]).verdict, "echec", "Serveur sauté n'est pas réussi");
  // Aucun contrôle : jeune, on attend ; vieux d'une heure, « aucun ».
  assert.equal(ev([]).verdict, "attente");
  assert.equal(ev([], { dateCommit: new Date(T - 2 * 3600_000).toISOString() }).verdict, "aucun");
  assert.equal(ev([run(B, bureau)], { dateCommit: new Date(T - 2 * 3600_000).toISOString() }).verdict, "aucun", "sans Serveur, pas d'installation");
  // Les exécutions d'une PR (autre branche) et d'un autre commit ne comptent pas.
  assert.equal(ev([run(B), run(B, { branche: "claude/x", conclusion: "failure", chemin: ".github/workflows/ios-native.yml" }), run(C, { conclusion: "failure" })]).verdict, "ok");
  // Une relance réussie remplace l'échec d'avant (la plus récente de chaque workflow).
  assert.equal(ev([run(B, { conclusion: "failure", cree: "2026-11-12T10:00:00Z", numero: 1 }), run(B, { cree: "2026-11-12T11:00:00Z", numero: 2 })]).verdict, "ok");
  assert.equal(ev([run(B, { cree: "2026-11-12T10:00:00Z", numero: 1 }), run(B, { conclusion: "failure", cree: "2026-11-12T11:00:00Z", numero: 2 })]).verdict, "echec");
});

test("verrou : un seul passage ; périmé à la mort du processus ou après 2 h", () => {
  const f = path.join(dossier, "verrou", "verrou.json");
  const vivant = () => true;
  const v1 = M.prendreVerrou(f, { pid: 111, maintenant: T, vivant });
  assert.equal(v1.ok, true);
  const v2 = M.prendreVerrou(f, { pid: 222, maintenant: T + 60_000, vivant });
  assert.equal(v2.ok, false);
  assert.equal(v2.pid, 111);
  assert.equal(M.prendreVerrou(f, { pid: 222, maintenant: T + 60_000, vivant: (pid) => pid !== 111 }).ok, true, "processus mort : repris");
  const v4 = M.prendreVerrou(f, { pid: 333, maintenant: T + 3 * 3600_000, vivant });
  assert.equal(v4.ok, true, "plus de 2 h : périmé");
  v1.liberer();
  assert.ok(fs.existsSync(f), "on ne rend que SON verrou");
  v4.liberer();
  assert.equal(fs.existsSync(f), false);
  assert.equal(M.processusVivant(process.pid), true);
  assert.equal(M.processusVivant(-1), false);
});

test("journal : borné, sur une ligne, sans secret ; l'installeur ne reçoit pas remy.env", () => {
  assert.equal(M.masquerSecrets("MOTION_API_KEY=abc123 et REMY_SAUVEGARDE_CLE: 00ff"), "MOTION_API_KEY=[masqué] et REMY_SAUVEGARDE_CLE=[masqué]");
  assert.equal(M.masquerSecrets("clé sk-ant-abcdefghijkl, Cookie remy_session=xyz.abc"), "clé [masqué], Cookie remy_session=[masqué]");
  const j = path.join(dossier, "journal", "journal.log");
  for (let i = 0; i < 410; i++) M.journaliser(j, `ligne ${i}\nsuite`, T + i);
  const lignes = M.lireJournal(j, 1000);
  assert.equal(lignes.length, 400);
  assert.match(lignes.at(-1), /^2026-11-12T12:00:00\.409Z ligne 409 suite$/);
  const noms = M.nomsDansEnv("# commentaire\nPORT=3010\nMOTION_API_KEY=x\n  export SESSION_SECRET=y\r\nREMY_SAUVEGARDE_CLE=\n# PAS_CELLE=\n");
  assert.deepEqual(noms, ["PORT", "MOTION_API_KEY", "SESSION_SECRET", "REMY_SAUVEGARDE_CLE"]);
  assert.deepEqual(M.envSans({ PATH: "/bin", MOTION_API_KEY: "x", session_secret: "y", USERPROFILE: "C:\\U" }, noms), { PATH: "/bin", USERPROFILE: "C:\\U" });
});

test("le jeton du script est un jeton de session que Rémy accepte", async () => {
  const { checkSessionToken } = await import("../lib/auth.js");
  assert.equal(checkSessionToken(M.jetonSession(process.env)), true);
  assert.equal(checkSessionToken(M.jetonSession({ SESSION_SECRET: "autre" })), false);
  assert.equal(checkSessionToken(M.jetonSession(process.env, Date.now() - 3600_000)), false, "expire au bout de 10 min");
});

// --- Le passage, chaque morceau remplacé ----------------------------------------------------

function monde(o = {}) {
  const m = {
    etat: o.etat || {},
    journal: [],
    installations: [],
    head: o.head || A,
    origine: "origine" in o ? o.origine : "https://github.com/PinguReep/remy.git",
    pause: o.pause || null,
    main: o.main || { sha: B, date: new Date(T - 600_000).toISOString() },
    runs: o.runs || { [B]: [run(B)] },
    ancetre: "ancetre" in o ? o.ancetre : true,
    occupation: o.occupation || { joignable: true, occupe: false, raisons: [] },
    // Ce que fait l'installeur : { code, change } par appel.
    installeur: o.installeur || [{ code: 0, change: true }],
    servi: o.servi || null,
    t: T,
    githubErreur: o.githubErreur || null,
  };
  const d = {
    env: o.env || {},
    maintenant: () => m.t,
    aBlanc: Boolean(o.aBlanc),
    etat: { lire: () => m.etat, ecrire: (e) => (m.etat = JSON.parse(JSON.stringify(e))) },
    journal: (t) => m.journal.push(t),
    pause: () => m.pause,
    git: {
      origine: async () => m.origine,
      head: async () => m.head,
      estAncetre: async () => m.ancetre,
      revenirA: async (sha) => (m.head = sha),
    },
    github: {
      dernierCommit: async () => {
        if (m.githubErreur) throw m.githubErreur;
        return m.main;
      },
      executions: async (sha) => m.runs[sha] || [],
    },
    remy: {
      occupation: async () => m.occupation,
      versionServie: async () => (m.servi ? m.servi(m.head) : m.head.slice(0, 7)),
    },
    installer: async (sha, { retour }) => {
      const r = m.installeur[m.installations.length] || { code: 0, change: true };
      m.installations.push(`${sha.slice(0, 1)}${retour ? " retour" : ""}`);
      if (r.change) m.head = sha;
      return { code: r.code, raison: r.raison || null };
    },
  };
  return { m, d };
}

test("passage : coupé, en pause, mauvais dépôt, à jour, en arrière — rien n'est installé", async () => {
  for (const [o, etat] of [
    [{ env: { REMY_MAJ_AUTO: "off" } }, "coupee"],
    [{ pause: { pause: true, par: "app" } }, "pause"],
    [{ origine: "https://github.com/quelquun/remy.git" }, "depot-inattendu"],
    [{ origine: null }, "sans-copie"],
    [{ main: { sha: A } }, "a-jour"],
    [{ ancetre: false }, "pas-en-avant"],
    [{ ancetre: null }, "erreur-git"],
    [{ runs: { [B]: [run(B, { statut: "in_progress" })] } }, "attente-controles"],
    [{ runs: { [B]: [run(B, { conclusion: "failure" })] } }, "controles-en-echec"],
    [{ runs: {}, main: { sha: B, date: new Date(T - 5 * 3600_000).toISOString() } }, "sans-controles"],
    [{ occupation: { joignable: true, occupe: true, raisons: ["1 réponse en cours"] } }, "occupe"],
    [{ occupation: { joignable: false, occupe: false } }, "injoignable"],
    [{ etat: { refuses: { [B]: { date: "2026-11-11T10:00:00Z", raison: "/api/version ne répond pas" } } } }, "refuse"],
    [{ githubErreur: new Error("réseau coupé") }, "erreur-github"],
  ]) {
    const { m, d } = monde(o);
    const r = await M.passer(d);
    assert.equal(r.etat, etat, JSON.stringify(o));
    assert.deepEqual(m.installations, [], etat);
    assert.equal(m.head, o.head || A);
    assert.equal(m.etat.etat, etat);
    assert.ok(m.etat.dernierePasse);
  }
  const { d } = monde({ pause: { pause: true, par: "app" } });
  assert.match((await M.passer(d)).message, /En pause depuis l'app/);
  const rouge = monde({ runs: { [B]: [run(B, { conclusion: "failure" })] } });
  assert.match((await M.passer(rouge.d)).message, /bbbbbbb n'est pas installé : contrôles en échec : Serveur — tests \(failure\)/);
});

test("passage : la limite de l'API de GitHub est respectée jusqu'à sa fin", async () => {
  const err = Object.assign(new Error("limite"), { limite: true, reprise: T + 1800_000 });
  const { m, d } = monde({ githubErreur: err });
  assert.equal((await M.passer(d)).etat, "limite-github");
  m.githubErreur = null;
  m.t = T + 600_000;
  assert.equal((await M.passer(d)).etat, "limite-github", "toujours sous la limite : pas de requête");
  m.t = T + 1900_000;
  assert.equal((await M.passer(d)).etat, "installe");
});

test("passage : Rémy injoignable deux fois de suite → on installe (il ne travaille pour personne)", async () => {
  const { m, d } = monde({ occupation: { joignable: false, occupe: false } });
  assert.equal((await M.passer(d)).etat, "injoignable");
  assert.equal(m.etat.injoignable, 1);
  const r = await M.passer(d);
  assert.equal(r.etat, "installe");
  assert.equal(m.etat.injoignable, 0);
});

test("passage : installé et vérifié ; le journal ne note que les changements", async () => {
  const { m, d } = monde();
  const r = await M.passer(d);
  assert.equal(r.etat, "installe");
  assert.deepEqual(m.installations, ["b"]);
  assert.equal(m.etat.installe, B);
  assert.deepEqual(m.etat.derniere, { commit: B, date: new Date(T).toISOString(), resultat: "reussie", raison: null, precedent: A });
  assert.equal(m.journal.length, 2, "début et fin");
  m.main = { sha: B };
  for (let i = 0; i < 3; i++) await M.passer(d);
  assert.equal(m.etat.etat, "a-jour");
  assert.equal(m.journal.length, 3, "« à jour » une fois, pas à chaque passage");
});

test("passage : à blanc, rien n'est écrit ni installé", async () => {
  const { m, d } = monde({ aBlanc: true });
  const r = await M.passer(d);
  assert.equal(r.etat, "installerait");
  assert.deepEqual(m.etat, {});
  assert.deepEqual(m.journal, []);
  assert.deepEqual(m.installations, []);
});

test("passage : Rémy se met au travail pendant la sauvegarde (code 3) → rien de changé, sans pénalité", async () => {
  const { m, d } = monde({ installeur: [{ code: M.CODE_OCCUPE, change: false }] });
  assert.equal((await M.passer(d)).etat, "occupe");
  assert.equal(m.head, A);
  assert.equal(m.etat.essais[B], undefined);
  assert.equal((await M.passer(d)).etat, "installe", "le passage suivant installe");
});

test("passage : l'installeur s'arrête avant tout changement → annulée, réessais espacés, jamais de retour", async () => {
  const raison = "Sauvegarde avant mise à jour impossible ou sans copie hors de la tour : rien n'a été changé.";
  const { m, d } = monde({ installeur: [{ code: 1, change: false, raison }, { code: 1, change: false, raison }, { code: 0, change: true }] });
  let r = await M.passer(d);
  assert.equal(r.etat, "annulee");
  assert.equal(m.etat.derniere.resultat, "annulee");
  assert.equal(m.etat.derniere.raison, raison);
  assert.deepEqual(m.installations, ["b"], "pas de retour : rien n'avait changé");
  m.t += 10 * 60_000;
  assert.equal((await M.passer(d)).etat, "attente-reessai");
  m.t += 6 * 60_000;
  assert.equal((await M.passer(d)).etat, "annulee");
  assert.equal(m.etat.essais[B].n, 2);
  m.t += 20 * 60_000;
  assert.equal((await M.passer(d)).etat, "attente-reessai", "deuxième échec : 30 min");
  m.t += 15 * 60_000;
  r = await M.passer(d);
  assert.equal(r.etat, "installe");
  assert.deepEqual(m.etat.essais, {});
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(M.attenteApresArret), [15, 30, 60, 120, 240, 360].map((x) => x * 60_000));
});

test("passage : la nouvelle version ne s'annonce pas → retour à la précédente, commit refusé pour de bon", async () => {
  const { m, d } = monde({ servi: (head) => (head === B ? null : head.slice(0, 7)) });
  const r = await M.passer(d);
  assert.equal(r.etat, "annulee");
  assert.deepEqual(m.installations, ["b", "a retour"]);
  assert.equal(m.head, A);
  assert.equal(m.etat.installe, A);
  assert.equal(m.etat.refuses[B].raison, "/api/version ne répond pas");
  assert.equal(m.etat.derniere.retour, "reussi");
  assert.match(r.message, /retour automatique à aaaaaaa réussi/);
  assert.equal((await M.passer(d)).etat, "refuse");
  assert.deepEqual(m.installations, ["b", "a retour"], "jamais retenté en boucle");
  // Le commit suivant de main, lui, est essayé.
  m.main = { sha: C, date: new Date(T).toISOString() };
  m.runs[C] = [run(C)];
  m.servi = null;
  assert.equal((await M.passer(d)).etat, "installe");
});

test("passage : installeur arrêté APRÈS avoir changé la copie → retour aussi", async () => {
  const { m, d } = monde({ installeur: [{ code: 1, change: true, raison: "npm ci a échoué" }] });
  const r = await M.passer(d);
  assert.equal(r.etat, "annulee");
  assert.deepEqual(m.installations, ["b", "a retour"]);
  assert.match(m.etat.refuses[B].raison, /npm ci a échoué/);
});

test("passage : le retour échoue aussi → dit en clair, avec la commande à lancer", async () => {
  const { m, d } = monde({ installeur: [{ code: 0, change: true }, { code: 1, change: false, raison: "Rémy ne répond pas en 127.0.0.1:3010" }], servi: () => null });
  const r = await M.passer(d);
  assert.equal(r.etat, "retour-echoue");
  assert.equal(m.etat.derniere.retour, "echoue");
  assert.match(r.message, /installer-tour\.ps1 -Ref a{40}/);
  assert.ok(m.etat.refuses[B]);
});

test("vue de Réglages : activée, en pause, en retard, coupée", () => {
  const tache = { active: true, depuis: "2026-11-12T08:00:00Z", intervalleMin: 15 };
  const etat = { etat: "installe", message: "ok", dernierePasse: new Date(T - 5 * 60_000).toISOString(), installe: B, derniere: { commit: B, date: "2026-11-12T11:55:00Z", resultat: "reussie" } };
  const v = M.vueMajAuto({ tache, etat, maintenant: T, env: {} });
  assert.equal(v.active, true);
  assert.equal(v.pause, false);
  assert.equal(v.retard, false);
  assert.equal(v.derniere.commit, "bbbbbbb");
  assert.equal(v.installe, "bbbbbbb");
  assert.equal(M.vueMajAuto({ tache, etat, maintenant: T + 2 * 3600_000, env: {} }).retard, true, "plus d'une heure sans passage");
  assert.equal(M.vueMajAuto({ tache, etat, pause: { pause: true, depuis: "x" }, maintenant: T + 2 * 3600_000, env: {} }).retard, false);
  assert.equal(M.vueMajAuto({ env: {} }).active, false);
  assert.equal(M.vueMajAuto({ tache, env: { REMY_MAJ_AUTO: "off" } }).coupeeParLaTour, true);
});

// --- Les clients, contre un faux GitHub et le vrai Rémy --------------------------------------

test("client GitHub : dernier commit de main, exécutions du commit, limite sans jeton", async () => {
  const gh = await fauxGitHub({ etat: { main: { sha: B, date: "2026-11-12T10:00:00Z" }, runs: { [B]: [run(B)] } } });
  try {
    const c = M.clientGitHub({ depot: "github.com/proprio/remy-essai", api: gh.url });
    assert.deepEqual(await c.dernierCommit(), { sha: B, date: "2026-11-12T10:00:00Z" });
    assert.equal((await c.executions(B)).length, 1);
    assert.deepEqual(gh.requetes, ["GET /repos/proprio/remy-essai/commits/main", `GET /repos/proprio/remy-essai/actions/runs?head_sha=${B}&per_page=100`]);
    gh.etat.limite = true;
    await assert.rejects(c.dernierCommit(), (e) => e.limite === true && e.reprise > Date.now());
    gh.etat.limite = false;
    gh.etat.panne = true;
    await assert.rejects(c.dernierCommit(), /GitHub répond 502/);
  } finally {
    await gh.fermer();
  }
});

test("routes : /api/maj-auto dit l'occupation et l'état ; la pause s'écrit pour la tâche", async () => {
  const { routeApi } = await import("../lib/routes.js");
  const arret = await import("../lib/arret.js");
  const serveurOccupation = await import("../lib/maj-auto-serveur.js");
  const remy = http.createServer(async (req, res) => {
    if (!(await routeApi(req, res))) {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise((r) => remy.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${remy.address().port}`;
  const F = M.fichiers(process.env.REMY_MAJ_DIR);
  process.env.APP_PASSWORD = "mot-de-passe-de-test";
  try {
    assert.equal((await fetch(`${base}/api/maj-auto`)).status, 401, "jamais sans session");
    const client = M.clientRemy({ url: base, env: process.env, pauseMs: 1 });
    assert.deepEqual(await client.occupation(), { joignable: true, occupe: false, raisons: [] });
    // Une réponse qui s'écrit : occupé.
    const g = arret.demarrerGeneration("conv-essai");
    const o = await client.occupation();
    assert.equal(o.occupe, true);
    assert.deepEqual(o.raisons, ["1 réponse en cours"]);
    g.liberer();
    assert.equal((await client.occupation()).occupe, false);
    // Une écriture en cours (un envoi qui n'est pas fini) : occupé.
    const lente = http.request(`${base}/api/memory`, { method: "PUT", headers: { "Content-Type": "application/json", "Content-Length": "100", Cookie: `remy_session=${M.jetonSession(process.env)}` } });
    lente.on("error", () => {});
    lente.write("{");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual((await client.occupation()).raisons, ["1 écriture en cours"]);
    lente.destroy();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(serveurOccupation.occupation().occupe, false, "l'écriture coupée ne compte plus");
    // /api/version annonce le commit à qui a la session (le script).
    const v = await client.versionServie(null, { essais: 1 });
    const { commitInstalle } = await import("../lib/version.js");
    assert.equal(v, commitInstalle());
    // La vue, puis la pause (écrite dans pause.json, lue par la tâche).
    const cookie = { Cookie: `remy_session=${M.jetonSession(process.env)}`, "Content-Type": "application/json" };
    let r = await (await fetch(`${base}/api/maj-auto`, { headers: cookie })).json();
    assert.equal(r.active, false);
    assert.equal(r.pause, false);
    assert.equal((await fetch(`${base}/api/maj-auto`, { method: "PUT", headers: cookie, body: JSON.stringify({ pause: "oui" }) })).status, 400);
    r = await (await fetch(`${base}/api/maj-auto`, { method: "PUT", headers: cookie, body: JSON.stringify({ pause: true }) })).json();
    assert.equal(r.pause, true);
    assert.equal(M.lireJSON(F.pause).pause, true);
    assert.match(M.lireJournal(F.journal).at(-1), /Mise en pause depuis l'app/);
    M.ecrireJSON(F.tache, { active: true, depuis: new Date().toISOString(), intervalleMin: 15 });
    M.ecrireJSON(F.etat, { etat: "installe", message: "ok", dernierePasse: new Date().toISOString(), derniere: { commit: B, date: new Date().toISOString(), resultat: "reussie" } });
    r = await (await fetch(`${base}/api/maj-auto`, { method: "PUT", headers: cookie, body: JSON.stringify({ pause: false }) })).json();
    assert.equal(r.active, true);
    assert.equal(r.pause, false);
    assert.equal(r.derniere.commit, "bbbbbbb");
    assert.equal(r.occupation.occupe, false, "le PUT lui-même ne compte pas");
    const { CAPACITES } = await import("../lib/version.js");
    assert.ok(CAPACITES.includes("maj-auto-v1"));
  } finally {
    delete process.env.APP_PASSWORD;
    remy.close();
  }
});

test("de bout en bout : vrai git, faux GitHub, faux Rémy, faux installeur, script lancé comme par la tâche", { timeout: 60_000 }, async () => {
  assert.deepEqual(await essaiComplet(), { ok: true });
});
