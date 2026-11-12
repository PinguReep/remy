// Mise à jour automatique de la tour (12/11) : la décision, en Node testable.
//
// Une tâche planifiée (« Rémy - mise à jour », posée une fois par
// `installer-tour.ps1 -MiseAJourAuto`) lance scripts/maj-auto.mjs toutes les
// 15 minutes et à l'ouverture de session. Ce module dit QUOI faire ; le script
// branche les vrais services (git, GitHub, Rémy, l'installeur). Rien ici ne
// touche au disque, au réseau ni à un processus sans passer par ce qu'on lui
// donne : les tests remplacent chaque morceau.
//
// La règle (docs/tour.md, « Mise à jour automatique ») :
//   - candidat : le dernier commit de `main` du dépôt attendu ; la copie de
//     production doit suivre CE dépôt (sinon rien) ;
//   - jamais en arrière : le commit installé doit être un ancêtre du candidat ;
//   - contrôles : les exécutions GitHub Actions lancées sur `main` pour ce
//     commit, la dernière de chaque workflow. « Serveur — tests » (Ubuntu +
//     Windows, l'installeur compris) doit y être et avoir réussi ; toutes les
//     autres terminées, réussies ou sautées. En cours : on attend. Aucune :
//     on n'installe pas. Un échec : on n'installe pas, et on le dit ;
//   - pas pendant que Rémy travaille pour Sam (réponse, écriture en cours, ou
//     une sauvegarde qui écrit) : on repasse au tour suivant. Le reste du
//     travail de fond CÈDE la place (12/11, lib/priorite.js) : mis en pause
//     avant d'installer (`remy.ceder()`), il reprend après le redémarrage ;
//   - après l'installation, /api/version doit annoncer le candidat ; sinon
//     retour à la version d'avant, par le même installeur, et le candidat est
//     « refusé » (jamais retenté) ;
//   - jamais deux passages à la fois (verrou, périmé au bout de 2 h ou à la
//     mort de son processus).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const DEPOT_ATTENDU = "github.com/PinguReep/remy";
export const BRANCHE = "main";
export const WORKFLOW_REQUIS = ".github/workflows/serveur.yml";
export const NOM_WORKFLOW_REQUIS = "Serveur — tests";
export const TACHE = "Rémy - mise à jour";
export const INTERVALLE_MIN = 15;
export const PEREMPTION_VERROU_MS = 2 * 3600_000;
// Sans exécution « Serveur » au bout d'une heure, ce commit n'en aura sans
// doute jamais (workflow retiré, Actions coupé) : on le dit autrement.
export const ATTENTE_CONTROLES_MS = 3600_000;
// Rémy injoignable : on attend ce nombre de passages d'affilée avant
// d'installer quand même (un serveur tombé ne travaille pour personne, et la
// version suivante le répare peut-être).
export const INJOIGNABLE_AVANT_INSTALLATION = 2;
// Code de sortie de l'installeur (-Auto) quand Rémy s'est mis au travail
// pendant la sauvegarde : rien n'a été changé.
export const CODE_OCCUPE = 3;
// Code de sortie de `maj-auto.mjs --occupe` quand Rémy travaille.
export const CODE_SORTIE_OCCUPE = 10;
const JOURNAL_MAX_LIGNES = 400;
export const OCCUPE_SIGNALE_MS = 6 * 3600_000;
const REFUS_GARDES = 20;

export const court = (sha) => String(sha || "?").slice(0, 7);
export const API_GITHUB = "https://api.github.com";

// Les surcharges REMY_MAJ_* (faux GitHub, faux installeur, autre copie…) ne
// valent qu'en essai explicite (REMY_ENV=test, posé par `npm test` et par
// l'essai de bout en bout). Sur la tour, elles sont ignorées : un fichier
// modifié ne peut pas rediriger la tâche vers un autre installeur ou un autre
// « GitHub ».
export const enEssai = (env = process.env) => env.REMY_ENV === "test";
export const surcharge = (env, nom) => (enEssai(env) && env[nom] ? env[nom] : null);

// Un exécutable cherché dans le PATH, jamais dans le dossier courant (sous
// Windows, Node le regarde en premier : un `git.exe` déposé dans .remy y
// gagnerait). Entrées relatives ignorées. Rend un chemin absolu, ou null.
export function trouverDansPath(nom, { env = process.env, plateforme = process.platform, existe = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } } } = {}) {
  const sep = plateforme === "win32" ? ";" : ":";
  const exts = plateforme === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  const p = plateforme === "win32" ? path.win32 : path.posix;
  const dossiers = String(env.PATH || env.Path || "").split(sep).map((d) => d.trim().replace(/^"|"$/g, "")).filter((d) => d && p.isAbsolute(d));
  for (const d of dossiers) {
    for (const e of exts) {
      const f = p.join(d, nom.toLowerCase().endsWith(e.toLowerCase()) ? nom : nom + e);
      if (existe(f)) return f;
    }
  }
  return null;
}

// PowerShell de Windows, par son chemin complet.
export const powershellWindows = (env = process.env) => path.win32.join(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// Les commandes git du passage : pas de hooks, pas de fsmonitor, pas d'objets
// de remplacement (refs/replace) — rien que la copie ne puisse faire exécuter.
export const optionsGitSures = (plateforme = process.platform) => ["-c", `core.hooksPath=${plateforme === "win32" ? "NUL" : "/dev/null"}`, "-c", "core.fsmonitor=false"];
export const envGitSur = (env) => ({ ...env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" });

// --- Où vivent les fichiers --------------------------------------------------------------

// `%USERPROFILE%\.remy\maj-auto` sur la tour (le serveur et la tâche tournent
// sous le même compte). REMY_MAJ_DIR pour les essais.
export function dossierMaj(env = process.env) {
  return surcharge(env, "REMY_MAJ_DIR") || path.join(os.homedir(), ".remy", "maj-auto");
}
export const fichiers = (dossier) => ({
  etat: path.join(dossier, "etat.json"),
  pause: path.join(dossier, "pause.json"),
  tache: path.join(dossier, "tache.json"),
  verrou: path.join(dossier, "verrou.json"),
  journal: path.join(dossier, "journal.log"),
  sortie: path.join(dossier, "derniere-installation.log"),
  raison: path.join(dossier, "installeur-raison.txt"),
});

export function lireJSON(fichier, defaut = null) {
  try {
    // Un fichier écrit par PowerShell peut commencer par une marque d'ordre des octets.
    return JSON.parse(fs.readFileSync(fichier, "utf8").replace(/^﻿/, ""));
  } catch {
    return defaut;
  }
}

export function ecrireJSON(fichier, valeur) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2) + "\n");
  fs.renameSync(tmp, fichier);
}

// --- Le dépôt ----------------------------------------------------------------------------

// « https://github.com/A/B.git », « git@github.com:A/B », « github.com/a/b/ » →
// « github.com/a/b ». Un chemin local (essais) reste un chemin, sans « .git ».
export function normaliserDepot(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  u = u.replace(/^git@([^:]+):/, "$1/");
  u = u.replace(/^[a-z+]+:\/\//i, "");
  u = u.replace(/^[^@/]+@/, "");
  u = u.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\.git$/i, "");
  return u.toLowerCase();
}

export const depotAttendu = (env = process.env) => surcharge(env, "REMY_MAJ_DEPOT") || DEPOT_ATTENDU;

// Le propriétaire et le nom pour l'API de GitHub : les deux derniers segments.
export function depotGitHub(depot) {
  const segs = normaliserDepot(depot).split("/").filter(Boolean);
  if (segs.length < 2) throw new Error(`Dépôt illisible : ${depot}`);
  return { proprietaire: segs[segs.length - 2], nom: segs[segs.length - 1] };
}

// --- Les contrôles ---------------------------------------------------------------------

const ACCEPTEES = new Set(["success", "skipped", "neutral"]);
const nomRun = (r) => r.name || r.path || `workflow ${r.workflow_id}`;
const cheminRun = (r) => String(r.path || "").split("@")[0];

// `runs` : workflow_runs de GET /repos/:o/:r/actions/runs?head_sha=…&branch=main&event=push.
// Seules comptent les exécutions d'un ENVOI sur main DU dépôt attendu : une PR
// (même d'un fork dont la branche s'appelle « main », avec le même commit) ne
// peut ni bloquer ni valider une mise à jour.
// Rend { verdict: "ok" | "attente" | "aucun" | "echec", raison, controles }.
export function evaluerControles(runs, { sha, depot = DEPOT_ATTENDU, branche = BRANCHE, dateCommit = null, maintenant = Date.now(), requis = WORKFLOW_REQUIS } = {}) {
  const { proprietaire, nom } = depotGitHub(depot);
  const attendu = `${proprietaire}/${nom}`;
  const duDepot = (r) => String(r?.repository?.full_name || "").toLowerCase() === attendu && String(r?.head_repository?.full_name || "").toLowerCase() === attendu;
  const surMain = (runs || []).filter((r) => r && (!sha || r.head_sha === sha) && r.head_branch === branche && r.event === "push" && duDepot(r));
  // La dernière exécution de chaque workflow (une relance manuelle remplace la précédente).
  const parWorkflow = new Map();
  for (const r of surMain) {
    const cle = cheminRun(r) || String(r.workflow_id);
    const avant = parWorkflow.get(cle);
    const plusRecente = !avant || Date.parse(r.created_at || 0) > Date.parse(avant.created_at || 0) || (r.created_at === avant.created_at && (r.run_number || 0) > (avant.run_number || 0));
    if (plusRecente) parWorkflow.set(cle, r);
  }
  const derniers = [...parWorkflow.values()];
  const controles = derniers.map((r) => ({ nom: nomRun(r), chemin: cheminRun(r), statut: r.status, conclusion: r.conclusion || null, lien: r.html_url || null }));
  const serveur = derniers.find((r) => cheminRun(r) === requis);
  const enCours = derniers.filter((r) => r.status !== "completed");
  const rates = derniers.filter((r) => r.status === "completed" && !ACCEPTEES.has(r.conclusion));
  if (rates.length) {
    return { verdict: "echec", raison: `contrôles en échec : ${rates.map((r) => `${nomRun(r)} (${r.conclusion || "?"})`).join(", ")}`, controles };
  }
  if (!serveur) {
    const age = dateCommit ? maintenant - Date.parse(dateCommit) : 0;
    if (!Number.isFinite(age) || age < ATTENTE_CONTROLES_MS) {
      return { verdict: "attente", raison: `contrôles pas encore lancés (« ${NOM_WORKFLOW_REQUIS} » attendu)`, controles };
    }
    return { verdict: "aucun", raison: `aucun contrôle « ${NOM_WORKFLOW_REQUIS} » sur ce commit : pas d'installation`, controles };
  }
  if (enCours.length) {
    return { verdict: "attente", raison: `contrôles en cours : ${enCours.map(nomRun).join(", ")}`, controles };
  }
  if (serveur.conclusion !== "success") {
    return { verdict: "echec", raison: `« ${nomRun(serveur)} » n'a pas réussi (${serveur.conclusion || "?"})`, controles };
  }
  return { verdict: "ok", raison: `contrôles réussis : ${derniers.map(nomRun).join(", ")}`, controles };
}

// --- Réessais après un arrêt de l'installeur avant tout changement -----------------------

// Sauvegarde impossible, réseau coupé… : 15 min, 30, 1 h, 2 h, puis toutes les 6 h.
export const attenteApresArret = (n) => Math.min(6 * 3600_000, INTERVALLE_MIN * 60_000 * 2 ** Math.max(0, n - 1));

// --- Verrou ------------------------------------------------------------------------------

export function processusVivant(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Rend { ok: true, liberer } ou { ok: false, par, depuis }. Un verrou est
// périmé au bout de `peremptionMs`, ou si son processus n'existe plus (une
// installation à la main qui s'est arrêtée sur une erreur).
export function prendreVerrou(fichier, { pid = process.pid, par = "maj-auto", maintenant = Date.now(), peremptionMs = PEREMPTION_VERROU_MS, vivant = processusVivant } = {}) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  for (let essai = 0; essai < 2; essai++) {
    try {
      const fd = fs.openSync(fichier, "wx");
      fs.writeSync(fd, JSON.stringify({ pid, par, depuis: new Date(maintenant).toISOString() }));
      fs.closeSync(fd);
      return {
        ok: true,
        liberer() {
          const v = lireJSON(fichier);
          if (v?.pid === pid) fs.rmSync(fichier, { force: true });
        },
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const v = lireJSON(fichier, {});
      let depuis = Date.parse(v?.depuis);
      if (!Number.isFinite(depuis)) {
        try {
          depuis = fs.statSync(fichier).mtimeMs;
        } catch {
          depuis = 0;
        }
      }
      const perime = maintenant - depuis > peremptionMs || !vivant(Number(v?.pid));
      if (!perime || essai) return { ok: false, par: v?.par || "?", depuis: new Date(depuis).toISOString(), pid: v?.pid ?? null };
      fs.rmSync(fichier, { force: true });
    }
  }
  return { ok: false, par: "?", depuis: null };
}

// --- Journal -----------------------------------------------------------------------------

// Jamais de secret : on n'y écrit que des commits, des états et des phrases
// faites ici. Par prudence, tout ce qui ressemble à « CLE=valeur » est masqué.
export function masquerSecrets(texte) {
  return String(texte ?? "")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|CLE|SECRET|TOKEN|JETON|PASSWORD|HASH|PASS)[A-Z0-9_]*)\s*[=:]\s*\S+/gi, "$1=[masqué]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, "[masqué]")
    .replace(/remy_session=[^;\s]+/gi, "remy_session=[masqué]");
}

export function journaliser(fichier, texte, maintenant = Date.now()) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const ligne = `${new Date(maintenant).toISOString()} ${masquerSecrets(texte).replace(/\s*\n\s*/g, " ").slice(0, 400)}\n`;
  fs.appendFileSync(fichier, ligne);
  try {
    const lignes = fs.readFileSync(fichier, "utf8").split("\n").filter(Boolean);
    if (lignes.length > JOURNAL_MAX_LIGNES) fs.writeFileSync(fichier, lignes.slice(-JOURNAL_MAX_LIGNES).join("\n") + "\n");
  } catch {}
}

export function lireJournal(fichier, n = 10) {
  try {
    return fs.readFileSync(fichier, "utf8").split("\n").filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

// Les variables de remy.env (leurs NOMS) : l'installeur appelé par la tâche ne
// doit pas les recevoir de l'environnement du script — il relit lui-même
// remy.env, comme lancé à la main.
export function nomsDansEnv(contenu) {
  return String(contenu || "")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter(Boolean);
}
export function envSans(env, noms) {
  const retirer = new Set(noms.map((n) => n.toUpperCase()));
  return Object.fromEntries(Object.entries(env).filter(([k]) => !retirer.has(k.toUpperCase())));
}

// --- Session pour parler à Rémy ----------------------------------------------------------

// Un jeton signé comme les sessions de lib/auth.js, mais de PORTÉE réduite :
// 60 secondes, accepté seulement pour GET /api/maj-auto, GET /api/version,
// POST et DELETE /api/maj-auto/ceder (la pause du fond, plafonnée à 45 min
// d'affilée) ; lib/auth.js le refuse partout ailleurs (testé). Le script a
// remy.env, donc SESSION_SECRET : il n'apprend rien de plus.
export const PORTEE = "maj-auto";
export function jetonSession(env = process.env, maintenant = Date.now(), dureeMs = 60_000) {
  const s = env.SESSION_SECRET || env.APP_PASSWORD_HASH || env.APP_PASSWORD || "dev-only";
  const cle = crypto.createHash("sha256").update("remy-session:" + s).digest();
  const payload = Buffer.from(JSON.stringify({ exp: maintenant + dureeMs, v: 1, portee: PORTEE })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", cle).update(payload).digest("base64url")}`;
}

// --- La vue pour Réglages ----------------------------------------------------------------

// Ce que GET /api/maj-auto rend (lib/maj-auto-serveur.js y ajoute l'occupation).
export function vueMajAuto({ tache = null, pause = null, etat = null, env = process.env, maintenant = Date.now() } = {}) {
  const active = Boolean(tache?.active);
  const enPause = Boolean(pause?.pause);
  const coupeeParLaTour = env.REMY_MAJ_AUTO === "off";
  const passe = Date.parse(etat?.dernierePasse);
  const depuisActivation = Date.parse(tache?.depuis);
  const reference = Number.isFinite(passe) ? passe : depuisActivation;
  const retard = active && !enPause && !coupeeParLaTour && Number.isFinite(reference) && maintenant - reference > 4 * INTERVALLE_MIN * 60_000;
  const d = etat?.derniere;
  return {
    active,
    depuis: tache?.depuis || null,
    pause: enPause,
    pauseDepuis: enPause ? pause?.depuis || null : null,
    coupeeParLaTour,
    intervalleMin: tache?.intervalleMin || INTERVALLE_MIN,
    dernierePasse: Number.isFinite(passe) ? new Date(passe).toISOString() : null,
    etat: etat?.etat || null,
    message: etat?.message || null,
    installe: etat?.installe ? court(etat.installe) : null,
    derniere: d ? { commit: court(d.commit), date: d.date || null, resultat: d.resultat || null, raison: d.raison || null, retour: d.retour || null } : null,
    retard,
    // Occupé sans relâche depuis plus de 6 h : signalé (une activité qui ne
    // finit jamais retiendrait les mises à jour sans que personne le voie).
    occupeDepuis: etat?.etat === "occupe" ? etat?.occupeDepuis || null : null,
    // Ce qui retient VRAIMENT (12/11 : le fond ne retient plus, il cède).
    occupePar: etat?.etat === "occupe" && Array.isArray(etat?.occupePar) ? etat.occupePar.slice(0, 5) : [],
    occupeLongtemps: etat?.etat === "occupe" && Number.isFinite(Date.parse(etat?.occupeDepuis)) && maintenant - Date.parse(etat.occupeDepuis) > OCCUPE_SIGNALE_MS,
  };
}

// --- Le passage --------------------------------------------------------------------------

const heureCourte = (ms) => (!Number.isFinite(ms) ? "?" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: process.env.REMY_TZ || "Europe/Paris" }).format(new Date(ms)));

// `d` : ce qu'il faut pour un passage, tout injecté.
//   env, maintenant(), etat: { lire(), ecrire(e) }, journal(texte), pause() → { pause } | null,
//   git: { origine(), head(), estAncetre(a, b) → true | false | null, revenirA(sha) },
//   github: { dernierCommit() → { sha, date }, executions(sha) → runs },
//   remy: { occupation() → { joignable, occupe, raisons }, ceder()? → la même chose, fond mis en pause,
//           reprendre()?, versionServie() → commit court | null },
//   installer(sha, { retour }) → { code, raison }, attendre(ms), aBlanc
// Rend l'état écrit (et ce qui aurait été fait, à blanc).
export async function passer(d) {
  const t = d.maintenant();
  const avant = d.etat.lire() || {};
  const etat = { version: 1, refuses: {}, essais: {}, ...avant };
  const attendu = depotAttendu(d.env);

  const fin = (nom, message, extra = {}) => {
    const suivant = { ...etat, ...extra, etat: nom, message, dernierePasse: new Date(t).toISOString() };
    suivant.occupeDepuis = nom === "occupe" ? (avant.etat === "occupe" && avant.occupeDepuis) || new Date(t).toISOString() : null;
    if (nom !== "occupe") suivant.occupePar = null;
    // Le journal ne garde que les changements (pas 96 lignes « à jour » par jour).
    const cle = `${nom}|${suivant.candidat || ""}|${suivant.installe || ""}`;
    if (!d.aBlanc) {
      if (cle !== avant.cleJournal || extra.journaliser) d.journal(message);
      suivant.cleJournal = cle;
      delete suivant.journaliser;
      d.etat.ecrire(suivant);
    }
    return { ...suivant, journaliser: undefined };
  };

  if (d.env.REMY_MAJ_AUTO === "off") return fin("coupee", "Mise à jour automatique coupée sur la tour (REMY_MAJ_AUTO=off dans remy.env).");
  const pause = d.pause();
  if (pause?.pause) return fin("pause", `En pause${pause.par === "app" ? " depuis l'app" : ""} : rien n'est installé.`);
  if (etat.limiteJusqua && t < Date.parse(etat.limiteJusqua)) {
    return fin("limite-github", `Limite de l'API de GitHub atteinte : nouvel essai après ${heureCourte(Date.parse(etat.limiteJusqua))}.`);
  }

  const origine = await d.git.origine();
  if (!origine) return fin("sans-copie", "Pas de copie de production à mettre à jour (installe d'abord avec installer-tour.ps1 -Ref <commit>).");
  if (normaliserDepot(origine) !== normaliserDepot(attendu)) {
    return fin("depot-inattendu", `La copie de production suit ${normaliserDepot(origine)}, pas ${normaliserDepot(attendu)} : rien n'est installé.`);
  }
  const installe = await d.git.head();
  if (!installe) return fin("sans-copie", "Commit installé illisible (git rev-parse HEAD) : rien n'est installé.");
  // Un retour en arrière raté : on le redit à chaque passage (jamais « à
  // jour », jamais une autre installation), tant que Rémy ne sert pas
  // correctement le commit de la copie ou qu'une installation à la main n'a pas
  // mis la copie ailleurs.
  const re = etat.retourEchoue;
  if (re && (installe === re.candidat || installe === re.precedent)) {
    const servi = await d.remy.versionServie(null, { essais: 1 });
    if (!servi || !installe.startsWith(servi)) {
      return fin("retour-echoue", `Le retour automatique à ${court(re.precedent)} a échoué le ${String(re.date || "").slice(0, 10) || "?"} (${re.raison}) après le refus de ${court(re.candidat)} : la copie est sur ${court(installe)} et Rémy ne l'annonce pas. Sur la tour, PowerShell administrateur : scripts\\installer-tour.ps1 -Ref ${re.precedent}`, { installe });
    }
  }
  if (re) etat.retourEchoue = null;

  let candidat;
  try {
    candidat = await d.github.dernierCommit(etat.github || null);
  } catch (err) {
    if (err?.limite) {
      return fin("limite-github", `Limite de l'API de GitHub atteinte : nouvel essai après ${heureCourte(err.reprise)}.`, { limiteJusqua: new Date(err.reprise).toISOString(), installe });
    }
    return fin("erreur-github", `GitHub injoignable (${String(err?.message || err).slice(0, 120)}) : nouvel essai au prochain passage.`, { installe });
  }
  const base = { installe, candidat: candidat.sha, limiteJusqua: null, github: candidat.etag ? { etag: candidat.etag, sha: candidat.sha, date: candidat.date } : null };
  if (candidat.sha === installe) return fin("a-jour", `À jour : ${court(installe)} est le dernier commit de ${BRANCHE}.`, { ...base, candidat: null, injoignable: 0, essais: {} });

  const refus = etat.refuses?.[candidat.sha];
  if (refus) return fin("refuse", `${court(candidat.sha)} a été refusé le ${refus.date?.slice(0, 10) || "?"} (${refus.raison}) : pas retenté. Le prochain commit de ${BRANCHE} le sera.`, base);

  const enAvant = await d.git.estAncetre(installe, candidat.sha);
  if (enAvant === null) return fin("erreur-git", `Impossible de comparer ${court(installe)} et ${court(candidat.sha)} (git fetch) : nouvel essai au prochain passage.`, base);
  if (!enAvant) {
    return fin("pas-en-avant", `${court(installe)} (installé) n'est pas un ancêtre de ${court(candidat.sha)} (${BRANCHE}) : jamais de retour en arrière automatique. Installe un commit de ${BRANCHE} à la main pour reprendre.`, base);
  }

  let runs;
  try {
    runs = await d.github.executions(candidat.sha);
  } catch (err) {
    if (err?.limite) {
      return fin("limite-github", `Limite de l'API de GitHub atteinte : nouvel essai après ${heureCourte(err.reprise)}.`, { ...base, limiteJusqua: new Date(err.reprise).toISOString() });
    }
    return fin("erreur-github", `Contrôles de ${court(candidat.sha)} illisibles (${String(err?.message || err).slice(0, 120)}) : nouvel essai au prochain passage.`, base);
  }
  const c = evaluerControles(runs, { sha: candidat.sha, depot: attendu, dateCommit: candidat.date, maintenant: t });
  if (c.verdict === "attente") return fin("attente-controles", `${court(candidat.sha)} attend ses contrôles (${c.raison}).`, base);
  if (c.verdict === "aucun") return fin("sans-controles", `${court(candidat.sha)} : ${c.raison}.`, base);
  if (c.verdict === "echec") return fin("controles-en-echec", `${court(candidat.sha)} n'est pas installé : ${c.raison}.`, base);

  const essai = etat.essais?.[candidat.sha];
  if (essai?.prochain && t < Date.parse(essai.prochain)) {
    return fin("attente-reessai", `${court(candidat.sha)} : l'installeur s'était arrêté avant tout changement (${essai.raison}) ; nouvel essai après ${heureCourte(Date.parse(essai.prochain))}.`, base);
  }

  // Le fond cède la place (12/11) : avant de juger, il se met en pause ;
  // seul ce qui est demandé (ou une sauvegarde qui écrit) retient l'installation.
  const occ = !d.aBlanc && d.remy.ceder ? await d.remy.ceder() : await d.remy.occupation();
  // Le fond a déjà cédé 45 min d'affilée : il rattrape son retard (30 min) ;
  // la mise à jour est remise au passage suivant, et Réglages dit pourquoi.
  if (occ.joignable && occ.rattrapage) {
    return fin("rattrapage", `${occ.raisons?.[0] || "Le travail de fond rattrape son retard"} (${court(candidat.sha)} au passage suivant).`, { ...base, injoignable: 0 });
  }
  if (occ.joignable && occ.occupe) {
    return fin("occupe", `Rémy travaille (${(occ.raisons || []).join(", ") || "occupé"}) : ${court(candidat.sha)} attendra le prochain passage.`, { ...base, injoignable: 0, occupePar: (occ.raisons || []).slice(0, 5) });
  }
  const injoignable = occ.joignable ? 0 : (etat.injoignable || 0) + 1;
  if (!occ.joignable && injoignable < INJOIGNABLE_AVANT_INSTALLATION) {
    return fin("injoignable", `Rémy ne répond pas : ${court(candidat.sha)} attendra un passage de plus.`, { ...base, injoignable });
  }

  if (d.aBlanc) return fin("installerait", `À blanc : installerait ${court(candidat.sha)} (${c.raison}).`, { ...base, injoignable });

  d.journal(`${court(candidat.sha)} : installation (${c.raison}) ; version d'avant ${court(installe)}.`);
  d.etat.ecrire({ ...etat, ...base, etat: "en-cours", message: `Installation de ${court(candidat.sha)} en cours.`, dernierePasse: new Date(t).toISOString(), injoignable });

  const r = await d.installer(candidat.sha, { retour: false });
  const quand = new Date(d.maintenant()).toISOString();
  // Rien n'a changé (occupé, ou arrêté avant tout changement) : Rémy tourne
  // toujours, son fond reprend sans attendre la fin du bail.
  if (r.code === CODE_OCCUPE) {
    if (d.remy.reprendre) await d.remy.reprendre();
    return fin("occupe", `Rémy s'est mis au travail pendant la sauvegarde : rien n'a été changé, ${court(candidat.sha)} attendra le prochain passage.`, { ...base, injoignable: 0, journaliser: true });
  }
  const apres = await d.git.head();
  if (r.code !== 0 && apres === installe && d.remy.reprendre) await d.remy.reprendre();
  const servi = r.code === 0 ? await d.remy.versionServie(candidat.sha) : await d.remy.versionServie(null, { essais: 1 });
  const ok = r.code === 0 && servi && candidat.sha.startsWith(servi);
  if (ok) {
    return fin("installe", `${court(candidat.sha)} installé et vérifié (/api/version), à la place de ${court(installe)}.`, {
      ...base, installe: candidat.sha, candidat: null, injoignable: 0, essais: {},
      derniere: { commit: candidat.sha, date: quand, resultat: "reussie", raison: null, precedent: installe }, journaliser: true,
    });
  }
  if (r.code !== 0 && apres === installe) {
    const n = (essai?.n || 0) + 1;
    const raison = String(r.raison || `installeur arrêté (code ${r.code})`).slice(0, 200);
    const prochain = new Date(d.maintenant() + attenteApresArret(n)).toISOString();
    return fin("annulee", `Installation de ${court(candidat.sha)} annulée avant tout changement : ${raison}. Nouvel essai après ${heureCourte(Date.parse(prochain))}.`, {
      ...base, injoignable: 0,
      essais: { ...(etat.essais || {}), [candidat.sha]: { n, prochain, raison } },
      derniere: { commit: candidat.sha, date: quand, resultat: "annulee", raison, precedent: installe }, journaliser: true,
    });
  }

  // La nouvelle version ne répond pas comme attendu : retour à la précédente.
  const raison = r.code !== 0
    ? `installeur arrêté (${String(r.raison || `code ${r.code}`).slice(0, 160)})`
    : servi ? `/api/version annonce ${court(servi)}, pas ${court(candidat.sha)}` : "/api/version ne répond pas";
  d.journal(`${court(candidat.sha)} : ${raison} — retour automatique à ${court(installe)}.`);
  let retourOk = false;
  let raisonRetour = null;
  try {
    await d.git.revenirA(installe);
    const rr = await d.installer(installe, { retour: true });
    const serviRetour = rr.code === 0 ? await d.remy.versionServie(installe) : null;
    retourOk = rr.code === 0 && Boolean(serviRetour) && installe.startsWith(serviRetour);
    if (!retourOk) raisonRetour = rr.code !== 0 ? String(rr.raison || `code ${rr.code}`).slice(0, 160) : "/api/version n'annonce pas la version d'avant";
  } catch (err) {
    raisonRetour = String(err?.message || err).slice(0, 160);
  }
  const refuses = Object.fromEntries(
    Object.entries({ ...(etat.refuses || {}), [candidat.sha]: { date: quand, raison } })
      .sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)))
      .slice(0, REFUS_GARDES),
  );
  const commun = { ...base, refuses, injoignable: 0, derniere: { commit: candidat.sha, date: quand, resultat: "annulee", raison, precedent: installe, retour: retourOk ? "reussi" : "echoue" }, journaliser: true };
  if (retourOk) {
    return fin("annulee", `${court(candidat.sha)} annulé (${raison}) : retour automatique à ${court(installe)} réussi. ${court(candidat.sha)} ne sera pas retenté.`, { ...commun, installe });
  }
  return fin("retour-echoue", `${court(candidat.sha)} annulé (${raison}) et le retour à ${court(installe)} a échoué (${raisonRetour}) : Rémy est peut-être arrêté. Sur la tour, PowerShell administrateur : scripts\\installer-tour.ps1 -Ref ${installe}`, {
    ...commun, installe: apres || installe,
    retourEchoue: { candidat: candidat.sha, precedent: installe, date: quand, raison: raisonRetour },
  });
}

// --- Les clients (fetch injecté : les tests passent un faux GitHub) --------------------------

// L'API publique de GitHub, sans jeton : 60 requêtes par heure et par adresse.
// Un passage en fait 1 (à jour) ou 2 (un commit à juger) ; 4 passages par heure.
export function clientGitHub({ depot = DEPOT_ATTENDU, api = API_GITHUB, env = process.env, fetch: f = globalThis.fetch, delaiMs = 15_000, maintenant = Date.now } = {}) {
  // Hors essai, seulement la vraie API, en HTTPS.
  if (String(api).replace(/\/+$/, "") !== API_GITHUB && !enEssai(env)) throw new Error(`API de GitHub refusée : ${api} (seule ${API_GITHUB} est permise)`);
  const { proprietaire, nom } = depotGitHub(depot);
  const racine = `${String(api).replace(/\/+$/, "")}/repos/${proprietaire}/${nom}`;
  const lire = async (chemin, { etag = null, brut = false } = {}) => {
    const r = await f(`${racine}${chemin}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "remy-maj-auto", "X-GitHub-Api-Version": "2022-11-28", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: AbortSignal.timeout(delaiMs),
    });
    // 304 : rien n'a changé (et la requête ne compte pas dans la limite).
    if (brut && r.status === 304) return { pasChange: true };
    const reste = r.headers.get("x-ratelimit-remaining");
    if ((r.status === 403 || r.status === 429) && (reste === "0" || r.headers.get("retry-after"))) {
      const apres = Number(r.headers.get("retry-after")) * 1000;
      const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000;
      const e = new Error("limite de l'API de GitHub atteinte");
      e.limite = true;
      e.reprise = apres > 0 ? maintenant() + apres : reset > 0 ? reset : maintenant() + 3600_000;
      throw e;
    }
    if (!r.ok) throw new Error(`GitHub répond ${r.status}`);
    const corps = await r.json();
    return brut ? { corps, etag: r.headers.get("etag") } : corps;
  };
  return {
    // `cache` : { etag, sha, date } du passage d'avant (If-None-Match).
    async dernierCommit(cache = null) {
      const avecEtag = cache?.etag && /^[0-9a-f]{40}$/.test(String(cache.sha)) ? cache.etag : null;
      const r = await lire(`/commits/${BRANCHE}`, { etag: avecEtag, brut: true });
      if (r.pasChange) return { sha: cache.sha, date: cache.date || null, etag: cache.etag, pasChange: true };
      const c = r.corps;
      if (!/^[0-9a-f]{40}$/.test(String(c?.sha))) throw new Error("réponse de GitHub illisible");
      return { sha: c.sha, date: c.commit?.committer?.date || null, etag: r.etag || null };
    },
    async executions(sha) {
      if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error("commit illisible");
      const j = await lire(`/actions/runs?head_sha=${sha}&branch=${BRANCHE}&event=push&per_page=100`);
      return Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
    },
  };
}

// Rémy, sur la boucle locale, avec un jeton de session signé par SESSION_SECRET.
export function clientRemy({ url, env = process.env, fetch: f = globalThis.fetch, attendre = (ms) => new Promise((r) => setTimeout(r, ms)), delaiMs = 20_000, pauseMs = 2_000 } = {}) {
  const enTetes = () => ({ Cookie: `remy_session=${jetonSession(env)}`, Accept: "application/json" });
  return {
    // { joignable, occupe, raisons }. Une réponse illisible compte pour
    // « occupé » : dans le doute, on ne coupe pas Rémy.
    async occupation() {
      let r;
      try {
        r = await f(`${url}/api/maj-auto`, { headers: enTetes(), signal: AbortSignal.timeout(delaiMs) });
      } catch (err) {
        return { joignable: false, occupe: false, raisons: [], erreur: String(err?.message || err) };
      }
      if (r.status === 404) return { joignable: true, occupe: false, raisons: [] };
      if (!r.ok) return { joignable: true, occupe: true, raisons: [`état illisible (HTTP ${r.status})`] };
      try {
        const v = await r.json();
        const o = v?.occupation;
        if (!o || typeof o.occupe !== "boolean") return { joignable: true, occupe: true, raisons: ["état illisible"] };
        return { joignable: true, occupe: o.occupe, raisons: Array.isArray(o.raisons) ? o.raisons : [] };
      } catch {
        return { joignable: true, occupe: true, raisons: ["réponse non JSON"] };
      }
    },
    // Le fond se met en pause avant une installation (12/11, « le travail de
    // fond cède la place ») ; rend l'occupation qui reste (la même forme).
    // Une tour d'avant (404) : l'occupation d'avant, sans rien demander.
    async ceder() {
      let r;
      try {
        r = await f(`${url}/api/maj-auto/ceder`, { method: "POST", headers: enTetes(), signal: AbortSignal.timeout(delaiMs) });
      } catch (err) {
        return { joignable: false, occupe: false, raisons: [], erreur: String(err?.message || err) };
      }
      if (r.status === 404 || r.status === 405) return this.occupation();
      // Plafond de la pause atteint : le fond rattrape son retard, on repasse.
      if (r.status === 409) {
        const j = await r.json().catch(() => null);
        if (j?.error === "pause_plafonnee") {
          return { joignable: true, occupe: true, rattrapage: true, reprise: j.reprise || null, raisons: [String(j.message || "le travail de fond rattrape son retard").slice(0, 200)] };
        }
      }
      if (!r.ok) return { joignable: true, occupe: true, raisons: [`état illisible (HTTP ${r.status})`] };
      try {
        const o = (await r.json())?.occupation;
        if (!o || typeof o.occupe !== "boolean") return { joignable: true, occupe: true, raisons: ["état illisible"] };
        return { joignable: true, occupe: o.occupe, raisons: Array.isArray(o.raisons) ? o.raisons : [] };
      } catch {
        return { joignable: true, occupe: true, raisons: ["réponse non JSON"] };
      }
    },
    // La mise à jour n'a pas eu lieu : le fond reprend tout de suite (sinon,
    // au bout de son bail de 20 min). Sans conséquence si Rémy ne répond pas.
    async reprendre() {
      try {
        const r = await f(`${url}/api/maj-auto/ceder`, { method: "DELETE", headers: enTetes(), signal: AbortSignal.timeout(delaiMs) });
        return r.ok;
      } catch {
        return false;
      }
    },
    // Le commit (court) que /api/version annonce, attendu jusqu'à `essais` fois ;
    // null si Rémy ne répond pas.
    async versionServie(attendu = null, { essais = 45 } = {}) {
      let vu = null;
      for (let i = 0; i < essais; i++) {
        try {
          const r = await f(`${url}/api/version`, { headers: enTetes(), signal: AbortSignal.timeout(5_000) });
          if (r.ok) {
            const v = await r.json();
            vu = typeof v?.commit === "string" && v.commit ? v.commit : null;
            if (!attendu || (vu && String(attendu).startsWith(vu))) return vu;
          }
        } catch {}
        if (i < essais - 1) await attendre(pauseMs);
      }
      return vu;
    },
  };
}
