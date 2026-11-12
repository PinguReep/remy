// Essai de bout en bout de la mise à jour automatique, sans la vraie tour :
// un vrai dépôt git (nu, « origine »), une vraie copie de production (clone
// détaché), un faux GitHub, un faux Rémy (sa version suit la copie), et un
// faux installeur qui fait `git checkout`. scripts/maj-auto.mjs est lancé
// comme le ferait la tâche, dans un processus à part.
//
//   node test/outils/essai-maj-auto.mjs                         (faux installeur Node)
//   node test/outils/essai-maj-auto.mjs --installeur test\outils\faux-installeur.ps1
//
// La seconde forme tourne dans la CI Windows : elle prouve le lancement de
// powershell.exe -File par Node, les codes de sortie et la raison laissée en
// UTF-8. Sort en 1 au premier écart.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fauxGitHub, run } from "./faux-github.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.join(ici, "..", "..");

const git = (dossier, ...a) => {
  const r = spawnSync("git", ["-c", "user.name=Essai", "-c", "user.email=essai@exemple.invalid", "-c", "commit.gpgsign=false", "-C", dossier, ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")} : ${r.stderr}`);
  return r.stdout.trim();
};

function lancer(script, args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env, windowsHide: true });
    let sortie = "";
    p.stdout.on("data", (b) => (sortie += b));
    p.stderr.on("data", (b) => (sortie += b));
    p.on("close", (code) => resolve({ code, sortie }));
  });
}

export async function essaiComplet({ installeur = path.join(ici, "faux-installeur.mjs"), dire = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remy-maj-auto-"));
  const nu = path.join(tmp, "depots", "proprio", "remy-essai.git");
  const travail = path.join(tmp, "travail");
  const base = path.join(tmp, "base");
  const app = path.join(base, "app");
  const dossierMaj = path.join(base, "maj-auto");
  const trace = path.join(tmp, "trace.txt");
  fs.mkdirSync(path.dirname(nu), { recursive: true });
  spawnSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", nu]);
  spawnSync("git", ["init", "--quiet", "--initial-branch=main", travail]);
  const commit = (n) => {
    fs.writeFileSync(path.join(travail, "version.txt"), `${n}\n`);
    git(travail, "add", "version.txt");
    git(travail, "commit", "--quiet", "-m", `version ${n}`);
    git(travail, "push", "--quiet", nu, "main");
    return git(travail, "rev-parse", "HEAD");
  };
  const A = commit("A");
  const B = commit("B");
  spawnSync("git", ["clone", "--quiet", nu, app]);
  git(app, "checkout", "--quiet", "--detach", A);

  // Faux Rémy : sa version est le commit de la copie de production, sauf pour
  // un commit « cassé » (il annonce alors autre chose, comme un serveur qui
  // n'a pas redémarré).
  const remyEtat = { occupe: false, casse: null };
  const remy = http.createServer((req, res) => {
    const json = (code, corps) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(corps));
    };
    const head = git(app, "rev-parse", "HEAD");
    if (req.url.startsWith("/api/maj-auto")) return json(200, { occupation: { occupe: remyEtat.occupe, raisons: remyEtat.occupe ? ["1 réponse en cours"] : [] } });
    if (req.url.startsWith("/api/version")) return json(200, { api: 1, commit: head === remyEtat.casse ? "0000000" : head.slice(0, 7) });
    return json(404, {});
  });
  await new Promise((r) => remy.listen(0, "127.0.0.1", r));
  const gh = await fauxGitHub({ etat: { main: { sha: B, date: new Date(Date.now() - 600_000).toISOString() }, runs: { [B]: [run(B), run(B, { nom: "Bureau Windows — installateur", chemin: ".github/workflows/bureau-windows.yml", numero: 2 }),
    // Une PR d'un fork, branche « main », même commit, rouge et plus récente : ne compte pas.
    run(B, { evenement: "pull_request", tete: "intrus/remy", conclusion: "failure", numero: 9, cree: "2026-11-12T11:00:00Z" })] } } });

  const env = {
    ...process.env,
    REMY_MAJ_GITHUB_API: gh.url,
    REMY_MAJ_DEPOT: nu,
    REMY_MAJ_URL: `http://127.0.0.1:${remy.address().port}`,
    REMY_MAJ_INSTALLEUR: installeur,
    REMY_MAJ_APP: app,
    REMY_MAJ_DIR: dossierMaj,
    FAUX_INSTALLEUR_TRACE: trace,
    SESSION_SECRET: "essai",
    REMY_MAJ_PAUSE_MS: "20",
    // Les surcharges REMY_MAJ_* ne valent qu'en essai explicite.
    REMY_ENV: "test",
  };
  delete env.REMY_MAJ_AUTO;
  const passage = async (extra = {}, args = []) => {
    const r = await lancer(path.join(racine, "scripts", "maj-auto.mjs"), ["--base", base, ...args], { ...env, ...extra });
    const etat = JSON.parse(fs.readFileSync(path.join(dossierMaj, "etat.json"), "utf8"));
    dire(`  ${etat.etat} — ${etat.message}`);
    return { ...r, etat };
  };
  const tracees = () => (fs.existsSync(trace) ? fs.readFileSync(trace, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.trim()) : []);
  const head = () => git(app, "rev-parse", "HEAD");

  try {
    dire("1. à blanc : rien ne bouge");
    const blanc = await lancer(path.join(racine, "scripts", "maj-auto.mjs"), ["--base", base, "--a-blanc"], env);
    assert.equal(blanc.code, 0, blanc.sortie);
    assert.match(blanc.sortie, /"etat":"installerait"/);
    assert.equal(fs.existsSync(path.join(dossierMaj, "etat.json")), false, "à blanc : aucun état écrit");
    assert.equal(head(), A);

    dire("2. Rémy travaille : on attend");
    remyEtat.occupe = true;
    let p = await passage();
    assert.equal(p.etat.etat, "occupe");
    assert.deepEqual(tracees(), []);
    remyEtat.occupe = false;

    dire("3. contrôles verts : B installé et vérifié");
    p = await passage();
    assert.equal(p.code, 0, p.sortie);
    assert.equal(p.etat.etat, "installe", p.sortie);
    assert.equal(head(), B);
    assert.deepEqual(tracees(), [`${B} -Auto`]);
    assert.equal(p.etat.derniere.resultat, "reussie");

    dire("4. de nouveau : à jour, une seule requête à GitHub");
    const avant = gh.requetes.length;
    p = await passage();
    assert.equal(p.etat.etat, "a-jour");
    assert.equal(gh.requetes.length - avant, 1);

    dire("5. C ne répond pas comme attendu : retour à B, C refusé");
    const C = commit("C");
    gh.etat.main = { sha: C, date: new Date().toISOString() };
    gh.etat.runs[C] = [run(C, { statut: "in_progress" })];
    p = await passage();
    assert.equal(p.etat.etat, "attente-controles");
    gh.etat.runs[C] = [run(C)];
    remyEtat.casse = C;
    p = await passage();
    assert.equal(p.etat.etat, "annulee", p.sortie);
    assert.equal(head(), B);
    assert.deepEqual(tracees().slice(-2), [`${C} -Auto`, `${B} -Auto -Retour`]);
    assert.ok(p.etat.refuses[C]);
    assert.equal(p.etat.derniere.retour, "reussi");
    p = await passage();
    assert.equal(p.etat.etat, "refuse");
    assert.equal(tracees().length, 3, "C n'est pas retenté");

    dire("6. D : l'installeur s'arrête avant tout changement (sauvegarde impossible)");
    const D = commit("D");
    gh.etat.main = { sha: D, date: new Date().toISOString() };
    gh.etat.runs[D] = [run(D)];
    p = await passage({ FAUX_INSTALLEUR_ARRET: "1" });
    assert.equal(p.etat.etat, "annulee", p.sortie);
    assert.match(p.etat.derniere.raison, /Sauvegarde avant mise à jour impossible/, "la raison, accents compris");
    assert.equal(head(), B);
    assert.ok(p.etat.essais[D]);
    p = await passage();
    assert.equal(p.etat.etat, "attente-reessai", "pas de nouvel essai tout de suite");

    dire("7. contrôles en échec : rien");
    const E = commit("E");
    gh.etat.main = { sha: E, date: new Date().toISOString() };
    gh.etat.runs[E] = [run(E, { conclusion: "failure" })];
    p = await passage();
    assert.equal(p.etat.etat, "controles-en-echec");
    assert.match(p.etat.message, /Serveur — tests \(failure\)/);

    dire("8. un autre passage tient le verrou : rien");
    fs.writeFileSync(path.join(dossierMaj, "verrou.json"), JSON.stringify({ pid: process.pid, par: "essai", depuis: new Date().toISOString() }));
    const v = await lancer(path.join(racine, "scripts", "maj-auto.mjs"), ["--base", base], env);
    assert.equal(v.code, 0);
    assert.match(v.sortie, /tient le verrou/);
    fs.rmSync(path.join(dossierMaj, "verrou.json"));

    dire("9. le journal : des commits et des états, aucun secret");
    const journal = fs.readFileSync(path.join(dossierMaj, "journal.log"), "utf8");
    assert.match(journal, new RegExp(`${B.slice(0, 7)} installé et vérifié`));
    assert.doesNotMatch(journal, /essai@|SESSION_SECRET|remy_session/);
    return { ok: true };
  } finally {
    remy.close();
    await gh.fermer();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--installeur");
  const installeur = i > 0 ? path.resolve(process.argv[i + 1]) : undefined;
  try {
    await essaiComplet({ installeur, dire: (t) => console.log(t) });
    console.log("Mise à jour automatique : essai de bout en bout réussi.");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
