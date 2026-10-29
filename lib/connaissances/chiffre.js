// Le chiffrement au repos des conversations externes (29/10).
//
// Ce que lit Rémy (sessions Claude Code, fils de T3 Code, export ChatGPT) est
// rangé dans <base>/connaissances.db, dans le coffre — un dossier qui peut être
// copié, sauvegardé ou synchronisé. Rien n'y est donc en clair :
//
//   - chaque texte (message, titre, aperçu, nom et dossier de projet, résumé
//     de la nuit) est chiffré en AES-256-GCM, avec un vecteur neuf par texte et
//     sa place (source, conversation, message) en données associées : un texte
//     déplacé d'une ligne à l'autre ne se déchiffre plus ;
//   - l'index de recherche ne contient que des EMPREINTES de mots (HMAC-SHA256
//     avec une seconde clé, tronquées), sans positions (FTS5 « detail=none ») :
//     on retrouve les messages qui contiennent un mot, on ne relit pas le texte.
//
// La clé : REMY_CONVERSATIONS_CLE (64 caractères hexadécimaux) si elle est posée
// dans remy.env, sinon le fichier `conversations.cle` de REMY_CLES_DIR (par
// défaut %USERPROFILE%\.remy, à côté de remy.env, HORS du coffre), créé au
// premier usage et jamais réécrit. Sans elle, la base est illisible : on la
// vide et on relit les sources (les sessions d'origine ne sont pas touchées ;
// un export ChatGPT se réimporte).
//
// Ce qui reste visible sans la clé (dit dans l'état, jamais caché) : le nombre
// de conversations et de messages, leurs dates et tailles, les identifiants
// techniques (UUID de session) et, pour l'index, quels messages partagent une
// même empreinte de mot.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const NOM_FICHIER_CLE = "conversations.cle";
const ENTETE = Buffer.from([0x52, 0x43, 0x31]); // « RC1 » : version du format

export const dossierCles = () => process.env.REMY_CLES_DIR || path.join(os.homedir(), ".remy");
export const fichierCle = () => path.join(dossierCles(), NOM_FICHIER_CLE);

let cache = null; // { cleHex, chiffrement, index, controle, origine }

export function oublierCle() {
  cache = null;
}

function deriver(maitre, usage) {
  return Buffer.from(crypto.hkdfSync("sha256", maitre, Buffer.alloc(0), Buffer.from(`remy-conversations:${usage}`), 32));
}

// Lit (ou crée une fois) la clé maîtresse. `creer` : faux pour une simple
// lecture d'état (ne jamais créer de fichier pour répondre « coupé »).
export function cles({ creer = true } = {}) {
  const env = String(process.env.REMY_CONVERSATIONS_CLE || "").trim();
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error("REMY_CONVERSATIONS_CLE doit faire 64 caractères hexadécimaux");
    if (cache?.cleHex === env.toLowerCase()) return cache;
    return (cache = construire(env.toLowerCase(), "remy.env"));
  }
  const f = fichierCle();
  let hex = null;
  try {
    hex = fs.readFileSync(f, "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Clé des conversations illisible (${err.code || err.message})`);
  }
  if (!hex) {
    if (!creer) return null;
    hex = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try {
      // « wx » : jamais par-dessus une clé existante (deux processus au démarrage).
      fs.writeFileSync(f, hex + "\n", { mode: 0o600, flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      hex = fs.readFileSync(f, "utf8").trim();
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`Clé des conversations invalide dans ${NOM_FICHIER_CLE} (64 caractères hexadécimaux attendus)`);
  if (cache?.cleHex === hex.toLowerCase()) return cache;
  return (cache = construire(hex.toLowerCase(), "fichier"));
}

function construire(hex, origine) {
  const maitre = Buffer.from(hex, "hex");
  const chiffrement = deriver(maitre, "chiffrement");
  const index = deriver(maitre, "index");
  const controle = crypto.createHmac("sha256", deriver(maitre, "controle")).update("remy-conversations-v1").digest("hex").slice(0, 32);
  return { cleHex: hex, chiffrement, index, controle, origine };
}

// Un texte → BLOB (en-tête, vecteur, étiquette, chiffré). `place` : les données
// associées (ex. « claude-code:session:uuid »).
export function chiffrer(texte, place = "") {
  const k = cles();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k.chiffrement, iv);
  c.setAAD(Buffer.from(String(place)));
  const ct = Buffer.concat([c.update(String(texte ?? ""), "utf8"), c.final()]);
  return Buffer.concat([ENTETE, iv, c.getAuthTag(), ct]);
}

export function dechiffrer(blob, place = "") {
  if (blob == null) return null;
  const b = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (b.length < 31 || !b.subarray(0, 3).equals(ENTETE)) throw Object.assign(new Error("Texte chiffré illisible"), { code: "CHIFFRE_ILLISIBLE" });
  const k = cles();
  const d = crypto.createDecipheriv("aes-256-gcm", k.chiffrement, b.subarray(3, 15));
  d.setAAD(Buffer.from(String(place)));
  d.setAuthTag(b.subarray(15, 31));
  return Buffer.concat([d.update(b.subarray(31)), d.final()]).toString("utf8");
}

// Déchiffre sans jamais lever : null si la clé ne va pas (base d'une autre clé).
export function dechiffrerOuNull(blob, place = "") {
  try {
    return dechiffrer(blob, place);
  } catch {
    return null;
  }
}

// --- L'index aveugle -------------------------------------------------------------

// Mots trop courants pour aider une recherche (et trop fréquents : leurs
// empreintes trahiraient la structure des phrases).
const VIDES = new Set(
  (
    "le la les un une des du de d l au aux et ou en a à est sont été être avoir ai as avons avez ont ce cet cette ces " +
    "je tu il elle on nous vous ils elles me te se mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs " +
    "que qui quoi dont où pour par sur sous dans avec sans pas ne ni plus moins très tout tous toute toutes " +
    "mais donc car si alors comme aussi bien fait faire peut peux veux the of and or to in on for is are was be it this that " +
    "with as at by an from not no yes y c s n qu lui eux ça ca oui non va vais vas"
  ).split(/\s+/),
);

// « Déployée », « DEPLOYEES » → « deploye » : minuscules, sans accents, pluriel
// et « e » final ôtés (au-delà de 4 lettres).
export function normaliserMot(m) {
  let w = String(m || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae");
  if (w.length > 4) w = w.replace(/[sx]$/, "");
  if (w.length > 4) w = w.replace(/e$/, "");
  return w;
}

export function motsDe(texte) {
  const brut = String(texte || "").match(/[\p{L}\p{N}]+/gu) || [];
  const sortie = [];
  for (const m of brut) {
    const w = normaliserMot(m);
    if (w.length < 2 || w.length > 40 || VIDES.has(w)) continue;
    sortie.push(w);
  }
  return sortie;
}

// 52 bits d'empreinte, en hexadécimal (l'analyseur de FTS5 les garde tels quels).
const empreinte = (cle, terme) => "h" + crypto.createHmac("sha256", cle).update(terme).digest("hex").slice(0, 13);

// Les empreintes d'un texte, pour l'index : le mot entier, et ses débuts de 4
// et 6 lettres (on cherche « deploi » et l'on trouve « déploiement »).
export function jetonsIndex(texte) {
  const k = cles();
  const vus = new Set();
  for (const w of motsDe(texte)) {
    vus.add(empreinte(k.index, `m:${w}`));
    if (w.length > 4) vus.add(empreinte(k.index, `p4:${w.slice(0, 4)}`));
    if (w.length > 6) vus.add(empreinte(k.index, `p6:${w.slice(0, 6)}`));
  }
  return [...vus].join(" ");
}

// Les empreintes d'une recherche : un groupe par mot cherché (le mot entier, ou
// son début s'il est court ou s'il peut être le début d'un mot plus long).
export function jetonsRecherche(q) {
  const k = cles();
  const groupes = [];
  const vus = new Set();
  for (const w of motsDe(q).slice(0, 12)) {
    if (vus.has(w)) continue;
    vus.add(w);
    const variantes = [empreinte(k.index, `m:${w}`)];
    if (w.length >= 6) variantes.push(empreinte(k.index, `p6:${w.slice(0, 6)}`));
    else if (w.length >= 4) variantes.push(empreinte(k.index, `p4:${w.slice(0, 4)}`));
    groupes.push({ mot: w, jetons: variantes });
  }
  return groupes;
}

// Identifiant stable et non devinable d'un dossier de projet.
export function idProjet(racineNormalisee) {
  const k = cles();
  return "p-" + crypto.createHmac("sha256", k.index).update(`projet:${racineNormalisee}`).digest("hex").slice(0, 10);
}

// Clé d'un fichier lu (curseur) : son chemin ne reste pas en clair.
export function cleChemin(chemin) {
  const k = cles();
  return "f-" + crypto.createHmac("sha256", k.index).update(`chemin:${chemin}`).digest("hex").slice(0, 24);
}
