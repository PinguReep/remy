// Mise à jour automatique de la tour : un passage (12/11). Lancé par la tâche
// planifiée « Rémy - mise à jour » (installer-tour.ps1 -MiseAJourAuto), toutes
// les 15 minutes et à l'ouverture de session :
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\maj-auto.mjs --base %USERPROFILE%\.remy
//
// Options :
//   --a-blanc   dit ce qui serait fait, sans rien installer ni écrire
//   --etat      l'état, la vue de Réglages et les dernières lignes du journal
//   --occupe    sort en 10 si Rémy travaille (l'installeur -Auto s'en sert juste
//               avant de changer de version), 0 sinon
//
// La décision vit dans lib/maj-auto.js (testée) ; ici, seulement les vrais
// services : git sur la copie de production, l'API publique de GitHub (sans
// jeton), Rémy en 127.0.0.1, et l'installeur. Rien de remy.env n'est écrit
// nulle part ; le journal ne contient que des commits et des états.
//
// Pour les essais : REMY_MAJ_GITHUB_API, REMY_MAJ_DEPOT, REMY_MAJ_URL,
// REMY_MAJ_APP, REMY_MAJ_DIR, REMY_MAJ_INSTALLEUR (un .ps1, ou un .mjs lancé
// par Node).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as M from "../lib/maj-auto.js";

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const base = option("--base") || process.env.REMY_MAJ_BASE || path.join(os.homedir(), ".remy");
const app = process.env.REMY_MAJ_APP || path.join(base, "app");
const dossier = process.env.REMY_MAJ_DIR || path.join(base, "maj-auto");
const F = M.fichiers(dossier);
const fichierEnv = path.join(base, "remy.env");
const url = process.env.REMY_MAJ_URL || `http://127.0.0.1:${process.env.PORT || 3010}`;
const remy = M.clientRemy({ url, env: process.env, pauseMs: Number(process.env.REMY_MAJ_PAUSE_MS) || 2_000 });

if (args.includes("--occupe")) {
  const o = await remy.occupation();
  console.log(o.joignable ? (o.occupe ? `Rémy travaille : ${o.raisons.join(", ")}` : "Rémy est calme") : "Rémy ne répond pas");
  process.exit(o.joignable && o.occupe ? M.CODE_SORTIE_OCCUPE : 0);
}

if (args.includes("--etat")) {
  const v = M.vueMajAuto({ tache: M.lireJSON(F.tache), pause: M.lireJSON(F.pause), etat: M.lireJSON(F.etat), env: process.env });
  console.log(JSON.stringify(v, null, 2));
  const j = M.lireJournal(F.journal, 15);
  console.log(j.length ? `\nJournal (${F.journal}) :\n${j.join("\n")}` : `\nJournal vide (${F.journal}).`);
  process.exit(0);
}

const aBlanc = args.includes("--a-blanc");

function git(...a) {
  return spawnSync("git", ["-C", app, ...a], { encoding: "utf8", timeout: 180_000, windowsHide: true });
}
const sortieGit = (...a) => {
  const r = git(...a);
  return r.status === 0 ? String(r.stdout).trim() : null;
};

const depots = {
  async origine() {
    if (!fs.existsSync(path.join(app, ".git"))) return null;
    return sortieGit("remote", "get-url", "origin");
  },
  async head() {
    const h = sortieGit("rev-parse", "HEAD");
    return /^[0-9a-f]{40}$/.test(h || "") ? h : null;
  },
  async estAncetre(ancien, nouveau) {
    // La copie de production apprend le nouveau commit ; un échec du réseau
    // n'empêche pas de juger si les deux sont déjà là.
    git("fetch", "--quiet", "origin");
    if (git("cat-file", "-e", `${nouveau}^{commit}`).status !== 0) return null;
    const r = git("merge-base", "--is-ancestor", ancien, nouveau);
    return r.status === 0 ? true : r.status === 1 ? false : null;
  },
  async revenirA(sha) {
    // L'installeur ÉPROUVÉ (celui de la version d'avant) fait le retour : on
    // remet d'abord ses fichiers en place.
    const r = git("checkout", "--quiet", "--force", "--detach", sha);
    if (r.status !== 0) throw new Error(`git checkout ${M.court(sha)} a échoué`);
  },
};

function lancerInstalleur(sha, { retour = false } = {}) {
  const installeur = process.env.REMY_MAJ_INSTALLEUR || path.join(app, "scripts", "installer-tour.ps1");
  const parametres = ["-Ref", sha, "-Auto", ...(retour ? ["-Retour"] : [])];
  const [exe, a] = installeur.endsWith(".mjs")
    ? [process.execPath, [installeur, ...parametres]]
    : ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installeur, ...parametres]];
  fs.rmSync(F.raison, { force: true });
  // L'installeur relit remy.env lui-même, comme lancé à la main : il ne reçoit
  // pas les secrets que --env-file a mis dans l'environnement de ce script.
  let noms = [];
  try {
    noms = M.nomsDansEnv(fs.readFileSync(fichierEnv, "utf8"));
  } catch {}
  const env = M.envSans(process.env, noms.filter((n) => !/^REMY_MAJ_/.test(n)));
  return new Promise((resolve) => {
    let sortie = "";
    const p = spawn(exe, a, { cwd: base, env, windowsHide: true });
    const garder = (b) => {
      sortie = (sortie + b.toString("utf8")).slice(-200_000);
    };
    p.stdout.on("data", garder);
    p.stderr.on("data", garder);
    const minuterie = setTimeout(() => p.kill(), 45 * 60_000);
    const finir = (code, erreur = null) => {
      clearTimeout(minuterie);
      const lignes = M.masquerSecrets(sortie).split(/\r?\n/).filter((l) => l.trim());
      try {
        fs.mkdirSync(dossier, { recursive: true });
        fs.writeFileSync(F.sortie, `${new Date().toISOString()} installeur -Ref ${sha}${retour ? " -Retour" : ""} : code ${code}\n${lignes.slice(-150).join("\n")}\n`);
      } catch {}
      let raison = null;
      try {
        raison = fs.readFileSync(F.raison, "utf8").replace(/^﻿/, "").trim() || null;
      } catch {}
      if (!raison && code !== 0) raison = erreur || lignes.find((l) => /impossible|échou|introuvable|refus|erreur|error/i.test(l)) || lignes.at(-1) || null;
      resolve({ code, raison: raison ? M.masquerSecrets(raison).slice(0, 300) : null });
    };
    p.on("error", (err) => finir(127, `installeur non lancé : ${err.message}`));
    p.on("close", (code) => finir(code ?? 1));
  });
}

const verrou = aBlanc ? { ok: true, liberer() {} } : M.prendreVerrou(F.verrou);
if (!verrou.ok) {
  console.log(`Un autre passage (${verrou.par}) tient le verrou depuis ${verrou.depuis} : rien à faire.`);
  process.exit(0);
}
let resultat;
try {
  resultat = await M.passer({
    env: process.env,
    maintenant: () => Date.now(),
    aBlanc,
    etat: { lire: () => M.lireJSON(F.etat, {}), ecrire: (e) => M.ecrireJSON(F.etat, e) },
    journal: (texte) => M.journaliser(F.journal, texte),
    pause: () => M.lireJSON(F.pause),
    git: depots,
    github: M.clientGitHub({ depot: M.depotAttendu(process.env), api: process.env.REMY_MAJ_GITHUB_API || "https://api.github.com" }),
    remy,
    installer: lancerInstalleur,
  });
} catch (err) {
  const message = `Passage interrompu : ${String(err?.message || err).slice(0, 200)}`;
  if (!aBlanc) M.journaliser(F.journal, message);
  console.error(message);
  verrou.liberer();
  process.exit(1);
}
verrou.liberer();
console.log(aBlanc ? JSON.stringify({ etat: resultat.etat, message: resultat.message }) : resultat.message);
process.exit(resultat.etat === "retour-echoue" ? 1 : 0);
