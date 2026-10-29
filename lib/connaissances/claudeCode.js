// Lecture STRICTEMENT SEULE des sessions Claude Code (lot B du 19/10, repris
// le 29/10 pour les conversations externes).
//
// Où : <racine>/projects/<dossier>/<sessionId>.jsonl. Les racines, dans
// l'ordre : CLAUDE_CONFIG_DIR, REMY_CLAUDE_DIRS (des dossiers en plus, séparés
// par « ; » — une distribution WSL : \\wsl.localhost\Ubuntu\home\sam\.claude),
// puis le dossier de l'utilisateur (%USERPROFILE%\.claude sous Windows, que
// Rémy trouve seul : la tâche planifiée tourne sous ton compte). Une ligne = un
// enregistrement JSON (user, assistant, system, summary, custom-title…). Le
// fichier grandit par ajouts : on garde un curseur (octet lu, taille,
// empreinte des derniers octets) pour ne relire que la suite. Rien n'est
// jamais écrit chez Claude Code.
//
// Ce qui devient un message (le dialogue, masqué) :
//   - utilisateur : son texte tapé (fil principal, ni méta, ni résumé, ni
//     commande, ni résultat d'outil) ; un long collage devient « collé » ;
//   - assistant : ses blocs de texte (jamais la réflexion, jamais les appels
//     ou résultats d'outils, qui restent dans la session d'origine) ;
//   - résumé : un résumé de compaction (ne vaut jamais déclaration).
// Les sous-agents (isSidechain) ne sont pas ingérés : leur résultat est déjà
// dans le fil principal. Les sessions lancées par d'autres programmes en mode
// « claude -p » (sdk-cli : Rémy lui-même, titres de T3…) sont exclues.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { masquer } from "./masquage.js";

export const LIGNE_MAX = 4 * 1024 * 1024;
const COLLE_MIN = 2500; // au-delà, un message utilisateur est un collage (code, mail…)
const TEXTE_MAX = 12_000;
const ENTREES_EXCLUES = new Set(["sdk-cli"]);

// « a;b » (et « a:b » hors Windows, où « : » est celui du lecteur) → [a, b].
export function listeChemins(v) {
  return String(v || "")
    .split(process.platform === "win32" ? /[;\n]/ : /[;:\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Les racines candidates, avec leur origine (pour dire où Rémy a cherché).
export function racinesCandidates() {
  const r = [];
  if (process.env.CLAUDE_CONFIG_DIR) r.push({ chemin: process.env.CLAUDE_CONFIG_DIR, origine: "CLAUDE_CONFIG_DIR" });
  for (const c of listeChemins(process.env.REMY_CLAUDE_DIRS)) r.push({ chemin: c, origine: "REMY_CLAUDE_DIRS" });
  r.push({ chemin: path.join(os.homedir(), ".claude"), origine: "dossier de l'utilisateur" });
  const vus = new Set();
  return r
    .map((x) => ({ ...x, chemin: path.resolve(x.chemin) }))
    .filter((x) => (vus.has(x.chemin) ? false : vus.add(x.chemin)));
}

export function racines() {
  return racinesCandidates()
    .map((x) => x.chemin)
    .filter((x) => fs.existsSync(path.join(x, "projects")));
}

// Les fichiers de session (sous-agents et workflows exclus : ils vivent dans
// un sous-dossier <sessionId>/).
export function fichiersDeSession(racine) {
  const base = path.join(racine, "projects");
  const sortie = [];
  let dossiers = [];
  try {
    dossiers = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return sortie;
  }
  for (const d of dossiers) {
    let fichiers = [];
    try {
      fichiers = fs.readdirSync(path.join(base, d.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of fichiers) {
      if (f.isFile() && f.name.endsWith(".jsonl")) sortie.push(path.join(base, d.name, f.name));
    }
  }
  return sortie;
}

// Un cwd ramené à une forme stable : minuscules, « / », sans « / » final,
// /mnt/c/… (WSL) → c:/…, et un worktree de T3 Code ramené à son dépôt.
export function normaliserCwd(cwd) {
  let c = String(cwd || "").normalize("NFC").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  c = c.replace(/^\/mnt\/([a-z])\//, "$1:/");
  const t3 = c.match(/^(.*\/\.t3\/worktrees\/[^/]+)/);
  if (t3) c = t3[1];
  return c;
}

// Nom lisible d'un projet : le dernier segment de son dossier.
export const nomProjet = (racineNormalisee) => racineNormalisee.split("/").filter(Boolean).pop() || racineNormalisee;
// Le même, avec ses majuscules d'origine (« Boutique Bougies », pas « boutique bougies »).
export const nomLisible = (cwd) => String(cwd || "").normalize("NFC").split(/[\\/]/).filter(Boolean).pop() || null;

// Une ligne démesurée (une capture d'écran collée : plusieurs Mo de base64)
// perdait aussi le texte tapé avec elle (contre-relecture du 29/10) : les
// longues suites base64 des champs « data » sont retirées au fil de l'eau,
// le reste de la ligne est gardé.
const BASE64_LONG = /"data"\s*:\s*"[A-Za-z0-9+/=_-]{256,}/g;
export function alleger(buf) {
  const s = buf.toString("latin1");
  const t = s.replace(BASE64_LONG, '"data":"');
  return t.length === s.length ? buf : Buffer.from(t, "latin1");
}

function texteDesBlocs(contenu) {
  if (typeof contenu === "string") return { texte: contenu, outil: false };
  if (!Array.isArray(contenu)) return { texte: "", outil: false };
  const textes = [];
  let outil = false;
  for (const b of contenu) {
    if (b?.type === "text" && typeof b.text === "string") textes.push(b.text);
    else if (b?.type === "tool_result" || b?.type === "tool_use") outil = true;
  }
  return { texte: textes.join("\n\n"), outil };
}

// Messages produits par Claude Code lui-même, pas tapés par la personne.
const ENVELOPPES = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook|task-notification)\b/;
// « [Request interrupted by user] » (Échap) : Claude Code l'écrit, pas toi.
const INTERRUPTION = /^\s*\[Request interrupted by user[^\]]*\]\s*$/;

// Une ligne JSONL → un passage, ou null. `etat` porte ce qui vaut pour toute
// la session (cwd, entrypoint vus).
export function passageDe(rec, etat = {}) {
  if (!rec || typeof rec !== "object") return null;
  if (rec.cwd && !etat.cwd) etat.cwd = rec.cwd;
  if (rec.entrypoint && !etat.entrypoint) etat.entrypoint = rec.entrypoint;
  if (rec.sessionId && !etat.session) etat.session = String(rec.sessionId);
  // Le titre que tu as donné (/rename), sinon le résumé de Claude Code.
  if (rec.type === "custom-title" && typeof (rec.customTitle ?? rec.title) === "string") etat.titre = String(rec.customTitle ?? rec.title).slice(0, 200);
  if (rec.type === "summary" && typeof rec.summary === "string" && !etat.resume) etat.resume = rec.summary.slice(0, 200);
  if (rec.type !== "user" && rec.type !== "assistant") return null;
  if (rec.isSidechain) return null;
  if (!rec.uuid) return null;
  const { texte, outil } = texteDesBlocs(rec.message?.content);
  if (!texte.trim()) return null;
  let auteur;
  if (rec.type === "assistant") {
    auteur = "assistant";
  } else if (rec.isCompactSummary) {
    auteur = "resume";
  } else {
    if (rec.isMeta || outil) return null;
    const origine = rec.origin?.kind;
    if (origine && origine !== "human") return null;
    if (ENVELOPPES.test(texte) || INTERRUPTION.test(texte)) return null;
    auteur = texte.length >= COLLE_MIN ? "colle" : "utilisateur";
  }
  const { texte: propre, masques } = masquer(texte.length > TEXTE_MAX ? texte.slice(0, TEXTE_MAX) + " […]" : texte);
  return {
    uuid: String(rec.uuid),
    parent: rec.parentUuid ? String(rec.parentUuid) : null,
    session: String(rec.sessionId || ""),
    ts: Date.parse(rec.timestamp) || null,
    auteur,
    texte: propre,
    masques,
  };
}

// Session à ne pas lire : lancée par un programme (claude -p), pas par la personne.
export const sessionExclue = (etat) => ENTREES_EXCLUES.has(etat.entrypoint);

const empreinte = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

// Lit un fichier de session à partir d'un curseur. Rend les passages, le
// nouveau curseur et des compteurs. `curseur` : { ino, offset, taille, empreinte } ou null.
// Si le fichier a été remplacé ou raccourci, la lecture repart du début (`relu`).
export async function lireSession(fichier, curseur, { cede = () => new Promise((r) => setImmediate(r)) } = {}) {
  const st = fs.statSync(fichier, { bigint: true });
  const ino = String(st.ino);
  const taille = Number(st.size);
  let depart = 0;
  let relu = false;
  const fd = fs.openSync(fichier, "r");
  try {
    if (curseur && curseur.ino === ino && curseur.offset <= taille && curseur.offset > 0) {
      const n = Math.min(4096, curseur.offset);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, curseur.offset - n);
      if (empreinte(buf) === curseur.empreinte) depart = curseur.offset;
      else relu = true;
    } else if (curseur && curseur.offset > 0) {
      relu = true;
    }
    const etat = { ...(depart > 0 ? curseur.etat || {} : {}) };
    const passages = [];
    const compte = { lignes: 0, illisibles: 0, tropGrosses: 0, masques: 0 };
    let pos = depart;
    let reste = Buffer.alloc(0);
    let fin = depart; // fin de la dernière ligne complète
    const morceau = Buffer.alloc(1024 * 1024);
    let ignorerJusquaFinDeLigne = false;
    while (pos < taille) {
      const lus = fs.readSync(fd, morceau, 0, Math.min(morceau.length, taille - pos), pos);
      if (lus <= 0) break;
      pos += lus;
      let donnees = Buffer.concat([reste, morceau.subarray(0, lus)]);
      let debut = 0;
      let i;
      let trouve = false;
      while ((i = donnees.indexOf(10, debut)) !== -1) {
        trouve = true;
        const ligne = donnees.subarray(debut, i);
        debut = i + 1;
        if (ignorerJusquaFinDeLigne) {
          ignorerJusquaFinDeLigne = false;
        } else {
          compte.lignes++;
          // Des octets nuls en tête : la fin d'un fichier coupé net (coupure de
          // courant), puis la reprise de Claude Code à la suite.
          let k = 0;
          while (k < ligne.length && ligne[k] === 0) k++;
          const utile = k ? ligne.subarray(k) : ligne;
          if (utile.length) {
            let rec = null;
            try {
              rec = JSON.parse((utile.length > 256 * 1024 ? alleger(utile) : utile).toString("utf8"));
            } catch {
              compte.illisibles++;
            }
            const p = passageDe(rec, etat);
            if (p) {
              compte.masques += p.masques;
              passages.push(p);
            }
          }
        }
        if (compte.lignes % 500 === 0) await cede();
      }
      reste = donnees.subarray(debut);
      // La fin de la dernière ligne complète (le reste, allégé, ne compte plus
      // ses octets d'origine : on ne s'y fie que juste après un retour à la ligne).
      if (trouve) fin = pos - reste.length;
      if (reste.length > LIGNE_MAX) reste = alleger(reste);
      if (reste.length > LIGNE_MAX) {
        // Ligne démesurée (image, gros résultat d'outil) : sautée jusqu'à sa fin.
        compte.tropGrosses++;
        reste = Buffer.alloc(0);
        ignorerJusquaFinDeLigne = true;
      }
    }
    // Une dernière ligne sans retour à la ligne est en cours d'écriture : elle
    // sera relue au prochain passage.
    const n = Math.min(4096, fin);
    const buf = Buffer.alloc(n);
    if (n) fs.readSync(fd, buf, 0, n, fin - n);
    return {
      passages,
      etat,
      exclue: sessionExclue(etat),
      relu,
      compte,
      curseur: { ino, offset: fin, taille, empreinte: empreinte(buf), etat: { cwd: etat.cwd, entrypoint: etat.entrypoint, session: etat.session } },
    };
  } finally {
    fs.closeSync(fd);
  }
}
