// Sauvegardes de Rémy (Lot 0, J0.1).
//
// Une archive = tout ce qu'il faut pour remettre Rémy sur pied :
//   base/…     la base de l'app (<coffre>/.remy : JSON, plus tard remy.db)
//   coffre/…   tout le coffre Obsidian lisible (mémoire, conversations,
//              réflexions, captures, réglages Obsidian)
//   motion/…   un instantané des tâches Motion (lecture seule) : Motion n'a pas
//              d'annulation par API, c'est notre filet en cas d'erreur de masse.
//
// Format : un manifeste (chemin, taille, SHA-256 de chaque fichier) et les
// contenus, compressés puis chiffrés en AES-256-GCM avec REMY_SAUVEGARDE_CLE
// (64 caractères hexadécimaux). La clé n'est JAMAIS dans l'archive : Sam en
// garde une copie hors de la tour, sinon une tour perdue rend les sauvegardes
// illisibles. Sans clé, pas de sauvegarde (sauf option explicite des tests).
//
// Chaque copie est relue et vérifiée après écriture. Une destination absente
// (disque externe débranché) est signalée, jamais ignorée en silence.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { ecrireAtomique } from "./coffre.js";
import { lireCible, copierSurSpark, formatOctets } from "./sftp.js";

export const FORMAT = "remy-sauvegarde";
export const VERSION = 1;
export const EXTENSION = ".remy-sauvegarde";
const ENTETE_CHIFFRE = Buffer.from("REMYSAV1");
const ENTETE_CLAIR = Buffer.from("REMYSAV0");
const TAILLE_MAX = 2 * 1024 ** 3; // 2 Go : au-delà, il se passe quelque chose d'anormal

export class ArchiveInvalide extends Error {
  constructor(raison) {
    super(`Sauvegarde illisible : ${raison}`);
    this.code = "ARCHIVE_INVALIDE";
  }
}

export function cleSauvegarde(hex = process.env.REMY_SAUVEGARDE_CLE) {
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("REMY_SAUVEGARDE_CLE doit faire 64 caractères hexadécimaux (pour en créer une sans l'afficher : node scripts/cle-sauvegarde.mjs --creer)");
  }
  return Buffer.from(hex, "hex");
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// L'empreinte de la clé (12 caractères) : de quoi vérifier qu'une copie est la
// bonne, sans permettre de retrouver la clé.
export function empreinteCle(hex = process.env.REMY_SAUVEGARDE_CLE) {
  if (!hex) return null;
  const h = sha256(`remy-sauvegarde:${String(hex).trim().toLowerCase()}`).slice(0, 12);
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}
const posix = (p) => p.split(path.sep).join("/");

// --- Collecte ----------------------------------------------------------------------

function parcourir(racine, { exclure = [] } = {}) {
  const sortie = [];
  const visiter = (dossier) => {
    let entrees;
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const e of entrees) {
      const plein = path.join(dossier, e.name);
      if (exclure.some((x) => path.resolve(plein) === path.resolve(x))) continue;
      // Une base mise de côté par une restauration est déjà dans l'archive
      // « avant-restauration » : inutile de la traîner dans chaque sauvegarde.
      if (e.isDirectory() && e.name.startsWith(".remy.avant-restauration-")) continue;
      if (e.isDirectory()) visiter(plein);
      else if (e.isFile() && !e.name.endsWith(".tmp")) sortie.push(plein);
    }
  };
  visiter(racine);
  return sortie;
}

// Les fichiers à sauvegarder, lus tels quels (octet pour octet) : un fichier
// de la base illisible pour l'app est quand même sauvegardé, c'est justement
// celui qu'on voudra examiner.
// La base SQLite n'est jamais copiée « à chaud » octet par octet (elle peut
// être en pleine écriture, avec son journal WAL à côté) : sauvegarderRemy en
// ajoute une copie cohérente (VACUUM INTO).
const FICHIERS_SQLITE = new Set(["remy.db", "remy.db-wal", "remy.db-shm"]);

// `exclure` : des dossiers jamais emportés (les exports ChatGPT déposés pour
// Rémy : souvent des centaines de Mo, en clair, et déjà dans la base des
// conversations, chiffrés).
export function collecter({ base, coffre, exclure = [] }) {
  const fichiers = [];
  let total = 0;
  const ajouter = (prefixe, racine, f) => {
    const contenu = fs.readFileSync(f);
    total += contenu.length;
    if (total > TAILLE_MAX) throw new Error("Plus de 2 Go à sauvegarder : anormal, sauvegarde arrêtée.");
    fichiers.push({ chemin: `${prefixe}/${posix(path.relative(racine, f))}`, contenu });
  };
  if (base) for (const f of parcourir(base, { exclure })) if (!(path.resolve(path.dirname(f)) === path.resolve(base) && FICHIERS_SQLITE.has(path.basename(f)))) ajouter("base", base, f);
  // La base vit d'ordinaire DANS le coffre (<coffre>/.remy) : pas deux fois.
  if (coffre) for (const f of parcourir(coffre, { exclure: [...(base ? [base] : []), ...exclure] })) ajouter("coffre", coffre, f);
  return fichiers;
}

// --- Archive -----------------------------------------------------------------------

export function creerArchive(fichiers, { cle, meta = {} }) {
  const manifeste = {
    format: FORMAT,
    version: VERSION,
    ...meta,
    fichiers: fichiers.map((f) => ({ chemin: f.chemin, taille: f.contenu.length, sha256: sha256(f.contenu) })),
  };
  const charge = zlib.gzipSync(
    Buffer.from(JSON.stringify({ manifeste, contenus: Object.fromEntries(fichiers.map((f) => [f.chemin, f.contenu.toString("base64")])) })),
  );
  if (!cle) return Buffer.concat([ENTETE_CLAIR, charge]);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", cle, iv);
  c.setAAD(ENTETE_CHIFFRE);
  const ct = Buffer.concat([c.update(charge), c.final()]);
  return Buffer.concat([ENTETE_CHIFFRE, iv, c.getAuthTag(), ct]);
}

// Vérifie TOUT avant de rendre quoi que ce soit : clé, intégrité, empreintes.
// `accepterClair` : une archive NON chiffrée n'est lue que si on le demande
// quand une clé existe — sinon n'importe qui pouvant écrire dans le dossier
// des sauvegardes (NAS, disque externe) ferait restaurer ce qu'il veut.
export function lireArchive(buf, { cle, accepterClair = false } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) throw new ArchiveInvalide("fichier vide ou tronqué");
  const entete = buf.subarray(0, 8);
  let charge;
  if (entete.equals(ENTETE_CHIFFRE)) {
    if (!cle) throw new ArchiveInvalide("archive chiffrée et REMY_SAUVEGARDE_CLE absente");
    if (buf.length < 8 + 12 + 16) throw new ArchiveInvalide("fichier tronqué");
    const iv = buf.subarray(8, 20);
    const tag = buf.subarray(20, 36);
    const d = crypto.createDecipheriv("aes-256-gcm", cle, iv);
    d.setAAD(ENTETE_CHIFFRE);
    d.setAuthTag(tag);
    try {
      charge = Buffer.concat([d.update(buf.subarray(36)), d.final()]);
    } catch {
      throw new ArchiveInvalide("mauvaise clé, ou archive modifiée ou tronquée");
    }
  } else if (entete.equals(ENTETE_CLAIR)) {
    if (cle && !accepterClair) {
      throw new ArchiveInvalide("archive NON chiffrée alors qu'une clé est configurée : refusée (elle a pu être déposée par un tiers) — --accepter-clair pour passer outre en connaissance de cause");
    }
    charge = buf.subarray(8);
  } else {
    throw new ArchiveInvalide("ce n'est pas une sauvegarde de Rémy");
  }
  let donnees;
  try {
    donnees = JSON.parse(zlib.gunzipSync(charge).toString("utf8"));
  } catch {
    throw new ArchiveInvalide("contenu illisible");
  }
  const { manifeste, contenus } = donnees || {};
  if (manifeste?.format !== FORMAT) throw new ArchiveInvalide("format inconnu");
  if (manifeste.version > VERSION) throw new ArchiveInvalide(`version ${manifeste.version} plus récente que ce Rémy (${VERSION})`);
  const fichiers = manifeste.fichiers.map((f) => {
    if (typeof contenus?.[f.chemin] !== "string") throw new ArchiveInvalide(`fichier manquant : ${f.chemin}`);
    const contenu = Buffer.from(contenus[f.chemin], "base64");
    if (contenu.length !== f.taille || sha256(contenu) !== f.sha256) throw new ArchiveInvalide(`empreinte fausse : ${f.chemin}`);
    if (!/^(base|coffre|motion)\/[^]+$/.test(f.chemin) || f.chemin.split("/").includes("..")) {
      throw new ArchiveInvalide(`chemin refusé : ${f.chemin}`);
    }
    return { chemin: f.chemin, contenu };
  });
  return { manifeste, fichiers };
}

// --- Nom, rétention ------------------------------------------------------------------

const deux = (n) => String(n).padStart(2, "0");
export function nomArchive(date, raison) {
  const r = String(raison || "manuelle").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40) || "manuelle";
  return `remy-${date.getFullYear()}${deux(date.getMonth() + 1)}${deux(date.getDate())}-${deux(date.getHours())}${deux(date.getMinutes())}${deux(date.getSeconds())}-${r}${EXTENSION}`;
}

export function lireNom(nom) {
  const m = /^remy-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z0-9-]+)\.remy-sauvegarde$/.exec(nom);
  if (!m) return null;
  const [, a, mo, j, h, mi, s, raison] = m;
  return { nom, date: new Date(+a, +mo - 1, +j, +h, +mi, +s), raison };
}

const JOUR = 86_400_000;
const cleJour = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const cleMois = (d) => `${d.getFullYear()}-${d.getMonth()}`;
function cleSemaine(d) {
  // Semaine ISO : lundi comme premier jour.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${Math.ceil(((t - debutAnnee) / JOUR + 1) / 7)}`;
}

// Ce qu'on garde : la plus récente de chacun des 14 derniers jours, des 8
// dernières semaines et des 12 derniers mois ; toutes les « avant-… » (mise à
// jour, migration, restauration) de moins de 90 jours ; et toujours la plus
// récente de toutes. Le reste peut partir.
export function aGarder(noms, maintenant = new Date()) {
  const archives = noms.map(lireNom).filter(Boolean).sort((a, b) => b.date - a.date);
  const garder = new Set();
  if (archives[0]) garder.add(archives[0].nom);
  const plusRecentePar = (cle, limite) => {
    const vus = new Set();
    for (const a of archives) {
      const k = cle(a.date);
      if (vus.has(k)) continue;
      vus.add(k);
      if (vus.size > limite) break;
      garder.add(a.nom);
    }
  };
  plusRecentePar(cleJour, 14);
  plusRecentePar(cleSemaine, 8);
  plusRecentePar(cleMois, 12);
  for (const a of archives) if (a.raison.startsWith("avant-") && maintenant - a.date < 90 * JOUR) garder.add(a.nom);
  return garder;
}

// --- Écriture, vérification, purge -----------------------------------------------------

function ecrireEtVerifier(dossier, nom, archive, cle) {
  fs.mkdirSync(dossier, { recursive: true });
  const f = path.join(dossier, nom);
  ecrireAtomique(f, archive);
  // Relue depuis le disque, déchiffrée et vérifiée : une copie qu'on ne sait
  // pas relire n'est pas une sauvegarde.
  lireArchive(fs.readFileSync(f), { cle });
  return f;
}

export function purger(dossier, maintenant = new Date()) {
  let noms;
  try {
    noms = fs.readdirSync(dossier).filter((n) => n.endsWith(EXTENSION));
  } catch {
    return [];
  }
  const garder = aGarder(noms, maintenant);
  const supprimes = [];
  for (const n of noms) {
    if (garder.has(n) || !lireNom(n)) continue;
    fs.rmSync(path.join(dossier, n), { force: true });
    supprimes.push(n);
  }
  return supprimes;
}

// Le volume (disque) d'un chemin, même s'il n'existe pas encore : celui de
// son plus proche parent existant.
export function volumeDe(p) {
  let courant = path.resolve(p);
  for (;;) {
    try {
      return fs.statSync(courant).dev;
    } catch {
      const parent = path.dirname(courant);
      if (parent === courant) return null;
      courant = parent;
    }
  }
}

const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Une sauvegarde complète. `destinations` : [{ nom: "locale"|"externe", dossier }]
// ou [{ nom: "spark", distant: "utilisateur@hote:/dossier" }] (SFTP, lib/sftp.js).
// L'échec d'une destination n'arrête pas les autres ; il est rapporté.
export async function sauvegarder({
  base,
  coffre,
  destinations,
  raison = "manuelle",
  cle = cleSauvegarde(),
  sansChiffrement = false,
  instantaneMotion = null,
  extras = [],
  exclure = [],
  maintenant = new Date(),
  volume = volumeDe,
  optionsSftp = {},
} = {}) {
  if (!cle && !sansChiffrement) {
    throw new Error("REMY_SAUVEGARDE_CLE absente : pas de sauvegarde en clair. Crée la clé (voir docs/tour.md) et gardes-en une copie hors de la tour.");
  }
  const dests = (destinations || []).filter((d) => d?.dossier || d?.distant);
  if (!dests.length) throw new Error("Aucune destination de sauvegarde (REMY_SAUVEGARDES).");

  const fichiers = [...collecter({ base, coffre, exclure }), ...extras];
  let motion = "non branché";
  if (instantaneMotion) {
    try {
      const taches = await instantaneMotion();
      fichiers.push({ chemin: "motion/taches.json", contenu: Buffer.from(JSON.stringify(taches, null, 2)) });
      motion = `${Array.isArray(taches) ? taches.length : "?"} tâches`;
    } catch (err) {
      motion = `indisponible (${err.message})`;
    }
  }
  const nom = nomArchive(maintenant, raison);
  const archive = creerArchive(fichiers, {
    cle: sansChiffrement ? null : cle,
    meta: { creeeA: maintenant.toISOString(), raison, machine: os.hostname(), motion },
  });
  const cleLecture = sansChiffrement ? null : cle;
  const copies = [];
  for (const d of dests) {
    try {
      if (d.distant) {
        // Hors de la tour, par SFTP : l'archive part déjà chiffrée.
        // Jamais d'archive en clair hors de la tour.
        if (!cleLecture) throw new Error("pas d'envoi au Spark sans chiffrement");
        const cible = lireCible(d.distant);
        if (HOTES_LOCAUX.has(cible.hote) || cible.hote.toLowerCase() === os.hostname().toLowerCase()) {
          throw new Error(`${cible.hote} est la tour elle-même : ce n'est pas une copie hors de la tour`);
        }
        const r = await copierSurSpark({
          cible,
          nom,
          archive,
          verifier: (buf) => lireArchive(buf, { cle: cleLecture }),
          aGarder: (noms) => aGarder(noms, maintenant),
          dateArchive: (n) => lireNom(n)?.date || null,
          maintenant,
          options: optionsSftp,
        });
        copies.push({ nom: d.nom, ok: true, horsTour: true, ...r, ...(r.libre != null ? { libre: formatOctets(r.libre) } : {}) });
        continue;
      }
      if (d.nom === "externe" && !fs.existsSync(path.dirname(path.resolve(d.dossier)))) {
        // Disque débranché (ou NAS injoignable) : son lecteur n'existe plus. Ne
        // rien recréer sur le disque de la tour, ce ne serait plus une copie
        // externe. Le dossier lui-même est créé au premier passage.
        throw new Error(`destination introuvable (${d.dossier}) — disque débranché ?`);
      }
      if (d.nom === "externe" && base && volume(d.dossier) != null && volume(d.dossier) === volume(base)) {
        // Un dossier sur le disque de la tour n'est pas une sauvegarde externe :
        // il meurt avec elle. (Un second disque INTERNE non plus — à ne pas
        // utiliser comme « externe ».)
        throw new Error(`${d.dossier} est sur le même disque que la base de Rémy : ce n'est pas une copie externe`);
      }
      const f = ecrireEtVerifier(d.dossier, nom, archive, cleLecture);
      const supprimees = purger(d.dossier, maintenant);
      copies.push({ nom: d.nom, ok: true, horsTour: d.nom === "externe", fichier: f, supprimees: supprimees.length });
    } catch (err) {
      copies.push({ nom: d.nom, ok: false, erreur: err.message });
    }
  }
  return { nom, taille: archive.length, fichiers: fichiers.length, motion, copies };
}

// --- Restauration ------------------------------------------------------------------------

// Écrit les fichiers d'une archive. Par défaut dans un dossier NEUF (vers) ;
// en place seulement si l'appelant l'a explicitement demandé (`cibles`).
export function restaurerFichiers(fichiers, { vers = null, cibles = null } = {}) {
  if (!vers && !cibles) throw new Error("Restauration : ni dossier neuf (vers), ni cibles en place.");
  if (vers) {
    if (fs.existsSync(vers) && fs.readdirSync(vers).length) {
      throw new Error(`Le dossier ${vers} n'est pas vide : choisis un dossier neuf (rien n'est écrasé).`);
    }
  }
  const ecrits = [];
  for (const f of fichiers) {
    const [prefixe, ...reste] = f.chemin.split("/");
    const racine = vers ? path.join(vers, prefixe) : cibles[prefixe];
    if (!racine) continue; // ex. l'instantané Motion n'a pas de cible en place
    const dest = path.join(racine, ...reste);
    if (!path.resolve(dest).startsWith(path.resolve(racine) + path.sep)) throw new ArchiveInvalide(`chemin refusé : ${f.chemin}`);
    ecrireAtomique(dest, f.contenu);
    ecrits.push(dest);
  }
  return ecrits;
}

// --- État (pour /api/health) -----------------------------------------------------------------

const fichierEtat = (base) => path.join(base, "sauvegardes-etat.json");

export function noterEtat(base, resultat, at = Date.now()) {
  if (!base) return;
  ecrireAtomique(fichierEtat(base), JSON.stringify({ at, ...resultat }, null, 2));
}

export function lireEtat(base) {
  try {
    return JSON.parse(fs.readFileSync(fichierEtat(base), "utf8"));
  } catch {
    return null;
  }
}

export function resumeEtat(etat, maintenant = Date.now()) {
  if (!process.env.REMY_SAUVEGARDE_CLE) return "⚠️ aucune sauvegarde : REMY_SAUVEGARDE_CLE absente (voir docs/tour.md)";
  if (!etat) return "⚠️ aucune sauvegarde faite pour l'instant";
  if (etat.erreur) return `❌ dernière tentative échouée : ${etat.erreur}`;
  const heures = Math.round((maintenant - etat.at) / 3_600_000);
  const copies = (etat.copies || []).map((c) => `${c.nom} ${c.ok ? "✅" : `❌ ${c.erreur}`}`).join(", ");
  const age = heures < 1 ? "il y a moins d'une heure" : `il y a ${heures} h`;
  // Une copie ratée (disque externe débranché) ou un Motion non sauvegardé
  // n'est pas « tout va bien » : alerte, même si la sauvegarde est récente.
  const motionRate = typeof etat.motion === "string" && etat.motion.startsWith("indisponible");
  // Une copie sur la tour seule n'est pas une sauvegarde : elle meurt avec elle.
  const horsTour = (etat.copies || []).some((c) => c.ok && (c.horsTour || c.nom === "spark"));
  const alerte = heures > 36 || (etat.copies || []).some((c) => !c.ok) || motionRate || !horsTour;
  const libre = (etat.copies || []).find((c) => c.ok && c.libre)?.libre;
  return `${alerte ? "⚠️" : "✅"} dernière ${age} (${etat.nom}) — ${copies}${libre ? ` (${libre} libres)` : ""}${etat.motion ? ` · Motion : ${etat.motion}` : ""}${horsTour ? "" : " · aucune copie hors de la tour"}`;
}

// --- Rémy tel qu'il tourne (tour ou développement) ------------------------------------------

// Locale : REMY_SAUVEGARDES (défaut ~/.remy/sauvegardes, hors du coffre).
// Externe : REMY_SAUVEGARDES_EXTERNE (le disque externe de Sam, D3).
// Spark : REMY_SAUVEGARDES_SPARK (utilisateur@hote:/dossier, par SFTP) — la
// destination hors de la tour en attendant le disque.
export function destinations(env = process.env) {
  const d = [{ nom: "locale", dossier: env.REMY_SAUVEGARDES || path.join(os.homedir(), ".remy", "sauvegardes") }];
  if (env.REMY_SAUVEGARDES_EXTERNE) d.push({ nom: "externe", dossier: env.REMY_SAUVEGARDES_EXTERNE });
  if (env.REMY_SAUVEGARDES_SPARK) d.push({ nom: "spark", distant: env.REMY_SAUVEGARDES_SPARK });
  return d;
}

export async function sauvegarderRemy({ raison = "manuelle", ...options } = {}) {
  // Imports tardifs : store et motion lisent leur configuration à l'import.
  const store = await import("./store.js");
  const motion = await import("./motion.js");
  const { coffre } = await import("./coffre.js");
  const base = store.dossierBase();
  const extras = [];
  let copie = null;
  try {
    // La base SQLite, copiée de façon cohérente même si Rémy écrit dedans.
    const { cheminBase, copieAChaud } = await import("./db.js");
    if (fs.existsSync(cheminBase())) {
      copie = path.join(os.tmpdir(), `remy-db-${process.pid}-${Date.now()}.db`);
      copieAChaud(copie);
      extras.push({ chemin: "base/remy.db", contenu: fs.readFileSync(copie) });
    }
    const exclure = [];
    try {
      const { dossierImports } = await import("./connaissances/sync.js");
      exclure.push(dossierImports());
    } catch (err) {
      console.warn("Sauvegarde : dossier des imports inconnu,", err.message);
    }
    const r = await sauvegarder({
      base,
      coffre: coffre(),
      destinations: destinations(),
      raison,
      instantaneMotion: motion.motionEnabled() ? () => motion.tachesMotion() : null,
      extras,
      exclure,
      ...options,
    });
    noterEtat(base, r);
    return r;
  } catch (err) {
    noterEtat(base, { erreur: err.message });
    throw err;
  } finally {
    if (copie) fs.rmSync(copie, { force: true });
  }
}
